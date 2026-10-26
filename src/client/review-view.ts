import type { Point } from './review';

export interface Size { width: number; height: number }
export interface ScrollPosition { left: number; top: number }
export interface ViewSnapshot { mode: 'fit' | 'manual'; manualScale: number; markerSize: number; anchor: Point }
export const defaultView: ViewSnapshot = { mode: 'fit', manualScale: 1, markerSize: 24, anchor: { x: 0.5, y: 0.5 } };
export const stagePadding = 32;

export function stageCanvasSize(image: Size, viewport: Size, scale: number): Size {
  // Remove floating-point overflow at an exact fit; a fractional excess must not create a scrollbar.
  return { width: Math.max(viewport.width, Math.ceil(image.width * scale + stagePadding * 2 - 1e-7)), height: Math.max(viewport.height, Math.ceil(image.height * scale + stagePadding * 2 - 1e-7)) };
}

export function fitScale(image: Size, viewport: Size): number {
  if (![image.width, image.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return 1;
  return Math.min(1, Math.max(1, viewport.width - stagePadding * 2) / image.width, Math.max(1, viewport.height - stagePadding * 2) / image.height);
}

export function stepScale(scale: number, direction: -1 | 1): number {
  if (!Number.isFinite(scale) || scale < 0.1) return 0.1;
  return Math.min(4, Math.max(0.1, Math.round((scale + direction * 0.25) * 10000) / 10000));
}

export function imageOffset(image: Size, viewport: Size, scale: number, pixelRatio?: number): Point {
  const align = (value: number) => pixelRatio && Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.round(value * pixelRatio) / pixelRatio : value;
  return { x: align(Math.max(stagePadding, (viewport.width - image.width * scale) / 2)), y: align(Math.max(stagePadding, (viewport.height - image.height * scale) / 2)) };
}

export function viewportCenter(image: Size, viewport: Size, scale: number, scroll: ScrollPosition, pixelRatio?: number): Point {
  const offset = imageOffset(image, viewport, scale, pixelRatio);
  return { x: Math.min(1, Math.max(0, (scroll.left + viewport.width / 2 - offset.x) / (image.width * scale))), y: Math.min(1, Math.max(0, (scroll.top + viewport.height / 2 - offset.y) / (image.height * scale))) };
}

export function scrollToPoint(point: Point, image: Size, viewport: Size, scale: number, pixelRatio?: number): ScrollPosition {
  const offset = imageOffset(image, viewport, scale, pixelRatio);
  const maxLeft = Math.max(0, image.width * scale + stagePadding * 2 - viewport.width);
  const maxTop = Math.max(0, image.height * scale + stagePadding * 2 - viewport.height);
  return { left: Math.min(maxLeft, Math.max(0, offset.x + point.x * image.width * scale - viewport.width / 2)), top: Math.min(maxTop, Math.max(0, offset.y + point.y * image.height * scale - viewport.height / 2)) };
}
