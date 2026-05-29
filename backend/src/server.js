import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import YAML from 'yaml';
import { WebSocket, WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findConfigPath() {
  const candidates = [
    process.env.CONFIG_PATH,
    path.resolve(process.cwd(), 'config.yaml'),
    path.resolve(process.cwd(), 'config.yml'),
    path.resolve(process.cwd(), '../config.yaml'),
    path.resolve(process.cwd(), '../config.yml'),
    path.resolve(__dirname, '../../config.yaml'),
    path.resolve(__dirname, '../../../config.yaml')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  throw new Error('config.yaml not found. Copy config.example.yaml to config.yaml or set CONFIG_PATH.');
}

const configPath = findConfigPath();
const appRoot = path.dirname(configPath);
const rawConfig = await fs.readFile(configPath, 'utf8');
const config = YAML.parse(rawConfig);

function resolveAppPath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(appRoot, value);
}

const dataDir = resolveAppPath(config.storage?.dataDir || './backend/data');
const generatedDir = path.join(dataDir, 'generated');
const dbPath = path.join(dataDir, 'db.json');
await fs.mkdir(generatedDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

const server = http.createServer(app);
const wsServer = new WebSocketServer({ noServer: true });
const jobs = new Map();
const subscribers = new Map();

const DEFAULT_SETTINGS = {
  prompt: 'a cinematic photo of a cozy robot artist, highly detailed',
  negativePrompt: 'low quality, blurry, watermark, text',
  checkpoint: config.comfy?.fallback?.checkpoints?.[0] || '',
  width: 512,
  height: 512,
  batchSize: 1,
  steps: 25,
  cfg: 7,
  samplerName: config.comfy?.fallback?.samplers?.[0] || 'euler',
  scheduler: config.comfy?.fallback?.schedulers?.[0] || 'normal',
  denoise: 1,
  seed: -1,
  loras: []
};

function nowIso() {
  return new Date().toISOString();
}

function publicBaseUrl() {
  return String(config.server?.publicBaseUrl || '').replace(/\/$/, '');
}

function getMiniAppUrl() {
  return String(config.server?.miniAppUrl || config.server?.publicBaseUrl || '').replace(/\/$/, '');
}


function boolFromConfig(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function maskSecret(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function resolveCloudflaredToken(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (text.startsWith('env:')) return process.env[text.slice(4)] || '';
  return text;
}

let cloudflaredProcess = null;
let cloudflaredStopping = false;

function buildCloudflaredCommand() {
  const cf = config.cloudflare || {};
  const executable = cf.executable || process.env.CLOUDFLARED_BIN || 'cloudflared';
  const args = ['tunnel'];

  if (cf.configFile) {
    args.push('--config', resolveAppPath(cf.configFile));
  }
  if (cf.logLevel) {
    args.push('--loglevel', String(cf.logLevel));
  }
  if (Array.isArray(cf.extraArgsBeforeRun)) {
    args.push(...cf.extraArgsBeforeRun.map(String));
  }

  args.push('run');

  const token = resolveCloudflaredToken(cf.token || process.env.CLOUDFLARED_TOKEN);
  if (token) {
    args.push('--token', token);
  }
  if (Array.isArray(cf.extraArgsAfterRun)) {
    args.push(...cf.extraArgsAfterRun.map(String));
  }
  if (cf.tunnelName && !token) {
    args.push(String(cf.tunnelName));
  }

  const safeArgs = args.map((arg, index) => {
    if (args[index - 1] === '--token') return maskSecret(arg);
    return arg;
  });

  return { executable, args, safeArgs };
}

function startCloudflared() {
  const cf = config.cloudflare || {};
  const autoStart = boolFromConfig(cf.autoStart, false);
  if (!autoStart) {
    console.log('[cloudflared] autostart disabled');
    return;
  }
  if (cloudflaredProcess) return;

  const { executable, args, safeArgs } = buildCloudflaredCommand();
  console.log(`[cloudflared] starting: ${executable} ${safeArgs.join(' ')}`);

  cloudflaredProcess = spawn(executable, args, {
    cwd: appRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  cloudflaredProcess.stdout?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.log(`[cloudflared] ${line}`);
    }
  });

  cloudflaredProcess.stderr?.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      console.error(`[cloudflared] ${line}`);
    }
  });

  cloudflaredProcess.on('error', (error) => {
    console.error(`[cloudflared] failed to start: ${error.message}`);
    console.error('[cloudflared] Check cloudflare.executable in config.yaml or add cloudflared to PATH.');
    cloudflaredProcess = null;
  });

  cloudflaredProcess.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`[cloudflared] exited with ${reason}`);
    cloudflaredProcess = null;
    if (!cloudflaredStopping && boolFromConfig(cf.restartOnExit, false)) {
      const delayMs = Number(cf.restartDelayMs || 5000);
      console.log(`[cloudflared] restarting in ${delayMs}ms`);
      setTimeout(() => {
        if (!cloudflaredStopping) startCloudflared();
      }, delayMs);
    }
  });
}

