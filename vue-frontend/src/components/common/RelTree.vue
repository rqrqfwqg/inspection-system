<script setup lang="ts">
/**
 * 懒加载树原语（区域树 / 子系统树 / 设备层级树 / BA 系统树 共用）
 * =====================================================================
 * 为什么必须收敛成一个原语：React 版里 4 个树页面各自手写了一遍
 * 「lazy + load + expandedKeys/loadingKeys Set + childrenMap + toggle」——
 * 4 份重复实现 = 4 份独立 bug，且每页的加载/失败处理口径都不一致。
 *
 * 约定：
 *  1. 展开时才请求后端（el-tree 的 lazy/load），绝不预取整棵树：
 *     8455 台账 / 871 房间全展开会直接卡死（UIUX §6.6）。
 *  2. `loader(parent?)` 由调用方注入 —— 调用方可以把同一份 loader 复用于
 *     「范围聚合」（区域树要按楼层收集其下全部设备），不在这里重复实现缓存。
 *  3. 根加载失败 → 内联错误态 + 重试（不给白屏）；子层加载失败 → 抛 `load-error`
 *     交由调用方 toast，已加载的同级节点不受影响。
 *  4. 节点 count 徽标默认渲染，调用方可用 `#badge` 覆盖（子系统补资料表口径、
 *     BA 补问题数）。
 */
import { computed, ref, watch, type Component } from 'vue'
import {
  Box, Connection, Cpu, Document, Files, Folder, Grid, House, Lightning, Monitor,
  OfficeBuilding, Refresh, SwitchButton, Tickets, Tools, WarningFilled,
} from '@element-plus/icons-vue'
import type { RelNode } from '@/types/assetViz'

/** 节点类型 → EP 图标（与锁定图标库一致；未命中回落 Box，不白屏） */
const NODE_ICONS: Record<string, Component> = {
  building: OfficeBuilding,
  floor: Grid,
  room_type: Folder,
  room: House,
  device: Cpu,
  accessory: Tools,
  category: Folder,
  subsystem: Box,
  power_root: Lightning,
  power_layer: Grid,
  power_substation: OfficeBuilding,
  power_trafo: Lightning,
  power_panel: Monitor,
  power_circuit: Connection,
  power_box: Box,
  power_floor: House,
  power_item: SwitchButton,
  table_group: Files,
  table: Tickets,
  record: Document,
  ba_system: Connection,
  ba_device: Cpu,
}

const props = withDefaults(
  defineProps<{
    /** 给定 parent（undefined = 根）返回该层子节点；调用方复用同一份函数做范围聚合 */
    loader: (parent?: string) => Promise<RelNode[]>
    /** 换值即整树重新加载（筛选条件变化 / 手动刷新） */
    reloadKey?: number
    /** 高亮节点 key（点击后由调用方回传） */
    selectedKey?: string
    emptyText?: string
    /** label 形如「名称（编号）」时把编号拆成等宽小字（机房 / 设备用，便于同名辨识） */
    monoCodeLabel?: boolean
    /** 这些节点类型的 label 本身即编号，用等宽字体（UIUX §3：1/l/I 与 0/O 必须可辨） */
    monoTypes?: string[]
    /** 点击是否展开该节点（默认：有下级才展开；设备节点一律交给调用方） */
    expandOnClick?: (node: RelNode) => boolean
  }>(),
  {
    reloadKey: 0,
    selectedKey: '',
    emptyText: '暂无数据',
    monoCodeLabel: false,
    monoTypes: () => [],
    expandOnClick: undefined,
  },
)

const emit = defineEmits<{
  (e: 'select', node: RelNode): void
  (e: 'load-error', message: string): void
}>()

/** el-tree 回调参数只取用得到的部分，避免深引 EP 内部类型 */
interface LoadNode {
  level: number
  data: RelNode
}
interface ClickNode {
  expanded: boolean
  expand: () => void
  collapse: () => void
}

const errorText = ref('')
const rootLoaded = ref(false)
const rootEmpty = ref(false)
/** 重试计数：与 reloadKey 一起构成 el-tree 的 key，触发真正的重新挂载 */
const attempt = ref(0)

function iconOf(type: string): Component {
  return NODE_ICONS[type] ?? Box
}

const treeProps = {
  label: 'label',
  isLeaf: (data: RelNode) => !data.has_children,
}

const treeKey = computed(() => `${props.reloadKey}:${attempt.value}`)

function reset() {
  errorText.value = ''
  rootLoaded.value = false
  rootEmpty.value = false
}

