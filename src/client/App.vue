<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from 'vue';
import ImageStage from './ImageStage.vue';
import SortMenu from './components/SortMenu.vue';
import ReviewMergeDialog from './components/ReviewMergeDialog.vue';
import type { WorkingMarker } from '../shared/workbench-contracts';
import { useWorkbench } from './state/use-workbench';
import entryArt from './assets/entry.svg';
const w = useWorkbench();
const imageStage = ref<InstanceType<typeof ImageStage>>();
const leaveDialog = ref<HTMLDialogElement>(); const fileInput = ref<HTMLInputElement>();
const deleteDialog = ref<HTMLDialogElement>();
const mobilePane = ref<'canvas' | 'markers' | 'history'>('canvas');
watch(() => [w.page, w.currentImage?.id], () => { mobilePane.value = 'canvas'; });
watch(mobilePane, async value => { if (value === 'canvas') { await nextTick(); const selected = w.stageMarkers.find(row => row.id === (w.page === 'history' ? w.historySelected : w.draft.selectedId)); if (selected) await imageStage.value?.reveal(selected); } });
const uploadStatus = (value: string) => ({ waiting: '等待上传', uploading: '正在上传', success: '上传成功', failed: '上传失败', unknown: '结果未知，已暂停', abandoned: '已放弃等待' })[value] ?? value;
watchEffect(() => { w.stage = imageStage.value; });
const avatar = computed(() => Array.from(w.user?.username ?? '')[0] ?? '');
const severityText = (value: string) => ({ low: '低', medium: '中', high: '高' })[value] ?? value;
const changeText = (value: string | null) => ({ add: '新增', modify: '已修改', delete: '待删除' })[value ?? ''] ?? '';
const time = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
const counts = computed(() => ({ add: w.draft.markers.filter(row => w.copy.kind(row.id) === 'add').length, modify: w.draft.markers.filter(row => w.copy.kind(row.id) === 'modify').length, delete: w.draft.removed.length }));
const versionName = (revision?: { versionNumber: number; kind: string }) => !revision ? '' : revision.versionNumber > 0 ? `V${revision.versionNumber}` : revision.kind === 'import' ? '导入记录' : '原始图片';
function setSize(row: WorkingMarker, event: Event) {
  const input = event.target as HTMLInputElement; const value = Number(input.value);
  row.size = Number.isFinite(value) ? Math.round(Math.max(12, Math.min(48, value))) : row.size ?? 24;
  input.value = String(row.size);
}
function openLink(event: MouseEvent, id: string) { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void w.openImage(id); }
function chooseFile(event: Event) { const input = event.target as HTMLInputElement; const files = Array.from(input.files ?? []); input.value = ''; if (files.length) void w.uploadFiles(files); }
async function savePoint(id: string) { if (await w.saveMarker(id)) { await nextTick(); document.getElementById(`marker-summary-${id}`)?.focus({ preventScroll: true }); } }
async function cancelPoint(id: string) { if (w.blocked) return; w.copy.undo(id); await nextTick(); (document.getElementById(`marker-summary-${id}`) ?? document.getElementById('marker-inspector'))?.focus({ preventScroll: true }); }
let previousFocus: HTMLElement | null = null;
watch(() => [w.draft.selectedId, w.focusRevision, w.dialog], async () => {
  if (w.page !== 'review' || w.dialog || !w.draft.selectedId) return;
  await nextTick();
  const field = document.getElementById(`note-${w.draft.selectedId}`) as HTMLTextAreaElement | null;
  const list = field?.closest<HTMLElement>('.marker-list');
  if (field && list && w.expandedIds.includes(w.draft.selectedId!)) {
    const rectangle = field.getBoundingClientRect(); const bounds = list.getBoundingClientRect();
    if (rectangle.top < bounds.top || rectangle.bottom > bounds.bottom) list.scrollTop += rectangle.top - bounds.top - 16;
    field.focus({ preventScroll: true });
  }
});
watch(() => w.dialog, async value => {
  if (value) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (value) leaveDialog.value?.showModal(); else { leaveDialog.value?.close(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }
});
watch(() => w.deleteDialog, async value => {
  if (value) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (value) deleteDialog.value?.showModal(); else { deleteDialog.value?.close(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }
});
</script>

<template>
  <main
    v-if="w.page === 'entry'"
    class="entry-shell"
  >
    <section class="entry-story">
      <div class="brand">
        <span
          class="brand-mark"
          aria-hidden="true"
        />审图工作台
      </div>
      <div class="entry-copy">
        <h1>让每一处反馈，<br>都落在准确的位置。</h1><div class="entry-mock">
          <img
            :src="entryArt"
            alt="图片审阅示意"
          >
        </div>
      </div>
    </section>
    <section
      class="entry-form-area"
      aria-labelledby="entry-title"
    >
      <form
        class="entry-card"
        @submit.prevent="w.enter"
      >
        <h2 id="entry-title">
          开始一次审阅
        </h2>
        <div class="entry-field">
          <label for="username">Username / 昵称</label><input
            id="username"
            v-model="w.username"
            class="entry-input"
            maxlength="40"
            autocomplete="nickname"
            autofocus
            :disabled="w.busy"
            required
          >
        </div>
        <p
          v-if="w.errorText"
          class="error inline-error"
          role="alert"
        >
          {{ w.errorText }}
        </p><button
          class="btn primary entry-submit"
          type="submit"
          :disabled="w.busy"
        >
          {{ w.busy ? '正在进入…' : '进入工作台 →' }}
        </button>
      </form>
    </section>
  </main>
  <div
    v-else
    class="workspace-shell"
  >
    <header class="topbar">
      <button
        class="brand brand-button"
        :disabled="w.blocked"
        @click="w.toLibrary"
      >
        <span
          class="brand-mark"
          aria-hidden="true"
        />审图工作台
      </button><div class="breadcrumb">
        <span>共享工作空间</span><span>/</span><strong>{{ w.page === 'library' ? '图片库' : w.page === 'history' ? '查看历史' : '图片审阅' }}</strong>
      </div><div class="grow" />
      <details class="user-menu">
        <summary class="user">
          <span class="avatar">{{ avatar }}</span><span><span class="tiny">当前 username </span>{{ w.user?.username }}</span><span class="chevron">⌄</span>
        </summary><div class="user-dropdown">
          <p class="tiny">
            当前操作人
          </p><p class="wrap">
            {{ w.user?.username }}
          </p><button
            class="btn"
            :disabled="w.blocked"
            @click="w.switchUser"
          >
            切换 username
          </button>
        </div>
      </details>
    </header>
    <div
      v-if="w.remoteGone || w.remoteChanged || w.syncWarning || w.updateStatus === 'disconnected' || w.updateStatus === 'unavailable'"
      class="feedback collaboration-feedback"
      role="status"
    >
      <p class="wrap">
        {{ w.remoteGone ? '这张图片已被删除。本地输入仍在，无法保存到原图；可复制说明后返回图片库。' : w.remoteChanged ? '已保存内容发生变化，本地输入已保留，请核对最新版本。' : w.syncWarning || '更新通知暂不可用；可手动核对，保存时仍检查版本。' }}
      </p>
      <button
        v-if="w.currentImage && !w.remoteGone"
        class="btn"
        :disabled="w.blocked || w.dialog"
        @click="w.reviewLatest"
      >
        读取最新并核对
      </button>
    </div>
    <div
      v-if="w.busy || w.draft.busy || w.libraryBusy"
      class="progress-line"
      role="status"
    >
      {{ w.draft.busy ? '正在保存本次修改…' : '正在读取…' }}
    </div>
    <div
      v-if="w.errorText || w.draft.pending || w.deletePending"
      class="feedback error-feedback"
      role="alert"
    >
      <p class="wrap">
        {{ w.errorText || '上次请求结果尚未确认，输入已保留。' }}
      </p><details v-if="w.errorRequestId">
        <summary>请求编号</summary><code>{{ w.errorRequestId }}</code>
      </details>
      <button
        v-if="w.draft.pending"
        class="btn"
        :disabled="w.busy || w.draft.busy"
        @click="w.save"
      >
        用原请求确认保存结果
      </button>
      <template v-else-if="w.deletePending">
        <button
          class="btn"
          :disabled="w.busy"
          @click="w.verifyDelete"
        >
          核实删除结果
        </button>
      </template>
      <button
        v-else-if="w.page === 'library'"
        class="btn"
        :disabled="w.busy"
        @click="w.loadLibrary(w.library.page)"
      >
        重新读取图片库
      </button><button
        v-else
        class="btn"
        :disabled="w.blocked"
        @click="w.reload"
      >
        重新加载已保存数据
      </button>
    </div>
    <div
      class="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        v-if="w.notice.message"
        class="toast"
      >
        <span aria-hidden="true">✓</span><span>{{ w.notice.message }}</span><button
          aria-label="关闭提示"
          @click="w.dismissToast"
        >
          ×
        </button>
      </div>
    </div>
    <p
      v-if="w.libraryWarning"
      class="cache-warning"
      role="status"
    >
      {{ w.libraryWarning }}<button
        class="btn"
        :disabled="w.libraryBusy"
        @click="w.loadLibrary(w.library.page, true)"
      >
        重试列表
      </button>
    </p>
    <p
      v-if="w.cacheWarning"
      class="cache-warning"
      role="status"
    >
      {{ w.cacheWarning }}
    </p>
    <div
      v-if="w.page === 'library'"
      class="app-layout"
    >
      <aside
        class="app-nav"
        aria-label="图片导航"
      >
        <button
          class="nav-item active"
          :disabled="w.blocked"
          @click="w.query = ''; w.loadLibrary()"
        >
          <span aria-hidden="true">▦</span><span class="nav-text">全部图片</span><span class="nav-count">{{ w.library.total }}</span>
        </button>
      </aside>
      <main class="library">
        <div class="page-heading">
          <div>
            <h1>图片库 <span class="image-total">{{ w.library.total }} 张图片</span></h1>
          </div><button
            class="btn primary"
            :disabled="w.blocked"
            @click="fileInput?.click()"
          >
            ＋ 上传图片
          </button><input
            ref="fileInput"
            type="file"
            class="visually-hidden"
            accept="image/png,image/jpeg,image/webp"
            multiple
            :disabled="w.blocked"
            @change="chooseFile"
          >
        </div>
        <section
          v-if="w.uploads.items.length || w.uploads.error"
          class="upload-results"
          aria-label="上传结果"
          :aria-busy="w.uploads.running"
        >
          <h2>上传图片 <span class="muted">{{ w.uploads.items.filter(item => ['success', 'failed', 'abandoned'].includes(item.status)).length }} / {{ w.uploads.items.length }}</span></h2>
          <p
            v-if="w.uploads.error"
            class="error"
            role="alert"
          >
            {{ w.uploads.error }}
          </p>
          <p class="small muted">
            一次最多 10 张，逐张上传；刷新或关闭页面后不继续上传。
          </p>
          <ul>
            <li
              v-for="item in w.uploads.items"
              :key="item.id"
            >
              <span class="upload-name wrap">{{ item.file.name }}</span>
              <span
                class="upload-state"
                :class="{ error: item.status === 'failed' || item.status === 'unknown' }"
                role="status"
              >{{ uploadStatus(item.status) }}</span>
              <p
                v-if="item.message && item.status !== 'success'"
                class="wrap small"
              >
                {{ item.message }}
              </p>
              <details v-if="item.requestId">
                <summary>请求编号</summary><code>{{ item.requestId }}</code>
              </details>
              <div class="row upload-actions">
                <button
                  v-if="item.status === 'success' && item.image"
                  class="btn"
                  :disabled="w.blocked"
                  @click="w.openImage(item.image!.id)"
                >
                  打开图片
                </button>
                <button
                  v-if="item.status === 'failed' || item.status === 'unknown'"
                  class="btn"
                  :disabled="w.uploads.running || w.busy || w.uploads.items.some(row => row.status === 'unknown' && row.id !== item.id)"
                  @click="w.retryUpload(item.id)"
                >
                  {{ item.status === 'unknown' ? '用原文件确认结果' : '重试本项' }}
                </button>
                <button
                  v-if="item.status === 'unknown'"
                  class="btn subtle"
                  :disabled="w.uploads.running || w.busy"
                  @click="w.abandonUpload(item.id)"
                >
                  放弃等待并继续
                </button>
              </div>
            </li>
          </ul>
        </section>
        <div class="tools">
          <form
            class="row search-form"
            @submit.prevent="w.loadLibrary()"
          >
            <label class="search"><span aria-hidden="true">⌕</span><input
              v-model="w.query"
              type="search"
              autocomplete="off"
              placeholder="搜索图片名称…"
              maxlength="255"
              aria-label="搜索图片名称"
              :disabled="w.blocked"
            ></label><button
              class="btn"
              :disabled="w.blocked"
            >
              搜索
            </button>
          </form><div class="grow" /><SortMenu
            v-model="w.sort"
            :disabled="w.blocked"
            @change="w.loadLibrary()"
          /><div
            class="segmented"
            aria-label="图片布局"
          >
            <button
              class="segment"
              :class="{ active: w.layout === 'grid' }"
              :aria-pressed="w.layout === 'grid'"
              @click="w.layout = 'grid'"
            >
              网格
            </button><button
              class="segment"
              :class="{ active: w.layout === 'list' }"
              :aria-pressed="w.layout === 'list'"
              @click="w.layout = 'list'"
            >
              列表
            </button>
          </div>
        </div>
        <section
          class="library-grid"
          :class="{ 'list-mode': w.layout === 'list' }"
          aria-label="已保存图片"
        >
          <article
            v-for="item in w.library.items"
            :key="item.image.id"
            class="image-card"
          >
            <a
              :href="`?imageId=${item.image.id}`"
              @click="openLink($event, item.image.id)"
            ><div class="card-preview"><img
              :src="`/api/images/${item.image.id}/content`"
              :alt="item.image.originalName"
              loading="lazy"
            ></div><div class="card-body"><h2 class="card-title"><span
              class="truncate"
              :title="item.image.originalName"
            >{{ item.image.originalName }}</span></h2><div class="card-meta"><span>{{ item.annotationCount }} 个标记</span><span>·</span><span>{{ Math.max(0, item.revisionCount - 1) }} 个版本</span><span>·</span><span>{{ item.image.width }}×{{ item.image.height }}</span></div><div class="card-footer"><span class="truncate">{{ item.username }}</span><span :title="item.image.updatedAt">{{ time(item.image.updatedAt) }}</span></div></div></a>
          </article>
        </section>
        <div
          v-if="!w.library.items.length && !w.busy"
          class="empty-state"
        >
          <h2>{{ w.query ? '没有找到匹配的图片' : '上传你的第一张图片' }}</h2><p>{{ w.query ? '试试其他名称，或清空搜索。' : '图片保存后会集中出现在这里，随时打开继续审阅。' }}</p><button
            v-if="!w.query"
            class="btn primary"
            :disabled="w.blocked"
            @click="fileInput?.click()"
          >
            ＋ 上传图片
          </button>
        </div>
        <footer class="library-footer">
          <span>共 {{ w.library.total }} 张 · 第 {{ w.library.page }} 页</span><div class="pagination">
            <button
              class="btn"
              :disabled="w.blocked || w.library.page <= 1"
              @click="w.loadLibrary(w.library.page - 1)"
            >
              上一页
            </button><button
              class="btn"
              :disabled="w.blocked || w.library.page * w.library.pageSize >= w.library.total"
              @click="w.loadLibrary(w.library.page + 1)"
            >
              下一页
            </button>
          </div>
        </footer>
      </main>
    </div>
    <template v-else-if="w.currentImage && w.image.image">
      <section class="review-header">
        <div class="review-title">
          <div class="row">
            <button
              class="btn back-button"
              :disabled="w.blocked"
              @click="w.toLibrary"
            >
              ← 返回图片库
            </button><h1
              class="truncate"
              :title="w.currentImage.originalName"
            >
              {{ w.currentImage.originalName }}
            </h1>
          </div><p class="small muted">
            {{ versionName(w.page === 'history' ? w.historical?.revision : w.draft.base?.revision) }} · {{ w.page === 'history' ? '保存于' : '上次保存' }} {{ time(w.page === 'history' ? w.historical?.revision.savedAt : w.draft.base?.revision.savedAt) }} · {{ w.page === 'history' ? w.historical?.revision.username : w.draft.base?.revision.username }}
          </p>
        </div>
        <div class="review-actions">
          <template v-if="w.page === 'review'">
            <button
              class="btn subtle danger"
              :disabled="w.blocked || w.remoteGone"
              @click="w.askDelete"
            >
              删除图片
            </button>
            <span
              v-if="w.copy.count()"
              class="pill amber"
            >● 未保存 {{ w.copy.count() }} 项</span><span
              v-else
              class="pill green"
            >已保存</span><button
              class="btn subtle"
              @click="w.copyLink"
            >
              复制链接
            </button><button
              class="btn"
              :disabled="w.blocked"
              @click="w.reload"
            >
              重新加载
            </button><button
              class="btn"
              :disabled="w.blocked"
              @click="w.openHistory()"
            >
              ◷ 查看历史
            </button><button
              class="btn primary"
              :disabled="w.blocked || w.remoteGone || !w.copy.count()"
              @click="w.save"
            >
              ✓ 保存全部修改
            </button>
          </template><template v-else>
            <span class="pill gray">历史只读</span><button
              class="btn primary"
              :disabled="w.busy"
              @click="w.backToReview"
            >
              返回当前工作副本
            </button>
          </template>
        </div>
      </section>
      <nav
        class="workspace-pane-tabs"
        aria-label="工作区面板"
      >
        <button
          class="btn"
          :aria-pressed="mobilePane === 'canvas'"
          @click="mobilePane = 'canvas'"
        >
          图片
        </button>
        <button
          v-if="w.page === 'history'"
          class="btn"
          :aria-pressed="mobilePane === 'history'"
          @click="mobilePane = 'history'"
        >
          版本
        </button>
        <button
          class="btn"
          :aria-pressed="mobilePane === 'markers'"
          @click="mobilePane = 'markers'"
        >
          标记 {{ w.page === 'history' ? w.historyMarkers.length : w.activeMarkers.length }}
        </button>
      </nav>
      <main
        :class="w.page === 'history' ? 'history-layout' : 'workbench'"
        :data-pane="mobilePane"
      >
        <aside
          v-if="w.page === 'review'"
          class="image-rail"
          aria-label="多图片列表"
        >
          <div class="rail-heading">
            <span>图片 {{ w.library.total }}</span><button
              class="plain-button"
              :disabled="w.blocked"
              @click="w.toLibrary"
            >
              图片库 ↗
            </button>
          </div><div class="rail-images">
            <a
              v-for="item in w.rail"
              :key="item.image.id"
              class="rail-image"
              :class="{ selected: item.image.id === w.currentImage.id }"
              :href="`?imageId=${item.image.id}`"
              @click="openLink($event, item.image.id)"
            ><img
              class="rail-thumb"
              :src="`/api/images/${item.image.id}/content`"
              alt=""
              loading="lazy"
            ><div class="grow"><p
              class="rail-name truncate"
              :title="item.image.originalName"
            >{{ item.image.originalName }}</p><p class="rail-meta">{{ item.annotationCount }} 个标记</p></div></a>
          </div><div class="rail-paging">
            <button
              class="plain-button"
              :disabled="w.blocked || w.library.page <= 1"
              @click="w.loadLibrary(w.library.page - 1)"
            >
              上一页
            </button><button
              class="plain-button"
              :disabled="w.blocked || w.library.page * 12 >= w.library.total"
              @click="w.loadLibrary(w.library.page + 1)"
            >
              下一页
            </button>
          </div>
        </aside>
        <aside
          v-else
          class="history-rail"
          aria-label="版本历史"
        >
          <h2>版本历史 <span class="muted">{{ w.historyTotal }}</span></h2><div class="history-list">
            <div
              v-for="item in w.history"
              :key="item.id"
              class="history-entry"
              :class="{ selected: item.id === w.historical?.revision.id }"
            >
              <button
                class="history-card"
                :disabled="w.busy"
                @click="w.selectHistory(item.id)"
              >
                <div class="history-time">
                  {{ versionName(item) }} · {{ time(item.savedAt) }}
                </div><p class="history-person">
                  {{ item.username }} 保存
                </p><p class="history-summary">
                  {{ item.kind === 'upload' ? '上传原图' : item.kind === 'import' ? '导入记录' : `新增 ${item.added} · 修改 ${item.modified} · 删除 ${item.deleted}` }}
                </p>
              </button>
            </div>
          </div><button
            v-if="w.history.length < w.historyTotal"
            class="btn history-more"
            :disabled="w.busy"
            @click="w.moreHistory"
          >
            加载更早记录
          </button>
        </aside>
        <section
          class="canvas-panel"
          aria-label="图片画布"
        >
          <ImageStage
            ref="imageStage"
            :image="w.image.image"
            :markers="w.stageMarkers"
            :draft="null"
            :selected-id="w.page === 'history' ? w.historySelected : w.draft.selectedId"
            :disabled="w.locked"
            :read-only="w.page === 'history'"
            :temporary-labels="false"
            @place="point => { w.place(point); mobilePane = 'markers'; }"
            @select="id => { w.selectMarker(id); mobilePane = 'markers'; }"
            @view="w.saveView"
          />
        </section>
        <aside
          v-if="w.page === 'review'"
          id="marker-inspector"
          class="inspector"
          aria-label="标记与说明"
          tabindex="-1"
        >
          <div class="inspector-heading">
            <h2>标记 {{ w.activeMarkers.length }}</h2><button
              v-if="w.expandedIds.length"
              class="plain-button tiny"
              :disabled="w.blocked"
              @click="w.expandedIds = []"
            >
              收起全部
            </button>
          </div><p
            v-if="w.copy.count()"
            class="tiny"
          >
            {{ counts.add }} 项新增 · {{ counts.modify }} 项修改 · {{ counts.delete }} 项待删除
          </p>
          <div class="marker-list">
            <section
              v-for="row in w.activeMarkers"
              :key="row.id"
              class="marker-item"
              :class="{ active: row.id === w.draft.selectedId, 'pending-delete': w.draft.removed.includes(row.id) }"
            >
              <div class="marker-summary-row">
                <button
                  :id="`marker-summary-${row.id}`"
                  class="marker-summary"
                  :disabled="w.blocked"
                  :aria-expanded="w.expandedIds.includes(row.id)"
                  :aria-controls="`details-${row.id}`"
                  @click="w.toggle(row.id)"
                >
                  <span class="marker-num">#{{ row.label }}</span><span
                    class="severity"
                    :class="row.severity"
                  /><span class="grow truncate">{{ row.note || '请填写问题说明' }}</span><span
                    v-if="w.copy.kind(row.id)"
                    class="pill"
                    :class="w.copy.kind(row.id) === 'delete' ? 'red' : w.copy.kind(row.id) === 'add' ? 'green' : 'amber'"
                  >{{ changeText(w.copy.kind(row.id)) }}</span><span
                    v-else
                    class="muted"
                  >{{ w.expandedIds.includes(row.id) ? '−' : '+' }}</span>
                </button>
                <button
                  v-if="w.copy.old(row.id)"
                  class="marker-delete"
                  :aria-label="`删除标记 ${row.label}`"
                  title="删除标记"
                  :disabled="w.blocked"
                  @click="w.copy.remove(row.id)"
                >
                  ×
                </button>
              </div>
              <div
                v-show="w.expandedIds.includes(row.id)"
                :id="`details-${row.id}`"
                class="marker-description"
              >
                <label
                  class="field-label"
                  :for="`note-${row.id}`"
                >问题说明</label><textarea
                  :id="`note-${row.id}`"
                  v-model="w.draft.markers.find(marker => marker.id === row.id)!.note"
                  class="note-input"
                  maxlength="2000"
                  :disabled="w.blocked"
                  placeholder="描述这个位置需要修改的问题…"
                /><p class="tiny">
                  {{ row.note.trim().length }} / 2000{{ !row.note.trim() ? ' · 保存前请填写说明' : '' }}
                </p><div class="field-row">
                  <label
                    class="field-label"
                    :for="`severity-${row.id}`"
                  >严重程度</label><select
                    :id="`severity-${row.id}`"
                    v-model="w.draft.markers.find(marker => marker.id === row.id)!.severity"
                    class="severity-select"
                    :disabled="w.blocked"
                  >
                    <option value="low">
                      低
                    </option><option value="medium">
                      中
                    </option><option value="high">
                      高
                    </option>
                  </select>
                </div><div class="point-size-field">
                  <label
                    class="field-label"
                    :for="`size-${row.id}`"
                  >大小</label>
                  <input
                    :id="`size-${row.id}`"
                    type="range"
                    min="12"
                    max="48"
                    step="1"
                    :value="row.size ?? 24"
                    :disabled="w.blocked"
                    :aria-label="`标记 ${row.label} 大小`"
                    @input="setSize(w.draft.markers.find(marker => marker.id === row.id)!, $event)"
                  >
                  <input
                    type="number"
                    min="12"
                    max="48"
                    step="1"
                    :value="row.size ?? 24"
                    :disabled="w.blocked"
                    :aria-label="`标记 ${row.label} 大小像素值`"
                    @change="setSize(w.draft.markers.find(marker => marker.id === row.id)!, $event)"
                  ><span>px</span>
                </div><div
                  v-if="w.copy.old(row.id)"
                  class="marker-author"
                >
                  创建：{{ w.copy.old(row.id)!.createdByName }} · {{ time(w.copy.old(row.id)!.createdAt) }}<br>最后保存：{{ w.copy.old(row.id)!.updatedByName }} · {{ time(w.copy.old(row.id)!.updatedAt) }}
                </div><p
                  v-else
                  class="tiny"
                >
                  本次新建 · 尚未保存
                </p><div class="marker-actions">
                  <button
                    class="btn primary"
                    :disabled="w.blocked || w.remoteGone || !w.copy.kind(row.id)"
                    @click="savePoint(row.id)"
                  >
                    保存
                  </button><button
                    class="btn subtle danger"
                    :disabled="w.blocked"
                    @click="cancelPoint(row.id)"
                  >
                    取消
                  </button>
                </div>
              </div>
            </section>
          </div>
          <details
            v-if="w.removedMarkers.length"
            class="removed-markers"
          >
            <summary>待删除 {{ w.removedMarkers.length }}</summary>
            <div
              v-for="row in w.removedMarkers"
              :key="row.id"
              class="removed-row"
            >
              <span class="truncate">{{ row.note }}</span><button
                class="btn subtle"
                :disabled="w.blocked"
                @click="w.copy.restoreRemoved(row.id)"
              >
                撤回删除
              </button>
            </div>
          </details>
        </aside>
        <aside
          v-else-if="w.historical"
          class="inspector"
          aria-label="历史标记"
        >
          <div class="inspector-heading">
            <h2>标记 {{ w.historyMarkers.length }}</h2><span class="pill gray">只读</span>
          </div>
          <div class="marker-list">
            <section
              v-for="row in w.historyMarkers"
              :key="row.id"
              class="marker-item"
              :class="{ active: row.id === w.historySelected }"
            >
              <button
                class="marker-summary"
                :disabled="w.locked"
                :aria-expanded="w.historyExpandedIds.includes(row.id)"
                :aria-controls="`history-details-${row.id}`"
                @click="w.toggle(row.id)"
              >
                <span class="marker-num">#{{ row.label }}</span><span
                  class="severity"
                  :class="row.severity"
                /><span class="grow truncate">{{ row.note }}</span><span aria-hidden="true">{{ w.historyExpandedIds.includes(row.id) ? '−' : '+' }}</span>
              </button>
              <div
                v-show="w.historyExpandedIds.includes(row.id)"
                :id="`history-details-${row.id}`"
                class="marker-description"
              >
                <p class="wrap history-note">
                  {{ row.note }}
                </p><div class="field-row">
                  <span>{{ severityText(row.severity) }}</span><span>{{ row.size }} px</span>
                </div>
                <p class="marker-author">
                  {{ row.updatedByName }} · {{ time(row.updatedAt) }}
                </p>
              </div>
            </section>
          </div>
          <details
            class="changes-panel"
            :open="w.showChanges"
            @toggle="w.showChanges = ($event.target as HTMLDetailsElement).open"
          >
            <summary>本次变化 <span class="muted">{{ w.historical.changes.length }}</span></summary>
            <section
              v-for="change in w.historical.changes"
              :key="change.annotationId"
              class="diff-card"
            >
              <button
                class="diff-card-header"
                :disabled="w.locked"
                @click="w.selectMarker(change.annotationId)"
              >
                <span
                  class="pill"
                  :class="change.kind === 'add' ? 'green' : change.kind === 'delete' ? 'red' : 'amber'"
                >{{ change.kind === 'add' ? '＋ 新增' : change.kind === 'delete' ? '− 删除' : '~ 修改' }}</span>
                <span>{{ change.kind === 'delete' ? '上一版 ' : '' }}#{{ w.changeLabel(change.annotationId, change.kind === 'delete') }}</span>
              </button>
              <div class="diff-content">
                <div
                  v-if="change.before"
                  class="diff-before"
                >
                  上一版 #{{ w.changeLabel(change.annotationId, true) }}：{{ change.before.note }}<p class="tiny">
                    {{ severityText(change.before.severity) }} · {{ change.before.size }}px
                  </p>
                </div>
                <div
                  v-if="change.after"
                  class="diff-after"
                >
                  本版 #{{ w.changeLabel(change.annotationId) }}：{{ change.after.note }}<p class="tiny">
                    {{ severityText(change.after.severity) }} · {{ change.after.size }}px
                  </p>
                </div>
              </div>
            </section>
            <p
              v-if="!w.historical.changes.length"
              class="small muted"
            >
              暂无变化
            </p>
          </details>
        </aside>
      </main>
    </template>
  </div>
  <ReviewMergeDialog
    :plan="w.merge"
    :choices="w.mergeChoices"
    :ready="w.mergeReady"
    :error="w.errorText"
    @choose="(id, choice) => w.mergeChoices[id] = choice"
    @cancel="w.cancelMerge"
    @apply="w.applyMerge"
  />
  <dialog
    ref="deleteDialog"
    class="review-dialog"
    aria-labelledby="delete-title"
    @cancel.prevent="w.cancelDelete"
  >
    <h2 id="delete-title">
      删除整张图片？
    </h2>
    <p class="wrap">
      {{ w.currentImage?.originalName }}
    </p>
    <p>原图、全部标记和所有保存版本都会删除，无法撤销。</p>
    <p v-if="w.copy.count()">
      本图还有 {{ w.copy.count() }} 项未保存修改；确认后本地草稿也会丢弃。
    </p>
    <p v-if="w.deletePending">
      删除请求已发出。若连接中断，请核实结果或用原请求重试；尚未确认前保留当前输入。
    </p>
    <p
      v-if="w.errorText"
      class="error"
      role="alert"
    >
      {{ w.errorText }}
    </p>
    <details v-if="w.errorRequestId">
      <summary>请求编号</summary><code>{{ w.errorRequestId }}</code>
    </details>
    <div class="row dialog-actions">
      <button
        class="btn"
        autofocus
        :disabled="w.busy || !!w.deletePending"
        @click="w.cancelDelete"
      >
        取消
      </button>
      <button
        v-if="w.deletePending"
        class="btn"
        :disabled="w.busy"
        @click="w.verifyDelete"
      >
        核实删除结果
      </button>
      <button
        class="btn danger"
        :disabled="w.busy"
        @click="w.deleteImage"
      >
        {{ w.busy ? '正在处理…' : w.deletePending ? '用原请求重试删除' : '确认删除整图' }}
      </button>
    </div>
  </dialog>
  <dialog
    ref="leaveDialog"
    class="review-dialog"
    aria-labelledby="leave-title"
    @cancel.prevent="w.resolveLeave('stay')"
  >
    <h2 id="leave-title">
      先处理本次修改
    </h2><p>有 {{ w.copy.count() }} 项尚未保存。保存成功后继续，或放弃本次更改。</p><div class="row dialog-actions">
      <button
        class="btn primary"
        :disabled="w.busy || w.draft.busy"
        @click="w.resolveLeave('save')"
      >
        {{ w.draft.pending ? '重试确认并继续' : '保存并继续' }}
      </button><button
        class="btn danger"
        :disabled="w.blocked"
        @click="w.resolveLeave('discard')"
      >
        放弃更改
      </button><button
        class="btn"
        autofocus
        :disabled="w.draft.busy"
        @click="w.resolveLeave('stay')"
      >
        留在当前
      </button>
    </div><p
      v-if="w.errorText"
      class="error"
      role="alert"
    >
      {{ w.errorText }}
    </p>
  </dialog>
</template>
