<script setup lang="ts">
/**
 * 记录条件筛选条（数据表管理 · 单表视图）
 * =====================================================================
 * 用户需求：每张表都能「按字段设置查询条件」做精确/模糊匹配，
 * 且条件**可组合、可清空、结果实时刷新**；值要「像 EXCEL 一样」从表内已有数据里挑。
 *
 * 设计要点：
 *  - 条件是**数据**（`RecordFilter[]`），不是一堆散落的输入框 → 天然支持组合与增删；
 *  - 「实时刷新」= 改条件后由父级防抖 400ms 调 `runFilteredSearch`，
 *    本组件**自己不发请求**（避免与 composable 的世代号竞态保护打架）；
 *  - 「为空/不为空」时**隐藏值输入框**（而不是留一个填不了也不该填的框）；
 *  - 未填完整的条件以**弱化样式**呈现，明确告诉用户「这条还没生效」——
 *    否则会出现「界面显示 3 条条件、实际只筛了 1 条」的错位；
 *  - 🔴 **一个条件内可多选**（如「设备类别 = UPS / 配电箱 / 变压器」）——
 *    改造前必须加 3 条条件再切「任一满足」，组内却仍受组间 OR/AND 牵制，
 *    「UPS 或 配电箱 **且** 楼层=2#楼」根本表达不出来。
 *  - 🔴 **每条条件显示独立命中数**：筛选出 0 条时，用户面对一排条件条
 *    看不出是哪一条把结果杀成 0 的（「都填对了啊」→ 反复瞎改，最耗时间）。
 *
 * 红线：只用 @element-plus/icons-vue 图标、无 emoji、无渐变、颜色全走 token。
 */
import { computed } from 'vue'
import { Delete, Filter, Plus, RefreshLeft, WarningFilled } from '@element-plus/icons-vue'
import {
  DEVICE_CODE_FIELD, FILTER_OPS, NEGATIVE_OPS, VALUELESS_OPS, MAX_VALUES_PER_COND,
  isFilterActive, joinValueLabel,
  type FieldValueItem, type FilterLogic, type FilterStatsMap, type RecordFilter,
} from '@/types/assetFilter'
import type { FieldDef } from '@/types/asset'

const props = withDefaults(
  defineProps<{
    /** 该表的字段定义（决定可筛字段）；为空表示还没加载出来 */
    fields: FieldDef[]
    filters: RecordFilter[]
    logic: FilterLogic
    /** 已填完整、真正生效的条件数 */
    activeCount: number
    /** 命中条数（用于「条件 → 结果」的即时反馈） */
    resultCount: number
    /** 候选值表：字段名 → 该字段的候选项（由 composable 维护，切表自动重置） */
    valueOptions: Record<string, FieldValueItem[]>
    /** 候选值加载状态表：字段名 → loading / error / truncated / total / matched */
    valueMeta: Record<string, ValueMeta>
    /** 每条条件的独立命中数（**按下标**对齐，后端保证与有效条件等长同序） */
    filterStats?: FilterStatsMap
    /** 全部条件组合后的真实命中条数；undefined = 未算 */
    filterTotal?: number
    loading?: boolean
  }>(),
  { loading: false, filterStats: () => ({}), filterTotal: undefined },
)

/** 候选值加载状态（与 composable 的 ValueMeta 同形） */
type ValueMeta = {
  loading: boolean
  error: boolean
  truncated: boolean
  total: number
  matched: number
}

const NO_META: ValueMeta = { loading: false, error: false, truncated: false, total: 0, matched: 0 }

const emit = defineEmits<{
  (e: 'add', field?: string): void
  (e: 'remove', index: number): void
  (e: 'update:field', payload: { index: number; field: string }): void
  (e: 'update:op', payload: { index: number; op: RecordFilter['op'] }): void
  (e: 'update:values', payload: { index: number; values: string[] }): void
  (e: 'update:logic', logic: FilterLogic): void
  (e: 'clear'): void
  /** 取某字段的候选值（懒加载：下拉首次展开 / 下拉内搜索时才发） */
  (e: 'load-values', payload: { field: string; q?: string }): void
}>()

