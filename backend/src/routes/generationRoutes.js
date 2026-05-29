import express from 'express';
import { asyncRoute } from '../utils/errors.js';
import { publicJob } from '../jobs/jobService.js';

export function createGenerationRouter({ authMiddleware, defaultSettings, normalizeSettings, jobService }) {
  const router = express.Router();

  router.post('/generate', authMiddleware, asyncRoute(async (req, res) => {
    const settings = normalizeSettings(req.body || {}, defaultSettings);
    const job = await jobService.createJob({ userId: req.user.id, settings });
    res.json({ job: publicJob(job, jobService.getQueuePosition(job.id)) });
  }));

  router.post('/jobs/:id/cancel', authMiddleware, asyncRoute(async (req, res) => {
    const job = await jobService.cancelJob(req.params.id, req.user.id);
    res.json({ job: publicJob(job, jobService.getQueuePosition(job.id)) });
  }));

  return router;
}
