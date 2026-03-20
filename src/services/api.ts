// 环境变量配置，未设置时默认本地开发环境
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5001/api'

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

    // 不再发送 Authorization 头,彻底取消登录验证
    // if (this.token) {
    //   headers['Authorization'] = `Bearer ${this.token}`
    // }

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

  // ==================== 排班管理接口 ====================

  async getDutySchedules(params?: { date?: string; department?: string; shift_type?: string }) {
    const query = new URLSearchParams()
    if (params?.date) query.set('date', params.date)
    if (params?.department) query.set('department', params.department)
    if (params?.shift_type) query.set('shift_type', params.shift_type)
    
    const queryString = query.toString()
    return this.request(`/duty-schedules${queryString ? '?' + queryString : ''}`)
  }

  async createDutySchedule(data: {
    staff_id: number
    staff_name: string
    department: string
    position: string
    shift_type: string
    date: string
    start_time: string
    end_time: string
    status?: string
  }) {
    return this.request('/duty-schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async createDutySchedulesBatch(schedules: Array<{
    staff_id: number
    staff_name: string
    department: string
    position: string
    shift_type: string
    date: string
    start_time: string
    end_time: string
    status?: string
  }>) {
    return this.request('/duty-schedules/batch', {
      method: 'POST',
      body: JSON.stringify({ schedules }),
    })
  }

  async updateDutySchedule(id: number, data: Record<string, unknown>) {
    return this.request(`/duty-schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteDutySchedule(id: number) {
    return this.request(`/duty-schedules/${id}`, { method: 'DELETE' })
  }

  // ==================== 交接班任务接口 ====================

  async getShiftTasks(params?: { date?: string; shift?: string; completed?: boolean; department?: string }) {
    const query = new URLSearchParams()
    if (params?.date) query.set('date', params.date)
    if (params?.shift) query.set('shift', params.shift)
    if (params?.completed !== undefined) query.set('completed', String(params.completed))
    if (params?.department) query.set('department', params.department)
    
    const queryString = query.toString()
    return this.request(`/shift-tasks${queryString ? '?' + queryString : ''}`)
  }

  async createShiftTask(data: {
    title: string
    content?: string
    shift: string
    date: string
    department?: string
    priority?: string
    notes?: string
  }) {
    return this.request('/shift-tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateShiftTask(id: number, data: Record<string, unknown>) {
    return this.request(`/shift-tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteShiftTask(id: number) {
    return this.request(`/shift-tasks/${id}`, { method: 'DELETE' })
  }

  async handoverShiftTask(taskId: number, nextShift: string, nextDate: string) {
    return this.request('/shift-tasks/handover', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId, next_shift: nextShift, next_date: nextDate }),
    })
  }

  async uploadShiftImage(taskId: number, file: File): Promise<{ success: boolean; image_url: string; images: string[] }> {
    const formData = new FormData()
    formData.append('file', file)
    // 不再发送 Authorization 头
    // const headers: Record<string, string> = {}
    // if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    const response = await fetch(`${API_BASE_URL}/shift-tasks/${taskId}/upload-image`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: '上传失败' }))
      throw new Error(error.detail || '上传失败')
    }
    return response.json()
  }

  async deleteShiftImage(taskId: number, imageUrl: string) {
    const query = new URLSearchParams({ image_url: imageUrl })
    return this.request(`/shift-tasks/${taskId}/images?${query.toString()}`, { method: 'DELETE' })
  }

  // ==================== 统计接口 ====================

  async getDashboardStats() {
    return this.request('/stats/dashboard')
  }

  // ==================== 巡查计划接口 ====================

  async getCurrentInspectionPlan() {
    return this.request('/inspection-plans/current')
  }

  async getInspectionPlanByYearMonth(year: number, month: number) {
    return this.request(`/inspection-plans/by-year-month?year=${year}&month=${month}`)
  }

  // 获取计划列表（概要）- 懒加载用
  async getInspectionPlanList(year: number, month: number) {
    return this.request(`/inspection-plans/list?year=${year}&month=${month}`)
  }

  // 获取某天计划详情
  async getInspectionPlanDayDetail(planId: number, date: string) {
    return this.request(`/inspection-plans/${planId}/day/${date}`)
  }

  async getInspectionPlans(params?: { skip?: number; limit?: number }) {
    const query = new URLSearchParams()
    if (params?.skip !== undefined) query.set('skip', String(params.skip))
    if (params?.limit !== undefined) query.set('limit', String(params.limit))
    const queryString = query.toString()
    return this.request(`/inspection-plans${queryString ? '?' + queryString : ''}`)
  }

  async createInspectionPlan(data: { name: string; year: number; month: number; data: string }) {
    return this.request('/inspection-plans', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateInspectionPlan(id: number, data: { name?: string; data?: string }) {
    return this.request(`/inspection-plans/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  async deleteInspectionPlan(id: number) {
    return this.request(`/inspection-plans/${id}`, { method: 'DELETE' })
  }

  async generateInspectionPlan(year: number, month: number, overwrite = false, ruleId?: number) {
    return this.request('/inspection-plans/generate', {
      method: 'POST',
      body: JSON.stringify({ year, month, overwrite, rule_id: ruleId ?? null }),
    })
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

  // ==================== 巡查规则接口 ====================

  async getInspectionRules() {
    return this.request('/inspection-rules')
  }

  async getActiveInspectionRule() {
    return this.request('/inspection-rules/active')
  }

  async createInspectionRule(data: { name: string; high_freq_days: number; low_freq_times: number; is_active?: boolean }) {
    return this.request('/inspection-rules', { method: 'POST', body: JSON.stringify(data) })
  }

  async updateInspectionRule(id: number, data: { name?: string; high_freq_days?: number; low_freq_times?: number; is_active?: boolean }) {
    return this.request(`/inspection-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }

  // 通用方法
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint)
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

export const api = new ApiService()
