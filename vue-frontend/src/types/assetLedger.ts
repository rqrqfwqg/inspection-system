/**
 * 资产总台账（/asset/devices）域模型
 * =====================================================================
 * 为什么「类型 + 子域常量 + 展示口径」放在同一文件：
 *   本页 4 个组件共用同一套口径（金额两位小数、日期 YYYY-MM-DD、空值一律「—」）。
 *   若把格式化复制进各组件，汇总卡与表格会出现「同一金额两个值」的静默不一致
 *   （生成式代码失效模式 #2：沉默逻辑错误）。此处是这 7 个文件的唯一共享落点。
 *
 * 契约（SPEC §5.1 / §6）：台账口径 = devices ∪ 台账 records ∪ 固定资产，
 *   **由后端 /assets/asset-ledger 系列接口统一给出**，前端不得自行拼口径。
 */

/** 行来源：devices=已登记进设备主表；ledger_only=只在现场台账、未登记 */
export type LedgerRowSource = 'devices' | 'ledger_only'

/** 盘点状态（设备台账 redesign：合并层 _load_all 派生字段，永不为 NULL） */
export type InventoryStatus = 'confirmed' | 'unconfirmed'

/** 基础数据页「来源」列派生种类（SPEC §5.2 下钻二） */
export type SourceKind = 'devices' | 'ledger_only' | 'elec_dwg' | 'records' | 'fixed_assets'

/** DeviceLedgerTable 可注入的盘点相关列（由父页按 §4.2 / §5.2 选择） */
export type InventoryColumnKey = 'status' | 'room' | 'confirmed_at' | 'confirmed_by' | 'source'

/** 管理员逃生舱：覆盖写（PUT）成功响应（SPEC §6.2 / 架构 §11.4） */
export interface InventoryStatusOverrideResult {
  device_code: string
  status: InventoryStatus
  overridden_by: string
  overridden_at: string
  reason: string | null
  overridden: boolean
}

/** 管理员逃生舱：覆盖撤销（DELETE）响应 */
export interface InventoryStatusClearResult {
  device_code: string
  cleared: boolean
}

/** 盘点状态 Segmented 选项（服务器端，禁本地过滤） */
export const INVENTORY_STATUS_OPTIONS: { value: '' | InventoryStatus; label: string }[] = [
  { value: 'confirmed', label: '已盘点' },
  { value: 'unconfirmed', label: '未盘点' },
  { value: '', label: '全部' },
]

/** 总台账单行（与后端 asset_ledger_routes.list_asset_ledger 的 items 一一对应） */
export interface AssetLedgerRow {
  device_code: string
  name: string
  device_name?: string
  source: LedgerRowSource
  subsystem_id: number | null
  subsystem_name: string
  location: string
  building: string
  floor: string
  area: string
  use_dept: string
  owner_unit: string
  asset_name: string
  asset_code: string
  brand_model: string
  serial_no: string
  transfer_no: string
  tag_no: string
  contract_no: string
  bim_tag: string
  room_code: string
  price_tax: number | null
  price_notax: number | null
  tax: number | null
  recv_date: string | null
  warranty_end: string | null
  warranty_state: 'ok' | 'soon' | 'expired' | null
  is_active: boolean
  has_asset: boolean
  record_count: number
  record_tables: string[]
  relation_count: number
  /* ── 设备台账 redesign：盘点状态派生字段（资产合并层 _load_all 透出，SPEC §3）── */
  inventory_status?: InventoryStatus
  /** Concept-A 绑定房间（derived 行取 room_inventory_records 的房间；override 行同 derived 房间） */
  inventory_room_code?: string | null
  /** 最终状态来源：override=管理员覆盖（压过派生）；derived=房间盘点推导 */
  inventory_status_source?: 'override' | 'derived'
  /** 确认时间（derived→房间 completed_at；override→overrides.overridden_at） */
  inventory_confirmed_at?: string | null
  /** 确认人（derived→房间 operator；override→overrides.overridden_by） */
  inventory_confirmed_by?: string | null
  /** 仅 override 行非空，tooltip 展示（UI 设计 §10） */
  inventory_override_reason?: string | null
  /** 基础数据页「来源」列（UI 设计 §5.2）：devices / ledger_only / elec_dwg / records / fixed_assets */
  source_kind?: SourceKind
}

