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

/** 单条筛选条件 */
export interface RecordFilter {
  /** 字段 key；筛选关联键时用 `DEVICE_CODE_FIELD` */
  field: string
  op: FilterOp
  value: string
}

/** 该值是否已「填完整」（用于是否触发请求，以及按钮可用态） */
export function isFilterActive(f: RecordFilter): boolean {
  return VALUELESS_OPS.includes(f.op) || f.value.trim() !== ''
}

/**
 * 序列化为后端可解析的形式。
 * 🔴 **必须过滤掉未填完整的条件**：否则用户刚点「添加条件」还没输值就会发一次
 *    无意义请求，且空值条件会被后端丢弃 → 前端显示的条件条数与实际生效条件数不一致。
 */
export function serializeFilters(filters: RecordFilter[]): string | undefined {
  const usable = filters.filter(isFilterActive)
  if (usable.length === 0) return undefined
  return JSON.stringify(usable.map((f) => ({ field: f.field, op: f.op, value: f.value })))
}

/** 新建一条默认条件（默认「包含」，最常用） */
export function makeFilter(field: string): RecordFilter {
  return { field, op: 'contains', value: '' }
}

/** 把条件列表摘要成一句话，用于「N 个条件」折叠态的 title 与导出提示 */
export function describeFilters(filters: RecordFilter[], logic: FilterLogic): string {
  const fieldLabel = (key: string): string =>
    key === DEVICE_CODE_FIELD ? '关联键' : key
  const parts = filters
    .filter(isFilterActive)
    .map((f) => `${fieldLabel(f.field)} ${FILTER_OPS[f.op]}「${f.value.trim() || '空'}」`)
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
 * 🔴 候选已由后端按 **ASCII 大小写折叠** 合并（`UPS` 与 `ups` 合为一项），
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
