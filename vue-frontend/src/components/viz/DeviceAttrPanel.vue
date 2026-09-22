<script setup lang="ts">
/**
 * 设备属性面板（「设备属性」子视图右侧主体，跨对象复用）
 * 一次并取三个真实数据源（与「设备详情」抽屉同源，但以整页形式呈现，便于逐跳下钻）：
 *   /search 画像 · /link/device 资料记录与关联边（自动/人工分列）· /ba/problems 问题。
 * 三源相互独立：任一不可用只降级为空，不拖垮整屏（见 useVizDeviceBundle）。
 */
import { computed, watch } from 'vue'
import { Collection, Link, Location, Share, Tickets } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import assetApi from '@/api/assetApi'
import BaProblemList from '@/components/viz/BaProblemList.vue'
import FieldList from '@/components/viz/FieldList.vue'
import LinkEdgeGroup from '@/components/viz/LinkEdgeGroup.vue'
import RelationGraph from '@/components/viz/RelationGraph.vue'
import { useVizDeviceBundle } from '@/composables/useVizDeviceBundle'
import { fmtInt } from '@/lib/format'

const props = defineProps<{ code: string | null }>()
const emit = defineEmits<{ (e: 'navigate', code: string): void }>()

const { loading, search, link, problems, load } = useVizDeviceBundle()

watch(() => props.code, (c) => { void load(c ?? '') }, { immediate: true })

/** 三类对象的统一称呼；资料域对象补「它是什么表里的」（电柜 / 配电箱 / 图纸回路） */
const kindText = computed(() => {
  const k = link.value?.kind
  if (k === 'device') return '台账设备'
  if (k === 'room') return '机房'
  if (k === 'record') {
    const t = link.value?.owner_tables?.[0]?.table_name
    return t ? `资料域 · ${t}` : '资料域对象'
  }
  return '未知'
})
const kindTone = computed(() => {
  const k = link.value?.kind
  return k === 'device' ? 'primary' : k === 'room' ? 'success' : 'warning'
})

const name = computed(() => link.value?.name || search.value?.profile?.name || '')
const prof = computed(() => search.value?.profile ?? null)
const primary = computed(() => link.value?.groups?.[0] ?? null)
const attrs = computed<Record<string, unknown>>(
  () => (primary.value?.records?.[0]?.data ?? {}) as Record<string, unknown>,
)
const autoEdges = computed(() => link.value?.edges_auto ?? [])
const manualEdges = computed(() => link.value?.edges_manual ?? [])
const ownerTables = computed(() => link.value?.owner_tables ?? [])
const recordCount = computed(() => link.value?.record_count ?? search.value?.total_records ?? 0)
const tableCount = computed(() => link.value?.table_count ?? 0)
const edgeTotal = computed(() => link.value?.edge_summary?.total ?? 0)
const subsystemName = computed(() => String(link.value?.subsystem?.name ?? ''))
const placeText = computed(() => [link.value?.building, link.value?.floor].filter(Boolean).join(' / '))
const roomText = computed(() => prof.value?.room?.room_name || prof.value?.room?.room_code || '')
const tagNo = computed(() => String(prof.value?.tag_no ?? ''))

/** 图谱边归一：优先用 /link 的边（带来源标注），退回 /search 的拓扑边。 */
interface GraphEdge {
  from_code: string
  to_code: string
  other_code?: string
  relation_type?: string
  source?: string
  other_kind?: string
}
const graphEdges = computed<GraphEdge[]>(() => {
  const lk = link.value
  if (lk?.edges?.length) {
    return lk.edges.map((e) => ({
      from_code: e.from_code, to_code: e.to_code, other_code: e.other_code,
      relation_type: e.relation_type, source: e.source, other_kind: e.other_kind,
    }))
  }
  return (search.value?.edges ?? []).map((e) => ({
    from_code: String(e.from ?? ''), to_code: String(e.to ?? ''),
    relation_type: String(e.type ?? '关联'), source: 'manual', other_kind: 'unknown',
  }))
})

