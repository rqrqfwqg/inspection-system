<script setup lang="ts">
/**
 * 设备台账 / 资产总台账（/asset/devices）—— 页面只做编排，数据访问全走 src/api/assetLedger.ts
 *
 * 关键行为（对齐 SPEC §9 与 UIUX §6/§7）
 *  - AC-05：首屏即分页请求（默认 50 条），绝不一次渲染 8455 条
 *  - AC-06：宽表在表格容器内横滚（由 DeviceLedgerTable 的局部容器承担），整页不横滚
 *  - AC-07：任一筛选变更即 page 归 1 并重新请求（patchFilters / resetFilters / onSortChange）
 *  - AC-08：排序只把 sort/order 下发给后端（空值恒排最后是后端职责，前端不本地排）
 *  - AC-09：行点击/详情按钮写 URL ?code=，抽屉由 URL 驱动，刷新仍可直达
 *  - 错误一律走 http.ts 的 formatApiError（422 detail 数组已拼成可读消息）
 *  - 并发安全：每个请求带序号，过期响应一律丢弃（快速连点筛选不会串数据）
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import DeviceDetailDrawer from '@/components/device/DeviceDetailDrawer.vue'
import DeviceFilterBar from '@/components/device/DeviceFilterBar.vue'
import DeviceLedgerTable from '@/components/device/DeviceLedgerTable.vue'
import LedgerSummaryCards from '@/components/device/LedgerSummaryCards.vue'
import {
  getAssetLedgerDetail, getAssetLedgerSummary, listAssetLedger, resolveAssetLedgerCode,
} from '@/api/assetLedger'
import { listSubsystems } from '@/api/dict'
import {
  LEDGER_DEFAULT_SORT, LEDGER_SORTABLE_KEYS, emptyFacets, emptyFilters, hasActiveFilters,
  type AssetLedgerDetail, type AssetLedgerFacets, type AssetLedgerFilters, type AssetLedgerQuery,
  type AssetLedgerRow, type AssetLedgerSortKey, type AssetLedgerState, type AssetLedgerSubsystemOption,
  type AssetLedgerSummary, type AssetLedgerSummaryQuery, type LedgerResolveResult,
} from '@/types/assetLedger'

const route = useRoute()
const router = useRouter()

const filters = ref<AssetLedgerFilters>(emptyFilters())
const sortProp = ref<AssetLedgerSortKey>(LEDGER_DEFAULT_SORT)
const sortOrder = ref<'asc' | 'desc'>('asc')
const page = ref(1)
const pageSize = ref(50)

const rows = ref<AssetLedgerRow[]>([])
const total = ref(0)
const pages = ref(0)
const facets = ref<AssetLedgerFacets>(emptyFacets())
const loading = ref(true)
const listError = ref('')

const summary = ref<AssetLedgerSummary | null>(null)
const summaryLoading = ref(false)
const summaryError = ref('')

const resolveResult = ref<LedgerResolveResult | null>(null)
const resolving = ref(false)

const detailCode = computed(() => (typeof route.query.code === 'string' ? route.query.code : ''))
const detail = ref<AssetLedgerDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')

const fallbackSubsystems = ref<AssetLedgerSubsystemOption[]>([])

const hasFilters = computed(() => hasActiveFilters(filters.value))
const warrantySoonDays = computed(() => summary.value?.warranty_soon_days ?? 90)
/** 子系统下拉优先用列表接口的 facets（与筛选口径一致）；facets 为空时回落字典接口 */
const facetData = computed<AssetLedgerFacets>(() =>
  facets.value.subsystems.length
    ? facets.value
    : { areas: facets.value.areas, use_depts: facets.value.use_depts, subsystems: fallbackSubsystems.value })

const listQuery = computed<AssetLedgerQuery>(() => ({
  q: filters.value.q || undefined,
  subsystem_id: filters.value.subsystem_id ?? undefined,
  area: filters.value.area || undefined,
  use_dept: filters.value.use_dept || undefined,
  state: filters.value.state || undefined,
  sort: sortProp.value,
  order: sortOrder.value,
  page: page.value,
  page_size: pageSize.value,
}))

