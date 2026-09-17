<script setup lang="ts">
/**
 * 数据表管理（/asset/ledger 与 /asset/ledger/:tableId）· 只做编排
 * =====================================================================
 * 由 React `pages/asset/AssetLedgerPage.tsx`（585 行）等价迁移。加载 / 竞态 / 危险确认全在
 * `useLedgerCatalog` + `useLedgerTable`；两种模式的展示分别交给：
 *  - 概览 → `LedgerCatalogPanel`（卡片网格 + 全表搜索）
 *  - 单表 → `LedgerDetailHeader` + `LedgerLinkStrip` + `DynamicRecordTable` + 三个弹窗
 *
 * 纪律：不 import `@/router`、不改 `src/styles/**`；路由参数只 `useRoute()` **读**，不在此装配路由；
 * 颜色走设计令牌；无 emoji；宽表横滚交给 DynamicRecordTable 的局部容器（红线 ② / ③）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import CrossRefDialog from '@/components/ledger/CrossRefDialog.vue'
import DynamicRecordTable from '@/components/ledger/DynamicRecordTable.vue'
import LedgerCatalogPanel from '@/components/ledger/LedgerCatalogPanel.vue'
import LedgerDetailHeader from '@/components/ledger/LedgerDetailHeader.vue'
import LedgerLinkStrip from '@/components/ledger/LedgerLinkStrip.vue'
import RecordEditDialog from '@/components/ledger/RecordEditDialog.vue'
import RecordTransferDialog from '@/components/ledger/RecordTransferDialog.vue'
import TableKeyDialog from '@/components/ledger/TableKeyDialog.vue'
import { useLedgerCatalog } from '@/composables/useLedgerCatalog'
import { useLedgerTable } from '@/composables/useLedgerTable'
import type { DataTable } from '@/types/asset'

const route = useRoute()
const router = useRouter()

const catalog = useLedgerCatalog()

/** 路由参数 → 表 id（非数字 / 缺失一律 null = 概览模式） */
const tableId = computed<number | null>(() => {
  const raw = route.params.tableId
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
})

const activeTable = computed<DataTable | null>(
  () => catalog.tables.value.find((t) => t.id === tableId.value) ?? null,
)

const table = useLedgerTable(tableId, () => activeTable.value?.name ?? '')

const keyDialogTable = ref<DataTable | null>(null)

function openTable(id: number) {
  void router.push(`/asset/ledger/${id}`)
}

function backToCatalog() {
  void router.push('/asset/ledger')
}

/** 跨表跳转：关闭弹窗后切到目标表，并按命中编号预填表内搜索（同表则就地过滤） */
function handleCrossJump(tid: number, value: string) {
  table.closeCrossRefs()
  if (tid === tableId.value) {
    table.rowQuery.value = value
    return
  }
  table.setPendingQuery(value)
  void router.push(`/asset/ledger/${tid}`)
}

/** 关键键保存成功：目录标签 + 画像 + 当前表字段/记录全部重算 */
function handleKeySaved() {
  void catalog.loadCatalog()
  void catalog.loadOverview()
  if (tableId.value) {
    void table.load()
    void table.loadLinkDetail()
  }
}

async function handleFile(file: File) {
  if (!tableId.value) return
  await table.importFile(file)
}

onMounted(() => {
  void catalog.reload()
})

/** 记录数变化（删除 / 导入 / 转移）→ 刷新概览卡片的记录数 */
watch(
  () => table.catalogDirty.value,
  () => {
    void catalog.loadCatalog()
  },
)

/** 切表：清空弹窗、选择与行过滤，再并行取记录与画像 */
watch(
  tableId,
  () => {
    table.closeEdit()
    table.closeTransfer()
    table.closeCrossRefs()
    table.setSelection([])
    table.rowQuery.value = ''
    void table.load()
    void table.loadLinkDetail()
  },
  { immediate: true },
)
</script>

