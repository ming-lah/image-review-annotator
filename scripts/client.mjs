import { createServer } from 'vite';
const log = (level, fields) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields }));

const portText = process.env.VITE_PORT ?? '5173';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
  log('error', { event: 'startup_failed', errorCode: 'INVALID_VITE_PORT', message: 'VITE_PORT 必须为 1–65535 的整数' });
  process.exitCode = 1;
  process.disconnect?.();
} else {
  let server;
  try {
    server = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', strictPort: true } });
    await server.listen();
    log('info', { event: 'client_started', host: '127.0.0.1', port: Number(portText) });
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await server.close();
      log('info', { event: 'client_stopped' });
      process.disconnect?.();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('message', message => { if (message === 'shutdown') void stop(); });
  } catch (error) {
    await server?.close();
    log('error', { event: 'startup_failed', errorCode: error.message.includes('Port') ? 'FRONTEND_PORT_IN_USE' : 'FRONTEND_START_FAILED', message: '前端启动失败，请检查 VITE_PORT、配置和依赖' });
    process.exitCode = 1;
    process.disconnect?.();
  }
}
