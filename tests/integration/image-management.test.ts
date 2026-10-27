import { describe, expect, it, vi } from 'vitest';
import { authenticatedRequest as request, setTestUser } from '../support/auth-fixtures.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as imageValidation from '../../src/server/persistence/image-files.js';
import { logger } from '../../src/server/logger.js';
import { createTestApp as createApp } from '../support/auth-fixtures.js';
import { openStorage } from '../../src/server/storage.js';
import { tempDir } from '../support/helpers.js';
import { imageBuffer } from '../support/review-fixtures.js';

async function setup() {
  const root = tempDir(); const storage = openStorage(root); const app = createApp(storage);
  const user = setTestUser(app, '删除测试');
  const bytes = await imageBuffer();
  const upload = (id: string = randomUUID(), name = 'same.png') => request(app).post('/api/images').set('X-User-Id', user.userId).field('id', id).attach('file', bytes, { filename: name, contentType: 'image/png' });
  const image = (await upload().expect(201)).body as { id: string };
  const detail = () => request(app).get(`/api/workbench/images/${image.id}`).expect(200);
  const base = (await detail()).body.revision.id as string;
  const remove = (revision = base) => request(app).delete(`/api/images/${image.id}`).send({ userId: user.userId, baseRevisionId: revision });
  return { root, storage, app, user, upload, image, base, detail, remove };
}

