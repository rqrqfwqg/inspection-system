// T3GTC 资产可视化系统 —— 类型定义
//
// ⚠️ 契约纪律（2026-09-15 修正）
// ------------------------------------------------------------------
// 本文件曾自带一份 `/search` 的 SearchResult 复制品，且停留在**旧版契约**
// （`device` / `relations`），而后端早已换成
// `target` / `nodes` / `edges` / `groups` / `profile` / `power_chain`。
// 结果：设备详情抽屉里「基础信息」「关联设备」读到的永远是 undefined，
// 整页看起来「像死数据」——同一份后端数据在「资料检索」页却显示得满满当当。
//
// 现在**统一从 `@/types/asset` 复用权威契约**，本文件只保留可视化独有的类型，
// 从根上消灭重复定义带来的漂移。

// ==================== 复用权威契约（唯一真源） ====================
export type {
  Subsystem,
  SearchResult,
  SearchNode,
  SearchEdge,
  SearchGroup,
  SearchTableGroup,
  DeviceProfile,
  PowerChain,
  PowerChainNode,
  PowerChainEdge,
  RecordItem,
  DataTable,
  FieldDef,
  Device,
  DeviceRelation,
} from '@/types/asset'

// ==================== 联动画像（后端 /assets/link/*） ====================

/** 单张资料表的联动统计（GET /assets/link/overview → tables[]） */
export interface LinkTableStat {
  table_id: number
  code: string
  name: string
  subsystem_id: number
  subsystem_code: string | null
  subsystem_name: string
  /** 关联键字段的中文名（is_relation_key）；为空说明该表没定义关联键 */
  relation_key_label: string | null
  field_count: number
  /** 记录总行数 */
  records: number
  /** 关联键为空的行数 */
  empty_code: number
  /** 关联键命中 devices.device_code 的行数（记录数口径） */
  resolved_devices: number
  /** 关联键命中 rooms.code 的行数 */
  resolved_rooms: number
  /** 既非设备也非机房的编号——"未解析"。注意：图纸类资料的图元编号本就不对应设备，不算错误 */
  unresolved: number
  /** (resolved_devices + resolved_rooms) / records，0..1 */
  coverage: number
  /** 命中的**去重设备数**（与 resolved_devices 的"记录数"口径不同） */
  distinct_devices: number
}

/** 子系统维度的联动统计 */
export interface LinkSubsystemStat {
  id: number
  code: string
  name: string
  icon: string
  table_count: number
  records: number
  /** 该子系统下 devices 登记数 */
  devices: number
  resolved: number
  unresolved: number
  coverage: number
}

/** 关系类型分布 */
export interface LinkRelationStat {
  type: string
  /** power / cooling / locate / control / signal / pipe / network / other */
  kind: string
  count: number
}

/** 未解析关联键条目 */
export interface LinkUnresolvedItem {
  code: string
  records: number
  tables: string[]
}

/** 关联来源分布（GET /assets/link/overview → relations_by_source） */
export interface LinkRelationsBySource {
  total: number
  /** 规则引擎自动建立 */
  auto: number
  /** 人工建立（含历史导入；无 meta 标记的历史边按人工归类） */
  manual: number
  /** 其中没有任何 meta 标记的历史边数（审计用） */
  unmarked_legacy: number
  auto_by_type: Record<string, number>
  auto_by_rule: Record<string, number>
}

/** GET /assets/link/overview —— 全局联动画像 */
export interface LinkOverview {
  global: {
    devices: number
    rooms: number
    tables: number
    /** 字段定义总数（资料配置的真实规模） */
    fields: number
    records: number
    relations: number
    relations_auto: number
    relations_manual: number
    relations_unmarked: number
    resolved_devices: number
    resolved_rooms: number
    unresolved: number
    coverage: number
    device_codes_in_records: number
    unresolved_codes: number
    resolvable_device_codes: number
    resolvable_room_codes: number
  }
  subsystems: LinkSubsystemStat[]
  tables: LinkTableStat[]
  relations: LinkRelationStat[]
  relations_by_source: LinkRelationsBySource
  unresolved_top: LinkUnresolvedItem[]
}

/** 字段的真实使用情况（填充率） */
export interface LinkFieldStat {
  id: number
  key: string
  label: string
  type: string
  is_required: boolean
  is_relation_key: boolean
  filled: number
  fill_rate: number
}

