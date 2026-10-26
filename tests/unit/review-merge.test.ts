import { describe, expect, it } from 'vitest';
import { planReviewMerge, resolveReviewMerge } from '../../src/client/state/review-merge';
import type { WorkspaceDetail, WorkingMarker } from '../../src/shared/workbench-contracts';

const userId = crypto.randomUUID(); const imageId = crypto.randomUUID();
const marker = (note: string): WorkingMarker => ({ id: crypto.randomUUID(), x: 0.2, y: 0.3, note, severity: 'medium', size: 24 });
function detail(markers: WorkingMarker[]): WorkspaceDetail {
  return { image: { id: imageId, originalName: 'test.png', width: 32, height: 24, mimeType: 'image/png', fileSize: 100, sha256: 'a'.repeat(64), createdAt: '', updatedAt: '' }, revision: { id: crypto.randomUUID(), imageId, parentRevisionId: null, userId, username: 'A', savedAt: '', kind: 'save', added: 0, modified: 0, deleted: 0, versionNumber: 1 }, annotations: markers.map((row, index) => ({ ...row, size: row.size ?? 24, imageId, number: index + 1, version: 1, createdBy: userId, updatedBy: userId, createdByName: 'A', updatedByName: 'A', createdAt: '', updatedAt: '' })) };
}

describe('three-way review merge', () => {
  it('preserves independent additions and edits without treating absent remote additions as deletions', () => {
    const a = marker('a'); const b = marker('b'); const mine = marker('my new'); const remote = marker('remote new');
    const base = detail([a, b]); const latest = detail([a, { ...b, note: 'remote edit' }, remote]);
    const plan = planReviewMerge(base, [{ ...a, note: 'my edit' }, b, mine], [], latest);
    expect(plan.conflicts).toEqual([]);
    const result = resolveReviewMerge(plan, {});
    expect(result.map(row => row.note).sort()).toEqual(['my edit', 'my new', 'remote edit', 'remote new']);
    expect(base.annotations[0].note).toBe('a'); expect(latest.annotations[0].note).toBe('a');
  });
  it('requires an explicit whole-marker choice and accepts identical results without a conflict', () => {
    const a = marker('before'); const base = detail([a]); const latest = detail([{ ...a, note: 'theirs' }]);
    const plan = planReviewMerge(base, [{ ...a, severity: 'high' }], [], latest);
    expect(plan.conflicts).toHaveLength(1);
    expect(() => resolveReviewMerge(plan, {})).toThrow();
    expect(resolveReviewMerge(plan, { [a.id]: 'mine' })[0]).toMatchObject({ note: 'before', severity: 'high' });
    expect(resolveReviewMerge(plan, { [a.id]: 'theirs' })[0].note).toBe('theirs');
    expect(planReviewMerge(base, [{ ...a, note: 'theirs' }], [], latest).conflicts).toEqual([]);
  });
  it('never silently resurrects a remotely deleted marker and only recreates with a new UUID', () => {
    const a = marker('before'); const base = detail([a]); const latest = detail([]);
    expect(resolveReviewMerge(planReviewMerge(base, [a], [], latest), {})).toEqual([]);
    const plan = planReviewMerge(base, [{ ...a, note: 'keep this text' }], [], latest);
    expect(() => resolveReviewMerge(plan, { [a.id]: 'mine' })).toThrow();
    expect(resolveReviewMerge(plan, { [a.id]: 'theirs' })).toEqual([]);
    const recreated = resolveReviewMerge(plan, { [a.id]: 'recreate' })[0];
    expect(recreated.note).toBe('keep this text'); expect(recreated.id).not.toBe(a.id);
  });
  it('requires confirmation for local deletion versus a remote edit, but not for two identical deletions', () => {
    const a = marker('before'); const base = detail([a]); const latest = detail([{ ...a, size: 48 }]);
    const plan = planReviewMerge(base, [a], [a.id], latest);
    expect(plan.conflicts).toHaveLength(1);
    expect(resolveReviewMerge(plan, { [a.id]: 'mine' })).toEqual([]);
    expect(resolveReviewMerge(plan, { [a.id]: 'theirs' })[0].size).toBe(48);
    expect(resolveReviewMerge(planReviewMerge(base, [a], [a.id], detail([])), {})).toEqual([]);
  });
  it('keeps raw local input and rejects cross-image or changed-original merges', () => {
    const a = marker('before'); const base = detail([a]); const latest = detail([a]);
    expect(resolveReviewMerge(planReviewMerge(base, [{ ...a, note: '  typing  ' }], [], latest), {})[0].note).toBe('  typing  ');
    expect(() => planReviewMerge(base, [a], [], { ...latest, image: { ...latest.image, id: crypto.randomUUID() } })).toThrow();
    expect(() => planReviewMerge(base, [a], [], { ...latest, image: { ...latest.image, sha256: 'b'.repeat(64) } })).toThrow();
  });
  it('handles a colliding new ID explicitly and rejects oversized recoverable drafts before mutating them', () => {
    const local = marker('mine'); const remote = { ...local, note: 'theirs' };
    const collision = planReviewMerge(detail([]), [local], [], detail([remote]));
    expect(collision.conflicts[0].recreate).toBe(true);
    expect(() => resolveReviewMerge(collision, { [local.id]: 'mine' })).toThrow();
    const rows = resolveReviewMerge(collision, { [local.id]: 'recreate' }); expect(rows).toHaveLength(2); expect(rows[0].id).not.toBe(rows[1].id);
    const latest = detail(Array.from({ length: 500 }, (_, index) => marker(String(index))));
    const oversized = planReviewMerge(detail([]), [marker('extra')], [], latest);
    expect(() => resolveReviewMerge(oversized, {})).toThrow('500'); expect(latest.annotations).toHaveLength(500);
  });
});
