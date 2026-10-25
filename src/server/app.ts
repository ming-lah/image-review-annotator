import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Storage } from './storage.js';
import type { ApiError } from '../shared/contracts.js';
import { logger } from './logger.js';

export function createApp(storage: Pick<Storage, 'checkReady'>, clientDir?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    const requestPath = req.path;
    const logPath = ['/api/health', '/api/ready'].includes(requestPath) ? requestPath : requestPath.startsWith('/api') ? '/api/*' : '/';
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => logger.info({ event: 'request', requestId, method: req.method, path: logPath, status: res.statusCode, durationMs: Math.round(performance.now() - start), errorCode: res.locals.errorCode }));
    next();
  });
  const fail = (res: express.Response, status: number, code: string, message: string) => {
    res.locals.errorCode = code;
    const body: ApiError = { error: { code, message, requestId: res.locals.requestId as string } };
    res.status(status).json(body);
  };
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.get('/api/ready', (_req, res) => {
    try { storage.checkReady(); res.json({ status: 'ready' }); }
    catch { fail(res, 503, 'SERVICE_NOT_READY', '存储暂不可用，请稍后重试'); }
  });
  app.use('/api', (_req, res) => { fail(res, 404, 'API_NOT_FOUND', '接口不存在'); });
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get('/', (_req, res) => { res.sendFile(path.join(clientDir, 'index.html')); });
  }
  app.use((_req, res) => { fail(res, 404, 'NOT_FOUND', '资源不存在'); });
  const errorHandler: ErrorRequestHandler = (_error, _req, res, _next) => {
    void _next;
    logger.error({ event: 'request_failed', requestId: res.locals.requestId, errorCode: 'INTERNAL_ERROR' });
    fail(res, 500, 'INTERNAL_ERROR', '服务内部错误');
  };
  app.use(errorHandler);
  return app;
}
