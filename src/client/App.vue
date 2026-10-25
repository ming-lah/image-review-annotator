<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { readySchema, errorSchema } from '../shared/contracts';

const state = ref<'checking' | 'ready' | 'unavailable'>('checking');
const requestId = ref('');
let controller: AbortController | undefined;
async function check() {
  controller?.abort();
  controller = new AbortController();
  const active = controller;
  state.value = 'checking';
  requestId.value = '';
  const timer = setTimeout(() => active.abort(), 5000);
  try {
    const response = await fetch('/api/ready', { signal: active.signal, cache: 'no-store' });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(body);
      if (parsed.success) requestId.value = parsed.data.error.requestId;
      throw new Error('Unavailable');
    }
    readySchema.parse(body);
    state.value = 'ready';
  } catch { state.value = 'unavailable'; }
  finally { clearTimeout(timer); }
}
onMounted(check);
onUnmounted(() => controller?.abort());
</script>

<template>
  <main>
    <p class="eyebrow">
      IMAGE REVIEW ANNOTATOR · P0–P1
    </p>
    <h1>审图打点</h1>
    <p class="intro">
      为图片审阅建立一个清晰的起点。
    </p>
    <section aria-labelledby="service-heading">
      <h2 id="service-heading">
        服务状态
      </h2>
      <p
        role="status"
        aria-live="polite"
        :class="state"
      >
        <span class="dot" />
        {{ state === 'checking' ? '检查中' : state === 'ready' ? '服务已就绪' : '服务不可用' }}
      </p>
      <p v-if="state === 'unavailable'">
        请确认后端正在运行，然后重试。
      </p>
      <p
        v-if="requestId"
        class="request-id"
      >
        请求编号：{{ requestId }}
      </p>
      <button
        :disabled="state === 'checking'"
        @click="check"
      >
        {{ state === 'checking' ? '正在检查…' : '重新检查' }}
      </button>
    </section>
    <aside>图片标注功能尚未实现。当前版本仅用于验证应用启动与服务连接。</aside>
  </main>
</template>
