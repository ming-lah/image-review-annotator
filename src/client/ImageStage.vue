<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { pointInImage, type Point } from './review';
import type { EditorDraft, LocalMarker } from './review-session';
import { fitScale, imageOffset, scrollToPoint, stagePadding, stepScale, viewportCenter, type ViewSnapshot } from './review-view';

const props = defineProps<{
  image: { url: string; name: string; width: number; height: number };
  markers: LocalMarker[];
  draft: EditorDraft | null;
  selectedId: string | null;
  disabled: boolean;
}>();
const emit = defineEmits<{ place: [point: Point]; select: [id: string]; view: [snapshot: ViewSnapshot] }>();
const stage = ref<HTMLDivElement>();
const imageElement = ref<HTMLImageElement>();
const viewport = ref({ width: 1, height: 1 });
const mode = ref<'fit' | 'manual'>('fit');
const manualScale = ref(1);
const markerSize = ref(24);
const scale = computed(() => mode.value === 'fit' ? fitScale(props.image, viewport.value) : manualScale.value);
const rendered = computed(() => ({ width: props.image.width * scale.value, height: props.image.height * scale.value }));
const offset = computed(() => imageOffset(props.image, viewport.value, scale.value));
const canvasStyle = computed(() => ({ width: `${Math.max(viewport.value.width, rendered.value.width + stagePadding * 2)}px`, height: `${Math.max(viewport.value.height, rendered.value.height + stagePadding * 2)}px` }));
const surfaceStyle = computed(() => ({ width: `${rendered.value.width}px`, height: `${rendered.value.height}px`, left: `${offset.value.x}px`, top: `${offset.value.y}px` }));
let observer: ResizeObserver | undefined;
let restoring = false;

function center(): Point {
  return viewportCenter(props.image, viewport.value, scale.value, { left: stage.value?.scrollLeft ?? 0, top: stage.value?.scrollTop ?? 0 });
}
async function reveal(point: Point) {
  await nextTick();
  const scroll = scrollToPoint(point, props.image, viewport.value, scale.value);
  stage.value?.scrollTo({ left: scroll.left, top: scroll.top, behavior: 'instant' });
}
async function zoom(value: number | 'fit') {
  if (props.disabled) return;
  const anchor = center();
  if (value === 'fit') mode.value = 'fit';
  else { mode.value = 'manual'; manualScale.value = value; }
  await reveal(anchor);
}
function place(event: MouseEvent) {
  if (props.disabled || !imageElement.value) return;
  const point = pointInImage(event.clientX, event.clientY, imageElement.value.getBoundingClientRect());
  if (point) emit('place', point);
}
function placeCenter() {
  if (!props.disabled) emit('place', { x: 0.5, y: 0.5 });
}
function select(id: string) { if (!props.disabled) emit('select', id); }
function emitView() {
  if (!restoring) emit('view', { mode: mode.value, manualScale: manualScale.value, markerSize: markerSize.value, anchor: center() });
}
async function restoreView(snapshot: ViewSnapshot) {
  restoring = true;
  if (stage.value) viewport.value = { width: stage.value.clientWidth, height: stage.value.clientHeight };
  mode.value = snapshot.mode;
  manualScale.value = snapshot.manualScale;
  markerSize.value = snapshot.markerSize;
  await reveal(snapshot.anchor);
  restoring = false;
  emitView();
}
watch([mode, manualScale, markerSize], async () => { await nextTick(); emitView(); });

watch(() => props.image.url, () => { mode.value = 'fit'; manualScale.value = 1; void reveal({ x: 0.5, y: 0.5 }); });
onMounted(() => {
  observer = new ResizeObserver(() => {
    const anchor = center();
    if (!stage.value) return;
    viewport.value = { width: stage.value.clientWidth, height: stage.value.clientHeight };
    void reveal(anchor);
  });
  if (stage.value) observer.observe(stage.value);
});
onUnmounted(() => observer?.disconnect());
defineExpose({ reveal, restoreView });
</script>

<template>
  <div class="preview-panel">
    <div
      class="view-toolbar"
      aria-label="图片视图工具"
    >
      <button
        class="secondary"
        :disabled="disabled || (mode === 'manual' && scale <= 0.1)"
        aria-label="缩小图片"
        @click="zoom(stepScale(scale, -1))"
      >
        −
      </button>
      <output
        class="zoom-value"
        aria-live="polite"
      >{{ (scale * 100).toFixed(1) }}%{{ mode === 'fit' ? ' · 适应' : '' }}</output>
      <button
        class="secondary"
        :disabled="disabled || scale >= 4"
        aria-label="放大图片"
        @click="zoom(stepScale(scale, 1))"
      >
        +
      </button>
      <button
        class="secondary"
        :disabled="disabled"
        @click="zoom(1)"
      >
        100%
      </button>
      <button
        class="secondary"
        :disabled="disabled"
        @click="zoom('fit')"
      >
        适应视口
      </button>
      <label class="marker-size">标记大小
        <input
          v-model.number="markerSize"
          type="range"
          min="12"
          max="48"
          step="2"
          :disabled="disabled"
        >
        <output>{{ markerSize }} px</output>
      </label>
    </div>
    <div
      ref="stage"
      class="image-stage"
      aria-label="可滚动的图片舞台"
      @scroll="emitView"
    >
      <div
        class="stage-canvas"
        :style="canvasStyle"
      >
        <div
          class="image-surface"
          :style="surfaceStyle"
        >
          <img
            ref="imageElement"
            :src="image.url"
            :alt="image.name"
            :width="image.width"
            :height="image.height"
            draggable="false"
            role="button"
            :tabindex="disabled ? -1 : 0"
            :aria-disabled="disabled"
            aria-label="点击图片新建标记；Enter 或空格在图片中心新建"
            @click="place"
            @keydown.enter.prevent="placeCenter"
            @keydown.space.prevent="placeCenter"
          >
          <svg
            class="marker-overlay"
            aria-label="临时标记"
          >
            <g
              v-for="marker in markers"
              :key="marker.id"
              class="marker"
              :class="{ selected: selectedId === marker.id }"
              :transform="`translate(${marker.x * rendered.width}, ${marker.y * rendered.height})`"
              role="button"
              :tabindex="disabled ? -1 : 0"
              :aria-disabled="disabled"
              :aria-label="`选择临时标记 ${marker.label}`"
              :aria-pressed="selectedId === marker.id"
              @click.stop="select(marker.id)"
              @keydown.enter.stop.prevent="select(marker.id)"
              @keydown.space.stop.prevent="select(marker.id)"
            >
              <circle
                class="marker-hit"
                :r="Math.max(12, markerSize / 2)"
              />
              <circle
                class="marker-dot"
                :r="markerSize / 2"
              />
              <text
                dy=".35em"
                text-anchor="middle"
                :style="{ fontSize: `${Math.max(9, markerSize * 0.45)}px` }"
              >{{ marker.label }}</text>
            </g>
            <g
              v-if="draft"
              class="marker draft-marker"
              :transform="`translate(${draft.x * rendered.width}, ${draft.y * rendered.height})`"
              aria-hidden="true"
            >
              <circle
                class="marker-dot"
                :r="markerSize / 2"
              />
              <text
                dy=".35em"
                text-anchor="middle"
                :style="{ fontSize: `${Math.max(9, markerSize * 0.6)}px` }"
              >✎</text>
            </g>
          </svg>
        </div>
      </div>
    </div>
    <p class="muted">
      点击图片新建；点击已有点选择。可滚动查看大图，键盘 Enter / 空格在原图中心新建。标记位置与大小独立。
    </p>
  </div>
</template>
