// 环境变量配置：开发环境走 Vite proxy 到 localhost:9527，生产环境指向实际 API
// 默认使用 /ops/api（见 src/config.ts，与后端 api_router(prefix="/ops/api") 一致）
import { API_BASE } from '@/config'
const API_BASE_URL = import.meta.env.VITE_API_URL || API_BASE

import type { User } from '@/types'

class ApiService {
  private _token: string | null = null

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  get token(): string | null { return this._token }

  constructor() {
    this._token = localStorage.getItem('token')
  }

  setToken(token: string | null) {
    this._token = token
    if (token) {
      localStorage.setItem('token', token)
    } else {
      localStorage.removeItem('token')
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: '请求失败' }))
      // detail 可能是字符串（普通错误）或数组（422 校验错误）
      let message: string
      if (Array.isArray(error.detail)) {
        message = error.detail.map((e: { loc?: string[]; msg?: string }) =>
          `${e.loc ? e.loc.slice(1).join('.') + ': ' : ''}${e.msg || JSON.stringify(e)}`
        ).join('；')
      } else {
        message = error.detail || error.message || `请求失败 (${response.status})`
      }
      throw new Error(message)
    }

    return response.json()
  }

  // ==================== 认证接口 ====================

  async login(phone: string, password: string) {
    const data = await this.request<{
      access_token: string
      token_type: string
      user: {
        id: number
        email: string
        name: string
        department?: string
        position?: string
        role: string
      }
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    })
    
    this.setToken(data.access_token)
    return data
  }

  async register(data: { email: string; password: string; name: string; department?: string; position?: string }) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  logout() {
    this.setToken(null)
    localStorage.removeItem('user')
  }

  async getMe() {
    return this.request('/users/me')
  }

  // ==================== 用户管理接口 ====================

  async getUsers(params?: { department?: string; search?: string }): Promise<User[]> {
    const query = new URLSearchParams()
    if (params?.department) query.set('department', params.department)
    if (params?.search) query.set('search', params.search)

    const queryString = query.toString()
    return this.request<User[]>(`/users${queryString ? '?' + queryString : ''}`)
  }

  async getUser(id: number) {
    return this.request(`/users/${id}`)
  }

  async createUser(data: { 
    email: string
    password: string
    name: string
    department?: string
    position?: string
    phone?: string
    avatar?: string
  }) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateUser(id: number, data: { name?: string; department?: string; position?: string; phone?: string; avatar?: string }) {
    return this.request(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    return this.request('/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, current_password: currentPassword, new_password: newPassword }),
    })
  }

  async deleteUser(id: number) {
    return this.request(`/users/${id}`, { method: 'DELETE' })
  }

  // ==================== 机房管理接口 ====================

  async getRooms(params?: { room_type?: string; building?: string; is_active?: boolean }) {
    const query = new URLSearchParams()
    if (params?.room_type) query.set('room_type', params.room_type)
    if (params?.building) query.set('building', params.building)
    if (params?.is_active !== undefined) query.set('is_active', String(params.is_active))
    const queryString = query.toString()
    return this.request(`/rooms${queryString ? '?' + queryString : ''}`)
  }

  async createRoom(data: { building: string; floor: string; name: string; code: string; room_type: string; shift?: string }) {
    return this.request('/rooms', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateRoom(id: number, data: Record<string, unknown>) {
    return this.request(`/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteRoom(id: number) {
    return this.request(`/rooms/${id}`, { method: 'DELETE' })
  }

  async batchImportRooms(rooms: Array<{ building: string; floor: string; name: string; code: string; room_type: string; shift?: string }>) {
    return this.request('/rooms/batch', { method: 'POST', body: JSON.stringify({ rooms }) })
  }

  // 通用方法
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint)
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

export const api = new ApiService()
