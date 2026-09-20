/**
 * 工单执行流 域模型（一期 OpenAPI 契约 = 唯一依据）
 * =====================================================================
 * 契约来源：`C:/Users/yan/.workbuddy/inspection-phase1-openapi.md`（OpenAPI 3.0.3）
 * 数据纪律（Spec §9.2 / §10）：
 *   - 状态机**无 draft 态**：create 直接落 `pending_dispatch`；`reopened` 是**动作**而非存储状态（C6）。
 *   - `asset_device_code` 为 TEXT，引用资产总台账 `device_code`，**不建 devices 外键**（C1）。
 *   - `room_code` 引用核心 `rooms`（C2）。
 *   - 本模块**不做任何资产口径聚合**：BI 统计一律复用 ledger 服务（C3 / R1）。
 * 展示口径（label / 图标 / 色标）见 `@/types/workOrderMeta`，本文件只放形状。
 */

/* ============================ 枚举（对齐契约 §0.2） ============================ */

/** 工单状态：7 态主链 + 旁路（无 draft） */
export type WorkOrderStatus =
  | 'pending_dispatch'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'pending_review'
  | 'closed'
  | 'cancelled'

export type WorkOrderType = 'preventive' | 'corrective' | 'other'

/** 契约枚举为 low / medium / high / urgent（UIUX 曾写 normal，以契约为准） */
export type WorkOrderPriority = 'low' | 'medium' | 'high' | 'urgent'

export type WorkOrderSource = 'web' | 'miniprogram' | 'iot_alert' | 'import'

export type WorkOrderEventType =
  | 'created'
  | 'dispatched'
  | 'started'
  | 'completed'
  | 'submitted_review'
  | 'reviewed_approved'
  | 'reviewed_rejected'
  | 'closed'
  | 'cancelled'
  | 'reopened'
  | 'comment_added'
  | 'field_changed'
  | 'sync_conflict'
  | 'spare_consumed'

/** 可执行的 7 个动作（reopen 的 target_status 受限） */
export type WorkOrderActionKind =
  | 'dispatch'
  | 'start'
  | 'complete'
  | 'submit_review'
  | 'review'
  | 'cancel'
  | 'reopen'

/* ============================ 资源形状 ============================ */

export interface WorkOrder {
  id: number
  code: string
  title: string
  description: string | null
  type: WorkOrderType
  failure_flag: boolean
  status: WorkOrderStatus
  priority: WorkOrderPriority
  asset_device_code: string | null
  room_code: string | null
  subsystem_code: string | null
  reporter_id: number
  assignee_id: number | null
  reviewer_id: number | null
  source: WorkOrderSource
  alert_id: number | null
  parent_id: number | null
  due_at: string | null
  started_at: string | null
  completed_at: string | null
  closed_at: string | null
  /** 乐观锁版本：**仅离线 `wo_update` 会真正校验**；动作端点不校验也不记录（见下方 WoActionPayload 说明） */
  version: number
  created_at: string
  updated_at: string
  meta: Record<string, unknown>
}

export interface WorkOrderEvent {
  id: number
  work_order_id: number
  event_type: WorkOrderEventType
  from_status: string | null
  to_status: string | null
  /** 0 = system / iot 自动 */
  actor_id: number
  payload: Record<string, unknown>
  /** 离线补传来源可追溯 */
  client_op_id: string | null
  created_at: string
}

export interface WorkOrderDetail extends WorkOrder {
  events?: WorkOrderEvent[]
}

export interface WorkOrderPage {
  items: WorkOrder[]
  total: number
  page: number
  page_size: number
  has_more: boolean
}

/* ============================ 请求体 ============================ */

export interface WorkOrderCreate {
  title: string
  type: WorkOrderType
  description?: string
  failure_flag?: boolean
  priority?: WorkOrderPriority
  /** 必填且必须命中 ledger（AC-02）；前端在提交前先校验，不存在则 inline 报错并阻止提交 */
  asset_device_code: string
  room_code?: string
  subsystem_code?: string
  reporter_id?: number
  due_at?: string
  source?: WorkOrderSource
  meta?: Record<string, unknown>
}

