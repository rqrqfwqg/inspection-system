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