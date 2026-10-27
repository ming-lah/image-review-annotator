import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { authenticatedUserSchema, loginNameSchema, roleSchema, type AuthenticatedUser, type Role } from '../../shared/auth-contracts.js';
import { legacyUserId } from './users.js';
import { ApiFailure } from '../http/errors.js';

export const sessionLifetime = 24 * 60 * 60 * 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function authRepository(db: Database.Database) {
  const columns = 'u.id AS userId,u.username,a.login_name AS loginName,a.role';
  function credential(loginName: string) {
    return db.prepare('SELECT user_id AS userId,password_hash AS passwordHash,enabled FROM user_auth WHERE login_name=?').get(loginName) as { userId: string; passwordHash: string; enabled: number } | undefined;
  }
  function current(token: string, now = Date.now()): AuthenticatedUser | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = db.prepare(`SELECT ${columns} FROM auth_sessions s JOIN user_auth a ON a.user_id=s.user_id JOIN users u ON u.id=a.user_id WHERE s.token_hash=? AND s.expires_at>? AND a.enabled=1`).get(digest(token), new Date(now).toISOString());
    const parsed = authenticatedUserSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }
  function issue(userId: string, now = Date.now()) {
    const token = randomBytes(32).toString('hex'); const expires = new Date(now + sessionLifetime);
    db.transaction(() => {
      db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(new Date(now).toISOString());
      const enabled = db.prepare('SELECT enabled FROM user_auth WHERE user_id=?').get(userId) as { enabled: number } | undefined;
      if (enabled?.enabled !== 1) throw new ApiFailure(401, 'AUTH_REQUIRED', '请重新登录');
      db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(digest(token), userId, new Date(now).toISOString(), expires.toISOString());
    }).immediate();
    return { token, expires, user: current(token, now)! };
  }
  function revoke(token: string) { db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token)); }
  function create(value: { loginName: string; username: string; passwordHash: string; role?: Role; userId?: string }) {
    const loginName = loginNameSchema.parse(value.loginName); const role = roleSchema.parse(value.role ?? 'member');
    const username = value.username.trim();
    if (!username || username.length > 40 || value.userId === legacyUserId) throw new ApiFailure(400, 'ACCOUNT_INVALID', '账号信息无效');
    if (!/^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(value.passwordHash)) throw new ApiFailure(400, 'ACCOUNT_INVALID', '密码凭证无效');
    return db.transaction(() => {
      if (credential(loginName)) throw new ApiFailure(409, 'LOGIN_NAME_EXISTS', '登录账号已存在');
      const userId = value.userId ?? randomUUID(); const now = new Date().toISOString();
      if (value.userId) {
        if (!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) throw new ApiFailure(404, 'USER_NOT_FOUND', '历史用户不存在');
        if (db.prepare('SELECT user_id FROM user_auth WHERE user_id=?').get(userId)) throw new ApiFailure(409, 'ACCOUNT_EXISTS', '该用户已有账号');
      } else db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(userId, username, now, now);
      db.prepare('INSERT INTO user_auth VALUES (?,?,?,?,1)').run(userId, loginName, value.passwordHash, role);
      return userId;
    }).immediate();
  }
  function change(loginName: string, value: { passwordHash?: string; role?: Role; enabled?: boolean }) {
    db.transaction(() => {
      const account = credential(loginNameSchema.parse(loginName));
      if (!account) throw new ApiFailure(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
      const row = db.prepare('SELECT role,enabled FROM user_auth WHERE user_id=?').get(account.userId) as { role: Role; enabled: number };
      if (row.role === 'admin' && row.enabled === 1 && (value.enabled === false || (value.role && value.role !== 'admin'))) {
        if ((db.prepare("SELECT count(*) AS n FROM user_auth WHERE role='admin' AND enabled=1").get() as { n: number }).n <= 1) throw new ApiFailure(409, 'LAST_ADMIN_REQUIRED', '必须保留至少一个有效管理员');
      }
      if (value.passwordHash) {
        if (!/^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(value.passwordHash)) throw new ApiFailure(400, 'ACCOUNT_INVALID', '密码凭证无效');
        db.prepare('UPDATE user_auth SET password_hash=? WHERE user_id=?').run(value.passwordHash, account.userId);
      }
      if (value.role) db.prepare('UPDATE user_auth SET role=? WHERE user_id=?').run(roleSchema.parse(value.role), account.userId);
      if (value.enabled !== undefined) db.prepare('UPDATE user_auth SET enabled=? WHERE user_id=?').run(Number(value.enabled), account.userId);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(account.userId);
    }).immediate();
  }
  return { credential, current, issue, revoke, create, change };
}
export type AuthRepository = ReturnType<typeof authRepository>;
