// 分系统资料管理 · 核心类型（子系统/设备/资料表/字段/记录）—— 自 asset.ts 拆分，字段未改
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
  /** 跨表检索钥匙：该字段取值可到其他表做关联检索（与 is_relation_key 解耦） */
  is_search_key?: boolean
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
  /** 跨表检索钥匙：该字段取值可到其他表做关联检索 */
  is_search_key?: boolean
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

