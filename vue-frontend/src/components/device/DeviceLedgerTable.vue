<script setup lang="ts">
/**
 * 台账表格（宽表 + 分页 + 空/错误/空态反查）
 * 防压扁要点（UIUX §6.4 / SPEC §11）：
 *  - 列宽只用 min-width；唯一例外是 fixed 的操作列 width（UIUX §6.6 允许）
 *  - 绝不写「整表最小宽度」，横滚只发生在本地 .data-table-wrap 容器，整页不得被撑宽（AC-06）
 *  - el-table 用 height="100%" + 父链 flex/min-height:0 实现表头固定 + 体滚动，不写死 px 高
 *  - 列裁剪按 CSS 视口宽度（1280 档放不下 12 列，绝不靠缩字号硬塞）
 *  - 排序一律 EP custom 走后端（金额/日期空值由后端恒排最后），禁止前端本地排序（AC-08）
 *  - 空/错误态整体替换表体（不塞进表体固定高度里，避免 720 档被裁切）
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Document, Link, Refresh, WarningFilled } from '@element-plus/icons-vue'
import {
  fmtDate, fmtInt, fmtMoney, matchTypeLabel, warrantyTagType, warrantyText,
  type AssetLedgerRow, type LedgerResolveResult,
} from '@/types/assetLedger'

interface Props {
  rows: AssetLedgerRow[]
  loading: boolean
  error: string
  total: number
  page: number
  pageSize: number
  pages: number
  hasFilters: boolean
  sortProp: string
  sortOrder: 'asc' | 'desc'
  /** 空结果时由父级触发的台账反查结果（/assets/asset-ledger/resolve） */
  resolveResult: LedgerResolveResult | null
  resolving: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'page-change', page: number): void
  (e: 'sort-change', payload: { prop: string; order: 'asc' | 'desc' }): void
  (e: 'open-detail', row: AssetLedgerRow): void
  (e: 'open-code', code: string): void
  (e: 'reset-filters'): void
  (e: 'retry'): void
}>()

/** 断点按 CSS 视口（已含系统缩放），只看宽度，不读 devicePixelRatio / screen */
const vw = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const syncVw = () => { vw.value = window.innerWidth }
onMounted(() => window.addEventListener('resize', syncVw))
onUnmounted(() => window.removeEventListener('resize', syncVw))

const showWarranty = computed(() => vw.value >= 1024)
const showRecords = computed(() => vw.value >= 1280)
const showDept = computed(() => vw.value >= 1440)
const showBrand = computed(() => vw.value >= 1536)
const pagerSmall = computed(() => vw.value < 1280)
const pagerLayout = computed(() =>
  vw.value >= 1536 ? 'total, prev, pager, next, jumper' : vw.value >= 1280 ? 'total, prev, pager, next' : 'prev, pager, next')

/** 只留 asc/desc 两态：EP 第三次点击清空排序会让表头箭头与后端实际排序不一致 */
const SORT_CYCLE: ('ascending' | 'descending')[] = ['ascending', 'descending']

const defaultSort = computed<{ prop: string; order: 'ascending' | 'descending' }>(() => ({
  prop: props.sortProp,
  order: props.sortOrder === 'desc' ? 'descending' : 'ascending',
}))

interface SortChangePayload { prop?: string | null; order?: 'ascending' | 'descending' | null }

function onSortChange(payload: SortChangePayload) {
  const prop = payload.prop ?? ''
  if (!prop) return
  emit('sort-change', { prop, order: payload.order === 'descending' ? 'desc' : 'asc' })
}

function rowKey(row: AssetLedgerRow): string { return row.device_code }
function onRowClick(row: AssetLedgerRow) { emit('open-detail', row) }
function onPageChange(current: number) { emit('page-change', current) }

function recordTablesText(row: AssetLedgerRow): string {
  const tables = row.record_tables ?? []
  return tables.length ? `台账记录 ${row.record_count} 条：${tables.join('、')}` : `台账记录 ${row.record_count} 条`
}
</script>

