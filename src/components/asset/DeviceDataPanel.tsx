import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Boxes,
  Zap,
  Network,
  Layers,
  MapPin,
  Tag,
  Camera,
  Database,
  HardDrive,
  ArrowRight,
  ArrowLeft,
  Link2,
} from 'lucide-react'
import type { SearchResult, Subsystem } from '@/types/asset'
import { SubsystemCard, ChainChips } from '@/components/asset/DevicePanelParts'

interface Props {
  result: SearchResult
  subsystems: Subsystem[]
  onPickDevice: (code: string) => void
  onOpenSubsystem: (code: string) => void
}


export default function DeviceDataPanel({ result, subsystems, onPickDevice, onOpenSubsystem }: Props) {
  const prof = result.profile
  if (!prof) return null

  const byCode = new Map<string, { count: number; tables: string[] }>()
  result.groups.forEach((g) => {
    const key = g.subsystem_code || '__none__'
    const count = g.tables.reduce((s, t) => s + t.records.length, 0)
    const cur = byCode.get(key) || { count: 0, tables: [] }
    cur.count += count
    g.tables.forEach((t) => {
      if (!cur.tables.includes(t.table_name)) cur.tables.push(t.table_name)
    })
    byCode.set(key, cur)
  })

  const start = result.power_chain?.start_code || prof.device_code
  const relationOf = (code: string) => {
    const e = result.edges.find(
      (x) => (x.from === start && x.to === code) || (x.to === start && x.from === code)
    )
    return e?.type || null
  }
  const related = result.nodes.filter((n) => n.device_code !== start)
  const up = result.power_chain?.upstream || []
  const down = result.power_chain?.downstream || []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <Card className="lg:col-span-1">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                <Boxes className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-gray-900 truncate">
                  {prof.name || prof.device_code}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 break-all">{prof.device_code}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {prof.subsystem_name && <Badge variant="secondary">{prof.subsystem_name}</Badge>}
              {prof.in_ledger ? (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Database className="w-3 h-3" />
                  已登记台账
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 font-normal">
                  <HardDrive className="w-3 h-3" />
                  现场台账
                </Badge>
              )}
              {!prof.tag_no && (
                <Badge variant="outline" className="gap-1 font-normal text-amber-700 border-amber-300">
                  <Tag className="w-3 h-3" />
                  标签号待补录
                </Badge>
              )}
            </div>

            <div className="mt-4 space-y-1.5 text-xs text-gray-600">
              {(prof.building || prof.floor) && (
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  {[prof.building, prof.floor].filter(Boolean).join(' · ')}
                </div>
              )}
              {prof.location && <div className="pl-5">位置：{prof.location}</div>}
              {prof.room?.room_name && (
                <div className="pl-5">
                  所在机房：{prof.room.room_name}
                  {prof.room.room_code ? `（${prof.room.room_code}）` : ''}
                </div>
              )}
              {prof.tag_no && <div className="pl-5">标签号：{prof.tag_no}</div>}
              <div className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-gray-400" />
                现场照片 {prof.photo_count} 张
              </div>
              {prof.source_tables.length > 0 && (
                <div className="pl-5 text-gray-500">资料表：{prof.source_tables.join(' / ')}</div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <div className="bg-gray-50 rounded-md py-2">
                <div className="text-lg font-semibold text-gray-900">{prof.related_count}</div>
                <div className="text-xs text-gray-500">关联设备</div>
              </div>
              <div className="bg-gray-50 rounded-md py-2">
                <div className="text-lg font-semibold text-gray-900">{prof.record_count}</div>
                <div className="text-xs text-gray-500">资料条数</div>
              </div>
              <div className="bg-gray-50 rounded-md py-2">
                <div className="text-lg font-semibold text-gray-900">{prof.subsystem_count}</div>
                <div className="text-xs text-gray-500">涉及系统</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <Layers className="w-4 h-4 text-gray-500" />
              <CardTitle className="text-base">子系统档案</CardTitle>
              <span className="text-xs text-gray-500">点击有资料的系统可跳转到明细</span>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {subsystems.map((s) => {
                  const hit = byCode.get(s.code)
                  return (
                    <SubsystemCard
                      key={s.id}
                      name={s.name}
                      count={hit?.count || 0}
                      tables={hit?.tables || []}
                      onClick={() => onOpenSubsystem(s.code)}
                    />
                  )
                })}
                {byCode.has('__none__') && (
                  <SubsystemCard
                    name="未归类"
                    count={byCode.get('__none__')!.count}
                    tables={byCode.get('__none__')!.tables}
                    onClick={() => onOpenSubsystem('__none__')}
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <Zap className="w-4 h-4 text-gray-500" />
              <CardTitle className="text-base">供电 / 冷源链路</CardTitle>
              <span className="text-xs text-gray-500">沿「供电、供配电、上级配电、取电、冷源」关系追溯</span>
            </CardHeader>
            <CardContent>
              {up.length === 0 && down.length === 0 ? (
                <p className="text-sm text-gray-500">
                  未建立供电关系。可在手机扫码页现场补建「上级配电 / 取电」关系后再查看。
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="flex items-center gap-1 text-xs text-gray-500 w-16 shrink-0 pt-1">
                      <ArrowLeft className="w-3.5 h-3.5" />
                      上游
                    </span>
                    <ChainChips items={up} tone="up" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0" />
                    <span className="px-2.5 py-1 rounded-md text-xs bg-blue-50 text-blue-700 font-medium">
                      {prof.name || prof.device_code}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="flex items-center gap-1 text-xs text-gray-500 w-16 shrink-0 pt-1">
                      <ArrowRight className="w-3.5 h-3.5" />
                      下游
                    </span>
                    <ChainChips items={down} tone="down" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Network className="w-4 h-4 text-gray-500" />
          <CardTitle className="text-base">关联设备</CardTitle>
          <span className="text-xs text-gray-500">点击可切换到该设备继续追溯</span>
        </CardHeader>
        <CardContent className="p-0">
          {related.length === 0 ? (
            <p className="text-sm text-gray-500 px-6 pb-6">该设备暂无关联设备。</p>
          ) : (
            <div className="divide-y divide-border">
              {related.map((n) => (
                <button
                  key={n.device_code}
                  type="button"
                  onClick={() => onPickDevice(n.device_code)}
                  className="w-full flex items-center justify-between gap-3 px-6 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {n.name || n.device_code}
                    </span>
                    {n.name && n.name !== n.device_code && (
                      <span className="text-xs text-gray-500 truncate">{n.device_code}</span>
                    )}
                    {n.subsystem_name && <Badge variant="outline">{n.subsystem_name}</Badge>}
                  </span>
                  <span className="flex items-center gap-3 shrink-0 text-xs text-gray-500">
                    {relationOf(n.device_code) && (
                      <span className="flex items-center gap-1">
                        <Link2 className="w-3.5 h-3.5" />
                        {relationOf(n.device_code)}
                      </span>
                    )}
                    <span>{n.depth} 跳</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
