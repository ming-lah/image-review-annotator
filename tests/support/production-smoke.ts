import assert from 'node:assert/strict';
import { withIsolatedServer } from './isolated-server.js';
import { imageBuffer } from './review-fixtures.js';
import { readReviewEvents } from './review-event-stream.js';
import { createWorkingCopy } from '../../src/client/state/working-copy.js';
import { workspaceDetailSchema, saveResultSchema, historyDetailSchema, librarySchema } from '../../src/shared/workbench-contracts.js';

try {
  await withIsolatedServer(async ({ base, restart, fetch, signIn }) => {
    const page = await fetch(base); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /\/assets\//);
    const asset = html.match(/src="(\/assets\/[^" ]+)"/)?.[1]; assert.ok(asset); assert.equal((await fetch(base + asset)).status, 200);
    const originalIdentity = await (await fetch(base + '/api/auth/me')).json();
    const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'ui-member', password: '' }) });
    assert.equal(registration.status, 201); assert.equal(registration.headers.has('set-cookie'), false);
    const registered = await registration.json() as { userId: string; role: string; username: string };
    assert.equal(registered.role, 'member'); assert.equal(registered.username, 'ui-member');
    assert.deepEqual(await (await fetch(base + '/api/auth/me')).json(), originalIdentity);
    const memberLogin = await globalThis.fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'ui-member', password: '' }) });
    assert.equal(memberLogin.status, 200); const memberCookie = memberLogin.headers.get('set-cookie')!.split(';')[0];
    const post = (url: string, value: unknown) => userFetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const { user, fetch: userFetch } = await signIn('生产验证');
    const bytes = await imageBuffer(); const form = new FormData(); form.set('id', crypto.randomUUID()); form.set('file', new File([new Uint8Array(bytes)], 'production.png', { type: 'image/png' }));
    const upload = await userFetch(`${base}/api/images`, { method: 'POST', headers: { 'X-User-Id': user.userId }, body: form }); assert.equal(upload.status, 201); const image = await upload.json() as { id: string };
    const forbidden = await globalThis.fetch(`${base}/api/images/${image.id}`, { method: 'DELETE', headers: { Cookie: memberCookie, Origin: base, 'X-Expected-User-Id': registered.userId, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(forbidden.status, 403);
    const detail = workspaceDetailSchema.parse(await (await userFetch(`${base}/api/workbench/images/${image.id}`)).json());
    const a = { id: crypto.randomUUID(), x: 0.2, y: 0.3, note: 'first', severity: 'medium', size: 12 }; const b = { ...a, id: crypto.randomUUID(), note: 'retained', size: 48 };
    const payload = { requestId: crypto.randomUUID(), baseRevisionId: detail.revision.id, userId: user.userId, markers: [a, b] };
    const first = await (async () => {
      const stream = await readReviewEvents(base, fetch);
      try {
        const saved = await post(`/api/workbench/images/${image.id}/saves`, payload); assert.equal(saved.status, 200);
        const value = saveResultSchema.parse(await saved.json());
        await stream.until(event => event.type === 'image.changed' && event.imageId === image.id && event.revisionId === value.savedRevisionId);
        return value;
      } finally { await stream.close(); }
    })();
    assert.equal(first.detail.revision.versionNumber, 1); assert.equal(first.libraryItem?.annotationCount, 2);
    const duplicate = saveResultSchema.parse(await (await post(`/api/workbench/images/${image.id}/saves`, payload)).json()); assert.equal(duplicate.savedRevisionId, first.savedRevisionId); assert.equal(duplicate.created, false);
    const second = saveResultSchema.parse(await (await post(`/api/workbench/images/${image.id}/saves`, { ...payload, requestId: crypto.randomUUID(), baseRevisionId: first.savedRevisionId, markers: [{ ...a, note: 'changed', size: 31 }, b] })).json());
    await restart();
    const restored = workspaceDetailSchema.parse(await (await userFetch(`${base}/api/workbench/images/${image.id}`)).json()); assert.deepEqual(restored, second.detail);
    const historical = historyDetailSchema.parse(await (await userFetch(`${base}/api/workbench/images/${image.id}/history/${first.savedRevisionId}`)).json()); assert.equal(historical.annotations[0].note, 'first'); assert.equal(restored.annotations[0].note, 'changed'); assert.equal(restored.annotations[1].note, 'retained'); assert.equal(restored.annotations[0].size, 31); assert.equal(restored.annotations[1].size, 48); assert.equal(historical.annotations[0].size, 12); assert.equal(restored.revision.versionNumber, 2);
    const library = librarySchema.parse(await (await userFetch(base + '/api/workbench/images')).json()); assert.equal(library.total, 1); assert.equal(library.items[0].revisionCount, 3);
    const content = await userFetch(`${base}/api/images/${image.id}/content`); assert.equal(content.status, 200); assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
    const otherForm = new FormData(); const otherId = crypto.randomUUID(); otherForm.set('id', otherId); otherForm.set('file', new File([new Uint8Array(bytes)], 'other.png', { type: 'image/png' }));
    assert.equal((await userFetch(base + '/api/images', { method: 'POST', headers: { 'X-User-Id': user.userId }, body: otherForm })).status, 201);
    const otherDetail = workspaceDetailSchema.parse(await (await userFetch(`${base}/api/workbench/images/${otherId}`)).json());
    const copy = createWorkingCopy(); copy.bind(otherDetail); copy.place({ x: 0.1, y: 0.1 }); copy.state.markers[0].note = 'single saved'; const targetId = copy.state.markers[0].id; copy.place({ x: 0.8, y: 0.8 });
    assert.equal(await copy.save(user.userId, async (id, value) => {
      const response = await post(`/api/workbench/images/${id}/saves`, value); assert.equal(response.status, 200); return saveResultSchema.parse(await response.json());
    }, targetId), true);
    assert.equal(copy.count(), 1); assert.equal(copy.state.markers[1].note, '');
    const oneSaved = workspaceDetailSchema.parse(await (await userFetch(`${base}/api/workbench/images/${otherId}`)).json()); assert.equal(oneSaved.annotations.length, 1); assert.equal(oneSaved.annotations[0].note, 'single saved');
    const remove = await userFetch(`${base}/api/images/${image.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.userId, baseRevisionId: restored.revision.id }) }); assert.equal(remove.status, 204);
    await restart();
    assert.equal((await userFetch(`${base}/api/workbench/images/${image.id}`)).status, 404); assert.equal((await userFetch(`${base}/api/images/${image.id}/content`)).status, 404);
    const late = await userFetch(base + '/api/images', { method: 'POST', headers: { 'X-User-Id': user.userId }, body: form }); assert.equal(late.status, 409); assert.equal((await late.json() as { error: { code: string } }).error.code, 'IMAGE_DELETED');
    const remaining = librarySchema.parse(await (await userFetch(base + '/api/workbench/images')).json()); assert.equal(remaining.total, 1); assert.equal(remaining.items[0].image.id, otherId); assert.equal(remaining.items[0].annotationCount, 1);
  }, true);
  process.stdout.write('PASS production HTTP page/assets/username/library/batch-save/single-marker/SSE/marker-sizes/versions/retry/image/delete/tombstone/restart; resources cleaned\n');
} catch { process.stderr.write('FAIL production HTTP smoke; run build first and inspect tests\n'); process.exitCode = 1; }
