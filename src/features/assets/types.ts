// T3GTC 资产可视化系统 —— 前端 P0 类型定义
// 所有类型严格对齐已冻结的后端 API 契约（/ops/api/assets/...）。

/** 子系统概览节点（GET /subsystems） */
export interface Subsystem {
  id: number
  code: string
  name: string
  icon?: string
  [key: string]: unknown
}

/** 区域树节点（GET /trees/area） */
export type AreaNodeType = 'building' | 'floor' | 'room' | 'device'
export interface AreaNode {
  key: string
  type: AreaNodeType
  label: string
  count?: number
  has_children?: boolean
  meta?: {
    building?: string
    floor_count?: number
    area?: number
    device_code?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** 子系统树节点（GET /trees/subsystem） */
export type SubsystemNodeType = 'subsystem' | 'category' | 'device'
export interface SubsystemNode {
  key: string
  type: SubsystemNodeType
  label: string
  count?: number
  has_children?: boolean
  meta?: {
    subsystem_code?: string
    icon?: string
    device_code?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** 设备检索聚合结果（GET /search） */
export interface SearchResult {
  found: boolean
  device?: Record<string, unknown>
  fixed_asset?: Record<string, unknown> | null
  archive?: Record<string, unknown> | null
  accessories?: Array<Record<string, unknown>>
  problems?: Array<Record<string, unknown>>
  aliases?: Array<Record<string, unknown>>
  relations?: Array<Record<string, unknown>>
  room?: Record<string, unknown> | null
}

/** BA 问题条目 */
export interface BaProblem {
  id: number
  ba_device_no?: string
  device_code?: string
  ba_system?: string
  ba_system_code?: string
  problem_type?: string
  group_area?: string
  location?: string
  status?: string
  [key: string]: unknown
}

/** BA 问题列表响应（GET /ba/problems） */
export interface BaProblemsResponse {
  items: BaProblem[]
  total: number
  summary: {
    total: number
    open: number
    processing: number
    closed: number
    unclosed: number
    [key: string]: unknown
  }
}

/** BA 概览项（GET /ba/overview） */
export interface BaOverviewItem {
  ba_system: string
  ba_system_code: string
  subsystem_code: string
  total: number
  normal: number
  problem: number
  problem_rate: number
  [key: string]: unknown
}

/** 子系统 × 区域 交叉统计行（GET /stats/by-subsystem-area） */
export interface StatRow {
  subsystem: string
  area: string
  count: number
  amount: number
  [key: string]: unknown
}

/** 设备关联边（GET /relations） */
export interface RelationEdge {
  id: number
  from_code: string
  to_code: string
  relation_type?: string
  subsystem_id?: number
  meta?: Record<string, unknown>
  [key: string]: unknown
}

/** 设备下拉补全项（GET /devices） */
export interface DeviceLite {
  device_code: string
  name?: string
  subsystem?: string
  [key: string]: unknown
}

/** 设备层级树节点（GET /trees/device）
 * type: device（主设备/子设备） | accessory（配件，叶节点）
 * meta.is_group=true 表示「按子系统分组」的入口节点（点击展开该子系统主设备列表）。 */
export type DeviceHierarchyNodeType = 'device' | 'accessory'
export interface DeviceHierarchyNode {
  key: string
  type: DeviceHierarchyNodeType
  label: string
  count?: number
  has_children?: boolean
  meta?: {
    is_group?: boolean
    subsystem_code?: string
    device_code?: string
    accessory_id?: number
    relation_type?: string
    is_root?: boolean
    root_criterion?: string
    has_accessory?: boolean
    sub_device_count?: number
    name?: string
    brand?: string
    spec?: string
    qty?: number
    unit?: string
    status_name?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** BA 系统树节点（GET /trees/ba）
 * type: ba_system（BA 系统入口） | ba_device（该系统下设备，点击打开详情抽屉） */
export type BaSystemNodeType = 'ba_system' | 'ba_device'
export interface BaSystemNode {
  key: string
  type: BaSystemNodeType
  label: string
  count?: number
  has_children?: boolean
  meta?: {
    ba_system_code?: string
    subsystem_code?: string
    device_code?: string
    device_count?: number
    problem_count?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** 导入批次（GET /import-batches） */
export interface ImportBatch {
  id?: number
  batch_name?: string
  source_type?: string
  file_count?: number
  row_count?: number
  status?: string
  started_at?: string
  finished_at?: string
  [key: string]: unknown
}