export interface AssetLedgerSubsystemOption {
  id: number
  name: string
}

/** 筛选项候选（后端基于「同关键词 + 同子系统」口径给出，避免选项被自己筛没） */
export interface AssetLedgerFacets {
  areas: string[]
  use_depts: string[]
  subsystems: AssetLedgerSubsystemOption[]
}

export interface AssetLedgerListResult {
  total: number
  page: number
  page_size: number
  pages: number
  items: AssetLedgerRow[]
  facets: AssetLedgerFacets
}

/** 后端 state 取值（见 asset_ledger_routes.list_asset_ledger） */
export type AssetLedgerState =
  | 'with_asset'
  | 'without_asset'
  | 'ledger_only'
  | 'has_records'
  | 'warranty_expired'
  | 'warranty_soon'
  | 'bim'
  | 'no_location'

/** 后端 sort 取值（金额/日期列的空值由后端恒排最后，前端只下发排序意图） */
export type AssetLedgerSortKey =
  | 'device_code'
  | 'name'
  | 'area'
  | 'use_dept'
  | 'subsystem'
  | 'price_tax'
  | 'warranty_end'
  | 'record_count'

export type AssetLedgerOrder = 'asc' | 'desc'

export interface AssetLedgerQuery {
  q?: string
  subsystem_id?: number
  area?: string
  use_dept?: string
  state?: AssetLedgerState
  source?: LedgerRowSource
  /** 设备台账 redesign：按盘点状态过滤（confirmed=已盘点 / unconfirmed=未盘点），不传=全量 */
  inventory_status?: InventoryStatus
  /** 基础数据页下钻：按来源表筛选（devices / ledger_only / elec_dwg / records / fixed_assets） */
  source_kind?: SourceKind
  include_inactive?: boolean
  sort?: AssetLedgerSortKey
  order?: AssetLedgerOrder
  page?: number
  page_size?: number
}

/** 汇总接口只接受这 4 个维度（+ 设备台账 redesign 新增 inventory_status） */
export interface AssetLedgerSummaryQuery {
  q?: string
  subsystem_id?: number
  area?: string
  use_dept?: string
  /** 设备台账 redesign：汇总按盘点状态子集计（confirmed=已盘点总数 / unconfirmed=未盘点总数） */
  inventory_status?: InventoryStatus
}

/** 页面级筛选模型（与 AssetLedgerQuery 的区别：这里是「未提交」的原始输入，空串表示不筛） */
export interface AssetLedgerFilters {
  q: string
  subsystem_id: number | null
  area: string
  use_dept: string
  state: AssetLedgerState | ''
  /** 设备台账 redesign：盘点状态筛选（''=全部 / confirmed=已盘点 / unconfirmed=未盘点） */
  inventory_status: '' | InventoryStatus
  /** 基础数据页下钻：按来源表筛选（''=不限） */
  source_kind: '' | SourceKind
}

export interface AssetLedgerBucket {
  name: string
  count: number
  amount: number
  with_asset: number
}

export interface AssetLedgerSummary {
  total: number
  registered: number
  ledger_only: number
  with_asset: number
  without_asset: number
  with_records: number
  with_bim: number
  no_location: number
  amount_total: number
  amount_avg: number
  warranty_soon: number
  warranty_expired: number
  warranty_soon_days: number
  by_area: AssetLedgerBucket[]
  by_subsystem: AssetLedgerBucket[]
  by_use_dept: AssetLedgerBucket[]
  /** 设备台账 redesign：基础数据页「来源表分布」下钻（按 source_kind 聚合，可选） */
  by_source?: AssetLedgerBucket[]
}

