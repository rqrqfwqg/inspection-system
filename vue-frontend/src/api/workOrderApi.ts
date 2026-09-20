/**
 * 工单执行流 API 客户端（严格按一期 OpenAPI 契约）
 * =====================================================================
 * 路径：全部挂在 API_BASE（`/ops/api`）之下，与 `@/config` 的命名空间一致。
 *
 * 【为什么不复用 `@/api/http.ts`】
 *   `http.ts` 的 request() 会把 axios 错误压成 `new Error(formatApiError(e))`，
 *   **丢失 HTTP 状态码与响应体**（serverVersion / code）。而本期三条硬点强制依赖它们：
 *     - 409 必须弹 dialog（需要 serverVersion 才能展示 version N vs M）；
 *     - 只有 `statusCode === 0`（网络错误）才可入离线队列，404/400 当场提示且不入队；
 *     - 403 需驱动只读降级（禁用动作按钮 + tooltip）。
 *   故本文件自建实例并抛 `WoApiError`（携带 statusCode / code / serverVersion / detail），
 *   同时复用 `formatApiError` 保证可读文案与全站一致。既有 `api/*.ts` 一行未改。
 *
 * 【动作 version 的真实口径（2026-09-20 决策 B：动作端点已升级为真乐观锁）】
 *   本客户端对 7 个动作统一附加 `version`，服务端**真校验**：与工单当前 version 不一致
 *   → **409 + 40900 + serverVersion**（写入前拦截，工单状态/version/事件表零副作用），
 *   页面据此弹 WoConflictDialog / 行内提示；改用返回的 serverVersion 刷新后重试即恢复。
 *   缺省或 null 不校验（向后兼容）。无权限 → 403 先于 409（权限闸在 FastAPI dependency 层）。
 *   `version` 对离线 `/sync` 的 wo_update 也是真乐观锁（HTTP 200 + results[].status=conflict +
 *   serverVersion，批量端点不整批 409）；而 `/sync` 的 **wo_action 不按版本拦截**（过期 version
 *   仍 accepted，冲突由状态机 422 兜底），故同步链路的 409 处理保留不动。
 */
import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { API_BASE } from '@/config'
import { formatApiError } from './http'
import type { WorkOrder, WorkOrderCreate, WorkOrderDetail, WorkOrderEvent, WorkOrderPage, WorkOrderQuery, WoActionPayload, SyncRequest, SyncResponse } from '@/types/workOrder'

const TOKEN_KEY = 'token'

/** 结构化 API 错误：保留后端状态码与 409 版本信息，供页面分流处理 */
export class WoApiError extends Error {
  /** HTTP 状态码；0 = 网络错误（无响应） */
  readonly statusCode: number
  /** 应用错误码（§0.1），无响应体时为 null */
  readonly code: number | null
  /** 仅 409 版本冲突时后端返回 */
  readonly serverVersion: number | null
  readonly detail: string

  constructor(message: string, statusCode: number, code: number | null, serverVersion: number | null, detail: string) {
    super(message)
    this.name = 'WoApiError'
    this.statusCode = statusCode
    this.code = code
    this.serverVersion = serverVersion
    this.detail = detail
  }

  /** 网络错误（无响应）—— 唯一允许入离线队列的错误类别（C7） */
  get isNetwork(): boolean {
    return this.statusCode === 0
  }
  get isConflict(): boolean {
    return this.statusCode === 409
  }
  get isForbidden(): boolean {
    return this.statusCode === 403
  }
  get isNotFound(): boolean {
    return this.statusCode === 404
  }
}

const instance: AxiosInstance = axios.create({ baseURL: API_BASE, timeout: 30000 })

instance.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) config.headers.Authorization = `Bearer ${token}`
  } catch {
    /* localStorage 不可用（隐私模式）时按未登录处理，不阻断请求 */
  }
  return config
})

