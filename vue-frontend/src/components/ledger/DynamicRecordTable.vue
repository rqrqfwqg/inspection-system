<script setup lang="ts">
/**
 * 动态资料记录表（列由 `field_defs` 生成）
 * =====================================================================
 * 通用件：数据表管理单表视图 / 子系统资料分组（检索域）共用一张实现，
 * 避免 React 版里「基础信息表 + 资料记录表」两套列渲染各写一遍。
 *
 * 防压扁 / 溢出纪律（UIUX §6.4 / §6.6）：
 *  - 列宽默认只用 min-width（EP 按比例分配）；允许写固定 `width` 的列：序号列、复选框列、操作列，以及固定左侧的关联键 / 设备编号列；
 *  - 横滚只发生在本地 `.data-table-wrap` 容器，绝不写「整表最小宽度」（AS-7 / AC-06）；
 *  - 动态列默认 `show-overflow-tooltip`，编号类字段走 `.code-break` 强制断行不省略（编号少一位就查不到）；
 *  - 单元格取值一律走 `@/lib/format#fmtValue`（全站唯一格式化口径），空值恒呈现为「—」。
 *
 * 列序可拖（2026-10-14 用户要求「手动调整表格的字段位置，横向拖动」）：
 *  - 数据列（字段列）的表头可按住横向拖动换序；序号 / 复选框 / 操作列不参与拖动；
 *  - 关联键（设备编号）列恒固定左侧、置顶、不可拖动，确保设备编号永远可见（用户拖动后仍能一眼找到）；
 *  - 顺序按表持久化在 localStorage（键 = `orderKey`，缺省退化为表名 title），
 *    字段集变化（增列）时：已存顺序中仍存在的键保持原位，新字段按默认序补尾部；
 *  - 「重置列序」按钮可一键清除本地顺序恢复默认；
 *  - 只影响显示顺序，不写后端、不改字段定义的 sort_order。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowDown, Connection, Delete, Edit, Grid, Switch, TopRight,
} from '@element-plus/icons-vue'
import { fmtValue, isCodeLike } from '@/lib/format'
import { ElMessage } from 'element-plus'
import type { FieldDef, RecordItem } from '@/types/asset'

const props = withDefaults(
  defineProps<{
    title: string
    records: RecordItem[]
    fields: FieldDef[]
    /** 列序持久化的键（缺省退化为 title；同表名跨子系统时可由调用方传 tableId 消歧） */
    orderKey?: string
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

/**
 * 列定义：字段定义优先；无字段定义时回落到首条记录的 data 键（后端字段名未冻结，原样展示）。
 * 🔴 `seq`（序号）不是数据属性，是纯展示字段（2026-10-14 用户明确口径）：行号由本组件
 *    首列自动生成，故这里显式剔除 —— 否则会「首列自动序号 + 数据列又一个序号」两列重号。
 */
const columns = computed(() => {
  if (props.fields.length > 0) {
    return props.fields
      .filter((f) => f.key !== 'seq')
      .map((f) => ({ key: f.key, label: f.label, isRelation: !!f.is_relation_key }))
  }
  return Object.keys(props.records[0]?.data ?? {})
    .filter((key) => key !== 'seq')
    .map((key) => ({ key, label: key, isRelation: false }))
})

/* ============================ 列序：表头横向拖动换序 ============================ */
/** localStorage 键前缀（v1：格式变更时升版本号作废旧数据） */
const ORDER_STORAGE_PREFIX = 'drt.colorder.v1.'

const orderKey = computed(() => props.orderKey || props.title || '')

/** 当前生效的列序（字段 key 的有序列表；与 columns 的默认序对齐初始化） */
const order = ref<string[]>([])
/** 正在被拖动的字段 key / 拖放悬停的目标字段 key（表头高亮用） */
const dragKey = ref('')
const overKey = ref('')

/**
 * 读取持久化列序并与当前字段集合并：
 *  - 已存键中仍存在的保持原位；字段集变了（新增列）时新键按默认序补尾部；
 *  - localStorage 不可用（隐私模式等）或解析失败 → 静默回落默认序，绝不弹错。
 */
function loadOrder(keys: string[]): string[] {
  if (!orderKey.value) return keys
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_PREFIX + orderKey.value)
    if (!raw) return keys
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved)) return keys
    const kept = saved.filter((k): k is string => typeof k === 'string' && keys.includes(k))
    return [...kept, ...keys.filter((k) => !kept.includes(k))]
  } catch {
    return keys
  }
}

function persistOrder(next: string[]) {
  if (!orderKey.value) return
  try {
    localStorage.setItem(ORDER_STORAGE_PREFIX + orderKey.value, JSON.stringify(next))
  } catch {
    /* 存储被禁 / 配额满：仅本次会话生效，不阻断拖动本身 */
  }
}

/** 默认列序（字段 key 列表）：表切换 / 字段集变化时重算 */
const baseKeys = computed(() => columns.value.map((c) => c.key))

