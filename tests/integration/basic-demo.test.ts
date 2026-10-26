import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareDemo, resetDemo, demoImageId } from '../support/basic-demo.js';
import { withServerInDirectory } from '../support/isolated-server.js';
import { launch, tempDir } from '../support/helpers.js';

describe('owned basic demonstration package', () => {
  it('generates validated fixtures and reproducible records, refuses overwrites/live reset and resets only its own stopped data', async () => {
    const parent = tempDir(); const root = path.join(parent, 'demo');
    const unrelated = path.join(parent, 'other-data.txt'); fs.writeFileSync(unrelated, 'preserve');
    const manifest = await prepareDemo(root, true);
    expect(manifest.fixtures).toHaveLength(18);
    expect(manifest.annotations.map(row => row.number)).toEqual([1, 3, 4, 5, 6]);
    expect(manifest.annotations.find(row => row.number === 3)).toMatchObject({ version: 2, createdByName: '演示甲', updatedByName: '演示乙' });
    expect(manifest.annotations.find(row => row.number === 6)?.note).toHaveLength(2000);
    expect(manifest.verification).toEqual({ fixtureApi: true, restart: true, bytesMatch: true, noUnsavedDrafts: true });
    for (const fixture of manifest.fixtures) {
      const bytes = fs.readFileSync(path.join(root, 'fixtures', fixture.name));
      expect(bytes.length).toBe(fixture.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    }
    expect((await sharp(path.join(root, 'fixtures', 'animated.webp'), { animated: true }).metadata()).pages).toBe(2);
    const apng = fs.readFileSync(path.join(root, 'fixtures', 'animated.png'));
    for (const chunk of ['acTL', 'fcTL', 'fdAT']) expect(apng.includes(Buffer.from(chunk))).toBe(true);
    expect((await sharp(apng).stats()).channels).toHaveLength(3);
    const db = new Database(path.join(root, 'data', 'app.db'), { readonly: true });
    try {
      expect(db.prepare('SELECT count(*) AS count FROM images').get()).toEqual({ count: 1 });
      expect(db.prepare('SELECT count(*) AS count FROM annotation_creations').get()).toEqual({ count: 6 });
      expect(db.prepare('SELECT next_annotation_number AS next FROM images').get()).toEqual({ next: 7 });
    } finally { db.close(); }
    const before = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
    await expect(prepareDemo(root)).rejects.toThrow('DEMO_ALREADY_EXISTS');
    expect(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).toBe(before);
    await withServerInDirectory(path.join(root, 'data'), async ({ base }) => {
      await expect(resetDemo(root)).rejects.toThrow('DEMO_DATA_IN_USE');
      expect((await fetch(base + '/api/ready')).ok).toBe(true);
      expect((await fetch(`${base}/api/images/${demoImageId}`)).ok).toBe(true);
    });
    const reset = await resetDemo(root);
    expect(reset.fixtures).toHaveLength(16);
    expect(reset.fixtures.map(row => [row.name, row.sha256])).toEqual(manifest.fixtures.slice(0, 16).map(row => [row.name, row.sha256]));
    expect(reset.annotations.map(row => [row.id, row.number, row.note, row.version])).toEqual(manifest.annotations.map(row => [row.id, row.number, row.note, row.version]));
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('preserve');
    expect(fs.existsSync(root + '.operation.lock')).toBe(false);
    expect(fs.readdirSync(parent).sort()).toEqual(['demo', 'other-data.txt']);
  }, 60000);

  it('rejects unowned directories and paths outside the project test data root without deleting their files', async () => {
    const root = tempDir(); const file = path.join(root, 'keep.txt'); fs.writeFileSync(file, 'keep');
    await expect(resetDemo(root)).rejects.toThrow('DEMO_NOT_OWNED');
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
    await expect(prepareDemo(path.resolve('workspace', 'not-a-demo'))).rejects.toThrow('DEMO_PATH_UNSAFE');
    await expect(resetDemo(path.resolve('tests/.tmp'))).rejects.toThrow('DEMO_PATH_UNSAFE');
  });

  it('refuses junctions at the root, in ancestors or inside an owned tree', async () => {
    const parent = tempDir(); const outside = tempDir(); const link = path.join(parent, 'link');
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    fs.symlinkSync(outside, link, 'junction');
    await expect(prepareDemo(link)).rejects.toThrow('DEMO_PATH_UNSAFE');
    await expect(prepareDemo(path.join(link, 'child'))).rejects.toThrow('DEMO_PATH_UNSAFE');
    const owned = path.join(parent, 'owned'); fs.mkdirSync(owned);
    fs.writeFileSync(path.join(owned, '.image-review-demo.json'), JSON.stringify({ kind: 'image-review-basic-demo', schemaVersion: 1 }));
    fs.symlinkSync(outside, path.join(owned, 'escape'), 'junction');
    await expect(resetDemo(owned)).rejects.toThrow('DEMO_PATH_UNSAFE');
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('refuses a concurrent operation and leaves its existing lock intact', async () => {
    const root = path.join(tempDir(), 'demo');
    fs.writeFileSync(root + '.operation.lock', 'other operation');
    await expect(prepareDemo(root)).rejects.toThrow('DEMO_OPERATION_IN_PROGRESS');
    expect(fs.readFileSync(root + '.operation.lock', 'utf8')).toBe('other operation');
    expect(fs.existsSync(root)).toBe(false);
  });

  it('returns nonzero ASCII diagnostics for invalid CLI arguments', async () => {
    const proc = launch(['--import', 'tsx', 'tests/support/basic-demo.ts', 'unknown']);
    try {
      expect(await proc.exited).toBe(1);
      expect(proc.output()).toContain('DEMO_INVALID_ARGUMENT');
      expect([...proc.output()].every(char => char.charCodeAt(0) < 128)).toBe(true);
    } finally { await proc.stop(); }
  });
});
