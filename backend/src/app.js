import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import express from 'express';

import { loadRuntimeConfig, publicBaseUrl, miniAppUrl } from './config/loadConfig.js';
import { JsonGenerationRepository } from './storage/jsonGenerationRepository.js';
import { createDefaultSettings, normalizeSettings } from './settings/defaultSettings.js';
import { PresetsService } from './settings/presetsService.js';
import { createAuthMiddleware } from './telegram/auth.js';
import { TelegramBotApi } from './telegram/botApi.js';
import { createTelegramWebhookRouter } from './telegram/webhookRoutes.js';
import { ComfyClient } from './comfy/comfyClient.js';
import { ResourcesService } from './comfy/resourcesService.js';
import { WorkflowBuilder } from './comfy/workflowBuilder.js';
import { ComfyImageDownloader } from './comfy/images.js';
import { JobService, publicJob } from './jobs/jobService.js';
import { JobWebSocketHub } from './jobs/wsHub.js';
import { CloudflaredService } from './cloudflare/cloudflaredService.js';
import { createSystemRouter, createComfyRouter, createPresetsRouter } from './routes/systemRoutes.js';
import { createGenerationRouter } from './routes/generationRoutes.js';
import { createHistoryRouter } from './routes/historyRoutes.js';

export async function createApp() {
  const runtime = await loadRuntimeConfig();
  const { config, generatedDir, dbPath, frontendDist, presetsFile } = runtime;

  await fs.mkdir(generatedDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  const defaultSettings = createDefaultSettings(config);
  const repository = new JsonGenerationRepository({
    dbPath,
    maxHistoryPerUser: config.storage?.maxHistoryPerUser || 200,
    flushDelayMs: config.storage?.flushDelayMs || 250
  });
  await repository.init();
  await repository.markNonTerminalAsFailed();

  const authMiddleware = createAuthMiddleware(config);
  const telegramBotApi = new TelegramBotApi({ config });
  const comfyClient = new ComfyClient({
    httpUrl: config.comfy?.httpUrl,
    wsUrl: config.comfy?.wsUrl,
    requestTimeoutMs: config.comfy?.requestTimeoutMs
  });
  const workflowBuilder = new WorkflowBuilder({ config, resolveAppPath: runtime.resolveAppPath });
  const resourcesService = new ResourcesService({ comfyClient, config });
  const imageDownloader = new ComfyImageDownloader({ comfyClient, generatedDir });
  const presetsService = new PresetsService({ presetsFile, defaultSettings });

  let jobService;
  const wsHub = new JobWebSocketHub({
    config,
    repository,
    publicJob: (job) => jobService ? publicJob(job, jobService.getQueuePosition(job.id)) : publicJob(job)
  });

  jobService = new JobService({
    config,
    repository,
    workflowBuilder,
    comfyClient,
    imageDownloader,
    wsHub
  });

  const cloudflaredService = new CloudflaredService({
    config,
    appRoot: runtime.appRoot,
    resolveAppPath: runtime.resolveAppPath,
    boolFromConfig: runtime.boolFromConfig
  });

  app.use('/telegram', createTelegramWebhookRouter({ config, telegramBotApi }));
  app.use('/api', createSystemRouter({ config, defaultSettings, workflowBuilder, authMiddleware }));
  app.use('/api/comfy', createComfyRouter({ authMiddleware, resourcesService }));
  app.use('/api/presets', createPresetsRouter({ authMiddleware, presetsService }));
  app.use('/api', createGenerationRouter({ authMiddleware, defaultSettings, normalizeSettings, jobService }));
  app.use('/api/history', createHistoryRouter({ authMiddleware, repository, generatedDir }));

  // Backward compatibility for images stored by older versions. New images are served through authenticated /api/history/:id/images/:filename.
  app.use('/generated', express.static(generatedDir, { maxAge: '7d', fallthrough: false }));

  if (fsSync.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
  } else {
    app.get('/', (req, res) => {
      res.type('html').send('<!doctype html><meta charset="utf-8"><body style="font-family: system-ui; padding: 32px"><h1>tg-comfy-miniapp backend is running</h1><p>Build frontend first: <code>npm run build</code>. In dev open Vite frontend separately.</p></body>');
    });
  }

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return {
    app,
    runtime,
    services: {
      repository,
      wsHub,
      cloudflaredService
    },
    logStartup() {
      console.log(`tg-comfy-miniapp backend listening on http://${runtime.host}:${runtime.port}`);
      console.log(`Config: ${runtime.configPath}`);
      console.log(`Public URL: ${publicBaseUrl(config) || '(not configured)'}`);
      console.log(`Mini App URL: ${miniAppUrl(config) || '(not configured)'}`);
      console.log(`Telegram webhook endpoint: ${publicBaseUrl(config) ? `${publicBaseUrl(config)}/telegram/webhook` : '(not configured)'}`);
      console.log(`Telegram auth validation: ${config.telegram?.enforceAuth ? 'enabled' : 'disabled'}`);
      console.log(`Job queue: maxConcurrentGlobal=${config.jobs?.maxConcurrentGlobal || 1}, maxQueuePerUser=${config.jobs?.maxQueuePerUser || 3}`);
    }
  };
}
