<script setup lang="ts">
/**
 * T3GTC 资产可视化统一入口（/asset-viz）—— 9 个子视图的 Tab 容器。
 * =====================================================================
 * - tab 同步到 URL `?tab=`（可直达 / 分享 / 刷新保留视图）；非法值回落 overview。
 * - `?code=` 深链：数据表管理 / 扫码页等外部页面可直接打开某对象的详情抽屉。
 * - 跨视图联动：子系统树选中某系统 → 切至概览并按该系统过滤（显式动作，不隐式切 Tab）。
 * - 抽屉挂在布局层，跨视图复用；开关由 URL 驱动（与 DeviceLedgerView 同口径）。
 */
import { computed, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Box, Collection, Connection, DataBoard, Link, MapLocation, Search, Share, Upload,
} from '@element-plus/icons-vue'
import PageHead from '@/components/common/PageHead.vue'
import DeviceDetailDrawer from '@/components/viz/DeviceDetailDrawer.vue'
import AreaTreeTab from '@/views/viz/AreaTreeTab.vue'
import BaTreeTab from '@/views/viz/BaTreeTab.vue'
import DeviceAttrTab from '@/views/viz/DeviceAttrTab.vue'
import DeviceTreeTab from '@/views/viz/DeviceTreeTab.vue'
import ImportTab from '@/views/viz/ImportTab.vue'
import LinkCenterTab from '@/views/viz/LinkCenterTab.vue'
import SubsystemTreeTab from '@/views/viz/SubsystemTreeTab.vue'
import VizOverview from '@/views/viz/VizOverview.vue'
import VizSearchTab from '@/views/viz/VizSearchTab.vue'

interface VizTab {
  key: string
  label: string
  icon: Component
}

const TABS: VizTab[] = [
  { key: 'overview', label: '概览', icon: DataBoard },
  { key: 'area', label: '区域树', icon: MapLocation },
  { key: 'subsystem', label: '子系统树', icon: Box },
  { key: 'device', label: '设备层级', icon: Share },
  { key: 'attr', label: '设备属性', icon: Collection },
  { key: 'ba', label: 'BA系统', icon: Connection },
  { key: 'link', label: '联动中心', icon: Link },
  { key: 'search', label: '检索', icon: Search },
  { key: 'import', label: '导入', icon: Upload },
]

const TAB_KEYS = TABS.map((t) => t.key)

const route = useRoute()
const router = useRouter()

const tabQuery = computed(() => (typeof route.query.tab === 'string' ? route.query.tab : ''))
const activeTab = computed(() => (TAB_KEYS.includes(tabQuery.value) ? tabQuery.value : 'overview'))

const codeQuery = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''))

const subsystemFilter = ref<string | undefined>(undefined)

function setTab(t: string) {
  if (activeTab.value === t && tabQuery.value === t) return
  void router.replace({ query: { ...route.query, tab: t } })
}

function onTabChange(name: string | number) {
  setTab(String(name))
}

/** AC-09 深链：打开用 push（浏览器返回可关抽屉） */
function openDevice(code: string) {
  if (!code || code === codeQuery.value) return
  void router.push({ query: { ...route.query, code } })
}

/** 关闭用 replace（不额外堆历史） */
function closeDevice() {
  if (!codeQuery.value) return
  const next = { ...route.query }
  delete next.code
  void router.replace({ query: next })
}

function onDrawerOpen(v: boolean) {
  if (!v) closeDevice()
}

function selectSubsystem(code: string) {
  subsystemFilter.value = code
  setTab('overview')
}

function onGoLink() {
  closeDevice()
  setTab('link')
}

function onGoTable(tableId: number) {
  closeDevice()
  void router.push({ name: 'asset-ledger-table', params: { tableId: String(tableId) } })
}
</script>

<template>
  <div class="viz">
    <PageHead
      title="T3GTC 资产可视化"
      desc="基于资产数据（楼栋 / 房间 / 设备 / 子系统 / BA）的多维可视化与检索。"
    />

    <el-tabs :model-value="activeTab" class="viz__tabs" @tab-change="onTabChange">
      <el-tab-pane v-for="t in TABS" :key="t.key" :name="t.key">
        <template #label>
          <span class="viz__tab">
            <el-icon :size="16"><component :is="t.icon" /></el-icon>
            <span>{{ t.label }}</span>
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <div class="viz__body">
      <VizOverview
        v-if="activeTab === 'overview'"
        :subsystem-filter="subsystemFilter"
        @clear-filter="subsystemFilter = undefined"
        @navigate-tab="setTab"
      />
      <AreaTreeTab v-else-if="activeTab === 'area'" @open-device="openDevice" />
      <SubsystemTreeTab
        v-else-if="activeTab === 'subsystem'"
        @open-device="openDevice"
        @select-subsystem="selectSubsystem"
      />
      <DeviceTreeTab v-else-if="activeTab === 'device'" @open-device="openDevice" />
      <DeviceAttrTab v-else-if="activeTab === 'attr'" />
      <BaTreeTab v-else-if="activeTab === 'ba'" @open-device="openDevice" />
      <LinkCenterTab v-else-if="activeTab === 'link'" />
      <VizSearchTab v-else-if="activeTab === 'search'" @open-device="openDevice" />
      <ImportTab v-else-if="activeTab === 'import'" />
    </div>

    <DeviceDetailDrawer
      :open="!!codeQuery"
      :device-code="codeQuery || null"
      @update:open="onDrawerOpen"
      @navigate="openDevice"
      @go-link="onGoLink"
      @go-table="onGoTable"
    />
  </div>
</template>

<style scoped>
.viz {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.viz__tabs :deep(.el-tabs__header) {
  margin-bottom: var(--space-4);
}

.viz__tabs :deep(.el-tabs__content) {
  display: none;
}

.viz__tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.viz__body {
  min-width: 0;
}
</style>