<template>
  <div class="lv">
    <template v-if="tableId === null">
      <LedgerCatalogPanel
        :tables="catalog.tables.value"
        :subsystems="catalog.subsystems.value"
        :loading="catalog.loading.value"
        :error="catalog.error.value"
        :stat-map="catalog.statMap.value"
        @open="openTable"
        @set-key="keyDialogTable = $event"
        @jump="handleCrossJump"
        @retry="catalog.reload()"
      />
    </template>

    <template v-else>
      <LedgerDetailHeader
        :table-id="tableId"
        :table-name="activeTable?.name || ''"
        :subsystem-name="activeTable?.subsystem_name || ''"
        :table-code="activeTable?.code || ''"
        :record-count="table.records.value.length"
        :field-count="table.fields.value.length"
        :coverage="table.linkDetail.value?.coverage.coverage ?? null"
        :relation-key-label="table.relationField.value?.label || ''"
        :importing="table.importing.value"
        :selected-count="table.selectedIds.value.length"
        @back="backToCatalog"
        @create="table.openCreate()"
        @export="table.exportExcel()"
        @transfer="table.openTransfer(table.selectedIds.value)"
        @set-key="activeTable && (keyDialogTable = activeTable)"
        @file="handleFile"
      />

      <LedgerLinkStrip v-if="table.linkDetail.value" :detail="table.linkDetail.value" />

      <div class="lv__bar">
        <el-input
          v-model="table.rowQuery.value"
          class="lv__search"
          clearable
          aria-label="表内搜索（挑出分错系统的记录）"
          placeholder="表内搜索（挑出分错系统的）"
        >
          <template #prefix><el-icon :size="16"><Search /></el-icon></template>
        </el-input>
        <span v-if="table.rowQuery.value" class="lv__count">
          命中 <span class="tnum">{{ table.visibleRecords.value.length }}</span> /
          <span class="tnum">{{ table.records.value.length }}</span> 条（全选仅作用于筛选结果）
        </span>
      </div>

      <p v-if="table.error.value" class="lv__warn" role="alert">
        <span>记录加载失败：{{ table.error.value }}</span>
        <el-button link @click="table.load()">重试</el-button>
      </p>

      <p v-if="table.loading.value" class="lv__hint panel" role="status">正在加载该表的字段与记录…</p>

      <DynamicRecordTable
        v-else
        :title="activeTable?.name || ''"
        :records="table.visibleRecords.value"
        :fields="table.fields.value"
        selectable
        can-edit
        can-delete
        can-transfer
        can-cross-refs
        :selected-ids="table.selectedIds.value"
        @selection-change="table.setSelection"
        @edit="table.openEdit"
        @delete="table.removeRecord"
        @transfer="(row) => table.openTransfer([row.id])"
        @cross-refs="table.openCrossRefs"
      />

      <RecordEditDialog
        :model-value="table.editOpen.value"
        :table-id="tableId ?? 0"
        :fields="table.fields.value"
        :initial="table.editInitial.value"
        @update:model-value="(open: boolean) => { if (!open) table.closeEdit() }"
        @saved="table.onEditSaved"
      />

      <RecordTransferDialog
        :model-value="table.transferIds.value !== null"
        :source-table="activeTable"
        :record-ids="table.transferIds.value ?? []"
        :tables="catalog.tables.value"
        @update:model-value="(open: boolean) => { if (!open) table.closeTransfer() }"
        @done="table.onTransferred"
      />

      <CrossRefDialog
        :model-value="table.crossRecord.value !== null"
        :table-id="tableId ?? 0"
        :record="table.crossRecord.value"
        @update:model-value="(open: boolean) => { if (!open) table.closeCrossRefs() }"
        @jump="handleCrossJump"
      />
    </template>

    <!-- 关键键弹窗：概览卡片 / 单表页头两处入口共用一份 -->
    <TableKeyDialog
      :model-value="keyDialogTable !== null"
      :table-id="keyDialogTable?.id ?? 0"
      :table-name="keyDialogTable?.name"
      @update:model-value="(open: boolean) => { if (!open) keyDialogTable = null }"
      @saved="handleKeySaved"
    />
  </div>
</template>

<style scoped>
.lv {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.lv__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.lv__search {
  flex: 1 1 240px;
  max-width: 420px;
}

.lv__count {
  font-size: var(--text-xs);
  color: var(--muted);
}

.lv__hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-10) var(--space-4);
  font-size: var(--text-sm);
  color: var(--muted);
  text-align: center;
}

.lv__warn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--warn);
  border-radius: var(--radius-md);
  background: var(--warn-bg);
  color: var(--warn-fg);
  font-size: var(--text-sm);
}
</style>
