import type { Size } from './review-view';

export function createStageResize(measure: () => Size, apply: (size: Size) => void, schedule: (callback: () => void) => number = requestAnimationFrame, cancel: (id: number) => void = cancelAnimationFrame) {
  let frame: number | undefined; let stopped = false; let last: Size | undefined;
  function request() {
    if (stopped || frame !== undefined) return;
    frame = schedule(() => {
      frame = undefined;
      if (stopped) return;
      const measured = measure();
      const next = { width: Math.floor(measured.width), height: Math.floor(measured.height) };
      if (![next.width, next.height].every(value => Number.isFinite(value) && value > 0) || (next.width === last?.width && next.height === last.height)) return;
      last = { ...next }; apply(last);
    });
  }
  function dispose() { stopped = true; if (frame !== undefined) cancel(frame); frame = undefined; }
  return { request, dispose };
}
