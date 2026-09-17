<script setup lang="ts">
/**
 * 动态资料记录表（列由 `field_defs` 生成）
 * =====================================================================
 * 通用件：数据表管理单表视图 / 子系统资料分组（检索域）共用一张实现，
 * 避免 React 版里「基础信息表 + 资料记录表」两套列渲染各写一遍。
 *
 * 防压扁 / 溢出纪律（UIUX §6.4 / §6.6）：
 *  - 列宽**只用 min-width**（EP 按比例分配）；唯一允许写 `width` 的是复选框列与操作列；
 *  - 横滚只发生在本地 `.data-table-wrap` 容器，绝不写「整表最小宽度」（AS-7 / AC-06）；
 *  - 动态列默认 `show-overflow-tooltip`，编号类字段走 `.code-break` 强制断行不省略（编号少一位就查不到）；
 *  - 单元格取值一律走 `@/lib/format#fmtValue`（全站唯一格式化口径），空值恒呈现为「—」。
 */
import { computed } from 'vue'
import {
  Connection, Delete, Edit, Grid, Switch, TopRight,
} from '@element-plus/icons-vue'
import { fmtValue, isCodeLike } from '@/lib/format'
import type { FieldDef, RecordItem } from '@/types/asset'

const props = withDefaults(
  defineProps<{
    title: string
    records: RecordItem[]
    fields: FieldDef[]
    /** 多选（批量转移用） */
    selectable?: boolean
    selectedIds?: number[]
    canEdit?: boolean
    canDelete?: boolean
    canTransfer?: boolean
    canCrossRefs?: boolean
    /** 表头右侧「去数据表管理维护这张表」 */
    canOpenTable?: boolean
    /** 提供后每条记录左侧多出可点击的「关联键」列 → 打开该编号的设备详情 */
    canOpenDevice?: boolean
  }>(),
  {
    selectable: false,
    selectedIds: () => [],
    canEdit: false,
    canDelete: false,
    canTransfer: false,
    canCrossRefs: false,
    canOpenTable: false,
    canOpenDevice: false,
  },
)

const emit = defineEmits<{
  (e: 'selection-change', ids: number[]): void
  (e: 'edit', row: RecordItem): void
  (e: 'delete', row: RecordItem): void
  (e: 'transfer', row: RecordItem): void
  (e: 'cross-refs', row: RecordItem): void
  (e: 'open-table'): void
  (e: 'open-device', code: string): void
}>()

/** 列定义：字段定义优先；无字段定义时回落到首条记录的 data 键（后端字段名未冻结，原样展示） */
const columns = computed(() => {
  if (props.fields.length > 0) return props.fields.map((f) => ({ key: f.key, label: f.label }))
  return Object.keys(props.records[0]?.data ?? {}).map((key) => ({ key, label: key }))
})

const hasActions = computed(
  () => props.canEdit || props.canDelete || props.canTransfer || props.canCrossRefs,
)

const selected = computed(() => new Set(props.selectedIds))

function columnWidth(key: string): number {
  return isCodeLike(key) ? 180 : 140
}

function onSelectionChange(rows: RecordItem[]) {
  emit('selection-change', rows.map((row) => row.id))
}

function onRowClick(row: RecordItem) {
  if (props.canEdit) emit('edit', row)
}
</script>

<template>
  <section class="drt panel">
    <header class="drt__head">
      <el-icon :size="16" class="drt__icon"><Grid /></el-icon>
      <span class="drt__title ellipsis" :title="title">{{ title }}</span>
      <span class="drt__count tnum">{{ records.length }} 条</span>
      <el-button v-if="canOpenTable" size="small" @click="emit('open-table')">
        <el-icon :size="16"><TopRight /></el-icon>
        <span>数据表管理</span>
      </el-button>
    </header>

    <div class="data-table-wrap drt__wrap">
      <el-table
        :data="records"
        row-key="id"
        border
        :row-class-name="() => (canEdit ? 'drt__row--clickable' : '')"
        @selection-change="onSelectionChange"
        @row-click="onRowClick"
      >
        <el-table-column v-if="selectable" type="selection" width="44" :selectable="() => true" />

        <el-table-column v-if="canOpenDevice" label="关联键" min-width="170">
          <template #default="{ row }">
            <button
              v-if="row.device_code"
              type="button"
              class="drt__code mono break-code"
              title="打开该编号的设备详情"
              @click.stop="emit('open-device', row.device_code)"
            >
              {{ row.device_code }}
            </button>
            <span v-else class="drt__missing" title="该记录没有关联键，无法挂到任何设备">未填关联键</span>
          </template>
        </el-table-column>

        <el-table-column
          v-for="col in columns"
          :key="col.key"
          :label="col.label"
          :min-width="columnWidth(col.key)"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <span :class="isCodeLike(col.key) ? 'mono break-code' : ''">{{ fmtValue(row.data?.[col.key]) }}</span>
          </template>
        </el-table-column>

        <el-table-column v-if="hasActions" label="操作" width="146" align="right" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="canTransfer"
              link
              :aria-label="`把记录 ${row.device_code || row.id} 转移到其他资料表`"
              title="转移到其他资料表"
              @click.stop="emit('transfer', row)"
            >
              <el-icon :size="16"><Switch /></el-icon>
            </el-button>
            <el-button
              v-if="canCrossRefs"
              link
              :aria-label="`用记录 ${row.device_code || row.id} 的编号做跨表关联检索`"
              title="跨表关联：拿该记录的编号到其他表搜索"
              @click.stop="emit('cross-refs', row)"
            >
              <el-icon :size="16"><Connection /></el-icon>
            </el-button>
            <el-button
              v-if="canEdit"
              link
              :aria-label="`编辑记录 ${row.device_code || row.id}`"
              title="编辑该记录"
              @click.stop="emit('edit', row)"
            >
              <el-icon :size="16"><Edit /></el-icon>
            </el-button>
            <el-button
              v-if="canDelete"
              link
              type="danger"
              :aria-label="`删除记录 ${row.device_code || row.id}`"
              title="删除该记录"
              @click.stop="emit('delete', row)"
            >
              <el-icon :size="16"><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty
            :image-size="72"
            description="这张表还没有记录：可点「新增记录」手工补录，或用「Excel 导入」批量导入（表头需与字段名称一致）"
          />
        </template>
      </el-table>
    </div>

    <p v-if="selectable" class="drt__tip">
      已选 <span class="tnum">{{ selected.size }}</span> 条 —— 全选只作用于当前筛选结果。
    </p>
  </section>
</template>

<style scoped>
/* 表格自然高（内容区统一滚动），只约束横向：宽表在容器内横滚，不撑破页面（AC-06） */
.drt {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.drt__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
  background: var(--surface-2);
}

.drt__icon {
  color: var(--muted);
}

.drt__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.drt__count {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.drt__wrap {
  min-width: 0;
  max-width: 100%;
}

.drt__code {
  display: inline;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: var(--text-xs);
  cursor: pointer;
  text-align: left;
}

.drt__code:hover {
  text-decoration: underline;
}

.drt__missing {
  font-size: var(--text-xs);
  color: var(--warn-fg);
}

.drt__tip {
  margin: 0;
  padding: var(--space-1) var(--space-3);
  border-top: 1px solid var(--border-soft);
  font-size: var(--text-xs);
  color: var(--muted);
}

.drt :deep(.el-table__cell) {
  vertical-align: middle;
}

.drt :deep(.drt__row--clickable) {
  cursor: pointer;
}
</style>
