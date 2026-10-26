import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { User } from '../../shared/workbench-contracts.js';
import { ApiFailure } from '../http/errors.js';

export const legacyUserId = '00000000-0000-4000-8000-000000000001';
export function usersRepository(db: Database.Database) {
  function remember(userId: string, username: string): User {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users(id,username,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,updated_at=excluded.updated_at').run(userId, username, now, now);
    return { userId, username };
  }
  function requireUser(userId: string): User {
    const user = db.prepare('SELECT id AS userId,username FROM users WHERE id=?').get(userId) as User | undefined;
    if (!user) throw new ApiFailure(400, 'USER_REQUIRED', '请先输入 username 进入工作台');
    return user;
  }
  return { remember, requireUser, enter: (username: string, userId?: string) => remember(userId ?? randomUUID(), username) };
}
