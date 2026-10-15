// ========== 设备资产巡检（inspection-system）类型定义 ==========
// 严格对齐巡检后端 backend/asset_schemas.py 与 asset_routes.py 的真实响应契约。
// 与 src/types/index.ts（工器具后端）是两套独立后端，勿混用。

/** 机房（GET /rooms） */
export interface AssetRoom {
  id: number
  building: string
  floor: string
  name: string
  code: string
  room_type?: string
  is_active?: boolean
}

/** 设备（/assets/search 的 target） */
export interface AssetDevice {
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

/** 所属机房块（/assets/search 的 room） */
export interface AssetRoomBlock {
  room_code: string
  room_name: string
  building: string
  floor: string
}

/** 关联边（/assets/search 的 edges） */
export interface AssetEdge {
  from: string
  to: string
  type?: string
  kind?: string
  subsystem_code?: string | null
  [key: string]: unknown
}

/**
 * 固定资产台账块（/assets/search 的 fixed_asset，来自 fixed_assets 表）。
 * 现场扫码核对的关键来源：brand_model 形如「白云电器，配电箱 G-1D9APt」，
 * 其中末尾的 G-1D9APt 是**设备机身编号**（与 serial_no 不是同一个值）。
 */
export interface FixedAssetBlock {
  device_code?: string
  asset_name?: string
  asset_code?: string
  /** 品牌型号文本（机身编号嵌在其中） */
  brand_model?: string
  /** 资产序列号（≠ 机身编号） */
  serial_no?: string
  location?: string
  [key: string]: unknown
}

/**
 * 设备聚合检索结果（GET /assets/search?code=&depth=）
 *
 * 一次请求即拿齐「设备属性页」所需的大部分内容：画像统计、上下级供电链、
 * BA 问题、编号别名、配件、资料分组。depth 控制供电链回溯跳数（后端 clamp 1..5）。
 */
export interface AssetSearchResult {
  found: boolean
  target?: AssetDevice | null
  nodes?: Array<{ device_code: string; name?: string; depth?: number; [key: string]: unknown }>
  edges?: AssetEdge[]
  room?: AssetRoomBlock | null
  aliases?: Array<{ alias_code: string; source?: string }>
  total_records?: number
  /** 固定资产台账块（含 brand_model / serial_no），无固定资产时为 null */
  fixed_asset?: FixedAssetBlock | null
  /** 设备档案块（device_archives） */
  archive?: Record<string, unknown> | null
  /** 画像统计块（资料记录数 / 关联关系数 / 照片数 / 是否已进台账…） */
  profile?: AssetSearchProfile | null
  /** 供电 / 冷源链（上游 · 下游 · 边，边带 rid 可直接删除） */
  power_chain?: AssetPowerChain | null
  /** BA 问题摘要行 */
  problems?: AssetBaProblem[]
  /** 配件清单 */
  accessories?: Array<Record<string, unknown>>
  /** 资料记录分组（子系统 → 资料表 → 记录） */
  groups?: Array<Record<string, unknown>>
  [key: string]: unknown
}

/** 设备画像块（/assets/search 的 profile）—— 属性页顶部四个统计格的来源 */
export interface AssetSearchProfile {
  device_code: string
  name?: string
  subsystem_code?: string
  subsystem_name?: string
  building?: string
  floor?: string
  location?: string
  room?: AssetRoomBlock | null
  tag_no?: string
  /** 现场照片数 */
  photo_count?: number
  /** 是否已登记进设备台账（devices 表） */
  in_ledger?: boolean
  record_count?: number
  related_count?: number
  subsystem_count?: number
  aliases_count?: number
  problems_count?: number
  source_tables?: string[]
}

/** 供电 / 冷源链节点 */
export interface AssetPowerChainNode {
  device_code: string
  name?: string
  /** 距本设备的跳数（后端已剔除 depth=0 的自己） */
  depth: number
  /** 上游 / 下游 */
  role?: string
}

/**
 * 供电 / 冷源链边。
 * 方向语义（与后端及 Web 端一致）：forward 类边 from=上游(供电方) → to=下游(受电方)。
 */
export interface AssetPowerChainEdge {
  /** device_relations.id —— 删除该条关联用 */
  rid: number
  from: string
  to: string
  type: string
  side: 'up' | 'down'
  depth: number
}

/** 供电 / 冷源链（/assets/search 的 power_chain） */
export interface AssetPowerChain {
  start_code: string
  upstream: AssetPowerChainNode[]
  downstream: AssetPowerChainNode[]
  edges: AssetPowerChainEdge[]
}

/** BA 问题行（GET /assets/ba/problems 的 items，也可来自 search.problems） */
export interface AssetBaProblem {
  id: number
  ba_device_no?: string | null
  device_code?: string | null
  ba_system?: string | null
  ba_system_code?: string | null
  problem_type?: string | null
  group_area?: string | null
  location?: string | null
  /** open / processing / closed */
  status?: string | null
}

/** BA 问题响应（GET /assets/ba/problems） */
export interface AssetBaProblemsResponse {
  items: AssetBaProblem[]
  total: number
  page?: number
  page_size?: number
  summary?: { total: number; open: number; processing: number; closed: number; unclosed: number }
}

/**
 * 关联边（GET /assets/link/device/{code}）。
 * 比 /assets/search 的 edges 多了 three 件关键信息：对方名称、对方类型、来源(自动/人工)标注。
 */
export interface AssetDeviceLinkEdge {
  id: number
  from_code: string
  to_code: string
  other_code: string
  /** device / room / record / unknown */
  other_kind: string
  other_name?: string | null
  relation_type: string
  kind?: string
  /** out = 本设备为 from（对方在下游）；in = 本设备为 to（对方在上游） */
  direction: 'out' | 'in'
  /** auto / manual */
  source: string
  source_label?: string
  rule?: string | null
  confidence?: number | null
  evidence?: string | null
}

/** 资料记录分组（link/device 的 groups） */
export interface AssetDeviceLinkGroup {
  table_id: number
  table_code?: string | null
  table_name: string
  subsystem?: { id: number; code: string; name: string; icon?: string } | null
  records: Array<{
    id: number
    table_id: number
    device_code: string
    data: Record<string, unknown>
  }>
}

/**
 * 单设备联动总览（GET /assets/link/device/{code}）。
 * ⚠️ 该接口对「不在 devices / rooms 表」的设备返回 **404**（仅资料设备），
 * 调用方须容错降级，不能让它拖垮整页。
 */
export interface AssetDeviceLinkResult {
  code: string
  kind?: string
  name?: string
  building?: string | null
  floor?: string | null
  record_count: number
  table_count: number
  groups: AssetDeviceLinkGroup[]
  edges: AssetDeviceLinkEdge[]
  edges_auto?: AssetDeviceLinkEdge[]
  edges_manual?: AssetDeviceLinkEdge[]
  edge_summary?: {
    total: number
    auto: number
    manual: number
    by_type?: Record<string, number>
  }
}

/** 关联类型字典（GET /assets/relation-types） */
export interface AssetRelationType {
  code: string
  label: string
  /** power / cooling / locate / network / control / pipe / accessory / other */
  kind: string
  /** forward / none */
  direction: string
  description?: string
  sort_order?: number
  is_active?: boolean
}

/** 建边请求（POST /assets/relations） */
export interface CreateAssetRelationPayload {
  from_code: string
  to_code: string
  /** 传 code 或 label 均可，后端归一 */
  relation_type: string
  subsystem_id?: number | null
  meta?: Record<string, unknown>
}

/**
 * 关联边（GET /assets/relations?from_code=&to_code=）
 * 注意：该接口**不带过滤参数会返回全表 998 条**，调用时必须传 from_code 或 to_code。
 * 方向语义：forward 类（供电/供配电/上级配电/取电/冷源）from=上游(供电方) → to=下游(受电方)。
 */
export interface DeviceRelationItem {
  id: number
  from_code: string
  to_code: string
  relation_type: string
  subsystem_id?: number | null
  meta?: Record<string, unknown>
  created_at?: string
}

// ===== 扫码盘点 · 房间 ↔ 设备（一对多） =====
// 落点 = device_relations 的「所在机房」边（from_code = 设备编号 → to_code = 房间编号）
//      + devices.room_id / building / floor 回填。

/** 房间简要信息（盘点接口统一返回体） */
export interface AssetRoomBrief {
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
  /** 品牌型号（固定资产台账 fixed_assets.brand_model，如「白云电器，配电箱 G-1D9APt」） */
  brand_model?: string | null
  /** false = 未在 devices 台账登记（属仅台账资料里存在的真实设备） */
  is_registered: boolean
  is_active: boolean
  location_desc?: string
}

/** GET /assets/rooms/{code}/devices */
export interface RoomDevicesResult {
  room: AssetRoomBrief
  count: number
  devices: InventoryDeviceRow[]
  /** 该房间的已盘点记录；未盘点为 null */
  inspected?: RoomInspectedInfo | null
}

/**
 * 房间「已盘点」记录（后端 room_inventory_records）。
 * 与设备绑定口径解耦：本块只回答「这间房有没有被现场确认盘过」，
 * 因此 device_count=0（empty_confirmed）的**空房间也能是已盘点**。
 */
export interface RoomInspectedInfo {
  inspected: true
  /** completed（预留 pending / partial） */
  status: string
  /** 完成当刻的设备数快照（事后台账变动不改写历史） */
  device_count: number
  /** true = 现场确认本房间无设备（空房间盘点） */
  empty_confirmed: boolean
  operator: string
  remark: string
  source: string
  completed_at: string | null
}

/** 盘点进度行（房间 + 已绑定设备数 + 已盘点状态） */
export interface RoomInventoryRow extends AssetRoomBrief {
  device_count: number
  /** 该房间是否已现场确认盘点完成 */
  inspected: boolean
  /** 4 态：pending / doing / completed / abnormal（2026-10-13 盘点重做，后端真实状态） */
  inv_status?: 'pending' | 'doing' | 'completed' | 'abnormal'
  /** 本次实际扫码数（doing 态有意义） */
  scanned_count?: number
  /** 是否异常终态 */
  abnormal?: boolean
  /** 异常说明（abnormal 态） */
  abnormal_reason?: string
  /** 差异数（应扫 − 实扫） */
  diff_count?: number
  inspected_at?: string | null
  /** 开单时间（doing 态起点） */
  started_at?: string | null
  inspector?: string
  empty_confirmed?: boolean
}

/** GET /assets/rooms/inventory/overview */
export interface RoomInventoryOverview {
  total_rooms: number
  rooms_with_devices: number
  total_bound_devices: number
  /** 已盘点房间数 */
  inspected_rooms?: number
  /** 4 态分布（2026-10-13 新增，与 /inventory/report 同口径） */
  pending_rooms?: number
  doing_rooms?: number
  completed_rooms?: number
  abnormal_rooms?: number
  /** 已盘点且当时 0 台设备的房间数（空房确认） */
  empty_inspected_rooms?: number
  rooms: RoomInventoryRow[]
}

/** POST /assets/rooms/{code}/inventory/complete 入参 */
export interface CompleteRoomInventoryPayload {
  /** 盘点人（免鉴权模式下由端上报，后端截断存 64 字） */
  operator?: string
  remark?: string
  /** 来源端标记，默认 miniprogram */
  source?: string
}

/** POST /assets/rooms/{code}/inventory/complete 响应 */
export interface CompleteRoomInventoryResult {
  success: boolean
  room: AssetRoomBrief
  /** 服务端按绑定口径实时统计的设备数（= 记录里的快照值） */
  count: number
  inspected: RoomInspectedInfo
}

/** DELETE /assets/rooms/{code}/inventory/complete 响应 */
export interface UndoRoomInventoryResult {
  success: boolean
  removed: number
  room: AssetRoomBrief
}

/**
 * 离线待同步操作（本机 storage 队列）。
 * kind=bind → 扫码把设备挂到房间；kind=complete → 完成盘点确认。
 */
/** GET/POST /assets/devices/by-code/{code}/photos —— 设备现场照片 */
export interface AssetDevicePhoto {
  id: number
  /** canonical 设备编号（后端按编号归属，与 devices.id 无关） */
  device_code: string
  /** /ops/uploads/assets/photos/xxx.jpg 相对路径，展示前需拼域名 */
  url: string
  note: string
  created_by: string
  created_at: string | null
}

export interface PendingOp {
  id: string
  kind: 'bind' | 'complete' | 'photo' | 'resolve' | 'observe' | 'geo' | 'geo'
  roomCode: string
  /** kind=bind 时必填 */
  deviceCode?: string
  /** kind=complete 时用；kind=photo 时 operator 作为上传人 */
  operator?: string
  /** kind=complete 时是备注；kind=photo 时是照片说明 */
  remark?: string
  /** kind=photo 时必填：本地已持久化的文件路径（wxfile://…，小程序重启后仍有效） */
  savedPath?: string
  createdAt: number
  tries: number
  lastError?: string
  /** 409 冲突：设备当前归属的房间编号（联网后需人工确认是否改挂） */
  conflictFrom?: string
  /** kind=resolve 时必填：现场输入的原始编号（联网后补跑 resolve 再绑定） */
  rawCode?: string
  /** kind=observe 时必填：现场输入的原始机身编号（联网后补跑 resolve 再补录） */
  serialRaw?: string
  /** kind=observe 时：现场观测时间（ISO 串）；留空由后端取当前时间 */
  observedAt?: string
  /** kind=geo 时必填：扫码时取到的手机定位（gcj02） */
  latitude?: number
  longitude?: number
  /** kind=geo 时：水平精度半径（米）—— 室内漂移判据 */
  accuracy?: number
  /** kind=geo 时：扫码来源 camera / album / manual */
  scanSource?: string
}

/** POST /assets/rooms/{code}/devices 成功响应 */
export interface BindDeviceResult {
  success: boolean
  /** true = 该设备本就绑在本房间（重复扫） */
  already: boolean
  /** 非空 = 本次是从该房间改挂过来的 */
  moved_from: string | null
  device: InventoryDeviceRow
  room: AssetRoomBrief
  count: number
}

/** 绑定命中「设备已归属其他房间」（HTTP 409）—— 需用户确认改挂 */
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
  room: AssetRoomBrief
  count: number
}