/** 可选字段：关联键 + 该表全部字段（label 优先，回落到 key） */
const fieldOptions = computed(() => {
  const opts = [{ value: DEVICE_CODE_FIELD, label: '关联键' }]
  for (const f of props.fields) {
    if (!f.key) continue
    opts.push({ value: f.key, label: f.label || f.key })
  }
  return opts
})

/** 算子下拉项（键序即显示序） */
const opOptions = computed(() =>
  (Object.keys(FILTER_OPS) as RecordFilter['op'][]).map((op) => ({
    value: op,
    label: FILTER_OPS[op],
  })),
)

function fieldLabel(key: string): string {
  return fieldOptions.value.find((o) => o.value === key)?.label ?? key
}

function opLabel(op: RecordFilter['op']): string {
  return FILTER_OPS[op] ?? op
}

function needsValue(op: RecordFilter['op']): boolean {
  return !VALUELESS_OPS.includes(op)
}

/** 未填完整的条件：不生效，用弱化样式标出来 */
function isPending(f: RecordFilter): boolean {
  return !isFilterActive(f)
}

// ------------------------------------------------------------------
// 命中归因：每条条件单独能命中多少行
// ------------------------------------------------------------------
/** 该条件行是否有归因数字（未查 / 未填完 → 没有） */
function statOf(index: number): { count?: number; loading?: boolean } {
  return props.filterStats?.[index] ?? {}
}

/**
 * 这条条件是不是「把结果杀成 0」的元凶？
 * 🔴 判据必须是「**这一条自己**就命中 0」，而不是「组合后结果是 0」——
 *    后者会把**所有**条件都标红（AND 无交集时每条单独都有值），
 *    那等于没归因，用户还是不知道该改哪条。
 * 组合归零的原因由顶部横幅单独说明（「这些条件之间没有交集」）。
 */
function isZeroAlone(index: number): boolean {
  const st = statOf(index)
  return st.count === 0 && !st.loading
}

// ------------------------------------------------------------------
// 字段候选值（值下拉）
// ------------------------------------------------------------------
/** 下拉内搜索词的本地防抖计时器（按字段分桶，避免 A 字段的输入取消 B 字段的） */
const searchTimers = new Map<string, ReturnType<typeof setTimeout>>()
const SEARCH_DEBOUNCE = 250

function optionsOf(field: string): FieldValueItem[] {
  return props.valueOptions[field] ?? []
}

function metaOf(field: string): ValueMeta {
  return props.valueMeta[field] ?? NO_META
}

/** 下拉首次展开才拉候选：避免加了一堆条件就发一堆无用请求 */
function onValueOpen(field: string, visible: boolean) {
  if (!visible) return
  if (metaOf(field).loading) return
  if (optionsOf(field).length === 0 && !metaOf(field).error) {
    emit('load-values', { field })
  }
}

/** 下拉内输入 → 服务端「包含」搜索（防抖 250ms，与筛选条件的 400ms 独立计时） */
function onValueSearch(field: string, q: string) {
  const pending = searchTimers.get(field)
  if (pending) clearTimeout(pending)
  searchTimers.set(
    field,
    setTimeout(() => {
      searchTimers.delete(field)
      emit('load-values', { field, q: q.trim() || undefined })
    }, SEARCH_DEBOUNCE),
  )
}

const hasAny = computed(() => props.filters.length > 0)

const summary = computed(() => {
  const parts = props.filters.map((f) => {
    const val = needsValue(f.op) ? `「${joinValueLabel(f)}」` : ''
    return `${fieldLabel(f.field)} ${opLabel(f.op)}${val}`
  })
  return parts.join(props.logic === 'and' ? ' 且 ' : ' 或 ')
})

/**
 * 0 条归因横幅：说清「为什么是 0」。
 * 🔴 三种归零原因必须区分开，否则用户在错误的层面瞎改：
 *    ① 某条条件自己就 0 条 → 改那条的值；
 *    ② 每条单独都有值但 AND 交集为空 → 是条件之间冲突，不是某条写错；
 *    ③ 没算过 → 不显示任何断言（不能凭猜测说「条件太严」）。
 */
