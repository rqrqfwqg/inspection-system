import * as React from 'react'
import { BarChart3, Boxes, ChevronDown, ChevronUp, Cpu, MapPin, RefreshCw, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { getAreaStats } from './api'
import AreaTreeView from './AreaTreeView'
import AreaStatsPanel from './AreaStatsPanel'
import type { AreaNode, AreaStats } from './types'

interface AreaTreePageProps {
  /** 点击设备节点时打开详情抽屉 */
  onOpenDevice: (code: string) => void
}

/**
 * 区域总览：楼栋 → 楼层 → 机房（名称（房间号））→ 设备 四级下钻，
 * 顶部为基于同一口径的多维可视化（楼栋×楼层 / 子系统 / 机房类型 / 覆盖率）。
 */
export function AreaTreePage({ onOpenDevice }: AreaTreePageProps) {
  const { toast } = useToast()
  const [input, setInput] = React.useState('')
  const [keyword, setKeyword] = React.useState('')
  const [onlyWithDevices, setOnlyWithDevices] = React.useState(false)
  const [building, setBuilding] = React.useState<string | undefined>(undefined)
  const [showStats, setShowStats] = React.useState(true)
  const [refreshToken, setRefreshToken] = React.useState(0)

  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [rangeTitle, setRangeTitle] = React.useState('')
  const [rangeDevices, setRangeDevices] = React.useState<AreaNode[]>([])
  const [rangeNote, setRangeNote] = React.useState('')

  const [stats, setStats] = React.useState<AreaStats | null>(null)
  const [statsLoading, setStatsLoading] = React.useState(true)

  const onError = React.useCallback(
    (msg: string) => toast({ title: msg, variant: 'destructive' }),
    [toast]
  )

  /* 搜索防抖：真实台账设备名/编号由后端过滤，避免前端全量拉取 */
  React.useEffect(() => {
    const t = setTimeout(() => setKeyword(input.trim()), 300)
    return () => clearTimeout(t)
  }, [input])

  const loadStats = React.useCallback(async () => {
    setStatsLoading(true)
    try {
      setStats(await getAreaStats(building))
    } catch (e) {
      toast({
        title: '统计加载失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setStatsLoading(false)
    }
  }, [building, toast])

  React.useEffect(() => {
    void loadStats()
  }, [loadStats])

  const handleSelectRange = React.useCallback((node: AreaNode, devices: AreaNode[]) => {
    setSelectedKey(node.key)
    setRangeTitle(node.label)
    setRangeDevices(devices)
    if (node.type === 'room') {
      const self = node.meta?.self_record
      setRangeNote(self ? `机房本体档案：${self}` : '')
    } else {
      const rooms = new Set(devices.map((d) => String(d.meta?.room_code ?? '')))
      setRangeNote(`覆盖 ${rooms.size} 间机房`)
    }
  }, [])

  const handleSelectOther = React.useCallback((node: AreaNode) => {
    setSelectedKey(node.key)
    if (node.type === 'building') {
      setRangeTitle(node.label)
      setRangeDevices([])
      const pending = Number(node.meta?.asset_pending ?? 0)
      setRangeNote(
        `${Number(node.meta?.room_count ?? 0)} 间机房 / ${Number(node.meta?.floor_count ?? 0)} 个楼层` +
          (pending ? ` · 固定资产待核实归属 ${pending}` : '')
      )
    }
  }, [])

  const reset = () => {
    setInput('')
    setKeyword('')
    setOnlyWithDevices(false)
    setBuilding(undefined)
    setSelectedKey(null)
    setRangeTitle('')
    setRangeDevices([])
    setRangeNote('')
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="搜索机房或设备：名称 / 编号，如 空调机房 / KTJF-101 / PDF-107"
              className="pl-9"
            />
          </div>
          <Button
            variant={onlyWithDevices ? 'default' : 'outline'}
            size="sm"
            onClick={() => setOnlyWithDevices((v) => !v)}
          >
            仅有设备的机房
          </Button>
          <Button variant="outline" size="sm" onClick={reset}>
            重置
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRefreshToken((v) => v + 1)}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowStats((v) => !v)}>
            <BarChart3 className="w-4 h-4 mr-1" />
            {showStats ? '收起可视化' : '展开可视化'}
            {showStats ? (
              <ChevronUp className="w-4 h-4 ml-1" />
            ) : (
              <ChevronDown className="w-4 h-4 ml-1" />
            )}
          </Button>
        </CardContent>
      </Card>

      {showStats && (
        <AreaStatsPanel
          stats={stats}
          loading={statsLoading}
          onPickBuilding={(b) => {
            setBuilding((prev) => (prev === b ? undefined : b))
            setRefreshToken((v) => v + 1)
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              区域树（楼栋 → 楼层 → 机房 → 设备）
              {building && (
                <Badge variant="outline" className="ml-1">
                  {building}
                  <button className="ml-1 text-gray-400" onClick={() => setBuilding(undefined)}>
                    ×
                  </button>
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AreaTreeView
              keyword={keyword}
              onlyWithDevices={onlyWithDevices}
              building={building}
              selectedKey={selectedKey}
              refreshToken={refreshToken}
              onSelectRange={handleSelectRange}
              onSelectOther={handleSelectOther}
              onOpenDevice={onOpenDevice}
              onError={onError}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Boxes className="w-4 h-4" />
              范围内设备
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!rangeTitle ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                点选左侧楼栋 / 楼层 / 机房以查看其范围内设备
              </p>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-800 break-all">{rangeTitle}</div>
                <div className="text-xs text-gray-500">
                  {rangeDevices.length} 台{rangeNote ? ` · ${rangeNote}` : ''}
                </div>
                <div className="max-h-[60vh] overflow-y-auto space-y-1">
                  {rangeDevices.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">该范围内暂无已归属设备</p>
                  ) : (
                    rangeDevices.map((d) => (
                      <button
                        key={d.key}
                        onClick={() => onOpenDevice(String(d.meta?.device_code ?? ''))}
                        className="w-full text-left rounded px-2 py-1.5 hover:bg-blue-50 flex items-center gap-2"
                      >
                        <Cpu className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="flex-1 text-sm text-blue-700 truncate">{d.label}</span>
                        {d.meta?.subsystem_name ? (
                          <Badge variant="outline" className="text-xs shrink-0">
                            {String(d.meta.subsystem_name)}
                          </Badge>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
