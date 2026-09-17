<script setup lang="ts">
/**
 * 关联设备列表（设备数据面板底部）
 * =====================================================================
 * 列出与起点设备相关的其它节点：名称 / 编号 / 子系统 + 直连关系类型 + 跳数；
 * 点击任一节点 → 切换到该设备继续追溯（emit `pick`）。
 *
 * 纪律：行内 flex 子项一律 `min-width: 0`，长名与长编号各自省略，不互相挤压（红线 ②）。
 */
import { computed } from 'vue'
import { Connection } from '@element-plus/icons-vue'
import type { SearchEdge, SearchNode } from '@/types/asset'

const props = defineProps<{
  nodes: SearchNode[]
  startCode: string
  edges: SearchEdge[]
}>()

const emit = defineEmits<{
  (e: 'pick', code: string): void
}>()

/** 与起点的直连关系类型（无直连边返回 null） */
function relationOf(code: string): string | null {
  const edge = props.edges.find(
    (x) => (x.from === props.startCode && x.to === code) || (x.to === props.startCode && x.from === code),
  )
  return edge?.type ?? null
}

const related = computed(() => props.nodes.filter((node) => node.device_code !== props.startCode))
</script>

<template>
  <ul v-if="related.length > 0" class="drel">
    <li v-for="node in related" :key="node.device_code" class="drel__item">
      <button
        type="button"
        class="drel__btn"
        :title="`切换到 ${node.name || node.device_code} 继续追溯`"
        @click="emit('pick', node.device_code)"
      >
        <span class="drel__main">
          <span class="drel__name ellipsis">{{ node.name || node.device_code }}</span>
          <span
            v-if="node.name && node.name !== node.device_code"
            class="drel__code mono break-code"
          >
            {{ node.device_code }}
          </span>
          <el-tag v-if="node.subsystem_name" size="small" effect="plain">
            {{ node.subsystem_name }}
          </el-tag>
        </span>

        <span class="drel__side">
          <span v-if="relationOf(node.device_code)" class="drel__rel">
            <el-icon :size="14"><Connection /></el-icon>
            <span>{{ relationOf(node.device_code) }}</span>
          </span>
          <span class="tnum">{{ node.depth }} 跳</span>
        </span>
      </button>
    </li>
  </ul>

  <p v-else class="drel__empty">该设备暂无关联设备。</p>
</template>

<style scoped>
.drel {
  list-style: none;
  margin: 0;
  padding: 0;
}

.drel__item + .drel__item {
  border-top: 1px solid var(--border-soft);
}

.drel__btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  padding: var(--space-2) 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.drel__btn:hover {
  background: var(--surface-2);
}

.drel__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.drel__name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.drel__code {
  font-size: var(--text-xs);
  color: var(--muted);
}

.drel__side {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-xs);
  color: var(--muted);
}

.drel__rel {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.drel__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}
</style>
