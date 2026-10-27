import { reactive } from 'vue';
import { z } from 'zod';
import { saveReviewSchema, workspaceDetailSchema, type SaveReview, type WorkingMarker, type WorkspaceDetail, type SaveResult } from '../../shared/workbench-contracts';
import { uuidSchema, severitySchema, markerSizeSchema } from '../../shared/review-contracts';
import { RequestFailure } from '../http/review-api';
import { workingMarker } from './review-merge';

const draftMarker = z.strictObject({ id: uuidSchema, x: z.number().min(0).max(1), y: z.number().min(0).max(1), note: z.string().max(100000), severity: severitySchema, size: markerSizeSchema.default(24) });
const draftSchema = z.strictObject({ base: workspaceDetailSchema, markers: z.array(draftMarker).max(500), removed: z.array(uuidSchema).max(500), selectedId: uuidSchema.nullable(), pending: saveReviewSchema.nullable(), pendingMarkerId: uuidSchema.nullable().default(null) }).refine(value => new Set(value.markers.map(row => row.id)).size === value.markers.length && value.base.annotations.every(row => row.imageId === value.base.image.id) && value.removed.every(id => value.markers.some(row => row.id === id)) && (!value.selectedId || value.markers.some(row => row.id === value.selectedId)) && (!value.pending || value.pending.baseRevisionId === value.base.revision.id) && (!value.pendingMarkerId || (!!value.pending && value.pending.markers.some(row => row.id === value.pendingMarkerId) && value.markers.some(row => row.id === value.pendingMarkerId) && !value.removed.includes(value.pendingMarkerId))));