const zeroBanner = computed(() => {
  if (props.loading) return ''
  const zeroIdx: number[] = []
  for (let i = 0; i < props.filters.length; i += 1) {
    if (isFilterActive(props.filters[i]) && isZeroAlone(i)) zeroIdx.push(i)
  }
  if (zeroIdx.length === 0) return ''
  const names = zeroIdx.map((i) => `${fieldLabel(props.filters[i].field)} ${opLabel(props.filters[i].op)}`)
  if (zeroIdx.length === props.filters.filter(isFilterActive).length) {
    return '所有条件单独看都命中 0 条：请核对下面标红的取值（可能是候选里没有的值）'
  }
  if (names.length === 1) return `这条条件单独看就命中 0 条，是它把结果筛没了：${names[0]}`
  return `这些条件单独看都命中 0 条：${names.join('、')}`
})

/** 上限与后端一致（record_filters.MAX_CONDITIONS），超了就不再让加 */
const MAX = 20
const canAdd = computed(() => props.filters.length < MAX)
</script>

<template>
  <section class="rf panel" aria-label="记录条件筛选">
    <header class="rf__head">
      <el-icon :size="16" class="rf__icon"><Filter /></el-icon>
      <span class="rf__title">条件筛选</span>

      <!-- AND / OR 切换：仅 2 条以上条件时出现（1 条无组合可言） -->
      <el-radio-group
        v-if="filters.length >= 2"
        :model-value="logic"
        size="small"
        aria-label="条件组合方式"
        @update:model-value="(v: string) => emit('update:logic', v as FilterLogic)"
      >
        <el-radio-button value="and">全部满足</el-radio-button>
        <el-radio-button value="or">任一满足</el-radio-button>
      </el-radio-group>

      <span v-if="hasAny" class="rf__count tnum" role="status">
        <template v-if="loading">筛选中…</template>
        <template v-else>
          命中
          <!--
            🔴 全表命中数用后端算的 `filterTotal`，**不能用当前页条数**：
               分页一页最多 500 条，筛出 800 条时会显示 500 —— 比不显示更误导。
               两者不一致（还有下一页）时补一个「本页 N」，把口径说清楚。
          -->
          <span class="tnum">{{ filterTotal ?? resultCount }}</span> 条
          <template v-if="filterTotal !== undefined && filterTotal !== resultCount">
            （本页 {{ resultCount }}）
          </template>
          <template v-if="activeCount < filters.length">
            （{{ filters.length - activeCount }} 条未填完，暂未生效）
          </template>
        </template>
      </span>
      <span v-else class="rf__count rf__count--muted">未设条件，显示全部</span>

      <span class="rf__spacer" />

      <el-button size="small" :disabled="!canAdd" @click="emit('add')">
        <el-icon :size="16"><Plus /></el-icon>
        <span>添加条件</span>
      </el-button>
      <el-button size="small" :disabled="!hasAny" @click="emit('clear')">
        <el-icon :size="16"><RefreshLeft /></el-icon>
        <span>清空条件</span>
      </el-button>
    </header>

    <!-- 0 条归因横幅：说清是哪条条件的锅（见 zeroBanner 注释里的三种归零原因） -->
    <p v-if="zeroBanner" class="rf__banner" role="alert">
      <el-icon :size="13"><WarningFilled /></el-icon>
      <span>{{ zeroBanner }}</span>
    </p>

    <!-- 条件列表：每行 = 字段 + 匹配方式 + 值（可多选）+ 独立命中数 + 删除 -->
    <ul v-if="hasAny" class="rf__list">
      <li
        v-for="(f, i) in filters"
        :key="i"
        class="rf__row"
        :class="{
          'rf__row--pending': isPending(f),
          'rf__row--zero': isZeroAlone(i),
        }"
      >
        <span class="rf__join" aria-hidden="true">{{ i === 0 ? '当' : (logic === 'and' ? '且' : '或') }}</span>

        <el-select
          :model-value="f.field"
          size="small"
          class="rf__field"
          aria-label="筛选字段"
          placeholder="选择字段"
          @update:model-value="(v: string) => emit('update:field', { index: i, field: v })"
        >
          <el-option v-for="o in fieldOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>

        <el-select
          :model-value="f.op"
          size="small"
          class="rf__op"
          aria-label="匹配方式"
          @update:model-value="(v: string) => emit('update:op', { index: i, op: v as RecordFilter['op'] })"
        >
          <el-option v-for="o in opOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>

        <!--
          值：**多选**下拉 + 允许手输（allow-create）。
          用户要求「选项根据表格内已有数据、像 EXCEL 一样」→ 从该列已有值里挑，
          而不是凭记忆敲（敲错一个字就 0 条且看不出错在哪）。
          但**必须允许手输**：① 长尾值候选里可能没有（truncated）；
          ② 用户有时就想按片段找（配合「开头是/包含」）。
          每项显示命中条数 —— 选之前就知道会命中几条，这是候选下拉的核心价值。
        -->
        <template v-if="needsValue(f.op)">
          <div class="rf__valuewrap">
            <el-select
              :model-value="f.values"
              size="small"
              class="rf__value"
              multiple
              filterable
              allow-create
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="2"
              default-first-option
              :reserve-keyword="false"
              :multiple-limit="MAX_VALUES_PER_COND"
              :loading="metaOf(f.field).loading"
              :no-data-text="metaOf(f.field).error ? '候选值加载失败，可直接输入' : '该字段没有可选值，可直接输入'"
              :no-match-text="metaOf(f.field).loading ? '搜索中…' : '无匹配项，可直接输入该值'"
              :aria-label="`${fieldLabel(f.field)} ${opLabel(f.op)} 的值（可多选）`"
              :placeholder="`选或输入要${opLabel(f.op)}的内容（可多选）`"
              @visible-change="(v: boolean) => onValueOpen(f.field, v)"
              @remote-method="(q: string) => onValueSearch(f.field, q)"
              @update:model-value="(v: string[]) => emit('update:values', { index: i, values: v ?? [] })"
            >
              <el-option
                v-for="it in optionsOf(f.field)"
                :key="it.value"
                :label="it.value"
                :value="it.value"
              >
                <span class="rf__opt-val" :title="it.value">{{ it.value }}</span>
                <span class="rf__opt-count tnum">{{ it.count }} 条</span>
              </el-option>
            </el-select>

            <!-- 否定算子的多值语义提示：组内是 AND，不是 OR（与后端 NEGATIVE_OPS 一致） -->
            <span v-if="f.values.length > 1 && NEGATIVE_OPS.includes(f.op)" class="rf__vnote">
              已选 {{ f.values.length }} 项，结果会排除它们全部
            </span>
            <!-- 候选状态说明：截断必须说清，否则用户会以为「这就是全部」 -->
            <span v-else-if="metaOf(f.field).truncated" class="rf__vnote">
              共 {{ metaOf(f.field).total }} 个值，继续输入可缩小范围
            </span>
            <span v-else-if="metaOf(f.field).error" class="rf__vnote rf__vnote--warn">
              <el-icon :size="12"><WarningFilled /></el-icon>
              <span>候选值加载失败，可直接输入</span>
            </span>
          </div>
        </template>
        <span v-else class="rf__novalue">不需要填值</span>

        <!--
          独立命中数：回答「是哪条把结果筛没了」。
          🔴 用后端算的 `counts[i]`，**绝不在前端拿当前页条数凑**——
             当前页最多 500 条，筛出 800 条时会显示成 500，比不显示更误导。
        -->
        <span
          v-if="isFilterActive(f)"
          class="rf__stat tnum"
          :class="{ 'rf__stat--zero': isZeroAlone(i) }"
          :title="`只看这条条件能命中 ${statOf(i).count ?? '?'} 条`"
        >
          <template v-if="statOf(i).loading">算命中数…</template>
          <template v-else-if="statOf(i).count !== undefined">
            单独看 {{ statOf(i).count }} 条
          </template>
        </span>

        <el-button
          size="small"
          link
          type="danger"
          :aria-label="`删除条件：${fieldLabel(f.field)} ${opLabel(f.op)}`"
          title="删除这条条件"
          @click="emit('remove', i)"
        >
          <el-icon :size="16"><Delete /></el-icon>
        </el-button>
      </li>
    </ul>

    <!-- 条件摘要：折叠态下一句话说清「现在按什么筛」，排查时不用逐条读 -->
    <p v-if="hasAny" class="rf__summary" role="note">
      <span class="rf__summary-label">当前条件</span>
      <span class="rf__summary-text">{{ summary || '（全部条件尚未填完）' }}</span>
    </p>

    <p v-if="!hasAny" class="rf__hint">
      点「添加条件」按字段设置查询：支持包含 / 开头是 / 结尾是 / 等于 / 不等于 / 为空 / 不为空；
      一个条件内可**多选**多个值（如「设备类别 = UPS、配电箱」）；
      多条条件可切换「全部满足」或「任一满足」。改动后自动刷新结果。
    </p>
  </section>
