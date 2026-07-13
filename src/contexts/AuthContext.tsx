import { createContext, useContext, useState, ReactNode } from 'react'

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
  // 取消登录（内网开放）：启动即视为已登录 admin，不再读 localStorage token / 不再调 getMe
  const [user] = useState<User | null>({
    id: 0,
    email: 'admin@system.local',
    name: '系统管理员',
    department: '系统',
    role: 'admin',
  })
  const isLoading = false
  const isAuthenticated = true

  // 保留签名兼容旧调用；实际不再跳转、不再请求后端
  const login = async (_phone: string, _password: string): Promise<boolean> => {
    return true
  }

  const logout = () => {
    // 取消登录：无操作
  }

  const refreshUser = async () => {
    // 取消登录：无需刷新（保留签名兼容）
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      isLoading,
      login,
      logout,
      user,
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
