import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateDemoFixtures, type DemoFixture } from './demo-fixtures.js';
import { withIsolatedServer, withServerInDirectory } from './isolated-server.js';
import { annotationSchema, imageDetailSchema, imageSchema, type AnnotationDto } from '../../src/shared/review-contracts.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const temporaryRoot = path.join(projectRoot, 'tests', '.tmp');
export const defaultDemoRoot = path.join(temporaryRoot, 'basic-demo');
const ownerName = '.image-review-demo.json';
const owner = { kind: 'image-review-basic-demo', schemaVersion: 1 };
export const demoImageId = '10000000-0000-4000-8000-000000000001';
const actorA = { actorId: '20000000-0000-4000-8000-000000000001', actorName: '演示甲' };
const actorB = { actorId: '20000000-0000-4000-8000-000000000002', actorName: '演示乙' };
const annotationId = (number: number) => `30000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

export interface DemoManifest {
  schemaVersion: 1;
  fixtures: DemoFixture[];
  image: { id: string; path: string; sha256: string };
  annotations: AnnotationDto[];
  deletedNumbers: number[];
  nextNumber: number;
  verification: { fixtureApi: true; restart: true; bytesMatch: true; noUnsavedDrafts: true };
}

function safeRoot(target: string) {
  const absolute = path.resolve(target);
  const relative = path.relative(temporaryRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('DEMO_PATH_UNSAFE');
  const parts = path.relative(projectRoot, absolute).split(path.sep);
  let current = projectRoot;
  for (const segment of parts) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('DEMO_PATH_UNSAFE');
  }
  return absolute;
}
function verifyTree(root: string) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('DEMO_PATH_UNSAFE');
    if (entry.isDirectory()) verifyTree(path.join(root, entry.name));
  }
}
function verifyOwner(root: string) {
  const marker = path.join(root, ownerName);
  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== JSON.stringify(owner)) throw new Error('DEMO_NOT_OWNED');
}
function verifyStopped(root: string) {
  const dataDir = path.join(root, 'data');
  if (['app.db-wal', 'app.db-shm'].some(name => fs.existsSync(path.join(dataDir, name)))) throw new Error('DEMO_DATA_IN_USE');
}
async function exclusively<T>(target: string, action: (root: string) => Promise<T>) {
  const root = safeRoot(target);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  const lock = root + '.operation.lock';
  let descriptor: number;
  try { descriptor = fs.openSync(lock, 'wx'); } catch { throw new Error('DEMO_OPERATION_IN_PROGRESS'); }
  try { return await action(root); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
function removeOwnedStopped(root: string) {
  safeRoot(root); verifyTree(root); verifyOwner(root); verifyStopped(root);
  // Detach one verified tree before deletion. An open Windows SQLite handle also makes this fail safely.
  const detached = safeRoot(root + '.reset-' + randomUUID());
  fs.renameSync(root, detached);
  fs.rmSync(detached, { recursive: true, maxRetries: 3, retryDelay: 100 });
}

async function prepare(root: string, boundaries: boolean): Promise<DemoManifest> {
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('DEMO_ALREADY_EXISTS');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ownerName), JSON.stringify(owner), { flag: 'wx' });
  // An interrupted package is retained for inspection and can only be reset after it is stopped.
  const fixtureRoot = path.join(root, 'fixtures');
  const fixtures = await generateDemoFixtures(fixtureRoot, boundaries);
  await withIsolatedServer(async ({ base, fetch }) => {
      for (const fixture of fixtures) {
        const bytes = fs.readFileSync(path.join(fixtureRoot, fixture.name));
        const form = new FormData();
        form.set('id', randomUUID());
        form.set('file', new File([new Uint8Array(bytes)], fixture.name, { type: fixture.mime }));
        const result = await fetch(base + '/api/images', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
        assert.equal(result.status, fixture.expected.status, fixture.name);
        const body: unknown = await result.json();
        if (result.ok) {
          const image = imageSchema.parse(body);
          assert.equal(image.sha256, fixture.sha256);
          assert.equal(image.width, fixture.width); assert.equal(image.height, fixture.height);
        } else {
          const failure = body as { error: { code: string; requestId: string } };
          assert.equal(failure.error.code, fixture.expected.code, fixture.name);
          assert.ok(failure.error.requestId); assert.equal(failure.error.requestId, result.headers.get('x-request-id'));
        }
      }
  });
  return withServerInDirectory(path.join(root, 'data'), async ({ base, restart, signIn }) => {
      const clientA = await signIn(actorA.actorName, actorA.actorId);
      const clientB = await signIn(actorB.actorName, actorB.actorId);
      const fetch = clientA.fetch;
      const call = async (route: string, method = 'GET', value?: unknown) => {
        const client = (value as { actorId?: string } | undefined)?.actorId === actorB.actorId ? clientB : clientA;
        const result = await client.fetch(base + route, { method, headers: value ? { 'Content-Type': 'application/json' } : {}, body: value ? JSON.stringify(value) : undefined, signal: AbortSignal.timeout(20000) });
        if (!result.ok) throw new Error(`DEMO_API_FAILED_${result.status}`);
        return result;
      };
      const mainFixture = fixtures.find(fixture => fixture.name === 'grid-landscape.png')!;
      const form = new FormData(); form.set('id', demoImageId);
      form.set('file', new File([new Uint8Array(fs.readFileSync(path.join(fixtureRoot, mainFixture.name)))], mainFixture.name, { type: mainFixture.mime }));
      const uploaded = await fetch(base + '/api/images', { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
      assert.equal(uploaded.status, 201);
      const imageSha = imageSchema.parse(await uploaded.json()).sha256;
      assert.equal(imageSha, mainFixture.sha256);
      const points = [[0.5, 0.5], [0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.02]];
      const notes = ['中心：调整主标题对齐', '此条将删除，用于观察编号缺口', '右上：检查文字对比度', '多行说明：\n第一行检查间距\n第二行检查边缘', '<script>alert("demo")</script> 应作为纯文本显示', '长说明验证'.repeat(400)];
      for (let index = 0; index < points.length; index++) {
        const [x, y] = points[index];
        const value = { id: annotationId(index + 1), x, y, note: notes[index], severity: (['low', 'medium', 'high'] as const)[index % 3], ...actorA };
        const created = annotationSchema.parse(await (await call(`/api/images/${demoImageId}/annotations`, 'POST', value)).json());
        assert.equal(created.number, index + 1);
      }
      await call(`/api/annotations/${annotationId(3)}`, 'PATCH', { version: 1, note: '右上：已由演示乙复核，补充文字对比度要求', severity: 'high', ...actorB });
      await call(`/api/annotations/${annotationId(2)}`, 'DELETE', { version: 1, ...actorA });
      const before = imageDetailSchema.parse(await (await call(`/api/images/${demoImageId}`)).json());
      assert.deepEqual(before.annotations.map(row => row.number), [1, 3, 4, 5, 6]);
      assert.equal(before.annotations.find(row => row.number === 3)?.version, 2);
      assert.equal(before.annotations.find(row => row.number === 6)?.note.length, 2000);
      await restart();
      const after = imageDetailSchema.parse(await (await call(`/api/images/${demoImageId}`)).json());
      assert.deepEqual(after, before);
      const content = Buffer.from(await (await call(`/api/images/${demoImageId}/content`)).arrayBuffer());
      assert.equal(createHash('sha256').update(content).digest('hex'), imageSha);
      const manifest: DemoManifest = { schemaVersion: 1, fixtures, image: { id: demoImageId, path: `/?imageId=${demoImageId}`, sha256: imageSha }, annotations: after.annotations, deletedNumbers: [2], nextNumber: 7, verification: { fixtureApi: true, restart: true, bytesMatch: true, noUnsavedDrafts: true } };
      fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      fs.writeFileSync(path.join(root, 'OPEN-DEMO.txt'), `IMAGE REVIEW BASIC DEMO\n\nFrom the repository root (PowerShell):\n$env:HOST = '127.0.0.1'\n$env:PORT = '3002'\n$env:VITE_PORT = '5174'\n$env:DATA_DIR = (Resolve-Path 'tests/.tmp/basic-demo/data').Path\nnpm run dev\n\nOpen: http://127.0.0.1:5174${manifest.image.path}\nProduction: http://127.0.0.1:3002${manifest.image.path}\n\nSee tests/manual/basic-demo.md. This demo requires account login. Run account reset for the desired demo login before manual review; see tests/manual/basic-demo.md.\nStop your own instance before npm run demo:reset.\n`, { flag: 'wx' });
      return manifest;
  });
}

