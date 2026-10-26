import { reactive } from 'vue';
import { z } from 'zod';
import { saveReviewSchema, workspaceDetailSchema, type SaveReview, type WorkingMarker, type WorkspaceDetail, type SaveResult } from '../../shared/workbench-contracts';
import { uuidSchema, severitySchema, markerSizeSchema } from '../../shared/review-contracts';
import { RequestFailure } from '../http/review-api';

const draftMarker = z.strictObject({ id: uuidSchema, x: z.number().min(0).max(1), y: z.number().min(0).max(1), note: z.string().max(100000), severity: severitySchema, size: markerSizeSchema.default(24) });
const draftSchema = z.strictObject({ base: workspaceDetailSchema, markers: z.array(draftMarker).max(500), removed: z.array(uuidSchema).max(500), selectedId: uuidSchema.nullable(), pending: saveReviewSchema.nullable() }).refine(value => new Set(value.markers.map(row => row.id)).size === value.markers.length && value.base.annotations.every(row => row.imageId === value.base.image.id) && value.removed.every(id => value.markers.some(row => row.id === id)) && (!value.selectedId || value.markers.some(row => row.id === value.selectedId)) && (!value.pending || value.pending.baseRevisionId === value.base.revision.id));

export function createWorkingCopy() {
  const state = reactive({ base: null as WorkspaceDetail | null, markers: [] as WorkingMarker[], removed: [] as string[], selectedId: null as string | null, pending: null as SaveReview | null, busy: false, error: '', requestId: '', message: '', savedItem: null as SaveResult['libraryItem'] | null });
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
    state.savedItem = null; state.base = detail; state.markers = detail.annotations.map(({ id, x, y, note, severity, size }) => ({ id, x, y, note, severity, size: size ?? 24 })); state.removed = []; state.selectedId = null; state.pending = null; state.error = ''; state.requestId = '';
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
  function snapshot() { return state.base && (count() || state.pending) ? JSON.stringify({ base: state.base, markers: state.markers, removed: state.removed, selectedId: state.selectedId, pending: state.pending }) : null; }
  function restore(raw: string, imageId: string) {
    const value = draftSchema.parse(JSON.parse(raw));
    if (value.base.image.id !== imageId || value.base.revision.imageId !== imageId) throw new Error('Draft image mismatch');
    Object.assign(state, value); return value;
  }
  async function save(userId: string, send: (imageId: string, payload: SaveReview) => Promise<SaveResult>) {
    if (state.busy || !state.base) return false;
    if (!state.pending) {
      if (!count()) return true;
      const parsed = saveReviewSchema.safeParse({ userId, requestId: crypto.randomUUID(), baseRevisionId: state.base.revision.id, markers: state.markers.filter(row => !state.removed.includes(row.id)) });
      if (!parsed.success) {
        const invalid = state.markers.find(row => !state.removed.includes(row.id) && (!row.note.trim() || row.note.trim().length > 2000 || !markerSizeSchema.safeParse(row.size ?? 24).success));
        if (invalid) state.selectedId = invalid.id;
        state.error = '请检查标记说明（1–2000 字符）和大小（12–48 整数像素）'; return false;
      }
      state.pending = parsed.data;
    }
    state.busy = true; state.error = ''; state.message = ''; state.requestId = '';
    try {
      const result = await send(state.base.image.id, state.pending);
      bind(result.detail); state.savedItem = result.libraryItem; state.message = result.created ? '本次修改已保存' : '已确认保存结果'; return true;
    } catch (error) {
      state.error = error instanceof Error ? error.message : '保存失败'; state.requestId = error instanceof RequestFailure ? error.requestId : '';
      if (error instanceof RequestFailure && error.status !== null) state.pending = null;
      return false;
    } finally { state.busy = false; }
  }
  return { state, old, kind, count, blocked, bind, place, remove, undo, restoreRemoved, snapshot, restore, save };
}
