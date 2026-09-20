/**
 * 用户 / 认证 / 机房 API
 * =====================================================================
 * 来源：React 版 `src/services/api.ts` 的认证段 + 用户管理段 + 机房管理段，等价迁移。
 *
 * 【契约修正（原 React 版残留缺陷）】
 *   后端 `backend/schemas.py:21 UserResponse` 的真实字段是
 *     id:int / email / name / department? / position? / phone? / avatar? / role:str / is_active:bool / created_at:datetime
 *   而 React 版 `src/types/index.ts` 的 `User` 写的是
 *     id:string / status:'active'|... / createdAt:string（**与后端不符的陈旧 mock 形状**）。
 *   本迁移按后端真实契约建模（见 `@/types/user`），不做向后兼容的假字段。
 *
 * 登录：生产 `DISABLE_AUTH=true`，启动即进入系统；token 走 localStorage['token']。
 */
import http from './http'
import type { User, LoginResult, Room } from '@/types/user'

// ==================== 认证 ====================

export function login(phone: string, password: string) {
  return http.post<LoginResult>('/auth/login', { phone, password })
}

/** 手机号免密直登（2026-09-20 用户决策：取消账号密码，工器通同款；FAST_LOGIN=true 时后端启用） */
export function fastLogin(phone: string) {
  return http.post<LoginResult>('/auth/fast-login', { phone })
}

export function register(data: {
  email: string
  password: string
  name: string
  department?: string
  position?: string
}) {
  return http.post<User>('/auth/register', data)
}

export function getMe() {
  return http.get<User>('/users/me')
}

/** 清空本地登录态（React 版 `api.logout()` 等价） */
export function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

// ==================== 用户管理 ====================

export function getUsers(params?: { department?: string; search?: string }): Promise<User[]> {
  return http.get<User[]>('/users', {
    department: params?.department,
    search: params?.search,
  })
}

export function getUser(id: number) {
  return http.get<User>(`/users/${id}`)
}

export function createUser(data: {
  email: string
  password: string
  name: string
  department?: string
  position?: string
  phone?: string
  avatar?: string
}) {
  return http.post<User>('/auth/register', data)
}

export function updateUser(
  id: number,
  data: { name?: string; department?: string; position?: string; phone?: string; avatar?: string },
) {
  return http.put<User>(`/users/${id}`, data)
}

export function changePassword(userId: number, currentPassword: string, newPassword: string) {
  return http.post<{ success: boolean; message: string }>('/users/change-password', {
    user_id: userId,
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export function deleteUser(id: number) {
  return http.delete<{ success: boolean; message: string }>(`/users/${id}`)
}

// ==================== 机房 ====================

export function getRooms(params?: {
  room_type?: string
  building?: string
  is_active?: boolean
}): Promise<Room[]> {
  return http.get<Room[]>('/rooms', {
    room_type: params?.room_type,
    building: params?.building,
    is_active: params?.is_active === undefined ? undefined : String(params.is_active),
  })
}

export function createRoom(data: {
  building: string
  floor: string
  name: string
  code: string
  room_type: string
  shift?: string
}) {
  return http.post<Room>('/rooms', data)
}

export function updateRoom(id: number, data: Record<string, unknown>) {
  return http.put<Room>(`/rooms/${id}`, data)
}

export function deleteRoom(id: number) {
  return http.delete<{ success: boolean; message: string }>(`/rooms/${id}`)
}

export function batchImportRooms(
  rooms: Array<{
    building: string
    floor: string
    name: string
    code: string
    room_type: string
    shift?: string
  }>,
) {
  return http.post<{ success: boolean; created: number }>('/rooms/batch', { rooms })
}
