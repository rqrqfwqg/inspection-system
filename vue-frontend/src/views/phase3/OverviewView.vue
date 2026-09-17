<script setup lang="ts">
/**
 * 运维总览（/dashboard 数据看板）—— React 版 DashboardPage 等价迁移
 * =====================================================================
 * 4 张统计卡：资产总数 / 机房总数 / 保修已过期 / 含税资产总值。
 * 数据源与口径对齐 React 版：
 *  - GET /assets/asset-ledger/summary（任一失败按 0 呈现，不阻断页面）
 *  - GET /ops/api/rooms 取数组长度（房间总数）
 *  - 金额量级压缩走 lib/format 的 fmtMoneyBig（全站唯一格式化实现）
 * React 版卡片底色含紫色系，已按本项目禁令改为 token 语义色（info）。
 */
import { computed, onMounted, ref } from 'vue'
import { Box, OfficeBuilding, Wallet, Warning } from '@element-plus/icons-vue'
import { getAssetLedgerSummary } from '@/api/assetLedger'
import { getRooms } from '@/api/users'
import { fmtInt, fmtMoneyBig } from '@/lib/format'
import { useCurrentUser } from '@/composables/useCurrentUser'
import type { AssetLedgerSummary } from '@/types/assetLedger'

const { currentUser } = useCurrentUser()

const loading = ref(true)
const summary = ref<AssetLedgerSummary | null>(null)
const roomCount = ref(0)
const summaryError = ref('')

const stats = computed(() => ({
  total: summary.value?.total ?? 0,
  registered: summary.value?.registered ?? 0,
  ledgerOnly: summary.value?.ledger_only ?? 0,
  withAsset: summary.value?.with_asset ?? 0,
  amountTotal: summary.value?.amount_total ?? 0,
  warrantySoon: summary.value?.warranty_soon ?? 0,
  warrantyExpired: summary.value?.warranty_expired ?? 0,
  rooms: roomCount.value,
}))

interface StatCard {
  label: string
  value: string
  hint: string
  icon: typeof Box
  tone: 'accent' | 'success' | 'danger' | 'info'
}

const statCards = computed<StatCard[]>(() => [
  {
    label: '资产总数',
    value: fmtInt(stats.value.total),
    hint: `已登记 ${fmtInt(stats.value.registered)} · 仅台账 ${fmtInt(stats.value.ledgerOnly)}`,
    icon: Box,
    tone: 'accent',
  },
  {
    label: '机房总数',
    value: fmtInt(stats.value.rooms),
    hint: '已建档机房',
    icon: OfficeBuilding,
    tone: 'success',
  },
  {
    label: '保修已过期',
    value: fmtInt(stats.value.warrantyExpired),
    hint: `即将到期 ${fmtInt(stats.value.warrantySoon)} 项`,
    icon: Warning,
    tone: 'danger',
  },
  {
    label: '含税资产总值',
    value: fmtMoneyBig(stats.value.amountTotal),
    hint: `固定资产 ${fmtInt(stats.value.withAsset)} 项`,
    icon: Wallet,
    tone: 'info',
  },
])

onMounted(async () => {
  const [summaryRes, roomRes] = await Promise.allSettled([
    getAssetLedgerSummary({}),
    getRooms(),
  ])
  if (summaryRes.status === 'fulfilled') {
    summary.value = summaryRes.value
  } else {
    // 汇总失败按 0 呈现（与 React 版 catch(() => null) 等价），但给出可见提示
    summaryError.value = summaryRes.reason instanceof Error ? summaryRes.reason.message : '汇总数据加载失败'
  }
  roomCount.value = roomRes.status === 'fulfilled' && Array.isArray(roomRes.value) ? roomRes.value.length : 0
  loading.value = false
})
</script>

<template>
  <div class="ov">
    <PageHead title="数据看板">
      <template #default>
        <p class="ov__greet">
          欢迎回来，{{ currentUser?.name ?? '运维同事' }}
          <span v-if="currentUser?.department" class="ov__dept">· {{ currentUser.department }}</span>
        </p>
      </template>
    </PageHead>

    <el-alert
      v-if="summaryError"
      type="warning"
      :closable="false"
      show-icon
      :title="`资产汇总加载失败：${summaryError}（以下卡片按 0 呈现，刷新可重试）`"
    />

    <div v-loading="loading" class="ov__grid min-w-0">
      <div v-for="card in statCards" :key="card.label" class="ov__card panel">
        <div class="ov__card-main min-w-0">
          <p class="ov__card-label">{{ card.label }}</p>
          <p class="ov__card-value tnum" :class="`ov__card-value--${card.tone}`">{{ card.value }}</p>
          <p class="ov__card-hint ellipsis">{{ card.hint }}</p>
        </div>
        <span class="ov__card-icon" :class="`ov__card-icon--${card.tone}`">
          <el-icon :size="24"><component :is="card.icon" /></el-icon>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.ov__head { min-width: 0; }
.ov__title { margin: 0; font-size: var(--text-xl); line-height: var(--leading-tight); font-weight: 600; color: var(--fg); }
.ov__greet { margin: var(--space-1) 0 0; font-size: var(--text-sm); color: var(--muted); }
.ov__dept { color: var(--accent); }

.ov__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-4);
  min-height: 140px;
}

.ov__card {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-5);
}
.ov__card-main { min-width: 0; }
.ov__card-label { margin: 0; font-size: var(--text-sm); color: var(--fg-2); }
.ov__card-value { margin: var(--space-1) 0 0; font-size: var(--text-3xl); font-weight: var(--weight-announce); letter-spacing: var(--tracking-display); line-height: var(--leading-tight); }
.ov__card-value--accent  { color: var(--accent); }
.ov__card-value--success { color: var(--success-fg); }
.ov__card-value--danger  { color: var(--danger-fg); }
.ov__card-value--info    { color: var(--info-fg); }
.ov__card-hint { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.ov__card-icon {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: var(--radius-pill);
}
.ov__card-icon--accent  { background: var(--accent-soft); color: var(--accent); }
.ov__card-icon--success { background: var(--success-bg); color: var(--success); }
.ov__card-icon--danger  { background: var(--danger-bg); color: var(--danger); }
.ov__card-icon--info    { background: var(--info-bg); color: var(--info); }

@media (max-width: 1535px) {
  .ov__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
