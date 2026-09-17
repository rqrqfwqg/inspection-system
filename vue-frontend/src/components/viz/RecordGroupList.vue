<script setup lang="ts">
/**
 * 资料记录（按资料表分组折叠）——「设备详情」抽屉用，与「数据表管理」同源。
 * 每条记录用 FieldList 呈现原始字段（键名由后端 field_defs 决定，前端不猜语义）。
 * 分组头与「打开表」是两个并列按钮，避免 button 嵌套（HTML 非法 + 点击冒泡误触）。
 */
import { ref, watch } from 'vue'
import { ArrowDown, ArrowRight, Link } from '@element-plus/icons-vue'
import FieldList from '@/components/viz/FieldList.vue'

/** DeviceLinkResponse.groups 的元素形状 */
interface LinkGroup {
  table_id: number
  table_code: string | null
  table_name: string
  subsystem: { id: number; code: string; name: string; icon?: string } | null
  records: { id: number; table_id: number; device_code: string; data: Record<string, unknown> }[]
}

const props = defineProps<{ groups: LinkGroup[] }>()
const emit = defineEmits<{ (e: 'open-table', tableId: number): void }>()

/** 默认折叠（与 React 版一致），点分组头展开 */
const open = ref<Record<number, boolean>>({})

watch(() => props.groups, () => { open.value = {} })

function isOpen(id: number): boolean {
  return !!open.value[id]
}
function toggle(id: number) {
  open.value = { ...open.value, [id]: !open.value[id] }
}
</script>

<template>
  <div class="rgl">
    <div v-for="g in groups" :key="g.table_id" class="rgl__group">
      <div class="rgl__head">
        <button
          type="button"
          class="rgl__toggle"
          :aria-expanded="isOpen(g.table_id)"
          @click="toggle(g.table_id)"
        >
          <el-icon :size="16" class="rgl__caret">
            <ArrowDown v-if="isOpen(g.table_id)" />
            <ArrowRight v-else />
          </el-icon>
          <span class="rgl__name ellipsis" :title="g.table_name">{{ g.table_name }}</span>
          <el-tag v-if="g.subsystem" size="small" type="info" effect="plain">
            {{ g.subsystem.name }}
          </el-tag>
          <el-tag size="small" type="info" effect="light" class="tnum">{{ g.records.length }} 条</el-tag>
        </button>
        <button type="button" class="rgl__open" @click="emit('open-table', g.table_id)">
          <span>打开表</span>
          <el-icon :size="16"><Link /></el-icon>
        </button>
      </div>

      <div v-show="isOpen(g.table_id)" class="rgl__body">
        <div v-for="r in g.records" :key="r.id" class="rgl__record">
          <FieldList :data="r.data" :columns="3" empty-text="（空记录）" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rgl {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.rgl__group {
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.rgl__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  background: var(--surface-2);
}

.rgl__toggle {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.rgl__toggle:hover {
  background: var(--surface-3);
}

.rgl__caret {
  flex: 0 0 auto;
  color: var(--fg-2);
}

.rgl__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.rgl__open {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  font-size: var(--text-xs);
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
}

.rgl__open:hover {
  background: var(--accent-soft);
}

.rgl__body {
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-soft);
}

.rgl__record {
  padding: var(--space-2) 0;
  border-bottom: 1px dashed var(--border-soft);
}

.rgl__record:last-child {
  border-bottom: 0;
}
</style>
