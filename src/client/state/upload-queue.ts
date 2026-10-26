import { reactive } from 'vue';
import type { ImageDto } from '../../shared/review-contracts';
import { RequestFailure } from '../http/review-api';
import { previewFileError } from '../review';

export type UploadStatus = 'waiting' | 'uploading' | 'success' | 'failed' | 'unknown' | 'abandoned';
export interface UploadItem { id: string; file: File; status: UploadStatus; message: string; requestId: string; image: ImageDto | null }
export function createUploadQueue(send: (id: string, file: File, userId: string) => Promise<ImageDto>, settled: () => Promise<void>) {
  const state = reactive({ items: [] as UploadItem[], userId: '', running: false, error: '' });
  let disposed = false;
  const active = () => state.running || state.items.some(row => ['waiting', 'uploading', 'unknown'].includes(row.status));
  async function run() {
    if (disposed || state.running) return;
    state.running = true;
    try {
      for (const row of state.items) {
        if (disposed || state.items.some(item => item.status === 'unknown')) break;
        if (row.status !== 'waiting') continue;
        const invalid = previewFileError(row.file);
        if (invalid) { row.status = 'failed'; row.message = invalid; continue; }
        row.status = 'uploading'; row.message = ''; row.requestId = '';
        try {
          const image = await send(row.id, row.file, state.userId);
          if (disposed) return;
          row.image = image; row.status = 'success'; row.message = '已上传';
        } catch (value) {
          if (disposed) return;
          row.status = value instanceof RequestFailure && value.status !== null ? 'failed' : 'unknown';
          row.message = value instanceof Error ? value.message : '上传结果尚未确认';
          row.requestId = value instanceof RequestFailure ? value.requestId : '';
        }
      }
    } finally { try { if (!disposed) await settled(); } finally { state.running = false; } }
  }
  async function start(files: File[], userId: string) {
    if (disposed || active()) return;
    state.error = '';
    if (!files.length || files.length > 10) { state.error = '一次请选择 1–10 张图片，本次没有开始上传'; return; }
    state.userId = userId;
    state.items = files.map(file => ({ id: crypto.randomUUID(), file, status: 'waiting', message: '', requestId: '', image: null }));
    await run();
  }
  async function retry(id: string) {
    if (disposed || state.running) return;
    const row = state.items.find(item => item.id === id);
    if (!row || !['failed', 'unknown'].includes(row.status) || state.items.some(item => item.status === 'unknown' && item.id !== id)) return;
    row.status = 'waiting'; await run();
  }
  async function abandon(id: string) {
    if (disposed || state.running) return;
    const row = state.items.find(item => item.id === id);
    if (!row || row.status !== 'unknown') return;
    row.status = 'abandoned'; row.message = '已放弃等待，服务器可能已有图片，请核对图片库'; await run();
  }
  function clear() { if (!active()) { state.items = []; state.userId = ''; state.error = ''; } }
  return { state, active, start, retry, abandon, clear, dispose: () => { disposed = true; } };
}
