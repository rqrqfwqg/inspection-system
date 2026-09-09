// 扫码补录 P0 · 类型定义
// 严格对齐后端真实契约：backend/asset_schemas.py SearchResult / DeviceResponse
// + backend/asset_routes.py 照片与列表接口（P0 新增）
// 注意：与 features/assets/types.ts 的宽松版不同，此处按真实响应字段建模。

/** 设备（/search.target 与 /devices 行） */
export interface ScanDevice {
  id: number
  device_code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string | null
  room_id?: number | null
  building?: string
  floor?: string
  location_desc?: string
  parent_device_id?: number | null
  is_active?: boolean
  [key: string]: unknown
}

/** 所属机房块（/search.room） */
export interface ScanRoomBlock {
  room_code: string
  room_name: string
  building: string
  floor: string
}

/** 关联资料分组（/search.groups[].tables[].records[]） */
export interface ScanTableGroup {
  table_id: number
  table_code?: string
  table_name: string
  records: Array<Record<string, unknown>>
  [key: string]: unknown
}
export interface ScanSubsystemGroup {
  subsystem_code?: string | null
  subsystem_name?: string
  subsystem_icon?: string
  tables: ScanTableGroup[]
}

/** 设备聚合检索响应（GET /assets/search?code=） */
export interface ScanSearchResult {
  found: boolean
  target?: ScanDevice | null
  nodes?: Array<{ device_code: string; name?: string; depth?: number; [key: string]: unknown }>
  edges?: Array<{ from: string; to: string; type?: string; kind?: string; subsystem_code?: string | null }>
  groups?: ScanSubsystemGroup[]
  total_records?: number
  fixed_asset?: Record<string, unknown> | null
  archive?: Record<string, unknown> | null
  accessories?: Array<Record<string, unknown>>
  room?: ScanRoomBlock | null
  problems?: Array<Record<string, unknown>>
  aliases?: Array<{ alias_code: string; source?: string }>
}

/** 设备照片（GET/POST /assets/devices/{did}/photos） */
export interface DevicePhotoItem {
  id: number
  device_code: string
  url: string
  note?: string
  created_by?: string
  created_at?: string
}

/** 机房（GET /ops/api/rooms） */
export interface ScanRoom {
  id: number
  building: string
  floor: string
  name: string
  code: string
  room_type?: string
  is_active?: boolean
}

/** 子系统（GET /assets/subsystems） */
export interface ScanSubsystem {
  id: number
  code: string
  name: string
  icon?: string
}

/** 打印候选行（GET /assets/devices 增强版） */
export interface QrDeviceRow {
  id: number
  device_code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string | null
  building?: string
  floor?: string
  location_desc?: string
}

// ===== P1：现场建边 + 上游供电/冷源链 =====

/** 关联类型字典（GET /assets/relation-types） */
export interface ScanRelationType {
  code: string
  label: string
  kind: string          // power/cooling/locate/network/control/pipe/accessory/other
  direction: string     // forward/none
  description?: string
  sort_order?: number
  is_active?: boolean
}

/** 供电/冷源链节点 */
export interface PowerChainNode {
  device_code: string
  name?: string
  depth: number
  role?: string         // start/上游/下游
}

/** 供电/冷源链边（含遍历方向 side，相对起点） */
export interface PowerChainEdge {
  rid?: number
  from: string
  to: string
  type: string
  side: string          // up/down（相对起点设备的语义方向）
  depth: number
}

/** 上游供电链响应（GET /assets/devices/{did}/power-chain） */
export interface PowerChainResult {
  start_code: string
  depth: number
  side?: string
  nodes: PowerChainNode[]
  edges: PowerChainEdge[]
}

/** 建边请求（POST /assets/relations） */
export interface CreateRelationPayload {
  from_code: string
  to_code: string
  relation_type: string   // 传 code 或 label 均可，后端归一
  subsystem_id?: number | null
  meta?: Record<string, unknown>
}
