import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

export async function withIsolatedServer<T>(run: (server: { base: string; restart(): Promise<void>; logs(): string }) => Promise<T>, production = false): Promise<T> {
  const temporaryRoot = path.resolve('tests/.tmp'); fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'isolated-'));
  function cleanup() {
    if (!path.resolve(dataDir).startsWith(temporaryRoot + path.sep)) throw new Error('Unsafe test cleanup target');
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  try { return await withServerInDirectory(dataDir, run, production); }
  finally { cleanup(); }
}

export async function withServerInDirectory<T>(dataDir: string, run: (server: { base: string; restart(): Promise<void>; logs(): string }) => Promise<T>, production = false): Promise<T> {
  const temporaryRoot = path.resolve('tests/.tmp');
  if (!path.resolve(dataDir).startsWith(temporaryRoot + path.sep)) throw new Error('Test data directory must stay inside tests/.tmp');
  const reservation = net.createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined; let exited: Promise<void> = Promise.resolve(); let logs = '';
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send('shutdown'); else child.kill('SIGTERM');
    const timer = setTimeout(() => child?.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  async function start() {
    child = spawn(process.execPath, production ? ['dist/server/server.js'] : ['--import', 'tsx', 'src/server/server.ts'], {
      cwd: process.cwd(), env: { ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: production ? 'production' : 'development' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    });
    child.stdout?.on('data', chunk => { logs += String(chunk); }); child.stderr?.on('data', chunk => { logs += String(chunk); });
    exited = new Promise(resolve => child!.once('exit', () => resolve()));
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated test server exited before readiness');
      try { if ((await fetch(`${base}/api/ready`)).ok) return; } catch { /* listener is not ready */ }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error('Isolated test server readiness timed out');
  }
  try { await start(); return await run({ base, restart: async () => { await stop(); await start(); }, logs: () => logs }); }
  finally {
    await stop();
  }
}
