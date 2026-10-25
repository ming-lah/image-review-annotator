import { describe, it, expect } from 'vitest';
import { noteState, pointInImage, previewDimensionsError, previewFileError } from '../../src/client/review';

describe('local review rules', () => {
  it('uses the actual image offset and rendered dimensions', () => {
    expect(pointInImage(260, 170, { left: 100, top: 50, width: 320, height: 240 })).toEqual({ x: 0.5, y: 0.5 });
    expect(pointInImage(80, 40, { left: 0, top: -20, width: 160, height: 120 })).toEqual({ x: 0.5, y: 0.5 });
  });
  it('accepts image edges and rejects whitespace, invalid bounds and nonfinite input', () => {
    const bounds = { left: 10, top: 20, width: 100, height: 200 };
    expect(pointInImage(10, 20, bounds)).toEqual({ x: 0, y: 0 });
    expect(pointInImage(110, 220, bounds)).toEqual({ x: 1, y: 1 });
    for (const [x, y] of [[9, 20], [111, 20], [10, 19], [10, 221], [NaN, 50], [50, Infinity]]) expect(pointInImage(x, y, bounds)).toBeNull();
    expect(pointInImage(10, 20, { ...bounds, width: 0 })).toBeNull();
    expect(pointInImage(10, 20, { ...bounds, height: -1 })).toBeNull();
  });
  it('checks trimmed notes without converting markup into HTML', () => {
    expect(noteState(' \n\t ')).toBe('empty');
    expect(noteState(' 修正标题 ')).toBe('valid');
    expect(noteState(' ' + '中'.repeat(2000) + '\n')).toBe('valid');
    expect(noteState('中'.repeat(2001))).toBe('too-long');
    expect(noteState('<script>alert(1)</script>')).toBe('valid');
  });
  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s at the size limit', type => {
    expect(previewFileError({ type, size: 20 * 1024 * 1024 })).toBe('');
  });
  it('rejects empty, oversized and unsupported files', () => {
    expect(previewFileError({ type: 'image/png', size: 0 })).not.toBe('');
    expect(previewFileError({ type: 'image/png', size: 20 * 1024 * 1024 + 1 })).not.toBe('');
    for (const type of ['', 'image/svg+xml', 'image/gif', 'text/plain']) expect(previewFileError({ type, size: 1 })).not.toBe('');
  });
  it('checks decoded dimensions and total pixel limits', () => {
    expect(previewDimensionsError(8000, 5000)).toBe('');
    expect(previewDimensionsError(12000, 1)).toBe('');
    for (const [width, height] of [[12001, 1], [1, 12001], [8000, 5001], [0, 100], [100, -1], [Infinity, 1], [1.5, 100]]) expect(previewDimensionsError(width, height)).not.toBe('');
  });
});
