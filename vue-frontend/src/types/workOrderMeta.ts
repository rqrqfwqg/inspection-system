/**
 * 工单展示口径（状态元数据表 + 中文标签 + 色标三通道）
 * =====================================================================
 * 依据：UIUX《工单模块设计规范》§1（状态语义色 Token）与 §1.6（图标语义总表）。
 * 铁律：
 *   1. 图标库**唯一** `@element-plus/icons-vue`（全项目不引第二套，禁 emoji 作功能图标）；
 *   2. 状态标签**必须**同时具备「图标 + 中文 + 色标」三通道（WCAG 1.4.1，颜色不是唯一线索）；
 *   3. 色标一律走 token（`--wo-<state>-{bg|fg}`），本文件不含任何字面色值。
 *
 * 与契约的差异（已登记）：契约状态机为 7 态；`draft` / `reopened` 仅为 UIUX 预留 token
 * （`draft` 不存在于状态机，`reopened` 是动作而非存储状态），保留以支持后续扩展。
 */
import type { Component } from 'vue'
import {
  Bell, CircleCheck, CircleCheckFilled, CircleClose, DocumentChecked, EditPen,
  Loading, RefreshRight, User,
  Finished, Promotion, Select, VideoPlay,
} from '@element-plus/icons-vue'
import type {
  WorkOrderActionKind, WorkOrderEventType, WorkOrderPriority, WorkOrderSource,
  WorkOrderStatus, WorkOrderType,
} from '@/types/workOrder'

export interface WoStatusMeta {
  /** 中文标签（必须显示，禁止只靠颜色） */
  label: string
  /** 色标 token 前缀，如 `--wo-pending-dispatch` */
  tokenPrefix: string
  icon: Component
  shape: 'light' | 'plain'
  /** 终态：额外加一个实心点作为第四通道 */
  final: boolean
}

const META: Record<string, WoStatusMeta> = {
  // —— 状态机 7 态 ——
  pending_dispatch: { label: '待派单', tokenPrefix: '--wo-pending-dispatch', icon: Bell, shape: 'light', final: false },
  assigned: { label: '已派单', tokenPrefix: '--wo-assigned', icon: User, shape: 'light', final: false },
  in_progress: { label: '处理中', tokenPrefix: '--wo-in-progress', icon: Loading, shape: 'light', final: false },
  completed: { label: '已完成', tokenPrefix: '--wo-completed', icon: CircleCheck, shape: 'plain', final: false },
  pending_review: { label: '待验收', tokenPrefix: '--wo-pending-review', icon: DocumentChecked, shape: 'plain', final: false },
  closed: { label: '已关闭', tokenPrefix: '--wo-closed', icon: CircleCheckFilled, shape: 'light', final: true },
  cancelled: { label: '已取消', tokenPrefix: '--wo-cancelled', icon: CircleClose, shape: 'light', final: true },
  // —— 预留（仅 token / 元数据，非存储态）——
  draft: { label: '草稿', tokenPrefix: '--wo-draft', icon: EditPen, shape: 'light', final: false },
  reopened: { label: '重新打开', tokenPrefix: '--wo-reopened', icon: RefreshRight, shape: 'light', final: false },
}

const FALLBACK: WoStatusMeta = {
  label: '未知状态', tokenPrefix: '--wo-draft', icon: EditPen, shape: 'light', final: false,
}

export function woStatusMeta(status: string | null | undefined): WoStatusMeta {
  if (!status) return FALLBACK
  return META[status] ?? FALLBACK
}

export function woStatusLabel(status: string | null | undefined): string {
  return woStatusMeta(status).label
}

/** 状态标签的内联色标变量（值仍为 var() 引用，组件内零字面色值） */
export function woToneStyle(status: string | null | undefined): Record<string, string> {
  const p = woStatusMeta(status).tokenPrefix
  return { '--tone-bg': `var(${p}-bg)`, '--tone-fg': `var(${p}-fg)` }
}

/** 主链 6 段（状态机进度条用；旁路态 cancelled / 不作为动作 reopened 不入链） */
export const WO_FLOW: WorkOrderStatus[] = [
  'pending_dispatch', 'assigned', 'in_progress', 'completed', 'pending_review', 'closed',
]

/** 列表页状态快捷筛选（顺序与设计一致） */
export const WO_STATUS_FILTERS: WorkOrderStatus[] = [
  'pending_dispatch', 'assigned', 'in_progress', 'completed', 'pending_review', 'closed', 'cancelled',
]

/* ============================ 类型 / 优先级 / 来源 ============================ */

export const WO_TYPE_LABELS: Record<WorkOrderType, string> = {
  preventive: '预防性',
  corrective: '纠正性',
  other: '其他',
}

export function woTypeLabel(t: string | null | undefined): string {
  return t && t in WO_TYPE_LABELS ? WO_TYPE_LABELS[t as WorkOrderType] : '—'
}

export const WO_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: '低',
  medium: '普通',
  high: '高',
  urgent: '紧急',
}

export function woPriorityLabel(p: string | null | undefined): string {
  return p && p in WO_PRIORITY_LABELS ? WO_PRIORITY_LABELS[p as WorkOrderPriority] : '普通'
}

export const WO_SOURCE_LABELS: Record<WorkOrderSource, string> = {
  web: '网页端',
  miniprogram: '小程序',
  iot_alert: '物联告警',
  import: '批量导入',
}

export function woSourceLabel(s: string | null | undefined): string {
  return s && s in WO_SOURCE_LABELS ? WO_SOURCE_LABELS[s as WorkOrderSource] : '—'
}

/* ============================ 事件类型 ============================ */

export const WO_EVENT_LABELS: Record<WorkOrderEventType, string> = {
  created: '创建工单',
  dispatched: '派单',
  started: '开始处理',
  completed: '执行完成',
  submitted_review: '提交验收',
  reviewed_approved: '验收通过',
  reviewed_rejected: '验收打回',
  closed: '关闭工单',
  cancelled: '取消工单',
  reopened: '重新打开',
  comment_added: '备注',
  field_changed: '字段变更',
  sync_conflict: '同步冲突',
  spare_consumed: '备件耗用',
}

export function woEventLabel(t: string | null | undefined): string {
  return t && t in WO_EVENT_LABELS ? WO_EVENT_LABELS[t as WorkOrderEventType] : (t ?? '事件')
}

/* ============================ 动作 ============================ */

export const WO_ACTION_LABELS: Record<WorkOrderActionKind, string> = {
  dispatch: '派单',
  start: '开始处理',
  complete: '执行完成',
  submit_review: '提交验收',
  review: '验收',
  cancel: '取消工单',
  reopen: '重新打开',
}

export const WO_ACTION_ICONS: Record<WorkOrderActionKind, Component> = {
  dispatch: Promotion,
  start: VideoPlay,
  complete: Select,
  submit_review: Finished,
  review: DocumentChecked,
  cancel: CircleClose,
  reopen: RefreshRight,
}
