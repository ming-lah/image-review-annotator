import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { createLocalPreview } from '../local-preview';
import { createReviewSession } from '../review-session';
import { createTabSession, type SessionSnapshot } from '../tab-session';
import { defaultView, type ViewSnapshot } from '../review-view';
import { reviewApi } from '../http/review-api';
import { createIdentity } from './identity';
import { createPersistence } from './persistence';
import { uuidSchema } from '../../shared/review-contracts';
import { noteState, type Point } from '../review';

const recentKey = 'image-review-annotator:recent-image:v1';
export function useWorkspace() {
  const api = reviewApi();
  // Access can itself throw in restricted browsers. Let the identity adapter report it.
  const identity = createIdentity({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
  const session = createReviewSession(); const review = session.state;
  const persistence = createPersistence(session, api, identity.current); const remote = persistence.state;
  const restoring = ref(true); const internalReplacement = ref(false);
  const cacheStatus = ref<'idle' | 'saving' | 'ready' | 'error'>('idle'); const cacheError = ref('');
  const referenceWarning = ref(''); const linkMessage = ref('');
  const view = ref<ViewSnapshot>({ ...defaultView, anchor: { ...defaultView.anchor } });
  type Recovery = { snapshot: SessionSnapshot; file: File | null };
  const alternate = shallowRef<Recovery | null>(null); const failedRecovery = shallowRef<Recovery | null>(null);
  const stage = ref<{ reveal(point: Point): Promise<void>; restoreView(value: ViewSnapshot): Promise<void> }>();
  const editor = ref<HTMLTextAreaElement>(); const list = ref<HTMLDivElement>(); const dialog = ref<HTMLDialogElement>();
  let cache: ReturnType<typeof createTabSession> | undefined; let cacheRevision = 0; let loadRevision = 0; let disposed = false;
  let returnFocus: HTMLElement | null = null; let retryImageId: string | null = null;
  const hasUnsent = () => review.draft !== null || review.markers.some(marker => !marker.saved);
  const preview = createLocalPreview({
    canReplace: () => internalReplacement.value || (!restoring.value && !persistence.blocked() && !review.pending && !review.deleteId && (!hasUnsent() || window.confirm('离开会丢弃当前图片的临时标记和草稿；已正式保存的内容仍在服务器。确定继续吗？'))),
    onReplace: () => { session.reset(); if (!internalReplacement.value) { persistence.reset(); setReference(null); } },
  });
  const imageState = preview.state;
  const hasDialog = computed(() => !!review.pending || !!review.deleteId);
  const locked = computed(() => imageState.loading || hasDialog.value || restoring.value || persistence.blocked());
  watch(() => imageState.loading || restoring.value || persistence.blocked(), value => { review.locked = value; }, { immediate: true, flush: 'sync' });
  const selected = computed(() => review.markers.find(marker => marker.id === review.selectedId));
  const noteStatus = computed(() => noteState(review.draft?.note ?? ''));
  const remoteSnapshot = () => ({ image: remote.image, uploadId: remote.uploadId, uploadUnknown: remote.uploadUnknown, pendingWrite: remote.pendingWrite });
  function snapshot(): SessionSnapshot | null {
    const image = imageState.image;
    return image ? { image: { name: image.name, type: image.file.type, size: image.file.size, width: image.width, height: image.height }, review: session.snapshot(), view: view.value, remote: remoteSnapshot() } : null;
  }
  async function persistCache() {
    if (restoring.value || !cache || alternate.value || failedRecovery.value || disposed) return;
    const revision = ++cacheRevision; const value = snapshot(); const file = imageState.image?.file;
    cacheStatus.value = value ? 'saving' : 'idle';
    try {
      if (value && file) await cache.save(value, file); else await cache.clear();
      if (revision === cacheRevision) { cacheStatus.value = value ? 'ready' : 'idle'; cacheError.value = ''; }
    } catch { if (revision === cacheRevision) { cacheStatus.value = 'error'; cacheError.value = '标签页缓存失败；当前输入仍在页面，后端已保存结果不受影响。请重试缓存，刷新前注意保留未保存输入。'; } }
  }
  // Batch one action's mutations into a coherent snapshot; no timer/debounce is used.
  watch([() => imageState.image, () => session.snapshot(), view, remoteSnapshot], () => { void persistCache(); }, { deep: true, flush: 'post' });
  function setReference(id: string | null) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('imageId', id); else url.searchParams.delete('imageId');
    try { history.replaceState(null, '', url); } catch { referenceWarning.value = '地址栏更新失败，请使用复制图片链接重新打开'; }
    try { if (id) localStorage.setItem(recentKey, id); }
    catch { referenceWarning.value = '最近图片引用无法写入浏览器，请复制图片链接用于重新打开'; }
  }
  async function syncSelection(focus = false) {
    await nextTick();
    const point = review.draft ?? selected.value; if (point) await stage.value?.reveal(point);
    const row = list.value?.querySelector<HTMLElement>(`[data-marker-id="${review.selectedId}"]`);
    if (row && list.value) { const offset = row.offsetTop - list.value.offsetTop; if (offset < list.value.scrollTop || offset + row.offsetHeight > list.value.scrollTop + list.value.clientHeight) list.value.scrollTop = offset; }
    if (focus && review.draft && !review.pending) editor.value?.focus({ preventScroll: true });
  }
  function place(point: Point) { if (locked.value || !imageState.image) return; session.request({ kind: 'place', point }); if (!review.pending) void syncSelection(true); }
  function select(id: string, toggle = false) {
    if (locked.value) return;
    if (toggle && review.expandedIds.includes(id)) { session.setExpanded(id, false); return; }
    session.request({ kind: 'select', id }); if (!review.pending) { session.setExpanded(id, true); void syncSelection(); }
  }
  function edit(id: string) { if (locked.value) return; session.request({ kind: 'edit', id }); if (!review.pending) void syncSelection(true); }
  function localDraft() { return !remote.image || !!(review.draft?.id && !review.markers.find(marker => marker.id === review.draft?.id)?.saved); }
  async function save() {
    if (remote.busy || persistence.blocked()) return false;
    const success = localDraft() ? session.applyDraft() : await persistence.save();
    if (success) void syncSelection(); return success;
  }
  async function resolvePending(choice: 'apply' | 'discard' | 'stay') {
    if (choice === 'stay' && !remote.busy) { review.pending = null; return; }
    if (persistence.blocked()) return;
    const action = review.pending;
    if (!action) return;
    if (choice === 'apply' && !(await save())) return;
    if (choice === 'discard') remote.conflict = null;
    session.resolvePending(choice === 'apply' ? 'discard' : choice);
    if (choice !== 'stay' && !review.pending) { if (action.kind === 'reload') await reload(); else void syncSelection(Boolean(review.draft)); }
  }
  async function retryWrite() {
    if (await persistence.retry() && review.pending) {
      const action = review.pending;
      session.resolvePending('discard');
      if (action.kind === 'reload') await reload(); else void syncSelection(Boolean(review.draft));
    }
  }
  async function resolveDelete(confirmed: boolean) {
    if (persistence.blocked()) return;
    const marker = review.markers.find(marker => marker.id === review.deleteId);
    if (!confirmed || !marker?.saved) { session.resolveDelete(confirmed); return; }
    review.deleteId = null;
    await persistence.remove(marker);
  }
  async function openRemote(id: string, recovery?: Recovery) {
    if (!uuidSchema.safeParse(id).success) { remote.error = '图片链接中的编号无效'; return false; }
    const revision = ++loadRevision; restoring.value = true; retryImageId = id; remote.error = '';
    try {
      const detail = await api.detail(id); const file = await api.content(id, detail.image.originalName, detail.image.mimeType);
      if (revision !== loadRevision || disposed) return false;
      internalReplacement.value = true;
      try { await preview.select(file); } finally { internalReplacement.value = false; }
      if (imageState.error || !imageState.image) throw new Error(imageState.error || '图片读取失败');
      if (disposed || revision !== loadRevision) return false;
      persistence.reset(); remote.image = detail.image;
      if (recovery) {
        session.restore(recovery.snapshot.review);
        remote.uploadId = recovery.snapshot.remote?.uploadId ?? null;
        remote.pendingWrite = recovery.snapshot.remote?.pendingWrite ?? null;
        view.value = recovery.snapshot.view;
      }
      session.mergeSaved(detail.annotations);
      const draft = review.draft;
      if (draft?.id && draft.baseVersion) {
        const latest = detail.annotations.find(row => row.id === draft.id) ?? null;
        if (!latest || latest.version !== draft.baseVersion) remote.conflict = { id: draft.id, latest, deleting: false };
      }
      setReference(id); failedRecovery.value = null; retryImageId = null;
      await nextTick(); if (recovery) await stage.value?.restoreView(recovery.snapshot.view);
      return true;
    } catch (error) { if (revision === loadRevision) { persistence.report(error); if (recovery) failedRecovery.value = recovery; } return false; }
    finally { if (revision === loadRevision) { restoring.value = false; void persistCache(); } }
  }
  async function restore(recovery: Recovery) {
    if (recovery.snapshot.remote?.image) return openRemote(recovery.snapshot.remote.image.id, recovery);
    restoring.value = true; internalReplacement.value = true;
    try {
      if (!recovery.file) throw new Error('本地图片缓存缺失');
      await preview.select(recovery.file);
      if (imageState.error || !imageState.image) throw new Error(imageState.error || '图片读取失败');
      persistence.reset(); session.restore(recovery.snapshot.review);
      if (review.draft && !review.draft.id) review.draft.requestId ??= crypto.randomUUID();
      remote.uploadId = recovery.snapshot.remote?.uploadId ?? null; remote.uploadUnknown = recovery.snapshot.remote?.uploadUnknown ?? false;
      view.value = recovery.snapshot.view;
      setReference(null); failedRecovery.value = null;
      await nextTick(); await stage.value?.restoreView(view.value);
      return true;
    } catch (error) { persistence.report(error); failedRecovery.value = recovery; return false; }
    finally { internalReplacement.value = false; restoring.value = false; void persistCache(); }
  }
  async function reload() {
    if (persistence.blocked()) return;
    if (session.isDirty()) { session.request({ kind: 'reload' }); return; }
    const id = remote.image?.id ?? retryImageId;
    if (id) { const value = snapshot(); await openRemote(id, value?.remote?.image?.id === id && imageState.image ? { snapshot: value, file: null } : failedRecovery.value ?? undefined); }
  }
  async function upload() { const file = imageState.image?.file; if (file && await persistence.upload(file) && remote.image) { setReference(remote.image.id); void persistCache(); } }
  async function chooseImage(event: Event) {
    if (locked.value) return;
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (file) { await preview.select(file); if (!imageState.error) { failedRecovery.value = null; void persistCache(); } }
  }
  function clear() { if (!locked.value) { preview.clear(); if (!imageState.image) { failedRecovery.value = null; void persistCache(); } } }
  async function retryCache() { try { cache ??= createTabSession(); await persistCache(); } catch { cacheError.value = '浏览器拒绝访问标签页缓存'; cacheStatus.value = 'error'; } }
  async function copyLink() {
    const url = new URL(location.href); if (remote.image) url.searchParams.set('imageId', remote.image.id);
    try { await navigator.clipboard.writeText(url.href); linkMessage.value = '图片链接已复制'; } catch { linkMessage.value = `请手动复制图片链接：${url.href}`; }
  }
  function abandonUpload() { if (!remote.busy && window.confirm('上传结果尚未确认，服务器可能已保留图片。放弃等待并允许选择其他图片？')) { remote.uploadUnknown = false; remote.uploadId = null; remote.error = '已放弃等待；服务器可能仍保留先前上传'; } }
  async function recoverAlternate() {
    if (persistence.blocked() || !alternate.value || (hasUnsent() && !window.confirm('恢复另一份内容会离开当前图片并丢弃当前未保存输入，是否继续？'))) return;
    const value = alternate.value; alternate.value = null; await restore(value);
  }
  function discardAlternate() { if (window.confirm('确认放弃另一份标签页临时内容？')) { alternate.value = null; void persistCache(); } }
  function dismissDialog() { if (review.pending) void resolvePending('stay'); else void resolveDelete(false); }
  watch(hasDialog, async open => {
    if (open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (open) dialog.value?.showModal(); else { dialog.value?.close(); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null; }
  });
  const leaveProtected = computed(() => hasUnsent() || persistence.blocked() || (!!imageState.image && !remote.image && cacheStatus.value !== 'ready'));
  function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
  watch(leaveProtected, value => { if (value) window.addEventListener('beforeunload', beforeUnload); else window.removeEventListener('beforeunload', beforeUnload); });
  onMounted(async () => {
    let recovery: Recovery | null = null;
    try { cache = createTabSession(); recovery = await cache.load(); } catch { cacheStatus.value = 'error'; cacheError.value = '标签页缓存读取失败；请重新选图或打开已保存图片链接'; }
    const explicit = new URL(location.href).searchParams.get('imageId');
    let recent: string | null = null;
    try { recent = localStorage.getItem(recentKey); } catch { referenceWarning.value = '最近图片引用不可用，可通过已保存链接打开'; }
    if (explicit) {
      if (recovery && recovery.snapshot.remote?.image?.id !== explicit) alternate.value = recovery;
      await openRemote(explicit, recovery?.snapshot.remote?.image?.id === explicit ? recovery : undefined);
    } else if (recovery) await restore(recovery);
    else if (recent) await openRemote(recent);
    restoring.value = false; void persistCache();
  });
  onUnmounted(() => { disposed = true; loadRevision++; preview.dispose(); cache?.close(); window.removeEventListener('beforeunload', beforeUnload); });
  return { identity, session, review, persistence, remote, imageState, restoring, cacheStatus, cacheError, referenceWarning, linkMessage, alternate, failedRecovery,
    view, stage, editor, list, dialog, selected, hasDialog, locked, noteStatus, localDraft, chooseImage, clear, upload, reload, save, place, select, edit,
    resolvePending, resolveDelete, dismissDialog, retryWrite, retryCache, copyLink, abandonUpload, recoverAlternate, discardAlternate };
}