/**
 * 动作请求体。
 * `version` 由前端统一附带，服务端**真乐观锁校验**（2026-09-20 决策 B）：与工单当前 version
 * 不一致 → 409 + 40900 + serverVersion（零副作用，前端据此弹冲突弹窗/行内提示）；缺省或 null
 * 不校验（向后兼容）。非法迁移仍由状态机兜底（422 + 42200）。`version` 对离线 `/sync` 的
 * wo_update 也是真乐观锁（HTTP 200 + results[].status=conflict + serverVersion）；
 * `/sync` 的 wo_action 不按版本拦截。
 * 详见 `@/api/workOrderApi` 头部「动作 version 的真实口径」。
 * `due_at` 用于派单时顺带修正截止时间。
 */
export interface WoActionPayload {
  version: number
  note?: string
  reason?: string
  approved?: boolean
  assignee_id?: number
  due_at?: string
  target_status?: 'assigned' | 'in_progress'
  photo_urls?: string[]
}

/** 派单（pending_dispatch → assigned），assignee_id 必填 */
export interface DispatchInput {
  assignee_id: number
  note?: string
  due_at?: string
}

/* ============================ 查询 ============================ */

/**
 * 列表查询（服务端过滤 / 排序 / 分页）。
 * 下列参数**均已进契约**，统一下发后端由其过滤与排序：
 *   q（关键字）/ status / type / priority / assignee_id / room_code /
 *   asset_device_code / due_from / due_to / sort / order / page / page_size。
 * 【明确口径】列表为**服务端分页**，筛选与排序一律下发后端，前端**不做本地过滤**
 *   （本地过滤只作用于当前页，会把 total 与「是否还有下一页」算错 = 假筛选）。
 */
export interface WorkOrderQuery {
  /** 关键字（单号 / 标题 / 描述 / 设备编号 / 房间编号） */
  q?: string
  /** 单枚举，UI 不做多选（避免「多选→静默不发」的假筛选） */
  status?: WorkOrderStatus
  type?: WorkOrderType
  /** 优先级 */
  priority?: WorkOrderPriority
  assignee_id?: number
  room_code?: string
  asset_device_code?: string
  /** 截止时间区间（YYYY-MM-DD） */
  due_from?: string
  due_to?: string
  sort?: 'created_at' | 'due_at' | 'priority'
  order?: 'asc' | 'desc'
  page?: number
  page_size?: number
}

/** 页面级筛选模型（未提交的原始输入；空串 = 不筛） */
export interface WorkOrderFilters {
  q: string
  /** 单值：契约的 status 为单枚举，多选会被后端拒（不做「多选→静默不发」的假筛选） */
  status: WorkOrderStatus | ''
  type: WorkOrderType | ''
  priority: WorkOrderPriority | ''
  assignee_id: number | null
  room_code: string
  asset_device_code: string
  due_from: string
  due_to: string
}

export const WO_PAGE_SIZES = [20, 50, 100, 200]

export function emptyWoFilters(): WorkOrderFilters {
  return {
    q: '',
    status: '',
    type: '',
    priority: '',
    assignee_id: null,
    room_code: '',
    asset_device_code: '',
    due_from: '',
    due_to: '',
  }
}

export function hasActiveWoFilters(f: WorkOrderFilters): boolean {
  return (
    !!f.q ||
    !!f.status ||
    !!f.type ||
    !!f.priority ||
    f.assignee_id !== null ||
    !!f.room_code ||
    !!f.asset_device_code ||
    !!f.due_from ||
    !!f.due_to
  )
}

/* ============================ 离线队列（C7 红线） ============================ */

export type PendingOpKind = 'wo_create' | 'wo_update' | 'wo_action' | 'photo'
export type PendingOpStatus = 'pending' | 'synced' | 'failed' | 'conflict'

export interface PendingOp {
  /** 客户端 uuid，服务端作为 client_op_id */
  id: string
  kind: PendingOpKind
  entityId?: string | null
  /** wo_update 乐观锁基准版本 */
  version?: number | null
  action?: WorkOrderActionKind | null
  payload: Record<string, unknown>
  /** 客户端毫秒时间戳 */
  createdAt: number
  tries: number
  lastError?: string | null
  /** 服务端 409 时的冲突来源 */
  conflictFrom?: string | null
  localRefs?: { photoIds?: string[] }
  status?: PendingOpStatus
}

export interface SyncRequest {
  ops: PendingOp[]
}

export interface SyncResult {
  clientOpId: string
  status: 'accepted' | 'conflict' | 'error'
  serverId?: number | null
  serverVersion?: number | null
  message?: string | null
}

export interface SyncResponse {
  results: SyncResult[]
}
