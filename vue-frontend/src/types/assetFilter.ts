// 数据表记录 · 结构化条件筛选（与后端 record_filters.py 的契约一一对应）
// =====================================================================
// 条件序列化后作为 `filters` 查询串提交（JSON 数组字符串），顶层组合方式走 `filter_logic`。
// 🔴 算子名与中文标签必须与后端 `record_filters.OPS` 完全一致 —— 改一边就要改两边，
//    否则前端下拉里的选项会被后端 400 拒掉（属于「筛不出来的静默失败」，最伤排查体验）。

/** 关联键（records.device_code 独立列，不在 data JSON 内）—— 后端约定的特殊字段名 */
export const DEVICE_CODE_FIELD = '__device_code'

/** 匹配方式；键与后端 record_filters.OPS 一致 */
export const FILTER_OPS = {
  contains: '包含',
  not_contains: '不包含',
  eq: '等于',
  ne: '不等于',
  starts_with: '开头是',
  ends_with: '结尾是',
  is_empty: '为空',
  not_empty: '不为空',
} as const

export type FilterOp = keyof typeof FILTER_OPS

/** 不需要填值的算子（选它们时前端隐藏输入框，而不是让用户填一个必填的空框） */
export const VALUELESS_OPS: readonly FilterOp[] = ['is_empty', 'not_empty']

/** 多条件的顶层组合方式 */
export type FilterLogic = 'and' | 'or'

/**
 * 🔴 **否定算子**（多选时组内语义与正算子相反，见后端 `record_filters.NEGATIVE_OPS`）。
 * 正算子多选 = 「等于 A 或 B」；否定算子多选 = 「既不等于 A 也不等于 B」= NOT(A OR B)。
 * 若这里按 OR 理解，界面文案会与实际结果**相反**（用户以为排除了两类，实际几乎全命中）。
 */
export const NEGATIVE_OPS: readonly FilterOp[] = ['ne', 'not_contains']

/** 上限须与后端 record_filters 一致：MAX_CONDITIONS / MAX_VALUES_PER_COND / MAX_VALUE_LEN */
export const MAX_CONDITIONS = 20
export const MAX_VALUES_PER_COND = 50
export const MAX_VALUE_LEN = 200

/** 单条筛选条件 */
export interface RecordFilter {
  /** 字段 key；筛选关联键时用 `DEVICE_CODE_FIELD` */
  field: string
  op: FilterOp
  /**
   * 🔴 多值列表（**始终是数组**，长度 0/1/N 都要走同一个字段）。
   * 曾经用 `value: string`，多选时必须改成「value + values 双字段」，
   * 那会让序列化分两套分支、且两处不一致时静默筛错 —— 一律归一成数组。
   */
  values: string[]
}

/** 该条件是否已「填完整」（用于是否触发请求，以及按钮可用态） */
export function isFilterActive(f: RecordFilter): boolean {
  return VALUELESS_OPS.includes(f.op) || f.values.some((v) => v.trim() !== '')
}

/** 规整一条条件：去空白、去 ASCII 大小写重复（与后端 parse_filters 同口径） */
function normalizeValues(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const v = (raw ?? '').trim().slice(0, MAX_VALUE_LEN)
    if (!v) continue
    // 🔴 去重必须按 ASCII 折叠（匹配大小写不敏感，`UPS` 与 `ups` 是同一个条件）
    const key = v.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.slice(0, MAX_VALUES_PER_COND)
}

/**
 * 序列化为后端可解析的形式。
 * 🔴 **必须过滤掉未填完整的条件**：否则用户刚点「添加条件」还没输值就会发一次
 *    无意义请求，且空值条件会被后端丢弃 → 前端显示的条件条数与实际生效条件数不一致。
 * 🔴 只发 `values`（不发 `value`）：后端以 `values` 为准，两处都给反而多一处出错面。
 */
export function serializeFilters(filters: RecordFilter[]): string | undefined {
  const usable = filters.filter(isFilterActive)
  if (usable.length === 0) return undefined
  return JSON.stringify(
    usable.map((f) => ({
      field: f.field,
      op: f.op,
      values: VALUELESS_OPS.includes(f.op) ? [] : normalizeValues(f.values),
    })),
  )
}

/** 新建一条默认条件（默认「包含」，最常用） */
export function makeFilter(field: string): RecordFilter {
  return { field, op: 'contains', values: [] }
}

