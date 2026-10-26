import { reactive } from 'vue';
import { createAnnotationSchema, updateAnnotationSchema, type Actor, type AnnotationDto, type CreateAnnotation, type DeleteAnnotation, type ImageDto, type UpdateAnnotation } from '../../shared/review-contracts';
import type { createReviewSession, LocalMarker } from '../review-session';
import { RequestFailure, type ReviewApi } from '../http/review-api';

export type PendingWrite = { kind: 'create'; imageId: string; id: string; value: CreateAnnotation } | { kind: 'update'; imageId: string; id: string; value: UpdateAnnotation } | { kind: 'delete'; imageId: string; id: string; value: DeleteAnnotation };
export function createPersistence(session: ReturnType<typeof createReviewSession>, api: ReviewApi, getActor: () => Actor | null) {
  const state = reactive({ image: null as ImageDto | null, busy: false, message: '', error: '', requestId: '', uploadId: null as string | null,
    uploadUnknown: false, pendingWrite: null as PendingWrite | null, conflict: null as { id: string; latest: AnnotationDto | null; deleting: boolean } | null });
  function report(error: unknown) {
    state.error = error instanceof Error ? error.message : '操作失败，请重试';
    state.requestId = error instanceof RequestFailure ? error.requestId : '';
  }
  const blocked = () => state.busy || state.uploadUnknown || state.pendingWrite !== null;
  async function uploading(file: File) {
    if (state.busy || state.image) return false;
    state.busy = true; state.error = ''; state.message = '';
    state.uploadId ??= crypto.randomUUID();
    state.uploadUnknown = true; // Persist an in-flight upload as uncertain if the page is refreshed.
    try { state.image = await api.upload(state.uploadId, file); state.uploadUnknown = false; state.message = '图片已上传，临时标记仍需逐条保存'; return true; }
    catch (error) { state.uploadUnknown = !(error instanceof RequestFailure) || error.status === null; report(error); return false; }
    finally { state.busy = false; }
  }
  async function compare(write: PendingWrite) {
    const detail = await api.detail(write.imageId);
    const latest = detail.annotations.find(row => row.id === write.id) ?? null;
    if (write.kind === 'delete' && !latest) { session.removeSaved(write.id); state.pendingWrite = null; state.conflict = null; state.error = ''; state.requestId = ''; state.message = '已确认删除'; return true; }
    if (write.kind === 'update' && latest && latest.version === write.value.version + 1 && latest.note === write.value.note && latest.severity === write.value.severity && latest.updatedBy === write.value.actorId && latest.updatedByName === write.value.actorName) {
      session.commitSaved(latest); state.pendingWrite = null; state.conflict = null; state.error = ''; state.requestId = ''; state.message = '已确认保存'; return true;
    }
    state.conflict = { id: write.id, latest, deleting: write.kind === 'delete' };
    state.pendingWrite = null;
    state.error = latest ? '请比较原输入与服务端最新值，明确选择基于最新版本继续' : '标记已不存在，未保存输入仍保留供复制';
    return false;
  }
  async function execute(write: PendingWrite) {
    if (state.busy) return false;
    state.busy = true; state.error = ''; state.requestId = ''; state.message = '';
    state.pendingWrite = write;
    try {
      if (write.kind === 'create') session.commitSaved(await api.create(write.imageId, write.value));
      else if (write.kind === 'update') session.commitSaved(await api.update(write.id, write.value));
      else { await api.remove(write.id, write.value); session.removeSaved(write.id); }
      state.pendingWrite = null; state.conflict = null; state.message = write.kind === 'delete' ? '已删除' : '已保存'; return true;
    } catch (error) {
      report(error);
      const unknown = !(error instanceof RequestFailure) || error.status === null;
      if (!unknown) state.pendingWrite = null;
      if ((unknown && write.kind !== 'create') || (error instanceof RequestFailure && error.status === 409 && error.code === 'ANNOTATION_VERSION_CONFLICT')) {
        try { return await compare(write); } catch (readError) { report(readError); if (!unknown) state.conflict = { id: write.id, latest: null, deleting: write.kind === 'delete' }; }
      }
      return false;
    } finally { state.busy = false; }
  }
  async function save(marker?: LocalMarker) {
    if (blocked() || state.conflict || !state.image) return false;
    if (marker && session.state.draft?.id === marker.id) { state.error = '请先应用或取消该条临时编辑副本'; return false; }
    const actor = getActor(); if (!actor) { state.error = '请填写 1–40 字符的昵称后保存'; return false; }
    const draft = marker ?? session.state.draft;
    if (!draft) return false;
    const existing = marker ?? session.state.markers.find(row => row.id === draft.id);
    if (!marker && session.state.draft?.baseVersion && !existing?.saved) { state.error = '原标记已不存在，请保留输入供复制，不能将编辑草稿重新创建'; return false; }
    if (existing?.saved) {
      const value = updateAnnotationSchema.safeParse({ ...actor, version: session.state.draft?.baseVersion ?? existing.saved.version, note: draft.note, severity: draft.severity ?? 'medium' });
      if (!value.success) { state.error = '请填写有效说明和严重程度'; return false; }
      return execute({ kind: 'update', imageId: state.image.id, id: existing.id, value: value.data });
    }
    const id = marker?.id ?? session.state.draft?.requestId ?? crypto.randomUUID();
    if (!marker && session.state.draft) session.state.draft.requestId = id;
    const value = createAnnotationSchema.safeParse({ ...actor, id, x: draft.x, y: draft.y, note: draft.note, severity: draft.severity ?? 'medium' });
    if (!value.success) { state.error = '请填写有效说明和严重程度'; return false; }
    return execute({ kind: 'create', imageId: state.image.id, id, value: value.data });
  }
  async function remove(marker: LocalMarker) {
    if (blocked() || state.conflict || !state.image || !marker.saved) return false;
    const actor = getActor(); if (!actor) { state.error = '请填写 1–40 字符的昵称后删除'; return false; }
    return execute({ kind: 'delete', imageId: state.image.id, id: marker.id, value: { ...actor, version: marker.saved.version } });
  }
  async function retry() {
    const write = state.pendingWrite; if (!write || state.busy) return false;
    if (write.kind === 'create') return execute(write);
    state.busy = true;
    try { return await compare(write); } catch (error) { report(error); return false; } finally { state.busy = false; }
  }
  function acceptLatest() {
    const conflict = state.conflict; if (!conflict?.latest || state.busy) return;
    const draft = session.state.draft;
    session.commitSaved(conflict.latest);
    session.state.draft = draft;
    if (draft?.id === conflict.id) draft.baseVersion = conflict.latest.version;
    state.conflict = null; state.error = ''; state.message = '已采用最新版本作为基线，请检查输入后再次保存或确认删除';
  }
  async function refreshConflict() {
    const conflict = state.conflict;
    if (!conflict || !state.image || state.busy) return;
    state.busy = true;
    try { const detail = await api.detail(state.image.id); state.conflict = { ...conflict, latest: detail.annotations.find(row => row.id === conflict.id) ?? null }; }
    catch (error) { report(error); } finally { state.busy = false; }
  }
  function reset() { if (state.busy) return; Object.assign(state, { image: null, uploadId: null, uploadUnknown: false, pendingWrite: null, conflict: null, error: '', requestId: '', message: '' }); }
  return { state, blocked, upload: uploading, save, remove, retry, acceptLatest, refreshConflict, report, reset, compare };
}