function stopCloudflared() {
  cloudflaredStopping = true;
  if (!cloudflaredProcess) return;
  console.log('[cloudflared] stopping...');
  try {
    cloudflaredProcess.kill('SIGTERM');
  } catch (error) {
    console.error(`[cloudflared] failed to stop gracefully: ${error.message}`);
  }
  const processToKill = cloudflaredProcess;
  setTimeout(() => {
    if (processToKill && !processToKill.killed) {
      try {
        console.log('[cloudflared] force stopping...');
        processToKill.kill('SIGKILL');
      } catch {}
    }
  }, 5000).unref?.();
}

function shutdown(signal) {
  console.log(`\n[app] received ${signal}, shutting down...`);
  stopCloudflared();
  server.close(() => {
    console.log('[app] backend stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 7000).unref?.();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP'));
process.once('uncaughtException', (error) => {
  console.error('[app] uncaught exception', error);
  stopCloudflared();
  process.exit(1);
});
process.once('unhandledRejection', (reason) => {
  console.error('[app] unhandled rejection', reason);
  stopCloudflared();
  process.exit(1);
});

async function readDb() {
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return { generations: [] };
    throw error;
  }
}

async function writeDb(db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, dbPath);
}

async function upsertGeneration(record) {
  const db = await readDb();
  const index = db.generations.findIndex((item) => item.id === record.id);
  if (index >= 0) db.generations[index] = { ...db.generations[index], ...record, updatedAt: nowIso() };
  else db.generations.unshift({ ...record, createdAt: record.createdAt || nowIso(), updatedAt: nowIso() });

  const max = Number(config.storage?.maxHistoryPerUser || 200);
  const byUser = new Map();
  db.generations = db.generations.filter((item) => {
    const key = String(item.userId || 'anonymous');
    const count = byUser.get(key) || 0;
    if (count >= max) return false;
    byUser.set(key, count + 1);
    return true;
  });
  await writeDb(db);
}

async function getGeneration(id, userId) {
  const db = await readDb();
  return db.generations.find((item) => item.id === id && String(item.userId) === String(userId));
}

