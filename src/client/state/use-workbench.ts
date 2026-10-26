import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { z } from 'zod';
import { workbenchApi } from '../http/workbench-api';
import { RequestFailure } from '../http/review-api';
import { createWorkingCopy } from './working-copy';
import { labelMarkers } from '../../shared/marker-labels';
import { createToast } from './toast';
import { createUploadQueue } from './upload-queue';
import { createLocalPreview, type PreviewDependencies } from '../local-preview';
import type { WorkbenchApi } from '../http/workbench-api';
import { userSchema, type User, type Library, type HistoryDetail, type Revision, type LibraryItem } from '../../shared/workbench-contracts';
import type { LocalMarker } from '../review-session';
import { type Point } from '../review';
import type { DeleteImage } from '../../shared/workbench-contracts';
import type { ViewSnapshot } from '../review-view';
import { planReviewMerge, resolveReviewMerge, type ReviewMerge, type MergeChoice } from './review-merge';
import { observeReviewUpdates, type UpdateStatus } from '../http/review-events';

const activeKey = 'image-review:username:active'; const rememberedKey = 'image-review:username:remembered';
const viewSchema = z.object({ mode: z.enum(['fit', 'manual']), manualScale: z.number().min(0.1).max(4), markerSize: z.number().min(12).max(48), anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }) });
export function useWorkbench(deps: { api?: WorkbenchApi; preview?: Partial<PreviewDependencies>; updates?: typeof observeReviewUpdates } = {}) {
  const api = deps.api ?? workbenchApi(); const copy = createWorkingCopy(); const draft = copy.state;
  const user = ref<User | null>(null); const username = ref(''); const page = ref<'entry' | 'library' | 'review' | 'history'>('entry');
  const libraryBusy = ref(false); const libraryWarning = ref(''); const toast = createToast();
  const busy = ref(false); const error = ref(''); const requestId = ref(''); const cacheWarning = ref('');
  const query = ref(''); const sort = ref('updated'); const layout = ref<'grid' | 'list'>('grid');
  const library = ref<Library>({ items: [], total: 0, page: 1, pageSize: 12 });
  const history = ref<Revision[]>([]); const historyTotal = ref(0); const historyPage = ref(1); const historical = ref<HistoryDetail | null>(null);
  const historySelected = ref<string | null>(null); const dialog = ref(false); const showChanges = ref(false); const historyExpandedIds = ref<string[]>([]);
  const expandedIds = ref<string[]>([]);
  const focusRevision = ref(0);
  const deleteDialog = ref(false); const deletePending = shallowRef<{ id: string; value: DeleteImage } | null>(null);
  const merge = shallowRef<ReviewMerge | null>(null); const mergeChoices = ref<Record<string, MergeChoice | undefined>>({});
  const remoteChanged = ref(false); const remoteGone = ref(false); const syncWarning = ref(''); const updateStatus = ref<UpdateStatus>('connecting');
  const mergeReady = computed(() => !!merge.value && merge.value.conflicts.every(row => !!mergeChoices.value[row.id]));
  const queue = createUploadQueue(api.upload, async () => {
    await loadLibrary(library.value.page, true, '上传结果请见各项状态');
    const rows = queue.state.items;
    if (rows.length === 1 && rows[0].status === 'success' && rows[0].image) await loadImage(rows[0].image.id);
  });
  const stage = shallowRef<{ reveal(point: Point): Promise<void>; restoreView(view: ViewSnapshot): Promise<void> }>();
  const preview = createLocalPreview(deps.preview); const image = preview.state;
  let disposed = false; let listGeneration = 0; let pendingNavigation: (() => Promise<void>) | null = null;
  let stopUpdates: (() => void) | undefined; let syncRunning = false; let syncQueued = false; let syncDeferred = false; let updateEpoch = 0;
  const locked = computed(() => busy.value || copy.blocked() || image.loading || queue.active() || !!deletePending.value || deleteDialog.value || !!merge.value);
  const blocked = locked;
  const selected = computed(() => draft.markers.find(row => row.id === draft.selectedId) ?? null);
  const currentImage = computed(() => draft.base?.image ?? null);
  const errorText = computed(() => error.value || draft.error || image.error);
  const errorRequestId = computed(() => requestId.value || draft.requestId);
  const rail = computed<LibraryItem[]>(() => {
    const rows = library.value.items; const detail = draft.base;
    if (!detail || rows.some(row => row.image.id === detail.image.id)) return rows;
    const summary = draft.savedItem?.image.id === detail.image.id ? draft.savedItem : { image: detail.image, annotationCount: detail.annotations.length, revisionCount: detail.revision.versionNumber + 1, username: detail.revision.username, uploadedByUserId: detail.revision.userId };
    return [summary, ...rows];
  });
  const activeMarkers = computed(() => labelMarkers(draft.markers.filter(row => !draft.removed.includes(row.id))));
  const removedMarkers = computed(() => draft.markers.filter(row => draft.removed.includes(row.id)));
  const historyMarkers = computed(() => labelMarkers(historical.value?.annotations ?? []));
  function changeLabel(id: string, before = false) {
    const rows = before ? labelMarkers(historical.value?.previousAnnotations ?? []) : historyMarkers.value;
    return rows.find(row => row.id === id)?.label ?? '—';
  }
  const stageMarkers = computed<LocalMarker[]>(() => {
    if (page.value === 'history' && historical.value) {
      const data = historical.value; const changed = new Map(data.changes.map(row => [row.annotationId, row.kind]));
      const rows: LocalMarker[] = historyMarkers.value.map(row => ({ ...row, saved: row, change: showChanges.value ? changed.get(row.id) : undefined }));
      if (showChanges.value) for (const row of labelMarkers(data.previousAnnotations ?? [])) {
        if (changed.get(row.id) === 'delete') rows.push({ ...row, saved: row, change: 'delete' });
      }
      return rows;
    }
    return activeMarkers.value.map(row => ({ ...row, saved: copy.old(row.id), change: copy.kind(row.id) ?? undefined }));
  });
  function report(value: unknown) { error.value = value instanceof Error ? value.message : '操作失败，请重试'; requestId.value = value instanceof RequestFailure ? value.requestId : ''; }
  function read(kind: 'local' | 'session', key: string) { try { return (kind === 'local' ? window.localStorage : window.sessionStorage).getItem(key); } catch { cacheWarning.value = '浏览器缓存不可用，请注意保存并保留图片链接'; return null; } }
  function write(kind: 'local' | 'session', key: string, value: string | null, failureMessage = '浏览器缓存写入失败，当前输入仍在页面，正式保存结果不受影响') { try { const storage = kind === 'local' ? window.localStorage : window.sessionStorage; if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { cacheWarning.value = failureMessage; } }
  function url(imageId?: string, revisionId?: string) {
    const value = new URL(location.href); value.search = ''; if (imageId) value.searchParams.set('imageId', imageId); if (revisionId) value.searchParams.set('revisionId', revisionId);
    window.history.replaceState(null, '', value);
  }
  watch(() => copy.snapshot(), value => { const id = draft.base?.image.id; if (id) write('session', 'image-review:draft:' + id, value); }, { flush: 'post' });
  const missingImage = (value: unknown) => value instanceof RequestFailure && value.status === 404 && value.code === 'IMAGE_NOT_FOUND';
  async function reconcile(epoch: number) {
    const base = draft.base;
    if (!base || !user.value || page.value === 'library' || page.value === 'entry') return;
    if (busy.value || copy.blocked() || queue.active() || deletePending.value || deleteDialog.value || dialog.value) { syncDeferred = true; return; }
    const id = base.image.id; const revisionId = base.revision.id;
    try {
      const latest = await api.detail(id);
      if (disposed || epoch !== updateEpoch || !user.value || draft.base?.image.id !== id || draft.base.revision.id !== revisionId) return;
      syncWarning.value = ''; remoteGone.value = false;
      if (latest.revision.id === revisionId) { remoteChanged.value = false; return; }
      remoteChanged.value = true;
      if (page.value !== 'review' || locked.value || copy.count()) return;
      // A background GET must never replace input typed while it was in flight.
      planReviewMerge(base, draft.markers, draft.removed, latest);
      const selectedId = draft.selectedId;
      copy.bind(latest); draft.selectedId = latest.annotations.some(row => row.id === selectedId) ? selectedId : null;
      remoteChanged.value = false;
    } catch (value) {
      if (disposed || epoch !== updateEpoch || draft.base?.image.id !== id || draft.base.revision.id !== revisionId) return;
      if (missingImage(value)) { remoteGone.value = true; remoteChanged.value = true; }
      else syncWarning.value = '最新状态读取失败，本地输入已保留；可重新核对';
    }
  }
  async function drainSync() {
    syncRunning = true;
    try {
      while (syncQueued && !disposed && user.value) {
        syncQueued = false; const epoch = updateEpoch;
        await Promise.all([loadLibrary(library.value.page, true, '更新通知已收到'), reconcile(epoch)]);
      }
    } finally { syncRunning = false; }
  }
  function requestSync() {
    if (disposed || !user.value) return;
    updateEpoch++; syncQueued = true;
    if (!syncRunning) void drainSync();
  }
  function startUpdates() {
    stopUpdates?.();
    stopUpdates = (deps.updates ?? observeReviewUpdates)({ event: requestSync, ready: requestSync, status: value => { updateStatus.value = value; } });
  }
  watch(() => [busy.value, copy.blocked(), queue.active(), !!deletePending.value, deleteDialog.value, dialog.value], () => {
    if (syncDeferred && !busy.value && !copy.blocked() && !queue.active() && !deletePending.value && !deleteDialog.value && !dialog.value) { syncDeferred = false; requestSync(); }
  });
  async function reviewLatest() {
    if (!draft.base || busy.value || copy.blocked() || queue.active() || deletePending.value || deleteDialog.value || merge.value) return;
    dialog.value = false; pendingNavigation = null; busy.value = true; error.value = ''; requestId.value = '';
    const base = draft.base;
    try {
      const latest = await api.detail(base.image.id);
      if (disposed) return;
      const plan = planReviewMerge(base, draft.markers, draft.removed, latest);
      remoteGone.value = false; syncWarning.value = ''; mergeChoices.value = {};
      if (!copy.count()) { copy.bind(latest); remoteChanged.value = false; toast.show('已读取最新内容'); }
      else { merge.value = plan; remoteChanged.value = latest.revision.id !== base.revision.id; }
    } catch (value) { if (!disposed) { if (missingImage(value)) { remoteGone.value = true; remoteChanged.value = true; } report(value); } }
    finally { busy.value = false; }
  }
  function cancelMerge() { merge.value = null; mergeChoices.value = {}; }
  function applyMerge() {
    if (!merge.value || !mergeReady.value || copy.blocked()) return;
    try {
      const plan = merge.value; const rows = resolveReviewMerge(plan, mergeChoices.value);
      if (copy.rebase(plan.latest, rows)) { cancelMerge(); error.value = ''; requestId.value = ''; remoteChanged.value = false; expandedIds.value = []; toast.show('核对结果已应用，请检查后保存'); }
    } catch (value) { report(value); }
  }
  async function loadLibrary(targetPage = 1, afterSave = false, completedMessage = '已保存') {
    const generation = ++listGeneration; libraryBusy.value = true; libraryWarning.value = '';
    if (!afterSave) { error.value = ''; requestId.value = ''; }
    try {
      let value = await api.library(query.value, targetPage, sort.value);
      const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
      if (targetPage > lastPage && generation === listGeneration && !disposed) value = await api.library(query.value, lastPage, sort.value);
      if (!disposed && generation === listGeneration) library.value = value;
    }
    catch (value) { if (generation === listGeneration && !disposed) { if (afterSave) libraryWarning.value = completedMessage + '，列表更新失败，可重试'; else report(value); } }
    finally { if (generation === listGeneration) libraryBusy.value = false; }
  }
  async function loadImage(id: string) {
    updateEpoch++; remoteChanged.value = false; remoteGone.value = false; syncWarning.value = '';
    busy.value = true; error.value = ''; requestId.value = ''; draft.message = '';
    try {
      const detail = await api.detail(id); const file = await api.content(id, detail.image.originalName, detail.image.mimeType);
      if (disposed) return false;
      await preview.select(file); if (!image.image || image.error) throw new Error(image.error || '图片读取失败');
      copy.bind(detail);
      const cached = read('session', 'image-review:draft:' + id);
      if (cached) {
        try { copy.restore(cached, id); if (draft.base!.revision.id !== detail.revision.id) { remoteChanged.value = true; error.value = '已保留较早版本的未保存输入，请读取最新并核对'; } }
        catch { cacheWarning.value = '这张图片的临时缓存无法恢复，已读取服务端正式内容'; }
      }
      expandedIds.value = [];
      page.value = 'review'; historical.value = null; url(id); await nextTick();
      const savedView = read('session', 'image-review:view:' + id);
      if (savedView) { try { await stage.value?.restoreView(viewSchema.parse(JSON.parse(savedView))); } catch { /* An invalid view does not invalidate saved data. */ } }
      return true;
    } catch (value) { report(value); return false; }
    finally { busy.value = false; }
  }
  async function enter() {
    if (busy.value) return;
    if (!username.value.trim() || username.value.trim().length > 40) { error.value = '请输入 1–40 字符的 username'; return; }
    busy.value = true; error.value = '';
    try {
      let remembered: User | null = null;
      try { const raw = read('local', rememberedKey); if (raw) remembered = userSchema.parse(JSON.parse(raw)); } catch { /* A remembered label is optional. */ }
      let active: User | null = null;
      try { const raw = read('session', activeKey); if (raw) active = userSchema.parse(JSON.parse(raw)); } catch { /* An invalid old entry must not prevent re-entry. */ }
      const label = username.value.trim();
      const identity = active?.username === label ? active : remembered?.username === label ? remembered : null;
      user.value = await api.enter(label, identity?.userId);
      write('local', rememberedKey, JSON.stringify(user.value)); write('session', activeKey, JSON.stringify(user.value));
      page.value = 'library';
      startUpdates();
    } catch (value) { report(value); return; }
    finally { busy.value = false; }
    await loadLibrary(); const params = new URL(location.href).searchParams; const id = params.get('imageId');
    if (id) { const opened = await loadImage(id); if (params.get('revisionId') && opened) await openHistory(params.get('revisionId')!); }
  }
  async function navigate(action: () => Promise<void>) {
    if (blocked.value || dialog.value) return;
    if (copy.count()) { pendingNavigation = action; dialog.value = true; } else await action();
  }
  async function toLibrary() { await navigate(async () => { updateEpoch++; remoteChanged.value = false; remoteGone.value = false; syncWarning.value = ''; page.value = 'library'; url(); await loadLibrary(); }); }
  async function openImage(id: string) { if (blocked.value) return; if (id === currentImage.value?.id && page.value !== 'library') { page.value = 'review'; return; } await navigate(async () => { await loadImage(id); }); }
  async function persist(markerId?: string) {
    if (!user.value || busy.value || queue.active() || deletePending.value || deleteDialog.value || merge.value || (remoteGone.value && !draft.pending)) return false;
    if (remoteChanged.value && !draft.pending) { await reviewLatest(); return false; }
    if (!copy.count() && !draft.pending) return true;
    error.value = ''; requestId.value = '';
    const previousRevision = draft.base?.revision.id;
    const savedMarkerId = draft.pending ? draft.pendingMarkerId : markerId ?? null;
    const success = await copy.save(user.value.userId, api.save, markerId, api.historical);
    if (!success && draft.failureCode === 'REVIEW_BASE_CHANGED') { remoteChanged.value = true; dialog.value = false; pendingNavigation = null; }
    if (!success && draft.failureCode === 'IMAGE_NOT_FOUND') { remoteGone.value = true; remoteChanged.value = true; }
    if (!success && !draft.pending && draft.selectedId) { if (!expandedIds.value.includes(draft.selectedId)) expandedIds.value.push(draft.selectedId); focusRevision.value++; }
    if (success && draft.base) {
      remoteChanged.value = draft.savedLatestRevisionId !== draft.base.revision.id; remoteGone.value = false;
      expandedIds.value = savedMarkerId ? expandedIds.value.filter(id => id !== savedMarkerId) : [];
      const detail = draft.base;
      const cached = library.value.items.find(row => row.image.id === detail.image.id);
      const item = draft.savedItem ?? { image: detail.image, annotationCount: detail.annotations.length, revisionCount: (cached?.revisionCount ?? 1) + (previousRevision !== detail.revision.id ? 1 : 0), username: detail.revision.username, uploadedByUserId: cached?.uploadedByUserId ?? detail.revision.userId };
      library.value.items = library.value.items.map(row => row.image.id === item.image.id ? item : row);
      toast.show(draft.message || '修改已保存');
      void loadLibrary(library.value.page, true);
    }
    if (success && dialog.value && !copy.count()) {
      const action = pendingNavigation; pendingNavigation = null; dialog.value = false; if (action) await action();
    }
    return success;
  }
  async function save() { return persist(); }
  async function saveMarker(id: string) { return persist(id); }
  async function resolveLeave(choice: 'save' | 'discard' | 'stay') {
    if (choice === 'stay' && !draft.busy) { dialog.value = false; pendingNavigation = null; return; }
    if (choice === 'save') { await save(); return; }
    if (blocked.value) return;
    if (draft.base) { write('session', 'image-review:draft:' + draft.base.image.id, null); copy.bind(draft.base); }
    const action = pendingNavigation; pendingNavigation = null; dialog.value = false; if (action) await action();
  }
  async function switchUser() { await navigate(async () => { stopUpdates?.(); stopUpdates = undefined; updateEpoch++; queue.clear(); copy.clear(); remoteChanged.value = false; remoteGone.value = false; write('session', activeKey, null); user.value = null; page.value = 'entry'; username.value = ''; url(); }); }
  async function uploadFiles(files: File[]) {
    if (!user.value || blocked.value || page.value !== 'library') return;
    error.value = ''; requestId.value = ''; await queue.start(files, user.value.userId);
  }
  async function retryUpload(id: string) { if (!busy.value && !copy.blocked() && !deletePending.value && !deleteDialog.value && user.value?.userId === queue.state.userId) await queue.retry(id); }
  async function abandonUpload(id: string) { if (window.confirm('上传结果尚未确认，服务器可能已有图片。放弃等待并继续后续文件？')) await queue.abandon(id); }
  function askDelete() { if (page.value === 'review' && currentImage.value && !blocked.value && !remoteGone.value) { error.value = ''; requestId.value = ''; deleteDialog.value = true; } }
  function cancelDelete() { if (!busy.value && !deletePending.value) deleteDialog.value = false; }
  async function finishDelete(id: string) {
    updateEpoch++; remoteGone.value = false; remoteChanged.value = false;
    const warning = '图片已删除，但本机缓存清理失败；旧链接不会恢复服务器数据';
    write('session', 'image-review:draft:' + id, null, warning); write('session', 'image-review:view:' + id, null, warning);
    copy.clear(); preview.clear(); historical.value = null; history.value = []; historyTotal.value = 0; historySelected.value = null;
    expandedIds.value = []; historyExpandedIds.value = []; deletePending.value = null; deleteDialog.value = false;
    // Remove the stale local card before a potentially failing list read; do not affect another image.
    if (library.value.items.some(row => row.image.id === id)) library.value.total = Math.max(0, library.value.total - 1);
    library.value.items = library.value.items.filter(row => row.image.id !== id);
    queue.clear(); page.value = 'library'; url(); error.value = ''; requestId.value = '';
    toast.show('图片已删除或已不存在'); await loadLibrary(library.value.page, true, '图片已删除');
  }
  async function deleteImage() {
    if (!user.value || busy.value || copy.blocked() || queue.active() || !draft.base || (!deleteDialog.value && !deletePending.value)) return;
    if (!deletePending.value) deletePending.value = { id: draft.base.image.id, value: { userId: user.value.userId, baseRevisionId: draft.base.revision.id } };
    const pending = deletePending.value;
    busy.value = true; error.value = ''; requestId.value = '';
    try { await api.removeImage(pending.id, pending.value); if (!disposed) await finishDelete(pending.id); }
    catch (value) {
      if (!disposed) {
        if (value instanceof RequestFailure && value.status === 404 && value.code === 'IMAGE_NOT_FOUND') await finishDelete(pending.id);
        else { report(value); if (value instanceof RequestFailure && value.status !== null) { deletePending.value = null; deleteDialog.value = false; if (value.code === 'REVIEW_BASE_CHANGED') remoteChanged.value = true; } }
      }
    } finally { busy.value = false; }
  }
  async function verifyDelete() {
    if (!deletePending.value || busy.value) return;
    const pending = deletePending.value; busy.value = true;
    try {
      const latest = await api.detail(pending.id);
      if (disposed) return;
      deletePending.value = null; deleteDialog.value = false;
      error.value = latest.revision.id === pending.value.baseRevisionId ? '图片仍存在，本次输入已保留。可再次确认删除。' : '图片已被更新，本次输入已保留，请重新加载核对后再决定删除';
    } catch (value) {
      if (!disposed) {
        if (value instanceof RequestFailure && value.status === 404 && value.code === 'IMAGE_NOT_FOUND') await finishDelete(pending.id);
        else report(value);
      }
    } finally { busy.value = false; }
  }
  async function reload() { await reviewLatest(); }
  async function historyList(more = false) {
    if (!currentImage.value) return;
    const next = more ? historyPage.value + 1 : 1;
    const list = await api.history(currentImage.value.id, next);
    history.value = more ? [...history.value, ...list.items] : list.items; historyTotal.value = list.total; historyPage.value = next;
  }
  async function openHistory(revisionId?: string) {
    if (blocked.value || !currentImage.value) return;
    busy.value = true; error.value = '';
    try {
      await historyList(); const id = revisionId ?? history.value[0]?.id;
      if (id) { historical.value = await api.historical(currentImage.value.id, id); page.value = 'history'; historySelected.value = null; historyExpandedIds.value = []; showChanges.value = false; url(currentImage.value.id, id); }
    } catch (value) { report(value); } finally { busy.value = false; }
  }
  async function selectHistory(id: string) {
    if (busy.value || !currentImage.value) return; busy.value = true; error.value = '';
    try { historical.value = await api.historical(currentImage.value.id, id); historySelected.value = null; historyExpandedIds.value = []; showChanges.value = false; url(currentImage.value.id, id); }
    catch (value) { report(value); } finally { busy.value = false; }
  }
  async function moreHistory() { if (busy.value) return; busy.value = true; try { await historyList(true); } catch (value) { report(value); } finally { busy.value = false; } }
  function backToReview() { page.value = 'review'; expandedIds.value = []; if (currentImage.value) url(currentImage.value.id); if (remoteChanged.value && !copy.count()) requestSync(); }
  async function selectMarker(id: string) {
    if (locked.value) return;
    if (page.value === 'history') { historySelected.value = id; if (!historyExpandedIds.value.includes(id)) historyExpandedIds.value.push(id); } else { draft.selectedId = id; if (!expandedIds.value.includes(id)) expandedIds.value.push(id); focusRevision.value++; }
    const point = stageMarkers.value.find(row => row.id === id); if (point) { await nextTick(); await stage.value?.reveal(point); }
  }
  function toggle(id: string) {
    if (locked.value) return;
    const expanded = page.value === 'history' ? historyExpandedIds : expandedIds;
    if (expanded.value.includes(id)) expanded.value = expanded.value.filter(value => value !== id); else void selectMarker(id);
  }
  function place(point: Point) { if (page.value === 'review' && !blocked.value) { copy.place(point); if (draft.selectedId && !expandedIds.value.includes(draft.selectedId)) expandedIds.value.push(draft.selectedId); } }
  function saveView(view: ViewSnapshot) { if (currentImage.value && page.value === 'review') write('session', 'image-review:view:' + currentImage.value.id, JSON.stringify(view)); }
  function beforeUnload(event: BeforeUnloadEvent) { if (copy.count() || draft.pending || queue.active() || deletePending.value) { event.preventDefault(); event.returnValue = ''; } }
  async function copyLink() { try { await navigator.clipboard.writeText(location.href); toast.show('图片链接已复制'); } catch { error.value = '复制失败，请从地址栏复制当前图片链接'; } }
  onMounted(async () => {
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('focus', requestSync);
    try {
      const remembered = read('local', rememberedKey); if (remembered) username.value = userSchema.parse(JSON.parse(remembered)).username;
      const active = read('session', activeKey); if (active) { const current = userSchema.parse(JSON.parse(active)); username.value = current.username; await enter(); }
    } catch { cacheWarning.value = '上次进入状态无法恢复，请重新输入 username'; }
  });
  onUnmounted(() => { disposed = true; updateEpoch++; stopUpdates?.(); listGeneration++; queue.dispose(); toast.dismiss(); preview.dispose(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('focus', requestSync); });
  return reactive({ page, user, username, busy, libraryBusy, libraryWarning, notice: toast.state, dismissToast: toast.dismiss, errorText, errorRequestId, cacheWarning, query, sort, layout, library, history, historyTotal, historical, historySelected, dialog, showChanges, historyExpandedIds, historyMarkers, changeLabel, activeMarkers, removedMarkers, expandedIds, focusRevision, uploads: queue.state, deleteDialog, deletePending, askDelete, cancelDelete, deleteImage, verifyDelete, retryUpload, stage, image, copy, draft, locked, blocked, selected, currentImage, rail, stageMarkers, merge, mergeChoices, mergeReady, remoteChanged, remoteGone, syncWarning, updateStatus, reviewLatest, cancelMerge, applyMerge, requestSync, enter, loadLibrary, toLibrary, openImage, save, saveMarker, resolveLeave, switchUser, uploadFiles, abandonUpload, reload, openHistory, selectHistory, moreHistory, backToReview, selectMarker, toggle, place, saveView, copyLink });
}
