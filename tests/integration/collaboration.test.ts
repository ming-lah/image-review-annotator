import { describe, expect, it } from 'vitest';
import { withIsolatedServer } from '../support/isolated-server.js';
import { readReviewEvents } from '../support/review-event-stream.js';
import { imageBuffer } from '../support/review-fixtures.js';
import { planReviewMerge, resolveReviewMerge } from '../../src/client/state/review-merge.js';
import { createWorkingCopy } from '../../src/client/state/working-copy.js';
import { RequestFailure } from '../../src/client/http/review-api.js';
import { saveResultSchema, workspaceDetailSchema, userSchema, type SaveReview, type WorkspaceDetail } from '../../src/shared/workbench-contracts.js';

const marker = (note: string) => ({ id: crypto.randomUUID(), x: 0.2, y: 0.3, note, severity: 'medium' as const, size: 24 });
async function setup(base: string) {
  const post = (route: string, body: unknown, method = 'POST') => fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const enter = async (username: string) => userSchema.parse(await (await post('/api/workbench/users/enter', { username })).json());
  const a = await enter('A'); const b = await enter('B'); const imageId = crypto.randomUUID();
  const form = new FormData(); form.set('id', imageId); form.set('file', new File([new Uint8Array(await imageBuffer())], 'same.png', { type: 'image/png' }));
  const upload = () => fetch(base + '/api/images', { method: 'POST', body: form, headers: { 'X-User-Id': a.userId } });
  expect((await upload()).status).toBe(201);
  const detail = async () => workspaceDetailSchema.parse(await (await fetch(`${base}/api/workbench/images/${imageId}`)).json());
  const save = (payload: SaveReview) => post(`/api/workbench/images/${imageId}/saves`, payload);
  const remove = (revision: string) => post(`/api/images/${imageId}`, { userId: b.userId, baseRevisionId: revision }, 'DELETE');
  return { a, b, imageId, form, upload, post, detail, save, remove };
}

