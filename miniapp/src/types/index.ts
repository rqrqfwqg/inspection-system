// ========== 基础类型定义（与 PC 端保持兼容） ==========

export interface User {
  user_id: number
  username: string
  real_name: string
  dept_id: number
  role: string
  role_id: number
  role_name: string
  is_active: boolean
  phone?: string
  dept_name?: string
  // ===== 微信登录扩展字段（设计文档 §4.3，追加可选字段，保持 H5 端兼容） =====
  wx_openid?: string | null
  wx_nickname?: string
  wx_avatar?: string
}

/** 微信登录结果（与 /auth/login 同构 + is_new_user/guest） */
export interface WxLoginResult {
  access_token: string
  user: User
  is_new_user?: boolean
  /** true = 未匹配到系统账号，游客模式（只读） */
  guest?: boolean
  /** true = 本次登录已把当前微信绑定到该账号 */
  bound_openid?: boolean
}

export interface Tool {
  tool_id: number
  tool_code: string
  tool_name: string
  category_id: number
  category_name: string
  scene?: string
  warehouse?: string
  warehouse_id?: number
  shelf_id?: number
  shelf_name?: string
  storage_location_id?: number
  storage_location?: string
  location_name?: string
  status: string
  purchase_date?: string
  scrap_date?: string
  borrow_count?: number
  description?: string
  image_url?: string
  toolkit_name?: string
}

export interface Warehouse {
  warehouse_id: number
  warehouse_name: string
  warehouse_code: string
  description?: string
  is_active: boolean
}

export interface Category {
  category_id: number
  category_name: string
  category_code: string
  description: string
  require_approval?: boolean
}

export interface OrderItem {
  item_id: number
  tool_id?: number
  tool_code?: string
  tool_name?: string
  /** 物料单：备件字段 */
  item_type?: string
  spare_id?: number
  spare_code?: string
  spare_name?: string
  borrow_qty?: number
  returned_qty?: number
  item_status: string
  return_time?: string
  condition_note?: string
}

export interface Order {
  order_id: number
  order_no: string
  borrower_name: string
  status: string
  /** tool=工具单 / material=备件领取单 */
  order_type?: string
  scene?: string
  warehouse?: string
  require_approval: boolean
  borrow_time: string
  expected_return?: string
  actual_return?: string
  purpose?: string
  created_at: string
  items?: OrderItem[]
}

// ========== 扫码相关 ==========

export interface ScanRecord {
  /** 扫码时间 ISO 字符串 */
  scanned_at: string
  /** 工具编码 */
  tool_code: string
  /** 工具名称 */
  tool_name: string
  /** 工具ID */
  tool_id: number
  /** 扫码时状态 */
  status: string
}

// ========== 物料管理（与 PC 端 types 对齐） ==========

export interface SparePart {
  spare_id: number
  spare_code: string
  spare_name: string
  category_id?: number
  category_name?: string
  warehouse_id?: number
  warehouse_name?: string
  shelf_id?: number
  shelf_name?: string
  storage_location_id?: number
  location_name?: string
  storage_location?: string
  stock_qty?: number
  unit?: string
  status: string
  image_url?: string
  description?: string
  borrow_count?: number
  /** 预警值（后端 enrichSpare 已返回） */
  warning_qty?: number | null
  /** 单条低库存标记（后端 enrichSpare 已返回，按条比较 stock_qty<=warning_qty） */
  is_low_stock?: boolean
  created_at?: string
}

export interface Consumable {
  consumable_id: number
  consumable_code: string
  consumable_name: string
  category_id?: number
  category_name?: string
  warehouse_id?: number
  warehouse_name?: string
  shelf_id?: number
  shelf_name?: string
  storage_location_id?: number
  location_name?: string
  storage_location?: string
  stock_qty: number
  unit?: string
  warning_qty?: number | null
  price?: number | null
  image_url?: string
  description?: string
  total_out?: number
  /** 后端实际字段：true=需工单出库 / false=免工单直领 */
  require_order?: boolean
  /** 前端派生字段（mapConsumable 计算）：require_order ? 'workorder' : 'direct' */
  outbound_type?: 'workorder' | 'direct'
  created_at?: string
}

