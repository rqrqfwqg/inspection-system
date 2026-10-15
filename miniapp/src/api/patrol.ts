/**
 * patrol — 巡查打卡域接口层（inspection-system 后端 /ops/api）
 *
 * 与 asset.ts 同样**不复用 utils/request**：基地址不同（同域名不同前缀），
 * 且巡检接口需要区分 409（打卡重复 / 版本冲突 / 归属冲突）来给页面不同的交互。
 *
 * 🔴 状态枚举口径（**照线上后端实际值写，不要照方案文档**）
 * ------------------------------------------------------------------
 * 方案文档写的是 `draft / assigned / doing / completed / closed`（5 态），
 * 但线上后端 `work_order_state.py` 是 **7 态**且**明确无 draft**：
 *   pending_dispatch(待派) → assigned(已派) → in_progress(处理中)
 *   → completed(已完成) → pending_review(待验收) → closed(关闭)
 *   旁路：任意活跃态 → cancelled(已取消)；closed/cancelled 可 reopen
 * 因此这里的 `WO_STATUS` 是**唯一事实源**，页面一律引用它，禁止在页面里写死字符串。
 */

/** 工单状态（线上 7 态，与后端 work_order_state.STATUSES 一一对应） */
export const WO_STATUS = {
  PENDING_DISPATCH: 'pending_dispatch',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PENDING_REVIEW: 'pending_review',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
} as const

export type WoStatus = (typeof WO_STATUS)[keyof typeof WO_STATUS]

// ═══════════════════════════════════════════════════════════════
// 【前台展示态】2026-10-13 用户要求：巡查工单环节太多，
// 前台只呈现「待接单 / 进行中 / 已完成」三个状态。
//
// ⚠️ 为什么是「映射」而不是「砍后端状态」：
//   后端 work_order_state.py 的转换表是唯一合法性判据（C6 约定），
//   且 `assigned --start--> in_progress --complete--> completed`
//   链路被打卡接口的 WO_CAN_CHECKIN 依赖。直接砍状态会让
//   验收/闭环/打卡的流转全部断裂。
//   所以这里只做**展示层归并**：后台仍是 7 态，前台折叠成 3 档，
//   流转动作照旧走原动作端点。
//
// 归并规则：
//   待接单 ← pending_dispatch（未有人认领）
//   进行中 ← assigned（已接单未开工）+ in_progress（施工中）
//   已完成 ← completed + pending_review（待验收）+ closed（已闭环）
//   已取消 ← cancelled（旁路，单独成档不算进上面三档的流程）
// ═══════════════════════════════════════════════════════════════
export const WO_VIEW = {
  PENDING: 'pending',
  DOING: 'doing',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const
export type WoView = (typeof WO_VIEW)[keyof typeof WO_VIEW]

/** 后端 7 态 → 前台 3 档（cancelled 旁路单列） */
export const WO_VIEW_OF: Record<string, WoView> = {
  pending_dispatch: WO_VIEW.PENDING,
  assigned: WO_VIEW.DOING,
  in_progress: WO_VIEW.DOING,
  completed: WO_VIEW.DONE,
  pending_review: WO_VIEW.DONE,
  closed: WO_VIEW.DONE,
  cancelled: WO_VIEW.CANCELLED,
}

export const WO_VIEW_LABEL: Record<WoView, string> = {
  pending: '待接单',
  doing: '进行中',
  done: '已完成',
  cancelled: '已取消',
}

export const WO_VIEW_COLOR: Record<WoView, string> = {
  pending: '#e6a23c',
  doing: '#1989fa',
  done: '#07c160',
  cancelled: '#c0c4cc',
}

/** 取后台状态对应的前台档位 */
export function woViewOf(status: string): WoView {
  return WO_VIEW_OF[status] || WO_VIEW.PENDING
}

/** 取前台档位的中文名 */
export function woViewLabel(status: string): string {
  return WO_VIEW_LABEL[woViewOf(status)]
}

/** 取前台档位的视觉色 */
export function woViewColor(status: string): string {
  return WO_VIEW_COLOR[woViewOf(status)]
}

/** 状态中文名（后台原态，仅用于详情页的精确状态条/日志） */
export const WO_STATUS_LABEL: Record<string, string> = {
  pending_dispatch: '待派发',
  assigned: '待执行',
  in_progress: '进行中',
  completed: '已完成',
  pending_review: '待验收',
  closed: '已闭环',
  cancelled: '已取消',
}

/** 状态视觉色（与首页「逾期」红色区分开） */
export const WO_STATUS_COLOR: Record<string, string> = {
  pending_dispatch: '#909399',
  assigned: '#409eff',
  in_progress: '#1989fa',
  completed: '#07c160',
  pending_review: '#e6a23c',
  closed: '#67c23a',
  cancelled: '#c0c4cc',
}

/** 终态：不可再流转 */
export const WO_TERMINAL: string[] = [WO_STATUS.CLOSED, WO_STATUS.CANCELLED]

/** 可执行「打卡」的状态（后端 checkin 限定 assigned / in_progress） */
export const WO_CAN_CHECKIN: string[] = [WO_STATUS.ASSIGNED, WO_STATUS.IN_PROGRESS]

/** 各状态可用动作（对应后端 7 个动作端点，不是 /transition） */
export const WO_ACTIONS: Record<string, Array<{ action: string; label: string }>> = {
  // pending_dispatch 的主入口是「抢单」（全域开放，权限位 wo.execute）；
  // dispatch（指派他人）保留但只对调度/管理员有意义，前端按角色过滤掉。
  pending_dispatch: [
    { action: 'claim', label: '抢单' },
    { action: 'dispatch', label: '派发' },
    { action: 'cancel', label: '取消' },
  ],
  assigned: [
    { action: 'start', label: '开始' },
    { action: 'complete', label: '完成' },
    { action: 'cancel', label: '取消' },
  ],
  in_progress: [
    { action: 'complete', label: '完成' },
    { action: 'cancel', label: '取消' },
  ],
  completed: [
    { action: 'submit_review', label: '提交验收' },
    { action: 'cancel', label: '取消' },
  ],
  pending_review: [{ action: 'review', label: '验收' }],
  closed: [{ action: 'reopen', label: '重开' }],
  cancelled: [{ action: 'reopen', label: '重开' }],
}

import { getToken } from '@/utils/storage'

/** 巡检后端基地址（与 asset.ts 同源） */
const BASE: string = (import.meta.env.VITE_ASSET_API_BASE || 'https://www.xmgl-123.cn/ops/api').replace(/\/+$/, '')

export interface PatrolApiError {
  statusCode: number
  message: string
  data?: any
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

function buildHeader(): Record<string, string> {
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Type': 'miniprogram',
  }
  const token = getToken()
  if (token) header.Authorization = `Bearer ${token}`
  return header
}

function extractDetail(data: any, statusCode: number): string {
  if (!data) return `请求失败(${statusCode})`
  if (typeof data === 'string') return data
  const detail = data.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length && typeof detail[0]?.msg === 'string') return detail[0].msg
  if (typeof data.message === 'string' && data.message) return data.message
  return `请求失败(${statusCode})`
}

