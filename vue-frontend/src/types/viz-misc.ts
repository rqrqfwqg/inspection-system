// BA 问题/概览、交叉统计、关联边、设备补全 类型 —— 自 assetViz.ts 拆分，字段未改

// ==================== 检索 / BA / 关系 ====================

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

