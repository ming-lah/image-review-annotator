import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Storage } from './storage.js';
import type { ApiError } from '../shared/contracts.js';
import { logger } from './logger.js';
import multer from 'multer';
import { ApiFailure } from './http/errors.js';
import { reviewRoutes } from './http/review-routes.js';
import { workbenchRoutes } from './http/workbench-routes.js';
import { createReviewEvents } from './http/review-events.js';
import { authRepository } from './persistence/auth.js';
import { createAuth, currentUser, requestToken } from './http/auth.js';
import { readAuthConfig, type AuthOptions } from './config.js';

export function createApp(storage: Pick<Storage, 'checkReady'> & Partial<Pick<Storage, 'db' | 'files'>>, clientDir?: string, authOptions: AuthOptions = readAuthConfig({})) {
  const app = express();
  const events = createReviewEvents();
  app.locals.closeReviewEvents = events.close;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    const requestPath = req.path;
    const logPath = ['/api/health', '/api/ready'].includes(requestPath) ? requestPath : requestPath.startsWith('/api') ? '/api/*' : '/';
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => logger.info({ event: 'request', requestId, method: req.method, path: logPath, status: res.statusCode, durationMs: Math.round(performance.now() - start), errorCode: res.locals.errorCode, imageId: res.locals.imageId, annotationId: res.locals.annotationId, actorId: res.locals.actorId }));
    next();
  });
  const fail = (res: express.Response, status: number, code: string, message: string) => {
    res.locals.errorCode = code;
    const body: ApiError = { error: { code, message, requestId: res.locals.requestId as string } };
    res.status(status).type('json').json(body);
  };
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/api/ready', (_req, res) => {
    try { storage.checkReady(); res.json({ status: 'ready' }); }
    catch { fail(res, 503, 'SERVICE_NOT_READY', '存储暂不可用，请稍后重试'); }
  });
  if (storage.db && storage.files) {
    const accounts = authRepository(storage.db);
    const auth = createAuth(accounts, authOptions);
    app.use('/api/auth', auth.router);
    app.post('/api/workbench/users/enter', () => { throw new ApiFailure(410, 'LOGIN_REQUIRED', '昵称入口已停用，请使用账号和密码登录'); });
    app.use('/api', auth.guard);
    app.get('/api/events', (req, res) => {
      storage.checkReady(); const token = requestToken(req); const userId = currentUser(res).userId;
      events.connect(res, () => accounts.current(token)?.userId === userId);
    });
    app.use('/api/workbench', workbenchRoutes(storage as Storage, events));
  }
  app.use('/api', express.json({ limit: '32kb' }));
  if (storage.db && storage.files) app.use('/api', reviewRoutes(storage as Storage, events));
  app.use('/api', (_req, res) => { fail(res, 404, 'API_NOT_FOUND', '接口不存在'); });
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get('/', (_req, res) => { res.sendFile(path.join(clientDir, 'index.html')); });
  }
  app.use((_req, res) => { fail(res, 404, 'NOT_FOUND', '资源不存在'); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next;
    if (res.headersSent) { res.end(); return; }
    if (error instanceof ApiFailure) { fail(res, error.status, error.code, error.message); return; }
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      fail(res, tooLarge ? 413 : 400, tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_REQUEST', tooLarge ? '图片不能超过 20 MiB' : '上传字段或文件数量无效'); return;
    }
    const details = error as { code?: string; type?: string } | null;
    const code = typeof details?.code === 'string' ? details.code : '';
    if (details?.type === 'entity.too.large') { fail(res, 413, 'REQUEST_TOO_LARGE', '请求内容过大'); return; }
    if (details?.type === 'entity.parse.failed' || details?.code === 'ERR_STREAM_PREMATURE_CLOSE') { fail(res, 400, 'INVALID_REQUEST', '请求内容无效'); return; }
    if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) { fail(res, 503, 'DATABASE_BUSY', '数据库繁忙，请稍后重试'); return; }
    if (['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'ENOTDIR', 'EEXIST', 'SQLITE_READONLY', 'SQLITE_FULL', 'SQLITE_IOERR'].some(prefix => code.startsWith(prefix))) { fail(res, 503, 'STORAGE_UNAVAILABLE', '存储暂不可用，请检查数据目录'); return; }
    logger.error({ event: 'request_failed', requestId: res.locals.requestId, errorCode: 'INTERNAL_ERROR' });
    fail(res, 500, 'INTERNAL_ERROR', '服务内部错误');
  };
  app.use(errorHandler);
  return app;
}