describe('multi-client review transactions and update events', () => {
  it('persists one marker per version, restores unrelated drafts, and leaves formal edits/deletions untouched until save-all', async () => {
    await withIsolatedServer(async ({ base }) => {
      const s = await setup(base); const a = marker('a'); const b = marker('b'); const c = marker('c'); const initial = await s.detail();
      const formal = saveResultSchema.parse(await (await s.save({ requestId: crypto.randomUUID(), userId: s.a.userId, baseRevisionId: initial.revision.id, markers: [a, b, c] })).json()).detail;
      const copy = createWorkingCopy(); copy.bind(formal); copy.state.markers[0].note = 'target edit'; copy.state.markers[1].note = 'other edit'; copy.remove(c.id); copy.place({ x: 0.8, y: 0.8 });
      const send = async (_id: string, payload: SaveReview) => { const res = await s.save(payload); const body = await res.json(); if (!res.ok) throw new RequestFailure(body.error.message, res.status, body.error.code); return saveResultSchema.parse(body); };
      expect(await copy.save(s.a.userId, send, a.id)).toBe(true);
      const afterOne = await s.detail(); expect(afterOne.annotations.map(row => row.note)).toEqual(['target edit', 'b', 'c']); expect(afterOne.revision).toMatchObject({ versionNumber: 2, modified: 1, added: 0, deleted: 0 });
      const restored = createWorkingCopy(); restored.restore(copy.snapshot()!, s.imageId); expect(restored.count()).toBe(3); restored.state.markers[3].note = 'new draft';
      expect(await restored.save(s.a.userId, send)).toBe(true); const afterAll = await s.detail();
      expect(afterAll.annotations.map(row => row.note)).toEqual(['target edit', 'other edit', 'new draft']); expect(afterAll.revision).toMatchObject({ versionNumber: 3, modified: 1, added: 1, deleted: 1 });
    });
  });
  it('saves separate same-name images independently with the correct authors', async () => {
    await withIsolatedServer(async ({ base }) => {
      const one = await setup(base); const two = await setup(base); const before = await Promise.all([one.detail(), two.detail()]);
      const results = await Promise.all([one.save({ requestId: crypto.randomUUID(), userId: one.a.userId, baseRevisionId: before[0].revision.id, markers: [marker('one')] }), two.save({ requestId: crypto.randomUUID(), userId: two.b.userId, baseRevisionId: before[1].revision.id, markers: [marker('two')] })]);
      expect(results.map(row => row.status)).toEqual([200, 200]); const details = await Promise.all([one.detail(), two.detail()]);
      expect(details.map(row => row.annotations[0].note)).toEqual(['one', 'two']); expect(details.map(row => row.revision.userId)).toEqual([one.a.userId, two.b.userId]);
      expect(details.map(row => row.revision.versionNumber)).toEqual([1, 1]);
    });
  });
  it('allows exactly one same-base commit, then merges independent additions; a third write still invalidates a reviewed base', async () => {
    await withIsolatedServer(async ({ base, restart }) => {
      const s = await setup(base); const initial = await s.detail(); const ma = marker('A new'); const mb = marker('B new');
      const payloads = [s.a, s.b].map((user, index) => ({ requestId: crypto.randomUUID(), userId: user.userId, baseRevisionId: initial.revision.id, markers: [index ? mb : ma] }));
      const results = await Promise.all(payloads.map(s.save)); expect(results.map(row => row.status).sort()).toEqual([200, 409]);
      const winner = results[0].status === 200 ? 0 : 1; const loser = 1 - winner;
      const conflict = await results[loser].json(); expect(conflict.error.code).toBe('REVIEW_BASE_CHANGED'); expect(conflict.error.requestId).toBeTruthy();
      const latest = await s.detail(); expect(latest.annotations).toHaveLength(1); expect(latest.revision.versionNumber).toBe(1);
      const merged = resolveReviewMerge(planReviewMerge(initial, payloads[loser].markers, [], latest), {});
      const thirdMarker = marker('third party');
      const third = saveResultSchema.parse(await (await s.save({ requestId: crypto.randomUUID(), userId: s.a.userId, baseRevisionId: latest.revision.id, markers: [...latest.annotations, thirdMarker].map(({ id, x, y, note, severity, size }) => ({ id, x, y, note, severity, size })) })).json());
      const staleMerge = { ...payloads[loser], requestId: crypto.randomUUID(), baseRevisionId: latest.revision.id, markers: merged };
      expect((await s.save(staleMerge)).status).toBe(409);
      const finalMarkers = resolveReviewMerge(planReviewMerge(latest, merged, [], third.detail), {});
      const saved = saveResultSchema.parse(await (await s.save({ ...staleMerge, requestId: crypto.randomUUID(), baseRevisionId: third.savedRevisionId, markers: finalMarkers })).json());
      expect(saved.detail.annotations.map(row => row.number)).toEqual([1, 2, 3]); expect(saved.detail.annotations.map(row => row.note).sort()).toEqual(['A new', 'B new', 'third party']);
      expect(saved.detail.revision.versionNumber).toBe(3);
      await restart(); expect(await s.detail()).toEqual(saved.detail);
    });
  });
  it('confirms lost-response saves before checking their old base, even after another user saves', async () => {
    await withIsolatedServer(async ({ base }) => {
      const s = await setup(base); const first = await s.detail(); const a = marker('first');
      const payload = { requestId: crypto.randomUUID(), userId: s.a.userId, baseRevisionId: first.revision.id, markers: [a] };
      const original = saveResultSchema.parse(await (await s.save(payload)).json());
      const later = saveResultSchema.parse(await (await s.save({ ...payload, requestId: crypto.randomUUID(), userId: s.b.userId, baseRevisionId: original.savedRevisionId, markers: [{ ...a, note: 'later' }] })).json());
      const retry = saveResultSchema.parse(await (await s.save(payload)).json());
      expect(retry.created).toBe(false); expect(retry.savedRevisionId).toBe(original.savedRevisionId); expect(retry.detail).toEqual(later.detail);
      expect((await s.save({ ...payload, markers: [{ ...a, note: 'different' }] })).status).toBe(409);
      const history = await (await fetch(`${base}/api/workbench/images/${s.imageId}/history`)).json(); expect(history.total).toBe(3);
    });
  });
  it('serializes save/delete races and never resurrects an original or mixes same-name images', async () => {
    await withIsolatedServer(async ({ base }) => {
      const s = await setup(base); const first = await s.detail();
      const results = await Promise.all([s.save({ requestId: crypto.randomUUID(), userId: s.a.userId, baseRevisionId: first.revision.id, markers: [marker('racing')] }), s.remove(first.revision.id)]);
      if (results[0].status === 200) { expect(results[1].status).toBe(409); expect((await s.remove((await s.detail()).revision.id)).status).toBe(204); }
      else { expect(results[1].status).toBe(204); expect(results[0].status).toBe(404); }
      expect((await s.upload()).status).toBe(409);
      const newForm = new FormData(); const newId = crypto.randomUUID(); newForm.set('id', newId); newForm.set('file', new File([new Uint8Array(await imageBuffer())], 'same.png', { type: 'image/png' }));
      expect((await fetch(base + '/api/images', { method: 'POST', body: newForm })).status).toBe(201);
      const fresh = workspaceDetailSchema.parse(await (await fetch(`${base}/api/workbench/images/${newId}`)).json()); expect(fresh.annotations).toEqual([]); expect(fresh.image.id).not.toBe(s.imageId);
    });
  });
  it('streams committed uploads/saves/legacy changes/deletion, suppresses failed and duplicate saves, and reconciles after reconnect/restart', async () => {
    await withIsolatedServer(async ({ base, restart }) => {
      const stream = await readReviewEvents(base);
      let s: Awaited<ReturnType<typeof setup>>;
      try {
        s = await setup(base); const initial = await s.detail(); await stream.until(event => event.type === 'image.changed' && event.revisionId === initial.revision.id);
        expect((await s.upload()).status).toBe(200);
        const row = marker('first'); const payload = { requestId: crypto.randomUUID(), userId: s.a.userId, baseRevisionId: initial.revision.id, markers: [row] };
        const saved = saveResultSchema.parse(await (await s.save(payload)).json());
        await s.save(payload); expect((await s.save({ ...payload, requestId: crypto.randomUUID() })).status).toBe(409);
        const noOp = saveResultSchema.parse(await (await s.save({ ...payload, requestId: crypto.randomUUID(), baseRevisionId: saved.savedRevisionId })).json()); expect(noOp.created).toBe(false);
        const updated = await s.post(`/api/annotations/${row.id}`, { version: 1, note: 'legacy edit', severity: 'high', actorId: s.b.userId, actorName: 'B' }, 'PATCH'); expect(updated.status).toBe(200);
        const legacy = await s.detail(); await stream.until(event => event.type === 'image.changed' && event.revisionId === legacy.revision.id);
        expect(stream.events).toEqual([initial, saved.detail, legacy].map(value => ({ type: 'image.changed', imageId: s.imageId, revisionId: value.revision.id })));
        const extra = { ...marker('legacy new'), actorId: s.a.userId, actorName: 'A' };
        expect((await s.post(`/api/images/${s.imageId}/annotations`, extra)).status).toBe(201); const added = await s.detail();
        expect((await s.post(`/api/images/${s.imageId}/annotations`, extra)).status).toBe(200);
        expect((await s.post(`/api/annotations/${extra.id}`, { actorId: s.a.userId, actorName: 'A', version: 1 }, 'DELETE')).status).toBe(204);
        const deleted = await s.detail(); await stream.until(event => event.type === 'image.changed' && event.revisionId === deleted.revision.id);
        expect(stream.events.slice(3)).toEqual([added, deleted].map(value => ({ type: 'image.changed', imageId: s.imageId, revisionId: value.revision.id })));
        expect((await fetch(`${base}/api/workbench/images/${s.imageId}/history`)).status).toBe(200);
      } finally { await stream.close(); }
      // Changes can be missed while disconnected: the database snapshot, not event replay, is authoritative.
      const before = await s!.detail(); await s!.save({ requestId: crypto.randomUUID(), userId: s!.a.userId, baseRevisionId: before.revision.id, markers: [] });
      await restart(); const reconnected = await readReviewEvents(base);
      try {
        const current: WorkspaceDetail = await s!.detail(); expect(current.annotations).toEqual([]); expect(current.revision.id).not.toBe(before.revision.id);
        expect((await s!.remove(current.revision.id)).status).toBe(204);
        await reconnected.until(event => event.type === 'image.deleted' && event.imageId === s!.imageId);
        expect((await fetch(`${base}/api/workbench/images/${s!.imageId}`)).status).toBe(404);
      } finally { await reconnected.close(); }
    });
  });
});
