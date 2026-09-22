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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowDown, Connection, Delete, Edit, Grid, Switch, TopRight,
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
    /** 增量加载：是否还有下一页（未传 = 未启用分页，行为与改造前完全一致） */
    hasMore?: boolean
    /** 增量加载：正在拉下一页 */
    loadingMore?: boolean
    /** 增量加载：已加载条数（**传入即视为启用分页**；未传则不渲染任何加载 UI） */
    loadedCount?: number
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
    hasMore: false,
    loadingMore: false,
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
  (e: 'load-more'): void
}>()

/**
 * 是否启用增量加载。
 * 以「调用方是否传 `loadedCount`」为开关 —— 未传（如 `RecordGroupPanel`）时**不渲染任何加载 UI、不挂 observer**，
 * 严格保持改造前的渲染结果，避免波及其它调用方。
 */
const paginated = computed(() => props.loadedCount !== undefined)

/* ============================ 滚动到底自动加载 ============================ */
/** 哨兵：进入视口（含 200px 预取区）即请求下一页 */
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function teardownObserver() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
}

function setupObserver() {
  // 先拆旧的，避免"切换表后幽灵触发"与内存泄漏
  teardownObserver()
  const el = sentinel.value
  if (!el || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      // hasMore / loadingMore 由父级驱动；此处再兜一层，防止监听回调比 props 更新早一步
      if (!props.hasMore || props.loadingMore) return
      if (entries.some((entry) => entry.isIntersecting)) emit('load-more')
    },
    // el-table 未设 height → 滚动发生在整页（viewport），故用默认 root
    { rootMargin: '200px' },
  )
  observer.observe(el)
}

onMounted(() => {
  setupObserver()
})

onBeforeUnmount(() => {
  teardownObserver()
})

// 记录增长后 el-table 重排，哨兵可能被卸载/重建；hasMore/loadingMore 变化也会影响是否该继续加载。
// 变化后下一帧重新 observe —— 新建的 observer 会立即回报当前相交状态，
// 因此"哨兵一直在视口内"时（如页面不够高）也能继续连续加载，不会卡死。
watch(
  () => [props.records.length, props.hasMore, props.loadingMore] as const,
  () => {
    void nextTick(() => setupObserver())
  },
)

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
      <span v-if="paginated" class="drt__count tnum">
        已加载 {{ loadedCount }} 条<template v-if="hasMore">（还有更多）</template>
      </span>
      <span v-else class="drt__count tnum">{{ records.length }} 条</span>
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

    <!-- 滚动到底自动加载：哨兵 + 按钮兜底（IO 不可用/被拦截时仍可手动加载） -->
    <template v-if="paginated">
      <div v-if="hasMore" ref="sentinel" class="drt__sentinel" aria-hidden="true" />

      <div class="drt__footer">
        <template v-if="hasMore">
          <el-button size="small" :loading="loadingMore" @click="emit('load-more')">
            <el-icon v-if="!loadingMore" :size="16"><ArrowDown /></el-icon>
            <span>{{ loadingMore ? '正在加载…' : '加载更多' }}</span>
          </el-button>
          <span class="drt__loaded tnum" role="status">已加载 {{ loadedCount }} 条</span>
        </template>
        <span v-else class="drt__done tnum" role="status">已全部加载（共 {{ loadedCount }} 条）</span>
      </div>
    </template>

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

/* 滚动到底自动加载：哨兵（零高、不可见）与页脚 */
.drt__sentinel {
  height: 1px;
}

.drt__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-soft);
}

.drt__loaded,
.drt__done {
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
