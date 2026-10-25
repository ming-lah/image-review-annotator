export interface Point { x: number; y: number }
export interface Draft extends Point { note: string }
export interface ImageBounds { left: number; top: number; width: number; height: number }

export function pointInImage(clientX: number, clientY: number, bounds: ImageBounds): Point | null {
  const values = [clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height];
  if (!values.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
  const x = (clientX - bounds.left) / bounds.width;
  const y = (clientY - bounds.top) / bounds.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

export function noteState(note: string): 'empty' | 'valid' | 'too-long' {
  const length = note.trim().length;
  return length === 0 ? 'empty' : length > 2000 ? 'too-long' : 'valid';
}

export function previewFileError(file: Pick<File, 'size' | 'type'>): string {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return '请选择 PNG、JPEG 或 WebP 图片。';
  if (file.size === 0) return '图片文件为空，请重新选择。';
  return file.size > 20 * 1024 * 1024 ? '图片不能超过 20 MiB。' : '';
}

export function previewDimensionsError(width: number, height: number): string {
  if (![width, height].every(value => Number.isInteger(value) && value > 0)) return '无法读取图片尺寸，请重新选择。';
  return width > 12000 || height > 12000 || width * height > 40000000 ? '图片宽高不能超过 12000 像素，总像素不能超过 4000 万。' : '';
}
