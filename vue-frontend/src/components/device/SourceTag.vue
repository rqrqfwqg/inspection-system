<script setup lang="ts">
/**
 * 来源标签（原子组件，基础数据页「来源」列用）
 * 自绘三通道（色块 + 图标 + 文字），WCAG 1.4.1，禁 emoji。
 * 来源种类（UI 设计 §5.2）：
 *   devices     → Box     设备主表已登记
 *   ledger_only → Document 仅现场台账
 *   elec_dwg    → Files   电气图纸
 *   records     → List    逻辑表记录
 *   fixed_assets→ Coin    固定资产清单
 * 颜色走中性 token（--surface-3 浅底 + --fg-2 字色），不承载状态语义，仅作辅助识别。
 */
import { computed } from 'vue'
import { Box, Coin, Document, Files, List } from '@element-plus/icons-vue'
import type { Component } from 'vue'
import type { SourceKind } from '@/types/assetLedger'

interface Props {
  kind: SourceKind
}

const props = defineProps<Props>()

const META: Record<SourceKind, { icon: Component; label: string }> = {
  devices: { icon: Box, label: '设备主表' },
  ledger_only: { icon: Document, label: '仅台账' },
  elec_dwg: { icon: Files, label: '图纸' },
  records: { icon: List, label: '逻辑表' },
  fixed_assets: { icon: Coin, label: '固定资产' },
}

const meta = computed(() => META[props.kind] ?? META.devices)
</script>

<template>
  <span
    class="wo-tag source-tag"
    :style="{ '--tone-bg': 'var(--surface-3)', '--tone-fg': 'var(--fg-2)' }"
    role="status"
    :aria-label="`来源：${meta.label}`"
  >
    <el-icon :size="16"><component :is="meta.icon" /></el-icon>
    <span>{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.source-tag { transition: border-color var(--motion-fast) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard); }
.source-tag:focus-visible { outline: none; box-shadow: var(--focus-ring); }
</style>
