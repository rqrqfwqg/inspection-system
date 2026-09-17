// 台账反查检索 + 懒加载树通用节点（RelTree）类型 —— 自 assetViz.ts 拆分，字段未改

// ==================== 台账反查检索（GET /assets/asset-ledger/resolve） ====================

/** 一个检索候选（可能是已登记设备，也可能只是台账/资料域编号） */
export interface LedgerResolveCandidate {
  device_code: string
  name: string
  asset_name: string
  location: string
  area: string
  /** devices=已登记台账 / ledger_only=仅在台账（含资料域编号） */
  source: string
  /** 命中方式，如 brand_extract_exact（从品牌型号里反解出的机身号） */
  match_type: string
  match_field: string
  matched_value: string
  confidence: number
  has_serial: boolean
  in_devices: boolean
  source_demoted: boolean
}

/** GET /assets/asset-ledger/resolve?q= —— 手动输入编号 → 反查台账（权威匹配内核） */
export interface LedgerResolveResponse {
  query: string
  normalized: { raw: string; upper: string; loose: string }
  kind: string
  exact: boolean
  count: number
  candidates: LedgerResolveCandidate[]
}

// ==================== 懒加载树通用节点（RelTree 原语） ====================

/**
 * 四棵树的节点形状契约（`AreaNode` / `SubsystemNode` / `DeviceHierarchyNode` /
 * `BaSystemNode` 都结构兼容它），供 `components/common/RelTree.vue` 这一个原语驱动
 * 「lazy + load + count 徽标 + 点击」——避免四份重复实现。
 *
 * 纪律：`type` 在各树里是各自的字面量联合（'room' | 'power_box' | …），在此退化为
 * `string` 仅作分发键；`meta` 里的值一律 `unknown`，读取时必须显式 `String()` /
 * `Number()` 转换（与 React 版同写法，不做隐式断言）。
 */
export interface RelNode {
  key: string
  type: string
  label: string
  /** 真实归属数量（设备数 / 记录数，随树而异） */
  count?: number
  has_children?: boolean
  meta?: Record<string, unknown>
  [key: string]: unknown
}
