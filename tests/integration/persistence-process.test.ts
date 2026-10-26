import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { withIsolatedServer } from '../support/isolated-server.js';
import { imageBuffer, annotationInput, actor } from '../support/review-fixtures.js';
import type { ImageDetail, AnnotationDto } from '../../src/shared/review-contracts.js';

describe('P4 real process restart', () => {
  it('restores original bytes, edited/deleted records and creation replay history using the same DATA_DIR', async () => {
    await withIsolatedServer(async ({ base, restart, logs }) => {
      const bytes = await imageBuffer(); const form = new FormData(); form.set('id', crypto.randomUUID()); form.set('file', new File([new Uint8Array(bytes)], 'restart.png', { type: 'image/png' }));
      const upload = await fetch(`${base}/api/images`, { method: 'POST', body: form }); expect(upload.status).toBe(201); const image = await upload.json() as { id: string };
      const values = [annotationInput(), annotationInput(), annotationInput()];
      const json = (method: string, value: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      for (const value of values) expect((await fetch(`${base}/api/images/${image.id}/annotations`, json('POST', value))).status).toBe(201);
      const updated = await fetch(`${base}/api/annotations/${values[0].id}`, json('PATCH', { ...actor, version: 1, note: '重启保留的说明', severity: 'high' })); expect(updated.status).toBe(200);
      expect((await fetch(`${base}/api/annotations/${values[1].id}`, json('DELETE', { ...actor, version: 1 }))).status).toBe(204);
      const before = await (await fetch(`${base}/api/images/${image.id}`)).json() as ImageDetail;
      await restart();
      const after = await (await fetch(`${base}/api/images/${image.id}`)).json() as ImageDetail; expect(after).toEqual(before);
      const content = Buffer.from(await (await fetch(`${base}/api/images/${image.id}/content`)).arrayBuffer()); expect(createHash('sha256').update(content).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
      const replay = await fetch(`${base}/api/images/${image.id}/annotations`, json('POST', values[1])); expect(replay.status).toBe(409);
      const next = await fetch(`${base}/api/images/${image.id}/annotations`, json('POST', annotationInput())); expect((await next.json() as AnnotationDto).number).toBe(4);
      expect(logs()).not.toContain('重启保留的说明'); expect(logs()).not.toContain('restart.png'); expect(logs()).not.toContain(process.cwd());
    });
  });
});
