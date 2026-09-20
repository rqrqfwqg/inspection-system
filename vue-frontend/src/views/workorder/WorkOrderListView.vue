<script setup lang="ts">
/**
 * 工单列表（/workorder/list）—— 页面只做编排，数据访问全走 src/api/workOrderApi.ts
 * =====================================================================
 * 关键行为（对齐 UIUX 页面 1）：
 *   - 任一筛选变更 → page 归 1 并重新请求；筛选同步到 URL query（可分享、刷新不丢）；
 *   - 行点击用 **push** 进详情（浏览器返回可复原列表）；
 *   - 行内快捷动作只给 1 个主操作（派单 / 开始 / 完成），其余进详情；
 *   - 并发安全：每个请求带序号，过期响应一律丢弃（快速连点筛选不会串数据）；
 *   - 0 结果但 total>0 → 收敛到最后一页重取（照抄台账逻辑）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PageHead from '@/components/common/PageHead.vue'
import AssignDialog from '@/components/workorder/AssignDialog.vue'
import WorkOrderFilterBar from '@/components/workorder/WorkOrderFilterBar.vue'
import WorkOrderTable from '@/components/workorder/WorkOrderTable.vue'
import { completeWorkOrder, dispatchWorkOrder, listWorkOrders, startWorkOrder, WoApiError } from '@/api/workOrderApi'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { classifyWoError } from '@/lib/woOffline'
import { WO_PRIORITY_LABELS, WO_STATUS_FILTERS, WO_TYPE_LABELS, woStatusLabel } from '@/types/workOrderMeta'
import {
  WO_PAGE_SIZES, emptyWoFilters, hasActiveWoFilters,
  type WorkOrder, type WorkOrderFilters, type WorkOrderPriority, type WorkOrderQuery,
  type WorkOrderStatus, type WorkOrderType,
} from '@/types/workOrder'

const route = useRoute()
const router = useRouter()
const { currentUser } = useCurrentUser()

/**
 * 合法枚举白名单（从标签映射派生 = 单一真源，枚举增删自动跟随）。
 * 用途：URL query 里手改 / 过期的非法值（如 ?status=foo）一律丢弃 = 不筛，
 * **绝不透传后端**（前端第一道防线；后端枚举校验 400+40000 是兜底）。
 */
const WO_TYPE_KEYS = Object.keys(WO_TYPE_LABELS) as WorkOrderType[]
const WO_PRIORITY_KEYS = Object.keys(WO_PRIORITY_LABELS) as WorkOrderPriority[]

/** 只接受白名单内的值；非法值返回 ''（等于不筛），不弹错（用户只是打开了一个旧链接） */
function pickEnum<T extends string>(raw: string, allowed: readonly T[]): T | '' {
  return raw !== '' && (allowed as readonly string[]).includes(raw) ? (raw as T) : ''
}

const filters = ref<WorkOrderFilters>(emptyWoFilters())
const page = ref(1)
const pageSize = ref(20)
const sortProp = ref('')
const sortOrder = ref<'asc' | 'desc'>('desc')

const rows = ref<WorkOrder[]>([])
const total = ref(0)
const pages = ref(0)
const loading = ref(false)
const listError = ref('')
const readonly = ref(false)

const onlyMine = ref(false)
const assignOpen = ref(false)
const assignRow = ref<WorkOrder | null>(null)
const busy = ref(false)

const hasFilters = computed(() => hasActiveWoFilters(filters.value))

const listQuery = computed<WorkOrderQuery>(() => ({
  q: filters.value.q || undefined,
  status: filters.value.status || undefined,
  type: filters.value.type || undefined,
  priority: filters.value.priority || undefined,
  assignee_id: filters.value.assignee_id ?? undefined,
  room_code: filters.value.room_code || undefined,
  asset_device_code: filters.value.asset_device_code || undefined,
  due_from: filters.value.due_from || undefined,
  due_to: filters.value.due_to || undefined,
  sort: sortProp.value ? (sortProp.value as WorkOrderQuery['sort']) : undefined,
  order: sortProp.value ? sortOrder.value : undefined,
  page: page.value,
  page_size: pageSize.value,
}))

