import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const required = ['../dist/server/server.js', '../dist/client/index.html', '../dist/migrations/001-initialize.sql'];
if (required.some(file => !existsSync(fileURLToPath(new URL(file, import.meta.url))))) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'startup_failed', errorCode: 'BUILD_MISSING', message: '缺少构建产物，请先执行 npm run build' }));
  process.exitCode = 1;
} else {
  process.env.NODE_ENV = 'production';
  await import('../dist/server/server.js');
}
