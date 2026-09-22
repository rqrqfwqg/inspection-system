<script setup lang="ts">
/**
 * 资料配置 · 资料表与字段 Tab（编排层）
 * =====================================================================
 * 结构：`SettingsTableList`（左，列表 + 新建/删除） | `TableProfilePanel`（右，数据画像）+ `FieldManager`。
 * 本文件只做编排与数据操作：拉资料表 / 字段 / 单表画像，并把事件接回 API 与父级刷新。
 *
 * 纪律：
 *  - 自持局部状态（tables / fields / detail），不把巨型 state 抬回页面；
 *  - 删除资料表是级联操作，必须 `ElMessageBox` 二次确认并写清影响面；
 *  - 画像失败**静默降级**（不渲染画像块），不阻断字段管理。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import assetApi from '@/api/assetApi'
import { getLinkTable } from '@/api/assetViz'
import { confirmDeleteTable } from '@/lib/ledgerDanger'
import SettingsTableList from './SettingsTableList.vue'
import TableProfilePanel from './TableProfilePanel.vue'
import FieldManager from './FieldManager.vue'
import type { FieldDef, DataTable } from '@/types/asset'
import type { Subsystem } from '@/api/dict'
import type { LinkOverview, LinkTableDetail, LinkTableStat } from '@/types/assetViz'

const props = defineProps<{
  subsystems: Subsystem[]
  overview: LinkOverview | null
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const subId = ref('')
const tables = ref<DataTable[]>([])
const selectedTableId = ref('')
const fields = ref<FieldDef[]>([])
const detail = ref<LinkTableDetail | null>(null)
const loadingTables = ref(false)

const activeTable = computed<DataTable | null>(
  () => tables.value.find((t) => String(t.id) === selectedTableId.value) ?? null,
)

const statMap = computed<Map<number, LinkTableStat>>(() => {
  const map = new Map<number, LinkTableStat>()
  for (const stat of props.overview?.tables ?? []) map.set(stat.table_id, stat)
  return map
})

const fillRates = computed<Record<number, number>>(() => {
  const rates: Record<number, number> = {}
  for (const field of detail.value?.fields ?? []) rates[field.id] = field.fill_rate
  return rates
})

let tableSeq = 0

async function reloadTables(id: string) {
  const mine = ++tableSeq
  if (!id) {
    tables.value = []
    return
  }
  loadingTables.value = true
  try {
    const list = await assetApi.listTables(Number(id))
    if (mine === tableSeq) tables.value = list
  } catch (e) {
    if (mine === tableSeq) {
      tables.value = []
      ElMessage.error(e instanceof Error ? e.message : '加载资料表失败')
    }
  } finally {
    if (mine === tableSeq) loadingTables.value = false
  }
}

let fieldSeq = 0

async function loadTableDetail(table: DataTable | null) {
  const mine = ++fieldSeq
  if (!table) {
    fields.value = []
    detail.value = null
    return
  }
  try {
    const [fieldList, tableDetail] = await Promise.all([
      assetApi.listFields(table.id),
      getLinkTable(table.id).catch(() => null),
    ])
    if (mine !== fieldSeq) return
    fields.value = fieldList
    detail.value = tableDetail
  } catch (e) {
    if (mine !== fieldSeq) return
    fields.value = []
    detail.value = null
    ElMessage.error(e instanceof Error ? e.message : '加载字段失败')
  }
}

watch(subId, (id) => {
  selectedTableId.value = ''
  void reloadTables(id)
})

watch(activeTable, (table) => {
  void loadTableDetail(table)
})

async function onCreate(payload: { code: string; name: string }) {
  if (!subId.value) {
    ElMessage.warning('请先选择子系统')
    return
  }
  try {
    await assetApi.createTable({ subsystem_id: Number(subId.value), code: payload.code, name: payload.name })
    ElMessage.success('资料表已创建')
    await reloadTables(subId.value)
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '创建失败')
  }
}

async function onRemove(table: DataTable) {
  // 与「数据表管理」概览卡同一护栏（必须输入 code 才能提交，文案含记录数/字段数）
  const ok = await confirmDeleteTable(table)
  if (!ok) return
  try {
    await assetApi.deleteTable(table.id)
    ElMessage.success(`资料表「${table.name}」已彻底删除`)
    if (String(table.id) === selectedTableId.value) selectedTableId.value = ''
    await reloadTables(subId.value)
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function onFieldChanged() {
  await reloadTables(subId.value)
  if (activeTable.value) await loadTableDetail(activeTable.value)
  emit('changed')
}
</script>

<template>
  <div class="sftab">
    <label class="sftab__pick">
      <span class="sftab__pick-label">所属子系统</span>
      <el-select v-model="subId" class="sftab__pick-ctl" placeholder="选择子系统">
        <el-option
          v-for="subsystem in props.subsystems"
          :key="subsystem.id"
          :label="subsystem.name"
          :value="String(subsystem.id)"
        />
      </el-select>
    </label>

    <p v-if="!subId" class="sftab__hint">请先选择子系统，再管理其下的资料表与字段。</p>

    <div v-else class="sftab__body">
      <div class="sftab__col">
        <SettingsTableList
          :tables="tables"
          :loading="loadingTables"
          :selected-id="selectedTableId"
          :stat-map="statMap"
          @select="selectedTableId = $event"
          @create="onCreate"
          @remove="onRemove"
        />
      </div>

      <div class="sftab__col">
        <p v-if="!activeTable" class="sftab__hint">请选择左侧资料表以管理其字段定义。</p>
        <template v-else>
          <TableProfilePanel v-if="detail" :detail="detail" />
          <FieldManager
            :table-id="activeTable.id"
            :table-name="activeTable.name"
            :fields="fields"
            :fill-rates="fillRates"
            @changed="onFieldChanged"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sftab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.sftab__pick {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 320px;
  min-width: 0;
}

.sftab__pick-label {
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.sftab__pick-ctl {
  width: 100%;
}

.sftab__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.sftab__body {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

@media (max-width: 1279px) {
  .sftab__body {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sftab__col {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
</style>
