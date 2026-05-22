import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { CalendarCheck, Building2, ClipboardList, Users } from 'lucide-react'
import { api } from '@/services/api'
import { PageTitleSkeleton, StatCardsSkeleton } from '@/components/ui/skeleton'

export default function DashboardPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ todayInspections: 0, rooms: 0, plans: 0, staff: 0 })

  useEffect(() => {
    const loadStats = async () => {
      try {
        const today = new Date().toISOString().split('T')[0]
        const [dutyData, roomData] = await Promise.all([
          api.getDutySchedules({ date: today }).catch(() => []),
          api.getRooms().catch(() => []),
        ])
        setStats({
          todayInspections: Array.isArray(dutyData) ? dutyData.length : 0,
          rooms: Array.isArray(roomData) ? roomData.length : 0,
          plans: 0,
          staff: Array.isArray(dutyData) ? new Set(dutyData.map((d: any) => d.staff_name)).size : 0,
        })
      } catch {
        // 数据看板统计数据加载失败不影响页面展示
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <PageTitleSkeleton />
        <StatCardsSkeleton count={4} />
      </div>
    )
  }

  const statCards = [
    { label: '今日在岗', value: stats.todayInspections, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: '机房总数', value: stats.rooms, icon: Building2, color: 'text-green-600', bg: 'bg-green-50' },
    { label: '巡查计划', value: stats.plans, icon: ClipboardList, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: '当班人员', value: stats.staff, icon: CalendarCheck, color: 'text-orange-600', bg: 'bg-orange-50' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">数据看板</h1>
        <p className="text-gray-500 mt-1">
          欢迎回来，{user?.name}
          {user?.department && <span className="ml-1 text-blue-500">· {user.department}</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((item) => (
          <Card key={item.label}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{item.label}</p>
                  <p className={`text-3xl font-bold mt-1 ${item.color}`}>{item.value}</p>
                </div>
                <div className={`p-3 rounded-full ${item.bg}`}>
                  <item.icon className={`w-6 h-6 ${item.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
