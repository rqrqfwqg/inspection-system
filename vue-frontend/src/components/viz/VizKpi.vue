<script setup lang="ts">
/**
 * 指标卡（概览 / 联动中心共用）
 * 为什么独立成组件：React 版 Overview 与 LinkCenter 各写了一份几乎相同的
 * MetricCard / StatCard，口径（数字格式、加载骨架、副文案位置）一旦漂移就
 * 会出现「同一个数两处显示不同」。
 *
 * 纪律：数值文本由调用方用 `@/lib/format` 生成（本组件不做格式化）；
 * 骨架与数字**同高层**，避免 loading → 数据切换时高度跳变（防 CLS）。
 */
import type { Component } from 'vue'

defineProps<{
  icon: Component
  label: string
  /** 已格式化好的数值文本（走 lib/format） */
  value: string
  tone?: 'slate' | 'accent' | 'success' | 'warn'
  loading?: boolean
}>()
</script>

<template>
  <div class="kpi panel">
    <p class="kpi__head">
      <span class="kpi__icon" :class="`kpi__icon--${tone ?? 'slate'}`">
        <el-icon :size="16"><component :is="icon" /></el-icon>
      </span>
      <span class="kpi__label">{{ label }}</span>
    </p>
    <el-skeleton v-if="loading" class="kpi__skeleton" animated :rows="1" />
    <p v-else class="kpi__value tnum">{{ value }}</p>
    <p v-if="$slots.default" class="kpi__sub">
      <slot />
    </p>
  </div>
</template>

<style scoped>
.kpi {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.kpi__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.kpi__icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}

.kpi__icon--slate {
  background: var(--surface-3);
  color: var(--fg-2);
}

.kpi__icon--accent {
  background: var(--accent-soft);
  color: var(--accent);
}

.kpi__icon--success {
  background: var(--success-bg);
  color: var(--success-fg);
}

.kpi__icon--warn {
  background: var(--warn-bg);
  color: var(--warn-fg);
}

.kpi__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kpi__value {
  margin: 0;
  font-size: var(--text-3xl);
  line-height: var(--leading-tight);
  font-weight: var(--weight-announce);
  color: var(--fg);
}

.kpi__skeleton {
  padding: var(--space-1) 0;
}

.kpi__sub {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}
</style>
