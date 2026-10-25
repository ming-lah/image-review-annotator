import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { launch, tempDir, waitFor, freePort } from '../support/helpers.js';

async function listen(port: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
async function assertFree(port: number) {
  const server = await listen(port);
  await new Promise<void>(resolve => server.close(() => resolve()));
}
describe('development supervisor', () => {
  it('uses API 3002 and frontend 5174 by default, including the API proxy', async () => {
    const proc = launch(['scripts/dev.mjs'], { DATA_DIR: tempDir(), PORT: undefined, VITE_PORT: undefined, HOST: '127.0.0.1', NODE_ENV: 'development' });
    try {
      await waitFor('http://127.0.0.1:5174/api/ready', proc.output);
      expect(await (await fetch('http://127.0.0.1:5174/api/ready')).json()).toEqual({ status: 'ready' });
      expect(await (await fetch('http://127.0.0.1:3002/api/health')).json()).toEqual({ status: 'ok' });
    } finally { await proc.stop(); }
    expect(await proc.exited).toBe(0);
    await assertFree(3002);
    await assertFree(5174);
  });
  it('serves page and proxied ready, stops both children and releases ports', async () => {
    const apiPort = await freePort();
    const uiPort = await freePort();
    const proc = launch(['scripts/dev.mjs'], { DATA_DIR: tempDir(), PORT: String(apiPort), VITE_PORT: String(uiPort), HOST: '127.0.0.1', NODE_ENV: 'development' });
    try {
      await waitFor(`http://127.0.0.1:${uiPort}/api/ready`, proc.output);
      expect(await (await fetch(`http://127.0.0.1:${uiPort}/`)).text()).toContain('/main.ts');
    } finally { await proc.stop(); }
    expect(await proc.exited).toBe(0);
    expect(proc.output()).toContain('stopped');
    await assertFree(apiPort);
    await assertFree(uiPort);
  });
  it.each(['api', 'ui'])('exits nonzero and releases the other child when %s port is occupied', async target => {
    const apiPort = await freePort();
    const uiPort = await freePort();
    const port = target === 'api' ? apiPort : uiPort;
    const blocker = await listen(port);
    const proc = launch(['scripts/dev.mjs'], { DATA_DIR: tempDir(), PORT: String(apiPort), VITE_PORT: String(uiPort), HOST: '127.0.0.1', NODE_ENV: 'development' });
    try {
      const timeout = setTimeout(() => { void proc.stop(); }, 10000);
      const code = await proc.exited;
      clearTimeout(timeout);
      expect(code).toBe(1);
      expect(proc.output()).toContain(target === 'api' ? 'PORT_IN_USE' : 'FRONTEND_PORT_IN_USE');
      expect(proc.output()).not.toContain(process.cwd());
      expect([...proc.output()].every(character => character.charCodeAt(0) < 128)).toBe(true);
    } finally {
      await proc.stop();
      await new Promise<void>(resolve => blocker.close(() => resolve()));
    }
    await assertFree(apiPort);
    await assertFree(uiPort);
  });
});
