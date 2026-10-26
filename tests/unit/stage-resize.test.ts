import { describe, expect, it, vi } from 'vitest';
import { createStageResize } from '../../src/client/stage-resize';

describe('stage resize batching', () => {
  it('coalesces resize bursts, ignores unchanged/hidden sizes and cancels queued work on disposal', () => {
    let size = { width: 600, height: 400 }; let nextId = 0; const frames = new Map<number, () => void>(); const apply = vi.fn();
    const batch = createStageResize(() => size, apply, callback => { frames.set(++nextId, callback); return nextId; }, id => { frames.delete(id); });
    const flush = () => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); };
    batch.request(); batch.request(); expect(frames.size).toBe(1); flush(); expect(apply).toHaveBeenCalledTimes(1);
    batch.request(); flush(); expect(apply).toHaveBeenCalledTimes(1);
    size = { width: 600.8, height: 400.4 }; batch.request(); flush(); expect(apply).toHaveBeenCalledTimes(1);
    size = { width: 0, height: 0 }; batch.request(); flush(); expect(apply).toHaveBeenCalledTimes(1);
    size = { width: 500, height: 300 }; batch.request(); flush(); expect(apply).toHaveBeenLastCalledWith(size);
    batch.request(); batch.dispose(); flush(); batch.request(); expect(frames.size).toBe(0); expect(apply).toHaveBeenCalledTimes(2);
  });
});
