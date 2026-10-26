import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { readConfig, StartupError } from './config.js';
import { openStorage } from './storage.js';
import { logger } from './logger.js';

let storage: ReturnType<typeof openStorage> | undefined;
let stage = 'CONFIG';
try {
  const config = readConfig();
  stage = 'STORAGE';
  storage = openStorage(config.dataDir);
  stage = 'LISTEN';
  const app = createApp(storage, process.env.NODE_ENV === 'production' ? fileURLToPath(new URL('../client/', import.meta.url)) : undefined);
  const server = app.listen(config.port, config.host);
  server.once('error', (error: NodeJS.ErrnoException) => {
    storage?.close();
    logger.error({ event: 'startup_failed', errorCode: error.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'LISTEN_FAILED', host: config.host, port: config.port, message: error.code === 'EADDRINUSE' ? `API port ${config.port} is already in use. Set PORT to an available port.` : 'Cannot listen. Check HOST, PORT and network permissions.' });
    process.exitCode = 1;
    process.disconnect?.();
  });
  server.once('listening', () => logger.info({ event: 'started', host: config.host, port: config.port }));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    app.locals.closeReviewEvents();
    const deadline = setTimeout(() => { server.closeAllConnections(); }, 3000);
    deadline.unref();
    server.close(() => { clearTimeout(deadline); storage?.close(); logger.info({ event: 'stopped' }); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('disconnect', shutdown);
  // Dev supervisor uses IPC on Windows, where kill(SIGTERM) is not graceful.
  process.on('message', message => { if (message === 'shutdown') { shutdown(); process.disconnect?.(); } });
} catch (error) {
  storage?.close();
  logger.error({ event: 'startup_failed', errorCode: error instanceof StartupError ? error.code : `${stage}_FAILED`, message: error instanceof StartupError ? error.message : 'Storage initialization failed. Check directory permissions, database and migrations.' });
  process.exitCode = 1;
}