function patrolRequest<T = any>(path: string, method: Method = 'GET', data?: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${BASE}${path}`,
      method,
      data,
      header: buildHeader(),
      timeout: 15000,
      success: (res) => {
        const sc = res.statusCode
        if (sc >= 200 && sc < 300) {
          resolve(res.data as T)
          return
        }
        reject({ statusCode: sc, message: extractDetail(res.data, sc), data: res.data } as PatrolApiError)
      },
      fail: (err) => {
        reject({ statusCode: 0, message: (err.errMsg || '').includes('timeout') ? '请求超时' : '网络异常', data: err } as PatrolApiError)
      },
    })
  })
}

// ==================== 类型 ====================

export interface WoNode {
  id: number
  route_id?: number
  seq?: number
  node_type?: string
  room_code?: string | null
  area_code?: string | null
  qr_payload?: string | null
  snapshot_name?: string
  require_checkin?: boolean
  /** 工单节点视图才有 */
  checkin_status?: 'pending' | 'done'
  checked_at?: string | null
  operator_id?: number | null
  remark?: string | null
  abnormal?: boolean
}

export interface WorkOrder {
  id: number
  code: string
  title: string
  description?: string
  type?: string
  failure_flag?: boolean
  status: WoStatus | string
  priority?: string
  asset_device_code?: string | null
  room_code?: string | null
  reporter_id: number
  assignee_id?: number | null
  reviewer_id?: number | null
  parent_id?: number | null
  due_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  version: number
  meta?: Record<string, any> | null
  created_at?: string | null
  updated_at?: string | null
}

export interface RouteItem {
  id: number
  code: string
  name: string
  description?: string
  status: string
  owner_id: number
  node_count: number
  created_at?: string | null
  updated_at?: string | null
}

export interface RouteDetail extends RouteItem {
  nodes: WoNode[]
}

export interface Checkin {
  id: number
  work_order_id: number
  route_id?: number | null
  node_id: number
  operator_id: number
  checked_at?: string | null
  /** 打卡时上报的坐标。⚠️ **允许为 null** —— 室内定位失败时打卡照常放行
   *  （后端 lat/lng 只记录不拦截），所以画轨迹时必须过滤，
   *  并单独统计「有坐标 / 总打卡数」，不能只画有点的让人误以为只打了这么几次。 */
  lat?: number | null
  lng?: number | null
  remark?: string | null
  abnormal?: boolean
}

export interface CheckinResult {
  ok: boolean
  checkin: Checkin | null
  node_total: number
  node_done: number
  all_done: boolean
  message?: string | null
}

export interface PatrolStats {
  wo_doing: number
  wo_doing_doing: number
  wo_pending: number
  wo_overdue: number
  today_checkin_rate: number
  today_checked_nodes: number
  today_due_nodes: number
  rooms_inventoried: number
  rooms_total: number
}

/** 工单列表分页响应（后端 list_page 返回 {items,total,...}，非裸数组） */
export interface WoPage {
  items: WorkOrder[]
  total: number
  page?: number
  page_size?: number
}

// ==================== 工单 ====================

export function listWorkOrders(params: {
  status?: string
  assignee_id?: number
  q?: string
  type?: string
  priority?: string
  page?: number
  page_size?: number
} = {}): Promise<WoPage> {
  const qs: string[] = []
  if (params.status) qs.push(`status=${encodeURIComponent(params.status)}`)
  if (params.assignee_id) qs.push(`assignee_id=${params.assignee_id}`)
  if (params.q) qs.push(`q=${encodeURIComponent(params.q)}`)
  if (params.type) qs.push(`type=${encodeURIComponent(params.type)}`)
  if (params.priority) qs.push(`priority=${encodeURIComponent(params.priority)}`)
  const page = Math.max(1, Math.round(Number(params.page) || 1))
  const size = Math.max(1, Math.min(Number(params.page_size) || 20, 200))
  qs.push(`page=${page}`, `page_size=${size}`)
  return patrolRequest<WoPage>(`/work-orders?${qs.join('&')}`)
}

export function getWorkOrder(id: number): Promise<WorkOrder> {
  return patrolRequest<WorkOrder>(`/work-orders/${id}`)
}

/** 创建工单；`meta.route_id` 即挂线路（不改表结构，后端约定） */
export function createWorkOrder(payload: {
  title: string
  type?: string
  description?: string
  priority?: string
  due_at?: string | null
  room_code?: string | null
  assignee_id?: number | null
  meta?: Record<string, any> | null
}): Promise<WorkOrder> {
  return patrolRequest<WorkOrder>('/work-orders', 'POST', {
    source: 'miniprogram',
    type: payload.type || 'preventive',
    priority: payload.priority || 'medium',
    ...payload,
  })
}

/** 编辑工单（带 version 乐观锁；冲突返 409） */
export function updateWorkOrder(
  id: number,
  payload: Partial<WorkOrder> & { version?: number },
): Promise<WorkOrder> {
  return patrolRequest<WorkOrder>(`/work-orders/${id}`, 'PUT', payload)
}

/** 删除工单（仅 pending_dispatch / cancelled 可删） */
export function deleteWorkOrder(id: number): Promise<{ success: boolean }> {
  return patrolRequest(`/work-orders/${id}`, 'DELETE')
}

/** 状态流转（后端 7 个动作端点，非通用 /transition） */
export function doAction(
  id: number,
  action: string,
  payload: Record<string, any> = {},
): Promise<WorkOrder> {
  return patrolRequest<WorkOrder>(`/work-orders/${id}/${action}`, 'POST', payload)
}

/**
 * 抢单（claim）——「谁接了就是谁的」，**全域开放**。
 *
 * 与 `doAction('dispatch')` 的区别：
 * - dispatch 需要 `assignee_id`（指派给他人），权限位 wo.dispatch（仅调度/管理员）；
 * - claim **不需要也不接受** assignee_id：接单人在服务端从登录态推导，
 *   客户端传了也不认（否则就是越权指派）。权限位 wo.execute（所有作业人员）。
 *
 * 409 = 已被别人接走，detail 内含占用者姓名（形如「工单 XXX 已被张三接走」），
 * 页面据此灰显「已被 X 接走」，不要当成失败静默吞掉。
 *
 * ⚠️ version 必传：后端靠它做 CAS，并发抢同一单时只有一个能成功。
 */
export function claimWorkOrder(id: number, version: number): Promise<WorkOrder> {
  return patrolRequest<WorkOrder>(`/work-orders/${id}/claim`, 'POST', { version })
}

/** 从 409 文案里抽出占用者姓名，供列表灰显「已被 X 接走」 */
export function parseTakenBy(message: string): string {
  const m = /已被(.+?)接走/.exec(message || '')
  return m ? m[1] : ''
}

// ==================== 线路 ====================

export function listRoutes(params: { status?: string; q?: string } = {}): Promise<RouteItem[]> {
  const qs: string[] = []
  if (params.status) qs.push(`status=${encodeURIComponent(params.status)}`)
  if (params.q) qs.push(`q=${encodeURIComponent(params.q)}`)
  return patrolRequest<RouteItem[]>(`/routes${qs.length ? '?' + qs.join('&') : ''}`)
}

export function getRoute(id: number): Promise<RouteDetail> {
  return patrolRequest<RouteDetail>(`/routes/${id}`)
}

export function createRoute(payload: {
  name: string
  description?: string
  status?: string
  nodes?: Array<Partial<WoNode>>
}): Promise<RouteDetail> {
  return patrolRequest<RouteDetail>('/routes', 'POST', payload)
}

/** 编辑线路；给了 nodes 即**全量替换** */
export function updateRoute(
  id: number,
  payload: { name?: string; description?: string; status?: string; nodes?: Array<Partial<WoNode>> },
): Promise<RouteDetail> {
  return patrolRequest<RouteDetail>(`/routes/${id}`, 'PUT', payload)
}

export function deleteRoute(id: number): Promise<{ success: boolean }> {
  return patrolRequest(`/routes/${id}`, 'DELETE')
}

export function appendRouteNode(
  routeId: number,
  node: { node_type?: string; room_code?: string | null; area_code?: string | null; snapshot_name?: string },
): Promise<RouteDetail> {
  return patrolRequest<RouteDetail>(`/routes/${routeId}/nodes`, 'POST', node)
}

/** 删节点（返回 404 表示节点不存在或不属于该线路） */
export function deleteRouteNode(routeId: number, nodeId: number): Promise<{ success: boolean }> {
  return patrolRequest(`/routes/${routeId}/nodes/${nodeId}`, 'DELETE')
}

/** 可选节点清单（房间/区域），node_type=room|area */
export function availableNodes(nodeType: 'room' | 'area' = 'room', q?: string): Promise<any[]> {
  const qs = [`node_type=${nodeType}`]
  if (q) qs.push(`q=${encodeURIComponent(q)}`)
  return patrolRequest<any[]>(`/routes/available-nodes?${qs.join('&')}`)
}

// ==================== 打卡 ====================

/**
 * 节点打卡。
 * ⚠️ 幂等由后端保证：同一工单同一节点重复打卡返 **409**，页面据此提示
 * 「该节点已打卡」并刷新状态（不能当成失败静默吞掉）。
 */
export function doCheckin(
  woId: number,
  payload: { node_id: number; remark?: string | null; abnormal?: boolean; lat?: number | null; lng?: number | null },
): Promise<CheckinResult> {
  return patrolRequest<CheckinResult>(`/work-orders/${woId}/checkin`, 'POST', payload)
}

export function listCheckins(woId: number): Promise<Checkin[]> {
  return patrolRequest<Checkin[]>(`/work-orders/${woId}/checkins`)
}

/** 工单的线路节点 + 各节点打卡状态（工单详情页一次拿齐，省二次请求） */
export function woNodes(woId: number): Promise<WoNode[]> {
  return patrolRequest<WoNode[]>(`/work-orders/${woId}/nodes`)
}

// ==================== 首页统计 ====================

export function patrolStats(): Promise<PatrolStats> {
  return patrolRequest<PatrolStats>('/stats/patrol')
}

// ==================== 工具 ====================

/** 是否逾期（只读判定，不改 status —— 与后端口径一致） */
export function isOverdue(wo: WorkOrder | null | undefined): boolean {
  if (!wo || !wo.due_at) return false
  if (WO_TERMINAL.includes(wo.status as string)) return false
  return new Date(wo.due_at).getTime() < Date.now()
}

/** 从工单 meta 取线路 id */
export function routeIdOf(wo: WorkOrder | null | undefined): number | null {
  const rid = wo?.meta?.route_id
  if (rid == null) return null
  const n = Number(rid)
  return Number.isFinite(n) ? n : null
}