/** 扫码日志条目（页面本地记录，非后端类型） */
export interface ScanLogItem {
  id: number
  level: 'success' | 'info' | 'warn' | 'error'
  text: string
  time: string
}

// ===== 资产总台账详情 / 机身编码反查 =====
// 数据源：GET /ops/api/assets/asset-ledger/detail?code=（单设备全字段）
//        GET /ops/api/assets/asset-ledger?q=（跨字段模糊反查，含 brand_model → 可用机身编码搜）

/** detail 的 device 块（devices 表；未登记时为 null） */
export interface AssetLedgerDeviceBlock {
  id: number | null
  device_code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string | null
  building?: string
  floor?: string
  location_desc?: string
  is_active?: boolean
  transfer_no?: string
  asset_code?: string
  bim_tag?: string
}

/**
 * detail 的 fixed_asset 块（固定资产总账全字段）。
 * brand_model 形如「白云电器，配电箱 G-1D9APt」，机身编号嵌在其中（见 utils/deviceLabel）。
 */
export interface AssetLedgerFixedBlock {
  device_code?: string
  transfer_no?: string
  tag_no?: string
  owner_unit?: string
  use_dept?: string
  location?: string
  asset_name?: string
  asset_code?: string
  brand_model?: string
  serial_no?: string
  recv_date?: string | null
  warranty_end?: string | null
  price_tax?: number | null
  price_notax?: number | null
  tax?: number | null
  budget_item?: string
  contract_no?: string
  bim_tag?: string
  builder?: string
  responsible?: string
  proj_manager?: string
  warranty_contact?: string
  remark?: string
  room_code?: string | null
  room_match_method?: string | null
  [key: string]: unknown
}

