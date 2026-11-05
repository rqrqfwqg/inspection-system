/**
 * agent — 系统内 Agent 接口层（巡检后端 /ops/api/agent）
 *
 * 与 asset.ts 同源（VITE_ASSET_API_BASE），不走 utils/request：
 * 1) 基址是巡检后端（…/ops/api），不是工器具后端（…/api）；
 * 2) Agent 回答可能含多轮工具调用，耗时长，超时需要放宽到 90s；
 * 3) 小程序端**不做 chunked 流式**（ArrayBuffer 中文解码跨端不稳），
 *    统一用 stream:false 一次性返回，稳定优先。
 */
import { getToken } from '@/utils/storage'

const ASSET_BASE: string = (
  import.meta.env.VITE_ASSET_API_BASE || 'https://www.xmgl-123.cn/ops/api'
).replace(/\/+$/, '')

export interface AgentTrace {
  tool: string
  ok: boolean
  ms?: number | null
  error?: string | null
}

export interface AgentAnswer {
  answer: string
  trace: AgentTrace[]
  usage: Record<string, unknown>
  session_id?: string | null
}

export interface AgentChatPayload {
  message: string
  session_id?: string | null
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface AgentApiError {
  statusCode: number
  message: string
  data?: any
}

function buildHeader(): Record<string, string> {
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    // 标记来源端，便于后端审计区分「网页 / 小程序」
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
  if (Array.isArray(detail) && detail.length && typeof detail[0]?.msg === 'string') {
    return detail[0].msg
  }
  return `请求失败(${statusCode})`
}

function agentRequest<T>(
  path: string,
  method: 'GET' | 'POST',
  data?: any,
  timeout = 90000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${ASSET_BASE}${path}`,
      method,
      data,
      header: buildHeader(),
      timeout,
      success: (res) => {
        const statusCode = res.statusCode
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res.data as T)
          return
        }
        reject({
          statusCode,
          message: extractDetail(res.data, statusCode),
          data: res.data,
        } as AgentApiError)
      },
      fail: (err) => {
        const raw = err.errMsg || ''
        const message = raw.includes('domain') || raw.includes('合法域名')
          ? '请求域名未配置：请在小程序后台把 www.xmgl-123.cn 加入 request 合法域名'
          : raw.includes('timeout')
            ? '回答超时，请把问题拆小一点再试'
            : '网络异常，请检查网络连接'
        reject({ statusCode: 0, message, data: raw } as AgentApiError)
      },
    })
  })
}

/** 配置自检：模型是否配好、工具数（后台排查用） */
export function agentHealth(): Promise<Record<string, unknown>> {
  return agentRequest<Record<string, unknown>>('/agent/health', 'GET', undefined, 15000)
}

/** 对话（非流式，一次性返回） */
export function agentChat(payload: AgentChatPayload): Promise<AgentAnswer> {
  return agentRequest<AgentAnswer>(
    '/agent/chat',
    'POST',
    { ...payload, stream: false },
    90000,
  )
}
