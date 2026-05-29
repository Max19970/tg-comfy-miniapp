import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { parseHistoryImages } from '../comfy/images.js';
import { asPositiveInt } from '../utils/numbers.js';
import { httpError } from '../utils/errors.js';

const COMFY_BINARY_EVENTS = {
  PREVIEW_IMAGE: 1,
  PREVIEW_IMAGE_WITH_METADATA: 4
};

function nowIso() {
  return new Date().toISOString();
}

function getNodeDisplayName(workflow, nodeId) {
  if (!nodeId) return null;

  const id = String(nodeId);
  const node = workflow?.[id];
  if (!node) return `Node ${id}`;

  if (node._meta?.title) return node._meta.title;

  const friendly = {
    CheckpointLoaderSimple: 'Загрузка модели',
    CLIPTextEncode: 'Кодирование промпта',
    EmptyLatentImage: 'Создание latent',
    KSampler: 'Сэмплинг',
    VAEDecode: 'VAE Decode',
    SaveImage: 'Сохранение изображения',
    LoraLoader: node.inputs?.lora_name ? `LoRA: ${node.inputs.lora_name}` : 'LoRA'
  };

  return friendly[node.class_type] || node.class_type || `Node ${id}`;
}

function parseComfyPreview(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length < 8) return null;

  const eventType = buffer.readUInt32BE(0);

  if (eventType === COMFY_BINARY_EVENTS.PREVIEW_IMAGE) {
    const imageType = buffer.readUInt32BE(4);
    const mimeType = imageType === 2 ? 'image/png' : 'image/jpeg';
    const imageBytes = buffer.subarray(8);
    if (!imageBytes.length) return null;

    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${imageBytes.toString('base64')}`
    };
  }

  if (eventType === COMFY_BINARY_EVENTS.PREVIEW_IMAGE_WITH_METADATA) {
    const metadataLength = buffer.readUInt32BE(4);
    const imageStart = 8 + metadataLength;
    if (metadataLength < 0 || buffer.length <= imageStart) return null;

    let metadata = {};
    try {
      metadata = JSON.parse(buffer.subarray(8, imageStart).toString('utf8'));
    } catch {}

    const mimeType = metadata.image_type || 'image/jpeg';
    const imageBytes = buffer.subarray(imageStart);
    if (!imageBytes.length) return null;

    return {
      mimeType,
      dataUrl: `data:${mimeType};base64,${imageBytes.toString('base64')}`
    };
  }

  return null;
}

export function publicJob(job, queuePosition = null) {
  return {
    id: job.id,
    userId: job.userId,
    status: job.status,
    progress: job.progress || 0,
    queuePosition: queuePosition ?? job.queuePosition ?? null,
    currentNode: job.currentNode || null,
    currentNodeName: job.currentNodeName || null,
    promptId: job.promptId,
    settings: job.settings,
    images: job.images || [],
    favorite: Boolean(job.favorite),
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    cancelledAt: job.cancelledAt
  };
}

export class JobService {
  constructor({ config, repository, workflowBuilder, comfyClient, imageDownloader, wsHub }) {
    this.config = config;
    this.repository = repository;
    this.workflowBuilder = workflowBuilder;
    this.comfyClient = comfyClient;
    this.imageDownloader = imageDownloader;
    this.wsHub = wsHub;
    this.queue = [];
    this.active = new Map();
    this.cancelled = new Set();
  }

  maxConcurrentGlobal() {
    return asPositiveInt(this.config.jobs?.maxConcurrentGlobal, 1);
  }

  maxQueuePerUser() {
    return asPositiveInt(this.config.jobs?.maxQueuePerUser, 3);
  }

  getQueuePosition(jobId) {
    const index = this.queue.findIndex((item) => item.id === jobId);
    return index >= 0 ? index + 1 : null;
  }

  countQueuedForUser(userId) {
    return this.queue.filter((item) => String(item.userId) === String(userId)).length;
  }

  async createJob({ userId, settings }) {
    if (this.countQueuedForUser(userId) >= this.maxQueuePerUser()) {
      throw httpError(429, `Too many queued jobs. Limit per user is ${this.maxQueuePerUser()}.`);
    }

    const job = {
      id: crypto.randomUUID(),
      userId: String(userId),
      status: 'queued',
      progress: 0,
      settings,
      images: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.queue.push(job);
    await this.repository.upsertGeneration(job, { flush: true });
    this.broadcast(job);
    this.processQueue();
    return job;
  }

  async updateJob(jobId, patch, { flush = false } = {}) {
    const current = this.active.get(jobId) || await this.repository.getGenerationAnyUser(jobId) || {};
    const next = { ...current, ...patch, updatedAt: nowIso() };
    if (this.active.has(jobId)) this.active.set(jobId, next);
    await this.repository.upsertGeneration(next, { flush });
    this.broadcast(next);
    return next;
  }

  broadcast(job) {
    this.wsHub?.broadcast(job.id, { type: 'job', job: publicJob(job, this.getQueuePosition(job.id)) });
  }

  broadcastPreview(jobId, preview) {
    this.wsHub?.broadcast(jobId, {
      type: 'preview',
      preview: {
        ...preview,
        updatedAt: nowIso()
      }
    });
  }

  broadcastQueuePositions() {
    for (const job of this.queue) this.broadcast(job);
  }

  processQueue() {
    while (this.active.size < this.maxConcurrentGlobal() && this.queue.length) {
      const job = this.queue.shift();
      this.active.set(job.id, job);
      this.broadcastQueuePositions();
      this.runJob(job).catch((error) => console.error(`[jobs] job ${job.id} crashed:`, error));
    }
  }

  async waitForComfyCompletion(job, workflow) {
    const wsUrl = this.comfyClient.webSocketUrl(job.clientId);
    await this.updateJob(job.id, { status: 'running', progress: 1 });

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let settled = false;
      let lastPreviewAt = 0;
      const keepAlive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }, 20000);

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearInterval(keepAlive);
        try { socket.close(); } catch {}
        reject(error);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        clearInterval(keepAlive);
        try { socket.close(); } catch {}
        resolve();
      };

      socket.on('message', async (data, isBinary) => {
        try {
          if (this.cancelled.has(job.id)) return finish();

          if (isBinary) {
            const preview = parseComfyPreview(data);
            const now = Date.now();
            if (preview && now - lastPreviewAt >= 300) {
              lastPreviewAt = now;
              this.broadcastPreview(job.id, preview);
            }
            return;
          }

          if (typeof data !== 'string' && !Buffer.isBuffer(data)) return;
          const text = data.toString().trim();
          if (!text.startsWith('{')) return;
          const message = JSON.parse(text);
          const type = message.type;
          const payload = message.data || {};
          if (payload.prompt_id && payload.prompt_id !== job.promptId) return;

          if (type === 'progress') {
            const value = Number(payload.value || 0);
            const max = Number(payload.max || 1);
            const percent = Math.max(1, Math.min(99, Math.round((value / max) * 100)));
            await this.updateJob(job.id, {
              status: 'running',
              progress: percent,
              currentNode: payload.node || null,
              currentNodeName: getNodeDisplayName(workflow, payload.node)
            });
          }

          if (type === 'executing') {
            if (payload.node === null && payload.prompt_id === job.promptId) {
              await this.updateJob(job.id, { status: 'finalizing', progress: 99, currentNode: null, currentNodeName: null });
              finish();
            } else if (payload.node) {
              await this.updateJob(job.id, {
                status: 'running',
                currentNode: String(payload.node),
                currentNodeName: getNodeDisplayName(workflow, payload.node)
              });
            }
          }

          if (type === 'execution_error') fail(new Error(payload.exception_message || 'ComfyUI execution error'));
        } catch (error) {
          fail(error);
        }
      });

      socket.on('error', fail);
      socket.on('close', () => {
        clearInterval(keepAlive);
        if (!settled) fail(new Error('ComfyUI WebSocket closed before generation completed'));
      });
    });
  }

  async runJob(initialJob) {
    let job = initialJob;
    try {
      job = await this.updateJob(job.id, { status: 'submitting', progress: 0 });
      const workflow = await this.workflowBuilder.build(job.settings);
      const clientId = crypto.randomUUID();
      const promptId = await this.comfyClient.submitPrompt({ workflow, clientId });
      job = await this.updateJob(job.id, { promptId, clientId, status: 'running', progress: 1 }, { flush: true });

      await this.waitForComfyCompletion(job, workflow);
      if (this.cancelled.has(job.id)) {
        await this.updateJob(job.id, { status: 'cancelled', progress: 0, cancelledAt: nowIso() }, { flush: true });
        return;
      }

      const history = await this.comfyClient.history(promptId);
      const comfyImages = parseHistoryImages(history, promptId);
      const images = await this.imageDownloader.downloadImages({ jobId: job.id, promptId, images: comfyImages });
      await this.updateJob(job.id, { status: 'done', progress: 100, images, completedAt: nowIso() }, { flush: true });
    } catch (error) {
      if (this.cancelled.has(job.id)) {
        await this.updateJob(job.id, { status: 'cancelled', progress: 0, cancelledAt: nowIso() }, { flush: true });
      } else {
        await this.updateJob(job.id, { status: 'failed', error: error.message || String(error) }, { flush: true });
      }
    } finally {
      this.active.delete(job.id);
      this.cancelled.delete(job.id);
      this.processQueue();
    }
  }

  async cancelJob(jobId, userId) {
    const queuedIndex = this.queue.findIndex((item) => item.id === jobId && String(item.userId) === String(userId));
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      const next = await this.updateJob(job.id, { status: 'cancelled', progress: 0, cancelledAt: nowIso() }, { flush: true });
      this.broadcastQueuePositions();
      return next;
    }

    const job = this.active.get(jobId) || await this.repository.getGeneration(jobId, userId);
    if (!job) throw httpError(404, 'Generation not found');
    if (String(job.userId) !== String(userId)) throw httpError(404, 'Generation not found');
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;

    this.cancelled.add(jobId);
    const next = await this.updateJob(jobId, { status: 'cancelling', error: null }, { flush: true });

    if (this.config.jobs?.allowInterruptRunning) {
      try {
        await this.comfyClient.interrupt();
      } catch (error) {
        console.warn(`[jobs] failed to interrupt ComfyUI for ${jobId}: ${error.message}`);
      }
    }

    return next;
  }
}
