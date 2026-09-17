// 四棵懒加载树节点类型（区域/子系统/设备层级/BA）—— 自 assetViz.ts 拆分，字段未改

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
export type SubsystemNodeType =
  | 'subsystem'
  | 'category'
  | 'device'
  /** 供电系统分层（系统图 → 平面图 → 台账）：入口 / 层 / 变电所 / 分组 */
  | 'power_root'
  | 'power_layer'
  | 'power_substation'
  | 'power_group'
  /** 供电分层明细：变压器 / 低压配电屏 / 配电回路 / 配电箱 / 楼层 / 图纸图元 */
  | 'power_trafo'
  | 'power_panel'
  | 'power_circuit'
  | 'power_box'
  | 'power_floor'
  | 'power_item'
  /** 资料表节点 */
  | 'table_group'
  | 'table'
  | 'record'

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
    /** 供电分层：当前节点挂在哪个上级（变电所 / 回路 / 配电箱 / 楼层） */
    upstream?: string
    /** 供电分层：所属变电所编码（WP-B / SP-B / EP-B / G-B；空串表示未标注） */
    substation_code?: string
    /** 供电分层：层 key（L0..L5）与层名 */
    layer?: string
    layer_name?: string
    desc?: string
    /** 供电分层：所在楼层 / 配电箱编码 / 上游回路编号 */
    floor?: string
    box_code?: string
    upstream_circuits?: string
    /** 供电分层：回路的下游配电箱（最多 30 个）与总数 */
    downstream?: string[]
    n_downstream?: number
    /** 资料表节点 */
    table_id?: number
    table_code?: string
    record_id?: number
    [key: string]: unknown
  }
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
    group_label?: string
    group_criterion?: string
    device_name?: string
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

