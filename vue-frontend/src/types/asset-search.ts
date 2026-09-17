import type { RecordItem, Device } from './asset-core'

// 搜索结果 / 设备关联 / 供电链 / 候选补全 类型 —— 自 asset.ts 拆分，字段未改

// ==================== 设备关联 ====================
export interface DeviceRelation {
  id: number
  from_code: string
  to_code: string
  relation_type: string
  subsystem_id: number | null
  meta: Record<string, any>
  created_at: string
}

export interface DeviceRelationPayload {
  from_code: string
  to_code: string
  relation_type?: string
  subsystem_id?: number | null
  meta?: Record<string, any>
}
export type DeviceRelationUpdatePayload = Partial<DeviceRelationPayload>

// ==================== 搜索结果 ====================
export interface SearchNode {
  device_code: string
  name: string
  subsystem_code: string | null
  subsystem_name: string | null
  depth: number
  /** true = 已在 devices 主表登记；false = 仅存在于现场台账 records（画像由 records 反查） */
  in_ledger?: boolean
}

export interface SearchEdge {
  from: string
  to: string
  type: string | null
  subsystem_code: string | null
}

export interface SearchTableGroup {
  table_id: number
  table_code: string
  table_name: string
  records: RecordItem[]
}

export interface SearchGroup {
  subsystem_code: string | null
  subsystem_name: string | null
  subsystem_icon: string
  tables: SearchTableGroup[]
}

export interface DeviceProfile {
  device_code: string
  name: string
  subsystem_code?: string | null
  subsystem_name?: string | null
  building?: string
  floor?: string
  location?: string
  room?: { room_code?: string; room_name?: string; building?: string; floor?: string } | null
  tag_no?: string
  photo_count: number
  in_ledger: boolean
  record_count: number
  related_count: number
  subsystem_count: number
  aliases_count: number
  problems_count: number
  source_tables: string[]
}

export interface PowerChainNode {
  device_code: string
  name?: string
  depth: number
  role: string
}

export interface PowerChainEdge {
  rid: number
  from: string
  to: string
  type: string
  side: 'up' | 'down'
  depth: number
}

export interface PowerChain {
  start_code: string
  upstream: PowerChainNode[]
  downstream: PowerChainNode[]
  edges: PowerChainEdge[]
}

export interface DeviceSuggestItem {
  code: string
  name?: string
  in_ledger: boolean
  source: string
  subsystem_name?: string | null
  tables?: string[]
}

export interface SearchResult {
  /** 命中对象（设备；未登记 devices 的台账编号为 null，用 profile 兜底） */
  target: Device | null
  found: boolean
  nodes: SearchNode[]
  edges: SearchEdge[]
  groups: SearchGroup[]
  total_records: number
  // ===== 扩展聚合（与 asset_schemas.SearchResult 一一对应，2026-09-15 补齐）=====
  /** 固定资产财务块（无则 null） */
  fixed_asset?: Record<string, any> | null
  /** 设备档案块（无则 null） */
  archive?: Record<string, any> | null
  /** 配件列表 */
  accessories?: Record<string, any>[]
  /** 所属机房 {room_code, room_name, building, floor} */
  room?: Record<string, any> | null
  /** BA 问题列表 */
  problems?: Record<string, any>[]
  /** 编号别名溯源 */
  aliases?: Record<string, any>[]
  profile?: DeviceProfile | null
  power_chain?: PowerChain | null
}

export interface BulkResult {
  success: boolean
  created: number
  skipped: number
}