/** GET /assets/link/table/{tid} —— 单表联动画像 */
export interface LinkTableDetail {
  table: {
    table_id: number
    code: string
    name: string
    subsystem_id: number
    subsystem_code: string | null
    subsystem_name: string
  }
  coverage: {
    records: number
    empty_code: number
    resolved_devices: number
    resolved_rooms: number
    unresolved: number
    coverage: number
    distinct_devices: number
    unresolved_codes: number
  }
  /** 本表编号参与的关联边（自动 / 人工分列） */
  relations: {
    auto: number
    manual: number
    total: number
    /** 本表出现过的去重编号数 */
    distinct_codes: number
  }
  fields: LinkFieldStat[]
  unresolved_top: { code: string; records: number }[]
  field_count: number
}

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

// ==================== 单设备联动总览（GET /assets/link/device/{code}） ====================

/** 一条关联边（含来源标注：自动 / 人工） */
export interface DeviceLinkEdge {
  id: number
  from_code: string
  to_code: string
  /** 对端编号 */
  other_code: string
  /** 对端在台账/机房/资料域中的归属 */
  other_kind: 'device' | 'room' | 'record' | 'unknown' | string
  other_name: string | null
  relation_type: string
  /** power / cooling / locate / control / signal / pipe / network / other */
  kind: string
  direction: 'in' | 'out'
  /** auto=规则引擎自动建立 / manual=人工建立 */
  source: 'auto' | 'manual'
  source_label: string
  /** 仅自动边：命中的规则 id */
  rule: string | null
  confidence: number | null
  /** 仅自动边：判定证据（可解释） */
  evidence: string | null
  domain: string | null
  batch: string | null
}

/** 单设备（或机房）的联动总览 */
export interface DeviceLinkResponse {
  code: string
  kind: 'device' | 'room'
  name: string | null
  subsystem: { id: number; code: string; name: string; icon?: string } | null
  building: string | null
  floor: string | null
  record_count: number
  table_count: number
  /** 资料记录，按资料表分组（与「数据表管理」同源） */
  groups: {
    table_id: number
    table_code: string | null
    table_name: string
    subsystem: { id: number; code: string; name: string; icon?: string } | null
    records: { id: number; table_id: number; device_code: string; data: Record<string, unknown> }[]
  }[]
  edges: DeviceLinkEdge[]
  edges_auto: DeviceLinkEdge[]
  edges_manual: DeviceLinkEdge[]
  edge_summary: {
    total: number
    auto: number
    manual: number
    by_type: Record<string, number>
  }
}

// ==================== 区域树（GET /trees/area） ====================

/** 区域树节点类型。层级：building → floor → room_type（同类型房间分组）→ room → device；
 * group_by_type=false 时不返回 room_type 层。 */
export type AreaNodeType = 'building' | 'floor' | 'room_type' | 'room' | 'device'

export interface AreaNode {
  key: string
  type: AreaNodeType
  label: string
  /** 真实归属设备数 */
  count?: number
  has_children?: boolean
  meta?: {
    building?: string
    floor?: string
    floor_count?: number
    room_count?: number
    room_code?: string
    room_name?: string
    /** 房间类型（room_type 组节点的分组键；room 节点亦带） */
    room_type?: string
    /** 该范围（楼栋/楼层/类型组/机房/设备）挂着的**资料记录数**（2026-09-15 新增，与数据表管理联动） */
    record_count?: number
    /** 该机房的「本体台账」记录编号（机房信息汇总表，device_code 即房间号） */
    self_record?: string | null
    /** 固定资产模糊归属、房间粒度不可信的数量（提示待核实） */
    asset_pending?: number
    area?: number
    device_code?: string
    name?: string | null
    subsystem_code?: string | null
    subsystem_name?: string | null
    [key: string]: unknown
  }
  [key: string]: unknown
}

// ==================== 子系统树（GET /trees/subsystem） ====================

/** 子系统树节点。meta.record_count/table_count 为 2026-09-15 新增，让树直接反映资料表数据 */
export type SubsystemNodeType = 'subsystem' | 'category' | 'device'

export interface SubsystemNode {
  key: string
  type: SubsystemNodeType
  label: string
  /** 设备数（记录数见 meta.record_count） */
  count?: number
  has_children?: boolean
  meta?: {
    subsystem_code?: string
    icon?: string
    category_code?: string | null
    device_code?: string
    status?: boolean
    /** 该子系统/分类/设备挂着的资料记录数 */
    record_count?: number
    /** 仅 subsystem 节点：该子系统下的资料表数量 */
    table_count?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

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

// ==================== 设备层级树（GET /trees/device） ====================

/** type: device（主设备/子设备） | accessory（配件，叶节点）
 * meta.is_group=true 表示「按子系统分组」的入口节点。 */
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

// ==================== BA 系统树（GET /trees/ba） ====================

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