<template>
  <div class="ltable panel">
    <div v-if="error" class="lstate" role="alert">
      <div class="lstate__box">
        <el-icon :size="24" class="lstate__icon lstate__icon--error"><WarningFilled /></el-icon>
        <p class="lstate__title">台账数据加载失败</p>
        <p class="lstate__desc">{{ error }}</p>
        <div class="lstate__actions">
          <el-button type="primary" plain @click="emit('retry')">
            <el-icon :size="16"><Refresh /></el-icon><span>重试</span>
          </el-button>
        </div>
      </div>
    </div>

    <div v-else-if="!loading && rows.length === 0" class="lstate">
      <el-empty class="lstate__box" :image-size="88">
        <template #description>
          <p class="lstate__title">{{ hasFilters ? '没有符合条件的资产' : '台账当前没有可展示的资产' }}</p>
          <p v-if="hasFilters" class="lstate__desc">
            当前筛选条件下没有任何资产命中。可清除筛选查看全部台账，或放宽子系统 / 区域 / 使用单位 / 状态。
          </p>
          <p v-else class="lstate__desc">
            设备主表、现场台账记录与固定资产三处均为空。若刚完成台账导入，请等待约 1 分钟后点「重新加载」（后端缓存 60 秒）。
          </p>
        </template>

        <div v-if="resolving" class="lstate__resolve" role="status">
          <p class="lstate__resolve-title">名单里没有这条编号，正在按机身编码 / 别名反查台账…</p>
        </div>
        <div v-else-if="resolveResult && resolveResult.candidates.length" class="lstate__resolve">
          <p class="lstate__resolve-title">
            名单里没有这条编号，但机身编码 / 别名反查命中 {{ fmtInt(resolveResult.count) }} 个候选（后端匹配内核排序，此处不重排）：
          </p>
          <ul class="lstate__cands">
            <li v-for="c in resolveResult.candidates" :key="`${c.device_code}-${c.match_type}-${c.matched_value}`" class="lstate__cand">
              <button type="button" class="link-btn mono break-code" @click="emit('open-code', c.device_code)">{{ c.device_code }}</button>
              <span class="lstate__cand-name ellipsis">{{ c.asset_name || c.name || '未命名' }}</span>
              <el-tag size="small" type="info" effect="light">{{ matchTypeLabel(c.match_type) }}</el-tag>
              <span class="lstate__cand-meta ellipsis" :title="c.location">{{ c.area || '未标注' }}</span>
            </li>
          </ul>
          <p v-if="resolveResult.hint" class="lstate__hint">{{ resolveResult.hint.reason }}</p>
        </div>

        <div class="lstate__actions">
          <el-button v-if="hasFilters" type="primary" @click="emit('reset-filters')">清除筛选条件</el-button>
          <el-button @click="emit('retry')">
            <el-icon :size="16"><Refresh /></el-icon><span>重新加载</span>
          </el-button>
        </div>
      </el-empty>
    </div>

    <template v-else>
      <div class="data-table-wrap ltable__wrap">
        <el-table
          v-loading="loading"
          element-loading-text="正在加载台账数据…"
          :data="rows"
          :row-key="rowKey"
          height="100%"
          border
          :default-sort="defaultSort"
          @row-click="onRowClick"
          @sort-change="onSortChange"
        >
          <el-table-column prop="device_code" label="设备编号" min-width="190" fixed="left" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <div class="cell-code">
                <span class="mono break-code">{{ row.device_code }}</span>
                <el-tag v-if="row.source === 'ledger_only'" size="small" type="warning" effect="light">仅台账</el-tag>
                <el-tag v-if="!row.is_active" size="small" type="info" effect="light">已注销</el-tag>
              </div>
            </template>
          </el-table-column>

          <el-table-column prop="name" label="设备名称" min-width="200" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <div class="cell-name">
                <span class="ellipsis" :title="row.name">{{ row.name || '—' }}</span>
                <span v-if="row.asset_name && row.asset_name !== row.name" class="cell-sub ellipsis" :title="row.asset_name">
                  资产名称：{{ row.asset_name }}
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column prop="subsystem" label="子系统" min-width="120" sortable="custom" :sort-orders="SORT_CYCLE" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.subsystem_name">{{ row.subsystem_name }}</span>
              <span v-else class="cell-empty">—</span>
            </template>
          </el-table-column>

          <el-table-column prop="area" label="区域 / 位置" min-width="220" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <div v-if="row.location" class="cell-loc">
                <el-tag size="small" type="info" effect="plain">{{ row.area || '未标注' }}</el-tag>
                <span class="cell-loc__text" :title="row.location">{{ row.location }}</span>
              </div>
              <span v-else class="cell-empty">—</span>
            </template>
          </el-table-column>

          <el-table-column v-if="showBrand" prop="brand_model" label="品牌型号" min-width="170" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.brand_model">{{ row.brand_model }}</span>
              <span v-else class="cell-empty">—</span>
            </template>
          </el-table-column>

          <el-table-column v-if="showDept" prop="use_dept" label="使用单位" min-width="170" sortable="custom" :sort-orders="SORT_CYCLE" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.use_dept">{{ row.use_dept }}</span>
              <span v-else class="cell-empty">—</span>
            </template>
          </el-table-column>

          <el-table-column prop="price_tax" label="含税价（元）" min-width="130" align="right" header-align="right" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <span v-if="row.price_tax === null || row.price_tax === undefined" class="cell-empty">—</span>
              <span v-else class="tnum cell-money">{{ fmtMoney(row.price_tax) }}</span>
            </template>
          </el-table-column>

          <el-table-column v-if="showWarranty" prop="warranty_end" label="保修到期" min-width="156" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <span v-if="!row.warranty_end" class="cell-empty">—</span>
              <span v-else class="cell-warranty">
                <span class="tnum">{{ fmtDate(row.warranty_end) }}</span>
                <el-tag v-if="row.warranty_state" size="small" effect="light" :type="warrantyTagType(row.warranty_state)">{{ warrantyText(row.warranty_state) }}</el-tag>
              </span>
            </template>
          </el-table-column>

          <el-table-column v-if="showRecords" prop="record_count" label="资料 / 关联" min-width="140" align="center" header-align="center" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <div class="cell-counts">
                <el-tooltip v-if="row.record_count > 0" :content="recordTablesText(row)" placement="top" :show-after="300" append-to-body>
                  <span class="cell-chip"><el-icon :size="16"><Document /></el-icon><span class="tnum">{{ row.record_count }}</span></span>
                </el-tooltip>
                <el-tooltip v-if="row.relation_count > 0" :content="`关联设备 ${row.relation_count} 条`" placement="top" :show-after="300" append-to-body>
                  <span class="cell-chip cell-chip--link"><el-icon :size="16"><Link /></el-icon><span class="tnum">{{ row.relation_count }}</span></span>
                </el-tooltip>
                <span v-if="!row.record_count && !row.relation_count" class="cell-empty">—</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="88" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" :aria-label="`查看设备 ${row.device_code} 的完整档案详情`" @click.stop="emit('open-detail', row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="total > 0" class="ltable__foot">
        <span class="ltable__count tnum">共 {{ fmtInt(total) }} 条 · {{ fmtInt(pages) }} 页</span>
        <el-pagination
          background
          :small="pagerSmall"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          :pager-count="5"
          :layout="pagerLayout"
          @current-change="onPageChange"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 表壳高度全靠 flex 链（父级 min-height:0），内部滚动，不写死 px 高（AS-4 / AS-5） */
.ltable { flex: 1 1 auto; min-width: 0; height: 100%; min-height: 0; display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.ltable__wrap { flex: 1 1 auto; min-width: 0; min-height: 200px; }
.ltable__foot { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--border-soft); }
.ltable__count { font-size: var(--text-xs); color: var(--fg-2); }
.ltable :deep(.el-table__row) { cursor: pointer; }
.ltable :deep(.cell) { padding: 0 var(--space-2); }
.ltable :deep(.el-table__cell) { vertical-align: middle; }

/* 编号强制断行不省略；名称两行（主名 + 资产名）；位置两行截断 */
.cell-code { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); min-width: 0; }
.cell-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cell-sub { font-size: var(--text-xs); color: var(--muted); }
.cell-loc { display: flex; align-items: flex-start; gap: var(--space-1); min-width: 0; }
.cell-loc__text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; font-size: var(--text-xs); color: var(--fg-2); }
.cell-warranty { display: flex; align-items: center; gap: var(--space-1); }
.cell-counts { display: flex; align-items: center; justify-content: center; gap: var(--space-1); }
.cell-chip { display: inline-flex; align-items: center; gap: 2px; padding: 0 var(--space-1); border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); font-size: var(--text-xs); }
.cell-chip--link { background: var(--success-bg); color: var(--success-fg); }
.cell-money { font-weight: var(--weight-emphasize); }
.cell-empty { color: var(--meta); }

