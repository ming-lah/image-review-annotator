import { describe, it, expect } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { createApp } from '../../src/server/app.js';
import { openStorage, checkDirectory } from '../../src/server/storage.js';
import { tempDir } from '../support/helpers.js';

describe('API contract', () => {
  it('returns real health/ready and JSON 404 for all unknown API paths', async () => {
    const storage = openStorage(tempDir());
    try {
      const app = createApp(storage);
      expect((await request(app).get('/api/health').expect(200)).body).toEqual({ status: 'ok' });
      expect((await request(app).get('/api/ready').expect(200)).body).toEqual({ status: 'ready' });
      for (const url of ['/api/unknown', '/api', '/api/unknown?secret=private']) {
        const result = await request(app).get(url).expect(404).expect('Content-Type', /json/);
        expect(result.body.error.code).toBe('API_NOT_FOUND');
        expect(result.body.error.requestId).toBe(result.headers['x-request-id']);
      }
    } finally { storage.close(); }
  });
  it('closed SQLite returns 503 while health remains alive; no internals leak', async () => {
    const storage = openStorage(tempDir());
    storage.close();
    const app = createApp(storage);
    const result = await request(app).get('/api/ready').expect(503);
    expect(result.body.error).toMatchObject({ code: 'SERVICE_NOT_READY', requestId: result.headers['x-request-id'] });
    expect(JSON.stringify(result.body)).not.toMatch(/SELECT|sqlite|Error:|[A-Z]:\\|stack/);
    await request(app).get('/api/health').expect(200);
  });
  it('detects a real missing data directory and recovers after restoring it', async () => {
    const root = tempDir();
    const storage = openStorage(root);
    const app = createApp(storage);
    const moved = root + '-moved';
    // Close SQLite before renaming its directory on Windows; exercise the real write/cleanup probe independently.
    storage.close();
    fs.renameSync(root, moved);
    const directoryApp = createApp({ checkReady: () => checkDirectory(root) });
    try {
      await request(directoryApp).get('/api/ready').expect(503);
      fs.renameSync(moved, root);
      await request(directoryApp).get('/api/ready').expect(200);
      await request(app).get('/api/ready').expect(503);
    } finally { if (fs.existsSync(moved)) fs.renameSync(moved, root); }
  });
});