function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function timingSafeEqualHex(left, right) {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function validateTelegramInitData(initData) {
  if (!config.telegram?.botToken || config.telegram.botToken.includes('PUT_TELEGRAM')) {
    throw Object.assign(new Error('Telegram bot token is not configured'), { status: 500 });
  }
  if (!initData) {
    throw Object.assign(new Error('Telegram initData is missing'), { status: 401 });
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw Object.assign(new Error('Telegram initData hash is missing'), { status: 401 });

  const authDate = Number(params.get('auth_date') || 0);
  const ttl = Number(config.telegram?.authTtlSeconds || 86400);
  if (ttl > 0 && (!authDate || Date.now() / 1000 - authDate > ttl)) {
    throw Object.assign(new Error('Telegram initData is expired'), { status: 401 });
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) {
    throw Object.assign(new Error('Telegram initData signature is invalid'), { status: 401 });
  }

  const user = safeJsonParse(params.get('user'), null);
  if (!user?.id) throw Object.assign(new Error('Telegram user is missing in initData'), { status: 401 });

  const allowed = config.telegram?.allowedUserIds || [];
  if (allowed.length && !allowed.map(String).includes(String(user.id))) {
    throw Object.assign(new Error('This Telegram user is not allowed'), { status: 403 });
  }

  return user;
}

function authMiddleware(req, res, next) {
  try {
    if (!config.telegram?.enforceAuth) {
      req.user = { id: 'dev', first_name: 'Dev' };
      return next();
    }
    const initData = req.get('X-Telegram-Init-Data') || req.query.initData;
    req.user = validateTelegramInitData(initData);
    next();
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message || 'Unauthorized' });
  }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function multipleOfEight(value, fallback) {
  const n = clampNumber(value, 64, 4096, fallback);
  return Math.max(64, Math.round(n / 8) * 8);
}

function normalizeSettings(input = {}) {
  const seedInput = Number(input.seed);
  const seed = Number.isFinite(seedInput) && seedInput >= 0
    ? Math.floor(seedInput)
    : crypto.randomInt(0, 2 ** 32 - 1);

  const loras = Array.isArray(input.loras)
    ? input.loras
      .filter((lora) => lora && String(lora.name || '').trim())
      .slice(0, 12)
      .map((lora) => ({
        name: String(lora.name).trim(),
        strengthModel: clampNumber(lora.strengthModel, -5, 5, 0.75),
        strengthClip: clampNumber(lora.strengthClip, -5, 5, 0.75)
      }))
    : [];

  return {
    prompt: String(input.prompt || DEFAULT_SETTINGS.prompt).slice(0, 8000),
    negativePrompt: String(input.negativePrompt ?? DEFAULT_SETTINGS.negativePrompt).slice(0, 8000),
    checkpoint: String(input.checkpoint || DEFAULT_SETTINGS.checkpoint),
    width: multipleOfEight(input.width, DEFAULT_SETTINGS.width),
    height: multipleOfEight(input.height, DEFAULT_SETTINGS.height),
    batchSize: Math.floor(clampNumber(input.batchSize, 1, 8, DEFAULT_SETTINGS.batchSize)),
    steps: Math.floor(clampNumber(input.steps, 1, 150, DEFAULT_SETTINGS.steps)),
    cfg: clampNumber(input.cfg, 0, 30, DEFAULT_SETTINGS.cfg),
    samplerName: String(input.samplerName || DEFAULT_SETTINGS.samplerName),
    scheduler: String(input.scheduler || DEFAULT_SETTINGS.scheduler),
    denoise: clampNumber(input.denoise, 0, 1, DEFAULT_SETTINGS.denoise),
    seed,
    loras
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.comfy?.requestTimeoutMs || 120000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function comfyHttpUrl(pathname, query = {}) {
  const base = String(config.comfy?.httpUrl || '').replace(/\/$/, '');
  const url = new URL(`${base}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

async function comfyJson(pathname, options = {}) {
  const response = await fetchWithTimeout(comfyHttpUrl(pathname), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ComfyUI ${pathname} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function loadWorkflowTemplate() {
  const workflowPath = resolveAppPath(config.comfy?.workflowFile || './workflows/sd15-basic.json');
  const raw = await fs.readFile(workflowPath, 'utf8');
  return JSON.parse(raw);
}

function findNodeId(workflow, classType) {
  const entry = Object.entries(workflow).find(([, node]) => node.class_type === classType);
  return entry?.[0];
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function buildWorkflow(settings) {
  const workflow = deepClone(await loadWorkflowTemplate());
  const checkpointNode = findNodeId(workflow, 'CheckpointLoaderSimple');
  const latentNode = findNodeId(workflow, 'EmptyLatentImage');
  const positiveNode = Object.entries(workflow).find(([, node]) => node.class_type === 'CLIPTextEncode')?.[0];
  const textNodes = Object.entries(workflow).filter(([, node]) => node.class_type === 'CLIPTextEncode').map(([id]) => id);
  const negativeNode = textNodes[1] || textNodes[0];
  const samplerNode = findNodeId(workflow, 'KSampler');
  const saveNode = findNodeId(workflow, 'SaveImage');

  for (const [name, id] of Object.entries({ checkpointNode, latentNode, positiveNode, negativeNode, samplerNode, saveNode })) {
    if (!id) throw new Error(`Workflow template does not contain required node: ${name}`);
  }

  workflow[checkpointNode].inputs.ckpt_name = settings.checkpoint;
  workflow[latentNode].inputs.width = settings.width;
  workflow[latentNode].inputs.height = settings.height;
  workflow[latentNode].inputs.batch_size = settings.batchSize;
  workflow[positiveNode].inputs.text = settings.prompt;
  workflow[negativeNode].inputs.text = settings.negativePrompt;

  let currentModel = [checkpointNode, 0];
  let currentClip = [checkpointNode, 1];
  let nextId = Math.max(...Object.keys(workflow).map((id) => Number(id)).filter(Number.isFinite)) + 1;

  for (const lora of settings.loras) {
    const id = String(nextId++);
    workflow[id] = {
      class_type: 'LoraLoader',
      inputs: {
        model: currentModel,
        clip: currentClip,
        lora_name: lora.name,
        strength_model: lora.strengthModel,
        strength_clip: lora.strengthClip
      }
    };
    currentModel = [id, 0];
    currentClip = [id, 1];
  }

  workflow[positiveNode].inputs.clip = currentClip;
  workflow[negativeNode].inputs.clip = currentClip;

  Object.assign(workflow[samplerNode].inputs, {
    seed: settings.seed,
    steps: settings.steps,
    cfg: settings.cfg,
    sampler_name: settings.samplerName,
    scheduler: settings.scheduler,
    denoise: settings.denoise,
    model: currentModel
  });

  workflow[saveNode].inputs.filename_prefix = `tg_comfy/${settings.seed}`;
  return workflow;
}

function sanitizeFilename(name) {
  return String(name || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseHistoryImages(history, promptId) {
  const item = history?.[promptId] || history;
  const outputs = item?.outputs || {};
  const images = [];
  for (const output of Object.values(outputs)) {
    for (const image of output.images || []) {
      images.push({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output'
      });
    }
  }
  return images;
}

async function downloadComfyImages(promptId, images) {
  const jobDir = path.join(generatedDir, promptId);
  await fs.mkdir(jobDir, { recursive: true });
  const result = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const url = comfyHttpUrl('/view', image);
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`Failed to download image from ComfyUI: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const localName = `${index + 1}-${sanitizeFilename(image.filename)}`;
    await fs.writeFile(path.join(jobDir, localName), buffer);
    result.push({
      url: `/generated/${promptId}/${localName}`,
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type
    });
  }
  return result;
}

function broadcast(jobId, payload) {
  const clients = subscribers.get(jobId);
  if (!clients) return;
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

async function updateJob(jobId, patch) {
  const current = jobs.get(jobId) || {};
  const next = { ...current, ...patch, updatedAt: nowIso() };
  jobs.set(jobId, next);
  await upsertGeneration(next);
  broadcast(jobId, { type: 'job', job: publicJob(next) });
}

function publicJob(job) {
  return {
    id: job.id,
    userId: job.userId,
    status: job.status,
    progress: job.progress || 0,
    currentNode: job.currentNode || null,
    promptId: job.promptId,
    settings: job.settings,
    images: job.images || [],
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

async function waitForComfyCompletion(job) {
  const wsBase = String(config.comfy?.wsUrl || '').replace(/\/$/, '');
  const separator = wsBase.includes('?') ? '&' : '?';
  const wsUrl = `${wsBase}${separator}clientId=${encodeURIComponent(job.clientId)}`;

  await updateJob(job.id, { status: 'running', progress: 1 });

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let settled = false;
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

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearInterval(keepAlive);
      try { socket.close(); } catch {}
      resolve();
    };

    socket.on('message', async (data) => {
      try {
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
          await updateJob(job.id, { status: 'running', progress: percent, currentNode: payload.node || null });
        }

        if (type === 'executing') {
          if (payload.node === null && payload.prompt_id === job.promptId) {
            await updateJob(job.id, { status: 'finalizing', progress: 99, currentNode: null });
            await finish();
          } else if (payload.node) {
            await updateJob(job.id, { status: 'running', currentNode: String(payload.node) });
          }
        }

        if (type === 'execution_error') {
          fail(new Error(payload.exception_message || 'ComfyUI execution error'));
        }
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

async function startGenerationWatcher(job) {
  try {
    await waitForComfyCompletion(job);
    const history = await comfyJson(`/history/${encodeURIComponent(job.promptId)}`);
    const comfyImages = parseHistoryImages(history, job.promptId);
    const images = await downloadComfyImages(job.promptId, comfyImages);
    await updateJob(job.id, { status: 'done', progress: 100, images, completedAt: nowIso() });
  } catch (error) {
    await updateJob(job.id, { status: 'failed', error: error.message || String(error) });
  }
}

async function getComfyResources() {
  const fallback = config.comfy?.fallback || {};
  const resources = {
    checkpoints: fallback.checkpoints || [],
    loras: fallback.loras || [],
    samplers: fallback.samplers || [],
    schedulers: fallback.schedulers || []
  };

  try {
    const [checkpointInfo, loraInfo, samplerInfo] = await Promise.all([
      comfyJson('/object_info/CheckpointLoaderSimple'),
      comfyJson('/object_info/LoraLoader'),
      comfyJson('/object_info/KSampler')
    ]);
    resources.checkpoints = checkpointInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || resources.checkpoints;
    resources.loras = loraInfo?.LoraLoader?.input?.required?.lora_name?.[0] || resources.loras;
    resources.samplers = samplerInfo?.KSampler?.input?.required?.sampler_name?.[0] || resources.samplers;
    resources.schedulers = samplerInfo?.KSampler?.input?.required?.scheduler?.[0] || resources.schedulers;
  } catch (error) {
    resources.warning = `ComfyUI object_info unavailable, fallback config is used: ${error.message}`;
  }

  return resources;
}

async function callTelegram(method, payload) {
  const token = config.telegram?.botToken;
  if (!token || token.includes('PUT_TELEGRAM')) throw new Error('Telegram bot token is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
  return json;
}

async function sendStartMessage(chatId) {
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: 'Генератор картинок готов. Жми кнопку ниже, всё управление внутри mini app.',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Открыть генератор', web_app: { url: getMiniAppUrl() } }
      ]]
    }
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: nowIso(), publicBaseUrl: publicBaseUrl() });
});

app.post('/telegram/webhook', async (req, res) => {
  try {
    const expected = config.telegram?.webhookSecret;
    if (expected && req.get('X-Telegram-Bot-Api-Secret-Token') !== expected) {
      console.warn('[telegram] rejected webhook: bad X-Telegram-Bot-Api-Secret-Token');
      return res.status(401).json({ error: 'Bad webhook secret' });
    }

    const update = req.body;
    const message = update.message || update.edited_message;
    const chatId = message?.chat?.id;
    const text = message?.text || '';
    console.log(`[telegram] update=${update.update_id ?? 'unknown'} chat=${chatId ?? 'unknown'} text=${JSON.stringify(text)}`);
    if (chatId && text.startsWith('/start')) {
      await sendStartMessage(chatId);
      console.log(`[telegram] sent mini app button to chat=${chatId}`);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[telegram] webhook failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/generated', express.static(generatedDir, {
  maxAge: '7d',
  fallthrough: false
}));

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/config', authMiddleware, (req, res) => {
  res.json({
    defaultSettings: DEFAULT_SETTINGS,
    publicBaseUrl: publicBaseUrl(),
    miniAppUrl: getMiniAppUrl()
  });
});

app.get('/api/comfy/resources', authMiddleware, async (req, res) => {
  try {
    res.json(await getComfyResources());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate', authMiddleware, async (req, res) => {
  try {
    const settings = normalizeSettings(req.body || {});
    const workflow = await buildWorkflow(settings);
    const clientId = crypto.randomUUID();
    const response = await comfyJson('/prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });
    const promptId = response.prompt_id;
    if (!promptId) throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(response)}`);

    const job = {
      id: promptId,
      promptId,
      clientId,
      userId: String(req.user.id),
      status: 'queued',
      progress: 0,
      settings,
      images: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    jobs.set(job.id, job);
    await upsertGeneration(job);
    startGenerationWatcher(job);
    res.json({ job: publicJob(job) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', authMiddleware, async (req, res) => {
  const db = await readDb();
  const items = db.generations
    .filter((item) => String(item.userId) === String(req.user.id))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicJob);
  res.json({ items });
});

app.get('/api/history/:id', authMiddleware, async (req, res) => {
  const item = await getGeneration(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Generation not found' });
  res.json({ item: publicJob(item) });
});

app.get('/api/comfy/image', authMiddleware, async (req, res) => {
  try {
    const url = comfyHttpUrl('/view', {
      filename: req.query.filename,
      subfolder: req.query.subfolder || '',
      type: req.query.type || 'output'
    });
    const response = await fetchWithTimeout(url);
    if (!response.ok) return res.status(response.status).send(await response.text());
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const frontendDist = resolveAppPath(config.server?.frontendDist || './frontend/dist');
if (fsSync.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
} else {
  app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="font-family: system-ui; padding: 32px"><h1>tg-comfy-miniapp backend is running</h1><p>Build frontend first: <code>npm run build</code>. In dev open Vite frontend separately.</p></body>`);
  });
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname !== '/api/ws') return socket.destroy();

  try {
    const user = config.telegram?.enforceAuth
      ? validateTelegramInitData(url.searchParams.get('initData'))
      : { id: 'dev' };
    const jobId = url.searchParams.get('jobId');
    if (!jobId) throw new Error('jobId is missing');

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      ws.user = user;
      ws.jobId = jobId;
      wsServer.emit('connection', ws, request);
    });
  } catch (error) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wsServer.on('connection', async (ws) => {
  const jobId = ws.jobId;
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId).add(ws);

  const dbItem = await getGeneration(jobId, ws.user.id);
  if (dbItem) ws.send(JSON.stringify({ type: 'job', job: publicJob(dbItem) }));

  ws.on('close', () => {
    const clients = subscribers.get(jobId);
    if (!clients) return;
    clients.delete(ws);
    if (!clients.size) subscribers.delete(jobId);
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const port = Number(config.server?.port || process.env.PORT || 8080);
const host = config.server?.host || '0.0.0.0';
server.listen(port, host, () => {
  console.log(`tg-comfy-miniapp backend listening on http://${host}:${port}`);
  console.log(`Config: ${configPath}`);
  console.log(`Public URL: ${publicBaseUrl() || '(not configured)'}`);
  console.log(`Mini App URL: ${getMiniAppUrl() || '(not configured)'}`);
  console.log(`Telegram webhook endpoint: ${publicBaseUrl() ? `${publicBaseUrl()}/telegram/webhook` : '(not configured)'}`);
  console.log(`Telegram auth validation: ${config.telegram?.enforceAuth ? 'enabled' : 'disabled'}`);
  startCloudflared();
});
