<script setup lang="ts">
/**
 * 子系统档案卡（设备资料面板用）
 *
 * 空子系统也照常显示（虚线灰卡 + 禁用），避免用户误以为「这台设备不属于任何系统」——
 * 实际含义是「该子系统下这条设备没有资料记录」。
 */
import { computed } from 'vue'

const props = defineProps<{
  name: string
  count: number
  tables: string[]
}>()

const emit = defineEmits<{
  (e: 'pick'): void
}>()

const isEmpty = computed(() => props.count === 0)
</script>

<template>
  <button
    type="button"
    class="dsc"
    :class="{ 'dsc--empty': isEmpty }"
    :disabled="isEmpty"
    :aria-label="isEmpty ? `${name}：暂无资料` : `查看 ${name} 的资料明细，共 ${count} 条`"
    @click="emit('pick')"
  >
    <span class="dsc__head">
      <span class="dsc__name ellipsis" :title="name">{{ name }}</span>
      <span class="dsc__count tnum">{{ count }}</span>
    </span>
    <span class="dsc__tables">
      <template v-if="isEmpty">暂无资料</template>
      <span v-for="table in props.tables.slice(0, 3)" :key="table" class="dsc__table ellipsis" :title="table">
        {{ table }}
      </span>
    </span>
  </button>
</template>

<style scoped>
.dsc {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.dsc:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--surface-2);
}

.dsc:disabled {
  cursor: default;
}

.dsc--empty {
  border-style: dashed;
  border-color: var(--border-soft);
  background: var(--surface-2);
}

.dsc__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.dsc__name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.dsc--empty .dsc__name {
  color: var(--muted);
}

.dsc__count {
  flex: 0 0 auto;
  font-size: var(--text-sm);
  font-weight: var(--weight-announce);
  color: var(--fg);
}

.dsc--empty .dsc__count {
  color: var(--meta);
}

.dsc__tables {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.dsc--empty .dsc__tables {
  color: var(--meta);
}

.dsc__table {
  min-width: 0;
}
</style>
