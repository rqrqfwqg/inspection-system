<script setup lang="ts">
/**
 * 设备详情抽屉（区域树 / 子系统树 / 设备层级 / BA / 检索 / 属性 共用，挂在 VizLayout 层）
 * =====================================================================
 * 一次并取四个真实数据源，任一不可用都不拖垮整屏（见 useVizDeviceBundle）：
 *   /search        画像 / 固定资产 / 档案 / 配件 / 别名 / BA 问题 / 机房
 *   /link/device/* 资料记录（按表分组）+ 关联边（自动/人工分列）+ owner_tables
 *   /ba/problems   该对象的 BA 问题清单
 *   /geo-observations 扫码现场定位（仅本抽屉取，属性面板不取）
 * 打开状态由 URL ?code= 驱动（深链直达），本组件只反映 props。
 */
import { computed, watch } from 'vue'
import { ArrowRight, Cpu, Link, Share, User } from '@element-plus/icons-vue'
import BaProblemList from '@/components/viz/BaProblemList.vue'
import DeviceProfileCard from '@/components/viz/DeviceProfileCard.vue'
import FieldList from '@/components/viz/FieldList.vue'
import GeoPanel from '@/components/viz/GeoPanel.vue'
import LinkEdgeGroup from '@/components/viz/LinkEdgeGroup.vue'
import RecordGroupList from '@/components/viz/RecordGroupList.vue'
import RelationGraph from '@/components/viz/RelationGraph.vue'
import { useVizDeviceBundle } from '@/composables/useVizDeviceBundle'
import { fmtInt } from '@/lib/format'

const props = defineProps<{ open: boolean; deviceCode: string | null }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'navigate', code: string): void
  (e: 'go-link'): void
  (e: 'go-table', tableId: number): void
}>()

const { loading, search, link, problems, geo, load, reset } = useVizDeviceBundle()

watch(
  () => [props.open, props.deviceCode] as const,
  ([open, code]) => {
    if (open && code) void load(code, true)
    else reset()
  },
  { immediate: true },
)

const code = computed(() => props.deviceCode ?? '')
const prof = computed(() => search.value?.profile ?? null)
const name = computed(() => link.value?.name || prof.value?.name || search.value?.target?.name || code.value)
const edgeSummary = computed(() => link.value?.edge_summary ?? null)
const groups = computed(() => link.value?.groups ?? [])
const aliases = computed(() => search.value?.aliases ?? [])
const accessories = computed(() => search.value?.accessories ?? [])
const fixedAsset = computed(() => search.value?.fixed_asset ?? null)
const archive = computed(() => search.value?.archive ?? null)
const autoEdges = computed(() => link.value?.edges_auto ?? [])
const manualEdges = computed(() => link.value?.edges_manual ?? [])
const totalRecords = computed(() => link.value?.record_count ?? search.value?.total_records ?? 0)

interface GraphEdge {
  from_code: string
  to_code: string
  other_code?: string
  relation_type?: string
  source?: string
  other_kind?: string
}
/** 图谱边归一：优先用 /link 的边（带来源标注），退回 /search 的拓扑边 */
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

const hasContent = computed(() => !!search.value || !!link.value)
</script>

