import { Router, json } from 'express';
import { z } from 'zod';
import type { Storage } from '../storage.js';
import { usersRepository } from '../persistence/users.js';
import { workbenchRepository } from '../persistence/workbench-repository.js';
import { enterSchema, saveReviewSchema } from '../../shared/workbench-contracts.js';
import { uuidSchema } from '../../shared/review-contracts.js';
import { parseInput } from './errors.js';

const querySchema = z.object({ q: z.string().max(255).default(''), page: z.coerce.number().int().min(1).max(100000).default(1), sort: z.enum(['updated', 'created', 'name']).default('updated') });
export function workbenchRoutes(storage: Storage) {
  const router = Router(); const users = usersRepository(storage.db); const repository = workbenchRepository(storage.db);
  router.use(json({ limit: '2mb' }));
  router.post('/users/enter', (req, res) => {
    storage.checkReady(); const value = parseInput(enterSchema, req.body); const user = users.enter(value.username, value.userId);
    res.locals.actorId = user.userId; res.json(user);
  });
  router.get('/images', (req, res) => { const value = parseInput(querySchema, req.query); res.json(repository.library(value.q, value.page, value.sort)); });
  router.get('/images/:id', (req, res) => { const id = parseInput(uuidSchema, req.params.id); res.locals.imageId = id; res.json(repository.detail(id)); });
  router.post('/images/:id/saves', (req, res) => {
    storage.checkReady(); const id = parseInput(uuidSchema, req.params.id); const value = parseInput(saveReviewSchema, req.body);
    res.locals.imageId = id; res.locals.actorId = value.userId; res.json(repository.save(id, value));
  });
  router.get('/images/:id/history', (req, res) => {
    const id = parseInput(uuidSchema, req.params.id); const value = parseInput(querySchema, req.query); res.locals.imageId = id; res.json(repository.history(id, value.page));
  });
  router.get('/images/:id/history/:revisionId', (req, res) => {
    const id = parseInput(uuidSchema, req.params.id); const revisionId = parseInput(uuidSchema, req.params.revisionId); res.locals.imageId = id; res.json(repository.historical(id, revisionId));
  });
  return router;
}
