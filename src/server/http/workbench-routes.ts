import { Router, json } from 'express';
import { z } from 'zod';
import type { Storage } from '../storage.js';
import { workbenchRepository } from '../persistence/workbench-repository.js';
import { saveReviewSchema } from '../../shared/workbench-contracts.js';
import { uuidSchema } from '../../shared/review-contracts.js';
import { parseInput } from './errors.js';
import type { ReviewEvents } from './review-events.js';
import { currentUser, authenticatedBody } from './auth.js';

const querySchema = z.object({ q: z.string().max(255).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), sort: z.enum(['updated', 'created', 'name']).default('updated') });
export function workbenchRoutes(storage: Storage, events: ReviewEvents) {
  const router = Router(); const repository = workbenchRepository(storage.db);
  router.use(json({ limit: '2mb' }));
  router.get('/images', (req, res) => { const value = parseInput(querySchema, req.query); res.json(repository.library(value.q, value.page, value.sort)); });
  router.get('/images/:id', (req, res) => { const id = parseInput(uuidSchema, req.params.id); res.locals.imageId = id; res.json(repository.detail(id)); });
  router.post('/images/:id/saves', (req, res) => {
    storage.checkReady(); const id = parseInput(uuidSchema, req.params.id); const value = parseInput(saveReviewSchema, authenticatedBody(req.body, currentUser(res)));
    res.locals.imageId = id; res.locals.actorId = value.userId;
    const result = repository.save(id, value);
    if (result.created) events.publish({ type: 'image.changed', imageId: id, revisionId: result.detail.revision.id });
    res.json(result);
  });
  router.get('/images/:id/history', (req, res) => {
    const id = parseInput(uuidSchema, req.params.id); const value = parseInput(querySchema, req.query); res.locals.imageId = id; res.json(repository.history(id, value.page));
  });
  router.get('/images/:id/history/:revisionId', (req, res) => {
    const id = parseInput(uuidSchema, req.params.id); const revisionId = parseInput(uuidSchema, req.params.revisionId); res.locals.imageId = id; res.json(repository.historical(id, revisionId));
  });
  return router;
}
