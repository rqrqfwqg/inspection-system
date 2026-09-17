<script setup lang="ts">
/**
 * 通用键值列表渲染器（设备属性 / 资料记录 / 固资档案 / 配件共用）
 *
 * 纪律：
 *  - 后端资料表的字段名由 `field_defs` 动态决定，未冻结 → 按原始 key 展示，
 *    不猜语义、不擅自改中文名（中文名映射见 `fieldLabel()`，仅台账已知字段可用）。
 *  - 取值格式化**只走** `@/lib/format#fmtValue`（全站唯一口径，禁止各组件自写）。
 *  - 空值由 `hasDisplayValue` 判定后过滤，不渲染「—」占位行。
 *  - 编号类字段（*_code / tag）强制断行不省略（.code-break）——编号少一位就查不到。
 */
import { computed } from 'vue'
import { fmtValue, hasDisplayValue, isCodeLike } from '@/lib/format'

const props = withDefaults(
  defineProps<{
    data?: Record<string, unknown> | null
    emptyText?: string
    /** 期望列数（1-3；窄容器一律传 1） */
    columns?: number
  }>(),
  { data: null, emptyText: '无', columns: 2 },
)

const entries = computed(() =>
  Object.entries(props.data ?? {}).filter(([, v]) => hasDisplayValue(v)),
)

/** 列数收敛到 1-3 并落到 class，避免内联样式（模板不写魔法数字） */
const colsClass = computed(() => `fl--${Math.min(3, Math.max(1, Math.round(props.columns)))}`)
</script>

<template>
  <p v-if="entries.length === 0" class="fl__empty">{{ emptyText }}</p>
  <dl v-else class="fl" :class="colsClass">
    <div v-for="[key, value] in entries" :key="key" class="fl__item">
      <dt class="fl__key ellipsis" :title="key">{{ key }}</dt>
      <dd class="fl__val" :class="{ 'code-break': isCodeLike(key) }">{{ fmtValue(value) }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.fl {
  display: grid;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  min-width: 0;
}

.fl--1 {
  grid-template-columns: minmax(0, 1fr);
}

.fl--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.fl--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.fl__item {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border-soft);
}

.fl__key {
  flex: 0 0 auto;
  width: 96px;
  font-size: var(--text-xs);
  color: var(--muted);
}

.fl__val {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg);
  word-break: break-word;
}

.fl__empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

/* 窄档（≤1279）：长表单/描述列表收成单列，避免半列宽把编号挤断成不可读 */
@media (max-width: 1279px) {
  .fl--2,
  .fl--3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
