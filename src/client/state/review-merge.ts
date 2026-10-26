import type { WorkingMarker, WorkspaceDetail } from '../../shared/workbench-contracts';

export type MergeChoice = 'mine' | 'theirs' | 'recreate';
export type MergeConflict = { id: string; before: WorkingMarker | null; mine: WorkingMarker | null; theirs: WorkingMarker | null; recreate: boolean };
export type ReviewMerge = { latest: WorkspaceDetail; markers: WorkingMarker[]; conflicts: MergeConflict[]; localChanges: number; remoteChanges: number };
export const workingMarker = ({ id, x, y, note, severity, size }: WorkingMarker): WorkingMarker => ({ id, x, y, note, severity, size: size ?? 24 });
function same(a: WorkingMarker | undefined, b: WorkingMarker | undefined) {
  return !a || !b ? a === b : a.x === b.x && a.y === b.y && a.note.trim() === b.note.trim() && a.severity === b.severity && (a.size ?? 24) === (b.size ?? 24);
}

export function planReviewMerge(base: WorkspaceDetail, local: WorkingMarker[], removed: string[], latest: WorkspaceDetail): ReviewMerge {
  if (base.image.id !== latest.image.id || base.image.sha256 !== latest.image.sha256 || base.image.width !== latest.image.width || base.image.height !== latest.image.height) throw new Error('原图发生变化，不能合并到另一张图片');
  const before = new Map(base.annotations.map(row => [row.id, workingMarker(row)]));
  const mine = new Map(local.filter(row => !removed.includes(row.id)).map(row => [row.id, workingMarker(row)]));
  const theirs = new Map(latest.annotations.map(row => [row.id, workingMarker(row)]));
  const plan: ReviewMerge = { latest, markers: [], conflicts: [], localChanges: 0, remoteChanges: 0 };
  // Start with remote order; local-only additions follow it. Matching never uses display numbers.
  for (const id of new Set([...theirs.keys(), ...mine.keys(), ...before.keys()])) {
    const b = before.get(id); const l = mine.get(id); const r = theirs.get(id);
    const localChanged = !same(b, l); const remoteChanged = !same(b, r);
    if (localChanged) plan.localChanges++;
    if (remoteChanged) plan.remoteChanges++;
    if (!localChanged) { if (r) plan.markers.push(r); }
    else if (!remoteChanged || same(l, r)) { if (l) plan.markers.push(l); }
    else plan.conflicts.push({ id, before: b ?? null, mine: l ?? null, theirs: r ?? null, recreate: !!l && (!r || !b || l.x !== r.x || l.y !== r.y) });
  }
  return plan;
}

export function resolveReviewMerge(plan: ReviewMerge, choices: Record<string, MergeChoice | undefined>): WorkingMarker[] {
  const rows = plan.markers.map(workingMarker);
  for (const conflict of plan.conflicts) {
    const choice = choices[conflict.id];
    if (!choice || (conflict.recreate && choice === 'mine') || (!conflict.recreate && choice === 'recreate')) throw new Error('请先处理每一项冲突');
    if (choice === 'theirs') { if (conflict.theirs) rows.push(workingMarker(conflict.theirs)); }
    else if (choice === 'recreate') {
      if (conflict.theirs) rows.push(workingMarker(conflict.theirs));
      rows.push({ ...workingMarker(conflict.mine!), id: crypto.randomUUID() });
    } else if (conflict.mine) rows.push(workingMarker(conflict.mine));
  }
  const desired = new Set(rows.map(row => row.id));
  if (rows.length + plan.latest.annotations.filter(row => !desired.has(row.id)).length > 500) throw new Error('合并后连同待删除项超过 500 条标记，请减少本地新增后重新核对');
  return rows;
}
