<script setup lang="ts">
import type { UploadSummary } from '../state/upload-queue';
defineProps<{ summary: UploadSummary; running: boolean; busy: boolean; error: string }>();
const emit = defineEmits<{ retry: [id: string]; abandon: [id: string] }>();
</script>

<template>
  <section
    v-if="running || error || summary.issues.length"
    class="upload-feedback"
    aria-label="上传状态"
    :aria-busy="running"
  >
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <template v-else>
      <div
        class="upload-overview"
        role="status"
      >
        <span v-if="summary.unknown">{{ summary.success }} 张成功，1 项结果未确认，后续上传已暂停</span>
        <span v-else-if="running">正在上传 {{ summary.completed }} / {{ summary.total }}</span>
        <span v-else>上传完成：{{ summary.success }} 张成功，{{ summary.failed }} 张失败{{ summary.abandoned ? `，${summary.abandoned} 项已放弃等待` : '' }}</span>
        <template v-if="summary.unknown">
          <button
            class="btn"
            :disabled="running || busy"
            @click="emit('retry', summary.unknown.id)"
          >
            用原文件确认结果
          </button>
          <button
            class="btn subtle"
            :disabled="running || busy"
            @click="emit('abandon', summary.unknown.id)"
          >
            放弃等待并继续
          </button>
        </template>
      </div>
      <details
        v-if="summary.issues.length"
        class="upload-issues"
      >
        <summary>查看问题（{{ summary.issues.length }}）</summary>
        <ul>
          <li
            v-for="item in summary.issues"
            :key="item.id"
          >
            <span class="wrap">{{ item.file.name }}</span>
            <p class="wrap">
              {{ item.message }}
            </p>
            <details v-if="item.requestId">
              <summary>请求编号</summary><code>{{ item.requestId }}</code>
            </details>
            <button
              v-if="item.status === 'failed'"
              class="btn"
              :disabled="running || busy || !!summary.unknown"
              @click="emit('retry', item.id)"
            >
              重试本项
            </button>
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>