export interface AssetLedgerDeviceBrief {
  id: number
  device_code: string
  name: string
  subsystem_id: number | null
  subsystem_name: string | null
  building: string
  floor: string
  location_desc: string
  is_active: boolean
  transfer_no?: string
  asset_code?: string
  bim_tag?: string
}

export interface AssetLedgerRecordItem {
  record_id: number
  table_id: number
  table_code: string | null
  table_name: string | null
  subsystem_name: string | null
  data: Record<string, unknown>
}

export interface AssetLedgerRelationItem {
  relation_id: number
  direction: 'in' | 'out'
  from_code: string
  to_code: string
  other_code: string
  relation_type: string
  relation_type_code?: string | null
  kind?: string | null
  meta: Record<string, unknown>
}

export interface AssetLedgerDetail {
  found: boolean
  code: string
  source?: string
  device: AssetLedgerDeviceBrief | null
  fixed_asset: Record<string, unknown> | null
  archive: Record<string, unknown> | null
  profile: Record<string, unknown> | null
  area?: string
  records: AssetLedgerRecordItem[]
  record_count: number
  relations: AssetLedgerRelationItem[]
  /* ── 设备台账 redesign：盘点状态（详情抽屉逃生舱撤销入口用，SPEC §4.4）── */
  inventory_status?: InventoryStatus
  inventory_overridden?: boolean
  inventory_override_reason?: string | null
}

/** 台账反查（/assets/asset-ledger/resolve，走后端权威匹配内核） */
export type LedgerMatchType =
  | 'device_code_exact'
  | 'alias_exact'
  | 'observation_exact'
  | 'brand_extract_exact'
  | 'serial_no_exact'
  | 'brand_substring'
  | 'field_substring'

export interface LedgerResolveCandidate {
  device_code: string
  name: string
  asset_name: string
  location: string
  area: string
  source: string
  match_type: string
  match_field: string
  matched_value: string
  confidence: number
  has_serial: boolean
  in_devices: boolean
  source_demoted: boolean
}

export interface LedgerResolveResult {
  query: string
  normalized: { raw: string; upper: string; loose: string }
  kind: 'device_code' | 'alias' | 'serial' | 'serial_no' | 'fuzzy' | 'none' | 'ambiguous'
  exact: boolean
  count: number
  candidates: LedgerResolveCandidate[]
  hint?: { can_observe: boolean; reason: string }
  shared_count?: number
}

/* ============================ 子域常量 ============================ */

export const LEDGER_STATE_OPTIONS: { value: AssetLedgerState | ''; label: string }[] = [
  { value: '', label: '全部状态' }, { value: 'with_asset', label: '有固定资产' }, { value: 'without_asset', label: '无固定资产' },
  { value: 'ledger_only', label: '仅台账（未登记设备主表）' }, { value: 'has_records', label: '有台账记录' }, { value: 'warranty_expired', label: '保修已过期' },
  { value: 'warranty_soon', label: '保修将到期' }, { value: 'bim', label: '已标 BIM' }, { value: 'no_location', label: '缺位置信息' },
]

export const LEDGER_PAGE_SIZES = [20, 50, 100, 200]

export const LEDGER_DEFAULT_SORT: AssetLedgerSortKey = 'device_code'

/** 允许下发给后端的排序键（白名单：防止把 EP 列 prop 直接当参数发出） */
export const LEDGER_SORTABLE_KEYS: AssetLedgerSortKey[] = [
  'device_code', 'name', 'area', 'use_dept', 'subsystem', 'price_tax', 'warranty_end', 'record_count',
]

export const LEDGER_SOURCE_LABELS: Record<string, string> = {
  devices: '设备主表已登记',
  fixed_asset: '仅固定资产清单',
  archive: '仅设备档案',
  ledger_only: '仅现场台账记录',
}

