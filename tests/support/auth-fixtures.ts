import rawRequest from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import type { Storage } from '../../src/server/storage.js';
import { authRepository } from '../../src/server/persistence/auth.js';
import { sessionCookie } from '../../src/server/http/auth.js';
import type { AuthenticatedUser } from '../../src/shared/auth-contracts.js';

export const testActor = { actorId: '30000000-0000-4000-8000-000000000001', actorName: '测试人员' };
// Business regressions provision sessions explicitly. Password/login behavior is tested with real hashes separately.
export const sessionOnlyHash = `scrypt:131072:8:1:${'00'.repeat(16)}:${'00'.repeat(32)}`;
const contexts = new WeakMap<Express, { storage: Storage; user: AuthenticatedUser; cookie: string }>();
export function setTestUser(app: Express, username: string, userId = randomUUID() as string) {
  const context = contexts.get(app);
  if (!context) throw new Error('App has no test account context');
  const { storage } = context; const accounts = authRepository(storage.db);
  const existing = storage.db.prepare('SELECT id FROM users WHERE id=?').get(userId);
  if (!storage.db.prepare('SELECT user_id FROM user_auth WHERE user_id=?').get(userId)) {
    accounts.create({ userId: existing ? userId : undefined, loginName: 't' + userId, username, passwordHash: sessionOnlyHash, role: 'admin' });
    // A new account gets its server-generated id, so use its credential rather than the requested fixture id.
    userId = accounts.credential('t' + userId)!.userId;
  }
  // Deliberate fixture mutation supports historical display-name snapshots, not a production rename API.
  storage.db.prepare('UPDATE users SET username=? WHERE id=?').run(username, userId);
  const session = accounts.issue(userId);
  context.user = session.user; context.cookie = `${sessionCookie}=${session.token}`;
  return context.user;
}
export function createTestApp(storage: Storage, clientDir?: string) {
  const app = createApp(storage, clientDir);
  contexts.set(app, { storage, user: null as unknown as AuthenticatedUser, cookie: '' });
  if (!storage.db.prepare('SELECT id FROM users WHERE id=?').get(testActor.actorId)) {
    const now = new Date().toISOString(); storage.db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(testActor.actorId, testActor.actorName, now, now);
  }
  setTestUser(app, testActor.actorName, testActor.actorId);
  return app;
}
export function authenticatedRequest(app: Express) {
  const context = contexts.get(app); if (!context) throw new Error('Missing authenticated fixture');
  const agent = rawRequest(app);
  for (const method of ['get', 'post', 'patch', 'delete', 'put', 'head', 'options'] as const) {
    const original = agent[method].bind(agent);
    agent[method] = ((url: string) => original(url).set('Cookie', context.cookie).set('Origin', 'http://127.0.0.1:5174').set('X-Expected-User-Id', context.user.userId)) as typeof agent[typeof method];
  }
  return agent;
}
