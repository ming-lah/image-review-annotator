import { describe, expect, it } from 'vitest';
import { createReviewSession } from '../../src/client/review-session';

function setup() {
  let id = 0;
  return createReviewSession(() => `marker-${++id}`);
}
function add(model: ReturnType<typeof setup>, note = '说明', x = 0.2) {
  model.request({ kind: 'place', point: { x, y: 0.3 } });
  model.state.draft!.note = note;
  expect(model.applyDraft()).toBe(true);
  return model.state.selectedId!;
}

describe('in-page review session', () => {
  it('restores a snapshot without sharing mutable references or reusing previously deleted labels', () => {
    const original = setup();
    const id = add(original);
    original.requestDelete(id);
    original.resolveDelete(true);
    const snapshot = original.snapshot();
    const refreshed = setup();
    refreshed.restore(snapshot);
    add(refreshed);
    expect(refreshed.state.markers[0].label).toBe(2);
    expect(snapshot.markers).toEqual([]);
  });
  it('retains multiple expanded records independently, and collapsing never loses notes or an editing draft', () => {
    const model = setup();
    const first = add(model, 'first');
    const second = add(model, 'second');
    expect(model.state.expandedIds).toEqual([]);
    model.setExpanded(first, true);
    model.setExpanded(second, true);
    model.setExpanded(first, true);
    expect(model.state.expandedIds).toEqual([first, second]);
    model.request({ kind: 'edit', id: second });
    model.state.draft!.note = 'still editing';
    model.setExpanded(first, false);
    expect(model.state.expandedIds).toEqual([second]);
    model.collapseAll();
    expect(model.state.markers.map(marker => marker.note)).toEqual(['first', 'second']);
    expect(model.state.draft?.note).toBe('still editing');
    model.setExpanded(second, true);
    expect(model.state.draft?.note).toBe('still editing');
    model.requestDelete(second);
    model.resolveDelete(true);
    expect(model.state.expandedIds).toEqual([]);
  });
  it('collects stable markers with trimmed text, and does not reuse deleted labels', () => {
    const model = setup();
    const first = add(model, '  first  ');
    const second = add(model, 'second');
    expect(model.state.markers.map(marker => marker.label)).toEqual([1, 2]);
    expect(model.state.markers[0].note).toBe('first');
    model.requestDelete(second);
    model.resolveDelete(false);
    expect(model.state.markers).toHaveLength(2);
    model.requestDelete(second);
    model.resolveDelete(true);
    expect(model.state.selectedId).toBeNull();
    const third = add(model);
    expect(model.state.markers.map(marker => [marker.id, marker.label])).toEqual([[first, 1], [third, 3]]);
  });
  it('isolates edits, cancels without mutating the original and applies only note changes', () => {
    const model = setup();
    const id = add(model);
    model.request({ kind: 'edit', id });
    expect(model.isDirty()).toBe(false);
    model.state.draft!.note = 'changed';
    expect(model.isDirty()).toBe(true);
    expect(model.state.markers[0].note).toBe('说明');
    model.cancelDraft();
    model.request({ kind: 'edit', id });
    model.state.draft!.note = '  changed  ';
    model.applyDraft();
    expect(model.state.markers[0]).toEqual({ id, label: 1, x: 0.2, y: 0.3, note: 'changed', severity: 'medium' });
  });
  it('preserves invalid input, prevents repeated targets and executes the original action once', () => {
    const model = setup();
    const id = add(model);
    model.request({ kind: 'place', point: { x: 0.7, y: 0.8 } });
    expect(model.isDirty()).toBe(true);
    model.request({ kind: 'edit', id });
    model.request({ kind: 'place', point: { x: 1, y: 1 } });
    model.resolvePending('apply');
    expect(model.state.pending).toEqual({ kind: 'edit', id });
    expect(model.state.draft?.note).toBe('');
    model.state.draft!.note = 'valid';
    model.resolvePending('apply');
    expect(model.state.markers).toHaveLength(2);
    expect(model.state.draft?.id).toBe(id);
    model.resolvePending('apply');
    expect(model.state.markers).toHaveLength(2);
  });
  it('supports stay and discard, with blank and overlong notes blocked from collection', () => {
    const model = setup();
    model.request({ kind: 'place', point: { x: 0, y: 0 } });
    model.state.draft!.note = ' ';
    expect(model.applyDraft()).toBe(false);
    model.state.draft!.note = '中'.repeat(2001);
    expect(model.applyDraft()).toBe(false);
    model.request({ kind: 'place', point: { x: 1, y: 1 } });
    model.resolvePending('stay');
    expect(model.state.draft?.x).toBe(0);
    model.request({ kind: 'place', point: { x: 1, y: 1 } });
    model.resolvePending('discard');
    expect(model.state.draft).toMatchObject({ id: null, x: 1, y: 1, note: '', severity: 'medium' });
    expect(model.state.draft?.requestId).toBeTruthy();
    expect(model.state.markers).toHaveLength(0);
  });
  it('allows switching unmodified edits, rejects invalid coordinates and freezes during loading', () => {
    const model = setup();
    const first = add(model);
    const second = add(model);
    model.request({ kind: 'edit', id: first });
    model.state.draft!.note = 'changed';
    model.state.draft!.note = '说明';
    model.request({ kind: 'select', id: second });
    expect(model.state.pending).toBeNull();
    model.state.locked = true;
    model.request({ kind: 'place', point: { x: 0.5, y: 0.5 } });
    model.requestDelete(second);
    expect(model.state.draft).toBeNull();
    expect(model.state.deleteId).toBeNull();
    model.state.locked = false;
    model.request({ kind: 'place', point: { x: NaN, y: 2 } });
    expect(model.state.draft).toBeNull();
  });
  it('deletes an edited marker in one confirmation and resets the session', () => {
    const model = setup();
    const id = add(model);
    model.request({ kind: 'edit', id });
    model.state.draft!.note = 'editing';
    model.requestDelete(id);
    expect(model.state.pending).toBeNull();
    model.resolveDelete(true);
    expect(model.state.draft).toBeNull();
    expect(model.hasContent()).toBe(false);
    add(model);
    model.reset();
    add(model);
    expect(model.state.markers[0].label).toBe(1);
  });
});
