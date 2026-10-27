import path from 'node:path';
import os from 'node:os';

export class StartupError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export interface AuthOptions { origins: string[]; secure: boolean }
export function readAuthConfig(env = process.env): AuthOptions {
  if (env.APP_ORIGIN !== undefined) {
    try {
      const origin = new URL(env.APP_ORIGIN);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
      if (origin.origin !== env.APP_ORIGIN || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol) || (!loopback && origin.protocol !== 'https:')) throw new Error();
      return { origins: [origin.origin], secure: origin.protocol === 'https:' };
    } catch { throw new StartupError('INVALID_APP_ORIGIN', 'APP_ORIGIN must be an exact HTTPS origin, or loopback HTTP origin, without a trailing slash.'); }
  }
  if (env.HOST && !['127.0.0.1', 'localhost', '::1'].includes(env.HOST)) throw new StartupError('APP_ORIGIN_REQUIRED', 'Non-loopback HOST requires an explicit HTTPS APP_ORIGIN.');
  const ports = env.NODE_ENV === 'production' ? [env.PORT ?? '3002'] : [env.PORT ?? '3002', env.VITE_PORT ?? '5174'];
  if (ports.some(port => !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new StartupError('INVALID_AUTH_PORT', 'Auth origin ports must be valid integers.');
  return { origins: [...new Set(ports.flatMap(port => [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]))], secure: false };
}

export function defaultDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'ImageReviewAnnotator');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'ImageReviewAnnotator');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'ImageReviewAnnotator');
}

export function readConfig(env = process.env) {
  const portText = env.PORT ?? '3002';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new StartupError('INVALID_PORT', 'PORT must be an integer between 1 and 65535');
  }
  const dataDir = env.DATA_DIR ?? defaultDataDir(process.platform, env);
  if (!path.isAbsolute(dataDir)) throw new StartupError('INVALID_DATA_DIR', 'DATA_DIR must be an absolute path');
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new StartupError('INVALID_HOST', 'HOST must not be empty');
  return { host, port: Number(portText), dataDir, auth: readAuthConfig(env) };
}
