// 单设备联动总览 类型 —— 自 assetViz.ts 拆分，字段未改

// ==================== 单设备联动总览（GET /assets/link/device/{code}） ====================

/** 一条关联边（含来源标注：自动 / 人工） */
export interface DeviceLinkEdge {
  id: number
  from_code: string
  to_code: string
  /** 对端编号 */
  other_code: string
  /** 对端在台账/机房/资料域中的归属 */
  other_kind: 'device' | 'room' | 'record' | 'unknown' | string
  other_name: string | null
  relation_type: string
  /** power / cooling / locate / control / signal / pipe / network / other */
  kind: string
  direction: 'in' | 'out'
  /** auto=规则引擎自动建立 / manual=人工建立 */
  source: 'auto' | 'manual'
  source_label: string
  /** 仅自动边：命中的规则 id */
  rule: string | null
  confidence: number | null
  /** 仅自动边：判定证据（可解释） */
  evidence: string | null
  domain: string | null
  batch: string | null
}

/** 单设备（或机房）的联动总览 */
export interface DeviceLinkResponse {
  code: string
  /** record = 只存在于 records.device_code 的资料域对象（电柜 / 配电箱 / 图纸回路） */
  kind: 'device' | 'room' | 'record'
  name: string | null
  subsystem: { id: number; code: string; name: string; icon?: string } | null
  building: string | null
  floor: string | null
  /** 是否已登记台账（devices 表命中）。kind=record 时恒为 false */
  in_ledger: boolean
  /** 该编号占用的资料表（按记录数降序）；kind=record 时用于说明"它是什么" */
  owner_tables: {
    table_id: number
    table_code: string | null
    table_name: string
    subsystem: { id: number; code: string; name: string; icon?: string } | null
    record_count: number
  }[]
  record_count: number
  table_count: number
  /** 资料记录，按资料表分组（与「数据表管理」同源） */
  groups: {
    table_id: number
    table_code: string | null
    table_name: string
    subsystem: { id: number; code: string; name: string; icon?: string } | null
    records: { id: number; table_id: number; device_code: string; data: Record<string, unknown> }[]
  }[]
  edges: DeviceLinkEdge[]
  edges_auto: DeviceLinkEdge[]
  edges_manual: DeviceLinkEdge[]
  edge_summary: {
    total: number
    auto: number
    manual: number
    by_type: Record<string, number>
  }
}

