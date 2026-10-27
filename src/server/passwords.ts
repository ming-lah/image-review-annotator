import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiFailure } from './http/errors.js';
import { passwordSchema } from '../shared/auth-contracts.js';

const cost = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const dummy = `scrypt:131072:8:1:${'00'.repeat(16)}:${'00'.repeat(32)}`;
let active = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new ApiFailure(429, 'LOGIN_RATE_LIMITED', '登录请求过多，请稍后重试');
  active++;
  try { return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, cost, (error, key) => error ? reject(error) : resolve(key))); }
  finally { active--; }
}
export async function hashPassword(password: string) {
  passwordSchema.parse(password);
  const salt = randomBytes(16); const key = await derive(password, salt);
  return `scrypt:131072:8:1:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded?: string) {
  const valid = typeof encoded === 'string' && /^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{64}$/.test(encoded);
  const parts = (valid ? encoded : dummy).split(':');
  const actual = await derive(password, Buffer.from(parts[4], 'hex'));
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex')) && valid;
}
