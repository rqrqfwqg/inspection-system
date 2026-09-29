<script setup lang="ts">
/**
 * 盘点状态标签（原子组件，两页 + 详情抽屉共用）
 * 自绘三通道（色块 + 图标 + 文字），WCAG 1.4.1，禁 emoji、禁 el-tag type 直接渲染。
 * - confirmed（已盘点）：绿（复用 --dev-normal-* 单一事实源）
 * - unconfirmed（待盘点）：中性灰（色相 = 0）
 * - override（人工覆盖）：作主状态旁的次级琥珀徽标，hover/focus 弹 tooltip 显覆盖人/时间/原因
 * 颜色全走 --inv-* token（SPEC §13），动效仅 --ease-standard。
 */
import { computed } from 'vue'
import { CircleCheckFilled, Clock, Stamp } from '@element-plus/icons-vue'
import type { Component } from 'vue'
import type { InventoryStatus } from '@/types/assetLedger'

interface Props {
  /** 最终盘点状态（派生或 override 后的值） */
  status: InventoryStatus
  /** 是否为管理员覆盖（override 行），决定是否叠加琥珀次级徽标 */
  overridden?: boolean
  overrideBy?: string | null
  overrideAt?: string | null
  overrideReason?: string | null
}

const props = defineProps<Props>()

interface Tone {
  bg: string
  fg: string
  icon: Component
  label: string
}

const mainTone = computed<Tone>(() =>
  props.status === 'confirmed'
    ? { bg: 'var(--inv-confirmed-bg)', fg: 'var(--inv-confirmed-fg)', icon: CircleCheckFilled, label: '已盘点' }
    : { bg: 'var(--inv-unconfirmed-bg)', fg: 'var(--inv-unconfirmed-fg)', icon: Clock, label: '待盘点' }
)

const ariaLabel = computed(() => {
  if (props.overridden) return `${mainTone.value.label}，由管理员覆盖`
  if (props.status === 'confirmed') return `${mainTone.value.label}，由房间盘点推导`
  return `${mainTone.value.label}，尚未盘点确认`
})

const tooltipLines = computed<string[]>(() => {
  if (!props.overridden) return []
  const lines: string[] = []
  if (props.overrideBy) lines.push(`覆盖人：${props.overrideBy}`)
  if (props.overrideAt) lines.push(`覆盖时间：${props.overrideAt}`)
  if (props.overrideReason) lines.push(`原因：${props.overrideReason}`)
  return lines
})
</script>

<template>
  <span class="inv-badge">
    <span
      class="wo-tag"
      :style="{ '--tone-bg': mainTone.bg, '--tone-fg': mainTone.fg }"
      role="status"
      :aria-label="ariaLabel"
    >
      <el-icon :size="16"><component :is="mainTone.icon" /></el-icon>
      <span>{{ mainTone.label }}</span>
    </span>

    <el-tooltip
      v-if="overridden && tooltipLines.length"
      :content="tooltipLines.join('\n')"
      placement="top"
      :show-after="200"
      append-to-body
    >
      <span
        class="wo-tag inv-badge__override"
        :style="{ '--tone-bg': 'var(--inv-override-bg)', '--tone-fg': 'var(--inv-override-fg)' }"
        tabindex="0"
        role="note"
        aria-label="人工覆盖"
      >
        <el-icon :size="16"><Stamp /></el-icon>
        <span>人工覆盖</span>
      </span>
    </el-tooltip>
  </span>
</template>

<style scoped>
.inv-badge { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; }
.inv-badge__override { cursor: default; transition: border-color var(--motion-fast) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard); }
.inv-badge__override:focus-visible { outline: none; box-shadow: var(--focus-ring); }
</style>
