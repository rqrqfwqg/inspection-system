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

export interface SearchResult {
  target: Device | null
  found: boolean
  nodes: SearchNode[]
  edges: SearchEdge[]
  groups: SearchGroup[]
  total_records: number
}

export interface BulkResult {
  success: boolean
  created: number
  skipped: number
}