/* 空 / 错误态：整体替换表体，自身可滚动（margin:auto 居中，不用 justify-content 以免溢出裁切） */
.lstate { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; padding: var(--space-4); }
.lstate > * { margin: auto; min-width: 0; max-width: 100%; }
.lstate__box { text-align: center; }
.lstate__icon { color: var(--muted); }
.lstate__icon--error { color: var(--danger); }
.lstate__title { margin: var(--space-2) 0 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.lstate__desc { margin: var(--space-1) auto 0; max-width: 62ch; font-size: var(--text-sm); line-height: var(--leading-body); color: var(--fg-2); }
.lstate__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-3); }
.lstate__resolve { margin: var(--space-3) auto 0; max-width: 720px; text-align: left; border-top: 1px dashed var(--border); padding-top: var(--space-3); }
.lstate__resolve-title { margin: 0 0 var(--space-2); font-size: var(--text-xs); color: var(--fg-2); }
.lstate__cands { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.lstate__cand { display: flex; align-items: center; gap: var(--space-2); min-width: 0; font-size: var(--text-xs); }
.lstate__cand-name { flex: 0 0 auto; color: var(--fg); }
.lstate__cand-meta { flex: 1 1 auto; color: var(--muted); }
.lstate__hint { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--warn-fg); }
.link-btn { flex: 0 0 auto; padding: 0; border: none; background: none; color: var(--accent); font-size: var(--text-xs); cursor: pointer; text-align: left; }
.link-btn:hover { text-decoration: underline; }
.link-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }
</style>
