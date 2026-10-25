import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { launch, tempDir, freePort, waitFor } from '../support/helpers.js';

const entry = ['--import', 'tsx', 'src/server/server.ts'];
describe('startup and shutdown', () => {
  it.each([
    [{ PORT: 'wrong' }, 'INVALID_PORT'],
    [{ DATA_DIR: 'relative' }, 'INVALID_DATA_DIR'],
  ])('rejects bad configuration with nonzero exit: %s', async (env, code) => {
    const proc = launch(entry, { ...env, NODE_ENV: 'development' });
    expect(await proc.exited).toBe(1);
    expect(proc.output()).toContain(code);
    expect([...proc.output()].every(character => character.charCodeAt(0) < 128)).toBe(true);
  });
  it('rejects a file used as DATA_DIR without exposing its path', async () => {
    const file = path.join(tempDir(), 'blocked');
    fs.writeFileSync(file, 'file');
    const proc = launch(entry, { DATA_DIR: file });
    expect(await proc.exited).toBe(1);
    expect(proc.output()).toContain('DATA_DIRECTORY_UNAVAILABLE');
    expect(proc.output()).not.toContain(file);
  });
  it('rejects broken migration before listening', async () => {
    const root = tempDir();
    fs.cpSync('src/server', path.join(root, 'src/server'), { recursive: true });
    fs.cpSync('src/shared', path.join(root, 'src/shared'), { recursive: true });
    fs.mkdirSync(path.join(root, 'migrations'));
    fs.writeFileSync(path.join(root, 'migrations/001-bad.sql'), 'INVALID SQL;');
    const proc = launch(entry, { DATA_DIR: path.join(root, 'data'), PORT: String(await freePort()) }, root);
    expect(await proc.exited).toBe(1);
    expect(proc.output()).toContain('MIGRATION_FAILED');
  });
  it('rejects an occupied port, then starts and releases the same port twice', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', resolve));
    const env = { DATA_DIR: tempDir(), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' };
    try {
      const failed = launch(entry, env);
      expect(await failed.exited).toBe(1);
      expect(failed.output()).toContain('PORT_IN_USE');
      expect(failed.output()).toContain(`API port ${port} is already in use`);
      expect([...failed.output()].every(character => character.charCodeAt(0) < 128)).toBe(true);
    } finally { await new Promise<void>(resolve => blocker.close(() => resolve())); }
    for (let i = 0; i < 2; i++) {
      const proc = launch(entry, env);
      try { await waitFor(`http://127.0.0.1:${port}/api/ready`, proc.output); }
      finally { await proc.stop(); }
      expect(await proc.exited).toBe(0);
      expect(proc.output()).toContain('stopped');
    }
  });
  it('start without build produces a clear error', async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync('scripts/start.mjs', path.join(root, 'scripts/start.mjs'));
    const proc = launch(['scripts/start.mjs'], {}, root);
    expect(await proc.exited).toBe(1);
    expect(proc.output()).toContain('BUILD_MISSING');
  });
});
