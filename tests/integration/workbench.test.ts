import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../src/server/app.js';
import { openStorage } from '../../src/server/storage.js';
import type { SaveReview, WorkspaceDetail, User } from '../../src/shared/workbench-contracts.js';
import { tempDir } from '../support/helpers.js';
import { imageBuffer } from '../support/review-fixtures.js';

async function setup() {
  const root = tempDir(); const storage = openStorage(root); const app = createApp(storage);
  const user = (await request(app).post('/api/workbench/users/enter').send({ username: '甲' }).expect(200)).body as User;
  const bytes = await imageBuffer(); const imageId = randomUUID();
  await request(app).post('/api/images').set('X-User-Id', user.userId).field('id', imageId).attach('file', bytes, { filename: '测试.png', contentType: 'image/png' }).expect(201);
  const detail = () => request(app).get(`/api/workbench/images/${imageId}`).expect(200);
  const save = (value: SaveReview) => request(app).post(`/api/workbench/images/${imageId}/saves`).send(value);
  return { root, storage, app, user, imageId, bytes, detail, save };
}
const marker = (note = '说明') => ({ id: randomUUID(), x: 0.25, y: 0.75, note, severity: 'medium' as const });

describe('username, library and inherited manual saves', () => {
  it('saves independent marker sizes, immutable version numbers and exact library summaries across restart', async () => {
    const s = await setup(); let closed = false;
    try {
      const initial = (await s.detail()).body as WorkspaceDetail;
      const a = { ...marker('small'), size: 12 }; const b = { ...marker('large'), size: 48 };
      const first = (await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: initial.revision.id, markers: [a, b] }).expect(200)).body;
      expect(first.detail.revision.versionNumber).toBe(1);
      expect(first.libraryItem).toMatchObject({ annotationCount: 2, revisionCount: 2, username: '甲' });
      const value = { requestId: randomUUID(), userId: s.user.userId, baseRevisionId: first.savedRevisionId, markers: [{ ...a, size: 31 }, b] };
      const second = (await s.save(value).expect(200)).body;
      expect(second.detail.revision).toMatchObject({ versionNumber: 2, added: 0, modified: 1, deleted: 0 });
      expect(second.detail.annotations.map((row: { size: number }) => row.size)).toEqual([31, 48]);
      expect(second.libraryItem).toMatchObject({ annotationCount: 2, revisionCount: 3 });
      const retried = (await s.save(value).expect(200)).body;
      expect(retried).toMatchObject({ created: false, savedRevisionId: second.savedRevisionId, libraryItem: second.libraryItem });
      const previous = (await request(s.app).get(`/api/workbench/images/${s.imageId}/history/${first.savedRevisionId}`).expect(200)).body;
      expect(previous.annotations.map((row: { size: number }) => row.size)).toEqual([12, 48]);
      const later = (await request(s.app).get(`/api/workbench/images/${s.imageId}/history/${second.savedRevisionId}`).expect(200)).body;
      expect(later.previousAnnotations).toEqual(previous.annotations);
      // A legacy client that does not send size must preserve a non-default existing size.
      await request(s.app).patch(`/api/annotations/${a.id}`).send({ actorId: s.user.userId, actorName: s.user.username, version: second.detail.annotations[0].version, note: 'legacy edit', severity: 'medium' }).expect(200);
      expect((await s.detail()).body.annotations[0].size).toBe(31);
      const omitted = [a, b].map(({ id, x, y, severity }) => ({ id, x, y, severity, note: id === a.id ? 'legacy edit' : 'large' }));
      const current = (await s.detail()).body as WorkspaceDetail;
      expect((await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: current.revision.id, markers: omitted }).expect(200)).body.created).toBe(false);
      s.storage.close(); closed = true; const reopened = openStorage(s.root);
      try { expect((await request(createApp(reopened)).get(`/api/workbench/images/${s.imageId}`).expect(200)).body).toEqual(current); }
      finally { reopened.close(); }
    } finally { if (!closed) s.storage.close(); }
  });
  it('rejects invalid sizes atomically and rolls size edits back when recording history fails', async () => {
    const s = await setup();
    try {
      const initial = (await s.detail()).body as WorkspaceDetail; const a = { ...marker(), size: 24 };
      const first = (await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: initial.revision.id, markers: [a] }).expect(200)).body.detail as WorkspaceDetail;
      for (const size of [11, 49, 24.5, null, '31']) {
        await request(s.app).post(`/api/workbench/images/${s.imageId}/saves`).send({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: first.revision.id, markers: [{ ...a, size }] }).expect(400);
      }
      s.storage.db.exec("CREATE TRIGGER fail_size_history BEFORE INSERT ON review_changes BEGIN SELECT RAISE(ABORT,'test only'); END");
      await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: first.revision.id, markers: [{ ...a, size: 48 }] }).expect(500);
      expect((await s.detail()).body).toEqual(first);
      expect(s.storage.db.prepare('SELECT count(*) AS n FROM review_revisions').get()).toEqual({ n: 2 });
    } finally { s.storage.close(); }
  });
  it('upgrades old workbench snapshots and receipts without changing old migrations or retry semantics', async () => {
    const root = tempDir(); const migrations = path.join(root, 'old-migrations'); fs.mkdirSync(migrations);
    const names = ['001-initialize.sql', '002-persistence.sql', '003-workbench-history.sql'];
    for (const name of names) fs.copyFileSync(path.join('migrations', name), path.join(migrations, name));
    const old = openStorage(root, migrations); const imageId = randomUUID(); const userId = randomUUID(); const annotationId = randomUUID();
    const firstId = randomUUID(); const baseId = randomUUID(); const requestId = randomUUID(); const now = '2026-10-25T00:00:00.000Z';
    const bytes = await imageBuffer(); const oldMarker = { id: annotationId, imageId, number: 7, x: 0.25, y: 0.75, note: 'old', severity: 'medium', createdBy: userId, createdByName: '旧用户', updatedBy: userId, updatedByName: '旧用户', version: 1, createdAt: now, updatedAt: now };
    const payload = { requestId, baseRevisionId: baseId, userId, markers: [{ id: annotationId, x: 0.25, y: 0.75, note: 'old', severity: 'medium' }] };
    try {
      old.db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(userId, '旧用户', now, now);
      old.db.prepare('INSERT INTO images(id,original_name,mime_type,width,height,file_size,storage_key,sha256,next_annotation_number,created_at,updated_at,uploaded_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(imageId, 'old.png', 'image/png', 32, 24, bytes.length, `${imageId}/original.png`, createHash('sha256').update(bytes).digest('hex'), 8, now, now, userId);
      old.db.prepare('INSERT INTO review_revisions(id,image_id,user_id,username_snapshot,saved_at,kind) VALUES (?,?,?,?,?,?)').run(baseId, imageId, userId, '旧用户', now, 'upload');
      old.db.prepare('INSERT INTO review_baselines VALUES (?,?)').run(baseId, '[]');
      old.db.prepare('INSERT INTO review_revisions VALUES (?,?,?,?,?,?,?,?,?,?)').run(firstId, imageId, baseId, userId, '旧用户', now, 'save', 1, 0, 0);
      old.db.prepare('INSERT INTO review_changes VALUES (?,?,?,?,?,?)').run(firstId, annotationId, 'add', null, JSON.stringify(oldMarker), userId);
      old.db.prepare('INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(annotationId, imageId, 7, 0.25, 0.75, 'old', 'medium', userId, '旧用户', userId, '旧用户', 1, now, now, userId, userId);
      old.db.prepare('UPDATE images SET current_revision_id=? WHERE id=?').run(firstId, imageId);
      const fingerprint = createHash('sha256').update(JSON.stringify([imageId, baseId, userId, payload.markers])).digest('hex');
      old.db.prepare('INSERT INTO review_save_receipts VALUES (?,?,?,?)').run(requestId, imageId, fingerprint, firstId);
      fs.mkdirSync(path.join(root, 'images', imageId)); fs.writeFileSync(path.join(root, 'images', imageId, 'original.png'), bytes);
    } finally { old.close(); }
    const upgraded = openStorage(root);
    try {
      const app = createApp(upgraded);
      for (const name of names) expect(upgraded.db.prepare('SELECT checksum FROM schema_migrations WHERE name=?').get(name)).toEqual({ checksum: createHash('sha256').update(fs.readFileSync(path.join(migrations, name))).digest('hex') });
      const detail = (await request(app).get(`/api/workbench/images/${imageId}`).expect(200)).body as WorkspaceDetail;
      expect(detail.revision.versionNumber).toBe(1); expect(detail.annotations[0].size).toBe(24);
      expect((await request(app).post(`/api/workbench/images/${imageId}/saves`).send(payload).expect(200)).body).toMatchObject({ created: false, savedRevisionId: firstId });
      const edited = (await request(app).post(`/api/workbench/images/${imageId}/saves`).send({ ...payload, requestId: randomUUID(), baseRevisionId: firstId, markers: [{ ...payload.markers[0], size: 31 }] }).expect(200)).body;
      expect(edited.detail.revision).toMatchObject({ versionNumber: 2, modified: 1, added: 0 });
      const historical = (await request(app).get(`/api/workbench/images/${imageId}/history/${firstId}`).expect(200)).body;
      expect(historical.annotations[0]).toMatchObject({ number: 7, size: 24, note: 'old' });
      expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    } finally { upgraded.close(); }
  });
  it('migrates a populated P4 database to an inherited baseline without rewriting files or old migrations', async () => {
    const root = tempDir(); const migrations = path.join(root, 'old-migrations'); fs.mkdirSync(migrations);
    for (const name of ['001-initialize.sql', '002-persistence.sql']) fs.copyFileSync(path.join('migrations', name), path.join(migrations, name));
    const old = openStorage(root, migrations); const imageId = randomUUID(); const userId = randomUUID(); const annotationId = randomUUID();
    const bytes = await imageBuffer(); const now = '2026-10-25T00:00:00.000Z';
    old.db.prepare('INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(imageId, 'old.png', 'image/png', 32, 24, bytes.length, `${imageId}/original.png`, createHash('sha256').update(bytes).digest('hex'), 2, now, now);
    old.db.prepare('INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(annotationId, imageId, 1, 0.5, 0.5, '旧说明', 'medium', userId, '旧用户', userId, '旧用户', 1, now, now);
    fs.mkdirSync(path.join(root, 'images', imageId)); fs.writeFileSync(path.join(root, 'images', imageId, 'original.png'), bytes);
    const records = old.db.prepare('SELECT * FROM schema_migrations').all(); old.close();
    const upgraded = openStorage(root);
    try {
      expect(upgraded.db.prepare("SELECT * FROM schema_migrations WHERE name IN ('001-initialize.sql','002-persistence.sql') ORDER BY name").all()).toEqual(records);
      const app = createApp(upgraded); const detail = (await request(app).get(`/api/workbench/images/${imageId}`).expect(200)).body as WorkspaceDetail;
      expect(detail.annotations[0]).toMatchObject({ id: annotationId, note: '旧说明', createdBy: userId, createdByName: '旧用户' });
      expect(detail.revision.kind).toBe('import');
      expect((await request(app).get(`/api/workbench/images/${imageId}/history/${detail.revision.id}`).expect(200)).body.annotations).toEqual(detail.annotations);
      expect((await request(app).get(`/api/images/${imageId}/content`).expect(200)).body).toEqual(bytes);
      expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    } finally { upgraded.close(); }
  });
  it('persists stable users and their name snapshots, and atomically inherits adds/edits/deletions', async () => {
    const s = await setup();
    try {
      const initial = (await s.detail()).body as WorkspaceDetail;
      expect(initial.revision).toMatchObject({ parentRevisionId: null, userId: s.user.userId, username: '甲', kind: 'upload' });
      const a = marker('first'); const b = marker('inherited'); const c = marker('delete');
      const first = (await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: initial.revision.id, markers: [a, b, c] }).expect(200)).body.detail as WorkspaceDetail;
      const renamed = (await request(s.app).post('/api/workbench/users/enter').send({ userId: s.user.userId, username: '新昵称' }).expect(200)).body as User;
      expect(renamed.userId).toBe(s.user.userId);
      const d = marker('added');
      const second = (await s.save({ requestId: randomUUID(), userId: renamed.userId, baseRevisionId: first.revision.id, markers: [{ ...a, note: ' changed ' }, b, d] }).expect(200)).body.detail as WorkspaceDetail;
      expect(second.revision).toMatchObject({ parentRevisionId: first.revision.id, username: '新昵称', added: 1, modified: 1, deleted: 1 });
      expect(second.annotations.map(row => row.number)).toEqual([1, 2, 4]);
      expect(second.annotations.find(row => row.id === b.id)).toEqual(first.annotations.find(row => row.id === b.id));
      expect(second.annotations.find(row => row.id === a.id)).toMatchObject({ note: 'changed', createdByName: '甲', updatedByName: '新昵称' });
      const old = await request(s.app).get(`/api/workbench/images/${s.imageId}/history/${first.revision.id}`).expect(200);
      expect(old.body.revision.username).toBe('甲'); expect(old.body.annotations).toHaveLength(3);
      const history = await request(s.app).get(`/api/workbench/images/${s.imageId}/history/${second.revision.id}`).expect(200);
      expect(history.body.changes.map((row: { kind: string }) => row.kind).sort()).toEqual(['add', 'delete', 'modify']);
      expect(history.body.changes.every((row: { userId: string }) => row.userId === renamed.userId)).toBe(true);
      expect(s.storage.db.prepare('SELECT uploaded_by_user_id AS id FROM images').get()).toEqual({ id: s.user.userId });
      expect(s.storage.db.prepare('SELECT created_by_user_id AS id FROM annotations WHERE id=?').get(a.id)).toEqual({ id: s.user.userId });
    } finally { s.storage.close(); }
  });
  it('deduplicates response-loss retries, rejects changed payloads and preserves the head on a no-op', async () => {
    const s = await setup();
    try {
      const initial = (await s.detail()).body as WorkspaceDetail;
      const value = { requestId: randomUUID(), userId: s.user.userId, baseRevisionId: initial.revision.id, markers: [marker()] };
      const saved = (await s.save(value).expect(200)).body;
      expect((await s.save(value).expect(200)).body).toMatchObject({ created: false, savedRevisionId: saved.savedRevisionId });
      expect((await s.save({ ...value, markers: [marker('different')] }).expect(409)).body.error.code).toBe('SAVE_ID_CONFLICT');
      const noOp = (await s.save({ ...value, requestId: randomUUID(), baseRevisionId: saved.savedRevisionId }).expect(200)).body;
      expect(noOp).toMatchObject({ created: false, savedRevisionId: saved.savedRevisionId });
      expect(s.storage.db.prepare('SELECT count(*) AS n FROM review_revisions').get()).toEqual({ n: 2 });
      expect((await s.save({ ...value, requestId: randomUUID() }).expect(409)).body.error.code).toBe('REVIEW_BASE_CHANGED');
    } finally { s.storage.close(); }
  });
  it('rolls back every marker, counter and history entry when recording a batch fails', async () => {
    const s = await setup();
    try {
      const initial = (await s.detail()).body as WorkspaceDetail;
      s.storage.db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON review_changes BEGIN SELECT RAISE(ABORT,'test only'); END");
      const failure = await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: initial.revision.id, markers: [marker('one'), marker('two')] }).expect(500);
      expect(failure.body.error.code).toBe('INTERNAL_ERROR'); expect(failure.body.error.requestId).toBe(failure.headers['x-request-id']);
      expect(JSON.stringify(failure.body)).not.toMatch(/SQL|TRIGGER|test only|[A-Z]:\\/);
      expect((await s.detail()).body).toEqual(initial);
      expect(s.storage.db.prepare('SELECT next_annotation_number AS n FROM images').get()).toEqual({ n: 1 });
      expect(s.storage.db.prepare('SELECT count(*) AS n FROM review_save_receipts').get()).toEqual({ n: 0 });
    } finally { s.storage.close(); }
  });
  it('validates identity, unique markers and immutable coordinates without leaking invalid input', async () => {
    const s = await setup();
    try {
      await request(s.app).post('/api/workbench/users/enter').send({ username: ' ' }).expect(400);
      const initial = (await s.detail()).body as WorkspaceDetail; const a = marker();
      const value = { requestId: randomUUID(), userId: s.user.userId, baseRevisionId: initial.revision.id, markers: [a] };
      await s.save({ ...value, markers: [a, a] }).expect(400);
      await s.save({ ...value, userId: randomUUID() }).expect(400);
      const saved = (await s.save(value).expect(200)).body.detail as WorkspaceDetail;
      await s.save({ ...value, requestId: randomUUID(), baseRevisionId: saved.revision.id, markers: [{ ...a, x: 0.9 }] }).expect(400);
      await request(s.app).get(`/api/workbench/images/${randomUUID()}/history/${saved.revision.id}`).expect(404);
    } finally { s.storage.close(); }
  });
  it('keeps every inherited revision beyond twenty saves, one original file and restart integrity', async () => {
    const s = await setup(); let closed = false;
    try {
      let current = (await s.detail()).body as WorkspaceDetail; const initialId = current.revision.id; const a = marker(); let first = '';
      for (let index = 0; index < 23; index++) {
        current = (await s.save({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: current.revision.id, markers: [{ ...a, note: `保存${index}` }] }).expect(200)).body.detail as WorkspaceDetail;
        if (!index) first = current.revision.id;
      }
      const list = await request(s.app).get(`/api/workbench/images/${s.imageId}/history`).expect(200);
      expect(list.body.total).toBe(24); expect(list.body.items).toHaveLength(20);
      expect((await request(s.app).get(`/api/workbench/images/${s.imageId}/history?page=2`).expect(200)).body.items).toHaveLength(4);
      expect((await request(s.app).get(`/api/workbench/images/${s.imageId}/history/${first}`).expect(200)).body.annotations[0].note).toBe('保存0');
      expect((await request(s.app).get(`/api/workbench/images/${s.imageId}/history/${initialId}`).expect(200)).body.annotations).toEqual([]);
      expect(fs.readdirSync(path.join(s.root, 'images', s.imageId))).toEqual(['original.png']);
      s.storage.close(); closed = true; const reopened = openStorage(s.root);
      try {
        const restored = createApp(reopened);
        expect((await request(restored).get(`/api/workbench/images/${s.imageId}`).expect(200)).body).toEqual(current);
        const content = (await request(restored).get(`/api/images/${s.imageId}/content`).expect(200)).body as Buffer;
        expect(createHash('sha256').update(content).digest('hex')).toBe(createHash('sha256').update(s.bytes).digest('hex'));
      } finally { reopened.close(); }
    } finally { if (!closed) s.storage.close(); }
  }, 30000);
  it('provides a bounded searchable image library and rejects unsafe query values', async () => {
    const s = await setup();
    try {
      for (let index = 0; index < 13; index++) await request(s.app).post('/api/images').field('id', randomUUID()).attach('file', s.bytes, { filename: `other-${index}.png`, contentType: 'image/png' }).expect(201);
      const list = (await request(s.app).get('/api/workbench/images').expect(200)).body;
      expect(list.total).toBe(14); expect(list.items).toHaveLength(12); expect(list.items[0].image).not.toHaveProperty('storage_key');
      expect((await request(s.app).get('/api/workbench/images?page=2').expect(200)).body.items).toHaveLength(2);
      expect((await request(s.app).get('/api/workbench/images?q=%E6%B5%8B%E8%AF%95').expect(200)).body.total).toBe(1);
      expect((await request(s.app).get('/api/workbench/images?q=%25').expect(200)).body.total).toBe(0);
      await request(s.app).get('/api/workbench/images?page=0').expect(400); await request(s.app).get('/api/workbench/images?sort=SQL').expect(400);
    } finally { s.storage.close(); }
  }, 30000);
});
