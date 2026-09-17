/**
 * 用户 / 认证 / 机房 域模型
 * =====================================================================
 * 契约来源（以后端为准，**不是** React 版 `src/types/index.ts` 的陈旧形状）：
 *   `backend/schemas.py`
 *     UserBase     email / name / department? / position? / phone? / avatar?
 *     UserResponse id:int / role:str / is_active:bool / created_at:datetime
 *     UserUpdate   name? / department? / position? / phone? / avatar?
 *
 * 【迁移修正】React 版写的是 `id: string` + `status:'active'|...` + `createdAt:string`
 * —— 与后端不符（后端是 `id:int` / `is_active:bool` / `created_at`）。若照抄，
 * 「用户管理」页的主键类型与状态列会静默错位。此处按真实契约建模。
 */

/** 用户（GET /users、POST /auth/register、PUT /users/{id} 的统一响应体） */
export interface User {
  id: number
  email: string
  name: string
  department?: string | null
  position?: string | null
  phone?: string | null
  avatar?: string | null
  /** 后端为字符串（admin / user / moderator…）；不做字面量联合，避免与后端新增角色脱节 */
  role: string
  is_active: boolean
  created_at: string
}

/** POST /auth/login 响应 */
export interface LoginResult {
  access_token: string
  token_type: string
  user: User
}

/** 机房（GET /ops/api/rooms —— main.py 的 /rooms，不是 /assets/rooms） */
export interface Room {
  id: number
  building: string
  floor: string
  name: string
  code: string
  room_type?: string | null
  shift?: string | null
  is_active?: boolean
}

/** 概览统计（前端派生，无对应后端端点） */
export interface DashboardStats {
  totalUsers: number
  activeUsers: number
  newUsersToday: number
  pendingUsers: number
}

/** 部门列表（用户资料、系统设置等处共用；来源 React 版 `src/lib/constants.ts`） */
export const DEPARTMENTS = ['南区', 'T3GTC', '东区', '西区', '公共区', 'AOC'] as const