/** detail 的 archive 块（设备档案 device_archives；无档案时 null） */
export interface AssetLedgerArchiveBlock {
  device_code?: string
  pre_no?: string
  project?: string
  system_text?: string
  location?: string
  building?: string
  floor?: string
  old_name?: string
  asset_name?: string
  old_code?: string
  manufacturer?: string
  brand_model?: string
  recv_date?: string | null
  qty?: number | null
  unit?: string
  original_value?: number | null
  net_value?: number | null
  status_name?: string
  remark?: string
  [key: string]: unknown
}

/** detail 的 records 行（跨资料表台账记录） */
export interface AssetLedgerRecordItem {
  record_id: number
  table_id: number
  table_code?: string | null
  table_name?: string | null
  subsystem_name?: string | null
  /** 该资料表原始数据（JSON 列） */
  data: Record<string, unknown>
}

/** detail 的 relations 行（有向存储、无向查询） */
export interface AssetLedgerRelationItem {
  relation_id: number
  /** out = 本设备为该边 from；in = 本设备为该边 to */
  direction: 'out' | 'in'
  from_code: string
  to_code: string
  other_code: string
  relation_type: string
  relation_type_code?: string | null
  kind?: string | null
  meta?: Record<string, unknown> | null
}

/**
 * GET /assets/asset-ledger/detail 响应 —— 单设备「所有基础信息」。
 * 未登记进 devices、只在台账 records 里的现场设备同样返回（source='ledger_only'）。
 */
