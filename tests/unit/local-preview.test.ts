import { describe, it, expect, vi } from 'vitest';
import { createLocalPreview } from '../../src/client/local-preview';
import { createReviewSession } from '../../src/client/review-session';

const file = (name = 'sample.png') => new File(['sample'], name, { type: 'image/png' });
const dimensions = { width: 800, height: 600 };
function setup() {
  let nextUrl = 0;
  const review = createReviewSession();
  const deps = {
    createUrl: vi.fn(() => `blob:test-${++nextUrl}`),
    revokeUrl: vi.fn(),
    decode: vi.fn<(url: string, signal: AbortSignal) => Promise<typeof dimensions>>(async () => dimensions),
    canReplace: vi.fn(() => true),
    onReplace: vi.fn(() => review.reset()),
  };
  return { ...createLocalPreview(deps), deps, review };
}
function addReview(model: ReturnType<typeof setup>) {
  model.review.request({ kind: 'place', point: { x: 0.2, y: 0.3 } });
  model.review.state.draft!.note = '已有说明';
  model.review.applyDraft();
  model.review.request({ kind: 'edit', id: model.review.state.selectedId! });
  model.review.state.draft!.note = '不能丢失的修改';
}
function deferred() {
  let resolve!: (value: typeof dimensions) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof dimensions>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('temporary preview lifecycle', () => {
  it('rejects invalid files before allocating a URL', async () => {
    const model = setup();
    await model.select(new File(['invalid'], 'x.svg', { type: 'image/svg+xml' }));
    expect(model.state.error).not.toBe('');
    expect(model.deps.createUrl).not.toHaveBeenCalled();
    expect(model.state.loading).toBe(false);
    model.dispose();
  });
  it('cancelling replacement and clear preserves the full review session', async () => {
    const model = setup();
    await model.select(file());
    addReview(model);
    const snapshot = structuredClone(JSON.parse(JSON.stringify(model.review.state)));
    model.deps.canReplace.mockReturnValue(false);
    await model.select(file('replacement.png'));
    model.clear();
    expect(model.state.image?.name).toBe('sample.png');
    expect(model.review.state).toEqual(snapshot);
    expect(model.deps.decode).toHaveBeenCalledTimes(1);
    expect(model.deps.revokeUrl).not.toHaveBeenCalled();
    model.dispose();
  });
  it.each(['decode', 'dimensions', 'type'])('preserves image, markers, selected record and editing copy on %s failure', async failure => {
    const model = setup();
    await model.select(file());
    addReview(model);
    const snapshot = JSON.parse(JSON.stringify(model.review.state));
    if (failure === 'decode') model.deps.decode.mockRejectedValueOnce(new Error('path/secret'));
    if (failure === 'dimensions') model.deps.decode.mockResolvedValueOnce({ width: 12001, height: 1 });
    await model.select(failure === 'type' ? new File(['bad'], 'bad.txt') : file('bad.png'));
    expect(model.state.image?.url).toBe('blob:test-1');
    expect(model.review.state).toEqual(snapshot);
    expect(model.state.error).not.toBe('');
    expect(model.state.error).not.toContain('secret');
    expect(model.state.loading).toBe(false);
    expect(model.deps.revokeUrl.mock.calls.flat()).not.toContain('blob:test-1');
    expect(model.deps.onReplace).toHaveBeenCalledTimes(1);
    if (failure !== 'type') expect(model.deps.revokeUrl).toHaveBeenCalledWith('blob:test-2');
    model.dispose();
  });
  it('resets the review only after successful replacement and releases URLs', async () => {
    const model = setup();
    await model.select(file());
    addReview(model);
    await model.select(file('new.png'));
    expect(model.state.image?.name).toBe('new.png');
    expect(model.review.hasContent()).toBe(false);
    expect(model.deps.revokeUrl).toHaveBeenCalledWith('blob:test-1');
    model.clear();
    expect(model.state.image).toBeNull();
    expect(model.deps.revokeUrl).toHaveBeenCalledWith('blob:test-2');
    model.dispose();
    expect(model.deps.revokeUrl).toHaveBeenCalledTimes(2);
  });
  it('keeps the latest selection when an earlier decode completes late', async () => {
    const model = setup();
    const old = deferred();
    model.deps.decode.mockReturnValueOnce(old.promise);
    const oldSelection = model.select(file('old.png'));
    const signal = model.deps.decode.mock.calls[0][1];
    await model.select(file('latest.png'));
    expect(signal.aborted).toBe(true);
    old.resolve(dimensions);
    await oldSelection;
    expect(model.state.image?.name).toBe('latest.png');
    expect(model.deps.revokeUrl).toHaveBeenCalledWith('blob:test-1');
    expect(model.deps.onReplace).toHaveBeenCalledTimes(1);
    model.dispose();
  });
  it('ignores stale failures without clearing the new loading state', async () => {
    const model = setup();
    const old = deferred();
    const latest = deferred();
    model.deps.decode.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const oldSelection = model.select(file('old.png'));
    const newSelection = model.select(file('latest.png'));
    old.reject(new Error('stale'));
    await oldSelection;
    expect(model.state.error).toBe('');
    expect(model.state.loading).toBe(true);
    latest.resolve(dimensions);
    await newSelection;
    model.dispose();
  });
  it.each(['clear', 'dispose'] as const)('%s cancels pending decoding and prevents stale restoration', async action => {
    const model = setup();
    await model.select(file());
    const pending = deferred();
    model.deps.decode.mockReturnValueOnce(pending.promise);
    const selection = model.select(file('pending.png'));
    const signal = model.deps.decode.mock.calls[1][1];
    model[action]();
    expect(signal.aborted).toBe(true);
    pending.resolve(dimensions);
    await selection;
    expect(model.state.image).toBeNull();
    expect(model.state.loading).toBe(false);
  });
});
