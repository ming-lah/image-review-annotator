import { reactive } from 'vue';
import { noteState, type Draft, type Point } from './review';
import type { AnnotationDto, Severity } from '../shared/review-contracts';

export interface LocalMarker extends Draft { id: string; label: number; size?: number; severity?: Severity; saved?: AnnotationDto; change?: 'add' | 'modify' | 'delete' | 'inherited' }
export interface EditorDraft extends Draft { id: string | null; requestId?: string; severity?: Severity; baseVersion?: number }
export interface ReviewSnapshot { markers: LocalMarker[]; expandedIds: string[]; selectedId: string | null; draft: EditorDraft | null; nextLabel: number }
type ReviewAction = { kind: 'place'; point: Point } | { kind: 'select' | 'edit'; id: string } | { kind: 'reload' };

export function createReviewSession(makeId: () => string = () => crypto.randomUUID()) {
  const state = reactive({
    markers: [] as LocalMarker[], expandedIds: [] as string[], selectedId: null as string | null, draft: null as EditorDraft | null,
    pending: null as ReviewAction | null, deleteId: null as string | null, hint: '', locked: false,
  });
  let nextLabel = 1;
  const find = (id: string) => state.markers.find(marker => marker.id === id);
  const hasContent = () => state.markers.length > 0 || state.draft !== null;
  const isDirty = () => state.draft !== null && (state.draft.id === null || state.draft.note !== find(state.draft.id)?.note || (state.draft.severity ?? 'medium') !== (find(state.draft.id)?.severity ?? 'medium'));

  function perform(action: ReviewAction) {
    state.draft = null;
    state.hint = '';
    if (action.kind === 'place') {
      state.selectedId = null;
      state.draft = { ...action.point, note: '', id: null, requestId: makeId(), severity: 'medium' };
    } else if (action.kind !== 'reload') {
      const marker = find(action.id);
      if (!marker) return;
      state.selectedId = marker.id;
      if (action.kind === 'edit') state.draft = { x: marker.x, y: marker.y, note: marker.note, id: marker.id, severity: marker.severity ?? 'medium', baseVersion: marker.saved?.version };
    }
  }

  function request(action: ReviewAction) {
    if (state.locked || state.pending || state.deleteId) return;
    if (action.kind === 'place' && ![action.point.x, action.point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return;
    if (action.kind !== 'place' && action.kind !== 'reload' && !find(action.id)) return;
    if (action.kind === 'select' && state.draft?.id === action.id) return;
    if (isDirty()) state.pending = action;
    else perform(action);
  }

  function applyDraft() {
    const draft = state.draft;
    if (state.locked || !draft) return false;
    if (noteState(draft.note) !== 'valid') { state.hint = '请填写 1–2000 字符的问题说明。'; return false; }
    if (draft.id === null) {
      const marker: LocalMarker = { id: draft.requestId ?? makeId(), label: nextLabel++, x: draft.x, y: draft.y, note: draft.note.trim(), severity: draft.severity ?? 'medium' };
      state.markers.push(marker);
      state.selectedId = marker.id;
    } else {
      const marker = find(draft.id);
      if (!marker) return false;
      marker.note = draft.note.trim();
      marker.severity = draft.severity ?? 'medium';
      state.selectedId = marker.id;
    }
    state.draft = null;
    state.hint = '';
    return true;
  }

  function resolvePending(choice: 'apply' | 'discard' | 'stay') {
    const action = state.pending;
    if (state.locked || !action) return;
    if (choice === 'stay') { state.pending = null; return; }
    if (choice === 'apply' && !applyDraft()) return;
    state.pending = null;
    perform(action);
  }

  function cancelDraft() {
    if (state.locked || state.pending || state.deleteId) return;
    state.draft = null;
    state.hint = '';
  }

  function requestDelete(id: string) {
    if (state.locked || state.pending || state.deleteId || !find(id) || state.selectedId !== id) return;
    state.deleteId = id;
  }

  function resolveDelete(confirmed: boolean) {
    if (state.locked || !state.deleteId) return;
    if (confirmed) {
      const id = state.deleteId;
      state.markers = state.markers.filter(marker => marker.id !== id);
      state.expandedIds = state.expandedIds.filter(value => value !== id);
      if (state.draft?.id === id) state.draft = null;
      if (state.selectedId === id) state.selectedId = null;
    }
    state.deleteId = null;
  }

  function reset() {
    state.markers = [];
    state.expandedIds = [];
    state.selectedId = null;
    state.draft = null;
    state.pending = null;
    state.deleteId = null;
    state.hint = '';
    nextLabel = 1;
  }

  function setExpanded(id: string, expanded: boolean) {
    if (state.locked || state.pending || state.deleteId || !find(id)) return;
    if (expanded && !state.expandedIds.includes(id)) state.expandedIds.push(id);
    if (!expanded) state.expandedIds = state.expandedIds.filter(value => value !== id);
  }

  function collapseAll() {
    if (!state.locked && !state.pending && !state.deleteId) state.expandedIds = [];
  }

  function snapshot(): ReviewSnapshot {
    return { markers: state.markers.map(marker => ({ ...marker })), expandedIds: [...state.expandedIds], selectedId: state.selectedId, draft: state.draft ? { ...state.draft } : null, nextLabel };
  }

  function restore(value: ReviewSnapshot) {
    reset();
    state.markers = value.markers.map(marker => ({ ...marker }));
    state.expandedIds = [...value.expandedIds];
    state.selectedId = value.selectedId;
    state.draft = value.draft ? { ...value.draft } : null;
    nextLabel = value.nextLabel;
  }

  function commitSaved(saved: AnnotationDto) {
    const old = find(saved.id);
    const marker: LocalMarker = { id: saved.id, label: old?.label ?? nextLabel++, x: saved.x, y: saved.y, note: saved.note, severity: saved.severity, saved };
    if (old) state.markers.splice(state.markers.indexOf(old), 1, marker);
    else state.markers.push(marker);
    if (state.draft?.id === saved.id || state.draft?.requestId === saved.id) state.draft = null;
    state.selectedId = saved.id;
  }
  function mergeSaved(saved: AnnotationDto[]) {
    const savedIds = new Set(saved.map(row => row.id));
    const previous = new Map(state.markers.map(marker => [marker.id, marker]));
    const locals = state.markers.filter(marker => !marker.saved && !savedIds.has(marker.id));
    state.markers = [...saved.map(row => ({ id: row.id, label: previous.get(row.id)?.label ?? nextLabel++, x: row.x, y: row.y, note: row.note, severity: row.severity, saved: row })), ...locals];
    const ids = new Set(state.markers.map(marker => marker.id));
    state.expandedIds = state.expandedIds.filter(id => ids.has(id));
    if (state.selectedId && !ids.has(state.selectedId)) state.selectedId = null;
  }
  function removeSaved(id: string) {
    state.markers = state.markers.filter(marker => marker.id !== id);
    state.expandedIds = state.expandedIds.filter(value => value !== id);
    if (state.draft?.id === id) state.draft = null;
    if (state.selectedId === id) state.selectedId = null;
    state.deleteId = null;
  }

  return { state, request, applyDraft, resolvePending, cancelDraft, requestDelete, resolveDelete, reset, isDirty, hasContent, setExpanded, collapseAll, snapshot, restore, commitSaved, mergeSaved, removeSaved };
}
