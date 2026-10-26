import assert from 'node:assert/strict';
import { withIsolatedServer } from './isolated-server.js';
import { imageBuffer, annotationInput } from './review-fixtures.js';

try {
  await withIsolatedServer(async ({ base }) => {
    const form = new FormData(); form.set('id', crypto.randomUUID()); form.set('file', new File([new Uint8Array(await imageBuffer())], 'sample.png', { type: 'image/png' }));
    const uploaded = await fetch(`${base}/api/images`, { method: 'POST', body: form }); assert.equal(uploaded.status, 201);
    const image = await uploaded.json() as { id: string };
    for (const [value, code] of [[{ note: '  ' }, 'ANNOTATION_NOTE_INVALID'], [{ x: 1.01 }, 'ANNOTATION_COORDINATE_OUT_OF_RANGE']] as const) {
      const result = await fetch(`${base}/api/images/${image.id}/annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(annotationInput(value)) });
      const body = await result.json() as { error: { code: string; requestId: string } };
      assert.equal(result.status, 400); assert.equal(body.error.code, code); assert.equal(body.error.requestId, result.headers.get('x-request-id')); assert.ok(body.error.requestId);
      process.stdout.write(`PASS 400 ${code} requestId=${body.error.requestId}\n`);
    }
    const detail = await (await fetch(`${base}/api/images/${image.id}`)).json() as { annotations: unknown[] }; assert.deepEqual(detail.annotations, []);
  });
  process.stdout.write('PASS isolated invalid-annotation reproduction; resources cleaned\n');
} catch { process.stderr.write('FAIL invalid-annotation reproduction; inspect tests and server configuration\n'); process.exitCode = 1; }
