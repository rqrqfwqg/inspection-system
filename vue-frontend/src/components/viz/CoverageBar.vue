<script setup lang="ts">
/**
 * 覆盖率 / 占比条（概览的子系统覆盖、资料表明细、联动中心的来源对照共用）
 * 为什么用条而不是图表：本页既有约定是「数据表 + 覆盖率条」，保证每个数字都能被
 * 逐行核对；柱状图反而制造「看着差不多」的错觉。
 *
 * 颜色只走 Token；占比用阈值分档（≥95% 绿 / ≥60% 青 / >0 橙 / 0 灰）表达「是否健康」。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 0..1 的占比（越界自动夹取） */
    value: number
    /** auto=按阈值分档；accent=主色；muted=中性（联动中心的自动/人工对照用） */
    tone?: 'auto' | 'accent' | 'muted'
    /** 是否显示右侧百分比 */
    percent?: boolean
    /** 百分比右侧的补充说明（如「已关联」） */
    note?: string
  }>(),
  { tone: 'auto', percent: true, note: '' },
)

const ratio = computed(() => Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0)))
const percentText = computed(() => `${Math.round(ratio.value * 100)}%`)
const toneClass = computed(() => {
  if (props.tone === 'accent') return 'cbar__fill--accent'
  if (props.tone === 'muted') return 'cbar__fill--muted'
  const r = ratio.value
  if (r >= 0.95) return 'cbar__fill--ok'
  if (r >= 0.6) return 'cbar__fill--mid'
  if (r > 0) return 'cbar__fill--low'
  return 'cbar__fill--none'
})
</script>

<template>
  <div class="cbar">
    <div class="cbar__track">
      <div class="cbar__fill" :class="toneClass" :style="{ width: percentText }" />
    </div>
    <span v-if="percent" class="cbar__text tnum">{{ percentText }}</span>
    <span v-if="note" class="cbar__note">{{ note }}</span>
  </div>
</template>

<style scoped>
.cbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.cbar__track {
  flex: 1 1 auto;
  min-width: 60px;
  height: 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  overflow: hidden;
}

.cbar__fill {
  height: 100%;
  border-radius: var(--radius-sm);
  transition: width var(--motion-base) var(--ease-standard);
}

.cbar__fill--ok {
  background: var(--success);
}

.cbar__fill--mid {
  background: var(--info);
}

.cbar__fill--low {
  background: var(--warn);
}

.cbar__fill--none {
  background: var(--border);
}

.cbar__fill--accent {
  background: var(--accent);
}

.cbar__fill--muted {
  background: var(--muted);
}

.cbar__text {
  flex: 0 0 auto;
  min-width: 40px;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.cbar__note {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--meta);
}
</style>