watch([orderKey, baseKeys], ([, keys]) => {
  order.value = loadOrder(keys)
}, { immediate: true })

/** 实际渲染的列：关联键（设备编号）列恒置顶并固定左侧，其余按 order 重排（未覆盖的兜底补尾部） */
const visibleColumns = computed(() => {
  const byKey = new Map(columns.value.map((c) => [c.key, c]))
  const ordered = order.value.map((k) => byKey.get(k)).filter((c) => c !== undefined)
  const inOrder = new Set(order.value)
  const relations = ordered.filter((c) => c.isRelation)
  const rest = ordered.filter((c) => !c.isRelation)
  for (const c of columns.value) {
    if (!inOrder.has(c.key)) rest.push(c)
  }
  return [...relations, ...rest]
})

/** 列头/列身的拖动态样式类（只高亮表头，故 CSS 里限定 th） */
function colClass(key: string): string {
  if (key === dragKey.value) return 'drt__col-src'
  if (key === overKey.value) return 'drt__col-over'
  return ''
}

function clearDragState() {
  dragKey.value = ''
  overKey.value = ''
}

/** 重置本表列序：清除本地持久化，恢复默认排列（用户拖动后想还原时用） */
function resetOrder() {
  if (!orderKey.value) return
  try {
    localStorage.removeItem(ORDER_STORAGE_PREFIX + orderKey.value)
  } catch {
    /* 忽略存储异常 */
  }
  order.value = [...baseKeys.value]
  ElMessage.success('已重置本表列顺序')
}

/** 把 from 列移动到 to 列的位置（HTML5 DnD：dragstart 记来源，drop 时换序） */
function moveColumn(from: string, to: string) {
  if (!from || !to || from === to) return
  const next = [...order.value]
  const fi = next.indexOf(from)
  const ti = next.indexOf(to)
  if (fi === -1 || ti === -1) return
  next.splice(fi, 1)
  next.splice(ti, 0, from)
  order.value = next
  persistOrder(next)
}

function onDragStart(e: DragEvent, key: string) {
  dragKey.value = key
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }
}

function onDragOver(e: DragEvent, key: string) {
  if (!dragKey.value || dragKey.value === key) return
  // 必须 preventDefault，否则浏览器不触发 drop
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  overKey.value = key
}

function onDragLeave(key: string) {
  if (overKey.value === key) overKey.value = ''
}

function onDrop(e: DragEvent, key: string) {
  e.preventDefault()
  moveColumn(dragKey.value, key)
  clearDragState()
}

function onDragEnd() {
  clearDragState()
}

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
      <el-button v-if="orderKey" size="small" title="清除本地保存的列顺序，恢复默认排列" @click="resetOrder">
        <el-icon :size="16"><RefreshLeft /></el-icon>
        <span>重置列序</span>
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
        <!-- 序号：纯展示列（非数据属性，所有表一致）—— 行号 = 当前列表中的位置，
             分页续拉 / 服务端搜索下随当前页集连续编号，不落库、不导出 -->
        <el-table-column label="序号" width="56" align="center" fixed="left" class-name="drt__col-seq">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>

        <el-table-column v-if="selectable" type="selection" width="44" :selectable="() => true" />

        <el-table-column v-if="canOpenDevice" label="关联键" width="170" fixed="left">
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
          v-for="col in visibleColumns"
          :key="col.key"
          :label="col.label"
          :min-width="col.isRelation ? undefined : columnWidth(col.key)"
          :width="col.isRelation ? columnWidth(col.key) : undefined"
          :fixed="col.isRelation ? 'left' : undefined"
          :class-name="colClass(col.key)"
          show-overflow-tooltip
        >
          <!-- 表头即可拖动手柄：按住横向拖动换序（顺序按表持久化，见脚本区列序说明） -->
          <template #header>
            <span
              class="drt__col-drag"
              draggable="true"
              :title="`拖动调整「${col.label}」列的位置`"
              @dragstart="onDragStart($event, col.key)"
              @dragover="onDragOver($event, col.key)"
              @dragleave="onDragLeave(col.key)"
              @drop="onDrop($event, col.key)"
              @dragend="onDragEnd"
            >{{ col.label }}</span>
          </template>
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

/* 序号列：纯展示，弱化处理 + 等宽数字（避免 10/11 行宽度跳动） */
.drt :deep(.drt__col-seq .cell) {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* 列序拖动：表头文本即手柄；拖动中源列半透、悬停目标列左侧亮线 */
.drt__col-drag {
  display: block;
  overflow: hidden;
  cursor: grab;
  text-overflow: ellipsis;
  user-select: none;
}

.drt__col-drag:active {
  cursor: grabbing;
}

.drt :deep(th.drt__col-src) {
  opacity: 0.55;
}

.drt :deep(th.drt__col-over) {
  box-shadow: inset 2px 0 0 var(--accent);
}

.drt :deep(.drt__row--clickable) {
  cursor: pointer;
}
</style>
