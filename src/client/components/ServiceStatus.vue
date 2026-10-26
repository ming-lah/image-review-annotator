<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { errorSchema, readySchema } from '../../shared/contracts';
const state = ref<'checking' | 'ready' | 'unavailable'>('checking'); const requestId = ref('');
let active: AbortController | undefined;
async function check() {
  active?.abort(); const controller = new AbortController(); active = controller; state.value = 'checking'; requestId.value = '';
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/ready', { signal: controller.signal, cache: 'no-store' }); const body: unknown = await response.json();
    if (active !== controller) return;
    if (!response.ok) { const parsed = errorSchema.safeParse(body); if (parsed.success) requestId.value = parsed.data.error.requestId; throw new Error(); }
    readySchema.parse(body); state.value = 'ready';
  } catch { if (active === controller) state.value = 'unavailable'; } finally { clearTimeout(timer); }
}
onMounted(check); onUnmounted(() => { active?.abort(); active = undefined; });
</script>
<template>
  <section
    class="service-panel"
    aria-labelledby="service-heading"
  >
    <h2 id="service-heading">
      服务状态
    </h2>
    <p
      role="status"
      :class="state"
    >
      <span class="dot" />{{ state === 'checking' ? '检查中' : state === 'ready' ? '服务已就绪' : '服务不可用' }}
    </p>
    <p v-if="state === 'unavailable'">
      请确认后端正在运行。已有本地临时审阅仍可继续。
    </p><p
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
</template>
