// Agent 接口封装。
// SSE 必须用 fetch + ReadableStream：浏览器 XHR（axios）不支持流式读取。
import { API_BASE } from '@/config'

export interface AgentTrace {
  tool: string
  ok: boolean
  ms?: number | null
  error?: string | null
}

export interface AgentEvent {
  type: 'start' | 'tool_start' | 'tool_end' | 'delta' | 'done' | 'error'
  session_id?: string
  name?: string
  args?: Record<string, unknown>
  ok?: boolean
  ms?: number
  content?: string
  trace?: AgentTrace[]
  usage?: Record<string, unknown>
  code?: string
  detail?: string
}

export interface ChatPayload {
  message: string
  session_id?: string | null
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = localStorage.getItem('token')
    if (token) h.Authorization = `Bearer ${token}`
  } catch {
    /* localStorage 不可用时按匿名处理 */
  }
  return h
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body?.detail) return String(body.detail)
  } catch {
    /* 非 JSON 响应 */
  }
  return `请求失败 (${res.status})`
}

export async function agentHealth(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/agent/health`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await errorText(res))
  return (await res.json()) as Record<string, unknown>
}

/** 流式对话：逐条回调 SSE 事件。 */
export async function chatStream(
  payload: ChatPayload,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/agent/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(await errorText(res))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx = buf.indexOf('\n\n')
    while (idx >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of chunk.split('\n')) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const raw = t.slice(5).trim()
        if (!raw) continue
        try {
          onEvent(JSON.parse(raw) as AgentEvent)
        } catch {
          /* 忽略无法解析的分片，不中断整条流 */
        }
      }
      idx = buf.indexOf('\n\n')
    }
  }
}

/** 非流式（调试 / 不支持流式的环境）。 */
export async function chatOnce(payload: ChatPayload): Promise<{
  answer: string
  trace: AgentTrace[]
  usage: Record<string, unknown>
}> {
  const res = await fetch(`${API_BASE}/agent/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...payload, stream: false }),
  })
  if (!res.ok) throw new Error(await errorText(res))
  return (await res.json()) as { answer: string; trace: AgentTrace[]; usage: Record<string, unknown> }
}