function retry() {
  reset()
  attempt.value += 1
}

watch(() => props.reloadKey, reset)

async function loadNode(node: LoadNode, resolve: (rows: RelNode[]) => void) {
  const isRoot = node.level === 0
  try {
    const rows = await props.loader(isRoot ? undefined : String(node.data.key ?? ''))
    if (isRoot) {
      rootLoaded.value = true
      rootEmpty.value = rows.length === 0
    }
    resolve(rows)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '加载失败'
    if (isRoot) {
      errorText.value = msg
      rootLoaded.value = true
      rootEmpty.value = true
    } else {
      emit('load-error', msg)
    }
    resolve([])
  }
}

function onNodeClick(data: RelNode, node: ClickNode) {
  emit('select', data)
  if (!data.has_children) return
  const want = props.expandOnClick ? props.expandOnClick(data) : true
  if (!want) return
  if (node.expanded) node.collapse()
  else node.expand()
}

/** 标签拆分结果缓存：模板里会取 main/code 两处，避免同一节点重复跑正则 */
const labelCache = new Map<string, { main: string; code: string }>()
const MONO_LABEL = /^(.*?)（(.+)）$/

function labelParts(label: string): { main: string; code: string } {
  const cached = labelCache.get(label)
  if (cached) return cached
  const m = props.monoCodeLabel ? label.match(MONO_LABEL) : null
  const parts = m ? { main: m[1], code: m[2] } : { main: label, code: '' }
  if (labelCache.size > 800) labelCache.clear()
  labelCache.set(label, parts)
  return parts
}
</script>

<template>
  <div class="reltree">
    <div v-if="errorText" class="reltree__state" role="alert">
      <el-icon :size="24" class="reltree__state-icon"><WarningFilled /></el-icon>
      <p class="reltree__state-title">树数据加载失败</p>
      <p class="reltree__state-desc">{{ errorText }}</p>
      <el-button size="small" @click="retry">
        <el-icon :size="16"><Refresh /></el-icon>
        <span>重试</span>
      </el-button>
    </div>

    <el-empty v-else-if="rootLoaded && rootEmpty" :image-size="72" :description="emptyText" />

    <el-tree
      v-else
      :key="treeKey"
      lazy
      :load="loadNode"
      :props="treeProps"
      node-key="key"
      :indent="14"
      :expand-on-click-node="false"
      @node-click="onNodeClick"
    >
      <template #default="{ data }">
        <span class="reltree__row" :class="{ 'reltree__row--on': data.key === selectedKey }">
          <el-icon :size="16" class="reltree__icon"><component :is="iconOf(data.type)" /></el-icon>
          <span class="reltree__label ellipsis" :class="{ 'reltree__label--mono': monoTypes.includes(data.type) }">
            {{ labelParts(data.label).main
            }}<span v-if="labelParts(data.label).code" class="reltree__code mono">（{{ labelParts(data.label).code }}）</span>
          </span>
          <slot name="badge" :node="data">
            <el-tag v-if="data.count != null" size="small" type="info" effect="plain" class="tnum">
              {{ data.count }}
            </el-tag>
          </slot>
        </span>
      </template>
    </el-tree>
  </div>
</template>

<style scoped>
.reltree {
  min-width: 0;
}

/* 节点行：图标与徽标不被压缩，长 label 单行省略（AS-10 / §6.5） */
.reltree__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  width: 100%;
  padding-right: var(--space-1);
  border-radius: var(--radius-sm);
}

.reltree__row--on {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.reltree__icon {
  flex: 0 0 auto;
  color: var(--muted);
}

.reltree__label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.reltree__code {
  font-size: var(--text-xs);
  color: var(--muted);
}

.reltree__label--mono {
  font-family: var(--font-mono);
  color: var(--fg-2);
}

.reltree :deep(.el-tree-node__content) {
  height: 30px;
}

.reltree :deep(.el-tree-node__content:hover) {
  background: var(--surface-3);
}

/* 空/错误态：自身可滚动，margin:auto 居中（不用 justify-content 以免裁切） */
.reltree__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--space-6) var(--space-3);
}

.reltree__state-icon {
  color: var(--danger);
}

.reltree__state-title {
  margin: var(--space-2) 0 0;
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.reltree__state-desc {
  margin: var(--space-1) auto var(--space-3);
  max-width: 52ch;
  font-size: var(--text-sm);
  color: var(--fg-2);
  line-height: var(--leading-body);
}
</style>
