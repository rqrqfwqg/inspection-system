// 导入批次/模板/结果 + 设备现场定位观测 类型 —— 自 assetViz.ts 拆分，字段未改

// ==================== 导入 ====================

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

/** 支持导入的模板类型（GET /import/templates） */
export interface ImportTemplate {
  key: string
  desc: string
}

// ==================== 设备现场定位观测（GET /asset-ledger/geo-observations） ====================

/**
 * 一条「扫码现场定位」观测（批次⑤）。
 *
 * 纪律：**只写观测表，绝不改 devices / fixed_assets 的位置字段**；每次扫码一条，不合并。
 * 坐标系 `coord_type` 固定 `gcj02`（微信 `wx.getLocation({type:'gcj02'})`），可直接投高德/腾讯地图。
 * 【注意】 时间字段（`observed_at` / `created_at`）后端落库的是 **UTC**，展示必须 +8 转北京时间。
 * 【注意】 `accuracy` 是「是否精确定位」的硬判据：`wx.getLocation` 必返回它，模糊定位不返回；
 *    缺失**不能补 0**（±0m 会被误读成「极其精准」）。
 */
export interface GeoObservation {
  id?: number
  device_code?: string
  latitude?: number | string | null
  longitude?: number | string | null
  /** 定位精度（米）；为空表示该条不是精确定位，不可当成 0 */
  accuracy?: number | string | null
  altitude?: number | string | null
  coord_type?: string | null
  room_code?: string | null
  scan_source?: string | null
  operator?: string | null
  source?: string | null
  client?: string | null
  /** UTC */
  observed_at?: string | null
  /** UTC（且可能是进程启动时刻的冻结值，排序别依赖它） */
  created_at?: string | null
  [key: string]: unknown
}

/** 单次上传导入结果（POST /import） */
export interface ImportResult {
  filename?: string
  template?: string
  rows?: number
  accessory_rows?: number
  dry_run?: boolean
  batches?: Array<{ segment: string; rows: number; accessories?: number }>
  warnings?: string[]
  errors?: string[]
}

