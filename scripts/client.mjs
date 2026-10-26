import { createServer } from 'vite';
const log = (level, fields) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields }));

const portText = process.env.VITE_PORT ?? '5174';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
  log('error', { event: 'startup_failed', errorCode: 'INVALID_VITE_PORT', message: 'VITE_PORT must be an integer between 1 and 65535' });
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
    process.on('disconnect', () => { void stop(); });
    process.on('message', message => { if (message === 'shutdown') void stop(); });
  } catch (error) {
    await server?.close();
    log('error', { event: 'startup_failed', errorCode: error.message.includes('Port') ? 'FRONTEND_PORT_IN_USE' : 'FRONTEND_START_FAILED', port: Number(portText), message: 'Frontend startup failed. Check VITE_PORT, configuration and dependencies.' });
    process.exitCode = 1;
    process.disconnect?.();
  }
}
