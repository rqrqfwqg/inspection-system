<script setup lang="ts">
/**
 * 工单分页表（UIUX 页面 1）
 * =====================================================================
 * 防压扁要点（沿用台账铁律）：
 *   - 列宽**只用 min-width**；唯一例外是 fixed 操作列 `width="96"`；
 *   - 横滚只发生在本地 `.data-table-wrap`，整页不得出现横向滚动条；
 *   - 高度走 flex 链（父链 min-height:0 + height="100%"），不写死 px 高；
 *   - 空 / 错误态**整体替换表体**（不塞进固定高度表体，避免 1280×720 被裁切）；
 *   - 列裁剪按 **CSS 视口宽**（1024 / 1280 / 1440 / 1536 四档），绝不靠缩字号硬塞；
 *   - 数字 / 时间列走 `.tnum` / `.mono`。
 * 行内快捷动作只给 1 个主操作，其余进详情页（UIUX 交互要点）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Postcard, Refresh, WarningFilled } from '@element-plus/icons-vue'
import WoPriorityMarker from '@/components/workorder/WoPriorityMarker.vue'
import WoStatusTag from '@/components/workorder/WoStatusTag.vue'
import { fmtBeijingUtc, fmtInt } from '@/lib/format'
import { woTypeLabel } from '@/types/workOrderMeta'
import type { WorkOrder, WorkOrderActionKind } from '@/types/workOrder'

const props = defineProps<{
  rows: WorkOrder[]
  loading: boolean
  error: string
  total: number
  page: number
  pageSize: number
  pages: number
  hasFilters: boolean
  /** 403：只读降级（快捷动作禁用 + 说明） */
  readonly?: boolean
  currentUserId?: number | null
  sortProp?: string
  sortOrder?: 'asc' | 'desc'
}>()

const emit = defineEmits<{
  (e: 'page-change', page: number): void
  (e: 'sort-change', payload: { prop: string; order: 'asc' | 'desc' }): void
  (e: 'open-detail', row: WorkOrder): void
  (e: 'open-device', code: string): void
  (e: 'create'): void
  (e: 'quick-dispatch', row: WorkOrder): void
  (e: 'quick-start', row: WorkOrder): void
  (e: 'quick-complete', row: WorkOrder): void
  (e: 'reset-filters'): void
  (e: 'retry'): void
}>()

/** 断点按 CSS 视口宽判定（含系统缩放），不读 screen / devicePixelRatio */
const vw = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const syncVw = () => { vw.value = window.innerWidth }
onMounted(() => window.addEventListener('resize', syncVw))
onUnmounted(() => window.removeEventListener('resize', syncVw))

const showRoom = computed(() => vw.value >= 1024)
const showAssignee = computed(() => vw.value >= 1280)
const showDue = computed(() => vw.value >= 1440)
const showUpdated = computed(() => vw.value >= 1536)
const pagerSmall = computed(() => vw.value < 1280)
const pagerLayout = computed(() =>
  vw.value >= 1536 ? 'total, prev, pager, next, jumper' : vw.value >= 1280 ? 'total, prev, pager, next' : 'prev, pager, next')

const SORT_CYCLE: ('ascending' | 'descending')[] = ['ascending', 'descending']
const defaultSort = computed<{ prop: string; order: 'ascending' | 'descending' }>(() => ({
  prop: props.sortProp ?? '',
  order: props.sortOrder === 'desc' ? 'descending' : 'ascending',
}))

interface SortChangePayload { prop?: string | null; order?: 'ascending' | 'descending' | null }
function onSortChange(payload: SortChangePayload) {
  const prop = payload.prop ?? ''
  if (!prop) return
  emit('sort-change', { prop, order: payload.order === 'descending' ? 'desc' : 'asc' })
}

function isOverdue(row: WorkOrder): boolean {
  if (!row.due_at) return false
  if (row.status === 'closed' || row.status === 'cancelled') return false
  const t = Date.parse(row.due_at)
  return Number.isFinite(t) && t < Date.now()
}

