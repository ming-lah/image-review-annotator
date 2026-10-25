import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { StartupError } from './config.js';

export function checkDirectory(dataDir: string) {
  const probe = path.join(dataDir, `.ready-${randomUUID()}`);
  let created = false;
  try {
    fs.writeFileSync(probe, 'ready', { flag: 'wx' });
    created = true;
    fs.unlinkSync(probe);
    created = false;
  } finally {
    if (created) fs.rmSync(probe, { force: true });
  }
}

export function migrate(db: Database.Database, directory: string) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = db.prepare('SELECT name, checksum FROM schema_migrations').all() as { name: string; checksum: string }[];
  const files = fs.readdirSync(directory).filter(name => /^\d+[-_].+\.sql$/.test(name)).sort();
  if (applied.some(row => !files.includes(row.name))) throw new Error('Missing applied migration');
  for (const name of files) {
    const sql = fs.readFileSync(path.join(directory, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = applied.find(row => row.name === name);
    if (previous) {
      if (previous.checksum !== checksum) throw new Error('Migration checksum mismatch');
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(name, checksum, new Date().toISOString());
    })();
  }
}

export function openStorage(dataDir: string, migrations = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../../migrations/' : '../migrations/', import.meta.url))) {
  try { fs.mkdirSync(dataDir, { recursive: true }); checkDirectory(dataDir); }
  catch { throw new StartupError('DATA_DIRECTORY_UNAVAILABLE', '数据目录创建或写入失败，请检查 DATA_DIR 和权限'); }
  let db: Database.Database;
  try { db = new Database(path.join(dataDir, 'app.db')); }
  catch { throw new StartupError('DATABASE_OPEN_FAILED', '数据库打开失败，请检查数据库文件和权限'); }
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    try { migrate(db, migrations); }
    catch { throw new StartupError('MIGRATION_FAILED', '数据库迁移失败，请检查迁移文件和数据库版本'); }
    return { db, checkReady() { db.prepare('SELECT 1').get(); checkDirectory(dataDir); }, close() { db.close(); } };
  } catch (error) { db.close(); throw error; }
}
export type Storage = ReturnType<typeof openStorage>;