<template>
  <el-drawer
    :model-value="open"
    direction="rtl"
    size="min(94vw, 880px)"
    append-to-body
    :with-header="false"
    @close="emit('update:open', false)"
  >
    <header class="ddr__head">
      <h2 class="ddr__title">设备详情</h2>
      <el-tag v-if="code" type="info" effect="plain" class="mono break-code">{{ code }}</el-tag>
      <span v-if="name && name !== code" class="ddr__name ellipsis" :title="name">{{ name }}</span>
      <span v-if="edgeSummary && edgeSummary.total > 0" class="ddr__tags">
        <el-tag v-if="edgeSummary.auto > 0" size="small" type="primary" effect="light">
          <el-icon :size="16"><Cpu /></el-icon>自动 {{ edgeSummary.auto }}
        </el-tag>
        <el-tag v-if="edgeSummary.manual > 0" size="small" type="info" effect="light">
          <el-icon :size="16"><User /></el-icon>人工 {{ edgeSummary.manual }}
        </el-tag>
      </span>
    </header>

    <div class="ddr__body">
      <el-skeleton v-if="loading" :rows="8" animated />

      <p v-else-if="!hasContent" class="ddr__empty">未检索到该对象的信息。</p>

      <div v-else class="ddr__content">
        <DeviceProfileCard
          :prof="prof"
          :link="link"
          :total-records="totalRecords"
          :edge-total="edgeSummary?.total ?? 0"
          :aliases="aliases"
        />

        <GeoPanel :geo="geo" :name="name" />

        <section class="panel">
          <header class="panel-head ddr__sec-head">
            <h3 class="panel-title ddr__sec-title">
              <el-icon :size="16"><Link /></el-icon>
              <span>关联关系</span>
              <span class="ddr__note">共 {{ fmtInt(edgeSummary?.total ?? 0) }} 条</span>
            </h3>
            <el-button size="small" text @click="emit('go-link')">
              <span>联动中心</span>
              <el-icon :size="16"><ArrowRight /></el-icon>
            </el-button>
          </header>
          <p v-if="autoEdges.length === 0 && manualEdges.length === 0" class="ddr__empty">
            该对象暂无关联关系。
          </p>
          <div v-else class="ddr__edges">
            <LinkEdgeGroup
              v-if="autoEdges.length"
              title="自动关联"
              tone="auto"
              :edges="autoEdges"
              @select-code="emit('navigate', $event)"
            />
            <LinkEdgeGroup
              v-if="manualEdges.length"
              title="人工关联"
              tone="manual"
              :edges="manualEdges"
              @select-code="emit('navigate', $event)"
            />
          </div>
        </section>

        <section class="panel">
          <header class="panel-head">
            <h3 class="panel-title ddr__sec-title">
              <el-icon :size="16"><Share /></el-icon>
              <span>关联图谱（以当前对象为中心）</span>
            </h3>
          </header>
          <RelationGraph
            :center-code="code"
            :edges="graphEdges"
            :problems="problems"
            @select-node="emit('navigate', $event)"
          />
        </section>

        <section class="panel">
          <header class="panel-head">
            <h3 class="panel-title ddr__sec-title">
              <el-icon :size="16"><Link /></el-icon>
              <span>资料记录（{{ totalRecords }}）</span>
              <span class="ddr__note">{{ groups.length }} 张表 · 与「数据表管理」同源</span>
            </h3>
          </header>
          <RecordGroupList :groups="groups" @open-table="emit('go-table', $event)" />
        </section>

        <section v-if="fixedAsset" class="panel">
          <header class="panel-head">
            <h3 class="panel-title ddr__sec-title"><span>固定资产</span></h3>
          </header>
          <FieldList :data="fixedAsset" :columns="2" empty-text="无" />
        </section>

        <section v-if="archive" class="panel">
          <header class="panel-head">
            <h3 class="panel-title ddr__sec-title"><span>设备档案</span></h3>
          </header>
          <FieldList :data="archive" :columns="2" empty-text="无" />
        </section>

        <BaProblemList :problems="problems" empty-text="无" />

        <section v-if="accessories.length" class="panel">
          <header class="panel-head">
            <h3 class="panel-title ddr__sec-title"><span>配件（{{ accessories.length }}）</span></h3>
          </header>
          <div class="ddr__acc">
            <FieldList v-for="(a, i) in accessories" :key="i" :data="a" :columns="2" empty-text="—" />
          </div>
        </section>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.ddr__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  min-width: 0;
}

.ddr__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.ddr__name {
  flex: 1 1 120px;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.ddr__tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-left: auto;
}

.ddr__body {
  min-width: 0;
}

.ddr__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.ddr__empty {
  margin: 0;
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.ddr__sec-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ddr__sec-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.ddr__note {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.ddr__edges {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.ddr__acc {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