interface QuickAction { kind: WorkOrderActionKind; label: string }
/** 行内只给 1 个主操作；无可用动作时回落到 [详情] */
function quickAction(row: WorkOrder): QuickAction | null {
  if (props.readonly) return null
  if (row.status === 'pending_dispatch') return { kind: 'dispatch', label: '派单' }
  const self = props.currentUserId
  const mine = self !== null && self !== undefined && row.assignee_id === self
  if (row.status === 'assigned' && mine) return { kind: 'start', label: '开始' }
  if (row.status === 'in_progress' && mine) return { kind: 'complete', label: '完成' }
  return null
}

function onQuick(row: WorkOrder, kind: WorkOrderActionKind) {
  if (kind === 'dispatch') emit('quick-dispatch', row)
  else if (kind === 'start') emit('quick-start', row)
  else if (kind === 'complete') emit('quick-complete', row)
}
</script>

<template>
  <div class="wtable panel">
    <div v-if="error" class="wstate" role="alert">
      <div class="wstate__box">
        <el-icon :size="24" class="wstate__icon wstate__icon--error"><WarningFilled /></el-icon>
        <p class="wstate__title">工单列表加载失败</p>
        <p class="wstate__desc">{{ error }}</p>
        <div class="wstate__actions">
          <el-button type="primary" plain @click="emit('retry')">
            <el-icon :size="16"><Refresh /></el-icon><span>重试</span>
          </el-button>
        </div>
      </div>
    </div>

    <div v-else-if="!loading && rows.length === 0" class="wstate">
      <el-empty class="wstate__box" :image-size="88">
        <template #description>
          <p class="wstate__title">{{ hasFilters ? '当前筛选条件下没有工单' : '还没有工单。' }}</p>
          <p v-if="hasFilters" class="wstate__desc">
            可清除筛选查看全部，或放宽状态 / 执行人 / 时间范围。
          </p>
          <p v-else class="wstate__desc">
            创建第一张工单后，派单、执行、验收会在这里形成完整记录。
          </p>
        </template>
        <div class="wstate__actions">
          <el-button v-if="hasFilters" type="primary" @click="emit('reset-filters')">清除全部筛选条件</el-button>
          <el-button v-else type="primary" @click="emit('create')">新建工单</el-button>
        </div>
      </el-empty>
    </div>

    <template v-else>
      <div class="data-table-wrap wtable__wrap">
        <el-table
          v-loading="loading"
          element-loading-text="正在加载工单…"
          :data="rows"
          row-key="id"
          height="100%"
          border
          :default-sort="defaultSort"
          @row-click="(row: WorkOrder) => emit('open-detail', row)"
          @sort-change="onSortChange"
        >
          <el-table-column prop="code" label="单号" min-width="152" fixed="left">
            <template #default="{ row }">
              <div class="cell-code">
                <span class="mono break-code">{{ row.code }}</span>
                <el-icon v-if="row.source === 'miniprogram'" :size="16" title="来自小程序"><Postcard /></el-icon>
              </div>
            </template>
          </el-table-column>

          <el-table-column prop="title" label="标题" min-width="220">
            <template #default="{ row }">
              <div class="cell-title">
                <span class="ellipsis-2" :title="row.title">{{ row.title || '—' }}</span>
                <span class="cell-sub mono break-code">{{ row.asset_device_code || '未关联设备' }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column prop="status" label="状态" min-width="116">
            <template #default="{ row }"><WoStatusTag :status="row.status" /></template>
          </el-table-column>

          <el-table-column prop="type" label="类型" min-width="96">
            <template #default="{ row }">{{ woTypeLabel(row.type) }}</template>
          </el-table-column>

          <el-table-column prop="priority" label="优先级" min-width="92" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }"><WoPriorityMarker :priority="row.priority" /></template>
          </el-table-column>

          <el-table-column prop="asset_device_code" label="设备编号" min-width="178">
            <template #default="{ row }">
              <button
                v-if="row.asset_device_code"
                type="button"
                class="link-btn mono break-code"
                @click.stop="emit('open-device', row.asset_device_code)"
              >{{ row.asset_device_code }}</button>
              <span v-else class="cell-empty">—</span>
            </template>
          </el-table-column>

          <el-table-column v-if="showRoom" prop="room_code" label="房间 / 区域" min-width="148">
            <template #default="{ row }">{{ row.room_code || '—' }}</template>
          </el-table-column>

          <el-table-column v-if="showAssignee" prop="assignee_id" label="执行人" min-width="110">
            <template #default="{ row }">
              <span v-if="row.assignee_id !== null">用户 #{{ row.assignee_id }}</span>
              <span v-else class="cell-empty">未派单</span>
            </template>
          </el-table-column>

          <el-table-column v-if="showDue" prop="due_at" label="截止" min-width="152" sortable="custom" :sort-orders="SORT_CYCLE">
            <template #default="{ row }">
              <span v-if="!row.due_at" class="cell-empty">—</span>
              <span v-else class="cell-due tnum" :class="{ 'is-overdue': isOverdue(row) }">
                {{ fmtBeijingUtc(row.due_at) }}
                <template v-if="isOverdue(row)">
                  <el-icon :size="16"><WarningFilled /></el-icon><span>已超期</span>
                </template>
              </span>
            </template>
          </el-table-column>

          <el-table-column v-if="showUpdated" prop="updated_at" label="更新时间" min-width="152">
            <template #default="{ row }"><span class="tnum">{{ fmtBeijingUtc(row.updated_at) }}</span></template>
          </el-table-column>

          <el-table-column label="操作" width="96" align="center" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="quickAction(row)"
                link
                type="primary"
                :aria-label="`${quickAction(row)?.label}工单 ${row.code}`"
                @click.stop="onQuick(row, quickAction(row)!.kind)"
              >{{ quickAction(row)?.label }}</el-button>
              <el-button v-else link type="primary" :aria-label="`查看工单 ${row.code} 详情`" @click.stop="emit('open-detail', row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="total > 0" class="wtable__foot">
        <span class="wtable__count tnum">共 {{ fmtInt(total) }} 条 · {{ fmtInt(pages) }} 页</span>
        <el-pagination
          background
          :small="pagerSmall"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          :pager-count="5"
          :layout="pagerLayout"
          @current-change="(p: number) => emit('page-change', p)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.wtable { flex: 1 1 auto; min-width: 0; height: 100%; min-height: 0; display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.wtable__wrap { flex: 1 1 auto; min-width: 0; min-height: 240px; }
