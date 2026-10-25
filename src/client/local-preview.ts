import { reactive } from 'vue';
import { previewFileError, previewDimensionsError } from './review';

interface Dimensions { width: number; height: number }
interface Preview extends Dimensions { url: string; name: string; file: File }
export interface PreviewDependencies {
  createUrl(file: File): string;
  revokeUrl(url: string): void;
  decode(url: string, signal: AbortSignal): Promise<Dimensions>;
  canReplace(): boolean;
  onReplace(): void;
}

function decodeImage(url: string, signal: AbortSignal): Promise<Dimensions> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (result?: Dimensions) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', cancel);
      image.removeAttribute('src');
      if (result) resolve(result);
      else reject(new Error('Preview unavailable'));
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, 15000);
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = cancel;
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else image.src = url;
  });
}

export function createLocalPreview(options: Partial<PreviewDependencies> = {}) {
  const deps: PreviewDependencies = {
    createUrl: file => URL.createObjectURL(file),
    revokeUrl: url => URL.revokeObjectURL(url),
    decode: decodeImage,
    canReplace: () => true,
    onReplace: () => {},
    ...options,
  };
  const state = reactive({ image: null as Preview | null, loading: false, error: '' });
  let generation = 0;
  let pending: AbortController | undefined;
  let disposed = false;

  function cancelPending() {
    generation++;
    pending?.abort();
    pending = undefined;
    state.loading = false;
  }

  async function select(file: File) {
    if (disposed) return;
    if (!deps.canReplace()) return;
    cancelPending();
    const current = generation;
    state.error = previewFileError(file);
    if (state.error) return;
    state.loading = true;
    const controller = new AbortController();
    pending = controller;
    let candidate: string | undefined;
    try {
      candidate = deps.createUrl(file);
      const dimensions = await deps.decode(candidate, controller.signal);
      if (disposed || current !== generation) return;
      const error = previewDimensionsError(dimensions.width, dimensions.height);
      if (error) { state.error = error; return; }
      if (state.image) deps.revokeUrl(state.image.url);
      state.image = { url: candidate, name: file.name, file, ...dimensions };
      candidate = undefined;
      deps.onReplace();
    } catch {
      if (!disposed && current === generation) state.error = '图片无法解码或读取超时，请选择可正常打开的静态图片重试。';
    } finally {
      if (candidate) deps.revokeUrl(candidate);
      if (current === generation) { state.loading = false; pending = undefined; }
    }
  }

  function clear() {
    if (disposed || !deps.canReplace()) return;
    cancelPending();
    if (state.image) deps.revokeUrl(state.image.url);
    state.image = null;
    deps.onReplace();
    state.error = '';
  }

  function dispose() {
    disposed = true;
    cancelPending();
    if (state.image) deps.revokeUrl(state.image.url);
    state.image = null;
  }

  return { state, select, clear, dispose };
}
