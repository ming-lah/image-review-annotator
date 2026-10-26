<script setup lang="ts">
import { ref } from 'vue';
import type { createReviewSession, LocalMarker } from '../review-session';
import type { Severity } from '../../shared/review-contracts';
defineProps<{ review: ReturnType<typeof createReviewSession>['state']; locked: boolean; uploaded: boolean; localDraft: boolean; noteStatus: string }>();
const emit = defineEmits<{ select: [id: string, toggle: boolean]; edit: [id: string]; remove: [id: string]; collapse: []; save: []; cancel: []; saveMarker: [marker: LocalMarker]; note: [value: string]; severity: [value: Severity] }>();
const editor = ref<HTMLTextAreaElement>(); const list = ref<HTMLDivElement>();
const severityName = (value?: Severity) => ({ low: '低', medium: '中', high: '高' })[value ?? 'medium'];
defineExpose({ editor, list });
</script>
<template>
  <aside
    class="review-sidebar"
    aria-label="标记列表和说明"
  >
    <div class="list-heading">
      <h3>标记</h3><button
        v-if="review.expandedIds.length"
        class="text-button"
        :disabled="locked"
        @click="emit('collapse')"
      >
        收起全部
      </button>
    </div>
    <div
      ref="list"
      class="marker-list"
      tabindex="-1"
      aria-label="标记列表"
    >
      <p
        v-if="!review.markers.length"
        class="muted"
      >
        还没有标记。点击图片，填写说明后{{ uploaded ? '保存' : '添加临时标记' }}。
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
          @click="emit('select', marker.id, true)"
        >
          <span class="marker-label">{{ marker.saved ? `#${marker.saved.number}` : `临时 ${marker.label} · 未保存` }}</span>
          <span
            v-if="review.selectedId === marker.id"
            class="selected-label"
          >已选中</span><span
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
          </p><p class="muted">
            严重程度：{{ severityName(marker.severity) }} · 位置 {{ (marker.x * 100).toFixed(1) }}% / {{ (marker.y * 100).toFixed(1) }}%
          </p>
          <template v-if="marker.saved">
            <p class="muted">
              创建：{{ marker.saved.createdByName }} · {{ new Date(marker.saved.createdAt).toLocaleString() }}
            </p><p class="muted">
              最后修改：{{ marker.saved.updatedByName }} · {{ new Date(marker.saved.updatedAt).toLocaleString() }} · v{{ marker.saved.version }}
            </p>
          </template>
          <div class="toolbar">
            <button
              v-if="uploaded && !marker.saved"
              :disabled="locked || review.draft?.id === marker.id"
              @click="emit('saveMarker', marker)"
            >
              保存此条
            </button>
            <button
              class="secondary"
              :disabled="locked"
              @click="emit('edit', marker.id)"
            >
              编辑说明
            </button><button
              class="danger-secondary"
              :disabled="locked || review.selectedId !== marker.id"
              @click="emit('remove', marker.id)"
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
        {{ review.draft.id ? '编辑说明' : '新增标记' }}{{ uploaded && !localDraft ? ' · 尚未保存' : ' · 本地临时' }}
      </h3>
      <p class="muted">
        位置 {{ (review.draft.x * 100).toFixed(1) }}% / {{ (review.draft.y * 100).toFixed(1) }}%
      </p><label for="draft-note">问题说明</label>
      <textarea
        id="draft-note"
        ref="editor"
        :value="review.draft.note"
        rows="5"
        :disabled="locked"
        :aria-invalid="noteStatus !== 'valid'"
        aria-describedby="note-status"
        placeholder="描述这里需要调整的问题…"
        @input="emit('note', ($event.target as HTMLTextAreaElement).value)"
      />
      <p
        id="note-status"
        aria-live="polite"
        :class="{ error: noteStatus !== 'valid' }"
      >
        {{ noteStatus === 'empty' ? '说明不能为空' : noteStatus === 'too-long' ? '说明最多 2000 字符' : '说明有效，尚未保存' }}（{{ review.draft.note.trim().length }} / 2000）
      </p>
      <label for="severity">严重程度</label><select
        id="severity"
        :value="review.draft.severity ?? 'medium'"
        :disabled="locked"
        @change="emit('severity', ($event.target as HTMLSelectElement).value as Severity)"
      >
        <option value="low">
          低
        </option><option value="medium">
          中
        </option><option value="high">
          高
        </option>
      </select>
      <div class="toolbar">
        <button
          :disabled="locked || noteStatus !== 'valid'"
          @click="emit('save')"
        >
          {{ uploaded && !localDraft ? (review.draft.id ? '保存修改' : '保存标记') : (review.draft.id ? '应用临时修改' : '添加临时标记') }}
        </button><button
          class="secondary"
          :disabled="locked"
          @click="emit('cancel')"
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
</template>
