import { describe, expect, it } from 'vitest';
import { fitScale, imageOffset, scrollToPoint, stepScale, viewportCenter } from '../../src/client/review-view';

describe('review viewport geometry', () => {
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