let listSeq = 0
async function loadList() {
  const my = ++listSeq
  loading.value = true
  listError.value = ''
  try {
    const res = await listWorkOrders(listQuery.value)
    if (my !== listSeq) return
    rows.value = res.items ?? []
    total.value = res.total ?? 0
    pages.value = res.page_size ? Math.max(1, Math.ceil((res.total ?? 0) / res.page_size)) : 0
    readonly.value = false
    if (!rows.value.length && total.value > 0 && page.value > 1) {
      page.value = Math.min(page.value, Math.max(1, pages.value))
    }
  } catch (e) {
    if (my !== listSeq) return
    rows.value = []
    total.value = 0
    pages.value = 0
    if (e instanceof WoApiError && e.isForbidden) {
      readonly.value = true
      listError.value = ''
    } else {
      listError.value = e instanceof Error ? e.message : '未知错误'
    }
  } finally {
    if (my === listSeq) loading.value = false
  }
}

/* ============================ URL 同步 ============================ */

function syncQuery() {
  const q: Record<string, string> = {}
  const f = filters.value
  if (f.q) q.q = f.q
  if (f.status) q.status = f.status
  if (f.type) q.type = f.type
  if (f.priority) q.priority = f.priority
  if (f.assignee_id !== null) q.assignee_id = String(f.assignee_id)
  if (f.room_code) q.room_code = f.room_code
  if (f.asset_device_code) q.asset_device_code = f.asset_device_code
  if (f.due_from) q.due_from = f.due_from
  if (f.due_to) q.due_to = f.due_to
  if (page.value > 1) q.page = String(page.value)
  if (pageSize.value !== 20) q.page_size = String(pageSize.value)
  void router.replace({ query: q })
}

function initFromQuery() {
  const s = (k: string): string => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '')
  const aidRaw = s('assignee_id')
  const aid = Number(aidRaw)
  filters.value = {
    q: s('q'),
    status: pickEnum(s('status'), WO_STATUS_FILTERS),
    type: pickEnum(s('type'), WO_TYPE_KEYS),
    priority: pickEnum(s('priority'), WO_PRIORITY_KEYS),
    assignee_id: aidRaw !== '' && Number.isFinite(aid) ? aid : null,
    room_code: s('room_code'),
    asset_device_code: s('asset_device_code'),
    due_from: s('due_from'),
    due_to: s('due_to'),
  }
  const p = Number(s('page'))
  page.value = Number.isFinite(p) && p > 0 ? p : 1
  const ps = Number(s('page_size'))
  if (WO_PAGE_SIZES.includes(ps)) pageSize.value = ps
}

function patchFilters(patch: Partial<WorkOrderFilters>) {
  filters.value = { ...filters.value, ...patch }
  page.value = 1
}
function resetFilters() {
  filters.value = emptyWoFilters()
  onlyMine.value = false
  page.value = 1
}
function pickStatus(s: WorkOrderStatus | '') {
  patchFilters({ status: s === '' ? '' : s })
}
function toggleMine() {
  onlyMine.value = !onlyMine.value
  patchFilters({ assignee_id: onlyMine.value ? currentUser.value?.id ?? null : null })
}
function onSortChange(payload: { prop: string; order: 'asc' | 'desc' }) {
  sortProp.value = payload.prop
  sortOrder.value = payload.order
  page.value = 1
}

function openDetail(row: WorkOrder) { void router.push(`/workorder/${row.id}`) }
function openCreate() { void router.push('/workorder/new') }
/** 设备编号点击 → 台账（不内嵌台账抽屉，语义不同） */
function openDevice(code: string) { void router.push({ path: '/asset/devices', query: { code } }) }

/* ============================ 行内快捷动作 ============================ */

function onQuickDispatch(row: WorkOrder) {
  assignRow.value = row
  assignOpen.value = true
}

async function onAssignSubmit(payload: { assignee_id: number; due_at?: string; note?: string }) {
  const row = assignRow.value
  if (!row) return
  busy.value = true
  try {
    await dispatchWorkOrder(row.id, { version: row.version, assignee_id: payload.assignee_id, due_at: payload.due_at, note: payload.note })
    ElMessage.success(`已派单给执行人，单号 ${row.code}`)
    assignOpen.value = false
    await loadList()
  } catch (e) {
    handleActionError(e, '派单')
  } finally {
    busy.value = false
  }
}

async function onQuickStart(row: WorkOrder) {
  busy.value = true
  try {
    await startWorkOrder(row.id, { version: row.version })
    ElMessage.success(`已开始处理，单号 ${row.code}`)
    await loadList()
  } catch (e) {
    handleActionError(e, '开始处理')
  } finally {
    busy.value = false
  }
}

