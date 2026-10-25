import path from 'node:path';
import os from 'node:os';

export class StartupError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function defaultDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'ImageReviewAnnotator');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'ImageReviewAnnotator');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'ImageReviewAnnotator');
}

export function readConfig(env = process.env) {
  const portText = env.PORT ?? '3000';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new StartupError('INVALID_PORT', 'PORT 必须为 1–65535 的整数');
  }
  const dataDir = env.DATA_DIR ?? defaultDataDir(process.platform, env);
  if (!path.isAbsolute(dataDir)) throw new StartupError('INVALID_DATA_DIR', 'DATA_DIR 必须是绝对路径');
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new StartupError('INVALID_HOST', 'HOST 不能为空');
  return { host, port: Number(portText), dataDir };
}
