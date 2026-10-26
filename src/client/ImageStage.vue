<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { pointInImage, type Point } from './review';
import type { EditorDraft, LocalMarker } from './review-session';
import { fitScale, imageOffset, scrollToPoint, stageCanvasSize, viewportCenter, type ViewSnapshot } from './review-view';
import { createStageResize } from './stage-resize';

const props = defineProps<{
  image: { url: string; name: string; width: number; height: number };
  markers: LocalMarker[];
  draft: EditorDraft | null;
  selectedId: string | null;
  disabled: boolean;
  readOnly?: boolean;
  temporaryLabels?: boolean;
}>();
const emit = defineEmits<{ place: [point: Point]; select: [id: string]; view: [snapshot: ViewSnapshot] }>();
const stage = ref<HTMLDivElement>();
const imageElement = ref<HTMLImageElement>();
const viewport = ref({ width: 1, height: 1 });
const mode = ref<'fit' | 'manual'>('fit');
const manualScale = ref(1);
const pixelRatio = ref(1);
const markerSize = (marker: LocalMarker) => marker.size ?? 24;
const scale = computed(() => mode.value === 'fit' ? fitScale(props.image, viewport.value) : manualScale.value);
const rendered = computed(() => ({ width: props.image.width * scale.value, height: props.image.height * scale.value }));
const offset = computed(() => imageOffset(props.image, viewport.value, scale.value, pixelRatio.value));
const canvasStyle = computed(() => { const size = stageCanvasSize(props.image, viewport.value, scale.value); return { width: `${size.width}px`, height: `${size.height}px` }; });
const surfaceStyle = computed(() => ({ width: `${rendered.value.width}px`, height: `${rendered.value.height}px`, left: `${offset.value.x}px`, top: `${offset.value.y}px` }));
let observer: ResizeObserver | undefined;
let restoring = false;
let resize: ReturnType<typeof createStageResize> | undefined;
let observedSize: { width: number; height: number } | undefined;
function measureViewport() {
  const visible = !!stage.value?.clientWidth && !!stage.value.clientHeight;
  if (!visible) return { width: 0, height: 0 };
  // contentRect retains fractional content-box sizes; rounded clientWidth can exceed the real box.
  return { width: Math.floor(observedSize?.width || stage.value!.clientWidth), height: Math.floor(observedSize?.height || stage.value!.clientHeight) };
}

function center(): Point {
  return viewportCenter(props.image, viewport.value, scale.value, { left: stage.value?.scrollLeft ?? 0, top: stage.value?.scrollTop ?? 0 }, pixelRatio.value);
}
async function reveal(point: Point) {
  await nextTick();
  const scroll = scrollToPoint(point, props.image, viewport.value, scale.value, pixelRatio.value);
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
  if (props.disabled || props.readOnly || !imageElement.value) return;
  const point = pointInImage(event.clientX, event.clientY, imageElement.value.getBoundingClientRect());
  if (point) emit('place', point);
}
function placeCenter() {
  if (!props.disabled && !props.readOnly) emit('place', { x: 0.5, y: 0.5 });
}
function select(id: string) { if (!props.disabled) emit('select', id); }
function emitView() {
  if (!restoring && stage.value?.clientWidth && stage.value.clientHeight) emit('view', { mode: mode.value, manualScale: manualScale.value, markerSize: 24, anchor: center() });
}
async function restoreView(snapshot: ViewSnapshot) {
  restoring = true;
  const size = measureViewport();
  if (size.width > 0 && size.height > 0) viewport.value = size;
  mode.value = snapshot.mode;
  manualScale.value = snapshot.manualScale;
  await reveal(snapshot.anchor);
  restoring = false;
  emitView();
}
watch([mode, manualScale], async () => { await nextTick(); emitView(); });