// ========== 备件（序列化单品，一对一码） ==========
// 与旧的 quantity 型 SparePart 不同：每件实物一个唯一 QR（item_code = SI-XXXXXXXX），
// 库存 = 实物件数；一个货位可存放多件；盘点/扫码都按单件进行。
export type SpareItemStatus = 'in_stock' | 'borrowed' | 'out' | 'scrapped'

export interface SpareItem {
  item_id: number
  /** 一对一二维码内容，如 SI-1A2B3C4D（后端 genSpareItemCode 生成） */
  item_code: string
  spare_name: string
  category_id?: number
  category_name?: string
  warehouse_id?: number
  warehouse_name?: string
  shelf_id?: number
  shelf_name?: string
  storage_location_id?: number
  location_code?: string
  location_name?: string
  storage_location?: string
  status: SpareItemStatus
  unit?: string
  model?: string
  image_url?: string
  description?: string
  operator_name?: string
  created_at?: string
}

/** 前端按货位聚合备件单品（一个货位可放多件） */
export interface SpareItemGroup {
  storage_location_id: number
  location_name?: string
  storage_location?: string
  shelf_name?: string
  warehouse_name?: string
  items: SpareItem[]
}

export interface MaterialCategory {
  category_id: number
  category_name: string
  category_code: string
  category_type: 'spare' | 'consumable' | 'both'
  description: string
}

export interface StockMovement {
  movement_id: number
  item_type: string
  item_id?: number
  item_code?: string
  item_name?: string
  movement_type: string
  qty: number
  operator_id?: number
  operator_name?: string
  order_id?: number | null
  scan_code?: string
  remark?: string
  created_at?: string
}

export interface InventoryCheckItem {
  /** spare_item=序列化备件单品（按件盘点）；spare=旧数量型（向后兼容）；consumable/tool */
  item_type: 'spare' | 'spare_item' | 'consumable' | 'tool'
  item_id: number
  item_code: string
  item_name: string
  system_qty: number
  actual_qty: number
  diff: number
  /** 前端瞬时"已录入"标记（不持久化到后端，由 useInventoryEntered 统一维护） */
  entered?: boolean
}

export interface InventoryCheck {
  check_id: number
  check_no: string
  warehouse_id: number
  warehouse_name?: string
  status: string
  operator_id?: number
  operator_name?: string
  items?: InventoryCheckItem[]
  started_at?: string
  completed_at?: string
}

// ========== 安全防护用品（物料分支） ==========

export interface SafetySupply {
  supply_id: number
  name: string
  model: string
  brand: string
  /** 生产日期 YYYY-MM-DD（可空） */
  production_date: string
  /** 到期日期 YYYY-MM-DD（必填） */
  expiry_date: string
  /** 管理人（必填） */
  manager: string
  /** 使用人（可空） */
  user_name: string
  /** 检查周期（天），默认 90 */
  check_cycle_days: number
  /** 上次检查日期 YYYY-MM-DD（可空） */
  last_check_date: string | null
  remark: string
  created_at?: string
  updated_at?: string
}

/** 即将到期项（后端 enrich：额外带 days_to_expiry） */
export interface SafetyExpiring extends SafetySupply {
  days_to_expiry: number
}

/** 待定期检查项（后端 enrich：额外带 next_check_date） */
export interface SafetyCheckDue extends SafetySupply {
  next_check_date: string | null
}

/** /safety-supplies/alerts 响应 */
export interface SafetyAlerts {
  expiry_alert_days: number
  expiring: SafetyExpiring[]
  check_due: SafetyCheckDue[]
}