export interface AssetLedgerDetail {
  found: boolean
  code: string
  /** devices / fixed_asset / archive / ledger_only */
  source?: string
  device?: AssetLedgerDeviceBlock | null
  fixed_asset?: AssetLedgerFixedBlock | null
  archive?: AssetLedgerArchiveBlock | null
  profile?: Record<string, unknown> | null
  /** 确定性区域判定（停车楼 / GTC / 市政 / 工作区 / N#楼 / 未标注） */
  area?: string
  records?: AssetLedgerRecordItem[]
  record_count?: number
  relations?: AssetLedgerRelationItem[]
}

/** GET /assets/asset-ledger 列表行 */
export interface AssetLedgerItem {
  device_code: string
  name: string
  device_name?: string
  source?: 'devices' | 'ledger_only' | string
  subsystem_id?: number | null
  subsystem_name?: string
  location?: string
  building?: string
  floor?: string
  area?: string
  use_dept?: string
  owner_unit?: string
  asset_name?: string
  asset_code?: string
  brand_model?: string
  serial_no?: string
  transfer_no?: string
  tag_no?: string
  contract_no?: string
  bim_tag?: string
  room_code?: string
  price_tax?: number | null
  recv_date?: string | null
  warranty_end?: string | null
  warranty_state?: string | null
  is_active?: boolean
  has_asset?: boolean
  record_count?: number
  relation_count?: number
  [key: string]: unknown
}

