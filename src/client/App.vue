<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { readySchema, errorSchema } from '../shared/contracts';
import { createLocalPreview } from './local-preview';
import { noteState, type Point } from './review';
import { createReviewSession } from './review-session';
import ImageStage from './ImageStage.vue';
import { defaultView, type ViewSnapshot } from './review-view';
import { createTabSession } from './tab-session';

const session = createReviewSession();
const review = session.state;
const restoringSession = ref(true);
const cacheStatus = ref<'idle' | 'saving' | 'ready' | 'error'>('idle');
const cacheError = ref('');
const viewState = ref<ViewSnapshot>({ ...defaultView, anchor: { ...defaultView.anchor } });
let tabSession: ReturnType<typeof createTabSession> | undefined;
let cacheRevision = 0;
const stage = ref<InstanceType<typeof ImageStage>>();
const noteInput = ref<HTMLTextAreaElement>();
const list = ref<HTMLDivElement>();
const dialog = ref<HTMLDialogElement>();
let returnFocus: HTMLElement | null = null;
const preview = createLocalPreview({
  canReplace: () => !review.pending && !review.deleteId && (!session.hasContent() || window.confirm('更换或清除图片会丢弃本次预览的全部临时标记和草稿。这些内容尚未保存。确定继续吗？')),
  onReplace: () => session.reset(),
});
const imageState = preview.state;
const noteStatus = computed(() => noteState(review.draft?.note ?? ''));
const selected = computed(() => review.markers.find(marker => marker.id === review.selectedId));
const hasDialog = computed(() => review.pending !== null || review.deleteId !== null);
const locked = computed(() => imageState.loading || hasDialog.value || restoringSession.value);
watch(() => imageState.loading, loading => { review.locked = loading; }, { flush: 'sync' });

function chooseImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void preview.select(file);
}
async function persistSession() {
  if (restoringSession.value || !tabSession) return;
  const image = imageState.image;
  const current = ++cacheRevision;
  cacheStatus.value = image ? 'saving' : 'idle';
  try {
    if (image) await tabSession.save({ image: { name: image.name, type: image.file.type, size: image.file.size, width: image.width, height: image.height }, review: session.snapshot(), view: viewState.value }, image.file);
    else await tabSession.clear();
    if (current === cacheRevision) { cacheStatus.value = image ? 'ready' : 'idle'; cacheError.value = ''; }
  } catch {
    if (current === cacheRevision) { cacheStatus.value = 'error'; cacheError.value = '标签页缓存不可用或空间不足，当前内容仍在页面中，但最近修改尚不能保证刷新恢复。请重试，或保持此页面打开。'; }
  }
}
function updateView(value: ViewSnapshot) { if (!restoringSession.value) viewState.value = value; }
async function clearPreview() {
  if (restoringSession.value) return;
  preview.clear();
  if (!imageState.image && !imageState.loading) await persistSession();
}
async function retryCache() {
  try { tabSession ??= createTabSession(); await persistSession(); }
  catch { cacheStatus.value = 'error'; cacheError.value = '浏览器拒绝使用标签页缓存；当前内容仅保留在此页面，请保持页面打开。'; }
}
watch([() => imageState.image, review, viewState], () => { void persistSession(); }, { deep: true, flush: 'post' });
async function syncSelection(focusEditor = false) {
  await nextTick();
  const point = review.draft ?? selected.value;
  if (point) void stage.value?.reveal(point);
  if (review.selectedId) {
    const row = list.value?.querySelector<HTMLElement>(`[data-marker-id="${review.selectedId}"]`);
    if (row && list.value) {
      const top = row.getBoundingClientRect().top - list.value.getBoundingClientRect().top + list.value.scrollTop;
      if (top < list.value.scrollTop || top + row.offsetHeight > list.value.scrollTop + list.value.clientHeight) list.value.scrollTop = top;
    }
  }
  if (focusEditor && review.draft && !review.pending) noteInput.value?.focus({ preventScroll: true });
}
function place(point: Point) {
  if (!imageState.image || locked.value) return;
  session.request({ kind: 'place', point });
  if (!review.pending) void syncSelection(true);
}
function select(id: string, toggle = false) {
  if (locked.value) return;
  if (toggle && review.expandedIds.includes(id)) { session.setExpanded(id, false); return; }
  session.request({ kind: 'select', id });
  if (!review.pending) { session.setExpanded(id, true); void syncSelection(); }
}
function edit(id: string) {
  session.request({ kind: 'edit', id });
  if (!review.pending) void syncSelection(true);
}
function apply() {
  if (!locked.value && session.applyDraft()) void syncSelection();
}
function resolvePending(choice: 'apply' | 'discard' | 'stay') {
  session.resolvePending(choice);
  if (!review.pending && choice !== 'stay') {
    if (review.selectedId) session.setExpanded(review.selectedId, true);
    void syncSelection(Boolean(review.draft));
  }
}
function resolveDelete(confirmed: boolean) {
  session.resolveDelete(confirmed);
}
function dismissDialog() {
  if (review.pending) resolvePending('stay');
  else resolveDelete(false);
}
watch(hasDialog, async open => {
  if (open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (open) {
    dialog.value?.showModal();
  } else {
    dialog.value?.close();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else list.value?.focus({ preventScroll: true });
    returnFocus = null;
  }
});
const hasUncachedContent = computed(() => (Boolean(imageState.image) || session.hasContent()) && cacheStatus.value !== 'ready');
function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
watch(hasUncachedContent, active => {
  if (active) window.addEventListener('beforeunload', beforeUnload);
  else window.removeEventListener('beforeunload', beforeUnload);
});

const serviceState = ref<'checking' | 'ready' | 'unavailable'>('checking');
const requestId = ref('');
let controller: AbortController | undefined;
async function check() {
  controller?.abort();
  controller = new AbortController();
  const active = controller;
  serviceState.value = 'checking';
  requestId.value = '';
  const timer = setTimeout(() => active.abort(), 5000);
  try {
    const response = await fetch('/api/ready', { signal: active.signal, cache: 'no-store' });
    const body: unknown = await response.json();
    if (active !== controller) return;
    if (!response.ok) {
      const parsed = errorSchema.safeParse(body);
      if (parsed.success) requestId.value = parsed.data.error.requestId;
      throw new Error('Unavailable');
    }
    readySchema.parse(body);
    serviceState.value = 'ready';
  } catch { if (active === controller) serviceState.value = 'unavailable'; }
  finally { clearTimeout(timer); }
}
onMounted(async () => {
  void check();
  try {
    tabSession = createTabSession();
    const restored = await tabSession.load();
    if (restored) {
      await preview.select(restored.file);
      if (!imageState.image || imageState.error) throw new Error('Session image unavailable');
      session.restore(restored.snapshot.review);
      viewState.value = restored.snapshot.view;
      await nextTick();
      await stage.value?.restoreView(restored.snapshot.view);
      cacheStatus.value = 'ready';
    }
  } catch {
    cacheStatus.value = 'error';
    cacheError.value = '标签页缓存无法读取，或图片缓存已不可用。可重新选择图片继续；清除预览可移除当前会话缓存。';
  } finally { restoringSession.value = false; }
});
onUnmounted(() => { controller?.abort(); preview.dispose(); tabSession?.close(); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <main>
    <p class="eyebrow">
      IMAGE REVIEW ANNOTATOR · P3
    </p>
    <h1>审图打点</h1>
    <p class="intro">
      点击问题位置，添加说明；从标记列表展开、定位和编辑。
    </p>
    <p class="notice">
      图片和标记仅缓存在当前标签页，尚未上传或正式保存。同一标签页刷新可恢复，普通关闭后重新打开不再恢复；收起说明不会丢失内容。
    </p>
    <p
      v-if="restoringSession"
      role="status"
    >
      正在恢复标签页会话…
    </p>
    <p
      v-else-if="cacheStatus === 'saving'"
      role="status"
    >
      正在缓存本次审阅，完成前请保持页面打开…
    </p>
    <p
      v-else-if="cacheStatus === 'ready'"
      class="muted"
    >
      已缓存到当前标签页，可刷新恢复；关闭后新页面无法恢复。此缓存不等于服务端保存。
    </p>
    <div
      v-if="cacheError"
      role="alert"
      class="cache-error"
    >
      <p class="error">
        {{ cacheError }}
      </p>
      <button
        class="secondary"
        :disabled="restoringSession || hasDialog"
        @click="retryCache"
      >
        重试会话缓存
      </button>
    </div>
    <section aria-labelledby="preview-heading">
      <div class="section-heading">
        <h2 id="preview-heading">
          单图审阅
        </h2>
        <span class="muted">{{ review.markers.length }} 个临时标记</span>
      </div>
      <div class="toolbar">
        <label class="file-picker">选择本地图片
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            :disabled="hasDialog || restoringSession"
            @change="chooseImage"
          >
        </label>
        <button
          v-if="imageState.image || imageState.loading || cacheError"
          class="secondary"
          :disabled="hasDialog || restoringSession"
          @click="clearPreview"
        >
          清除预览
        </button>
      </div>
      <p class="muted">
        PNG / JPEG / WebP，每张最多 20 MiB。
      </p>
      <p
        v-if="imageState.error"
        role="alert"
        class="error"
      >
        {{ imageState.error }}
      </p>
      <p
        v-if="imageState.loading"
        role="status"
      >
        正在读取图片…
      </p>
      <template v-if="imageState.image">
        <p class="image-name">
          {{ imageState.image.name }} · {{ imageState.image.width }} × {{ imageState.image.height }}
        </p>
        <div class="review-layout">
          <ImageStage
            ref="stage"
            :image="imageState.image"
            :markers="review.markers"
            :draft="review.draft"
            :selected-id="review.selectedId"
            :disabled="locked"
            @place="place"
            @select="select"
            @view="updateView"
          />
          <aside
            class="review-sidebar"
            aria-label="标记列表和说明"
          >
            <div class="list-heading">
              <h3>临时标记</h3>
              <button
                v-if="review.expandedIds.length"
                class="text-button"
                :disabled="locked"
                @click="session.collapseAll"
              >
                收起全部
              </button>
            </div>
            <div
              ref="list"
              class="marker-list"
              tabindex="-1"
              aria-label="临时标记列表"
            >
              <p
                v-if="!review.markers.length"
                class="muted"
              >
                还没有临时标记。在图片上点击位置，填写说明后添加。
              </p>
              <article
                v-for="marker in review.markers"
                :key="marker.id"
                class="marker-row"
                :class="{ 'is-selected': review.selectedId === marker.id }"
                :data-marker-id="marker.id"
              >
                <button
                  class="marker-summary"
                  :disabled="locked"
                  :aria-expanded="review.expandedIds.includes(marker.id)"
                  :aria-controls="`note-${marker.id}`"
                  @click="select(marker.id, true)"
                >
                  <span class="marker-label">临时 {{ marker.label }}</span>
                  <span
                    v-if="review.selectedId === marker.id"
                    class="selected-label"
                  >已选中</span>
                  <span
                    class="disclosure"
                    aria-hidden="true"
                  >{{ review.expandedIds.includes(marker.id) ? '−' : '+' }}</span>
                </button>
                <div
                  v-show="review.expandedIds.includes(marker.id)"
                  :id="`note-${marker.id}`"
                  class="marker-details"
                >
                  <p class="marker-note">
                    {{ marker.note }}
                  </p>
                  <p class="muted">
                    位置 {{ (marker.x * 100).toFixed(1) }}% / {{ (marker.y * 100).toFixed(1) }}%
                  </p>
                  <div class="toolbar">
                    <button
                      class="secondary"
                      :disabled="locked"
                      @click="edit(marker.id)"
                    >
                      编辑说明
                    </button>
                    <button
                      class="danger-secondary"
                      :disabled="locked || review.selectedId !== marker.id"
                      @click="session.requestDelete(marker.id)"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            </div>
            <section
              v-if="review.draft"
              class="draft-panel"
              aria-labelledby="draft-title"
            >
              <h3 id="draft-title">
                {{ review.draft.id ? '编辑临时说明' : '新增临时标记' }}
              </h3>
              <p class="muted">
                位置 {{ (review.draft.x * 100).toFixed(1) }}% / {{ (review.draft.y * 100).toFixed(1) }}% · 当前标签页临时缓存
              </p>
              <label for="draft-note">问题说明</label>
              <textarea
                id="draft-note"
                ref="noteInput"
                v-model="review.draft.note"
                rows="5"
                :disabled="locked"
                :aria-invalid="noteStatus !== 'valid'"
                aria-describedby="note-status"
                placeholder="描述这里需要调整的问题…"
              />
              <p
                id="note-status"
                aria-live="polite"
                :class="{ error: noteStatus !== 'valid' }"
              >
                {{ noteStatus === 'empty' ? '说明不能为空。' : noteStatus === 'too-long' ? '说明最多 2000 字符。' : '说明有效，尚未保存。' }}（{{ review.draft.note.trim().length }} / 2000）
              </p>
              <div class="toolbar">
                <button
                  :disabled="locked || noteStatus !== 'valid'"
                  @click="apply"
                >
                  {{ review.draft.id ? '应用临时修改' : '添加临时标记' }}
                </button>
                <button
                  class="secondary"
                  :disabled="locked"
                  @click="session.cancelDraft"
                >
                  取消草稿
                </button>
              </div>
            </section>
            <p
              v-if="review.hint"
              role="status"
              class="error"
            >
              {{ review.hint }}
            </p>
          </aside>
        </div>
      </template>
      <p
        v-else-if="!imageState.loading"
        class="empty-state"
      >
        尚未选择图片。选择后即可临时预览和打点。
      </p>
    </section>
    <section
      class="service-panel"
      aria-labelledby="service-heading"
    >
      <h2 id="service-heading">
        服务状态
      </h2>
      <p
        role="status"
        aria-live="polite"
        :class="serviceState"
      >
        <span class="dot" />{{ serviceState === 'checking' ? '检查中' : serviceState === 'ready' ? '服务已就绪' : '服务不可用' }}
      </p>
      <p v-if="serviceState === 'unavailable'">
        请确认后端正在运行，然后重试。
      </p>
      <p
        v-if="requestId"
        class="request-id"
      >
        请求编号：{{ requestId }}
      </p>
      <button
        :disabled="serviceState === 'checking'"
        @click="check"
      >
        {{ serviceState === 'checking' ? '正在检查…' : '重新检查' }}
      </button>
      <p class="muted">
        本地审阅不依赖服务状态。正式上传、保存与恢复将在后续阶段提供。
      </p>
    </section>
    <dialog
      ref="dialog"
      class="review-dialog"
      aria-labelledby="confirm-title"
      @cancel.prevent="dismissDialog"
    >
      <template v-if="review.pending">
        <h2 id="confirm-title">
          先处理当前草稿
        </h2>
        <p>应用只会更新当前标签页的临时内容。请选择如何处理，再继续刚才的操作。</p>
        <p
          v-if="noteStatus !== 'valid'"
          class="error"
        >
          当前说明无效，请放弃草稿，或留在当前修改说明。
        </p>
        <div class="toolbar">
          <button
            :disabled="noteStatus !== 'valid'"
            @click="resolvePending('apply')"
          >
            应用后继续
          </button>
          <button
            class="danger-secondary"
            @click="resolvePending('discard')"
          >
            放弃草稿并继续
          </button>
          <button
            class="secondary"
            autofocus
            @click="resolvePending('stay')"
          >
            留在当前
          </button>
        </div>
      </template>
      <template v-else-if="review.deleteId">
        <h2 id="confirm-title">
          删除临时标记？
        </h2>
        <p>该标记及正在编辑的说明将一并删除，无法撤销。其他标记会保留。</p>
        <div class="toolbar">
          <button
            class="danger"
            @click="resolveDelete(true)"
          >
            确认删除
          </button>
          <button
            class="secondary"
            autofocus
            @click="resolveDelete(false)"
          >
            取消
          </button>
        </div>
      </template>
    </dialog>
  </main>
</template>
