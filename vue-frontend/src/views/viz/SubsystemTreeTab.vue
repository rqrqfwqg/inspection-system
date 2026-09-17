<script setup lang="ts">
/**
 * 子系统树 Tab（/asset-viz?tab=subsystem）
 * 子系统 → 分类 / 供电分层 → 设备 逐级下钻。
 *
 * 供电分层（「电力系统下的供电系统分层」）：按供电方向逐级下钻
 * 变电所 → 变压器 → 低压配电屏 → 配电回路 → 配电箱 → 楼层配电设备。
 *
 * 与 React 版一致：点节点只展开/折叠，**不再隐式切 Tab**；按子系统过滤是显式动作
 * （悬停子系统节点时出现的漏斗按钮），避免误触把视图切走。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Filter, Folder } from '@element-plus/icons-vue'
import RelTree from '@/components/common/RelTree.vue'
import { getSubsystemTree } from '@/api/assetViz'
import type { RelNode } from '@/types/assetViz'

const emit = defineEmits<{
  (e: 'open-device', code: string): void
  (e: 'select-subsystem', code: string): void
}>()

const refreshToken = ref(0)
const selectedKey = ref('')

/** label 本身即编号的节点类型（等宽字体） */
const MONO_TYPES = ['device', 'power_circuit', 'power_box', 'power_trafo', 'power_item', 'record']

function loader(parent?: string): Promise<RelNode[]> {
  return getSubsystemTree(parent)
}

function onSelect(node: RelNode) {
  selectedKey.value = node.key
  if (node.type === 'device') emit('open-device', String(node.meta?.device_code ?? ''))
}

/** 设备节点不展开（点它是看详情）；其余有下级的节点点击即展开 */
function expandOnClick(node: RelNode): boolean {
  return node.type !== 'device'
}

function onLoadError(msg: string) {
  ElMessage({ type: 'error', message: msg, duration: 3000 })
}

function tableText(node: RelNode): string {
  const tables = Number(node.meta?.table_count ?? 0)
  const records = Number(node.meta?.record_count ?? 0)
  return `${tables} 张表 · ${records.toLocaleString('zh-CN')} 条`
}
</script>

<template>
  <div class="subtree">
    <section class="panel">
      <header class="panel-head">
        <h2 class="panel-title subtree__title">
          <el-icon :size="16"><Folder /></el-icon>
          子系统树（子系统 → 分类 / 供电分层 → 设备）
        </h2>
        <el-button size="small" @click="refreshToken += 1">刷新</el-button>
      </header>

      <RelTree
        :loader="loader"
        :reload-key="refreshToken"
        :selected-key="selectedKey"
        :mono-types="MONO_TYPES"
        empty-text="暂无子系统数据。若刚完成台账导入，请点击「刷新」重新加载。"
        :expand-on-click="expandOnClick"
        @select="onSelect"
        @load-error="onLoadError"
      >
        <template #badge="{ node }">
          <!-- 提供了 badge 插槽就会覆盖原语默认的 count 徽标，故这里显式补回 -->
          <el-tag v-if="node.count != null" size="small" type="info" effect="plain" class="tnum">
            {{ node.count }}
          </el-tag>
          <!-- 子系统节点补资料表口径：停用表（合表后的旧表）不计入，故合表后表数会明显下降 -->
          <el-tag
            v-if="node.type === 'subsystem' && node.meta?.table_count != null"
            size="small"
            type="info"
            effect="plain"
            class="tnum"
            :title="`启用中的资料表 ${tableText(node)}，设备数见左侧徽标。合表后旧表已停用，不计入。`"
          >
            {{ tableText(node) }}
          </el-tag>
          <el-button
            v-if="node.type === 'subsystem' && node.meta?.subsystem_code"
            class="subtree__filter"
            size="small"
            text
            :aria-label="`在概览中按 ${node.label} 过滤`"
            title="在概览中按此系统过滤"
            @click.stop="emit('select-subsystem', String(node.meta?.subsystem_code ?? ''))"
          >
            <el-icon :size="16"><Filter /></el-icon>
          </el-button>
        </template>
      </RelTree>

      <p class="subtree__hint">
        提示：点击节点展开/折叠下级，点击设备节点查看详情；子系统节点右侧漏斗按钮可在「概览」中按该系统过滤。
        电力系统下的「供电系统分层」按供电方向逐级下钻：变电所 → 变压器 → 低压配电屏 → 配电回路 → 配电箱 → 楼层配电设备。
      </p>
    </section>
  </div>
</template>

<style scoped>
.subtree {
  min-width: 0;
}

.subtree__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.subtree__filter {
  flex: 0 0 auto;
}

.subtree__hint {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border-soft);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}
</style>
