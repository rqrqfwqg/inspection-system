export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user' | 'moderator'
  status: 'active' | 'inactive' | 'pending'
  avatar?: string
  createdAt: string
  lastLogin?: string
}

export interface DashboardStats {
  totalUsers: number
  activeUsers: number
  newUsersToday: number
  pendingUsers: number
}

export interface LoginCredentials {
  email: string
  password: string
}
