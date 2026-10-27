import { computed, reactive } from 'vue';
import type { ImageDto } from '../../shared/review-contracts';
import { RequestFailure } from '../http/review-api';
import { previewFileError } from '../review';

export type UploadStatus = 'waiting' | 'uploading' | 'success' | 'failed' | 'unknown' | 'abandoned';
export interface UploadItem { id: string; file: File; status: UploadStatus; message: string; requestId: string; image: ImageDto | null }
export interface UploadSummary { total: number; completed: number; success: number; failed: number; unknown: UploadItem | undefined; abandoned: number; issues: UploadItem[] }
export function createUploadQueue(send: (id: string, file: File, userId: string) => Promise<ImageDto>, settled: () => Promise<void>) {
  const state = reactive({ items: [] as UploadItem[], userId: '', running: false, paused: false, error: '' });
  const summary = computed<UploadSummary>(() => ({ total: state.items.length, completed: state.items.filter(row => ['success', 'failed', 'abandoned'].includes(row.status)).length, success: state.items.filter(row => row.status === 'success').length, failed: state.items.filter(row => row.status === 'failed').length, unknown: state.items.find(row => row.status === 'unknown'), abandoned: state.items.filter(row => row.status === 'abandoned').length, issues: state.items.filter(row => ['failed', 'unknown', 'abandoned'].includes(row.status)) }));
  let disposed = false;
  const active = () => state.running || state.items.some(row => ['waiting', 'uploading', 'unknown'].includes(row.status));
  async function run() {
    if (disposed || state.running || state.paused) return;
    state.running = true;
    try {
      for (const row of state.items) {
        if (disposed || state.paused || state.items.some(item => item.status === 'unknown')) break;
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
          if (value instanceof RequestFailure && ['AUTH_REQUIRED', 'AUTH_CONTEXT_CHANGED'].includes(value.code)) state.paused = true;
        }
      }
    } finally { try { if (!disposed && !state.paused) await settled(); } finally { state.running = false; } }
  }
  async function start(files: File[], userId: string) {
    if (disposed || state.paused || active()) return;
    state.error = '';
    if (!files.length || files.length > 10) { state.error = '一次请选择 1–10 张图片，本次没有开始上传'; return; }
    state.userId = userId;
    state.items = files.map(file => ({ id: crypto.randomUUID(), file, status: 'waiting', message: '', requestId: '', image: null }));
    await run();
  }
  async function retry(id: string) {
    if (disposed || state.running || state.paused) return;
    const row = state.items.find(item => item.id === id);
    if (!row || !['failed', 'unknown'].includes(row.status) || state.items.some(item => item.status === 'unknown' && item.id !== id)) return;
    row.status = 'waiting'; await run();
  }
  async function abandon(id: string) {
    if (disposed || state.running || state.paused) return;
    const row = state.items.find(item => item.id === id);
    if (!row || row.status !== 'unknown') return;
    row.status = 'abandoned'; row.message = '已放弃等待，服务器可能已有图片，请核对图片库'; await run();
  }
  function clear() { if (!active()) { state.items = []; state.userId = ''; state.error = ''; } }
  function resume(userId: string) { if (state.userId && state.userId !== userId) return; state.paused = false; }
  return { state, summary, active, start, retry, abandon, clear, pause: () => { state.paused = true; }, resume, dispose: () => { disposed = true; } };
}
