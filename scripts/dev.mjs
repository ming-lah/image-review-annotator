import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'src/server/server.ts'], { cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }),
  spawn(process.execPath, ['scripts/client.mjs'], { cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (child.connected) child.send('shutdown');
    else child.kill('SIGTERM');
  }
  const deadline = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }, 4500);
  deadline.unref();
}
for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', code => stop(code === 0 ? 0 : 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('disconnect', () => stop(0));
process.on('message', message => { if (message === 'shutdown') { stop(0); process.disconnect?.(); } });