watch(() => props.image.url, () => { mode.value = 'fit'; manualScale.value = 1; void reveal({ x: 0.5, y: 0.5 }); });
function windowResize() { pixelRatio.value = window.devicePixelRatio || 1; resize?.request(); }
onMounted(() => {
  pixelRatio.value = window.devicePixelRatio || 1;
  resize = createStageResize(measureViewport, size => {
    if (size.width === viewport.value.width && size.height === viewport.value.height) return;
    const anchor = center();
    viewport.value = size;
    if (mode.value === 'fit') stage.value?.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    else void reveal(anchor);
  });
  observer = new ResizeObserver(entries => {
    const entry = entries.find(value => value.target === stage.value);
    if (entry) observedSize = { width: entry.contentRect.width, height: entry.contentRect.height };
    resize?.request();
  });
  if (stage.value) observer.observe(stage.value);
  window.addEventListener('resize', windowResize);
  resize.request();
});
onUnmounted(() => { observer?.disconnect(); resize?.dispose(); window.removeEventListener('resize', windowResize); });
defineExpose({ reveal, restoreView });
</script>

<template>
  <div class="preview-panel">
    <div
      class="view-toolbar"
      aria-label="图片视图工具"
    >
      <label class="zoom-slider">
        <span>缩放</span>
        <input
          type="range"
          min="10"
          max="400"
          step="1"
          :value="Math.min(400, Math.max(10, scale * 100))"
          :disabled="disabled"
          aria-label="图片缩放比例"
          :aria-valuetext="`${(scale * 100).toFixed(1)}%${mode === 'fit' ? '，适应' : ''}`"
          @input="zoom(Number(($event.target as HTMLInputElement).value) / 100)"
        >
      </label>
      <output class="zoom-value">{{ (scale * 100).toFixed(1) }}%{{ mode === 'fit' ? ' · 适应' : '' }}</output>
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
            :class="{ 'read-only-image': readOnly }"
            :alt="image.name"
            :width="image.width"
            :height="image.height"
            draggable="false"
            :role="readOnly ? 'img' : 'button'"
            :tabindex="disabled || readOnly ? -1 : 0"
            :aria-disabled="disabled"
            :aria-label="readOnly ? '历史版本图片' : '点击图片新建标记；Enter 或空格在图片中心新建'"
            @click="place"
            @keydown.enter.prevent="placeCenter"
            @keydown.space.prevent="placeCenter"
          >
          <svg
            class="marker-overlay"
            aria-label="图片标记"
          >
            <g
              v-for="marker in markers"
              :key="marker.id"
              class="marker"
              :class="{ selected: selectedId === marker.id, temporary: !marker.saved, 'history-add': marker.change === 'add', 'history-modify': marker.change === 'modify', 'history-delete': marker.change === 'delete', inherited: marker.change === 'inherited' }"
              :transform="`translate(${marker.x * rendered.width}, ${marker.y * rendered.height})`"
              role="button"
              :tabindex="disabled ? -1 : 0"
              :aria-disabled="disabled"
              :aria-label="marker.change === 'delete' ? `上一版标记 ${marker.label}，已删除` : `选择标记 ${marker.label}`"
              :aria-pressed="selectedId === marker.id"
              @click.stop="select(marker.id)"
              @keydown.enter.stop.prevent="select(marker.id)"
              @keydown.space.stop.prevent="select(marker.id)"
            >
              <circle
                class="marker-hit"
                :r="Math.max(12, markerSize(marker) / 2)"
              />
              <circle
                class="marker-dot"
                :r="markerSize(marker) / 2"
              />
              <text
                dy=".35em"
                text-anchor="middle"
                :style="{ fontSize: `${Math.max(9, markerSize(marker) * 0.45)}px` }"
              >{{ marker.change === 'delete' ? '−' : marker.label }}</text>
            </g>
            <g
              v-if="draft"
              class="marker draft-marker"
              :transform="`translate(${draft.x * rendered.width}, ${draft.y * rendered.height})`"
              aria-hidden="true"
            >
              <circle
                class="marker-dot"
                :r="12"
              />
              <text
                dy=".35em"
                text-anchor="middle"
                :style="{ fontSize: '14px' }"
              >✎</text>
            </g>
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>
