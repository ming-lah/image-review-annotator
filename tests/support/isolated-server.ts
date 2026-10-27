import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { openAccountStore } from '../../src/server/account-store.js';
import { hashPassword } from '../../src/server/passwords.js';
import { authenticatedUserSchema, type AuthenticatedUser } from '../../src/shared/auth-contracts.js';
import { testActor } from './auth-fixtures.js';

export const fixturePassword = 'isolated-test-password-123';
let hash: Promise<string> | undefined;
export interface ServerClient { user: AuthenticatedUser; fetch: typeof fetch }
export interface ServerFixture extends ServerClient { base: string; restart(): Promise<void>; logs(): string; signIn(username: string, userId?: string): Promise<ServerClient> }

export async function withIsolatedServer<T>(run: (server: ServerFixture) => Promise<T>, production = false): Promise<T> {
  const temporaryRoot = path.resolve('tests/.tmp'); fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, 'isolated-'));
  function cleanup() {
    if (!path.resolve(dataDir).startsWith(temporaryRoot + path.sep)) throw new Error('Unsafe test cleanup target');
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  try { return await withServerInDirectory(dataDir, run, production); }
  finally { cleanup(); }
}

export async function withServerInDirectory<T>(dataDir: string, run: (server: ServerFixture) => Promise<T>, production = false): Promise<T> {
  const temporaryRoot = path.resolve('tests/.tmp');
  if (!path.resolve(dataDir).startsWith(temporaryRoot + path.sep)) throw new Error('Test data directory must stay inside tests/.tmp');
  const reservation = net.createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const passwordHash = await (hash ??= hashPassword(fixturePassword));
  function provision(username: string, userId: string) {
    const store = openAccountStore(dataDir, true);
    try {
      const loginName = 't' + userId;
      if (!store.accounts.credential(loginName)) {
        const now = new Date().toISOString();
        store.db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?)').run(userId, username, now, now);
        store.accounts.create({ loginName, username, userId, role: 'admin', passwordHash });
      }
      return loginName;
    } finally { store.close(); }
  }
  provision(testActor.actorName, testActor.actorId);
  async function signIn(username: string, userId = crypto.randomUUID() as string): Promise<ServerClient> {
    const loginName = provision(username, userId);
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName, password: fixturePassword }) });
    if (!response.ok) throw new Error('Test account login failed: ' + response.status);
    const user = authenticatedUserSchema.parse(await response.json());
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const authenticatedFetch: typeof fetch = (input, init = {}) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(target).origin !== base) throw new Error('Test authentication cannot leave its isolated server');
      const headers = new Headers(init.headers); headers.set('Cookie', cookie); headers.set('Origin', base); headers.set('X-Expected-User-Id', user.userId);
      return fetch(input, { ...init, headers });
    };
    return { user, fetch: authenticatedFetch };
  }
  let child: ChildProcess | undefined; let exited: Promise<void> = Promise.resolve(); let logs = '';
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send('shutdown'); else child.kill('SIGTERM');
    const timer = setTimeout(() => child?.kill('SIGKILL'), 5000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  async function start() {
    child = spawn(process.execPath, production ? ['dist/server/server.js'] : ['--import', 'tsx', 'src/server/server.ts'], {
      cwd: process.cwd(), env: { ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: base, NODE_ENV: production ? 'production' : 'development' },
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
  try { await start(); const client = await signIn(testActor.actorName, testActor.actorId); return await run({ base, ...client, signIn, restart: async () => { await stop(); await start(); }, logs: () => logs }); }
  finally {
    await stop();
  }
}
