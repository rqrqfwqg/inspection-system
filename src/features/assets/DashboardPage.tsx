import * as React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { getBaOverview, getStatsBySubsystemArea, getSubsystems } from './api'
import type { BaOverviewItem, StatRow, Subsystem } from './types'

interface DashboardPageProps {
  /** 子系统 code 过滤（来自子系统树点击） */
  subsystemFilter?: string
  onClearFilter?: () => void
}

const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777']

export function DashboardPage({ subsystemFilter, onClearFilter }: DashboardPageProps) {
  const { toast } = useToast()
  const [overview, setOverview] = React.useState<BaOverviewItem[]>([])
  const [statsRows, setStatsRows] = React.useState<StatRow[]>([])
  const [subsystems, setSubsystems] = React.useState<Subsystem[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([getBaOverview(), getStatsBySubsystemArea(), getSubsystems()])
      .then(([o, s, subs]) => {
        if (cancelled) return
        setOverview(o)
        setStatsRows(s.rows)
        setSubsystems(subs)
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            title: '加载概览数据失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const filteredRows = React.useMemo(() => {
    if (!subsystemFilter) return statsRows
    const names = subsystems.filter((s) => s.code === subsystemFilter).map((s) => s.name)
    return statsRows.filter((r) => r.subsystem === subsystemFilter || names.includes(r.subsystem))
  }, [statsRows, subsystemFilter, subsystems])

  const filteredOverview = React.useMemo(() => {
    if (!subsystemFilter) return overview
    return overview.filter((o) => o.subsystem_code === subsystemFilter)
  }, [overview, subsystemFilter])

  const totalAssets = filteredRows.reduce((acc, r) => acc + (r.count || 0), 0)
  const totalProblems = filteredOverview.reduce((acc, o) => acc + (o.problem || 0), 0)
  const totalNormal = filteredOverview.reduce((acc, o) => acc + (o.normal || 0), 0)

  const perSubsystem = React.useMemo(() => {
    const m = new Map<string, number>()
    filteredRows.forEach((r) => m.set(r.subsystem, (m.get(r.subsystem) || 0) + (r.count || 0)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [filteredRows])

  const rateData = filteredOverview.map((o) => ({
    name: o.ba_system,
    故障率: Number(o.problem_rate) || 0,
  }))

  const areas = [...new Set(filteredRows.map((r) => r.area))].sort()
  const subs = [...new Set(filteredRows.map((r) => r.subsystem))].sort()
  const stackedData = areas.map((area) => {
    const row: Record<string, number | string> = { area }
    subs.forEach((s) => {
      const c = filteredRows
        .filter((r) => r.area === area && r.subsystem === s)
        .reduce((acc, r) => acc + (r.count || 0), 0)
      row[s] = c
    })
    return row
  })

  const filterName = subsystemFilter
    ? subsystems.find((s) => s.code === subsystemFilter)?.name || subsystemFilter
    : ''

  if (loading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-gray-400">加载中…</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {subsystemFilter && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
          <span className="text-sm text-blue-700">已按「{filterName}」子系统过滤</span>
          <Button variant="outline" size="sm" onClick={onClearFilter}>
            清除过滤
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-500">总资产数</div>
            <div className="text-3xl font-bold text-gray-900 mt-1">{totalAssets.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-500">总故障问题数</div>
            <div className="text-3xl font-bold text-red-600 mt-1">{totalProblems.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">正常 {totalNormal.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-gray-500">各子系统设备数</div>
            <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
              {perSubsystem.length === 0 ? (
                <div className="text-sm text-gray-400">无</div>
              ) : (
                perSubsystem.map(([s, c]) => (
                  <div key={s} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate">{s}</span>
                    <Badge variant="outline">{c}</Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">BA 系统故障率</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rateData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="故障率" fill="#dc2626">
                  {rateData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">子系统 × 区域 设备计数</CardTitle>
          </CardHeader>
          <CardContent>
            {stackedData.length === 0 ? (
              <p className="text-sm text-gray-400 py-16 text-center">无数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stackedData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="area" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {subs.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
