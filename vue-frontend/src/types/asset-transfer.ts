// 记录跨表转移（字段映射）类型 —— 自 asset.ts 拆分，字段未改

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

