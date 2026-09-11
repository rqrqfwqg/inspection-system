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

// ===== P2：扫码盘点 · 房间 ↔ 设备（一对多） =====
// 后端契约见 asset_routes.py「扫码盘点」段；落点 = device_relations 的「所在机房」边
// （from_code = 设备编号 → to_code = 房间编号）+ devices.room_id/building/floor 回填。

/** 房间简要信息（盘点接口统一返回体） */
export interface RoomBrief {
  id: number
  code: string
  name: string
  building: string
  floor: string
  room_type?: string
}

/** 盘点设备行 */
export interface InventoryDeviceRow {
  device_code: string
  name: string
  subsystem_name?: string | null
  /** 是否已在 devices 台账登记（false = 仅台账资料里存在的真实设备） */
  is_registered: boolean
  is_active: boolean
  location_desc?: string
}

/** GET /assets/rooms/{code}/devices */
export interface RoomDevicesResult {
  room: RoomBrief
  count: number
  devices: InventoryDeviceRow[]
}

/** 盘点进度行（房间 + 已绑定设备数） */
export interface RoomInventoryRow extends RoomBrief {
  device_count: number
}

/** GET /assets/rooms/inventory/overview */
export interface RoomInventoryOverview {
  total_rooms: number
  rooms_with_devices: number
  total_bound_devices: number
  rooms: RoomInventoryRow[]
}

/** POST /assets/rooms/{code}/devices 成功响应 */
export interface BindDeviceResult {
  success: boolean
  /** true = 该设备本就绑在本房间（重复扫） */
  already: boolean
  /** 非空 = 本次是从该房间改挂过来的 */
  moved_from: string | null
  device: InventoryDeviceRow
  room: RoomBrief
  count: number
}

/** 绑定命中「设备已归属其他房间」（HTTP 409）——需用户确认改挂 */
export interface BindDeviceConflict {
  conflict: true
  /** 设备当前归属的房间编号（解析失败时为空串） */
  room_code: string
  message: string
}

export type BindDeviceOutcome = BindDeviceResult | BindDeviceConflict

/** DELETE /assets/rooms/{code}/devices/{device_code} */
export interface UnbindDeviceResult {
  success: boolean
  removed: number
  device_code: string
  room: RoomBrief
  count: number
}
