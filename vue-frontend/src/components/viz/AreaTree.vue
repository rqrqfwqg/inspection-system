<script setup lang="ts">
/**
 * 区域树（区域总览左栏）—— 在 RelTree 原语之上补两件本视图独有的事：
 *  1. **范围聚合**：点楼层 / 类型组时，把该节点往下的全部设备收集出来
 *     （逐级下钻楼层 → 类型组 → 机房 → 设备）。分支并行、单支失败不影响其余
 *     （allSettled），避免一间机房的异常拖垮整层。
 *  2. **子层缓存**：树自身展开与范围聚合共用同一份缓存，同一节点不会请求两次。
 *     注意：缓存必须在筛选条件变化时清空，否则改了关键字还会展开出旧结果（静默错误）。
 */
import { watch } from 'vue'
import RelTree from '@/components/common/RelTree.vue'
import { getAreaTree } from '@/api/assetViz'
import type { RelNode } from '@/types/assetViz'

const props = withDefaults(
  defineProps<{
    keyword?: string
    onlyWithDevices?: boolean
    groupByType?: boolean
    /** 楼栋过滤（仅根层下发；React 版同口径） */
    building?: string
    refreshToken?: number
    selectedKey?: string
  }>(),
  { keyword: '', onlyWithDevices: false, groupByType: true, building: '', refreshToken: 0, selectedKey: '' },
)

const emit = defineEmits<{
  (e: 'open-device', code: string): void
  (e: 'select-range', node: RelNode, devices: RelNode[]): void
  (e: 'select-other', node: RelNode): void
  (e: 'load-error', message: string): void
}>()

const ROOT_KEY = '__root__'
const cache = new Map<string, RelNode[]>()

/** 根层带 building，子层不带（与 React 版 AreaTreeView:70 / 87 的下发口径一致） */
async function fetchChildren(parent?: string): Promise<RelNode[]> {
  const key = parent ?? ROOT_KEY
  const hit = cache.get(key)
  if (hit) return hit
  const rows = parent
    ? await getAreaTree(parent, {
        keyword: props.keyword,
        onlyWithDevices: props.onlyWithDevices,
        groupByType: props.groupByType,
      })
    : await getAreaTree(undefined, {
        keyword: props.keyword,
        onlyWithDevices: props.onlyWithDevices,
        building: props.building || undefined,
        groupByType: props.groupByType,
      })
  cache.set(key, rows)
  return rows
}

watch(
  () => [props.keyword, props.onlyWithDevices, props.groupByType, props.building].join('|'),
  () => cache.clear(),
)

/** 自该节点向下收集全部设备（并行、容错） */
async function collect(node: RelNode): Promise<RelNode[]> {
  const kids = await fetchChildren(node.key)
  const direct = kids.filter((k) => k.type === 'device')
  const branches = kids.filter((k) => k.type !== 'device' && k.has_children)
  if (branches.length === 0) return direct
  const settled = await Promise.allSettled(branches.map((b) => collect(b)))
  const out = [...direct]
  for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value)
  return out
}

async function onSelect(node: RelNode) {
  if (node.type === 'device') {
    emit('open-device', String(node.meta?.device_code ?? ''))
    return
  }
  emit('select-other', node)
  try {
    if (node.type === 'room') {
      const kids = await fetchChildren(node.key)
      emit('select-range', node, kids.filter((k) => k.type === 'device'))
    } else if (node.type === 'floor' || node.type === 'room_type') {
      emit('select-range', node, await collect(node))
    }
  } catch (e) {
    emit('load-error', e instanceof Error ? e.message : '加载范围内设备失败')
  }
}

/** 设备节点不展开（点它是看详情）；其余有下级的节点点击即展开 */
function expandOnClick(node: RelNode): boolean {
  return node.type !== 'device'
}
</script>

<template>
  <div class="areatree">
    <RelTree
      :loader="fetchChildren"
      :reload-key="refreshToken"
      :selected-key="selectedKey"
      mono-code-label
      empty-text="暂无区域数据（可清空关键字或关闭「仅有设备的机房」后重试）"
      :expand-on-click="expandOnClick"
      @select="onSelect"
      @load-error="emit('load-error', $event)"
    />
  </div>
</template>

<style scoped>
/* 树容器自身 min-width:0：长编号靠 label 单行省略 + tooltip，绝不撑破卡片（AC-15） */
.areatree {
  min-width: 0;
}
</style>
