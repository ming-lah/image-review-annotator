import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openStorage } from '../../src/server/storage.js';
import { tempDir } from '../support/helpers.js';

describe('real SQLite storage', () => {
  it('enables pragmas and preserves data and migration timestamp across restart', () => {
    const directory = tempDir();
    const first = openStorage(directory);
    expect(first.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(first.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(first.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    const migrations = first.db.prepare('SELECT * FROM schema_migrations').all();
    expect(migrations).toHaveLength(1);
    expect(first.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: 'schema_migrations' }]);
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
