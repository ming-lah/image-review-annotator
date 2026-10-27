import { describe, it, expect } from 'vitest';
import { authenticatedRequest as request, setTestUser } from '../support/auth-fixtures.js';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { createTestApp as createApp } from '../support/auth-fixtures.js';
import { openStorage } from '../../src/server/storage.js';
import { tempDir } from '../support/helpers.js';
import { actor, animatedPng, annotationInput, imageBuffer, uploadImage } from '../support/review-fixtures.js';

function setup() { const root = tempDir(); const storage = openStorage(root); return { root, storage, app: createApp(storage) }; }
function failure(response: import('supertest').Response, code: string) {
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  expect(JSON.stringify(response.body)).not.toMatch(/SELECT|INSERT|sqlite|Error:|[A-Z]:\\|stack|storage_key/);
}
describe('P4 persistence API', () => {
  it('allows only one update to win for the same version under parallel HTTP requests', async () => {
    const { storage, app } = setup();
    try {
      const image = (await uploadImage(app, await imageBuffer()).expect(201)).body.id as string;
      const value = annotationInput(); await request(app).post(`/api/images/${image}/annotations`).send(value).expect(201);
      const updates = await Promise.all(['first', 'second'].map(note => request(app).patch(`/api/annotations/${value.id}`).send({ ...actor, version: 1, note, severity: 'high' })));
      expect(updates.map(result => result.status).sort()).toEqual([200, 409]);
      expect((await request(app).get(`/api/images/${image.toUpperCase()}`).expect(200)).body.annotations[0].version).toBe(2);
    } finally { storage.close(); }
  });
  it.each(['png', 'jpeg', 'webp'] as const)('stores original %s bytes and keeps DTOs private', async format => {
    const { storage, app } = setup();
    try {
      const bytes = await imageBuffer(format);
      const result = await uploadImage(app, bytes, randomUUID(), `测试.${format}`, `image/${format}`).expect(201);
      expect(result.body).toMatchObject({ originalName: `测试.${format}`, width: 32, height: 24, fileSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      expect(result.body).not.toHaveProperty('storage_key');
      const imageId = result.body.id as string;
      const content = await request(app).get(`/api/images/${imageId}/content`).expect(200).expect('X-Content-Type-Options', 'nosniff');
      expect(content.body).toEqual(bytes);
      expect((await request(app).get(`/api/images/${imageId}`).expect(200)).body.annotations).toEqual([]);
    } finally { storage.close(); }
  });
  it('deduplicates concurrent uploads without replacing committed bytes and preserves them across restart', async () => {
    const { root, storage, app } = setup();
    let closed = false;
    try {
      const bytes = await imageBuffer(); const id = randomUUID();
      const results = await Promise.all([uploadImage(app, bytes, id), uploadImage(app, bytes, id)]);
      expect(results.map(row => row.status).sort()).toEqual([200, 201]);
      failure(await uploadImage(app, await imageBuffer('png', 40), id).expect(409), 'IMAGE_ID_CONFLICT');
      expect(storage.db.prepare('SELECT * FROM images').all()).toHaveLength(1);
      expect(fs.readdirSync(storage.files.uploads)).toEqual([]);
      storage.close(); closed = true;
      const restored = openStorage(root);
      try { expect((await request(createApp(restored)).get(`/api/images/${id}/content`).expect(200)).body).toEqual(bytes); }
      finally { restored.close(); }
    } finally { if (!closed) storage.close(); }
  });
  it('allocates transactional numbers, trims values, preserves creators and prevents replay resurrection', async () => {
    const { storage, app } = setup();
    try {
      const image = (await uploadImage(app, await imageBuffer()).expect(201)).body.id as string;
      const value = annotationInput();
      const original = await request(app).post(`/api/images/${image}/annotations`).send(value).expect(201);
      expect(original.body).toMatchObject({ number: 1, note: '标记说明', version: 1, createdByName: actor.actorName });
      await request(app).post(`/api/images/${image}/annotations`).send(value).expect(200);
      failure(await request(app).post(`/api/images/${image}/annotations`).send({ ...value, note: 'different' }).expect(409), 'ANNOTATION_ID_CONFLICT');
      setTestUser(app, '新昵称', actor.actorId);
      const updated = await request(app).patch(`/api/annotations/${value.id}`).send({ ...actor, actorName: '新昵称', version: 1, note: '已修改', severity: 'high' }).expect(200);
      expect(updated.body).toMatchObject({ version: 2, createdByName: actor.actorName, updatedByName: '新昵称', severity: 'high' });
      setTestUser(app, actor.actorName, actor.actorId);
      expect((await request(app).post(`/api/images/${image}/annotations`).send(value).expect(200)).body.version).toBe(2);
      failure(await request(app).patch(`/api/annotations/${value.id}`).send({ ...actor, version: 1, note: '不能覆盖', severity: 'low' }).expect(409), 'ANNOTATION_VERSION_CONFLICT');
      failure(await request(app).delete(`/api/annotations/${value.id}`).send({ ...actor, version: 1 }).expect(409), 'ANNOTATION_VERSION_CONFLICT');
      await request(app).delete(`/api/annotations/${value.id}`).send({ ...actor, version: 2 }).expect(204);
      failure(await request(app).post(`/api/images/${image}/annotations`).send(value).expect(409), 'ANNOTATION_DELETED');
      const created = await Promise.all(Array.from({ length: 20 }, () => request(app).post(`/api/images/${image}/annotations`).send(annotationInput())));
      expect(created.every(result => result.status === 201)).toBe(true);
      expect(created.map(result => result.body.number).sort((a: number, b: number) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 2));
    } finally { storage.close(); }
  });
  it('rejects invalid annotation fields and rolls back the counter if a database trigger fails', async () => {
    const { storage, app } = setup();
    try {
      const id = (await uploadImage(app, await imageBuffer()).expect(201)).body.id as string;
      for (const [extra, code] of [[{ note: '  ' }, 'ANNOTATION_NOTE_INVALID'], [{ note: '中'.repeat(2001) }, 'ANNOTATION_NOTE_INVALID'], [{ x: -0.01 }, 'ANNOTATION_COORDINATE_OUT_OF_RANGE'], [{ y: 1.1 }, 'ANNOTATION_COORDINATE_OUT_OF_RANGE'], [{ severity: 'critical' }, 'INVALID_REQUEST'], [{ number: 7 }, 'INVALID_REQUEST']] as const) {
        failure(await request(app).post(`/api/images/${id}/annotations`).send(annotationInput(extra)).expect(400), code);
      }
      storage.db.exec("CREATE TRIGGER deny_creation BEFORE INSERT ON annotation_creations BEGIN SELECT RAISE(ABORT, 'test failure'); END");
      await request(app).post(`/api/images/${id}/annotations`).send(annotationInput()).expect(500);
      expect(storage.db.prepare('SELECT * FROM annotations').all()).toEqual([]);
      storage.db.exec('DROP TRIGGER deny_creation');
      setTestUser(app, '人'.repeat(40), actor.actorId);
      const result = await request(app).post(`/api/images/${id}/annotations`).send(annotationInput({ x: 0, y: 1, note: '😀'.repeat(1000), actorName: '人'.repeat(40) })).expect(201);
      expect(result.body.number).toBe(1);
      setTestUser(app, actor.actorName, actor.actorId);
      failure(await request(app).patch(`/api/annotations/${result.body.id}`).send({ ...actor, note: 'a', severity: 'low', version: 1, x: 0.2 }).expect(400), 'INVALID_REQUEST');
    } finally { storage.close(); }
  });
  it('uses stable errors for missing files, malformed and oversized JSON, lock timeout and invalid IDs', async () => {
    const { root, storage, app } = setup();
    const locker = new Database(path.join(root, 'app.db'));
    try {
      const image = (await uploadImage(app, await imageBuffer()).expect(201)).body.id as string;
      failure(await request(app).get('/api/images/invalid').expect(400), 'INVALID_REQUEST');
      failure(await request(app).get(`/api/images/${randomUUID()}`).expect(404), 'IMAGE_NOT_FOUND');
      failure(await request(app).post(`/api/images/${image}/annotations`).set('Content-Type', 'application/json').send('{invalid').expect(400), 'INVALID_REQUEST');
      failure(await request(app).post(`/api/images/${image}/annotations`).send({ note: 'x'.repeat(33000) }).expect(413), 'REQUEST_TOO_LARGE');
      storage.db.pragma('busy_timeout=20'); locker.exec('BEGIN IMMEDIATE');
      failure(await request(app).post(`/api/images/${image}/annotations`).send(annotationInput()).expect(503), 'DATABASE_BUSY');
      locker.exec('ROLLBACK');
      await request(app).post(`/api/images/${image}/annotations`).send(annotationInput()).expect(201);
      fs.unlinkSync(storage.files.contentPath(`${image}/original.png`));
      failure(await request(app).get(`/api/images/${image}/content`).expect(404), 'IMAGE_FILE_MISSING');
    } finally { if (locker.inTransaction) locker.exec('ROLLBACK'); locker.close(); storage.close(); }
  });
});

describe('P4 real image validation', () => {
  it('rejects corrupt, mismatched, animated and incorrectly oriented files and cleans temporary data', async () => {
    const { storage, app } = setup();
    try {
      const png = await imageBuffer();
      const rotated = await sharp(await imageBuffer('jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      const upright = await sharp(await imageBuffer('jpeg')).withMetadata({ orientation: 1 }).jpeg().toBuffer();
      await uploadImage(app, upright, randomUUID(), 'upright.jpg', 'image/jpeg').expect(201);
      const secondFrame = await sharp({ create: { width: 32, height: 24, channels: 3, background: 'red' } }).png().toBuffer();
      const animatedWebp = await sharp([png, secondFrame], { join: { animated: true } }).webp({ loop: 0, delay: 100 }).toBuffer();
      expect((await sharp(animatedWebp, { animated: true }).metadata()).pages).toBe(2);
      const cases: [Buffer, string, string, number, string][] = [
        [Buffer.from('not an image'), 'fake.png', 'image/png', 400, 'IMAGE_INVALID'],
        [png.subarray(0, 50), 'broken.png', 'image/png', 400, 'IMAGE_INVALID'],
        [png, 'wrong.jpg', 'image/jpeg', 415, 'IMAGE_TYPE_UNSUPPORTED'],
        [png, 'wrong.svg', 'image/svg+xml', 415, 'IMAGE_TYPE_UNSUPPORTED'],
        [animatedPng(png), 'animation.png', 'image/png', 415, 'IMAGE_ANIMATION_UNSUPPORTED'],
        [animatedWebp, 'animation.webp', 'image/webp', 415, 'IMAGE_ANIMATION_UNSUPPORTED'],
        [rotated, 'rotation.jpg', 'image/jpeg', 415, 'IMAGE_ORIENTATION_UNSUPPORTED'],
      ];
      for (const [bytes, name, mime, status, code] of cases) failure(await uploadImage(app, bytes, randomUUID(), name, mime).expect(status), code);
      for (const orientation of [2, 3, 4, 5, 7, 8]) {
        const bytes = await sharp(await imageBuffer('jpeg')).withMetadata({ orientation }).jpeg().toBuffer();
        failure(await uploadImage(app, bytes, randomUUID(), 'rotated.jpg', 'image/jpeg').expect(415), 'IMAGE_ORIENTATION_UNSUPPORTED');
      }
      expect(storage.db.prepare('SELECT * FROM images').all()).toHaveLength(1);
      expect(fs.readdirSync(storage.files.uploads)).toEqual([]);
    } finally { storage.close(); }
  });
  it('bounds multipart envelopes and rejects extra fields, files, empty input and malformed forms', async () => {
    const { storage, app } = setup();
    try {
      const bytes = await imageBuffer();
      await request(app).post('/api/images').field('id', randomUUID()).field('extra', 'no').attach('file', bytes, { filename: 'sample.png', contentType: 'image/png' }).expect(400);
      failure(await uploadImage(app, bytes, 'invalid').expect(400), 'INVALID_REQUEST');
      await request(app).post('/api/images').field('id', randomUUID()).attach('file', bytes, { filename: 'one.png', contentType: 'image/png' }).attach('file', bytes, { filename: 'two.png', contentType: 'image/png' }).expect(400);
      failure(await uploadImage(app, Buffer.alloc(0)).expect(400), 'IMAGE_INVALID');
      await request(app).post('/api/images').set('Content-Type', 'multipart/form-data; boundary=x').send('--x\r\nbroken').expect(400);
      failure(await request(app).post('/api/images').set('Content-Type', 'multipart/form-data; boundary=x').send(Buffer.alloc(21 * 1024 * 1024 + 1, 97)).expect(413), 'REQUEST_TOO_LARGE');
      expect(storage.db.prepare('SELECT * FROM images').all()).toEqual([]);
      expect(fs.readdirSync(storage.files.uploads)).toEqual([]);
    } finally { storage.close(); }
  });
  it('accepts the byte limit, rejects one byte more and enforces decoded dimension limits', async () => {
    const { storage, app } = setup();
    try {
      const png = await imageBuffer();
      const max = Buffer.alloc(20 * 1024 * 1024); png.copy(max);
      await uploadImage(app, max).expect(201);
      failure(await uploadImage(app, Buffer.concat([max, Buffer.alloc(1)])).expect(413), 'IMAGE_TOO_LARGE');
      await uploadImage(app, await imageBuffer('png', 12000, 1)).expect(201);
      failure(await uploadImage(app, await imageBuffer('png', 12001, 1)).expect(400), 'IMAGE_INVALID');
      failure(await uploadImage(app, await imageBuffer('png', 1, 12001)).expect(400), 'IMAGE_INVALID');
      await uploadImage(app, await imageBuffer('png', 8000, 5000)).expect(201);
      failure(await uploadImage(app, await imageBuffer('png', 8000, 5001)).expect(400), 'IMAGE_INVALID');
      expect(fs.readdirSync(storage.files.uploads)).toEqual([]);
    } finally { storage.close(); }
  });
});
