<script setup lang="ts">
/**
 * 设备画像（「设备详情」抽屉顶部）—— 三个真实数据源的收敛呈现：
 *   /search 的 profile（子系统 / 机房 / 照片数 / 是否已登记台账）
 *   /link/device 的 table_count（涉及资料表）
 *   edges 的 total（关联关系）
 * 编号别名溯源单独成行，便于同名设备辨识。
 */
import { computed } from 'vue'
import { Files, Link, Location, Picture, PriceTag, Tickets } from '@element-plus/icons-vue'
import { fmtValue } from '@/lib/format'
import type { DeviceLinkResponse, DeviceProfile } from '@/types/assetViz'

const props = defineProps<{
  prof: DeviceProfile | null
  link: DeviceLinkResponse | null
  totalRecords: number
  edgeTotal: number
  aliases: Record<string, unknown>[]
}>()

const inLedger = computed(() => props.prof?.in_ledger === true)
const name = computed(() => String(props.prof?.name ?? ''))

const stats = computed(() => [
  { key: 'records', label: '资料记录', value: props.totalRecords, icon: Files },
  {
    key: 'tables',
    label: '涉及资料表',
    value: props.link?.table_count ?? props.prof?.source_tables?.length ?? 0,
    icon: Tickets,
  },
  { key: 'edges', label: '关联关系', value: props.edgeTotal, icon: Link },
  { key: 'photos', label: '现场照片', value: props.prof?.photo_count ?? 0, icon: Picture },
])

const subsystemName = computed(() => String(props.prof?.subsystem_name ?? ''))

const placeText = computed(() =>
  [
    props.prof?.building || props.link?.building,
    props.prof?.floor || props.link?.floor,
    props.prof?.location || '',
  ]
    .filter(Boolean)
    .join(' / '),
)

const hasRoom = computed(() => !!props.prof?.room || (props.link?.groups?.length ?? 0) > 0)
const roomText = computed(() => props.prof?.room?.room_name || props.prof?.room?.room_code || '—')
const tagNo = computed(() => String(props.prof?.tag_no ?? ''))

function aliasText(a: Record<string, unknown>): string {
  return fmtValue(a.alias_code ?? a.alias ?? a)
}
</script>

<template>
  <section class="dpc panel">
    <header class="panel-head dpc__head">
      <h3 class="panel-title dpc__title">
        <el-icon :size="16"><Files /></el-icon>
        <span>设备画像</span>
        <span v-if="name" class="dpc__name ellipsis" :title="name">{{ name }}</span>
      </h3>
      <el-tag v-if="prof" size="small" :type="inLedger ? 'success' : 'warning'" effect="light">
        {{ inLedger ? '已登记台账' : '未登记（仅资料）' }}
      </el-tag>
    </header>

    <div class="dpc__grid">
      <div v-for="s in stats" :key="s.key" class="dpc__stat">
        <p class="dpc__stat-label">
          <el-icon :size="16" class="dpc__stat-icon"><component :is="s.icon" /></el-icon>
          <span>{{ s.label }}</span>
        </p>
        <p class="dpc__stat-value tnum">{{ s.value }}</p>
      </div>
    </div>

    <div class="dpc__meta">
      <span v-if="subsystemName">子系统：<b>{{ subsystemName }}</b></span>
      <span v-if="placeText" class="dpc__fact">
        <el-icon :size="16"><Location /></el-icon>{{ placeText }}
      </span>
      <span v-if="hasRoom">机房：<b>{{ roomText }}</b></span>
      <span v-if="tagNo">标签：<b>{{ tagNo }}</b></span>
    </div>

    <div v-if="aliases.length" class="dpc__aliases">
      <el-icon :size="16" class="dpc__alias-icon"><PriceTag /></el-icon>
      <span class="dpc__alias-label">编号别名：</span>
      <el-tag
        v-for="(a, i) in aliases"
        :key="i"
        size="small"
        type="info"
        effect="plain"
        class="mono break-code"
      >
        {{ aliasText(a) }}
      </el-tag>
    </div>
  </section>
</template>

<style scoped>
.dpc {
  min-width: 0;
}

.dpc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.dpc__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
}

.dpc__name {
  min-width: 0;
  font-weight: var(--weight-normal);
  color: var(--fg-2);
}

.dpc__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.dpc__stat {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.dpc__stat-label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dpc__stat-icon {
  color: var(--meta);
}

.dpc__stat-value {
  margin: var(--space-1) 0 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.dpc__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dpc__fact {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.dpc__aliases {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
  min-width: 0;
  font-size: var(--text-xs);
}

.dpc__alias-icon {
  color: var(--meta);
}

.dpc__alias-label {
  color: var(--fg-2);
}

@media (max-width: 1023px) {
  .dpc__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
