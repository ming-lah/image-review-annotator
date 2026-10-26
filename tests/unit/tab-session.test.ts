import { describe, expect, it, vi } from 'vitest';
import { createTabSession, type BlobCache, type SessionSnapshot } from '../../src/client/tab-session';

function setup() {
  const entries = new Map<string, string>();
  const blobs = new Map<string, Blob>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }), removeItem: (key: string) => { entries.delete(key); } };
  const cache: BlobCache = { read: vi.fn(async key => blobs.get(key) ?? null), write: vi.fn(async (key, blob) => { blobs.set(key, blob); }), remove: vi.fn(async key => { blobs.delete(key); }), close: vi.fn() };
  const deps = { storage, blobs: cache, makeId: () => crypto.randomUUID() };
  return { entries, blobs, storage, cache, deps, session: createTabSession(deps) };
}
const file = (name = 'sample.png') => new File(['sample'], name, { type: 'image/png' });
function snapshot(imageFile: File): SessionSnapshot {
  return {
    image: { name: imageFile.name, type: imageFile.type, size: imageFile.size, width: 800, height: 600 },
    review: { markers: [{ id: 'one', label: 1, x: 0.2, y: 0.3, note: '原说明' }], expandedIds: ['one'], selectedId: 'one', draft: { id: 'one', x: 0.2, y: 0.3, note: '未应用的修改' }, nextLabel: 4 },
    view: { mode: 'manual', manualScale: 2, markerSize: 36, anchor: { x: 0.4, y: 0.6 } },
  };
}

