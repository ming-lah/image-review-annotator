import { describe, expect, it } from 'vitest';
import { fitScale, imageOffset, scrollToPoint, stageCanvasSize, stepScale, viewportCenter } from '../../src/client/review-view';

describe('review viewport geometry', () => {
  it('aligns centered originals to physical pixels while keeping anchor math consistent at different display scales', () => {
    const image = { width: 32, height: 24 }; const viewport = { width: 799, height: 451 };
    for (const ratio of [1, 1.25, 1.5, 2]) {
      const offset = imageOffset(image, viewport, 1, ratio);
      expect(offset.x * ratio).toBeCloseTo(Math.round(offset.x * ratio), 9); expect(offset.y * ratio).toBeCloseTo(Math.round(offset.y * ratio), 9);
      expect(Math.abs(offset.x + image.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(0.5 / ratio + 1e-7);
      const large = { width: 2000, height: 1500 }; const anchor = { x: 0.6, y: 0.6 };
      const scroll = scrollToPoint(anchor, large, viewport, 2, ratio);
      expect(viewportCenter(large, viewport, 2, scroll, ratio).x).toBeCloseTo(anchor.x, 12);
      expect(viewportCenter(large, viewport, 2, scroll, ratio).y).toBeCloseTo(anchor.y, 12);
    }
  });
  it('keeps fitted canvas sizes stable and centers wide/tall/small images without fractional overflow', () => {
    for (const image of [{ width: 1920, height: 1080 }, { width: 733, height: 12000 }, { width: 32, height: 24 }]) {
      for (const viewport of [{ width: 317, height: 223 }, { width: 799, height: 451 }, { width: 1063, height: 663 }]) {
        const scale = fitScale(image, viewport); const canvas = stageCanvasSize(image, viewport, scale); const offset = imageOffset(image, viewport, scale);
        expect(canvas).toEqual(viewport); expect(stageCanvasSize(image, canvas, fitScale(image, canvas))).toEqual(canvas);
        expect(offset.x + image.width * scale / 2).toBeCloseTo(viewport.width / 2, 9);
        expect(offset.y + image.height * scale / 2).toBeCloseTo(viewport.height / 2, 9);
      }
    }
  });
  it('fits either dimension without enlarging small images and permits a fit below 10%', () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1064, height: 664 })).toBe(0.5);
    expect(fitScale({ width: 1000, height: 2000 }, { width: 1064, height: 664 })).toBe(0.3);
    expect(fitScale({ width: 10, height: 10 }, { width: 400, height: 300 })).toBe(1);
    expect(fitScale({ width: 12000, height: 100 }, { width: 300, height: 500 })).toBeLessThan(0.1);
    expect(fitScale({ width: 0, height: 1 }, { width: 100, height: 100 })).toBe(1);
  });
  it('steps in percentage points and clamps manual limits', () => {
    expect(stepScale(0.05, 1)).toBe(0.1);
    expect(stepScale(0.05, -1)).toBe(0.1);
    expect(stepScale(0.1, -1)).toBe(0.1);
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(3.9, 1)).toBe(4);
    expect(stepScale(4, 1)).toBe(4);
  });
  it('centers small images and clamps edge targets to valid scroll ranges', () => {
    expect(imageOffset({ width: 100, height: 100 }, { width: 500, height: 300 }, 1)).toEqual({ x: 200, y: 100 });
    expect(scrollToPoint({ x: 0, y: 0 }, { width: 1000, height: 1000 }, { width: 500, height: 300 }, 1)).toEqual({ left: 0, top: 0 });
    expect(scrollToPoint({ x: 1, y: 1 }, { width: 1000, height: 1000 }, { width: 500, height: 300 }, 1)).toEqual({ left: 564, top: 764 });
  });
  it('preserves the normalized center through zoom when away from boundaries', () => {
    const image = { width: 2000, height: 1500 };
    const viewport = { width: 600, height: 400 };
    const point = viewportCenter(image, viewport, 1, { left: 700, top: 500 });
    const scroll = scrollToPoint(point, image, viewport, 2);
    expect(viewportCenter(image, viewport, 2, scroll).x).toBeCloseTo(point.x, 12);
    expect(viewportCenter(image, viewport, 2, scroll).y).toBeCloseTo(point.y, 12);
  });
});
