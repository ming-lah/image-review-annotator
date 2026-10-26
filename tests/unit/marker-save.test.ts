import { describe, expect, it, vi } from 'vitest';
import { createWorkingCopy } from '../../src/client/state/working-copy';
import { RequestFailure } from '../../src/client/http/review-api';
import type { WorkingMarker, WorkspaceDetail, SaveReview, SaveResult } from '../../src/shared/workbench-contracts';

const userId = crypto.randomUUID(); const imageId = crypto.randomUUID();
const marker = (note: string): WorkingMarker => ({ id: crypto.randomUUID(), x: 0.2, y: 0.3, note, severity: 'medium', size: 24 });
function detail(rows: WorkingMarker[]): WorkspaceDetail {
  return { image: { id: imageId, originalName: 'test.png', width: 32, height: 24, mimeType: 'image/png', fileSize: 100, sha256: 'a'.repeat(64), createdAt: '', updatedAt: '' }, revision: { id: crypto.randomUUID(), imageId, parentRevisionId: null, userId, username: 'A', savedAt: '', kind: 'save', added: 0, modified: 0, deleted: 0, versionNumber: 1 }, annotations: rows.map((row, index) => ({ ...row, size: row.size ?? 24, imageId, number: index + 1, version: 1, createdBy: userId, updatedBy: userId, createdByName: 'A', updatedByName: 'A', createdAt: '', updatedAt: '' })) };
}
const saved = (value: WorkspaceDetail): SaveResult => ({ created: true, detail: value, savedRevisionId: value.revision.id });

describe('saving one marker while preserving other drafts', () => {
  it('submits only the target delta, keeps other additions/edits/deletions, and does not validate an unrelated empty draft', async () => {
    const a = marker('a'); const b = marker('b'); const c = marker('c'); const base = detail([a, b, c]);
    const copy = createWorkingCopy(); copy.bind(base); copy.state.markers[0].note = 'target'; copy.state.markers[1].note = 'other edit'; copy.remove(c.id); copy.place({ x: 0.8, y: 0.8 });
    const newId = copy.state.selectedId!; const formal = detail([{ ...a, note: 'target' }, b, c]);
    const send = vi.fn(async (_image: string, payload: SaveReview) => { expect(payload.markers.map(row => row.note)).toEqual(['target', 'b', 'c']); return saved(formal); });
    expect(await copy.save(userId, send, a.id)).toBe(true);
    expect(copy.state.base).toEqual(formal); expect(copy.kind(a.id)).toBeNull(); expect(copy.kind(b.id)).toBe('modify'); expect(copy.kind(c.id)).toBe('delete'); expect(copy.kind(newId)).toBe('add');
    expect(copy.state.markers.find(row => row.id === b.id)?.note).toBe('other edit'); expect(copy.state.markers.find(row => row.id === newId)?.note).toBe(''); expect(copy.count()).toBe(3);
  });
  it('persists a new target without committing or cancelling the other new point', async () => {
    const copy = createWorkingCopy(); copy.bind(detail([])); copy.place({ x: 0.1, y: 0.1 }); copy.state.markers[0].note = 'first'; const target = copy.state.markers[0]; copy.place({ x: 0.8, y: 0.8 }); copy.state.markers[1].note = 'second';
    const send = vi.fn(async () => saved(detail([target])));
    expect(await copy.save(userId, send, target.id)).toBe(true); expect(copy.count()).toBe(1); expect(copy.state.markers).toHaveLength(2); copy.undo(copy.state.markers[1].id); expect(copy.state.markers).toHaveLength(1);
  });
  it('freezes the original marker scope through a refresh and ignores another requested scope on retry', async () => {
    const a = marker('a'); const copy = createWorkingCopy(); copy.bind(detail([a])); copy.state.markers[0].note = 'target'; copy.place({ x: 0.8, y: 0.8 });
    const send = vi.fn().mockRejectedValueOnce(new RequestFailure('lost')).mockResolvedValueOnce(saved(detail([{ ...a, note: 'target' }])));
    expect(await copy.save(userId, send, a.id)).toBe(false);
    const restored = createWorkingCopy(); restored.restore(copy.snapshot()!, imageId); expect(restored.state.pendingMarkerId).toBe(a.id);
    expect(await restored.save(crypto.randomUUID(), send, restored.state.markers[1].id)).toBe(true); expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(restored.state.markers[1].note).toBe(''); expect(restored.count()).toBe(1);
  });
  it('uses the precise saved revision on a late receipt and retains the frozen request if that read fails', async () => {
    const a = marker('a'); const b = marker('b'); const copy = createWorkingCopy(); copy.bind(detail([a, b])); copy.state.markers[0].note = 'target'; copy.state.markers[1].note = 'my other edit';
    const own = detail([{ ...a, note: 'target' }, b]); const latest = detail([{ ...a, note: 'later remote target' }, { ...b, note: 'remote other edit' }]);
    const receipt = { ...saved(latest), created: false, savedRevisionId: own.revision.id }; const send = vi.fn(async () => receipt);
    const read = vi.fn().mockRejectedValueOnce(new RequestFailure('read failed', 503)).mockResolvedValueOnce(own);
    expect(await copy.save(userId, send, a.id, read)).toBe(false); expect(copy.state.pending).not.toBeNull(); expect(copy.state.markers[1].note).toBe('my other edit'); expect(copy.state.error).toContain('已保存');
    expect(await copy.save(userId, send, undefined, read)).toBe(true); expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(copy.state.base?.revision.id).toBe(own.revision.id); expect(copy.state.savedLatestRevisionId).toBe(latest.revision.id);
    expect(copy.state.markers.map(row => row.note)).toEqual(['target', 'my other edit']);
  });
  it('keeps every draft after a conflict and rejects an invalid target without sending other valid drafts', async () => {
    const a = marker('a'); const copy = createWorkingCopy(); copy.bind(detail([a])); copy.place({ x: 0.8, y: 0.8 }); const id = copy.state.selectedId!;
    const send = vi.fn(async () => { throw new RequestFailure('changed', 409, 'REVIEW_BASE_CHANGED'); });
    expect(await copy.save(userId, send, id)).toBe(false); expect(send).not.toHaveBeenCalled();
    copy.state.markers[1].note = 'valid'; const before = copy.snapshot(); expect(await copy.save(userId, send, id)).toBe(false); expect(copy.state.pending).toBeNull(); expect(copy.snapshot()).toBe(before);
  });
});
