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

/**
 * 合并预演结果（同房间设备合并 · 弹窗展示「将要发生什么」）。
 * 与正式执行走**同一个**后端函数，所以这里的数字 = 点确认后的实际结果。
 */
export interface RoomDeviceMergePlan {
  room_code: string
  /** 保留的主设备 */
  keep: InventoryDeviceRow
  /** 被并入的旧设备 */
  merge: InventoryDeviceRow
  /** 资料表里作为「记录归属依据」的关联键字段名 */
  relation_key: string | null
  /** 将被改挂到主设备的资料记录条数 */
  records_to_rewrite: number
  record_ids: number[]
  /** 旧编号身上将被改指向主设备的关系边数 */
  relations_to_move: number
  /** 该旧编号已有别名映射（可能是指向别的设备） */
  alias_exists: boolean
  /** 已经合并过了（本次是空操作） */
  already_merged: boolean
}

/** 一次「自动释放旧合并」的恢复统计（合并新设备触发旧合并按快照拆回） */
export interface RoomDeviceMergeRelease {
  canonical_code: string
  restored_code: string
  records_restored: number
  records_skipped: number
  edges_restored: number
  device_mode: string
}

/** POST /assets/rooms/{code}/devices/merge —— dry_run=true 的响应 */
export interface RoomDeviceMergeDryRun {
  dry_run: true
  plan: RoomDeviceMergePlan
  /** 预演中检测到旧合并，正式执行将先按快照释放这些合并 */
  auto_release?: RoomDeviceMergeRelease[]
}

/** POST /assets/rooms/{code}/devices/merge —— 正式执行响应 */
export interface RoomDeviceMergeResult {
  success: boolean
  /** 之前已合并过，本次空操作 */
  already_merged: boolean
  /** 本次执行前自动释放掉的旧合并（按快照拆回） */
  auto_release?: RoomDeviceMergeRelease[]
  canonical_code: string
  merged_code: string
  records_rewritten?: number
  relations_moved?: number
  device: InventoryDeviceRow
  room: RoomBrief
  count: number
}

/** POST /assets/devices/unmerge —— 管理员撤销合并（按快照精确逆向） */
export interface RoomDeviceUnmergeResult {
  success: boolean
  canonical_code: string
  restored_code: string
  records_restored: number
  records_skipped: number
  edges_restored: number
  device_mode: string
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
