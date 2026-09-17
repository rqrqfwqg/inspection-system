<script setup lang="ts">
/**
 * 资产可视化 · 概览（/asset-viz?tab=overview）
 * =====================================================================
 * 2026-09-15 重做：以 `/assets/link/overview` 为主数据源，回答三个真问题：
 *   1) 资料表与设备的关联覆盖到什么程度（覆盖率、命中/未解析）
 *   2) 哪些关联是系统自动建立的、哪些是人建的
 *   3) 还有多少编号完全没关联上，需要人工/现场处理
 * 本 Tab 按既有约定**不加统计图表**，一律用数据表 + 覆盖率条呈现，保证可核对。
 * 各数据区块已拆为独立子组件（子组件只吃 props，不重复请求）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { CircleCheck, Files, Link, Warning } from '@element-plus/icons-vue'
import VizKpi from '@/components/viz/VizKpi.vue'
import OverviewSubsystemPanel from '@/components/viz/OverviewSubsystemPanel.vue'
import OverviewTablePanel from '@/components/viz/OverviewTablePanel.vue'
import OverviewBottomPanels from '@/components/viz/OverviewBottomPanels.vue'
import LinkSourcePanel from '@/components/viz/LinkSourcePanel.vue'
import { getBaOverview, getLinkOverview } from '@/api/assetViz'
import { listSubsystems } from '@/api/dict'
import { fmtInt, fmtPercent } from '@/lib/format'
import type { BaOverviewItem, LinkOverview } from '@/types/assetViz'
import type { Subsystem } from '@/api/dict'

const props = defineProps<{ subsystemFilter?: string }>()
const emit = defineEmits<{ (e: 'clear-filter'): void; (e: 'navigate-tab', tab: string): void }>()

const router = useRouter()
const ba = ref<BaOverviewItem[]>([])
const link = ref<LinkOverview | null>(null)
const subsystems = ref<Subsystem[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const [o, l, subs] = await Promise.all([
      getBaOverview().catch(() => [] as BaOverviewItem[]),
      getLinkOverview(),
      listSubsystems(),
    ])
    ba.value = o
    link.value = l
    subsystems.value = subs
  } catch (e) {
    ElMessage({ type: 'error', message: `加载概览数据失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  } finally {
    loading.value = false
  }
}
onMounted(load)

const g = computed(() => link.value?.global ?? null)
const src = computed(() => link.value?.relations_by_source ?? null)

const subs = computed(() => {
  const all = link.value?.subsystems ?? []
  return props.subsystemFilter ? all.filter((s) => s.code === props.subsystemFilter) : all
})

const tables = computed(() => {
  const all = (link.value?.tables ?? []).filter((t) => t.records > 0)
  const scoped = props.subsystemFilter ? all.filter((t) => t.subsystem_code === props.subsystemFilter) : all
  return [...scoped].sort((a, b) => b.records - a.records).slice(0, 12)
})

const scoped = computed(() => {
  if (!props.subsystemFilter) return null
  const ts = (link.value?.tables ?? []).filter((t) => t.subsystem_code === props.subsystemFilter)
  const records = ts.reduce((a, t) => a + t.records, 0)
  const resolved = ts.reduce((a, t) => a + t.resolved_devices + t.resolved_rooms, 0)
  return { records, resolved, coverage: records ? resolved / records : 0, tables: ts.length }
})

const baScoped = computed(() => {
  const rows = props.subsystemFilter ? ba.value.filter((o) => o.subsystem_code === props.subsystemFilter) : ba.value
  return {
    problems: rows.reduce((a, o) => a + (o.problem || 0), 0),
    normal: rows.reduce((a, o) => a + (o.normal || 0), 0),
    total: rows.reduce((a, o) => a + (o.total || 0), 0),
  }
})

const baProblemRows = computed(() =>
  (props.subsystemFilter ? ba.value.filter((o) => o.subsystem_code === props.subsystemFilter) : ba.value)
    .filter((o) => o.problem > 0)
    .slice(0, 8),
)

const filterName = computed(() =>
  props.subsystemFilter
    ? subsystems.value.find((s) => s.code === props.subsystemFilter)?.name || props.subsystemFilter
    : '',
)

const resolvedValue = computed(() =>
  fmtInt(scoped.value?.resolved ?? (g.value ? g.value.resolved_devices + g.value.resolved_rooms : undefined)),
)

function openTable(tableId: number) {
  void router.push({ name: 'asset-ledger-table', params: { tableId: String(tableId) } })
}
</script>

<template>
  <div class="ovw">
    <div v-if="subsystemFilter" class="ovw__filter">
      <span class="ovw__filter-text">
        已按「{{ filterName }}」子系统过滤
        <template v-if="scoped">
          ．资料记录 {{ fmtInt(scoped.records) }} 条 · 命中 {{ fmtInt(scoped.resolved) }} 条
        </template>
      </span>
      <span class="ovw__filter-actions">
        <el-button size="small" @click="emit('navigate-tab', 'subsystem')">看子系统树</el-button>
        <el-button size="small" @click="emit('clear-filter')">清除过滤</el-button>
      </span>
    </div>

    <div class="ovw__kpis">
      <VizKpi
        :icon="Files"
        tone="slate"
        label="资料记录"
        :value="fmtInt(scoped?.records ?? g?.records)"
        :loading="loading"
      >
        {{ fmtInt(g?.tables) }} 张资料表 · {{ fmtInt(g?.fields) }} 个字段
      </VizKpi>
      <VizKpi :icon="CircleCheck" tone="success" label="关联命中" :value="resolvedValue" :loading="loading">
        覆盖率 {{ fmtPercent(scoped?.coverage ?? g?.coverage) }} · 命中设备 {{ fmtInt(g?.resolved_devices) }} 条
      </VizKpi>
      <VizKpi :icon="Link" tone="accent" label="关联关系" :value="fmtInt(g?.relations)" :loading="loading">
        自动 {{ fmtInt(g?.relations_auto) }} · 人工 {{ fmtInt(g?.relations_manual) }}
      </VizKpi>
      <VizKpi :icon="Warning" tone="warn" label="未关联编号" :value="fmtInt(g?.unresolved_codes)" :loading="loading">
        覆盖 {{ fmtInt(g?.unresolved) }} 条记录 · 需人工/现场处理
      </VizKpi>
    </div>

    <OverviewSubsystemPanel
      :rows="subs"
      :loading="loading"
      @refresh="load"
      @go-link="emit('navigate-tab', 'link')"
    />

    <OverviewTablePanel :rows="tables" :filtered="!!subsystemFilter" @open-table="openTable" />

    <OverviewBottomPanels
      :unresolved="link?.unresolved_top ?? []"
      :unresolved-codes="g?.unresolved_codes ?? 0"
      :unresolved-records="g?.unresolved ?? 0"
      :ba="baScoped"
      :ba-rows="baProblemRows"
      @go-link="emit('navigate-tab', 'link')"
    />

    <LinkSourcePanel v-if="src" :src="src" />
  </div>
</template>

<style scoped>
.ovw {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.ovw__filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}

.ovw__filter-text {
  font-size: var(--text-sm);
  color: var(--fg);
}

.ovw__filter-actions {
  display: inline-flex;
  gap: var(--space-2);
}

.ovw__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 1279px) {
  .ovw__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
