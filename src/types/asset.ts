// 分系统资料管理 · 前端类型定义
// 与后端 asset_schemas.py 一一对应

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'device_ref'

// ==================== 子系统 ====================
export interface Subsystem {
  id: number
  code: string
  name: string
  icon: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface SubsystemPayload {
  code: string
  name: string
  icon?: string
  sort_order?: number
  is_active?: boolean
}
export type SubsystemUpdatePayload = Partial<SubsystemPayload>

// ==================== 设备台账 ====================
export interface Device {
  id: number
  device_code: string
  name: string
  subsystem_id: number | null
  room_id: number | null
  building: string
  floor: string
  location_desc: string
  parent_device_id: number | null
  is_active: boolean
  created_at: string
  updated_at: string
  subsystem_name?: string | null
}

export interface DevicePayload {
  device_code: string
  name: string
  subsystem_id?: number | null
  room_id?: number | null
  building?: string
  floor?: string
  location_desc?: string
  parent_device_id?: number | null
}
export type DeviceUpdatePayload = Partial<DevicePayload>

// ==================== 资料表 ====================
export interface DataTable {
  id: number
  subsystem_id: number
  code: string
  name: string
  description: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  subsystem_name?: string | null
  field_count?: number
  record_count?: number
  relation_key_label?: string | null
}

export interface DataTablePayload {
  subsystem_id: number
  code: string
  name: string
  description?: string
  sort_order?: number
  is_active?: boolean
}
export type DataTableUpdatePayload = Partial<DataTablePayload>

// ==================== 字段定义 ====================
export interface FieldDef {
  id: number
  table_id: number
  key: string
  label: string
  type: FieldType
  options: string[]
  is_required: boolean
  is_relation_key: boolean
  sort_order: number
}

export interface FieldPayload {
  table_id: number
  key: string
  label: string
  type?: FieldType
  options?: string[]
  is_required?: boolean
  is_relation_key?: boolean
  sort_order?: number
}
export type FieldUpdatePayload = Partial<FieldPayload>

// ==================== 资料记录 ====================
export interface RecordItem {
  id: number
  table_id: number
  device_code: string
  data: Record<string, any>
  created_by: string
  created_at: string
  updated_at: string
  device_name?: string | null
  table_name?: string | null
}

export interface RecordPayload {
  table_id?: number
  device_code?: string | null
  data: Record<string, any>
}
export interface RecordUpdatePayload {
  device_code?: string | null
  data?: Record<string, any>
}

export interface BulkRecordItem {
  device_code?: string | null
  data: Record<string, any>
}

// ==================== 记录跨表转移（字段映射） ====================
export type MappingConfidence =
  | 'exact_key'
  | 'exact_label'
  | 'normalized'
  | 'relation_key'
  | 'contains'
  | 'type_only'
  | 'none'

export interface TransferMappingItem {
  source_key: string
  source_label: string
  source_type?: string | null
  target_key: string | null
  target_label?: string | null
  confidence: MappingConfidence
  score: number
  reason: string
}

export interface TransferMapping {
  source_table: { id: number; name: string; code?: string | null; subsystem_id?: number | null }
  target_table: { id: number; name: string; code?: string | null; subsystem_id?: number | null }
  matches: TransferMappingItem[]
  unmapped_sources: { key: string; label: string; type?: string | null; required?: boolean }[]
  unfilled_targets: { key: string; label: string; type?: string | null; required?: boolean }[]
  remark_candidates: { key: string; label: string }[]
}

export interface TransferPayload {
  target_table_id: number
  record_ids: number[]
  mapping: Record<string, string | null>
  unmapped_policy: 'drop' | 'remark' | 'extra'
  remark_target_key?: string | null
  mode: 'move' | 'copy'
  on_conflict: 'skip' | 'update' | 'duplicate'
  dry_run?: boolean
}

export interface TransferResult {
  success: boolean
  dry_run: boolean
  total: number
  created: number
  updated: number
  moved: number
  skipped: number
  conflicts: number
  skipped_details: { record_id: number; device_code: string; reason: string }[]
  source_table_id: number
  target_table_id: number
}

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
  target: Device | null
  found: boolean
  nodes: SearchNode[]
  edges: SearchEdge[]
  groups: SearchGroup[]
  total_records: number
  profile?: DeviceProfile | null
  power_chain?: PowerChain | null
}

export interface BulkResult {
  success: boolean
  created: number
  skipped: number
}

// ==================== 资产总台账（设备台账升级） ====================

/** 总台账单行：devices ∪ 台账 records ∪ 固定资产 的全集合 */
export interface AssetLedgerRow {
  device_code: string
  name: string
  device_name?: string
  /** devices=已登记；ledger_only=只在台账、未登记进设备主表 */
  source: 'devices' | 'ledger_only'
  subsystem_id: number | null
  subsystem_name: string
  location: string
  building: string
  floor: string
  area: string
  use_dept: string
  owner_unit: string
  asset_name: string
  asset_code: string
  brand_model: string
  serial_no: string
  transfer_no: string
  tag_no: string
  contract_no: string
  bim_tag: string
  room_code: string
  price_tax: number | null
  price_notax: number | null
  tax: number | null
  recv_date: string | null
  warranty_end: string | null
  warranty_state: 'ok' | 'soon' | 'expired' | null
  is_active: boolean
  has_asset: boolean
  record_count: number
  record_tables: string[]
  relation_count: number
}

export interface AssetLedgerFacets {
  areas: string[]
  use_depts: string[]
  subsystems: { id: number; name: string }[]
}

export interface AssetLedgerListResult {
  total: number
  page: number
  page_size: number
  pages: number
  items: AssetLedgerRow[]
  facets: AssetLedgerFacets
}

/** 台账筛选/排序参数 */
export interface AssetLedgerQuery {
  q?: string
  subsystem_id?: number
  area?: string
  use_dept?: string
  /** with_asset / without_asset / ledger_only / has_records / warranty_soon / warranty_expired / bim / no_location */
  state?: string
  source?: 'devices' | 'ledger_only'
  include_inactive?: boolean
  sort?: string
  order?: 'asc' | 'desc'
  page?: number
  page_size?: number
}

export interface AssetLedgerBucket {
  name: string
  count: number
  amount: number
  with_asset: number
}

export interface AssetLedgerSummary {
  total: number
  registered: number
  ledger_only: number
  with_asset: number
  without_asset: number
  with_records: number
  with_bim: number
  no_location: number
  amount_total: number
  amount_avg: number
  warranty_soon: number
  warranty_expired: number
  warranty_soon_days: number
  by_area: AssetLedgerBucket[]
  by_subsystem: AssetLedgerBucket[]
  by_use_dept: AssetLedgerBucket[]
}

export interface AssetLedgerRecordItem {
  record_id: number
  table_id: number
  table_code: string | null
  table_name: string | null
  subsystem_name: string | null
  data: Record<string, unknown>
}

export interface AssetLedgerRelationItem {
  relation_id: number
  direction: 'in' | 'out'
  from_code: string
  to_code: string
  other_code: string
  relation_type: string
  relation_type_code?: string | null
  kind?: string | null
  meta: Record<string, unknown>
}

export interface AssetLedgerDetail {
  found: boolean
  code: string
  source?: string
  device: (Device & { transfer_no?: string; asset_code?: string; bim_tag?: string }) | null
  fixed_asset: Record<string, unknown> | null
  archive: Record<string, unknown> | null
  profile: DeviceProfile | Record<string, unknown>
  area?: string
  records: AssetLedgerRecordItem[]
  record_count: number
  relations: AssetLedgerRelationItem[]
}
