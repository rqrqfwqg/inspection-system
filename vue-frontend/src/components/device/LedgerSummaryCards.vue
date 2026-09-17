<script setup lang="ts">
/**
 * 台账汇总卡（6 张，点即为筛选快捷入口）
 * - 数值口径全部来自 /assets/asset-ledger/summary（只跟 q / 子系统 / 区域 / 使用单位联动）
 * - 卡片是 <button>：键盘可达、hover/focus 有反馈、aria-pressed 表达当前生效的筛选
 * - 栅格用 auto-fit minmax(190px,1fr)：1280 档 6 张一行、窄档自动降列，不写死列数
 * - 加载用同尺寸骨架占位（不撑高容器，防 CLS）
 */
import { computed, type Component } from 'vue'
import { Box, Clock, Document, MapLocation, Money, Warning } from '@element-plus/icons-vue'
import {
  fmtInt,
  fmtMoneyBig,
  type AssetLedgerState,
  type AssetLedgerSummary,
} from '@/types/assetLedger'

interface Props {
  summary: AssetLedgerSummary | null
  loading: boolean
  /** 当前生效的状态筛选，用于高亮对应卡片 */
  activeState: AssetLedgerState | ''
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'pick-state', state: AssetLedgerState | ''): void
}>()

interface CardDef {
  key: string
  label: string
  value: string
  hint: string
  icon: Component
  tone: 'default' | 'brand' | 'warn' | 'danger'
  state: AssetLedgerState | ''
}

function pct(n: number, total: number): string {
  if (!total) return '0.0%'
  return `${((n / total) * 100).toFixed(1)}%`
}

const cards = computed<CardDef[]>(() => {
  const s = props.summary
  if (!s) return []
  return [
    {
      key: 'total',
      label: '资产总数',
      value: fmtInt(s.total),
      hint: `已登记 ${fmtInt(s.registered)} · 仅台账 ${fmtInt(s.ledger_only)}`,
      icon: Box,
      tone: 'brand',
      state: '',
    },
    {
      key: 'amount',
      label: '固定资产含税总额',
      value: fmtMoneyBig(s.amount_total),
      hint: `有固定资产 ${fmtInt(s.with_asset)} 项 · 单台均值 ${fmtMoneyBig(s.amount_avg)}`,
      icon: Money,
      tone: 'default',
      state: 'with_asset',
    },
    {
      key: 'records',
      label: '有台账记录',
      value: fmtInt(s.with_records),
      hint: `已标 BIM ${fmtInt(s.with_bim)} · 无固定资产 ${fmtInt(s.without_asset)}`,
      icon: Document,
      tone: 'default',
      state: 'has_records',
    },
    {
      key: 'expired',
      label: '保修已过期',
      value: fmtInt(s.warranty_expired),
      hint: `占总数 ${pct(s.warranty_expired, s.total)}`,
      icon: Warning,
      tone: 'danger',
      state: 'warranty_expired',
    },
    {
      key: 'soon',
      label: `保修 ${s.warranty_soon_days} 天内到期`,
      value: fmtInt(s.warranty_soon),
      hint: `占总数 ${pct(s.warranty_soon, s.total)} · 需提前安排续保`,
      icon: Clock,
      tone: 'warn',
      state: 'warranty_soon',
    },
    {
      key: 'no-location',
      label: '缺位置信息',
      value: fmtInt(s.no_location),
      hint: '楼栋 / 房间 / 位置描述均为空，无法按区巡检',
      icon: MapLocation,
      tone: 'default',
      state: 'no_location',
    },
  ]
})
</script>

<template>
  <section class="scards" :class="{ 'is-busy': loading }" aria-label="台账汇总">
    <template v-if="loading && !summary">
      <div v-for="n in 6" :key="n" class="scard scard--skeleton">
        <el-skeleton :rows="2" animated />
      </div>
    </template>
    <template v-else>
      <button
        v-for="c in cards"
        :key="c.key"
        type="button"
        class="scard"
        :class="[`is-${c.tone}`, { 'is-active': activeState === c.state }]"
        :aria-pressed="activeState === c.state"
        @click="emit('pick-state', c.state)"
      >
        <span class="scard__head">
          <el-icon :size="16" class="scard__icon"><component :is="c.icon" /></el-icon>
          <span class="scard__label">{{ c.label }}</span>
        </span>
        <span class="scard__value tnum">{{ c.value }}</span>
        <span class="scard__hint">{{ c.hint }}</span>
      </button>
    </template>
  </section>
</template>

<style scoped>
.scards {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-3);
  min-width: 0;
  transition: opacity var(--motion-fast) var(--ease-standard);
}
.scards.is-busy {
  opacity: 0.6;
}

/* 卡片：1px 环、无模糊阴影（禁止幽灵卡片）；hover 只换边框色，不用左侧彩色粗边 */
.scard {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}
.scard:hover {
  border-color: var(--accent);
}
.scard:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.scard.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.scard--skeleton {
  cursor: default;
  border-style: dashed;
}
.scard--skeleton:hover {
  border-color: var(--border-soft);
}

.scard__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.scard__icon {
  color: var(--muted);
}
.scard__label {
  font-size: var(--text-sm);
  color: var(--fg-2);
  font-weight: var(--weight-emphasize);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scard__value {
  font-size: var(--text-3xl);
  line-height: var(--leading-tight);
  font-weight: var(--weight-announce);
  letter-spacing: var(--tracking-display);
  color: var(--fg);
}
.is-brand .scard__value {
  color: var(--accent);
}
.is-warn .scard__value {
  color: var(--warn-fg);
}
.is-danger .scard__value {
  color: var(--danger-fg);
}

.scard__hint {
  font-size: var(--text-xs);
  line-height: var(--leading-snug);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1439px) {
  .scards {
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  }
  .scard__value {
    font-size: var(--text-2xl);
  }
}
</style>