</template>

<style scoped>
.rf {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  min-width: 0;
}

.rf__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.rf__icon {
  color: var(--muted);
}

.rf__title {
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
  white-space: nowrap;
}

.rf__count {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.rf__count--muted {
  color: var(--muted);
}

/* 把剩余空间推给右侧按钮组；条件多时按钮仍靠右 */
.rf__spacer {
  flex: 1 1 auto;
  min-width: 0;
}

/* 0 条归因横幅：说清是哪条条件的锅，别让用户瞎猜 */
.rf__banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: var(--text-xs);
  line-height: var(--leading-normal, 1.5);
}

.rf__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.rf__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

/* 未填完整的条件：整体弱化 + 虚线边，直观说明「这条还没生效」 */
.rf__row--pending {
  border-style: dashed;
  background: transparent;
}

.rf__row--pending .rf__field,
.rf__row--pending .rf__op,
.rf__row--pending .rf__value {
  opacity: 0.62;
}

/* 单独看就 0 条：左边框标红，一眼定位「该改哪条」 */
.rf__row--zero {
  border-color: var(--danger);
  box-shadow: inset 3px 0 0 0 var(--danger);
}

.rf__join {
  flex: 0 0 auto;
  min-width: 1.4em;
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
}

.rf__field {
  flex: 0 1 190px;
  min-width: 140px;
}