/** GET /assets/asset-ledger 分页响应 */
export interface AssetLedgerListResult {
  total: number
  page: number
  page_size: number
  pages: number
  items: AssetLedgerItem[]
  facets?: {
    areas?: string[]
    use_depts?: string[]
    subsystems?: Array<{ id: number; name: string }>
  }
}

// ===== 机身编码统一解析（GET /assets/asset-ledger/resolve）=====
// 后端权威匹配内核 asset_code_match.resolve_code 的返回体（§3.2 + R1/R2/R3）。
// 字段以代码为准；序列号（serial_no_exact）≠ 机身编号，前端必须分标签展示。

/** 命中类型 → 可信度（后端 MATCH_PRIORITY：100/98/96/92/70/60/40） */
export type AssetMatchType =
  | 'device_code_exact'
  | 'alias_exact'
  | 'observation_exact'
  | 'brand_extract_exact'
  | 'serial_no_exact'
  | 'brand_substring'
  | 'field_substring'

/** 顶层 kind（由最高可信度命中决定；ambiguous = R2 共用值歧义） */
export type AssetResolveKind =
  | 'device_code'
  | 'alias'
  | 'serial'
  | 'serial_no'
  | 'fuzzy'
  | 'none'
  | 'ambiguous'

/** resolve 候选（后端 _hit 结构） */
export interface AssetResolveCandidate {
  device_code: string
  name: string
  asset_name: string
  /** 位置（台账 location） */
  location: string
  /** 确定性区域判定（停车楼 / GTC / 市政 / 工作区 / N#楼 / 未标注） */
  area: string
  /** devices / ledger_only / alias */
  source: string
  match_type: AssetMatchType | string
  match_field: string
  matched_value: string
  /** 封顶后的可信度（R1 可能把 ledger_only 的精确命中封顶到 88） */
  confidence: number
  /** 该行是否带「序列号」(serial_no) 字段 */
  has_serial: boolean
  /** 是否已登记进 devices */
  in_devices: boolean
  /** R1：是否被降过权（未登记行精确命中封顶 88） */
  source_demoted: boolean
}

