import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { openStorage } from '../../src/server/storage.js';
import { openAccountStore } from '../../src/server/account-store.js';
import { authRepository, sessionLifetime } from '../../src/server/persistence/auth.js';
import { hashPassword, verifyPassword } from '../../src/server/passwords.js';
import { readAuthConfig } from '../../src/server/config.js';
import { sessionCookie } from '../../src/server/http/auth.js';
import { legacyUserId } from '../../src/server/persistence/users.js';
import { tempDir, launch } from '../support/helpers.js';
import { imageBuffer } from '../support/review-fixtures.js';

const origin = 'http://127.0.0.1:5174'; const password = 'auth-test-password-12345'; let hash: string;
beforeAll(async () => { hash = await hashPassword(password); });
function setup(secure = false) {
  const root = tempDir(); const storage = openStorage(root); const accounts = authRepository(storage.db);
  const admin = accounts.create({ loginName: 'admin', username: '同名', passwordHash: hash, role: 'admin' });
  const member = accounts.create({ loginName: 'member', username: '同名', passwordHash: hash });
  const app = createApp(storage, undefined, { origins: [origin], secure });
  const session = (id: string) => `${sessionCookie}=${accounts.issue(id).token}`;
  const as = (id: string) => {
    const cookie = session(id);
    return { get: (url: string) => request(app).get(url).set('Cookie', cookie), post: (url: string) => request(app).post(url).set('Cookie', cookie).set('Origin', origin).set('X-Expected-User-Id', id), delete: (url: string) => request(app).delete(url).set('Cookie', cookie).set('Origin', origin).set('X-Expected-User-Id', id) };
  };
  return { root, storage, accounts, admin, member, app, session, as };
}
describe('authenticated shared workbench', () => {
  it.each(['', '1', '1234', '   ', '  a  ', '中文🙂', 'x'.repeat(256)])('registers a member and logs in with an unrestricted exact password (%#)', async sample => {
    const s = setup();
    try {
      const created = await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: ' NEW-MEMBER ', password: sample, username: ' 同名 ' }).expect(201);
      expect(created.body).toMatchObject({ loginName: 'new-member', username: '同名', role: 'member' });
      expect(created.headers['set-cookie']).toBeUndefined(); expect(created.body).not.toHaveProperty('passwordHash');
      expect(s.storage.db.prepare('SELECT * FROM auth_sessions').all()).toEqual([]);
      const credential = s.accounts.credential('new-member')!; expect(credential.passwordHash).not.toBe(sample);
      expect(await verifyPassword(sample, credential.passwordHash)).toBe(true);
      const signedIn = await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'new-member', password: sample }).expect(200);
      expect(signedIn.body.userId).toBe(created.body.userId); expect(signedIn.body.role).toBe('member');
      if (sample.trim() !== sample) await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'new-member', password: sample.trim() }).expect(401);
    } finally { s.storage.close(); }
  });
  it.each([undefined, null, 123])('rejects a missing or non-string registration password (%#)', async sample => {
    const s = setup();
    try {
      await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: 'invalid', password: sample }).expect(400);
      await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'admin', password: sample }).expect(400);
      expect(s.accounts.credential('invalid')).toBeUndefined();
    } finally { s.storage.close(); }
  });
  it('registers with a default nickname before any administrator exists and never promotes the first registrant', async () => {
    const storage = openStorage(tempDir()); const app = createApp(storage, undefined, { origins: [origin], secure: false });
    try {
      for (const [loginName, extra] of [['first', {}], ['second', { username: '  ' }]] as const) {
        const created = await request(app).post('/api/auth/register').set('Origin', origin).send({ loginName, password: '', ...extra }).expect(201);
        expect(created.body).toMatchObject({ loginName, username: loginName, role: 'member' });
      }
      expect(storage.db.prepare("SELECT * FROM user_auth WHERE role='admin'").all()).toEqual([]);
      const admin = authRepository(storage.db).create({ loginName: 'maintenance-admin', username: '后台管理员', role: 'admin', passwordHash: hash });
      expect(authRepository(storage.db).issue(admin).user.role).toBe('admin');
    } finally { storage.close(); }
  });
  it.each([{ role: 'admin' }, { userId: legacyUserId }, { enabled: 1 }, { passwordHash: 'forged' }, { isAdmin: true }])('rejects registration authority fields (%#)', async extra => {
    const s = setup();
    try {
      const before = s.storage.db.prepare('SELECT * FROM users').all();
      await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: 'forged', password: '', ...extra }).expect(400);
      expect(s.accounts.credential('forged')).toBeUndefined(); expect(s.storage.db.prepare('SELECT * FROM users').all()).toEqual(before);
    } finally { s.storage.close(); }
  });
  it('preserves an existing session and credentials, rejects duplicate and concurrent names atomically', async () => {
    const s = setup();
    try {
      const cookie = s.session(s.admin); const original = s.accounts.credential('admin');
      const created = await request(s.app).post('/api/auth/register').set('Cookie', cookie).set('Origin', origin).send({ loginName: 'new', password: '' }).expect(201);
      expect(created.headers['set-cookie']).toBeUndefined();
      expect((await request(s.app).get('/api/auth/me').set('Cookie', cookie).expect(200)).body.userId).toBe(s.admin);
      await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: ' ADMIN ', password: 'overwrite' }).expect(409);
      expect(s.accounts.credential('admin')).toEqual(original);
      const results = await Promise.all([1, 2].map(() => request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: 'race', password: '' })));
      expect(results.map(result => result.status).sort()).toEqual([201, 409]);
      expect(s.storage.db.prepare("SELECT count(*) AS n FROM user_auth WHERE login_name='race'").get()).toEqual({ n: 1 });
      expect(s.storage.db.pragma('foreign_key_check')).toEqual([]);
    } finally { s.storage.close(); }
  });
  it('checks registration origin and payload bounds, and keeps registration limits separate from login limits', async () => {
    const s = setup();
    try {
      for (const suppliedOrigin of [undefined, 'null', 'https://attacker.example']) {
        let req = request(s.app).post('/api/auth/register'); if (suppliedOrigin) req = req.set('Origin', suppliedOrigin);
        await req.send({ loginName: 'blocked', password: '' }).expect(403);
      }
      await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: 'too-large', password: 'x'.repeat(4096) }).expect(413);
      for (let index = 0; index < 5; index++) await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: 'admin', password: '' }).expect(409);
      const limited = await request(s.app).post('/api/auth/register').set('Origin', origin).send({ loginName: 'fresh', password: '' }).expect(429);
      expect(limited.body.error.code).toBe('REGISTRATION_RATE_LIMITED'); expect(s.accounts.credential('fresh')).toBeUndefined();
      await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'admin', password }).expect(200);
    } finally { s.storage.close(); }
  });
  it('verifies passwords, creates separate fresh server sessions and preserves cross-browser identity', async () => {
    const s = setup(true);
    try {
      expect(await verifyPassword(password, hash)).toBe(true); expect(await verifyPassword('another-long-password', hash)).toBe(false);
      const cookies: string[] = [];
      for (let index = 0; index < 2; index++) {
        const response = await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: ' ADMIN ', password }).expect(200);
        expect(response.body).toEqual({ userId: s.admin, username: '同名', loginName: 'admin', role: 'admin' });
        const cookie = String(response.headers['set-cookie'][0]); expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Lax/); expect(cookie).toMatch(/Secure/); expect(cookie).not.toMatch(/Domain=/);
        cookies.push(cookie.split(';')[0]);
        expect((await request(s.app).get('/api/auth/me').set('Cookie', cookies[index]).expect(200)).body.userId).toBe(s.admin);
      }
      expect(cookies[0]).not.toBe(cookies[1]);
      const rows = s.storage.db.prepare('SELECT token_hash FROM auth_sessions').all() as { token_hash: string }[];
      expect(rows).toHaveLength(2); expect(rows[0].token_hash).not.toBe(cookies[0].split('=')[1]); expect(rows[0].token_hash).toHaveLength(64);
      const wrong = await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'admin', password: 'incorrect-password-12345' }).expect(401);
      const missing = await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'missing', password }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS'); expect(missing.body.error.message).toBe(wrong.body.error.message);
      expect(JSON.stringify(wrong.body)).not.toContain(password);
    } finally { s.storage.close(); }
  });
  it('denies every business read, SSE and all writes without a session before consuming uploads', async () => {
    const s = setup(); const id = randomUUID();
    try {
      const urls = ['/api/workbench/images', `/api/workbench/images/${id}`, `/api/workbench/images/${id}/history`, `/api/workbench/images/${id}/history/${randomUUID()}`, `/api/images/${id}`, `/api/images/${id}/content`, '/api/events'];
      for (const url of urls) {
        const response = await request(s.app).get(url).expect(401); expect(response.body.error).toMatchObject({ code: 'AUTH_REQUIRED', requestId: response.headers['x-request-id'] });
      }
      await request(s.app).post('/api/images').field('id', id).attach('file', await imageBuffer(), 'denied.png').expect(401);
      expect(fs.readdirSync(s.storage.files.uploads)).toEqual([]); expect(s.storage.db.prepare('SELECT * FROM images').all()).toEqual([]);
      for (const url of [`/api/images/${id}/annotations`, `/api/workbench/images/${id}/saves`]) await request(s.app).post(url).send({}).expect(401);
      await request(s.app).patch(`/api/annotations/${id}`).send({}).expect(401);
      await request(s.app).delete(`/api/annotations/${id}`).send({}).expect(401);
      await request(s.app).delete(`/api/images/${id}`).send({}).expect(401);
      await request(s.app).get('/api/health').expect(200); await request(s.app).get('/api/ready').expect(200);
      await request(s.app).post('/api/workbench/users/enter').send({ username: 'admin', userId: s.admin }).expect(410);
      expect(s.storage.db.prepare('SELECT username FROM users WHERE id=?').get(s.admin)).toEqual({ username: '同名' });
    } finally { s.storage.close(); }
  });
  it('lets members maintain shared markers but reserves whole-image deletion for admins', async () => {
    const s = setup();
    try {
      const admin = s.as(s.admin); const member = s.as(s.member); const id = randomUUID();
      await admin.post('/api/images').field('id', id).attach('file', await imageBuffer(), 'shared.png').expect(201);
      const detail = (await member.get(`/api/workbench/images/${id}`).expect(200)).body;
      const marker = { id: randomUUID(), x: 0.2, y: 0.3, note: 'shared', severity: 'medium' };
      const saved = await member.post(`/api/workbench/images/${id}/saves`).send({ requestId: randomUUID(), baseRevisionId: detail.revision.id, markers: [marker] }).expect(200);
      expect(saved.body.detail.annotations[0]).toMatchObject({ createdBy: s.member, createdByName: '同名' });
      await member.delete(`/api/images/${id}`).send({ baseRevisionId: saved.body.savedRevisionId }).expect(403);
      const other = { ...marker, id: randomUUID(), note: 'admin marker' };
      await admin.post(`/api/images/${id}/annotations`).send(other).expect(201);
      await member.delete(`/api/annotations/${other.id}`).send({ version: 1 }).expect(204);
      const latest = (await admin.get(`/api/workbench/images/${id}`).expect(200)).body;
      await admin.delete(`/api/images/${id}`).send({ baseRevisionId: latest.revision.id }).expect(204);
      expect(s.storage.db.prepare('SELECT * FROM images').all()).toEqual([]);
    } finally { s.storage.close(); }
  });
  it('rejects forged identity, cross-origin and stale-tab writes without files or history changes', async () => {
    const s = setup();
    try {
      const cookie = s.session(s.member); const id = randomUUID();
      for (const suppliedOrigin of [undefined, 'null', 'https://attacker.example', 'http://127.0.0.1:5174.evil.test']) {
        let req = request(s.app).post('/api/images').set('Cookie', cookie).set('X-Expected-User-Id', s.member);
        if (suppliedOrigin) req = req.set('Origin', suppliedOrigin);
        await req.field('id', id).attach('file', await imageBuffer(), 'blocked.png').expect(403);
      }
      await request(s.app).post('/api/images').set('Cookie', cookie).set('Origin', origin).set('X-Expected-User-Id', s.admin).field('id', id).attach('file', await imageBuffer(), 'blocked.png').expect(409);
      await request(s.app).post('/api/images').set('Cookie', cookie).set('Origin', origin).set('X-Expected-User-Id', s.member).set('X-User-Id', s.admin).field('id', id).attach('file', await imageBuffer(), 'blocked.png').expect(403);
      expect(fs.readdirSync(s.storage.files.uploads)).toEqual([]);
      const member = s.as(s.member);
      await member.post('/api/images').field('id', id).attach('file', await imageBuffer(), 'valid.png').expect(201);
      const before = (await member.get(`/api/workbench/images/${id}`)).body;
      await member.post(`/api/workbench/images/${id}/saves`).send({ userId: s.admin, requestId: randomUUID(), baseRevisionId: before.revision.id, markers: [] }).expect(403);
      await member.post(`/api/images/${id}/annotations`).send({ id: randomUUID(), actorId: s.admin, actorName: '同名', x: 0, y: 0, note: 'forged', severity: 'low' }).expect(403);
      await member.post(`/api/images/${id}/annotations`).send({ id: randomUUID(), actorId: s.member, actorName: '伪造昵称', x: 0, y: 0, note: 'forged', severity: 'low' }).expect(403);
      expect((await member.get(`/api/workbench/images/${id}`)).body).toEqual(before);
      expect(s.storage.db.prepare('SELECT username FROM users WHERE id=?').get(s.member)).toEqual({ username: '同名' });
    } finally { s.storage.close(); }
  });
  it('revokes logout, expiry, disable, reset and role-change sessions and preserves the last admin', async () => {
    const s = setup();
    try {
      const old = s.accounts.issue(s.member, Date.now() - sessionLifetime - 1); expect(s.accounts.current(old.token)).toBeNull();
      let cookie = s.session(s.member);
      await request(s.app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', origin).set('X-Expected-User-Id', s.member).expect(204);
      await request(s.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
      for (const change of [{ enabled: false }, { passwordHash: hash }, { role: 'admin' as const }]) {
        s.accounts.change('member', { enabled: true }); cookie = s.session(s.member); s.accounts.change('member', change);
        await request(s.app).get('/api/workbench/images').set('Cookie', cookie).expect(401);
      }
      s.accounts.change('member', { role: 'member' });
      expect(() => s.accounts.change('admin', { enabled: false })).toThrow('至少一个');
      expect(() => s.accounts.change('admin', { role: 'member' })).toThrow('至少一个');
    } finally { s.storage.close(); }
  });
  it('limits attempted logins and does not authenticate legacy rows or an empty installation', async () => {
    const s = setup();
    try {
      for (let index = 0; index < 10; index++) await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'unknown', password }).expect(401);
      const response = await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'unknown', password }).expect(429);
      expect(response.body.error.code).toBe('LOGIN_RATE_LIMITED');
      const legacy = await request(s.app).post('/api/auth/login').set('Origin', origin).send({ loginName: 'historical', password }).expect(401);
      expect(legacy.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(() => s.accounts.create({ userId: legacyUserId, username: '历史', loginName: 'history', passwordHash: hash })).toThrow();
      expect(() => s.accounts.create({ username: '重复', loginName: ' ADMIN ', passwordHash: hash })).toThrow('已存在');
      await request(s.app).post('/api/auth/login').send({ loginName: 'admin', password }).expect(403);
    } finally { s.storage.close(); }
    const storage = openStorage(tempDir());
    try { await request(createApp(storage)).get('/api/workbench/images').expect(401); expect(storage.db.prepare('SELECT * FROM user_auth').all()).toEqual([]); }
    finally { storage.close(); }
  });
  it('maintains accounts without scanning images, preserves historical migrations and can attach an explicit historical id', async () => {
    const root = tempDir(); const storage = openStorage(root); const userId = randomUUID(); const now = new Date().toISOString();
    storage.db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(userId, '旧昵称', now, now);
    const checksums = storage.db.prepare('SELECT * FROM schema_migrations').all(); const uploadDirectory = storage.files.uploads; storage.close();
    const orphan = path.join(uploadDirectory, randomUUID() + '.upload'); fs.writeFileSync(orphan, 'preserve'); const past = new Date(Date.now() - 2 * sessionLifetime); fs.utimesSync(orphan, past, past);
    const store = openAccountStore(root);
    try {
      store.accounts.create({ userId, loginName: 'historic', username: '不改旧昵称', passwordHash: hash, role: 'admin' });
      expect(store.accounts.issue(userId).user.username).toBe('旧昵称'); expect(fs.readFileSync(orphan, 'utf8')).toBe('preserve');
      expect(store.db.prepare('SELECT * FROM schema_migrations').all()).toEqual(checksums);
      expect(store.db.pragma('foreign_key_check')).toEqual([]);
      for (const row of checksums as { name: string; checksum: string }[]) expect(row.checksum).toBe(createHash('sha256').update(fs.readFileSync(path.join('migrations', row.name))).digest('hex'));
    } finally { store.close(); }
    const proc = launch(['--import', 'tsx', 'src/server/account-cli.ts', 'help'], { DATA_DIR: root });
    expect(await proc.exited).toBe(0); expect(proc.output()).toContain('init <login>'); expect(proc.output()).not.toContain(password);
  });
  it('requires exact allowed origins and HTTPS for non-loopback deployment', () => {
    expect(() => readAuthConfig({ HOST: '0.0.0.0' })).toThrow('APP_ORIGIN');
    for (const value of ['http://review.example', 'https://review.example/', 'https://user:secret@review.example', 'null', '']) expect(() => readAuthConfig({ APP_ORIGIN: value })).toThrow('APP_ORIGIN');
    expect(readAuthConfig({ HOST: '0.0.0.0', APP_ORIGIN: 'https://review.example' })).toEqual({ origins: ['https://review.example'], secure: true });
    expect(readAuthConfig({ PORT: '3302', VITE_PORT: '5474' }).origins).toContain('http://127.0.0.1:5474');
  });
});
