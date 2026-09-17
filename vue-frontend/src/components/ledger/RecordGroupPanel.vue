<script setup lang="ts">
/**
 * 某一个子系统下的资料明细：按资料表分块渲染，块内容复用通用件 DynamicRecordTable。
 *
 * 它是「设备 ↔ 资料表」双向联动的落点：
 *  - 表头「数据表管理」→ 去数据表管理维护这张表（可视化 / 检索侧打通）；
 *  - 「关联键」列可点击 → 打开该编号的设备详情（records → devices 方向联动）。
 */
import DynamicRecordTable from './DynamicRecordTable.vue'
import type { FieldDef, RecordItem, SearchGroup } from '@/types/asset'

const props = defineProps<{
  group: SearchGroup
  /** table_id → 该表的字段定义（列由字段定义生成） */
  fieldsMap: Record<number, FieldDef[]>
  canEdit?: boolean
  canDelete?: boolean
  canOpenTable?: boolean
  canOpenDevice?: boolean
}>()

const emit = defineEmits<{
  (e: 'edit-record', tableId: number, row: RecordItem): void
  (e: 'delete-record', tableId: number, row: RecordItem): void
  (e: 'open-table', tableId: number): void
  (e: 'open-device', code: string): void
}>()

function recordCount(): number {
  return props.group.tables.reduce((sum, table) => sum + table.records.length, 0)
}
</script>

<template>
  <section class="rgp panel">
    <header class="rgp__head">
      <h3 class="rgp__title ellipsis">{{ group.subsystem_name || '未归类' }}</h3>
      <span class="rgp__meta tnum">{{ group.tables.length }} 张表 · {{ recordCount() }} 条</span>
    </header>

    <div class="rgp__body">
      <DynamicRecordTable
        v-for="table in group.tables"
        :key="table.table_id"
        :title="table.table_name"
        :records="table.records"
        :fields="fieldsMap[table.table_id] || []"
        :can-edit="canEdit"
        :can-delete="canDelete"
        :can-open-table="canOpenTable"
        :can-open-device="canOpenDevice"
        @edit="(row) => emit('edit-record', table.table_id, row)"
        @delete="(row) => emit('delete-record', table.table_id, row)"
        @open-table="emit('open-table', table.table_id)"
        @open-device="(code) => emit('open-device', code)"
      />

      <p v-if="group.tables.length === 0" class="rgp__empty">
        该子系统下没有资料记录：可在「数据表管理」中为该系统的资料表补录或导入数据。
      </p>
    </div>
  </section>
</template>

<style scoped>
.rgp {
  min-width: 0;
}

.rgp__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  margin-bottom: var(--space-3);
}

.rgp__title {
  margin: 0;
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.rgp__meta {
  font-size: var(--text-xs);
  color: var(--muted);
}

/* 资料表分块之间用间距分层，不嵌卡片（禁止嵌套卡片反模式） */
.rgp__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.rgp__empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}
</style>
