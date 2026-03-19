import { useAuth } from '@/contexts/AuthContext'

export default function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">数据看板</h1>
        <p className="text-gray-500 mt-1">
          欢迎回来，{user?.name}
          {user?.department && <span className="ml-1 text-blue-500">· {user.department}</span>}
        </p>
      </div>
    </div>
  )
}