describe('P5 image lifecycle', () => {
  it('rejects a retry that finishes decoding after its original image was deleted', async () => {
    const s = await setup();
    let unblock!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { unblock = resolve; });
    const original = imageValidation.validateImage;
    const validation = vi.spyOn(imageValidation, 'validateImage').mockImplementationOnce(async (...args) => { const value = await original(...args); entered(); await gate; return value; });
    const pending = s.upload(s.image.id).then(response => response);
    try {
      await started; await s.remove().expect(204); unblock();
      const response = await pending; expect(response.status).toBe(409); expect(response.body.error.code).toBe('IMAGE_DELETED');
      expect(s.storage.db.prepare('SELECT * FROM images').all()).toEqual([]); expect(fs.readdirSync(s.storage.files.uploads)).toEqual([]);
    } finally { unblock(); await pending; validation.mockRestore(); s.storage.close(); }
  });

  it('rejects deletion through a directory junction without removing database rows or outside bytes', async () => {
    const s = await setup(); const folder = path.join(s.root, 'images', s.image.id); const held = path.join(s.root, 'held'); const outside = path.join(s.root, 'outside');
    fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'original.png'), 'unrelated'); fs.renameSync(folder, held); fs.symlinkSync(outside, folder, 'junction');
    try {
      await s.remove().expect(503); await s.detail();
      expect(fs.readFileSync(path.join(outside, 'original.png'), 'utf8')).toBe('unrelated'); expect(s.storage.db.prepare('SELECT * FROM deleted_images').all()).toEqual([]);
    } finally { fs.unlinkSync(folder); fs.renameSync(held, folder); s.storage.close(); }
  });
  it('removes all versions, receipts and annotations atomically, keeps other images and rejects late uploads across restart', async () => {
    const s = await setup(); let closed = false;
    try {
      const other = (await s.upload().expect(201)).body as { id: string };
      const marker = { id: randomUUID(), x: 0.2, y: 0.5, note: 'saved', severity: 'medium', size: 31 };
      const save = { requestId: randomUUID(), userId: s.user.userId, baseRevisionId: s.base, markers: [marker] };
      const first = (await request(s.app).post(`/api/workbench/images/${s.image.id}/saves`).send(save).expect(200)).body;
      const second = (await request(s.app).post(`/api/workbench/images/${s.image.id}/saves`).send({ ...save, requestId: randomUUID(), baseRevisionId: first.savedRevisionId, markers: [{ ...marker, note: 'v2' }] }).expect(200)).body;
      const file = s.storage.files.contentPath((s.storage.db.prepare('SELECT storage_key FROM images WHERE id=?').get(s.image.id) as { storage_key: string }).storage_key);
      await s.remove(second.savedRevisionId).expect(204);
      expect(fs.existsSync(file)).toBe(false);
      for (const table of ['annotations', 'annotation_creations', 'review_revisions', 'review_save_receipts']) expect(s.storage.db.prepare(`SELECT * FROM ${table} WHERE image_id=?`).all(s.image.id)).toEqual([]);
      expect(s.storage.db.prepare('SELECT * FROM review_changes').all()).toEqual([]);
      expect(s.storage.db.pragma('foreign_key_check')).toEqual([]);
      expect(s.storage.db.prepare('SELECT * FROM users WHERE id=?').get(s.user.userId)).toBeDefined();
      expect((await s.remove().expect(404)).body.error.code).toBe('IMAGE_NOT_FOUND');
      await request(s.app).get(`/api/images/${s.image.id}/content`).expect(404);
      await request(s.app).get(`/api/workbench/images/${s.image.id}/history/${first.savedRevisionId}`).expect(404);
      await request(s.app).post(`/api/workbench/images/${s.image.id}/saves`).send(save).expect(404);
      await request(s.app).post(`/api/images/${s.image.id}/annotations`).send({ ...marker, actorId: s.user.userId, actorName: '删除测试' }).expect(404);
      await request(s.app).patch(`/api/annotations/${marker.id}`).send({ version: 1, note: 'late', severity: 'medium', actorId: s.user.userId, actorName: '删除测试' }).expect(404);
      expect((await s.upload(s.image.id).expect(409)).body.error.code).toBe('IMAGE_DELETED');
      await request(s.app).get(`/api/workbench/images/${other.id}`).expect(200);
      s.storage.close(); closed = true;
      const reopened = openStorage(s.root);
      try {
        const app = createApp(reopened);
        const late = await request(app).post('/api/images').field('id', s.image.id).attach('file', await imageBuffer(), { filename: 'same.png', contentType: 'image/png' }).expect(409);
        expect(late.body.error.code).toBe('IMAGE_DELETED');
        expect((await request(app).get('/api/workbench/images').expect(200)).body.total).toBe(1);
      } finally { reopened.close(); }
    } finally { if (!closed) s.storage.close(); }
  });

  it('validates deletion and refuses an outdated base without losing saved contents', async () => {
    const s = await setup();
    try {
      await request(s.app).delete(`/api/images/${s.image.id}`).send({ userId: s.user.userId }).expect(400);
      await request(s.app).delete(`/api/images/${s.image.id}`).send({ userId: randomUUID(), baseRevisionId: s.base }).expect(403);
      const saved = (await request(s.app).post(`/api/workbench/images/${s.image.id}/saves`).send({ requestId: randomUUID(), userId: s.user.userId, baseRevisionId: s.base, markers: [{ id: randomUUID(), x: 0.1, y: 0.2, note: 'new', severity: 'high' }] }).expect(200)).body;
      const conflict = await s.remove().expect(409);
      expect(conflict.body.error.code).toBe('REVIEW_BASE_CHANGED'); expect(conflict.body.error.requestId).toBeTruthy();
      expect((await s.detail()).body.revision.id).toBe(saved.savedRevisionId);
      expect(s.storage.db.prepare('SELECT * FROM deleted_images').all()).toEqual([]);
    } finally { s.storage.close(); }
  });

  it('rolls back failed deletion before touching files, then hides data even when physical cleanup fails', async () => {
    const s = await setup(); let closed = false;
    try {
      const key = (s.storage.db.prepare('SELECT storage_key FROM images WHERE id=?').get(s.image.id) as { storage_key: string }).storage_key;
      const file = s.storage.files.contentPath(key);
      s.storage.db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON images BEGIN SELECT RAISE(ABORT,'test deletion failure'); END;");
      const failure = await s.remove().expect(500);
      expect(JSON.stringify(failure.body)).not.toContain('test deletion failure');
      await s.detail(); expect(fs.existsSync(file)).toBe(true);
      expect(s.storage.db.prepare('SELECT * FROM deleted_images').all()).toEqual([]);
      s.storage.db.exec('DROP TRIGGER fail_delete');
      // Probe cleanup must keep working while only this original file is locked.
      const original = fs.unlinkSync;
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const locked = vi.spyOn(fs, 'unlinkSync').mockImplementation(target => { if (String(target) === file) throw Object.assign(new Error('locked'), { code: 'EPERM' }); original(target); });
      try { await s.remove().expect(204); expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'image_delete_cleanup_failed', imageId: s.image.id, requestId: expect.any(String) })); }
      finally { locked.mockRestore(); warn.mockRestore(); }
      expect(fs.existsSync(file)).toBe(true);
      await request(s.app).get(`/api/images/${s.image.id}`).expect(404);
      fs.utimesSync(file, new Date(0), new Date(0)); s.storage.close(); closed = true;
      const reopened = openStorage(s.root);
      try { expect(fs.existsSync(file)).toBe(false); expect(reopened.db.prepare('SELECT * FROM images').all()).toEqual([]); }
      finally { reopened.close(); }
    } finally { if (!closed) s.storage.close(); }
  });
});
