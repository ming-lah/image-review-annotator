import { Router } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import { Transform, type Writable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage.js';
import { reviewRepository } from '../persistence/review-repository.js';
import { workbenchRepository } from '../persistence/workbench-repository.js';
import { legacyUserId, usersRepository } from '../persistence/users.js';
import { validateImage } from '../persistence/image-files.js';
import { ApiFailure, parseInput } from './errors.js';
import { imageManagement } from '../persistence/image-management.js';
import { deleteImageSchema } from '../../shared/workbench-contracts.js';
import { createAnnotationSchema, deleteAnnotationSchema, updateAnnotationSchema, uuidSchema } from '../../shared/review-contracts.js';
import type { ReviewEvents } from './review-events.js';
import { logger } from '../logger.js';

export function reviewRoutes(storage: Storage, events: ReviewEvents) {
  const router = Router();
  const history = workbenchRepository(storage.db);
  const repository = reviewRepository(storage.db, (imageId, actor) => history.capture(imageId, actor));
  const management = imageManagement(storage.db);
  const changed = (imageId: string) => {
    try { events.publish({ type: 'image.changed', imageId, revisionId: history.detail(imageId).revision.id }); }
    catch { logger.warn({ event: 'update_notification_failed', imageId }); }
  };
  const options: multer.Options & { streamHandler(req: Request, busboy: Writable): void } = {
    storage: multer.diskStorage({
      destination: (_req, _file, done) => { try { storage.files.check(); done(null, storage.files.uploads); } catch (error) { done(error as Error, ''); } },
      filename: (_req, _file, done) => done(null, `${randomUUID()}.upload`),
    }),
    defParamCharset: 'utf8',
    limits: { files: 1, fields: 1, parts: 2, fieldSize: 36, fieldNameSize: 20, fileSize: 20 * 1024 * 1024 },
    streamHandler(req, busboy) {
      let bytes = 0;
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        done(bytes > 21 * 1024 * 1024 ? new ApiFailure(413, 'REQUEST_TOO_LARGE', '上传请求过大') : null, chunk);
      } });
      limiter.on('error', error => { req.unpipe(limiter); req.resume(); busboy.destroy(error); });
      busboy.on('close', () => { req.unpipe(limiter); limiter.destroy(); });
      req.pipe(limiter).pipe(busboy);
    },
  };
  const upload = multer(options).single('file');
  router.post('/images', (req, res, next) => upload(req, res, error => {
    if (!error || error instanceof ApiFailure || error instanceof multer.MulterError || (error as NodeJS.ErrnoException).code) next(error);
    else next(new ApiFailure(400, 'INVALID_REQUEST', '上传请求格式无效'));
  }), async (req, res) => {
    const file = req.file;
    if (!file) throw new ApiFailure(400, 'IMAGE_INVALID', '请选择一张图片');
    let installed: string | undefined;
    try {
      if (Object.keys(req.body as object).some(key => key !== 'id')) throw new ApiFailure(400, 'INVALID_REQUEST', '上传字段无效');
      const id = parseInput(uuidSchema, (req.body as { id?: unknown }).id);
      res.locals.imageId = id;
      management.requireLiveId(id);
      const originalName = [...path.win32.basename(path.posix.basename(file.originalname))].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').slice(0, 255);
      const validated = await validateImage(storage.files.tempPath(file.filename), originalName, file.mimetype);
      storage.checkReady();
      management.requireLiveId(id);
      const previous = repository.image(id);
      if (previous) {
        if (previous.sha256 !== validated.sha256 || previous.originalName !== originalName) throw new ApiFailure(409, 'IMAGE_ID_CONFLICT', '该上传请求编号已用于不同图片');
        // A successful retry must not hide an externally missing original.
        const existing = storage.files.contentPath(repository.storageKey(id));
        if (!fs.existsSync(existing)) throw new ApiFailure(404, 'IMAGE_FILE_MISSING', '图片原文件缺失，请检查数据目录');
        res.json(previous);
        return;
      }
      installed = storage.files.install(file.filename, id, validated.ext);
      const now = new Date().toISOString();
      const image = { id, originalName, mimeType: validated.mimeType, width: validated.width, height: validated.height, fileSize: validated.fileSize, sha256: validated.sha256, createdAt: now, updatedAt: now };
      const userId = req.header('x-user-id') ? parseInput(uuidSchema, req.header('x-user-id')) : legacyUserId;
      usersRepository(storage.db).requireUser(userId);
      storage.db.transaction(() => { management.requireLiveId(id); repository.insertImage(image, installed!); history.initialize(id, userId); }).immediate();
      installed = undefined;
      changed(id);
      res.status(201).json(image);
    } finally {
      if (installed) storage.files.rollback(installed, res.locals.requestId as string);
      storage.files.removeTemp(file.filename, res.locals.requestId as string);
    }
  });
  router.get('/images/:id', (req, res) => {
    const id = parseInput(uuidSchema, req.params.id);
    res.locals.imageId = id;
    res.json(repository.detail(id));
  });
  router.delete('/images/:id', (req, res) => {
    storage.checkReady();
    const id = parseInput(uuidSchema, req.params.id); const value = parseInput(deleteImageSchema, req.body);
    Object.assign(res.locals, { imageId: id, actorId: value.userId });
    // Validate the file boundary before committing a logical deletion, even if the original is missing.
    storage.files.contentPath(repository.storageKey(id));
    const key = management.remove(id, value);
    events.publish({ type: 'image.deleted', imageId: id });
    storage.files.removeImage(key, res.locals.requestId as string);
    res.sendStatus(204);
  });
  router.get('/images/:id/content', (req, res, next) => {
    const id = parseInput(uuidSchema, req.params.id);
    res.locals.imageId = id;
    const image = repository.requireImage(id);
    const file = storage.files.contentPath(repository.storageKey(id));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mimeType).sendFile(file, { dotfiles: 'allow' }, error => {
      if (!error) return;
      next((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as { status?: number }).status === 404 ? new ApiFailure(404, 'IMAGE_FILE_MISSING', '图片原文件缺失，请检查数据目录') : error);
    });
  });
  router.post('/images/:id/annotations', (req, res) => {
    storage.checkReady();
    const imageId = parseInput(uuidSchema, req.params.id);
    const value = parseInput(createAnnotationSchema, req.body);
    Object.assign(res.locals, { imageId, annotationId: value.id, actorId: value.actorId });
    const result = repository.create(imageId, value);
    if (result.created) changed(imageId);
    res.status(result.created ? 201 : 200).json(result.annotation);
  });
  router.patch('/annotations/:id', (req, res) => {
    storage.checkReady();
    const id = parseInput(uuidSchema, req.params.id);
    const value = parseInput(updateAnnotationSchema, req.body);
    Object.assign(res.locals, { annotationId: id, actorId: value.actorId });
    const result = repository.update(id, value);
    changed(result.imageId);
    res.json(result);
  });
  router.delete('/annotations/:id', (req, res) => {
    storage.checkReady();
    const id = parseInput(uuidSchema, req.params.id);
    const value = parseInput(deleteAnnotationSchema, req.body);
    Object.assign(res.locals, { annotationId: id, actorId: value.actorId });
    const imageId = repository.requireAnnotation(id).imageId;
    repository.remove(id, value);
    changed(imageId);
    res.sendStatus(204);
  });
  return router;
}
