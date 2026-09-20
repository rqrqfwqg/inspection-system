import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { API_BASE } from '@/config'

const TOKEN_KEY = 'token'

function currentToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/**
 * 后端错误体 → 可读消息。
 * 复刻 React 版 src/services/api.ts:45-57 的契约：
 * 422 时 detail 是数组（FastAPI 校验错误），须拼成 `loc.slice(1).join('.') + ': ' + msg`，多个用「；」连接。
 */
export function formatApiError(error: unknown): string {
  if (axios.isCancel(error)) return '请求已取消'
  const err = error as AxiosError<{ detail?: unknown; message?: string }>
  const res = err?.response
  if (!res) {
    return err?.message ? `网络错误：${err.message}` : '网络错误，请检查连接后重试'
  }
  const body = res.data
  const detail = body?.detail
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: string[]; msg?: string }) => {
        const loc = Array.isArray(e?.loc) ? e.loc.slice(1).join('.') : ''
        return `${loc ? loc + ': ' : ''}${e?.msg || JSON.stringify(e)}`
      })
      .join('；')
  }
  if (typeof detail === 'string' && detail) return detail
  if (body?.message) return body.message
  return `请求失败 (${res.status})`
}

const instance: AxiosInstance = axios.create({ baseURL: API_BASE, timeout: 30000 })

instance.interceptors.request.use((config) => {
  const token = currentToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * 防御后端的 SPA catch-all：不存在的 /ops/api/xxx 会返回 200 + index.html。
 * 若不拦截，页面会把 HTML 当数据用，报出莫名其妙的运行时错误。
 * 401 处理（2026-09-20 Phase 0）：非登录接口返回 401 → 清本地登录态并整页跳 /login。
 *   用 location 而非 router：http.ts 不依赖 router（避免循环引用），整页跳转同时
 *   重置所有模块级状态；登录接口自身的 401（密码错误）不触发跳转，由登录页提示。
 */
instance.interceptors.response.use(
  (res) => {
    const data = res.data
    if (typeof data === 'string' && data.trimStart().toLowerCase().startsWith('<')) {
      return Promise.reject(
        new Error(`接口不存在或返回了 HTML（${res.config?.url ?? ''}），请核对 API 路径`)
      )
    }
    return res
  },
  (error) => {
    const status = error?.response?.status
    const url: string = error?.config?.url || ''
    if (status === 401 && !url.includes('/auth/login')) {
      try {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      } catch {
        /* 忽略存储不可用 */
      }
      const base = import.meta.env.BASE_URL || '/'
      const here = window.location.pathname + window.location.search
      window.location.href = `${base}login?redirect=${encodeURIComponent(here)}`
    }
    return Promise.reject(error)
  }
)

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const res = await instance.request<T>(config)
    return res.data
  } catch (e) {
    throw new Error(formatApiError(e))
  }
}

/** 只保留有值的查询参数（跳过 undefined / null / 空串），避免把空筛选发给后端 */
export function queryOf(params?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!params) return out
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = String(v)
  }
  return out
}

export const http = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    request<T>({ method: 'GET', url, params: queryOf(params) }),
  post: <T>(url: string, data?: unknown, params?: Record<string, unknown>) =>
    request<T>({ method: 'POST', url, data, params: queryOf(params) }),
  put: <T>(url: string, data?: unknown) => request<T>({ method: 'PUT', url, data }),
  delete: <T>(url: string, params?: Record<string, unknown>) =>
    request<T>({ method: 'DELETE', url, params: queryOf(params) }),
}

export default http
