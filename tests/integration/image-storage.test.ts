import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { authenticatedRequest as request } from '../support/auth-fixtures.js';
import { openStorage } from '../../src/server/storage.js';
import { createTestApp as createApp } from '../support/auth-fixtures.js';
import { logger } from '../../src/server/logger.js';
import { tempDir } from '../support/helpers.js';
import { imageBuffer, uploadImage } from '../support/review-fixtures.js';

describe('P4 file compensation and directory boundaries', () => {
  it('rolls back owned files on metadata failure and never removes a committed original', async () => {
    const root = tempDir(); const storage = openStorage(root); const app = createApp(storage);
    try {
      const id = randomUUID(); const bytes = await imageBuffer();
      storage.db.exec("CREATE TRIGGER reject_image BEFORE INSERT ON images BEGIN SELECT RAISE(ABORT, 'test'); END");
      await uploadImage(app, bytes, id).expect(500);
      expect(storage.db.prepare('SELECT * FROM images').all()).toEqual([]);
      expect(fs.readdirSync(storage.files.uploads)).toEqual([]);
      expect(fs.existsSync(path.join(root, 'images', id, 'original.png'))).toBe(false);
      storage.db.exec('DROP TRIGGER reject_image');
      await uploadImage(app, bytes, id).expect(201);
      const original = fs.readFileSync(path.join(root, 'images', id, 'original.png'));
      await uploadImage(app, await imageBuffer('png', 40), id).expect(409);
      expect(fs.readFileSync(path.join(root, 'images', id, 'original.png'))).toEqual(original);
      const denied = vi.spyOn(storage.files, 'install').mockImplementationOnce(() => { throw Object.assign(new Error('private local path'), { code: 'ENOSPC' }); });
      try { expect((await uploadImage(app, bytes).expect(503)).body.error.code).toBe('STORAGE_UNAVAILABLE'); }
      finally { denied.mockRestore(); }
      expect(fs.readdirSync(storage.files.uploads)).toEqual([]);
    } finally { storage.close(); }
  });
  it('scans only recognized old unreferenced files, preserves referenced/new/unknown files and reports cleanup failures', async () => {
    const root = tempDir(); const storage = openStorage(root);
    try {
      const id = (await uploadImage(createApp(storage), await imageBuffer()).expect(201)).body.id as string;
      const referenced = storage.files.contentPath(`${id}/original.png`);
      const old = path.join(storage.files.uploads, `${randomUUID()}.upload`);
      const fresh = path.join(storage.files.uploads, `${randomUUID()}.upload`);
      const unknown = path.join(storage.files.uploads, 'user-owned-file.txt');
      const orphanId = randomUUID(); const orphan = path.join(root, 'images', orphanId, 'original.webp');
      fs.mkdirSync(path.dirname(orphan));
      for (const file of [old, fresh, unknown, orphan]) fs.writeFileSync(file, 'test');
      const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
      for (const file of [old, referenced, unknown, orphan]) fs.utimesSync(file, yesterday, yesterday);
      storage.files.scan(storage.db);
      expect(fs.existsSync(old)).toBe(false); expect(fs.existsSync(orphan)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true); expect(fs.existsSync(unknown)).toBe(true); expect(fs.existsSync(referenced)).toBe(true);
      fs.writeFileSync(old, 'test'); fs.utimesSync(old, yesterday, yesterday);
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => { throw new Error('cleanup denied'); });
      try { storage.files.scan(storage.db); expect(fs.existsSync(old)).toBe(true); expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'orphan_cleanup_failed' })); }
      finally { warn.mockRestore(); unlink.mockRestore(); }
    } finally { storage.close(); }
  });
  it('refuses path escapes and directory junctions, including startup scanning', async () => {
    const root = tempDir(); const data = path.join(root, 'data'); const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    const storage = openStorage(data); const id = randomUUID(); const link = path.join(data, 'images', id);
    try {
      expect(() => storage.files.contentPath('../outside/secret.png')).toThrow();
      fs.writeFileSync(path.join(outside, 'original.png'), 'must not read or delete');
      fs.symlinkSync(outside, link, 'junction');
      expect(() => storage.files.contentPath(`${id}/original.png`)).toThrow();
      expect(() => storage.files.scan(storage.db)).toThrow();
      expect(fs.readFileSync(path.join(outside, 'original.png'), 'utf8')).toBe('must not read or delete');
    } finally { storage.close(); fs.unlinkSync(link); }
  });
  it('fails readiness and upload instead of replacing a broken business directory', async () => {
    const root = tempDir(); const storage = openStorage(root); const app = createApp(storage);
    const directory = path.join(root, 'images'); const moved = path.join(root, 'images-held');
    fs.renameSync(directory, moved); fs.writeFileSync(directory, 'blocked');
    try {
      expect((await request(app).get('/api/ready').expect(503)).body.error.code).toBe('SERVICE_NOT_READY');
      await uploadImage(app, await imageBuffer()).expect(503);
      expect(fs.readFileSync(directory, 'utf8')).toBe('blocked');
    } finally { fs.unlinkSync(directory); fs.renameSync(moved, directory); storage.close(); }
    fs.rmdirSync(directory); fs.writeFileSync(directory, 'blocked');
    expect(() => openStorage(root)).toThrow('image directories');
  });
});
