<script setup lang="ts">
/**
 * 供电 / 冷源链路徽标组（上游 / 下游）
 * 只展示设备名（缺失回落编号），完整编号走 title + `.mono`，
 * 徽标一律 `flex: 0 0 auto` 不被压缩（AS-10），长名单行省略。
 */
import type { PowerChainNode } from '@/types/asset'

const props = defineProps<{
  items: PowerChainNode[]
  tone: 'up' | 'down'
}>()
</script>

<template>
  <div v-if="props.items.length > 0" class="cc">
    <span
      v-for="node in props.items"
      :key="node.device_code"
      class="cc__chip"
      :class="`cc__chip--${props.tone}`"
      :title="node.device_code"
    >
      <span class="ellipsis">{{ node.name || node.device_code }}</span>
    </span>
  </div>
  <span v-else class="cc__none">无</span>
</template>

<style scoped>
.cc {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
}

.cc__chip {
  flex: 0 0 auto;
  max-width: 100%;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

/* 上游（取电来源）用中性实底区分于下游（中性浅底）；只靠底色深浅表达方向，不用彩色 */
.cc__chip--up {
  background: var(--surface-3);
}

.cc__chip--down {
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
}

.cc__none {
  font-size: var(--text-xs);
  color: var(--meta);
}
</style>