.rf__op {
  flex: 0 1 132px;
  min-width: 110px;
}

.rf__value {
  flex: 1 1 260px;
  min-width: 180px;
}

/* 多选 tag：值可能很长（实测 161 字符），截断 + title 兜底，避免撑爆整行 */
.rf__value :deep(.el-tag) {
  max-width: 100%;
}

.rf__value :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 值区：下拉 + 其下方的候选状态说明（说明换行显示，不挤压同行其他控件） */
.rf__valuewrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1 1 260px;
  min-width: 180px;
}

.rf__vnote {
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: var(--leading-normal, 1.5);
}

/* 候选加载失败：明确降级为「手输」，不静默显示「无值」 */
.rf__vnote--warn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--danger);
}

/* 下拉选项：值占位可截断（最长实测 161 字符），条数右对齐不换行 */
.rf__opt-val {
  margin-right: var(--space-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rf__opt-count {
  float: right;
  color: var(--muted);
  font-size: var(--text-xs);
}

.rf__novalue {
  flex: 1 1 260px;
  font-size: var(--text-xs);
  color: var(--muted);
}

/* 独立命中数：默认弱化（辅助信息），0 条时转红 */
.rf__stat {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
}

.rf__stat--zero {
  color: var(--danger);
  font-weight: var(--weight-emphasize);
}

.rf__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal, 1.6);
}

.rf__summary-label {
  flex: 0 0 auto;
  color: var(--muted);
}

.rf__summary-text {
  color: var(--fg-2);
  word-break: break-word;
}

.rf__hint {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal, 1.6);
  color: var(--muted);
}
</style>