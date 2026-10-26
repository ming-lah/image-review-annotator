import { describe, it, expect, vi } from 'vitest';
import { createReviewSession } from '../../src/client/review-session';
import { createPersistence } from '../../src/client/state/persistence';
import { createIdentity } from '../../src/client/state/identity';
import { RequestFailure, type ReviewApi } from '../../src/client/http/review-api';
import type { AnnotationDto, ImageDto } from '../../src/shared/review-contracts';

const actor = { actorId: crypto.randomUUID(), actorName: '操作人' };
const image: ImageDto = { id: crypto.randomUUID(), originalName: 'one.png', mimeType: 'image/png', width: 32, height: 24, fileSize: 100, sha256: 'a'.repeat(64), createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z' };
function annotation(id: string, note = '说明', version = 1): AnnotationDto { return { id, imageId: image.id, number: 1, size: 24, x: 0.2, y: 0.3, note, severity: 'medium', version, createdBy: actor.actorId, createdByName: actor.actorName, updatedBy: actor.actorId, updatedByName: actor.actorName, createdAt: image.createdAt, updatedAt: image.updatedAt }; }
function setup() {
  const session = createReviewSession();
  const api = { upload: vi.fn(async () => image), detail: vi.fn(async () => ({ image, annotations: [] as AnnotationDto[] })), content: vi.fn(),
    create: vi.fn(async (_imageId, value) => annotation(value.id, value.note)), update: vi.fn(async (id, value) => annotation(id, value.note, value.version + 1)), remove: vi.fn(async () => {}) } satisfies ReviewApi;
  const model = createPersistence(session, api, () => actor); model.state.image = image;
  return { session, api, model };
}
function draft(session: ReturnType<typeof createReviewSession>) { session.request({ kind: 'place', point: { x: 0.2, y: 0.3 } }); session.state.draft!.note = ' 我的输入 '; }
function editing(session: ReturnType<typeof createReviewSession>) { const row = annotation(crypto.randomUUID()); session.commitSaved(row); session.request({ kind: 'edit', id: row.id }); session.state.draft!.note = '保留我的输入'; return row; }
describe('P4 explicit persistence state', () => {
  it('reconciles a cached local marker with its committed create after a lost response and refresh', async () => {
    const { session, api, model } = setup();
    draft(session); session.applyDraft();
    const local = session.state.markers[0];
    session.setExpanded(local.id, true);
    draft(session); session.applyDraft();
    const otherId = session.state.markers[1].id;
    draft(session);
    const unsavedDraft = { ...session.state.draft! };
    const committed = annotation(local.id, local.note);
    api.create.mockRejectedValueOnce(new RequestFailure('响应丢失'));
    expect(await model.save(local)).toBe(false);
    const cached = session.snapshot();
    const pending = structuredClone(JSON.parse(JSON.stringify(model.state.pendingWrite)));
    const refreshed = setup();
    refreshed.session.restore(cached);
    refreshed.model.state.pendingWrite = pending;
    refreshed.api.create.mockResolvedValue(committed);
    refreshed.session.mergeSaved([committed]);
    expect(refreshed.session.state.markers).toHaveLength(2);
    expect(new Set(refreshed.session.state.markers.map(row => row.id)).size).toBe(2);
    expect(refreshed.session.state.markers.find(row => row.id === local.id)?.saved).toEqual(committed);
    expect(refreshed.session.state.markers.find(row => row.id === otherId)?.saved).toBeUndefined();
    expect(refreshed.session.state.expandedIds).toContain(local.id);
    expect(refreshed.session.state.draft).toEqual(unsavedDraft);
    const counter = refreshed.session.snapshot().nextLabel;
    refreshed.session.mergeSaved([committed]);
    expect(refreshed.session.snapshot().nextLabel).toBe(counter);
    expect(await refreshed.model.retry()).toBe(true);
    expect(refreshed.api.create.mock.calls[0]).toEqual(api.create.mock.calls[0]);
    expect(refreshed.session.state.markers).toHaveLength(2);
    expect(refreshed.session.state.draft).toEqual(unsavedDraft);
    expect(refreshed.model.state.pendingWrite).toBeNull();
  });
  it('keeps upload separate from local markers and drafts, including an editing copy', async () => {
    const { session, api, model } = setup(); model.state.image = null;
    draft(session); session.applyDraft(); session.request({ kind: 'edit', id: session.state.markers[0].id }); session.state.draft!.note = '副本';
    const before = session.snapshot();
    expect(await model.upload(new File(['bytes'], 'one.png'))).toBe(true);
    expect(session.snapshot()).toEqual(before); expect(api.create).not.toHaveBeenCalled();
    expect(await model.save(session.state.markers[0])).toBe(false);
    session.cancelDraft(); expect(await model.save(session.state.markers[0])).toBe(true);
    expect(session.state.markers[0].saved?.version).toBe(1);
  });
  it('freezes unknown create payload and reuses its UUID and actor snapshot on retry', async () => {
    const { session, api, model } = setup(); draft(session);
    const id = session.state.draft!.requestId;
    api.create.mockRejectedValueOnce(new RequestFailure('断连'));
    expect(await model.save()).toBe(false);
    expect(session.state.draft?.note).toBe(' 我的输入 ');
    expect(model.state.pendingWrite?.id).toBe(id);
    expect(await model.save()).toBe(false); expect(api.create).toHaveBeenCalledTimes(1);
    expect(await model.retry()).toBe(true);
    expect(api.create.mock.calls[0]).toEqual(api.create.mock.calls[1]);
    expect(session.state.draft).toBeNull(); expect(session.state.markers[0].saved?.id).toBe(id);
  });
  it('keeps known failures editable and prevents concurrent duplicate writes', async () => {
    const { session, api, model } = setup(); draft(session);
    api.create.mockRejectedValueOnce(new RequestFailure('目录故障', 503, 'STORAGE_UNAVAILABLE', 'req-one'));
    expect(await model.save()).toBe(false); expect(model.state.pendingWrite).toBeNull(); expect(model.state.requestId).toBe('req-one');
    let finish!: (value: AnnotationDto) => void;
    api.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = model.save(); expect(await model.save()).toBe(false); expect(api.create).toHaveBeenCalledTimes(2);
    finish(annotation(session.state.draft!.requestId!, '我的输入')); await pending;
    expect(model.state.message).toBe('已保存');
  });
  it('retains original input on 409 and changes the version only after explicit rebase', async () => {
    const { session, api, model } = setup(); const old = editing(session);
    const latest = annotation(old.id, '别人的新内容', 2); api.detail.mockResolvedValue({ image, annotations: [latest] });
    api.update.mockRejectedValueOnce(new RequestFailure('冲突', 409, 'ANNOTATION_VERSION_CONFLICT'));
    expect(await model.save()).toBe(false); expect(session.state.draft?.note).toBe('保留我的输入'); expect(session.state.draft?.baseVersion).toBe(1);
    expect(await model.save()).toBe(false); expect(api.update).toHaveBeenCalledTimes(1);
    model.acceptLatest(); expect(session.state.draft?.baseVersion).toBe(2); expect(session.state.draft?.note).toBe('保留我的输入');
    expect(await model.save()).toBe(true); expect(api.update.mock.calls[1][1].version).toBe(2);
  });
  it('reads after an unknown update response and confirms an exact committed match without PATCH replay', async () => {
    const { session, api, model } = setup(); const old = editing(session);
    api.update.mockRejectedValueOnce(new RequestFailure('响应丢失'));
    api.detail.mockResolvedValue({ image, annotations: [annotation(old.id, '保留我的输入', 2)] });
    expect(await model.save()).toBe(true); expect(api.update).toHaveBeenCalledTimes(1); expect(session.state.draft).toBeNull(); expect(model.state.message).toBe('已确认保存');
  });
  it('preserves an unknown delete until read confirmation and never blindly repeats DELETE', async () => {
    const { session, api, model } = setup(); session.commitSaved(annotation(crypto.randomUUID()));
    api.remove.mockRejectedValueOnce(new RequestFailure('响应丢失')); api.detail.mockRejectedValueOnce(new RequestFailure('仍断连'));
    expect(await model.remove(session.state.markers[0])).toBe(false); expect(session.state.markers).toHaveLength(1); expect(model.state.pendingWrite?.kind).toBe('delete');
    expect(await model.retry()).toBe(true); expect(api.remove).toHaveBeenCalledTimes(1); expect(session.state.markers).toHaveLength(0);
  });
  it('does not destroy a missing remote record draft or turn it into a new creation', async () => {
    const { session, api, model } = setup(); editing(session);
    api.update.mockRejectedValueOnce(new RequestFailure('不存在', 404, 'ANNOTATION_NOT_FOUND'));
    expect(await model.save()).toBe(false); expect(session.state.draft?.note).toBe('保留我的输入'); expect(api.create).not.toHaveBeenCalled();
  });
  it('reuses an uncertain upload ID and keeps the original file on failure', async () => {
    const { model, api } = setup(); model.state.image = null;
    api.upload.mockRejectedValueOnce(new RequestFailure('断连')); const file = new File(['content'], 'one.png');
    expect(await model.upload(file)).toBe(false); expect(model.state.uploadUnknown).toBe(true);
    expect(await model.upload(file)).toBe(true); expect(api.upload.mock.calls[0]).toEqual(api.upload.mock.calls[1]);
  });
});
describe('P4 operator label', () => {
  it('preserves the UUID across nickname edits, validates trim/length and reports unavailable storage', () => {
    const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const first = createIdentity(storage); first.state.actorName = ' 张三 '; const actor = first.current()!;
    const second = createIdentity(storage); expect(second.state.actorName).toBe('张三'); expect(second.state.actorId).toBe(actor.actorId);
    second.state.actorName = '李四'; expect(second.current()?.actorId).toBe(actor.actorId);
    second.state.actorName = 'x'.repeat(41); expect(second.current()).toBeNull();
    const unavailable = createIdentity({ getItem() { throw new Error(); }, setItem() { throw new Error(); } }); unavailable.state.actorName = '暂存'; expect(unavailable.current()).not.toBeNull(); expect(unavailable.state.warning).toContain('当前页面');
  });
});
