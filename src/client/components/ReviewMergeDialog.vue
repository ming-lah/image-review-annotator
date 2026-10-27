<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { WorkingMarker } from '../../shared/workbench-contracts';
import type { MergeChoice, ReviewMerge } from '../state/review-merge';

const props = defineProps<{ plan: ReviewMerge | null; choices: Record<string, MergeChoice | undefined>; ready: boolean; error: string }>();
const emit = defineEmits<{ cancel: []; apply: []; choose: [id: string, choice: MergeChoice] }>();
const dialog = ref<HTMLDialogElement>(); let previousFocus: HTMLElement | null = null;
function captureFocus() { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; }
function focusable(element: HTMLElement | null): element is HTMLElement {
  return !!element?.isConnected && element !== document.body && !!element.getClientRects().length && !element.matches(':disabled') && !element.closest('[inert]');
}
defineExpose({ captureFocus });
const version = computed(() => props.plan?.latest.revision.versionNumber ? `V${props.plan.latest.revision.versionNumber}` : '原始记录');
const describe = (row: WorkingMarker | null) => row ? `${row.note || '（说明尚未填写）'}\n严重程度：${({ low: '低', medium: '中', high: '高' })[row.severity]} · 大小：${row.size ?? 24}px` : '已删除 / 不存在';
watch(() => props.plan, async value => {
  await nextTick();
  if (value) dialog.value?.showModal();
  else {
    dialog.value?.close();
    // Let the parent unlock controls before restoring focus to the original trigger.
    await nextTick();
    if (props.plan) return;
    const target = focusable(previousFocus) ? previousFocus : document.querySelector<HTMLElement>('[data-merge-return]');
    if (focusable(target)) target.focus();
    previousFocus = null;
  }
});
</script>

<template>
  <dialog
    ref="dialog"
    class="review-dialog merge-dialog"
    aria-labelledby="merge-title"
    @cancel.prevent="emit('cancel')"
  >
    <template v-if="plan">
      <h2 id="merge-title">
        核对最新内容
      </h2>
      <p class="wrap">
        最新 {{ version }} · {{ plan.latest.revision.username }}
      </p>
      <p>你的 {{ plan.localChanges }} 项修改与远端 {{ plan.remoteChanges }} 项修改已比较；独立修改会一起保留。</p>
      <p v-if="!plan.conflicts.length">
        没有需要选择的冲突。应用后请检查工作台，再点击保存。
      </p>
      <section
        v-for="(conflict, index) in plan.conflicts"
        :key="conflict.id"
        class="merge-conflict"
      >
        <h3>冲突 {{ index + 1 }} · {{ !conflict.theirs ? '对方已删除' : !conflict.mine ? '你准备删除，对方已修改' : '双方修改不同' }}</h3>
        <div class="merge-values">
          <details>
            <summary>原内容</summary><p class="wrap">
              {{ describe(conflict.before) }}
            </p>
          </details>
          <div>
            <strong>我的修改</strong><p class="wrap">
              {{ describe(conflict.mine) }}
            </p>
          </div>
          <div>
            <strong>最新内容</strong><p class="wrap">
              {{ describe(conflict.theirs) }}
            </p>
          </div>
        </div>
        <fieldset class="merge-options">
          <legend>选择这条标记的处理方式</legend>
          <label><input
            type="radio"
            :name="`merge-${conflict.id}`"
            :checked="choices[conflict.id] === 'theirs'"
            @change="emit('choose', conflict.id, 'theirs')"
          >{{ conflict.theirs ? '采用最新内容' : '接受删除' }}</label>
          <label><input
            type="radio"
            :name="`merge-${conflict.id}`"
            :checked="choices[conflict.id] === (conflict.recreate ? 'recreate' : 'mine')"
            @change="emit('choose', conflict.id, conflict.recreate ? 'recreate' : 'mine')"
          >{{ conflict.recreate ? '将我的内容另建为新标记' : conflict.mine ? '采用我的整条修改' : '确认删除最新标记' }}</label>
        </fieldset>
      </section>
      <p
        v-if="error"
        class="error wrap"
        role="alert"
      >
        {{ error }}
      </p>
      <p class="small muted">
        应用不会立即保存。取消会保留原草稿；保存时仍会检查是否又有人更新。
      </p>
      <div class="row dialog-actions">
        <button
          class="btn"
          autofocus
          @click="emit('cancel')"
        >
          取消核对
        </button>
        <button
          class="btn primary"
          :disabled="!ready"
          @click="emit('apply')"
        >
          应用核对结果
        </button>
      </div>
    </template>
  </dialog>
</template>