/**
 * 条件列表的**稳定指纹**：内容变了才变。
 * 🔴 必须包含 `values` 的内容（不能只看字段/算子）—— 否则用户改了值、
 *    指纹却不变 → 父级会跳过重查 → 界面显示的值与结果对不上（典型的静默失效）。
 * 🔴 用排序后的副本参与指纹：值的顺序不影响结果（组内是 OR/AND 交换律），
 *    否则「先选 A 后选 B」与「先选 B 后选 A」会被当成两个不同条件重复发请求。
 */
export function filterSignature(filters: RecordFilter[], logic: FilterLogic): string {
  const parts = filters
    .filter(isFilterActive)
    .map((f) => `${f.field}|${f.op}|${normalizeValues(f.values).slice().sort().join(',')}`)
  return `${logic}#${parts.join(';')}`
}

/** 多值的组内连接词（文案必须与后端编译语义一致，否则界面会骗人） */
export function joinValueLabel(f: RecordFilter): string {
  const vals = normalizeValues(f.values)
  if (vals.length === 0) return '…'
  if (vals.length === 1) return vals[0]
  return NEGATIVE_OPS.includes(f.op)
    ? `${vals.slice(0, 2).join('、')} 等 ${vals.length} 项（都不满足）`
    : `${vals.slice(0, 2).join('、')} 等 ${vals.length} 项（满足其一）`
}

/** 把条件列表摘要成一句话，用于「N 个条件」折叠态的 title 与导出提示 */
export function describeFilters(filters: RecordFilter[], logic: FilterLogic): string {
  const fieldLabel = (key: string): string =>
    key === DEVICE_CODE_FIELD ? '关联键' : key
  const parts = filters
    .filter(isFilterActive)
    .map((f) => {
      const label = fieldLabel(f.field)
      if (VALUELESS_OPS.includes(f.op)) return `${label} ${FILTER_OPS[f.op]}`
      const vals = normalizeValues(f.values)
      const inner = vals.length === 0 ? '空' : joinValueLabel(f)
      return `${label} ${FILTER_OPS[f.op]}「${inner}」`
    })
  if (parts.length === 0) return '无筛选条件'
  return parts.join(logic === 'and' ? ' 且 ' : ' 或 ')
}
// =====================================================================
// 字段候选值（值下拉数据源）—— 与后端 record_field_values.py 契约一一对应
// =====================================================================

/** 单个候选值。`count` = 该值在本表命中行数（选之前就知道会命中几条） */
export interface FieldValueItem {
  value: string
  count: number
}

/**
 * 候选值接口响应。
 * 🔴 `truncated` 为 true 表示还有更多（前端必须提示「继续输入以缩小范围」，
 *    否则用户会以为「这就是全部」，进而怀疑数据漏了）。
 * 🔴 候选已由后端按 **ASCII 大小写折叠**合并（`UPS` 与 `ups` 合为一项），
 *    所以 `count` 与用该值做 `eq` 筛选的实际命中数**严格相等**。
 */
export interface FieldValuesResult {
  field: string
  values: FieldValueItem[]
  /** 该字段 distinct 非空值总数（截断前） */
  total: number
  /** 本次实际返回条数 */
  returned: number
  /** q 过滤后命中条数（未截断） */
  matched: number
  truncated: boolean
}

/** 下拉里展示的文案：`值` + `· 命中 N 条`（条数是候选下拉的核心价值，不能省） */
export function describeValueItem(item: FieldValueItem): string {
  return `${item.value} · ${item.count} 条`
}

/** 已选值的 chip 文案：`值 · N 条`（选中后也要看得见条数，否则 tag 里信息全丢） */
export function describeSelectedChip(value: string, counts: Record<string, number>): string {
  const n = counts[value]
  return typeof n === 'number' ? `${value} · ${n}` : value
}

// =====================================================================
// 筛选命中归因（哪条条件把结果杀成 0）—— 与后端 record_filter_stats.py 契约一一对应
// =====================================================================

/**
 * 归因接口响应。
 * 🔴 `counts` 与请求里的条件**等长同序**（后端保证），前端按下标直接取 ——
 *    绝不在前端做「过滤掉 0 条」的对齐，那极易错位（改一条条件后全错）。
 */
export interface FilterStatsResult {
  /** 不带条件、只带搜索词的行数（归因的分母） */
  total: number
  /** 全部条件按 logic 组合后的行数（== 实际会看到的条数） */
  combined: number
  /** counts[i] = 只有第 i 条条件生效时的命中行数 */
  counts: number[]
}

/** 单条条件的归因展示状态 */
export interface ConditionStat {
  /** 独立命中数；undefined = 未知（还没查 / 查失败） */
  count?: number
  loading?: boolean
}

/** 归因状态表：下标 → 统计（与 filters **等长同序**） */
export type FilterStatsMap = Record<number, ConditionStat>