import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, nextTick } from 'vue';
import { useWorkbench } from '../../src/client/state/use-workbench';
import { RequestFailure } from '../../src/client/http/review-api';
import type { WorkbenchApi } from '../../src/client/http/workbench-api';
import type { WorkspaceDetail, SaveResult, HistoryDetail, Library } from '../../src/shared/workbench-contracts';
import { createWorkingCopy } from '../../src/client/state/working-copy';
import { createToast } from '../../src/client/state/toast';

const user = { userId: crypto.randomUUID(), username: '审阅甲' };
const image = { id: crypto.randomUUID(), originalName: 'one.png', mimeType: 'image/png' as const, width: 32, height: 24, fileSize: 3, sha256: 'a'.repeat(64), createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z' };
const baseline: WorkspaceDetail = { image, annotations: [], revision: { id: crypto.randomUUID(), imageId: image.id, parentRevisionId: null, userId: user.userId, username: user.username, savedAt: image.createdAt, kind: 'upload', versionNumber: 0, added: 0, modified: 0, deleted: 0 } };
const existing = { id: crypto.randomUUID(), imageId: image.id, number: 1, size: 24, x: 0.2, y: 0.3, note: '原说明', severity: 'medium' as const, createdBy: user.userId, createdByName: user.username, updatedBy: user.userId, updatedByName: user.username, version: 1, createdAt: image.createdAt, updatedAt: image.createdAt };
function result(note = '新说明'): SaveResult { return { created: true, savedRevisionId: crypto.randomUUID(), detail: { ...baseline, annotations: [{ ...existing, note }], revision: { ...baseline.revision, id: crypto.randomUUID(), parentRevisionId: baseline.revision.id, kind: 'save', added: 1 } } }; }

describe('manual working copy', () => {
  it('persists independent size edits and restores their exact cached or cancelled values', async () => {
    const model = createWorkingCopy(); model.bind({ ...baseline, annotations: [{ ...existing, size: 31 }] });
    model.state.markers[0].size = 48;
    expect(model.count()).toBe(1);
    const restored = createWorkingCopy(); restored.restore(model.snapshot()!, image.id);
    expect(restored.state.markers[0].size).toBe(48);
    restored.undo(existing.id); expect(restored.state.markers[0].size).toBe(31); expect(restored.count()).toBe(0);
    restored.place({ x: 0.8, y: 0.8 }); expect(restored.state.markers[1].size).toBe(24);
    model.state.markers[0].size = 49;
    const send = vi.fn(async () => result());
    expect(await model.save(user.userId, send)).toBe(false); expect(send).not.toHaveBeenCalled();
    expect(model.state.selectedId).toBe(existing.id);
  });
  it('restores old drafts to default sizes while preserving the exact old frozen request', () => {
    const legacy = { ...existing } as Partial<typeof existing>; delete legacy.size;
    const pending = { requestId: crypto.randomUUID(), baseRevisionId: baseline.revision.id, userId: user.userId, markers: [{ id: existing.id, x: 0.2, y: 0.3, note: 'pending', severity: 'medium' }] };
    const model = createWorkingCopy();
    model.restore(JSON.stringify({ base: { ...baseline, annotations: [legacy] }, markers: pending.markers, removed: [], selectedId: existing.id, pending }), image.id);
    expect(model.state.base!.annotations[0].size).toBe(24);
    expect(model.state.markers[0].size).toBe(24);
    expect(model.state.pending).toEqual(pending);
    expect(model.state.pending!.markers[0]).not.toHaveProperty('size');
  });
  it('validates every marker and normalizes one atomic payload without mutating saved records', async () => {
    const model = createWorkingCopy(); model.bind({ ...baseline, annotations: [existing] });
    model.state.markers[0].note = 'changed'; model.place({ x: 0.5, y: 0.5 });
    const send = vi.fn(async () => result());
    expect(await model.save(user.userId, send)).toBe(false); expect(send).not.toHaveBeenCalled();
    expect(existing.note).toBe('原说明');
    model.state.markers[1].note = ' 新说明 ';
    expect(await model.save(user.userId, send)).toBe(true);
    expect(send.mock.calls).toHaveLength(1);
    const payload = (send.mock.calls as unknown as [string, { markers: { note: string }[] }][])[0][1];
    expect(payload.markers.map(row => row.note)).toEqual(['changed', '新说明']);
    expect(model.count()).toBe(0);
  });
  it('freezes and restores an unknown request, then retries exactly its original payload and identity', async () => {
    const model = createWorkingCopy(); model.bind(baseline); model.place({ x: 0.5, y: 0.5 }); model.state.markers[0].note = 'draft';
    const send = vi.fn().mockRejectedValueOnce(new RequestFailure('timeout')).mockResolvedValue(result());
    expect(await model.save(user.userId, send)).toBe(false); expect(model.blocked()).toBe(true);
    const raw = model.snapshot()!; const restored = createWorkingCopy(); restored.restore(raw, image.id);
    expect(restored.state.pending).toEqual(model.state.pending);
    expect(await restored.save(crypto.randomUUID(), send)).toBe(true);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(restored.state.pending).toBeNull(); expect(restored.snapshot()).toBeNull();
  });
  it('keeps known failures editable, restores deletion without dropping edits and rejects cross-image cache', async () => {
    const model = createWorkingCopy(); model.bind({ ...baseline, annotations: [existing] });
    model.state.markers[0].note = 'changed'; model.remove(existing.id); model.restoreRemoved(existing.id);
    expect(model.state.markers[0].note).toBe('changed'); expect(model.kind(existing.id)).toBe('modify');
    const send = vi.fn(async () => { throw new RequestFailure('failed', 503, 'DATABASE_BUSY'); });
    expect(await model.save(user.userId, send)).toBe(false); expect(model.state.pending).toBeNull();
    expect(() => createWorkingCopy().restore(model.snapshot()!, crypto.randomUUID())).toThrow();
    model.undo(existing.id); expect(model.count()).toBe(0);
    model.place({ x: 0.2, y: 0.2 }); model.remove(model.state.selectedId!); expect(model.count()).toBe(0);
  });
});

// This renderer executes only composition state/lifecycle with inert host nodes. It does not
// load a browser, mount the application DOM or assert layout, focus, SVG or IndexedDB behavior.
const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} });
const mounted: { unmount(): void }[] = [];
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.unstubAllGlobals(); });
function setup() {
  const session = new Map<string, string>(); const local = new Map<string, string>();
  const storage = (values: Map<string, string>) => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => values.delete(key) });
  const location = { href: 'http://127.0.0.1:5174/' };
  vi.stubGlobal('location', location);
  vi.stubGlobal('window', { sessionStorage: storage(session), localStorage: storage(local), history: { replaceState: (_state: unknown, _unused: string, url: URL) => { location.href = String(url); } }, addEventListener() {}, removeEventListener() {}, confirm: () => false });
  const api = { enter: vi.fn(async () => user), library: vi.fn(async (): Promise<Library> => ({ items: [{ image, annotationCount: 0, revisionCount: 1, username: user.username, uploadedByUserId: user.userId }], total: 1, page: 1, pageSize: 12 })), detail: vi.fn(async () => structuredClone(baseline)), content: vi.fn(async () => new File(['png'], 'one.png', { type: 'image/png' })), upload: vi.fn(async () => image), history: vi.fn(async () => ({ items: [baseline.revision], total: 1, page: 1, pageSize: 20 })), historical: vi.fn(async (): Promise<HistoryDetail> => ({ ...baseline, changes: [] })), save: vi.fn(async () => result()) } satisfies Omit<WorkbenchApi, 'removeImage'>;
  const managementApi = { ...api, removeImage: vi.fn(async () => {}) };
  let controller!: ReturnType<typeof useWorkbench>;
  const app = renderer.createApp({ setup() { controller = useWorkbench({ api: managementApi, preview: { createUrl: () => 'blob:test', revokeUrl() {}, decode: async () => ({ width: 32, height: 24 }) } }); return () => null; } });
  mounted.push(app); app.mount({});
  return { w: controller, api: managementApi, session, local };
}
describe('entry and workbench composition flow', () => {
  it('P5 switches between independent images through discard protection and restores only the matching view and cache', async () => {
    const { w, api, session } = setup(); w.username = user.username; await w.enter(); await w.openImage(image.id);
    const otherId = crypto.randomUUID(); const other = { ...baseline, image: { ...image, id: otherId, originalName: 'two.png' }, revision: { ...baseline.revision, id: crypto.randomUUID(), imageId: otherId } };
    w.place({ x: 0.8, y: 0.1 }); w.draft.markers[0].note = 'discard A'; await nextTick();
    w.saveView({ mode: 'manual', manualScale: 2, markerSize: 24, anchor: { x: 0.3, y: 0.4 } });
    api.detail.mockResolvedValueOnce(structuredClone(other));
    await w.openImage(otherId); expect(w.dialog).toBe(true); expect(w.currentImage?.id).toBe(image.id);
    await w.resolveLeave('discard'); expect(w.currentImage?.id).toBe(otherId); expect(w.draft.markers).toEqual([]);
    w.place({ x: 0.1, y: 0.9 }); w.draft.markers[0].note = 'B only'; await nextTick();
    expect(session.get('image-review:draft:' + otherId)).toContain('B only');
    await w.toLibrary(); await w.resolveLeave('discard'); await w.openImage(image.id);
    expect(w.draft.markers).toEqual([]); expect(w.currentImage?.id).toBe(image.id);
    expect(session.get('image-review:view:' + image.id)).toContain('manualScale'); expect(w.historical).toBeNull();
  });
  it('P5 cancels whole-image deletion without changing input, then clears only the deleted image and clamps the library page', async () => {
    const { w, api, session } = setup(); w.username = user.username; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.2, y: 0.4 }); w.draft.markers[0].note = 'unsaved'; await nextTick();
    session.set('image-review:view:' + image.id, 'saved view'); session.set('image-review:draft:other', 'unrelated');
    w.askDelete(); w.cancelDelete(); expect(w.draft.markers[0].note).toBe('unsaved'); expect(api.removeImage).not.toHaveBeenCalled();
    w.library.page = 2; api.library.mockResolvedValueOnce({ items: [], total: 12, page: 2, pageSize: 12 });
    w.askDelete(); await w.deleteImage(); await nextTick();
    expect(api.removeImage).toHaveBeenCalledWith(image.id, { userId: user.userId, baseRevisionId: baseline.revision.id });
    expect(w.page).toBe('library'); expect(w.currentImage).toBeNull(); expect(w.image.image).toBeNull(); expect(w.copy.count()).toBe(0);
    expect(session.has('image-review:draft:' + image.id)).toBe(false); expect(session.has('image-review:view:' + image.id)).toBe(false);
    expect(session.get('image-review:draft:other')).toBe('unrelated'); expect(w.library.page).toBe(1);
  });
  it('P5 retains unknown deletion input, refuses a generic 404 as proof, and confirms only IMAGE_NOT_FOUND', async () => {
    const { w, api } = setup(); w.username = user.username; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.3, y: 0.3 }); w.draft.markers[0].note = 'keep me';
    api.removeImage.mockRejectedValueOnce(new RequestFailure('lost')); w.askDelete(); await w.deleteImage();
    expect(w.deletePending).not.toBeNull(); expect(w.blocked).toBe(true); await w.switchUser(); expect(w.user).toEqual(user);
    api.detail.mockRejectedValueOnce(new RequestFailure('wrong route', 404, 'API_NOT_FOUND')); await w.verifyDelete();
    expect(w.deletePending).not.toBeNull(); expect(w.draft.markers[0].note).toBe('keep me');
    api.detail.mockRejectedValueOnce(new RequestFailure('gone', 404, 'IMAGE_NOT_FOUND')); await w.verifyDelete();
    expect(w.deletePending).toBeNull(); expect(w.page).toBe('library');
  });
  it('P5 retries an uncertain deletion with the unchanged image, actor and base while other writes remain locked', async () => {
    const { w, api } = setup(); w.username = user.username; await w.enter(); await w.openImage(image.id);
    api.removeImage.mockRejectedValueOnce(new RequestFailure('unknown')); w.askDelete(); await w.deleteImage();
    expect(await w.save()).toBe(false); await w.openImage(crypto.randomUUID()); expect(w.currentImage?.id).toBe(image.id);
    await w.deleteImage(); expect(api.removeImage.mock.calls[0]).toEqual(api.removeImage.mock.calls[1]); expect(w.page).toBe('library');
  });
  it('P5 distinguishes server deletion from a blocked browser-cache cleanup', async () => {
    const { w } = setup(); w.username = user.username; await w.enter(); await w.openImage(image.id);
    vi.spyOn(window.sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('storage denied'); });
    w.askDelete(); await w.deleteImage();
    expect(w.page).toBe('library'); expect(w.currentImage).toBeNull(); expect(w.cacheWarning).toContain('本机缓存清理失败'); expect(w.errorText).toBe('');
  });
  it('P5 keeps edits after a deletion conflict and separates completed deletion from list failure', async () => {
    const { w, api } = setup(); w.username = user.username; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.3, y: 0.3 }); w.draft.markers[0].note = 'keep me';
    api.removeImage.mockRejectedValueOnce(new RequestFailure('changed', 409, 'REVIEW_BASE_CHANGED')); w.askDelete(); await w.deleteImage();
    expect(w.deletePending).toBeNull(); expect(w.deleteDialog).toBe(false); expect(w.draft.markers[0].note).toBe('keep me');
    api.library.mockRejectedValueOnce(new RequestFailure('list unavailable', 503));
    w.askDelete(); await w.deleteImage(); expect(w.page).toBe('library'); expect(w.currentImage).toBeNull();
    expect(w.errorText).toBe(''); expect(w.libraryWarning).toContain('图片已删除');
  });
  it('P5 keeps uploads in the library for multiple files and locks identity until unknown results are resolved', async () => {
    const { w, api } = setup(); w.username = user.username; await w.enter();
    const files = [new File(['png'], 'one.png', { type: 'image/png' }), new File(['png'], 'two.png', { type: 'image/png' })];
    api.upload.mockRejectedValueOnce(new RequestFailure('unknown'));
    await w.uploadFiles(files); expect(w.blocked).toBe(true); await w.switchUser(); expect(w.page).toBe('library'); expect(w.user).toEqual(user);
    await w.retryUpload(w.uploads.items[0].id); expect(api.upload.mock.calls[0]).toEqual(api.upload.mock.calls[1]);
    expect(w.page).toBe('library'); expect(w.blocked).toBe(false); expect(api.detail).not.toHaveBeenCalled();
    await w.uploadFiles([files[0]]); expect(w.page).toBe('review');
  });
  it('shows a complete historical collection, with deletions only in optional comparison and details initially closed', async () => {
    const { w, api } = setup(); const removed = { ...existing, id: crypto.randomUUID(), number: 2, note: 'deleted' }; const survivor = { ...existing, number: 7 };
    api.historical.mockResolvedValueOnce({ ...baseline, annotations: [survivor], previousAnnotations: [removed, survivor], changes: [{ annotationId: removed.id, kind: 'delete', before: removed, after: null, userId: user.userId }] });
    w.username = '审阅甲'; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.8, y: 0.8 }); w.draft.markers[0].note = 'unsaved';
    await w.openHistory();
    expect(w.historyExpandedIds).toEqual([]); expect(w.showChanges).toBe(false);
    expect(w.stageMarkers.map(row => [row.id, row.label, row.change])).toEqual([[survivor.id, 1, undefined]]);
    await w.selectMarker(survivor.id); expect(w.historyExpandedIds).toEqual([survivor.id]);
    expect(w.changeLabel(survivor.id, true)).toBe(2);
    w.showChanges = true; expect(w.stageMarkers.find(row => row.id === removed.id)).toMatchObject({ label: 1, change: 'delete' });
    w.backToReview(); expect(w.expandedIds).toEqual([]); expect(w.draft.markers[0].note).toBe('unsaved');
  });
  it('keeps an authoritative saved library summary on retries without incrementing its counts', async () => {
    const { w, api } = setup(); w.username = '审阅甲'; await w.enter(); await w.openImage(image.id);
    const saved = result(); saved.libraryItem = { ...w.library.items[0], annotationCount: 1, revisionCount: 2 };
    api.save.mockRejectedValueOnce(new RequestFailure('unknown')).mockResolvedValueOnce(saved);
    api.library.mockRejectedValueOnce(new RequestFailure('list unavailable', 503));
    w.place({ x: 0.2, y: 0.2 }); w.draft.markers[0].note = 'save';
    expect(await w.save()).toBe(false); expect(w.rail[0].annotationCount).toBe(0);
    expect(await w.save()).toBe(true); await nextTick();
    expect(w.rail[0]).toEqual(saved.libraryItem); expect(w.libraryWarning).toContain('已保存');
    expect(w.errorText).toBe(''); expect(w.expandedIds).toEqual([]);
    expect(api.save.mock.calls[0]).toEqual(api.save.mock.calls[1]);
  });
  it('keeps search controls unlocked and ignores stale library responses', async () => {
    const { w, api } = setup(); w.username = '审阅甲'; await w.enter();
    let finish!: (value: typeof w.library) => void;
    api.library.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    w.query = 'first'; const earlier = w.loadLibrary();
    expect(w.libraryBusy).toBe(true); expect(w.blocked).toBe(false);
    w.query = '中文'; await w.loadLibrary();
    finish({ items: [], total: 99, page: 1, pageSize: 12 }); await earlier;
    expect(w.library.total).toBe(1); expect(w.query).toBe('中文'); expect(w.libraryBusy).toBe(false);
  });
  it('BC-WB-002 projects contiguous labels while removing saved markers without changing their identities', async () => {
    const { w, api } = setup();
    const rows = [1, 3, 7].map(number => ({ ...existing, id: crypto.randomUUID(), number }));
    api.detail.mockResolvedValueOnce({ ...baseline, annotations: rows });
    w.username = '审阅甲'; await w.enter(); await w.openImage(image.id);
    w.copy.remove(rows[1].id);
    expect(w.stageMarkers.map(row => [row.id, row.label])).toEqual([[rows[0].id, 1], [rows[2].id, 2]]);
    w.copy.restoreRemoved(rows[1].id);
    expect(w.stageMarkers.map(row => row.label)).toEqual([1, 2, 3]);
  });
  it('BC-WB-003 updates the cached rail immediately after a successful save even if library refresh fails', async () => {
    const { w, api } = setup(); w.username = '审阅甲'; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.2, y: 0.2 }); w.draft.markers[0].note = 'saved';
    api.library.mockRejectedValueOnce(new RequestFailure('list failed', 503));
    expect(await w.save()).toBe(true);
    expect(w.rail[0].annotationCount).toBe(1);
    expect(w.errorText).toBe('');
    expect(api.save).toHaveBeenCalledTimes(1);
  });
  it('starts exclusively at username entry, enters the library, opens a saved image and returns through dirty protection', async () => {
    const { w, api } = setup(); expect(w.page).toBe('entry'); expect(api.library).not.toHaveBeenCalled();
    w.username = ' '; await w.enter(); expect(w.page).toBe('entry'); expect(api.enter).not.toHaveBeenCalled();
    w.username = '审阅甲'; await w.enter(); expect(w.page).toBe('library'); expect(w.user).toEqual(user);
    await w.openImage(image.id); expect(w.page).toBe('review');
    w.place({ x: 0.3, y: 0.3 }); w.draft.markers[0].note = 'draft';
    await w.toLibrary(); expect(w.dialog).toBe(true); expect(w.page).toBe('review');
    await w.resolveLeave('stay'); expect(w.draft.markers[0].note).toBe('draft');
    await w.toLibrary(); api.save.mockRejectedValueOnce(new RequestFailure('failed', 503));
    await w.resolveLeave('save'); expect(w.dialog).toBe(true); expect(w.page).toBe('review');
    await w.resolveLeave('save'); expect(w.page).toBe('library'); expect(w.dialog).toBe(false); expect(api.save).toHaveBeenCalledTimes(2);
  });
  it('views inherited history without overwriting the working copy, supports independent disclosure and returns to entry on user switch', async () => {
    const { w, api } = setup(); w.username = '审阅甲'; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.2, y: 0.2 }); w.draft.markers[0].note = 'first'; w.place({ x: 0.8, y: 0.8 }); w.draft.markers[1].note = 'second';
    expect(w.expandedIds).toHaveLength(2);
    await w.openHistory(); expect(w.page).toBe('history'); expect(w.draft.markers).toHaveLength(2); expect(w.stageMarkers).toHaveLength(0);
    w.backToReview(); expect(w.page).toBe('review'); expect(w.stageMarkers).toHaveLength(2);
    await w.switchUser(); expect(w.dialog).toBe(true); await w.resolveLeave('discard'); expect(w.page).toBe('entry'); expect(w.user).toBeNull();
    w.username = '另一位使用人'; await w.enter(); expect(api.enter.mock.calls[1]).toEqual(['另一位使用人', undefined]);
  });
  it('preserves refresh data per image and never navigates away while a save result remains unknown', async () => {
    const { w, api, session } = setup(); w.username = '审阅甲'; await w.enter(); await w.openImage(image.id);
    w.place({ x: 0.2, y: 0.3 }); w.draft.markers[0].note = 'cached';
    api.save.mockRejectedValueOnce(new RequestFailure('unknown'));
    expect(await w.save()).toBe(false); await nextTick();
    expect(session.get('image-review:draft:' + image.id)).toContain('cached');
    await w.toLibrary(); expect(w.page).toBe('review'); expect(w.dialog).toBe(false);
    expect(await w.save()).toBe(true); expect(api.save.mock.calls[0]).toEqual(api.save.mock.calls[1]);
    await nextTick(); expect(session.has('image-review:draft:' + image.id)).toBe(false);
  });
});

describe('success toast lifecycle', () => {
  it('replaces the expiration deadline and releases timers when dismissed or disposed', () => {
    vi.useFakeTimers();
    const toast = createToast();
    try {
      toast.show('copied'); vi.advanceTimersByTime(2000); toast.show('saved');
      vi.advanceTimersByTime(500); expect(toast.state.message).toBe('saved');
      vi.advanceTimersByTime(2000); expect(toast.state.message).toBe('');
      toast.show('again'); toast.dismiss(); expect(vi.getTimerCount()).toBe(0);
      expect(toast.state.message).toBe('');
    } finally { toast.dismiss(); vi.useRealTimers(); }
  });
});
