// 联动画像 / 跨表引用 / 全局搜索 / 单表画像 类型 —— 自 assetViz.ts 拆分，字段未改

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
  is_search_key?: boolean
  filled: number
  fill_rate: number
}

/** GET /assets/link/table/{tid} —— 单表联动画像 */
/** GET /assets/link/crossrefs —— 跨表字段关联（拿一条记录的编号到其他表搜索） */
export interface CrossRefKey {
  key: string
  label: string
  value: string
}

export interface CrossRefMatch {
  field: string
  label: string
  count: number
  /** 该字段命中的具体编号样例（最多 5 个） */
  values: string[]
}

export interface CrossRefTarget {
  table_id: number
  code: string
  name: string
  subsystem_id?: number | null
  total: number
  matches: CrossRefMatch[]
}

export interface CrossRefResponse {
  record: {
    id: number
    device_code?: string | null
    table_id: number
    table_name: string
    table_code: string
  }
  keys: CrossRefKey[]
  targets: CrossRefTarget[]
  scanned: number
}

/** GET /assets/link/global-search —— 全局资料表内容搜索（对每一张启用表都搜一遍任意关键词） */
export interface GlobalSearchHit {
  id: number
  device_code?: string | null
  /** 命中关键词的字段（最多前几个）：字段标签 + 截断后的值 */
  fields: { label: string; value: string }[]
}

export interface GlobalSearchTable {
  table_id: number
  code: string
  name: string
  subsystem_id?: number | null
  subsystem_name?: string
  hit_count: number
  samples: GlobalSearchHit[]
}

export interface GlobalSearchResponse {
  query: string
  tables_hit: number
  total_hits: number
  results: GlobalSearchTable[]
}

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

