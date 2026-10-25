import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { afterAll } from 'vitest';

const temporaryRoot = path.resolve('tests/.tmp');
const ownedDirectories = new Set<string>();
const ownedProcesses = new Set<{ stop(): Promise<void> }>();

afterAll(async () => {
  for (const proc of ownedProcesses) await proc.stop();
  for (const directory of ownedDirectories) {
    if (!directory.startsWith(temporaryRoot + path.sep)) throw new Error('Test cleanup target outside tests/.tmp');
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  ownedDirectories.clear();
  ownedProcesses.clear();
});

export function tempDir() {
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'run-'));
  ownedDirectories.add(directory);
  return directory;
}
export async function freePort() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
export function launch(args: string[], env: NodeJS.ProcessEnv = {}, cwd = process.cwd()) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  const proc = {
    child, exited, output: () => output,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (child.connected) child.send('shutdown');
      else child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
  ownedProcesses.add(proc);
  return proc;
}
export async function waitFor(url: string, processOutput: () => string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* wait for listener */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Listener did not become ready: ${processOutput()}`);
}