async function removeEdge(id: number) {
  try {
    await ElMessageBox.confirm(
      '确定删除该关联边？删除只影响链路关系，双方设备的资料与记录均保留。',
      '删除关联',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await assetApi.deleteRelation(id)
    ElMessage({ type: 'success', message: '关联已删除' })
    await load(props.code ?? '')
  } catch (e) {
    ElMessage({ type: 'error', message: `删除失败：${e instanceof Error ? e.message : String(e)}` })
  }
}
</script>

<template>
  <div class="dap">
    <section v-if="!code" class="panel dap__blank">
      <p class="dap__blank-text">从左侧搜索或树中选择一个对象，这里会显示它的属性与全部关联。</p>
    </section>

    <el-skeleton v-else-if="loading" :rows="8" animated />

    <div v-else class="dap__body">
      <section class="panel">
        <header class="panel-head dap__ident">
          <el-tag type="info" effect="plain" class="mono break-code">{{ code }}</el-tag>
          <el-tag :type="kindTone" effect="light">{{ kindText }}</el-tag>
          <span v-if="name && name !== code" class="dap__name ellipsis" :title="name">{{ name }}</span>
        </header>
        <div class="dap__facts">
          <span v-if="subsystemName">子系统：<b>{{ subsystemName }}</b></span>
          <span v-if="placeText" class="dap__fact">
            <el-icon :size="16"><Location /></el-icon>{{ placeText }}
          </span>
          <span v-if="roomText">机房：<b>{{ roomText }}</b></span>
          <span v-if="tagNo">标签：<b>{{ tagNo }}</b></span>
          <span v-if="link?.kind === 'record'" class="dap__flag">未登记台账（仅资料域）</span>
        </div>
        <div v-if="ownerTables.length" class="dap__ident-row">
          <el-icon :size="16" class="dap__ident-icon"><Tickets /></el-icon>
          <span class="dap__ident-label">资料来源：</span>
          <el-tag
            v-for="t in ownerTables"
            :key="t.table_id"
            size="small"
            type="info"
            effect="plain"
          >
            {{ t.table_name }} · {{ t.record_count }}
          </el-tag>
        </div>
        <div class="dap__stats">
          <span>资料记录 {{ fmtInt(recordCount) }}</span>
          <span>资料表 {{ fmtInt(tableCount) }}</span>
          <span>关联 {{ fmtInt(edgeTotal) }}</span>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title dap__title">
            <el-icon :size="16"><Collection /></el-icon>
            <span>对象属性</span>
            <span v-if="primary" class="dap__title-note">来自《{{ primary.table_name }}》</span>
          </h3>
        </header>
        <FieldList :data="attrs" :columns="2" empty-text="该对象在资料表中暂无字段数据。" />
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title dap__title">
            <el-icon :size="16"><Link /></el-icon>
            <span>关联关系</span>
            <span class="dap__title-note">共 {{ fmtInt(edgeTotal) }} 条</span>
          </h3>
        </header>
        <p v-if="autoEdges.length === 0 && manualEdges.length === 0" class="dap__empty">
          该对象暂无关联关系。
        </p>
        <div v-else class="dap__edges">
          <LinkEdgeGroup
            v-if="autoEdges.length"
            title="自动关联"
            tone="auto"
            :edges="autoEdges"
            @select-code="emit('navigate', $event)"
            @delete="removeEdge"
          />
          <LinkEdgeGroup
            v-if="manualEdges.length"
            title="人工关联"
            tone="manual"
            :edges="manualEdges"
            @select-code="emit('navigate', $event)"
            @delete="removeEdge"
          />
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title dap__title">
            <el-icon :size="16"><Share /></el-icon>
            <span>关联图谱（以当前对象为中心，可点节点下钻）</span>
          </h3>
        </header>
        <RelationGraph
          :center-code="String(code)"
          :edges="graphEdges"
          :problems="problems"
          @select-node="emit('navigate', $event)"
        />
      </section>

      <BaProblemList v-if="problems.length" :problems="problems" />
    </div>
  </div>
</template>

<style scoped>
.dap {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.dap__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.dap__blank {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
}

.dap__blank-text {
  margin: 0;
  max-width: 52ch;
  text-align: center;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.dap__ident {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.dap__name {
  flex: 1 1 160px;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.dap__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dap__fact {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.dap__flag {
  color: var(--warn-fg);
}

.dap__ident-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
  min-width: 0;
  font-size: var(--text-xs);
}

.dap__ident-icon {
  color: var(--meta);
}

.dap__ident-label {
  color: var(--fg-2);
}

.dap__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-soft);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dap__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.dap__title-note {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.dap__empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.dap__edges {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}
</style>
