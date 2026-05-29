import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { asyncRoute, httpError } from '../utils/errors.js';
import { publicJob } from '../jobs/jobService.js';

export function createHistoryRouter({ authMiddleware, repository, generatedDir }) {
  const router = express.Router();

  router.get('/', authMiddleware, asyncRoute(async (req, res) => {
    const items = await repository.listGenerations(req.user.id, {
      favorite: req.query.favorite === '1' ? true : undefined,
      status: req.query.status || undefined,
      search: req.query.search || undefined
    });
    res.json({ items: items.map((item) => publicJob(item)) });
  }));

  router.get('/:id', authMiddleware, asyncRoute(async (req, res) => {
    const item = await repository.getGeneration(req.params.id, req.user.id);
    if (!item) throw httpError(404, 'Generation not found');
    res.json({ item: publicJob(item) });
  }));

  router.post('/:id/favorite', authMiddleware, asyncRoute(async (req, res) => {
    const item = await repository.toggleFavorite(req.params.id, req.user.id, req.body?.favorite);
    if (!item) throw httpError(404, 'Generation not found');
    res.json({ item: publicJob(item) });
  }));

  router.get('/:id/images/:filename', authMiddleware, asyncRoute(async (req, res) => {
    const found = await repository.findImageForUser(req.params.id, req.user.id, req.params.filename);
    if (!found) throw httpError(404, 'Image not found');

    const filePath = path.join(generatedDir, req.params.id, found.image.localName || req.params.filename);
    const resolvedBase = path.resolve(generatedDir, req.params.id);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedBase)) throw httpError(400, 'Bad image path');

    const buffer = await fs.readFile(resolvedFile);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.send(buffer);
  }));

  return router;
}