export function createWorkingCopy() {
  const state = reactive({ base: null as WorkspaceDetail | null, markers: [] as WorkingMarker[], removed: [] as string[], selectedId: null as string | null, pending: null as SaveReview | null, pendingMarkerId: null as string | null, savedLatestRevisionId: null as string | null, busy: false, error: '', failureCode: '', requestId: '', message: '', savedItem: null as SaveResult['libraryItem'] | null });
  const blocked = () => state.busy || state.pending !== null;
  const old = (id: string) => state.base?.annotations.find(row => row.id === id);
  function kind(id: string): 'add' | 'modify' | 'delete' | null {
    if (state.removed.includes(id)) return 'delete';
    const row = state.markers.find(row => row.id === id); if (!row) return null;
    const original = old(id);
    if (!original) return 'add';
    return row.note.trim() !== original.note || row.severity !== original.severity || (row.size ?? 24) !== (original.size ?? 24) ? 'modify' : null;
  }
  const count = () => state.markers.filter(row => kind(row.id)).length;
  function bind(detail: WorkspaceDetail) {
    state.savedItem = null; state.savedLatestRevisionId = null; state.base = detail; state.markers = detail.annotations.map(workingMarker); state.removed = []; state.selectedId = null; state.pending = null; state.pendingMarkerId = null; state.error = ''; state.failureCode = ''; state.requestId = '';
  }
  function clear() { state.base = null; state.markers = []; state.removed = []; state.selectedId = null; state.pending = null; state.pendingMarkerId = null; state.savedLatestRevisionId = null; state.savedItem = null; state.error = ''; state.failureCode = ''; state.requestId = ''; state.message = ''; }
  function rebase(detail: WorkspaceDetail, markers: WorkingMarker[]) {
    if (blocked() || !state.base || state.base.image.id !== detail.image.id) return false;
    const selected = state.selectedId;
    bind(detail);
    state.markers = markers.map(workingMarker);
    const desired = new Set(markers.map(row => row.id));
    // Keep remote rows pending deletion in the working copy so undo/count/cache remain consistent.
    for (const row of detail.annotations) if (!desired.has(row.id)) { state.markers.push(workingMarker(row)); state.removed.push(row.id); }
    state.selectedId = selected && desired.has(selected) ? selected : null;
    return true;
  }
  function place(point: { x: number; y: number }) {
    if (blocked() || !state.base || ![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return;
    if (state.markers.length >= 500) { state.error = '每张图本轮最多编辑 500 条标记'; return; }
    const row = { id: crypto.randomUUID(), ...point, note: '', severity: 'medium' as const, size: 24 }; state.markers.push(row); state.selectedId = row.id;
  }
  function remove(id: string) {
    if (blocked()) return;
    if (old(id)) { if (!state.removed.includes(id)) state.removed.push(id); }
    else { state.markers = state.markers.filter(row => row.id !== id); if (state.selectedId === id) state.selectedId = null; }
  }
  function undo(id: string) {
    if (blocked()) return;
    state.removed = state.removed.filter(value => value !== id);
    const original = old(id); const row = state.markers.find(row => row.id === id);
    if (original && row) Object.assign(row, { note: original.note, severity: original.severity, size: original.size ?? 24 }); else remove(id);
  }
  function restoreRemoved(id: string) { if (!blocked()) state.removed = state.removed.filter(value => value !== id); }
  function snapshot() { return state.base && (count() || state.pending) ? JSON.stringify({ base: state.base, markers: state.markers, removed: state.removed, selectedId: state.selectedId, pending: state.pending, pendingMarkerId: state.pendingMarkerId }) : null; }
  function restore(raw: string, imageId: string) {
    const value = draftSchema.parse(JSON.parse(raw));
    if (value.base.image.id !== imageId || value.base.revision.imageId !== imageId) throw new Error('Draft image mismatch');
    Object.assign(state, value); return value;
  }
  async function save(userId: string, send: (imageId: string, payload: SaveReview) => Promise<SaveResult>, markerId?: string, readSaved?: (imageId: string, revisionId: string) => Promise<WorkspaceDetail>) {
    if (state.busy || !state.base) return false;
    if (state.pending && state.pending.userId !== userId) { state.error = '请用原账号登录后确认这次保存'; state.failureCode = 'AUTH_CONTEXT_CHANGED'; return false; }
    if (!state.pending) {
      if (!count()) return true;
      let markers = state.markers.filter(row => !state.removed.includes(row.id));
      if (markerId) {
        const target = markers.find(row => row.id === markerId);
        if (!target) { state.error = '当前标记不可保存，请先撤回删除或重新选择'; return false; }
        if (!kind(markerId)) return true;
        markers = state.base.annotations.map(row => row.id === markerId ? target : workingMarker(row));
        if (!old(markerId)) markers.push(target);
      }
      const parsed = saveReviewSchema.safeParse({ userId, requestId: crypto.randomUUID(), baseRevisionId: state.base.revision.id, markers });
      if (!parsed.success) {
        const invalid = markers.find(row => !row.note.trim() || row.note.trim().length > 2000 || !markerSizeSchema.safeParse(row.size ?? 24).success);
        if (invalid) state.selectedId = invalid.id;
        state.error = '请检查标记说明（1–2000 字符）和大小（12–48 整数像素）'; return false;
      }
      state.pending = parsed.data;
      state.pendingMarkerId = markerId ?? null;
    }
    state.busy = true; state.error = ''; state.failureCode = ''; state.message = ''; state.requestId = '';
    let committed = false;
    try {
      const result = await send(state.base.image.id, state.pending);
      committed = true;
      const targetId = state.pendingMarkerId;
      if (targetId) {
        // A retry may acknowledge an older save while detail already contains someone else's later save.
        const precise = result.detail.revision.id === result.savedRevisionId ? result.detail : await readSaved?.(state.base.image.id, result.savedRevisionId);
        // History DTOs also carry diff fields; only the workspace shape belongs in the strict draft cache.
        const exact = precise && { image: precise.image, annotations: precise.annotations, revision: precise.revision };
        const target = exact?.annotations.find(row => row.id === targetId);
        if (!exact || !target || exact.revision.id !== result.savedRevisionId || exact.image.id !== state.base.image.id || exact.image.sha256 !== state.base.image.sha256) throw new Error('本次保存版本暂无法读取');
        const rows = state.markers.map(row => workingMarker(row.id === targetId ? target : row));
        const removed = [...state.removed]; const selected = state.selectedId;
        bind(exact); state.markers = rows; state.removed = removed; state.selectedId = selected;
        state.message = '本条标记已保存' + (count() ? '，其余修改仍未保存' : '');
      } else { bind(result.detail); state.message = result.created ? '本次修改已保存' : '已确认保存结果'; }
      state.savedLatestRevisionId = result.detail.revision.id; state.savedItem = result.libraryItem; return true;
    } catch (error) {
      state.error = (committed ? '本条已保存，草稿恢复尚未完成，请用原请求继续确认。' : '') + (error instanceof Error ? error.message : '保存失败'); state.requestId = error instanceof RequestFailure ? error.requestId : '';
      state.failureCode = committed ? 'SAVE_RECONCILIATION_REQUIRED' : error instanceof RequestFailure ? error.code : 'RESULT_UNKNOWN';
      if (!committed && error instanceof RequestFailure && error.status !== null) { state.pending = null; state.pendingMarkerId = null; }
      return false;
    } finally { state.busy = false; }
  }
  return { state, old, kind, count, blocked, bind, clear, rebase, place, remove, undo, restoreRemoved, snapshot, restore, save };
}