const MATCH_TYPE_LABELS: Record<LedgerMatchType, string> = {
  device_code_exact: '设备编号精确匹配',
  alias_exact: '编号别名精确匹配',
  observation_exact: '机身编码精确匹配',
  brand_extract_exact: '品牌型号提取匹配',
  serial_no_exact: '序列号精确匹配',
  brand_substring: '品牌型号模糊匹配',
  field_substring: '字段模糊匹配',
}

export function matchTypeLabel(matchType: string): string {
  return MATCH_TYPE_LABELS[matchType as LedgerMatchType] ?? '台账匹配'
}

/** 字段中文名（固定资产 / 设备主表 / 设备档案三块共用一个查表，未命中回落原始 key） */
const FIELD_LABELS: Record<string, string> = {
  device_code: '设备编号', asset_name: '资产名称', asset_code: '资产代码', name: '设备名称',
  transfer_no: '移交编号', tag_no: '标签号', owner_unit: '权属单位', use_dept: '使用单位',
  location: '所在地点', location_desc: '位置描述', brand_model: '品牌型号', serial_no: '出厂序列号',
  recv_date: '接收日期', warranty_end: '保修截止', price_tax: '含税价', price_notax: '不含税价',
  tax: '税额', budget_item: '概算项目', contract_no: '合同编号', bim_tag: 'BIM 标签',
  builder: '承建单位', responsible: '责任人', proj_manager: '项目负责人', warranty_contact: '保修联系人',
  remark: '备注', room_code: '关联机房', room_match_method: '机房匹配方式',
  subsystem_id: '子系统 ID', subsystem_name: '所属子系统', building: '楼栋', floor: '楼层',
  is_active: '在用状态', pre_no: '原编号', project: '项目', system_text: '系统（原文）',
  old_name: '原名', old_code: '原代码', manufacturer: '厂商', qty: '数量', unit: '单位',
  original_value: '原值', residual_rate: '残值率', net_value: '净值', status_name: '状态',
}

export function ledgerFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

/** 判定是否「不可省略」的编号类字段（走等宽 + 强制断行，禁止省略号） */
export function isCodeLike(key: string): boolean {
  return /code|tag|_no$/i.test(key)
}

export function hasDisplayValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  return true
}

/* ============================ 展示口径 ============================ */

export function fmtInt(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN')
}

/** 金额：两位小数、千分位（表格与汇总卡同源，避免口径漂移） */
export function fmtMoney(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 汇总卡用的量级压缩（万 / 亿） */
export function fmtMoneyBig(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return '¥0'
  if (v >= 1e8) return `¥${(v / 1e8).toFixed(2)} 亿`
  if (v >= 1e4) return `¥${(v / 1e4).toFixed(2)} 万`
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function fmtDate(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  return s ? s.slice(0, 10) : '—'
}

/** 详情抽屉内的通用取值格式化（未知列不猜语义，只做安全呈现） */
export function fmtValue(v: unknown): string {
  if (!hasDisplayValue(v)) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('zh-CN') : String(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) return v.map((x) => fmtValue(x)).join('、')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function warrantyTagType(state: AssetLedgerRow['warranty_state']): 'danger' | 'warning' | 'info' {
  if (state === 'expired') return 'danger'
  if (state === 'soon') return 'warning'
  return 'info'
}

export function warrantyText(state: AssetLedgerRow['warranty_state']): string {
  if (state === 'expired') return '已过保'
  if (state === 'soon') return '即将到期'
  return '保内'
}

export function emptyFilters(): AssetLedgerFilters {
  return { q: '', subsystem_id: null, area: '', use_dept: '', state: '', inventory_status: '', source_kind: '' }
}

export function emptyFacets(): AssetLedgerFacets {
  return { areas: [], use_depts: [], subsystems: [] }
}

/** 筛选条件是否生效（决定空态文案与「清除筛选」入口） */
export function hasActiveFilters(f: AssetLedgerFilters): boolean {
  return (
    !!f.q ||
    f.subsystem_id !== null ||
    !!f.area ||
    !!f.use_dept ||
    !!f.state ||
    !!f.inventory_status ||
    !!f.source_kind
  )
}