const summaryQuery = computed<AssetLedgerSummaryQuery>(() => ({
  q: filters.value.q || undefined,
  subsystem_id: filters.value.subsystem_id ?? undefined,
  area: filters.value.area || undefined,
  use_dept: filters.value.use_dept || undefined,
}))

let listSeq = 0
async function loadList() {
  const my = ++listSeq
  loading.value = true
  listError.value = ''
  try {
    const res = await listAssetLedger(listQuery.value)
    if (my !== listSeq) return
    rows.value = res.items ?? []
    total.value = res.total ?? 0
    pages.value = res.pages ?? 0
    facets.value = res.facets ?? emptyFacets()
    // 分页边界：筛选后总页数变小、当前页越界时收敛到最后一页重取（否则会显示空页）
    if (!rows.value.length && total.value > 0 && page.value > 1) {
      page.value = Math.min(page.value, Math.max(1, pages.value))
      return
    }
    if (rows.value.length) resolveResult.value = null
    else void runResolve()
  } catch (e) {
    if (my !== listSeq) return
    rows.value = []
    total.value = 0
    pages.value = 0
    resolveResult.value = null
    listError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    if (my === listSeq) loading.value = false
  }
}

let summarySeq = 0
async function loadSummary() {
  const my = ++summarySeq
  summaryLoading.value = true
  summaryError.value = ''
  try {
    const s = await getAssetLedgerSummary(summaryQuery.value)
    if (my === summarySeq) summary.value = s
  } catch (e) {
    if (my === summarySeq) summaryError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    if (my === summarySeq) summaryLoading.value = false
  }
}

/** 空结果时用 ／resolve 反查机身编码/别名；这是辅助信息，失败即静默降级为普通空态（不给错误结论） */
let resolveSeq = 0
async function runResolve() {
  const q = filters.value.q.trim()
  const my = ++resolveSeq
  if (!q) {
    resolveResult.value = null
    resolving.value = false
    return
  }
  resolving.value = true
  try {
    const r = await resolveAssetLedgerCode(q, 5)
    if (my === resolveSeq) resolveResult.value = r
  } catch {
    if (my === resolveSeq) resolveResult.value = null
  } finally {
    if (my === resolveSeq) resolving.value = false
  }
}

let detailSeq = 0
async function loadDetail(code: string) {
  detailError.value = ''
  if (!code) {
    detailSeq += 1
    detail.value = null
    detailLoading.value = false
    return
  }
  const my = ++detailSeq
  detailLoading.value = true
  try {
    const d = await getAssetLedgerDetail(code)
    if (my === detailSeq) detail.value = d
  } catch (e) {
    if (my === detailSeq) {
      detail.value = null
      detailError.value = e instanceof Error ? e.message : '未知错误'
    }
  } finally {
    if (my === detailSeq) detailLoading.value = false
  }
}

function patchFilters(patch: Partial<AssetLedgerFilters>) {
  filters.value = { ...filters.value, ...patch }
  page.value = 1
}

function resetFilters() {
  filters.value = emptyFilters()
  page.value = 1
}

function onPickState(state: AssetLedgerState | '') {
  patchFilters({ state })
}

function onPageChange(p: number) { page.value = p }

function onPageSize(size: number) {
  pageSize.value = size
  page.value = 1
}

function onSortChange(payload: { prop: string; order: 'asc' | 'desc' }) {
  const prop = payload.prop as AssetLedgerSortKey
  if (!LEDGER_SORTABLE_KEYS.includes(prop)) return
  sortProp.value = prop
  sortOrder.value = payload.order
  page.value = 1
}

function openDetail(row: AssetLedgerRow) { openCode(row.device_code) }

/** AC-09：深链。打开用 push（浏览器返回可关抽屉），关闭用 replace（不额外堆历史） */
function openCode(code: string) {
  if (!code || code === detailCode.value) return
  void router.push({ query: { ...route.query, code } })
}

function closeDetail() {
  const next: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(route.query)) {
    if (k === 'code' || v === null) continue
    if (typeof v === 'string') next[k] = v
    else next[k] = v.filter((x): x is string => typeof x === 'string')
  }
  void router.replace({ query: next })
}

function onDrawerVisible(v: boolean) {
  if (!v) closeDetail()
}

