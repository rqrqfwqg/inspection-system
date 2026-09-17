<script setup lang="ts">
/**
 * BA 问题清单（设备属性面板 / 设备详情抽屉 / 检索子视图共用）
 * 三处都要「状态 + 问题类型 + 位置」同一份口径，独立成组件避免三份漂移。
 * 状态色只表达状态（已闭环 / 处理中 / 待处理），不表达层级。
 */
import { WarningFilled } from '@element-plus/icons-vue'
import { fmtValue } from '@/lib/format'
import type { BaProblem } from '@/types/assetViz'

withDefaults(
  defineProps<{
    problems: BaProblem[]
    title?: string
    emptyText?: string
  }>(),
  { title: 'BA 问题', emptyText: '该对象暂无 BA 问题记录。' },
)

function statusTone(status?: unknown): 'success' | 'warning' | 'danger' {
  const s = String(status ?? '')
  if (s === 'closed') return 'success'
  if (s === 'processing') return 'warning'
  return 'danger'
}

function statusText(status?: unknown): string {
  const s = String(status ?? '')
  if (s === 'closed') return '已闭环'
  if (s === 'processing') return '处理中'
  if (!s) return '状态未知'
  return s
}

function where(p: BaProblem): string {
  return [fmtValue(p.location), fmtValue(p.group_area)].filter((x) => x !== '—').join(' · ')
}
</script>

<template>
  <section class="bap panel">
    <header class="panel-head">
      <h3 class="panel-title bap__title">
        <el-icon :size="16" class="bap__icon"><WarningFilled /></el-icon>
        {{ title }}（{{ problems.length }}）
      </h3>
    </header>

    <p v-if="problems.length === 0" class="bap__empty">{{ emptyText }}</p>
    <ul v-else class="bap__list">
      <li v-for="(p, i) in problems" :key="p.id ?? i" class="bap__item">
        <el-tag size="small" effect="light" :type="statusTone(p.status)">{{ statusText(p.status) }}</el-tag>
        <span class="bap__type">{{ fmtValue(p.problem_type) }}</span>
        <span v-if="where(p)" class="bap__where">{{ where(p) }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.bap {
  min-width: 0;
}

.bap__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.bap__icon {
  color: var(--warn);
}

.bap__empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.bap__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* 行内混排：状态 Tag 不被压缩，长位置文本可断行（AS-10） */
.bap__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border-soft);
  font-size: var(--text-sm);
}

.bap__list > :last-child {
  border-bottom: 0;
}

.bap__type {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--fg);
}

.bap__where {
  flex: 1 1 160px;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
  word-break: break-word;
}
</style>