describe('tab-scoped recovery cache', () => {
  it('migrates a P3 entry only after a successful P4 snapshot write', async () => {
    const model = setup(); const image = file();
    await model.session.save(snapshot(image), image);
    const raw = JSON.parse([...model.entries.values()][0]) as { version: number };
    model.entries.clear(); raw.version = 1;
    const legacyKey = 'image-review-annotator:p3:tab-session:v1'; model.entries.set(legacyKey, JSON.stringify(raw));
    const upgraded = createTabSession(model.deps); const recovered = await upgraded.load();
    model.storage.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(upgraded.save(recovered!.snapshot, recovered!.file!)).rejects.toThrow('quota');
    expect(model.entries.has(legacyKey)).toBe(true);
    await upgraded.save(recovered!.snapshot, recovered!.file!);
    expect(model.entries.has(legacyKey)).toBe(false); expect([...model.entries.keys()]).toEqual(['image-review-annotator:p4:tab-session:v2']);
  });
  it('caches only metadata for a formal image, retaining pending payloads and freeing the local blob after success', async () => {
    const model = setup(); const image = file(); const value = snapshot(image);
    await model.session.save(value, image);
    const imageId = crypto.randomUUID(); const annotationId = crypto.randomUUID(); const actorId = crypto.randomUUID();
    value.remote = { image: { id: imageId, originalName: image.name, mimeType: 'image/png', width: 800, height: 600, fileSize: image.size, sha256: 'a'.repeat(64), createdAt: 'now', updatedAt: 'now' }, uploadId: imageId, uploadUnknown: false,
      pendingWrite: { kind: 'create', imageId, id: annotationId, value: { id: annotationId, x: 0.2, y: 0.3, note: '待确认', severity: 'high', actorId, actorName: '测试' } } };
    await model.session.save(value, image);
    const loaded = await createTabSession(model.deps).load();
    expect(loaded?.file).toBeNull(); expect(loaded?.snapshot.remote?.pendingWrite).toEqual(value.remote.pendingWrite);
    expect(model.blobs.size).toBe(0); expect(model.cache.write).toHaveBeenCalledTimes(1);
    value.remote.pendingWrite!.imageId = crypto.randomUUID();
    await expect(model.session.save(value, image)).rejects.toThrow();
    expect((await model.session.load())?.snapshot.remote?.image?.id).toBe(imageId);
  });
  it('rejects inconsistent restored identities and counters before writing any image or metadata', async () => {
    const model = setup();
    const image = file();
    const value = snapshot(image);
    value.review.nextLabel = 1;
    await expect(model.session.save(value, image)).rejects.toThrow();
    expect(model.cache.write).not.toHaveBeenCalled();
    expect(model.entries.size).toBe(0);
  });
  it('restores image bytes, collapsed-state-independent notes, draft, labels and view after re-creating the page adapter', async () => {
    const model = setup();
    const image = file();
    const value = snapshot(image);
    await model.session.save(value, image);
    const refreshed = createTabSession(model.deps);
    const recovered = await refreshed.load();
    expect(recovered?.snapshot.review).toEqual(value.review);
    expect(recovered?.snapshot.view).toEqual(value.view);
    expect(await recovered?.file?.text()).toBe('sample');
    expect(recovered?.file?.name).toBe(image.name);
    expect(recovered?.file?.type).toBe(image.type);
    expect(JSON.stringify([...model.entries.values()])).not.toContain('data:image');
  });
  it('does not restore a closed tab from an independent empty sessionStorage even if image bytes remain cached', async () => {
    const model = setup();
    const image = file();
    await model.session.save(snapshot(image), image);
    const reopened = createTabSession({ ...model.deps, storage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
    expect(await reopened.load()).toBeNull();
  });
  it('writes latest draft metadata synchronously once the image is cached', async () => {
    const model = setup();
    const image = file();
    const value = snapshot(image);
    await model.session.save(value, image);
    value.review.draft!.note = '最后一个输入';
    const saving = model.session.save(value, image);
    expect([...model.entries.values()][0]).toContain('最后一个输入');
    await saving;
    expect(model.cache.write).toHaveBeenCalledTimes(1);
  });
  it('never lets a late image write overwrite the latest selected image', async () => {
    const model = setup();
    let finish!: () => void;
    model.cache.write = vi.fn((key, blob) => blob instanceof File && blob.name === 'old.png' ? new Promise<void>(resolve => { finish = () => { model.blobs.set(key, blob); resolve(); }; }) : Promise.resolve().then(() => { model.blobs.set(key, blob); }));
    const oldImage = file('old.png');
    const newImage = file('new.png');
    const oldSave = model.session.save(snapshot(oldImage), oldImage);
    await model.session.save(snapshot(newImage), newImage);
    finish();
    await oldSave;
    expect((await createTabSession(model.deps).load())?.file?.name).toBe('new.png');
    expect(model.blobs.size).toBe(1);
  });
  it('reports quota failures, preserves the previous good snapshot and permits retry', async () => {
    const model = setup();
    const image = file();
    const value = snapshot(image);
    await model.session.save(value, image);
    model.storage.setItem.mockImplementationOnce(() => { throw new Error('Quota exceeded'); });
    value.review.draft!.note = '需要重试';
    await expect(model.session.save(value, image)).rejects.toThrow('Quota exceeded');
    expect((await createTabSession(model.deps).load())?.snapshot.review.draft?.note).toBe('未应用的修改');
    await model.session.save(value, image);
    expect((await createTabSession(model.deps).load())?.snapshot.review.draft?.note).toBe('需要重试');
  });
  it('retries a failed image cache write for the same file', async () => {
    const model = setup();
    vi.mocked(model.cache.write).mockRejectedValueOnce(new Error('Cache unavailable'));
    const image = file();
    await expect(model.session.save(snapshot(image), image)).rejects.toThrow('Cache unavailable');
    expect(model.entries.size).toBe(0);
    await model.session.save(snapshot(image), image);
    expect((await model.session.load())?.file?.name).toBe('sample.png');
  });
  it('rejects corrupt metadata and missing image cache without applying partial recovery', async () => {
    const model = setup();
    const image = file();
    await model.session.save(snapshot(image), image);
    model.blobs.clear();
    await expect(createTabSession(model.deps).load()).rejects.toThrow('Session image unavailable');
    for (const key of model.entries.keys()) model.entries.set(key, '{broken');
    await expect(createTabSession(model.deps).load()).rejects.toThrow();
    expect(model.entries.size).toBe(1);
  });
  it('clears only the active tab cache and prevents a pending save from resurrecting it', async () => {
    const model = setup();
    let finish!: () => void;
    model.cache.write = vi.fn((key, blob) => new Promise<void>(resolve => { finish = () => { model.blobs.set(key, blob); resolve(); }; }));
    const image = file();
    const save = model.session.save(snapshot(image), image);
    model.blobs.set('unrelated-tab', new Blob(['keep']));
    await model.session.clear();
    finish();
    await save;
    expect(model.entries.size).toBe(0);
    expect([...model.blobs.keys()]).toEqual(['unrelated-tab']);
  });
});
