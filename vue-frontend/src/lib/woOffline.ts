/**
 * 工单离线队列与错误分流（Spec §9.2 C7 红线）
 * =====================================================================
 * 铁律（AC-06 / AC-07）：
 *   - **仅** `statusCode === 0`（网络错误 / 无响应）入队；
 *   - `404` / `400` **当场提示且不入队**（否则队列越积越脏，用户永远清不掉）；
 *   - `409` 保留并由用户决定（绝不自动覆盖、绝不静默重试、绝不擅自 move）；
 *   - `403` 只读降级（前端禁用动作按钮 + tooltip 说明原因）。
 *
 * 本模块只做「分类 + 落盘」两件事，不含任何 UI；Web 端动作失败时按分类调用对应分支。
 */
import type { PendingOp } from '@/types/workOrder'

const QUEUE_KEY = 'wo_offline_queue'
/** 队列上限（与小程序端一致），超出丢弃最旧 */
export const WO_QUEUE_LIMIT = 500

export type WoErrorKind = 'network' | 'conflict' | 'forbidden' | 'notfound' | 'badrequest' | 'server' | 'unknown'

export interface WoErrorInfo {
  kind: WoErrorKind
  /** 是否允许入离线队列（C7：只有 network 为真） */
  enqueueable: boolean
  statusCode: number
  serverVersion: number | null
  message: string
  /** 后端 error body 的 detail 明细（409 冲突字段等），缺失时回退为 message */
  detail: string
}

interface MaybeApiError {
  statusCode?: number
  serverVersion?: number | null
  message?: string
  detail?: string
}

/** 把任意异常归一成可分流的信息（不依赖具体类，兼容 WoApiError / Error） */
export function classifyWoError(e: unknown): WoErrorInfo {
  const err = e as MaybeApiError
  const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : -1
  const serverVersion = typeof err?.serverVersion === 'number' ? err.serverVersion : null
  const message = typeof err?.message === 'string' && err.message ? err.message : '操作失败'
  const detail = typeof err?.detail === 'string' && err.detail ? err.detail : message

  let kind: WoErrorKind = 'unknown'
  if (statusCode === 0) kind = 'network'
  else if (statusCode === 409) kind = 'conflict'
  else if (statusCode === 403) kind = 'forbidden'
  else if (statusCode === 404) kind = 'notfound'
  else if (statusCode === 400 || statusCode === 422) kind = 'badrequest'
  else if (statusCode >= 500) kind = 'server'

  return { kind, enqueueable: kind === 'network', statusCode, serverVersion, message, detail }
}

export function newWoOpId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* 忽略：降级到时间戳 + 随机数 */
  }
  return `wo-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

export function loadWoQueue(): PendingOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is PendingOp => !!x && typeof (x as PendingOp).id === 'string')
  } catch {
    return []
  }
}

function saveWoQueue(ops: PendingOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ops.slice(-WO_QUEUE_LIMIT)))
  } catch {
    /* 隐私模式 / 配额满：静默失败，不阻断主流程 */
  }
}

export function woQueueSize(): number {
  return loadWoQueue().length
}

/**
 * 入队（仅网络错误调用）。
 * 去重键 = `kind + entityId`：同一工单的同类操作只保留最新一条（覆盖而非追加），
 * 与小程序端「complete / review 用覆盖而非追加」的约定一致。
 */
export function enqueueWoOp(op: PendingOp): PendingOp[] {
  const queue = loadWoQueue()
  const key = `${op.kind}|${op.entityId ?? ''}`
  const kept = queue.filter((x) => `${x.kind}|${x.entityId ?? ''}` !== key)
  kept.push(op)
  saveWoQueue(kept)
  return kept
}

export function removeWoOp(id: string): PendingOp[] {
  const kept = loadWoQueue().filter((x) => x.id !== id)
  saveWoQueue(kept)
  return kept
}

export function clearWoQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* 忽略 */
  }
}
