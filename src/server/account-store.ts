import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from './storage.js';
import { StartupError } from './config.js';
import { authRepository } from './persistence/auth.js';

// Account maintenance deliberately does not run imageFiles.scan or initialize business directories.
export function openAccountStore(dataDir: string, initialize = false) {
  if (!path.isAbsolute(dataDir)) throw new StartupError('INVALID_DATA_DIR', 'DATA_DIR must be absolute.');
  if (initialize) fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'app.db'), { fileMustExist: !initialize });
  try {
    db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000'); db.pragma('journal_mode = WAL');
    if (initialize) migrate(db, fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../../migrations/' : '../migrations/', import.meta.url)));
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_auth'").get()) throw new StartupError('AUTH_INITIALIZATION_REQUIRED', 'Stop your server and initialize accounts first.');
    return { db, accounts: authRepository(db), close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
