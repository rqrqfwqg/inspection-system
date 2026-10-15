/**
 * request — uni.request Promise 化封装（小程序请求层唯一入口）
 *
 * 约定（设计文档 §8.2 / §8.4 / §8.5）：
 * - baseURL 从 VITE_API_BASE_URL 读取，页面/API 层只写相对路径
 * - 请求自动携带 Authorization: Bearer <token>（token 从 utils/storage 读取）
 * - 后端返回裸 JSON（非 {code,data,message} 包裹）：2xx 直接 resolve 业务数据
 * - 401 → 清 token/user + reLaunch 到登录页 + reject
 * - 网络错误/超时 → toast 提示 + reject { statusCode, message }
 */
import { getToken, clearAuth } from '@/utils/storage'
import { showToast } from '@/utils/feedback'

export const BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/+$/, '')

export interface RequestError {
  /** HTTP 状态码；网络错误/超时为 0 */
  statusCode: number
  message: string
  /** 后端原始响应体（存在时） */
  data?: any
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
  header?: Record<string, string>
  /** 超时 ms，默认 10000 */
  timeout?: number
}

/** 从后端裸 JSON 中提取可读错误信息 */
function extractErrorMessage(data: any): string {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (typeof data.message === 'string' && data.message) return data.message
  if (typeof data.error === 'string' && data.error) return data.error
  return ''
}

/** 401 统一处理：清鉴权 + 跳登录页 */
function handleUnauthorized(): void {
  clearAuth()
  showToast('登录已过期，请重新登录', 'none')
  setTimeout(() => {
    uni.reLaunch({ url: '/pages/login/Login' })
  }, 500)
}

/**
 * 核心请求函数（泛型）
 * @returns Promise<T>：2xx 直接 resolve 业务数据
 */
export function request<T = any>(options: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
  const token = getToken()
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    // 标记来源端，供后端登录审计区分「网页 / 小程序」
    'X-Client-Type': 'miniprogram',
    ...(options.header || {})
  }
  // 登录/绑定类接口为匿名流程（靠 wx code / 手机号匹配），不应携带已登录 token；
  // 否则游客态 token 会触发后端游客只读守卫 403，导致「游客永远无法登录」的死锁。
  const ANON_PATHS = ['/auth/wx-login', '/auth/login', '/auth/wx-bind-phone', '/auth/wx-phone-login']
  if (token && !ANON_PATHS.some((p) => options.url.startsWith(p))) {
    header.Authorization = `Bearer ${token}`
  }

    uni.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: options.timeout || 10000,
      success: (res) => {
        const statusCode = res.statusCode
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res.data as T)
          return
        }
        if (statusCode === 401) {
          handleUnauthorized()
          reject({ statusCode, message: '未登录或登录已过期' })
          return
        }
        const message = extractErrorMessage(res.data) || `请求失败(${statusCode})`
        showToast(message, 'none')
        reject({ statusCode, message, data: res.data })
      },
      fail: (err) => {
        const rawMsg = err.errMsg || ''
        const isTimeout = rawMsg.includes('timeout')
        const message = isTimeout ? '请求超时，请稍后重试' : '网络异常，请检查网络连接'
        showToast(message, 'none')
        reject({ statusCode: 0, message, data: rawMsg })
      }
    })
  })
}

/** GET 快捷方法（params 会以 query 形式发送） */
export function get<T = any>(url: string, params?: Record<string, any>): Promise<T> {
  return request<T>({ url, method: 'GET', data: params })
}

/** POST 快捷方法 */
export function post<T = any>(url: string, data?: any): Promise<T> {
  return request<T>({ url, method: 'POST', data })
}

/** PUT 快捷方法 */
export function put<T = any>(url: string, data?: any): Promise<T> {
  return request<T>({ url, method: 'PUT', data })
}

/** DELETE 快捷方法 */
export function del<T = any>(url: string): Promise<T> {
  return request<T>({ url, method: 'DELETE' })
}

export default request
