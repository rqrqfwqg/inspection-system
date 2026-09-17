import type { LinkRelationsBySource } from './viz-link'

// 关联自动化 + 人工关联 类型 —— 自 assetViz.ts 拆分，字段未改

// ==================== 关联自动化（GET/POST /assets/link/auto-*） ====================

/** 一条自动关联规则的说明与规模 */
export interface AutoRule {
  id: string
  name: string
  /** 落库的关系类型（受控 label） */
  relation_type: string
  kind: string
  /** 规则的判定依据（可解释，用于界面展示与复核） */
  basis: string
  /** 边两端所在域：records=资料域编号（非台账设备） */
  domain: string
  /** 规则命中的全部候选数（已剔自环） */
  candidates: number
  /** 其中尚未建边的数量 */
  pending: number
  /** 已存在同向边、自动跳过的数量 */
  already_linked: number
}

/** GET /assets/link/auto-rules */
export interface AutoRulesResponse {
  rules: AutoRule[]
  total_candidates: number
  total_pending: number
  already_linked: number
  /** 两端同号、无意义而被剔除的候选数（如某编号同时存在于电柜表与配电箱表） */
  skipped_self_loop: number
  skipped_sample: { from_code: string; to_code: string; rule: string; reason: string }[]
  existing_relations: LinkRelationsBySource
  note: string
}

/** POST /assets/link/auto-associate（dry_run=true 时的返回） */
export interface AutoAssociatePreview {
  dry_run: true
  would_create: number
  pending_total: number
  already_linked: number
  skipped_self_loop: number
  sample: {
    rule: string
    relation_type: string
    from_code: string
    to_code: string
    confidence: number
    evidence: string
  }[]
}

/** POST /assets/link/auto-associate（实际执行后的返回） */
export interface AutoAssociateResult {
  dry_run: false
  /** 本次写入的批次号，用于回滚 */
  batch: string
  created: number
  pending_left: number
  already_linked: number
  skipped_self_loop: number
  by_rule: Record<string, number>
  by_type: Record<string, number>
  rollback_hint: string
}

// ==================== 人工关联（GET/POST /assets/link/manual-*） ====================

/** 待人工关联队列中的候选建议 */
export interface ManualSuggestion {
  code: string
  name: string | null
  /** device=设备台账 / room=机房 */
  kind: 'device' | 'room' | string
  score: number
  reason: string
}

/** 待人工关联队列项 */
export interface ManualQueueItem {
  code: string
  /** 该编号在资料表中出现的记录数 */
  records: number
  tables: { table_id: number; name: string; code: string | null }[]
  /** 该编号所在记录的部分字段快照，帮助现场判断 */
  sample: Record<string, unknown> | null
  suggestions: ManualSuggestion[]
}

/** GET /assets/link/manual-queue */
export interface ManualQueueResponse {
  total_unresolved_codes: number
  returned: number
  items: ManualQueueItem[]
  hint: string
}

/** POST /assets/link/manual-associate 的返回 */
export interface ManualAssociateResult {
  success: boolean
  id: number
  from: { code: string; kind: string; name: string | null }
  to: { code: string; kind: string; name: string | null }
  relation_type: string
  source: 'manual'
}