export interface AssetResolveNormalized {
  raw: string
  upper: string
  loose: string
}

export interface AssetResolveHint {
  /** 是否允许补录（歧义态为 false）；补录接口属批次③，本批只读 */
  can_observe: boolean
  reason: string
}

/** GET /assets/asset-ledger/resolve 响应（§3.2） */
export interface AssetResolveResult {
  query: string
  normalized: AssetResolveNormalized
  kind: AssetResolveKind | string
  exact: boolean
  count: number
  candidates: AssetResolveCandidate[]
  /** 仅 kind=ambiguous 时出现：该值被 N 台设备共用 */
  shared_count?: number
  hint?: AssetResolveHint
}

// ===== 机身编号现场补录（L2 观测层 · device_serial_observations）=====
// 批次③：现场输入的机身编号若不在台账 / 与台账不一致，可**补录**为观测记录。
// 只增不改台账；冲突时并存待复核。字段与后端 DDL 对齐。

/** 冲突状态：无 / 与台账不一致 / 已被其他设备观测 */
export type ObservationConflictState = 'none' | 'conflicts_ledger' | 'conflicts_other_device'

/** 补录响应中的冲突块 */
export interface ObservationConflict {
  type: string
  /** 台账 brand_model 中抽取的机身编号（conflicts_ledger 时有值） */
  ledger_brand_serial?: string
  message: string
}

/** 现场补录观测行（GET /assets/asset-ledger/observations） */
export interface DeviceSerialObservation {
  id: number
  device_code: string
  /** 现场输入的原始机身编号 */
  serial_raw: string
  /** 后端归一后的编号（去空白/统一大小写等） */
  serial_norm: string
  room_code: string | null
  operator: string
  /** 来源（miniprogram / web 等） */
  source: string
  client: string
  observed_at: string | null
  created_at: string | null
  /** active（有效）/ rejected（已撤销，软删） */
  status: string
  conflict_state: ObservationConflictState | string
  /** 冲突时：台账 brand_model 中的机身编号（台账未被修改） */
  ledger_brand_serial: string | null
  evidence_photo_id: number | null
  note: string
}

/** POST /assets/asset-ledger/observations 入参 */
export interface CreateObservationPayload {
  /** 必填：所属设备编号 */
  device_code: string
  /** 必填：现场观测到的原始机身编号 */
  serial_raw: string
  room_code?: string | null
  operator?: string
  /** ISO 串；留空由后端取当前时间 */
  observed_at?: string | null
  note?: string
  evidence_photo_id?: number | null
}

/** POST /assets/asset-ledger/observations 响应 */
export interface CreateObservationResult {
  success: boolean
  /** true = 此前已补录过，未重复新增（幂等，不是失败） */
  already: boolean
  id: number
  conflict_state: ObservationConflictState | string
  conflict?: ObservationConflict | null
}

/** DELETE /assets/asset-ledger/observations/{id} 响应 */
export interface DeleteObservationResult {
  success: boolean
  id?: number
  status?: string
  message?: string
}

// ===== 设备现场定位观测（批次⑤ · 扫码即记坐标）=====

/**
 * GET /assets/asset-ledger/geo-observations 行。
 *
 * 每次扫码记一条（不做覆盖）：同一设备多条 = 多次现场定位历史，
 * 可用来判断设备是否被移动过、交叉验证定位漂移。
 */
export interface DeviceGeoObservation {
  id: number
  device_code: string
  latitude: number
  longitude: number
  /** 水平精度半径（米）—— 室内定位漂移大，判断坐标可信度的关键 */
  accuracy?: number | null
  altitude?: number | null
  coord_type?: string
  room_code?: string | null
  /** camera / album / manual */
  scan_source?: string
  operator?: string
  source?: string
  client?: string
  observed_at?: string | null
  created_at?: string | null
}

