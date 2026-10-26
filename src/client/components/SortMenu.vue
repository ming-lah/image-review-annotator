<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue';

const props = defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>();
const options = [{ value: 'updated', label: '最近修改' }, { value: 'created', label: '最近上传' }, { value: 'name', label: '文件名称' }];
const id = useId();
const root = ref<HTMLElement>(); const trigger = ref<HTMLButtonElement>();
const open = ref(false); const active = ref(0);
async function focusOption() {
  await nextTick();
  root.value?.querySelector<HTMLButtonElement>(`[data-option="${active.value}"]`)?.focus();
}
function close(restore = true) { open.value = false; if (restore) trigger.value?.focus(); }
function choose(index: number) {
  if (props.disabled) return;
  emit('update:modelValue', options[index].value); emit('change'); close();
}
function toggle() {
  if (open.value) { close(); return; }
  active.value = Math.max(0, options.findIndex(option => option.value === props.modelValue));
  open.value = true; void focusOption();
}
function keydown(event: KeyboardEvent) {
  if (props.disabled) return;
  if (event.key === 'Escape' && open.value) { event.preventDefault(); event.stopPropagation(); close(); }
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    if (!open.value) { toggle(); return; }
    active.value = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active.value + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    void focusOption();
  } else if (event.key === 'Tab') close(false);
}
function outside(event: PointerEvent) { if (event.target instanceof Node && !root.value?.contains(event.target)) close(false); }
function focusout(event: FocusEvent) { if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) close(false); }
onMounted(() => window.addEventListener('pointerdown', outside));
onUnmounted(() => window.removeEventListener('pointerdown', outside));
</script>

<template>
  <div
    ref="root"
    class="sort-menu"
    @keydown="keydown"
    @focusout="focusout"
  >
    <button
      ref="trigger"
      class="btn sort-trigger"
      :disabled="disabled"
      aria-label="图片排序"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="id"
      @click="toggle"
    >
      {{ options.find(option => option.value === modelValue)?.label }}<span aria-hidden="true">⌄</span>
    </button>
    <div
      v-if="open"
      :id="id"
      class="sort-options"
      role="listbox"
      aria-label="图片排序"
    >
      <button
        v-for="(option, index) in options"
        :key="option.value"
        :data-option="index"
        role="option"
        :aria-selected="option.value === modelValue"
        :tabindex="active === index ? 0 : -1"
        @click="choose(index)"
      >
        {{ option.label }}<span
          v-if="option.value === modelValue"
          aria-hidden="true"
        >✓</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sort-menu{position:relative;flex:none}.sort-trigger{min-width:110px;justify-content:space-between}.sort-options{position:absolute;right:0;top:calc(100% + 7px);z-index:30;width:150px;max-width:calc(100vw - 32px);padding:5px;border:1px solid var(--line);border-radius:9px;background:var(--paper);box-shadow:0 8px 28px #203e2a20}.sort-options button{width:100%;padding:10px;display:flex;justify-content:space-between;border-radius:5px;font-size:12px;text-align:left}.sort-options button:hover,.sort-options button:focus-visible,.sort-options button[aria-selected=true]{background:var(--green-soft);color:var(--green)}
</style>
