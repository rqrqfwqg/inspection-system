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

  // 验证 token 并获取用户信息
  const refreshUser = async () => {
    const token = localStorage.getItem('token')
    if (!token) {
      setUser(null)
      return
    }
    try {
      const fresh = await api.getMe() as User
      setUser(fresh)
      localStorage.setItem('user', JSON.stringify(fresh))
    } catch {
      // token 无效，清除
      api.setToken(null)
      localStorage.removeItem('user')
      setUser(null)
    }
  }

  useEffect(() => {
    const init = async () => {
      const token = localStorage.getItem('token')
      if (token) {
        // 有 token 时才尝试获取用户信息
        const storedUser = localStorage.getItem('user')
        if (storedUser) {
          try { setUser(JSON.parse(storedUser)) } catch { /* ignore */ }
        }
        await refreshUser()
      }
      setIsLoading(false)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const logout = () => {
    api.logout()
    localStorage.removeItem('user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated: user !== null,
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
