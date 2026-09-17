// 资料检索（/asset/search）—— 前端类型契约
//
// 契约真源：docs/rewrite-vue/SPEC.md §5.2（端点与「参数名」）
// 形状真源：React 版 src/features/assets/types.ts + src/types/asset.ts（照抄契约，不照抄技术）
//
// 四个端点各自的参数名（写错即 422，逐字对照 SPEC §5.2）：
//   GET /assets/search                  → code  + depth
//   GET /assets/search/suggest          → q     + limit
//   GET /assets/link/global-search      → q     + limit
//   GET /assets/asset-ledger/resolve    → q

/** GET /assets/search/suggest —— 联想候选：devices 编号/名称 + 现场台账 records + 编号别名 */
export interface DeviceSuggestItem {
  code: string
  name?: string
  /** true = 已登记进 devices 主表；false = 只存在于现场台账 records */
  in_ledger: boolean
  /** 命中来源描述，可能以「别名」开头 */
  source: string
  subsystem_name?: string | null
  /** 该编号出现在哪些资料表（后端截断后的前几张） */
  tables?: string[]
}

/** GET /assets/search —— 命中对象（devices 主表行；未登记 devices 的台账编号为 null） */
export interface SearchTarget {
  id?: number
  device_code?: string | null
  name?: string | null
  subsystem_name?: string | null
  building?: string | null
  floor?: string | null
  location_desc?: string | null
  is_active?: boolean | null
}

/** 关联边（方向由 from → to 表达） */
export interface SearchEdge {
  from: string
  to: string
  type: string | null
  subsystem_code?: string | null
}

export interface SearchTableGroup {
  table_id: number
  table_code: string
  table_name: string
  /** 命中记录（本页只用条数，不渲染记录内容——记录字段由动态表结构决定） */
  records: unknown[]
}

export interface SearchGroup {
  subsystem_code: string | null
  subsystem_name: string | null
  tables: SearchTableGroup[]
}

export interface SearchResult {
  target: SearchTarget | null
  found: boolean
  edges: SearchEdge[]
  groups: SearchGroup[]
  total_records: number
}

/** 台账反查候选：可能是已登记设备，也可能只是台账 / 资料域编号（电柜、配电箱、图纸回路） */
export interface LedgerResolveCandidate {
  device_code: string
  name: string
  asset_name: string
  location: string
  area: string
  /** devices = 已登记台账；ledger_only = 仅台账（含资料域编号） */
  source: string
  /** 命中方式，如 brand_extract_exact（从品牌型号里反解出的机身号） */
  match_type: string
  match_field: string
  matched_value: string
  /** 后端给的原始分值，前端不做百分比换算（避免擅自解释量纲） */
  confidence: number
  has_serial: boolean
  in_devices: boolean
  source_demoted: boolean
}

/** GET /assets/asset-ledger/resolve —— 走权威匹配内核，设备域与资料域双侧命中 */
export interface LedgerResolveResponse {
  query: string
  normalized: { raw: string; upper: string; loose: string }
  kind: string
  exact: boolean
  count: number
  candidates: LedgerResolveCandidate[]
}

export interface GlobalSearchHit {
  id: number
  device_code?: string | null
  /** 命中关键词的字段（标签 + 已截断的值） */
  fields: { label: string; value: string }[]
}

export interface GlobalSearchTable {
  table_id: number
  code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string
  hit_count: number
  samples: GlobalSearchHit[]
}

/** GET /assets/link/global-search —— 对每一张启用资料表都搜一遍 */
export interface GlobalSearchResponse {
  query: string
  tables_hit: number
  total_hits: number
  results: GlobalSearchTable[]
}

/**
 * 一次检索的三域结果。
 * 三个端点并发发出、各自独立结算：任一域失败不拖垮其余域（部分失败走页内提醒），
 * 三域全失败才判定为错误态。
 */
export interface SearchBundle {
  /** 本次检索的编号（已 trim） */
  keyword: string
  /** 台账反查：设备域 + 资料域双侧命中 */
  resolve: LedgerResolveResponse | null
  /** 设备多维聚合：基础信息 + 跨子系统资料明细 + 关联边 */
  result: SearchResult | null
  /** 资料域全局模糊搜索 */
  global: GlobalSearchResponse | null
  /** 失败域的可读消息（前缀域名），供页内 warning 提醒 */
  errors: string[]
}