.wtable__foot { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--border-soft); }
.wtable__count { font-size: var(--text-xs); color: var(--fg-2); }
.wtable :deep(.el-table__row) { cursor: pointer; }
.wtable :deep(.cell) { padding: 0 var(--space-2); }
.wtable :deep(.el-table__cell) { vertical-align: middle; }

.cell-code { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); min-width: 0; }
.cell-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cell-sub { font-size: var(--text-xs); color: var(--muted); }
.cell-due { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
.cell-due.is-overdue { color: var(--danger-fg); }
.cell-empty { color: var(--meta); }
.link-btn { padding: 0; border: none; background: none; color: var(--accent); font-size: var(--text-xs); cursor: pointer; text-align: left; }
.link-btn:hover { text-decoration: underline; }
.link-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }

.wstate { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; padding: var(--space-4); }
.wstate > * { margin: auto; min-width: 0; max-width: 100%; }
.wstate__box { text-align: center; }
.wstate__icon { color: var(--muted); }
.wstate__icon--error { color: var(--danger); }
.wstate__title { margin: var(--space-2) 0 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.wstate__desc { margin: var(--space-1) auto 0; max-width: 62ch; font-size: var(--text-sm); line-height: var(--leading-body); color: var(--fg-2); }
.wstate__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-3); }
</style>