function retryDetail() { void loadDetail(detailCode.value) }

watch(listQuery, () => { void loadList() }, { immediate: true })
watch(summaryQuery, () => { void loadSummary() }, { immediate: true })
watch(detailCode, (code) => { void loadDetail(code) }, { immediate: true })

onMounted(async () => {
  try {
    const list = await listSubsystems()
    fallbackSubsystems.value = list.map((s) => ({ id: s.id, name: s.name }))
  } catch {
    // 字典接口失败不阻断台账（子系统下拉仍可用列表接口的 facets）
    fallbackSubsystems.value = []
  }
})
</script>

<template>
  <div class="ledger">
    <header class="ledger__head">
      <div class="ledger__titles">
        <h1 class="ledger__title">设备台账</h1>
        <p class="ledger__sub">
          全量资产总台账：合并「设备主表 + 现场台账记录 + 固定资产」，可按子系统、区域、使用单位、保修状态与关键字检索。
        </p>
      </div>
      <el-button class="ledger__refresh" :loading="loading" @click="loadList">
        <el-icon v-if="!loading" :size="16"><Refresh /></el-icon>
        <span>刷新</span>
      </el-button>
    </header>

    <LedgerSummaryCards
      :summary="summary"
      :loading="summaryLoading"
      :active-state="filters.state"
      @pick-state="onPickState"
    />

    <p v-if="summaryError" class="ledger__warn" role="status">
      <el-icon :size="16"><WarningFilled /></el-icon>
      <span>汇总数据加载失败：{{ summaryError }}（下方明细列表不受影响）</span>
    </p>

    <DeviceFilterBar
      :filters="filters"
      :facets="facetData"
      :page-size="pageSize"
      :page="page"
      :pages="pages"
      :total="total"
      :has-filters="hasFilters"
      :loading="loading"
      :warranty-soon-days="warrantySoonDays"
      @patch="patchFilters"
      @reset="resetFilters"
      @page-size="onPageSize"
    />

    <div class="ledger__table">
      <DeviceLedgerTable
        :rows="rows"
        :loading="loading"
        :error="listError"
        :total="total"
        :page="page"
        :page-size="pageSize"
        :pages="pages"
        :has-filters="hasFilters"
        :sort-prop="sortProp"
        :sort-order="sortOrder"
        :resolve-result="resolveResult"
        :resolving="resolving"
        @page-change="onPageChange"
        @sort-change="onSortChange"
        @open-detail="openDetail"
        @open-code="openCode"
        @reset-filters="resetFilters"
        @retry="loadList"
      />
    </div>

    <DeviceDetailDrawer
      :model-value="!!detailCode"
      :code="detailCode"
      :detail="detail"
      :loading="detailLoading"
      :error="detailError"
      @update:model-value="onDrawerVisible"
      @open-code="openCode"
      @retry="retryDetail"
    />
  </div>
</template>

<style scoped>
/* 页面撑满内容区高度：只有表格自己滚，外壳只保留一个滚动条（AC-01 / AC-06） */
.ledger { display: flex; flex-direction: column; gap: var(--space-4); height: 100%; min-height: 0; min-width: 0; }

.ledger__head { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-3); min-width: 0; }
.ledger__titles { min-width: 0; }
.ledger__title { margin: 0; font-size: var(--text-2xl); line-height: var(--leading-tight); font-weight: var(--weight-announce); letter-spacing: var(--tracking-display); color: var(--fg); }
.ledger__sub { margin: var(--space-1) 0 0; max-width: 76ch; font-size: var(--text-sm); line-height: var(--leading-body); color: var(--fg-2); }
.ledger__refresh { flex: 0 0 auto; }

.ledger__warn { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--warn-bg); color: var(--warn-fg); font-size: var(--text-sm); }

/* 表格区弹性且 min-height:0：flex 子项默认 min-height:auto 会把外壳顶高、滚动逃逸到 body */
.ledger__table { flex: 1 1 auto; min-height: 240px; min-width: 0; display: flex; }

@media (max-width: 1279px) {
  .ledger { gap: var(--space-3); }
  .ledger__title { font-size: var(--text-xl); }
}
</style>