export const prepareDemo = (root = defaultDemoRoot, boundaries = false) => exclusively(root, checked => prepare(checked, boundaries));
export const resetDemo = (root = defaultDemoRoot, boundaries = false) => exclusively(root, async checked => {
  if (fs.existsSync(checked)) removeOwnedStopped(checked);
  return prepare(checked, boundaries);
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const unknown = process.argv.slice(3).some(argument => argument !== '--boundaries');
  if (!['prepare', 'reset'].includes(command ?? '') || unknown) {
    process.stderr.write('FAIL DEMO_INVALID_ARGUMENT: use prepare|reset [--boundaries]\n'); process.exitCode = 1;
  } else {
    try {
      const manifest = await (command === 'reset' ? resetDemo : prepareDemo)(defaultDemoRoot, process.argv.includes('--boundaries'));
      process.stdout.write(`PASS basic-demo: ${manifest.fixtures.length} fixtures, ${manifest.annotations.length} saved annotations; restart verified\nOpen after starting with demo DATA_DIR: http://127.0.0.1:5174${manifest.image.path}\nRead tests/.tmp/basic-demo/OPEN-DEMO.txt and tests/manual/basic-demo.md\n`);
    } catch (error) {
      const code = error instanceof Error && /^DEMO_[A-Z_]+$/.test(error.message) ? error.message : 'DEMO_PREPARATION_FAILED';
      process.stderr.write(`FAIL ${code}: keep existing data; stop only your own demo before reset; see tests/manual/basic-demo.md\n`); process.exitCode = 1;
    }
  }
}