// ===== 区域树（GET /assets/trees/area）=====
// 后端懒加载五层：楼栋(b:) → 楼层(f:) → 房间类型组(g:) → 机房(r:) → 设备(d:)。
// group_by_type=false 时退回四级（去掉房间类型组）。
// ⚠️ key 前缀就是节点层级的唯一判据，展开子级时必须把父节点 key **原样**回传，
//    不要在前端自己拼 key —— 楼层/类型组里含中文与冒号，拼错后端直接匹配不到。

export type AssetAreaNodeType = 'building' | 'floor' | 'room_type' | 'room' | 'device'

export interface AssetAreaNodeMeta {
  building?: string
  floor?: string
  room_code?: string
  room_name?: string
  room_type?: string
  device_code?: string
  name?: string | null
  subsystem_code?: string | null
  subsystem_name?: string | null
  /** 该节点（含子级）的资料记录数 */
  record_count?: number
  room_count?: number
  floor_count?: number
  area?: string
  /** 固定资产 fuzzy 归属的待核实台数（不计入 count，仅作提示） */
  asset_pending?: number
  /** 该机房自身的记录（机房台账的 device_code 即房间号本身） */
  self_record?: string | null
  status?: boolean
}

export interface AssetAreaNode {
  /** 形如 b:GTC / f:GTC:一楼 / g:GTC:一楼:设备机房 / r:GE1F-KTJF-101 / d:<编号> */
  key: string
  type: AssetAreaNodeType
  label: string
  /** **真实归属**设备数（device_relations 边 + 台账房间字段 + 非 fuzzy 的 room_id）；device 节点恒为 0 */
  count: number
  has_children: boolean
  meta?: AssetAreaNodeMeta
}

/** GET /assets/areas/stats —— 区域概览（设备管理页头部统计） */
export interface AssetAreaStats {
  summary: {
    building_count: number
    floor_count: number
    room_count: number
    /** 有设备归属的机房数 */
    rooms_with_devices: number
    rooms_with_self_record?: number
    devices_mapped: number
    /** 台账设备总数（与资产管理器的 total 同口径） */
    devices_total: number
    asset_pending?: number
  }
  buildings: Array<{
    building: string
    area: string
    room_count: number
    device_count: number
    rooms_with_devices: number
    floors: Array<{
      floor: string
      room_count: number
      device_count: number
      rooms_with_devices: number
    }>
  }>
}

/** POST /assets/asset-ledger/geo-observations 请求体 */
export interface GeoObservationPayload {
  device_code: string
  latitude: number
  longitude: number
  accuracy?: number | null
  altitude?: number | null
  coord_type?: string
  room_code?: string
  scan_source?: string
  operator?: string
  source?: string
  observed_at?: string
}


/** GET /assets/subsystems —— 子系统下拉（现场新建设备用） */
export interface AssetSubsystem {
  id: number
  code: string
  name: string
  icon?: string
  sort_order?: number
  is_active?: boolean
}

/** POST /assets/devices —— 现场新建设备（0 命中时建档） */
export interface CreateDevicePayload {
  device_code: string
  name: string
  subsystem_id?: number | null
  building?: string
  floor?: string
  location_desc?: string
  parent_device_id?: number | null
}

/** POST /assets/devices 成功响应（精简，页面只取必要字段） */
export interface CreatedDevice {
  id: number
  device_code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string | null
}

/** GET /assets/tables —— 数据表清单（批量打印「从数据表导入」源） */
export interface AssetDataTable {
  id: number
  code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string
  description?: string
  sort_order?: number
  is_active?: boolean
  field_count?: number
  record_count?: number
  /** 关系键标签（如「固定资产编号」），仅展示用 */
  relation_key_label?: string
}

/** GET /assets/tables/{tid}/records —— 数据表记录（精简，只取打印所需字段） */
export interface AssetTableRecord {
  id: number
  table_id: number
  /** 固定资产编号（打印二维码与第一行都基于此） */
  device_code: string
  data: Record<string, unknown>
  /** 顶层短名称（列表展示用，标签上不打印中文） */
  device_name?: string
  table_name?: string
  created_by?: string
  created_at?: string
  updated_at?: string
}
