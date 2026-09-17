<script setup lang="ts">
/**
 * 联动中心 Tab（/asset-viz?tab=link）
 * 「资产可视化 ↔ 数据表管理 ↔ 关联」三者的操作台，解决两件事：
 *  1) 自动/预先关联：只做确定性编号等值匹配，先预览（dry_run）再执行，执行后按批次整批回滚；
 *  2) 无法自动关联的兜底：未解析编号进待办队列，桌面建边（现场由小程序扫码建边，同表同来源标注）。
 * 界面上 自动（主色）/ 人工（中性）**始终成对出现、颜色与图标固定**，避免分不清某条边是谁建的。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Bell, Cpu, Files, Link, User } from '@element-plus/icons-vue'
import AutoAssociatePanel from '@/components/viz/AutoAssociatePanel.vue'
import ManualQueuePanel from '@/components/viz/ManualQueuePanel.vue'
import RecentEdges from '@/components/viz/RecentEdges.vue'
import VizKpi from '@/components/viz/VizKpi.vue'
import {
  getAutoRules, getLinkOverview, getManualQueue, getRelations,
  manualAssociate, rollbackAutoAssociate, runAutoAssociate,
} from '@/api/assetViz'
import { fmtInt } from '@/lib/format'
import type {
  AutoAssociatePreview, AutoAssociateResult, AutoRulesResponse, LinkOverview,
  ManualQueueResponse, RelationEdge,
} from '@/types/assetViz'

const overview = ref<LinkOverview | null>(null)
const rules = ref<AutoRulesResponse | null>(null)
const queue = ref<ManualQueueResponse | null>(null)
const edges = ref<RelationEdge[]>([])
const loading = ref(true)
const busy = ref<string | null>(null)
const preview = ref<AutoAssociatePreview | null>(null)
const lastBatch = ref<AutoAssociateResult | null>(null)

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function load() {
  loading.value = true
  try {
    const [ov, ru, mq, rel] = await Promise.all([
      getLinkOverview(), getAutoRules(), getManualQueue({ limit: 30 }), getRelations(),
    ])
    overview.value = ov
    rules.value = ru
    queue.value = mq
    edges.value = rel
  } catch (e) {
    ElMessage({ type: 'error', message: `加载联动数据失败：${msg(e)}`, duration: 4000 })
  } finally {
    loading.value = false
  }
}
onMounted(load)

const g = computed(() => overview.value?.global ?? null)
const src = computed(() => overview.value?.relations_by_source ?? null)
const rulesHit = computed(() => (rules.value?.rules ?? []).filter((r) => r.candidates > 0).length)

const typeRows = computed(() => {
  const autoTypes = src.value?.auto_by_type ?? {}
  const manualByType: Record<string, number> = {}
  for (const r of overview.value?.relations ?? []) {
    manualByType[r.type] = Math.max(0, r.count - (autoTypes[r.type] ?? 0))
  }
  const keys = new Set([...Object.keys(autoTypes), ...Object.keys(manualByType)])
  return [...keys]
    .map((type) => ({ type, auto: autoTypes[type] ?? 0, manual: manualByType[type] ?? 0 }))
    .sort((a, b) => b.auto + b.manual - (a.auto + a.manual))
})
const maxCount = computed(() => Math.max(1, ...typeRows.value.map((x) => Math.max(x.auto, x.manual))))

function barWidth(v: number): string {
  return `${(v / maxCount.value) * 100}%`
}

async function doPreview() {
  busy.value = 'preview'
  try {
    const r = (await runAutoAssociate({ dryRun: true })) as AutoAssociatePreview
    preview.value = r
    ElMessage({
      type: 'success',
      message: `预览完成：将新建 ${r.would_create} 条自动关联（已存在跳过 ${r.already_linked}，自环剔除 ${r.skipped_self_loop}，未写库）`,
      duration: 4000,
    })
  } catch (e) {
    ElMessage({ type: 'error', message: `预览失败：${msg(e)}` })
  } finally {
    busy.value = null
  }
}

async function doApply(ruleIds?: string[]) {
  busy.value = ruleIds ? ruleIds.join(',') : 'apply'
  try {
    const r = (await runAutoAssociate({ ruleIds })) as AutoAssociateResult
    lastBatch.value = r
    preview.value = null
    ElMessage({ type: 'success', message: `自动关联完成：新建 ${r.created} 条（批次 ${r.batch}）`, duration: 4000 })
    await load()
  } catch (e) {
    ElMessage({ type: 'error', message: `执行失败：${msg(e)}` })
  } finally {
    busy.value = null
  }
}

async function doRollback(opts: { batch?: string; rule?: string }) {
  busy.value = 'rollback'
  try {
    const r = await rollbackAutoAssociate(opts)
    ElMessage({ type: 'success', message: `已回滚 ${r.deleted} 条自动关联（人工关联不受影响）` })
    lastBatch.value = null
    await load()
  } catch (e) {
    ElMessage({ type: 'error', message: `回滚失败：${msg(e)}` })
  } finally {
    busy.value = null
  }
}

async function submitManual(p: { from: string; to: string; relationType: string; note: string }) {
  busy.value = 'manual'
  try {
    const r = await manualAssociate({
      fromCode: p.from, toCode: p.to, relationType: p.relationType, note: p.note, operator: 'web',
    })
    ElMessage({ type: 'success', message: `人工关联已建立：${r.from.code} → ${r.to.code} · ${r.relation_type}` })
    await load()
  } catch (e) {
    ElMessage({ type: 'error', message: `建边失败：${msg(e)}` })
  } finally {
    busy.value = null
  }
}

</script>

<template>
  <div class="lc">
    <div class="lc__kpis">
      <VizKpi :icon="Files" tone="slate" label="资料记录" :value="fmtInt(g?.records)" :loading="loading">
        {{ fmtInt(g?.tables) }} 张资料表 · 关联命中 {{ fmtInt(g?.resolved_devices) }} 条
      </VizKpi>
      <VizKpi :icon="Cpu" tone="accent" label="自动关联" :value="fmtInt(g?.relations_auto)" :loading="loading">
        {{ rulesHit }} 条规则命中 · 可回滚
      </VizKpi>
      <VizKpi :icon="User" tone="slate" label="人工关联" :value="fmtInt(g?.relations_manual)" :loading="loading">
        含历史导入未标注 {{ fmtInt(g?.relations_unmarked) }} 条
      </VizKpi>
      <VizKpi :icon="Bell" tone="warn" label="待人工处理" :value="fmtInt(queue?.total_unresolved_codes)" :loading="loading">
        无法自动关联的编号（可小程序现场建边）
      </VizKpi>
    </div>

    <AutoAssociatePanel
      :loading="loading"
      :rules="rules"
      :src="src"
      :preview="preview"
      :last-batch="lastBatch"
      :busy="busy"
      @preview="doPreview"
      @apply="doApply"
      @rollback="doRollback"
    />

    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title lc__title">
          <el-icon :size="16"><Link /></el-icon>
          <span>关联来源对照</span>
        </h3>
      </header>
      <p class="lc__desc">同一种关系类型下，自动关联与人工关联各有多少 —— 用于判断哪些链路已可自动维护。</p>
      <el-skeleton v-if="loading" :rows="3" animated />
      <el-table v-else :data="typeRows" size="small" class="lc__table" empty-text="暂无关联数据">
        <el-table-column prop="type" label="关系类型" min-width="180" show-overflow-tooltip />
        <el-table-column label="自动" min-width="200">
          <template #default="{ row }">
            <span class="lc__bar-cell">
              <span class="lc__bar lc__bar--auto" :style="{ width: barWidth(row.auto) }" />
              <span class="tnum lc__auto-text">{{ row.auto }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="人工" min-width="200">
          <template #default="{ row }">
            <span class="lc__bar-cell">
              <span class="lc__bar lc__bar--manual" :style="{ width: barWidth(row.manual) }" />
              <span class="tnum lc__muted">{{ row.manual }}</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="合计" min-width="90" align="right">
          <template #default="{ row }"><span class="tnum">{{ row.auto + row.manual }}</span></template>
        </el-table-column>
      </el-table>
    </section>

    <ManualQueuePanel
      :queue="queue"
      :loading="loading"
      :busy="!!busy"
      @submit="submitManual"
      @refresh="load"
    />

    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title lc__title">
          <el-icon :size="16"><Link /></el-icon>
          <span>最近关联边</span>
          <span class="lc__note">共 {{ fmtInt(edges.length) }} 条</span>
        </h3>
      </header>
      <p class="lc__desc">自动关联为主色、人工关联为中性色 —— 每条边都能看出是谁建立的。</p>
      <RecentEdges :relations="edges" :loading="loading" />
    </section>
  </div>
</template>

<style scoped>
.lc {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.lc__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.lc__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.lc__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.lc__note,
.lc__muted {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.lc__table {
  width: 100%;
}

.lc__bar-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.lc__bar {
  height: 8px;
  min-width: 0;
  border-radius: var(--radius-sm);
  flex: 0 0 auto;
}

.lc__bar--auto {
  background: var(--info);
}

.lc__bar--manual {
  background: var(--muted);
}

.lc__auto-text {
  color: var(--info-fg);
}

@media (max-width: 1279px) {
  .lc__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