/** 防御后端 SPA catch-all：不存在的 /ops/api/xxx 会返回 200 + index.html */
instance.interceptors.response.use((res) => {
  const data = res.data
  if (typeof data === 'string' && data.trimStart().toLowerCase().startsWith('<')) {
    return Promise.reject(
      new WoApiError(`接口不存在或返回了 HTML（${res.config?.url ?? ''}），请核对 API 路径`, 0, null, null, 'html_response'),
    )
  }
  return res
})

interface ErrorBody {
  code?: number
  detail?: unknown
  serverVersion?: number | null
  message?: string
}

function toWoApiError(e: unknown): WoApiError {
  const err = e as AxiosError<ErrorBody>
  const res = err?.response
  const body = res?.data
  const detailRaw = body?.detail
  const detail =
    typeof detailRaw === 'string' ? detailRaw : detailRaw === undefined ? '' : JSON.stringify(detailRaw)
  const serverVersion = typeof body?.serverVersion === 'number' ? body.serverVersion : null
  const code = typeof body?.code === 'number' ? body.code : null
  return new WoApiError(formatApiError(e), res?.status ?? 0, code, serverVersion, detail)
}

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const res = await instance.request<T>(config)
    return res.data
  } catch (e) {
    throw toWoApiError(e)
  }
}

/** 只保留有值参数（跳过 undefined / null / 空串 / 空数组），避免把空筛选发给后端 */
function queryOf(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = Array.isArray(v) ? v.join(',') : String(v)
  }
  return out
}

const WO = '/work-orders'

/* ============================ 工单：读 ============================ */

export function listWorkOrders(query: WorkOrderQuery): Promise<WorkOrderPage> {
  return request<WorkOrderPage>({
    method: 'GET',
    url: WO,
    params: queryOf({
      q: query.q,
      status: query.status,
      type: query.type,
      priority: query.priority,
      assignee_id: query.assignee_id,
      room_code: query.room_code,
      asset_device_code: query.asset_device_code,
      due_from: query.due_from,
      due_to: query.due_to,
      sort: query.sort,
      order: query.order,
      page: query.page,
      page_size: query.page_size,
    }),
  })
}

export function getWorkOrder(id: number, includeEvents = true): Promise<WorkOrderDetail> {
  return request<WorkOrderDetail>({
    method: 'GET',
    url: `${WO}/${id}`,
    params: queryOf({ include_events: includeEvents ? 'true' : 'false' }),
  })
}

export function listWorkOrderEvents(id: number): Promise<WorkOrderEvent[]> {
  return request<WorkOrderEvent[]>({ method: 'GET', url: `${WO}/${id}/events` })
}

/* ============================ 工单：写 ============================ */

export function createWorkOrder(payload: WorkOrderCreate): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: WO, data: payload })
}

export function dispatchWorkOrder(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/dispatch`, data: payload })
}

export function startWorkOrder(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/start`, data: payload })
}

export function completeWorkOrder(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/complete`, data: payload })
}

export function submitWorkOrderReview(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/submit-review`, data: payload })
}

export function reviewWorkOrder(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/review`, data: payload })
}

export function cancelWorkOrder(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/cancel`, data: payload })
}

export function reopenWorkOrder(id: number, payload: WoActionPayload): Promise<WorkOrder> {
  return request<WorkOrder>({ method: 'POST', url: `${WO}/${id}/reopen`, data: payload })
}

/* ============================ 附件 / 离线同步 ============================ */

export interface AttachmentUploadResult {
  url: string
  filename: string
}

export function uploadAttachment(file: File, clientOpId?: string): Promise<AttachmentUploadResult> {
  const form = new FormData()
  form.append('file', file)
  if (clientOpId) form.append('client_op_id', clientOpId)
  return request<AttachmentUploadResult>({
    method: 'POST',
    url: '/attachments/upload',
    data: form,
  })
}

export function syncWorkOrders(ops: SyncRequest): Promise<SyncResponse> {
  return request<SyncResponse>({ method: 'POST', url: `${WO}/sync`, data: ops })
}
