import express from 'express';
import { publicBaseUrl, miniAppUrl } from '../config/loadConfig.js';
import { asyncRoute } from '../utils/errors.js';

function nowIso() {
  return new Date().toISOString();
}

export function createSystemRouter({ config, defaultSettings, workflowBuilder, authMiddleware }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({ ok: true, time: nowIso(), publicBaseUrl: publicBaseUrl(config) });
  });

  router.get('/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });

  router.get('/config', authMiddleware, (req, res) => {
    res.json({
      defaultSettings,
      workflowTypes: workflowBuilder.listWorkflowTypes(),
      publicBaseUrl: publicBaseUrl(config),
      miniAppUrl: miniAppUrl(config),
      limits: {
        maxConcurrentGlobal: Number(config.jobs?.maxConcurrentGlobal || 1),
        maxQueuePerUser: Number(config.jobs?.maxQueuePerUser || 3)
      }
    });
  });

  return router;
}

export function createComfyRouter({ authMiddleware, resourcesService }) {
  const router = express.Router();

  router.get('/resources', authMiddleware, asyncRoute(async (req, res) => {
    res.json(await resourcesService.getResources({ refresh: req.query.refresh === '1' }));
  }));

  return router;
}

export function createPresetsRouter({ authMiddleware, presetsService }) {
  const router = express.Router();

  router.get('/', authMiddleware, asyncRoute(async (req, res) => {
    const presets = await presetsService.listPresets({ refresh: req.query.refresh === '1' });
    res.json({ presets, warning: presetsService.warning });
  }));

  return router;
}
