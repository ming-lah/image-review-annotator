<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { pointInImage, type Point } from './review';
import type { EditorDraft, LocalMarker } from './review-session';
import { fitScale, imageOffset, scrollToPoint, stageCanvasSize, viewportCenter, wheelScale, zoomAtPosition, type ViewSnapshot } from './review-view';
import { createStageResize } from './stage-resize';

const props = defineProps<{
  image: { url: string; name: string; width: number; height: number };
  markers: LocalMarker[];
  draft: EditorDraft | null;
  selectedId: string | null;
  disabled: boolean;
  readOnly?: boolean;
  temporaryLabels?: boolean;
  status?: string;
}>();
const emit = defineEmits<{ place: [point: Point]; select: [id: string]; view: [snapshot: ViewSnapshot]; tool: [value: 'mouse' | 'point'] }>();
const stage = ref<HTMLDivElement>();
const imageElement = ref<HTMLImageElement>();
const viewport = ref({ width: 1, height: 1 });
const mode = ref<'fit' | 'manual'>('fit');
const manualScale = ref(1);
const tool = ref<'mouse' | 'point'>('mouse');
const panning = ref(false);
let gesture: { id: number; x: number; y: number; left: number; top: number; dragged: boolean } | undefined;
let suppressClick = false;
let zoomGeneration = 0;
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
  finishGesture();
  const generation = ++zoomGeneration;
  const anchor = center();
  if (value === 'fit') mode.value = 'fit';
  else { mode.value = 'manual'; manualScale.value = value; }
  await nextTick();
  if (generation === zoomGeneration) await reveal(anchor);
}
function beginGesture(event: PointerEvent) {
  suppressClick = false;
  if (props.disabled || event.button !== 0 || event.pointerType !== 'mouse' || !stage.value) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.value.scrollLeft, top: stage.value.scrollTop, dragged: false };
}
function moveGesture(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId || !stage.value) return;
  if (!(event.buttons & 1)) { finishGesture(); return; }
  const dx = event.clientX - gesture.x; const dy = event.clientY - gesture.y;
  if (Math.hypot(dx, dy) > 4) gesture.dragged = true;
  if (!gesture.dragged || tool.value !== 'mouse') return;
  if (!stage.value.hasPointerCapture(event.pointerId)) stage.value.setPointerCapture(event.pointerId);
  panning.value = true;
  stage.value.scrollTo({ left: gesture.left - dx, top: gesture.top - dy, behavior: 'instant' });
  event.preventDefault();
}
function finishGesture(event?: PointerEvent | Event) {
  if (event && 'pointerId' in event && gesture && event.pointerId !== gesture.id) return;
  const current = gesture; gesture = undefined; panning.value = false;
  if (!current) return;
  suppressClick = current.dragged || !event || event.type !== 'pointerup';
  if (stage.value?.hasPointerCapture(current.id)) stage.value.releasePointerCapture(current.id);
}
function guardClick(event: MouseEvent) {
  if (suppressClick && event.detail > 0) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
}
async function wheel(event: WheelEvent) {
  if (props.disabled || tool.value !== 'mouse' || !stage.value || event.deltaY === 0) return;
  event.preventDefault(); finishGesture();
  const generation = ++zoomGeneration;
  const rectangle = stage.value.getBoundingClientRect();
  const position = { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  const next = wheelScale(scale.value, event.deltaY, event.deltaMode, viewport.value.height);
  const scroll = zoomAtPosition(props.image, viewport.value, scale.value, next, { left: stage.value.scrollLeft, top: stage.value.scrollTop }, position, pixelRatio.value);
  mode.value = 'manual'; manualScale.value = next;
  await nextTick();
  if (generation === zoomGeneration) { stage.value?.scrollTo({ left: scroll.left, top: scroll.top, behavior: 'instant' }); emitView(); }
}
function place(event: MouseEvent) {
  if (props.disabled || props.readOnly || tool.value !== 'point' || !imageElement.value) return;
  const point = pointInImage(event.clientX, event.clientY, imageElement.value.getBoundingClientRect());
  if (point) emit('place', point);
}
function placeCenter() {
  if (!props.disabled && !props.readOnly && tool.value === 'point') emit('place', { x: 0.5, y: 0.5 });
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

watch([tool, () => props.disabled], () => finishGesture());
watch(tool, value => emit('tool', value), { immediate: true });
watch(() => props.readOnly, () => { tool.value = 'mouse'; finishGesture(); });
watch(() => props.image.url, () => { zoomGeneration++; finishGesture(); tool.value = 'mouse'; mode.value = 'fit'; manualScale.value = 1; void reveal({ x: 0.5, y: 0.5 }); });
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
  window.addEventListener('pointermove', moveGesture);
  window.addEventListener('pointerup', finishGesture);
  window.addEventListener('pointercancel', finishGesture);
  window.addEventListener('blur', finishGesture);
  stage.value?.addEventListener('wheel', wheel, { passive: false });
  resize.request();
});
onUnmounted(() => {
  zoomGeneration++; finishGesture(); observer?.disconnect(); resize?.dispose();
  window.removeEventListener('resize', windowResize); window.removeEventListener('pointermove', moveGesture); window.removeEventListener('pointerup', finishGesture); window.removeEventListener('pointercancel', finishGesture); window.removeEventListener('blur', finishGesture);
  stage.value?.removeEventListener('wheel', wheel);
});
defineExpose({ reveal, restoreView });
</script>

<template>
  <div class="preview-panel">
    <div
      class="view-toolbar"
      aria-label="图片视图工具"
    >
      <div
        class="mode-tools"
        role="group"
        aria-label="图片操作模式"
      >
        <button
          :aria-pressed="tool === 'mouse'"
          :disabled="disabled"
          aria-label="鼠标模式"
          @click="tool = 'mouse'"
        >
          鼠标
        </button>
        <button
          :aria-pressed="tool === 'point'"
          :disabled="disabled || readOnly"
          aria-label="打点模式"
          @click="tool = 'point'"
        >
          打点
        </button>
      </div>
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
      :data-tool="tool"
      :class="{ 'is-panning': panning }"
      aria-label="可滚动的图片舞台"
      @scroll="emitView"
      @pointerdown="beginGesture"
      @lostpointercapture="finishGesture"
      @click.capture="guardClick"
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
            :role="readOnly || tool === 'mouse' ? 'img' : 'button'"
            :tabindex="disabled ? -1 : 0"
            :aria-disabled="disabled"
            :aria-label="readOnly ? '历史版本图片' : tool === 'mouse' ? '浏览图片；拖动平移，滚轮缩放' : '点击图片新建标记；Enter 或空格在图片中心新建'"
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
    <div
      class="image-statusbar"
      role="status"
      aria-label="图片状态"
    >
      <span class="image-save-status">{{ status }}</span>
      <span>{{ image.width }} × {{ image.height }}</span>
    </div>
  </div>
</template>
