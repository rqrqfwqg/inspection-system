import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '@/services/api'

export interface User {
  id: number
  email: string
  name: string
  department?: string
  position?: string
  phone?: string
  avatar?: string
  role: string
}

// 默认系统用户（无需登录时使用）
const DEFAULT_USER: User = {
  id: 1,
  email: 'admin@system.local',
  name: '系统管理员',
  role: 'admin',
}

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  login: (phone: string, password: string) => Promise<boolean>
  logout: () => void
  user: User | null
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  // 启动时尝试从后端获取真实用户信息，失败则使用默认用户
  const refreshUser = async () => {
    try {
      const fresh = await api.getMe() as User
      setUser(fresh)
      localStorage.setItem('user', JSON.stringify(fresh))
    } catch {
      // 无 token 或 token 失效时，使用默认系统用户
      setUser(DEFAULT_USER)
    }
  }

  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser))
      } catch {
        setUser(DEFAULT_USER)
      }
    } else {
      setUser(DEFAULT_USER)
    }
    setIsLoading(false)
    // 尝试静默刷新一次（有 token 时获取最新信息）
    refreshUser()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 保留 login 方法（SettingsPage 等地方可能调用）
  const login = async (phone: string, password: string): Promise<boolean> => {
    try {
      const data = await api.login(phone, password)
      setUser(data.user as User)
      localStorage.setItem('user', JSON.stringify(data.user))
      return true
    } catch (error) {
      console.error('登录失败:', error)
      return false
    }
  }

  // 退出登录：清除 token 但保持默认用户，不跳转
  const logout = () => {
    api.logout()
    localStorage.removeItem('user')
    setUser(DEFAULT_USER)
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated: true,  // 始终已认证
      isLoading,
      login,
      logout,
      user: user ?? DEFAULT_USER,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
