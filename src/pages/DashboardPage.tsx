import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { Boxes, Building2, AlertTriangle, Wallet } from 'lucide-react'
import { api } from '@/services/api'
import { assetApi } from '@/services/assetApi'
import { PageTitleSkeleton, StatCardsSkeleton } from '@/components/ui/skeleton'

/** 金额格式化：按量级自动切换 亿 / 万 */
function formatAmount(v: number) {
  if (!v) return '0'
  if (v >= 1e8) return `¥${(v / 1e8).toFixed(2)} 亿`
  if (v >= 1e4) return `¥${(v / 1e4).toFixed(1)} 万`
  return `¥${v.toLocaleString()}`
}

const EMPTY_STATS = {
  total: 0,
  registered: 0,
  ledgerOnly: 0,
  withAsset: 0,
  amountTotal: 0,
  warrantySoon: 0,
  warrantyExpired: 0,
  rooms: 0,
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(EMPTY_STATS)

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [summary, roomData] = await Promise.all([
          assetApi.getAssetLedgerSummary().catch(() => null),
          api.getRooms().catch(() => []),
        ])
        setStats({
          total: summary?.total ?? 0,
          registered: summary?.registered ?? 0,
          ledgerOnly: summary?.ledger_only ?? 0,
          withAsset: summary?.with_asset ?? 0,
          amountTotal: summary?.amount_total ?? 0,
          warrantySoon: summary?.warranty_soon ?? 0,
          warrantyExpired: summary?.warranty_expired ?? 0,
          rooms: Array.isArray(roomData) ? roomData.length : 0,
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
    {
      label: '资产总数',
      value: stats.total.toLocaleString(),
      hint: `已登记 ${stats.registered.toLocaleString()} · 仅台账 ${stats.ledgerOnly.toLocaleString()}`,
      icon: Boxes,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: '机房总数',
      value: stats.rooms.toLocaleString(),
      hint: '已建档机房',
      icon: Building2,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: '保修已过期',
      value: stats.warrantyExpired.toLocaleString(),
      hint: `即将到期 ${stats.warrantySoon.toLocaleString()} 项`,
      icon: AlertTriangle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: '含税资产总值',
      value: formatAmount(stats.amountTotal),
      hint: `固定资产 ${stats.withAsset.toLocaleString()} 项`,
      icon: Wallet,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
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
                <div className="min-w-0">
                  <p className="text-sm text-gray-500">{item.label}</p>
                  <p className={`text-3xl font-bold mt-1 ${item.color}`}>{item.value}</p>
                  <p className="text-xs text-gray-400 mt-1 truncate">{item.hint}</p>
                </div>
                <div className={`p-3 rounded-full flex-shrink-0 ${item.bg}`}>
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
