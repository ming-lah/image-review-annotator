import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.resolve(root, 'dist');
  if (path.dirname(output) !== path.resolve(root)) throw new Error('Unexpected build output directory');
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('Build output directory must not be a link');
  fs.rmSync(output, { recursive: true, force: true });
} catch {
  process.stderr.write('BUILD_CLEANUP_FAILED: Cannot clean the build output directory.\n');
  process.exitCode = 1;
}
