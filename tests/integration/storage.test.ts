import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openStorage, checkDirectory } from '../../src/server/storage.js';
import { tempDir } from '../support/helpers.js';

describe('real SQLite storage', () => {
  it('removes an owned readiness probe if the write fails after file creation', () => {
    const root = tempDir();
    const write = vi.spyOn(fs, 'writeSync').mockImplementationOnce(() => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); });
    try { expect(() => checkDirectory(root)).toThrow('full'); expect(fs.readdirSync(root)).toEqual([]); }
    finally { write.mockRestore(); }
  });
  it('upgrades an unchanged P0-P1 database using the new migration', () => {
    const root = tempDir(); const oldMigrations = path.join(root, 'old-migrations'); fs.mkdirSync(oldMigrations);
    fs.copyFileSync('migrations/001-initialize.sql', path.join(oldMigrations, '001-initialize.sql'));
    const old = openStorage(root, oldMigrations); const original = old.db.prepare('SELECT * FROM schema_migrations').get(); old.close();
    const upgraded = openStorage(root);
    try {
      expect(upgraded.db.prepare('SELECT * FROM schema_migrations WHERE name=?').get('001-initialize.sql')).toEqual(original);
      expect(upgraded.db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(6);
      expect(upgraded.db.prepare('SELECT * FROM images').all()).toEqual([]);
    } finally { upgraded.close(); }
  });
  it('enables pragmas and preserves data and migration timestamp across restart', () => {
    const directory = tempDir();
    const first = openStorage(directory);
    expect(first.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(first.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(first.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    const migrations = first.db.prepare('SELECT * FROM schema_migrations').all();
    expect(migrations).toHaveLength(6);
    expect(first.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual(['annotation_creations', 'annotations', 'auth_sessions', 'deleted_images', 'images', 'review_baselines', 'review_changes', 'review_revisions', 'review_save_receipts', 'schema_migrations', 'user_auth', 'users'].map(name => ({ name })));
    first.db.exec("CREATE TABLE persistence_probe (value TEXT); INSERT INTO persistence_probe VALUES ('retained')");
    first.checkReady();
    first.close();
    const second = openStorage(directory);
    try {
      expect(second.db.prepare('SELECT * FROM schema_migrations').all()).toEqual(migrations);
      expect(second.db.prepare('SELECT value FROM persistence_probe').get()).toEqual({ value: 'retained' });
      expect(fs.readdirSync(directory).some(name => name.startsWith('.ready-'))).toBe(false);
    } finally { second.close(); }
  });
  it('rolls back failing migration and can reopen after correction', () => {
    const root = tempDir();
    const migrations = path.join(root, 'migrations');
    fs.mkdirSync(migrations);
    fs.writeFileSync(path.join(migrations, '001-test.sql'), 'CREATE TABLE rollback_probe (id INTEGER); INVALID SQL;');
    expect(() => openStorage(root, migrations)).toThrow();
    fs.writeFileSync(path.join(migrations, '001-test.sql'), 'CREATE TABLE rollback_probe (id INTEGER);');
    const storage = openStorage(root, migrations);
    try { expect(storage.db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(1); }
    finally { storage.close(); }
  });
  it('rejects changes to applied migrations', () => {
    const root = tempDir();
    const migrations = path.join(root, 'migrations');
    fs.mkdirSync(migrations);
    const file = path.join(migrations, '001-test.sql');
    fs.writeFileSync(file, 'SELECT 1;');
    openStorage(root, migrations).close();
    fs.writeFileSync(file, 'SELECT 2;');
    expect(() => openStorage(root, migrations)).toThrow('migration failed');
  });
});