async function onQuickComplete(row: WorkOrder) {
  busy.value = true
  try {
    await completeWorkOrder(row.id, { version: row.version })
    ElMessage.success(`已标记完成，单号 ${row.code}`)
    await loadList()
  } catch (e) {
    handleActionError(e, '标记完成')
  } finally {
    busy.value = false
  }
}

/** 行内动作错误分流：网络错误提示可离线补传；其余给出可读原因（不静默） */
function handleActionError(e: unknown, label: string) {
  const info = classifyWoError(e)
  if (info.kind === 'conflict') {
    ElMessage.warning(`该工单已被他人修改（服务端 ${info.serverVersion ?? '未知'}），请进入详情查看最新后重试`)
    return
  }
  if (info.enqueueable) {
    ElMessage.warning(`${label}失败：${info.message}。网络恢复后请在详情页重试。`)
    return
  }
  ElMessage.error(`${label}失败：${info.message}`)
}

watch(listQuery, () => { void loadList() })
watch(filters, () => { syncQuery() }, { deep: true })
watch([page, pageSize], () => { syncQuery() })

onMounted(() => {
  initFromQuery()
  void loadList()
})
</script>

<template>
  <div class="wo-list">
    <PageHead
      title="工单"
      desc="报修、派单、执行、验收在此形成完整可追溯记录。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon :size="16"><Plus /></el-icon><span>新建工单</span>
        </el-button>
        <el-button :loading="loading" @click="loadList">
          <el-icon v-if="!loading" :size="16"><Refresh /></el-icon><span>刷新</span>
        </el-button>
      </template>
    </PageHead>

    <p v-if="readonly" class="wo-list__note" role="status">
      当前账号无操作权限，仅可查看工单列表。
    </p>

    <div class="wo-tabs" role="group" aria-label="按状态快捷筛选">
      <button
        type="button"
        class="wo-tab"
        :class="{ 'is-active': filters.status === '' }"
        @click="pickStatus('')"
      >全部</button>
      <button
        v-for="s in WO_STATUS_FILTERS"
        :key="s"
        type="button"
        class="wo-tab"
        :class="{ 'is-active': filters.status === s }"
        @click="pickStatus(s)"
      >{{ woStatusLabel(s) }}</button>

      <div class="wo-tabs__right">
        <el-button :type="onlyMine ? 'primary' : 'default'" size="small" @click="toggleMine">只看我的</el-button>
        <el-select v-model="pageSize" size="small" class="wo-tabs__size" aria-label="每页条数" @change="page = 1">
          <el-option v-for="n in WO_PAGE_SIZES" :key="n" :label="`每页 ${n} 条`" :value="n" />
        </el-select>
      </div>
    </div>

    <WorkOrderFilterBar
      :filters="filters"
      :loading="loading"
      :has-filters="hasFilters"
      @patch="patchFilters"
      @reset="resetFilters"
    />

    <div class="wo-list__table">
      <WorkOrderTable
        :rows="rows"
        :loading="loading"
        :error="listError"
        :total="total"
        :page="page"
        :page-size="pageSize"
        :pages="pages"
        :has-filters="hasFilters"
        :readonly="readonly"
        :current-user-id="currentUser?.id ?? null"
        :sort-prop="sortProp"
        :sort-order="sortOrder"
        @page-change="page = $event"
        @sort-change="onSortChange"
        @open-detail="openDetail"
        @open-device="openDevice"
        @create="openCreate"
        @quick-dispatch="onQuickDispatch"
        @quick-start="onQuickStart"
        @quick-complete="onQuickComplete"
        @reset-filters="resetFilters"
        @retry="loadList"
      />
    </div>

    <AssignDialog v-model="assignOpen" :wo="assignRow" :busy="busy" @submit="onAssignSubmit" />
  </div>
</template>

<style scoped>
.wo-list { display: flex; flex-direction: column; gap: var(--space-4); height: 100%; min-height: 0; min-width: 0; }
.wo-list__note {
  margin: 0; padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--warn-bg); color: var(--warn-fg); font-size: var(--text-sm);
}
.wo-tabs { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); min-width: 0; }
.wo-tab {
  padding: 4px var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--fg-2);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}
.wo-tab:hover { background: var(--surface-3); color: var(--fg); }
.wo-tab.is-active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: var(--weight-emphasize); }
.wo-tab:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.wo-tabs__right { display: flex; align-items: center; gap: var(--space-2); margin-left: auto; }
.wo-tabs__size { width: 122px; }
.wo-list__table { flex: 1 1 auto; min-height: 240px; min-width: 0; display: flex; }
</style>
