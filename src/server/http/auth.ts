import { Router, json, type Request, type Response, type RequestHandler } from 'express';
import { authenticatedUserSchema, loginSchema, registrationSchema, type AuthenticatedUser } from '../../shared/auth-contracts.js';
import type { AuthRepository } from '../persistence/auth.js';
import type { AuthOptions } from '../config.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { ApiFailure, parseInput } from './errors.js';

export const sessionCookie = 'image_review_session';
export function requestToken(req: Request) {
  const values = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(sessionCookie + '='));
  return values.length === 1 ? values[0].slice(sessionCookie.length + 1) : '';
}
export function currentUser(res: Response) { return authenticatedUserSchema.parse(res.locals.user); }
export function authenticatedBody(body: unknown, user: AuthenticatedUser, legacy = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const fields = body as Record<string, unknown>;
  const identity = legacy ? { actorId: user.userId, actorName: user.username } : { userId: user.userId };
  for (const [key, value] of Object.entries(identity)) {
    if (fields[key] !== undefined && fields[key] !== value) throw new ApiFailure(403, 'ACTOR_MISMATCH', '操作人必须与当前登录账号一致');
  }
  return { ...fields, ...identity };
}
export function requireAdmin(res: Response) {
  if (currentUser(res).role !== 'admin') throw new ApiFailure(403, 'FORBIDDEN', '仅管理员可以删除整张图片');
}
export function createAuth(repository: AuthRepository, options: AuthOptions) {
  const router = Router();
  const attempts = new Map<string, { n: number; until: number }>();
  const registrations = new Map<string, { n: number; until: number }>();
  const checkOrigin: RequestHandler = (req, _res, next) => {
    if (!options.origins.includes(req.get('origin') ?? '')) throw new ApiFailure(403, 'ORIGIN_FORBIDDEN', '请求来源无效，请从正式页面重新操作');
    next();
  };
  const requireSession: RequestHandler = (req, res, next) => {
    const token = requestToken(req); const user = repository.current(token);
    if (!user) throw new ApiFailure(401, 'AUTH_REQUIRED', '登录已失效，请重新登录；未保存输入仍保留');
    res.locals.user = user; res.locals.actorId = user.userId;
    next();
  };
  const guard: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    requireSession(req, res, () => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
      checkOrigin(req, res, () => {
        if (req.get('x-expected-user-id') !== currentUser(res).userId) throw new ApiFailure(409, 'AUTH_CONTEXT_CHANGED', '当前账号已变化，请用原账号重新登录后核对输入');
        if (req.get('x-user-id') && req.get('x-user-id') !== currentUser(res).userId) throw new ApiFailure(403, 'ACTOR_MISMATCH', '操作人必须与当前登录账号一致');
        next();
      });
    });
  };
  const limit = (keys: string[], now: number) => {
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (attempts.size > 4096 || keys.some(key => (attempts.get(key)?.n ?? 0) >= (key.startsWith('ip:') ? 30 : 10))) throw new ApiFailure(429, 'LOGIN_RATE_LIMITED', '登录尝试过多，请稍后重试');
    for (const key of keys) { const entry = attempts.get(key) ?? { n: 0, until: now + 15 * 60 * 1000 }; entry.n++; attempts.set(key, entry); }
  };
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/register', checkOrigin, json({ limit: '2kb' }), async (req, res) => {
    const now = Date.now(); const key = req.ip ?? 'unknown';
    for (const [ip, entry] of registrations) if (entry.until <= now) registrations.delete(ip);
    if ((registrations.get(key)?.n ?? 0) >= 5 || (!registrations.has(key) && registrations.size >= 4096)) throw new ApiFailure(429, 'REGISTRATION_RATE_LIMITED', '注册尝试过多，请稍后重试');
    const entry = registrations.get(key) ?? { n: 0, until: now + 15 * 60 * 1000 }; entry.n++; registrations.set(key, entry);
    const value = parseInput(registrationSchema, req.body);
    if (repository.credential(value.loginName)) throw new ApiFailure(409, 'LOGIN_NAME_EXISTS', '登录账号已存在');
    let passwordHash: string;
    try { passwordHash = await hashPassword(value.password); }
    catch (error) {
      if (error instanceof ApiFailure && error.code === 'LOGIN_RATE_LIMITED') throw new ApiFailure(429, 'REGISTRATION_RATE_LIMITED', '注册请求过多，请稍后重试');
      throw error;
    }
    const username = value.username || value.loginName;
    const userId = repository.create({ loginName: value.loginName, username, passwordHash, role: 'member' });
    res.status(201).json({ userId, username, loginName: value.loginName, role: 'member' });
  });
  router.post('/login', checkOrigin, json({ limit: '2kb' }), async (req, res) => {
    limit(['ip:' + req.ip], Date.now());
    const value = parseInput(loginSchema, req.body);
    limit(['account:' + value.loginName], Date.now());
    const record = repository.credential(value.loginName);
    const valid = await verifyPassword(value.password, record?.passwordHash);
    // Password hashing yields: re-read so a concurrent reset/disable cannot issue a fresh session.
    const latest = repository.credential(value.loginName);
    if (!valid || !record || !latest?.enabled || latest.passwordHash !== record.passwordHash) throw new ApiFailure(401, 'INVALID_CREDENTIALS', '账号或密码错误，或账号已停用');
    repository.revoke(requestToken(req));
    const session = repository.issue(latest.userId);
    res.cookie(sessionCookie, session.token, { httpOnly: true, sameSite: 'lax', secure: options.secure, path: '/', expires: session.expires });
    res.json(session.user);
  });
  router.get('/me', requireSession, (_req, res) => { res.json(currentUser(res)); });
  router.post('/logout', guard, (req, res) => {
    repository.revoke(requestToken(req));
    res.clearCookie(sessionCookie, { httpOnly: true, sameSite: 'lax', secure: options.secure, path: '/' });
    res.sendStatus(204);
  });
  return { router, guard };
}
