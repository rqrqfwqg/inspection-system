import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Building2, Cpu, DoorOpen, LayoutGrid, MapPinned } from 'lucide-react'
import type { AreaStats } from './types'

const PALETTE = [
  '#2563eb', '#0891b2', '#7c3aed', '#dc2626',
  '#ea580c', '#16a34a', '#ca8a04', '#db2777',
]

interface Props {
  stats: AreaStats | null
  loading: boolean
  /** 点击楼栋图例/机房类型时联动筛选 */
  onPickBuilding?: (building: string) => void
}

function Metric({
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warn'
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {icon}
          <span>{label}</span>
        </div>
        <div
          className={`mt-1 text-xl font-bold ${
            tone === 'warn' ? 'text-amber-600' : 'text-gray-900'
          }`}
        >
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-gray-400 leading-tight">{hint}</div>}
      </CardContent>
    </Card>
  )
}

/**
 * 区域多维可视化：楼栋×楼层设备矩阵、子系统分布、机房类型分布、机房 TOP、覆盖率。
 * 所有计数口径与区域树一致（真实房间归属），fuzzy 归属单独以「待核实」呈现。
 */
export default function AreaStatsPanel({ stats, loading, onPickBuilding }: Props) {
  if (loading && !stats) {
    return <p className="text-sm text-gray-400 py-8 text-center">统计加载中…</p>
  }
  if (!stats) return null

  const s = stats.summary
  const coverage = s.room_count ? Math.round((s.rooms_with_devices / s.room_count) * 100) : 0
  const devCoverage = s.devices_total
    ? Math.round((s.devices_mapped / s.devices_total) * 100)
    : 0
  const mappedRate = s.devices_total
    ? ((s.devices_mapped / s.devices_total) * 100).toFixed(1)
    : '0'

  // 楼栋 × 楼层 堆叠（各楼层作为系列）
  const floorKeys = Array.from(
    new Set(stats.buildings.flatMap((b) => b.floors.map((f) => f.floor)))
  )
  const bldRows = stats.buildings.map((b) => {
    const row: Record<string, string | number> = { building: b.building }
    floorKeys.forEach((f) => {
      row[f] = b.floors.find((x) => x.floor === f)?.device_count ?? 0
    })
    return row
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric icon={<Building2 className="w-3.5 h-3.5" />} label="楼栋" value={s.building_count} />
        <Metric icon={<LayoutGrid className="w-3.5 h-3.5" />} label="楼层" value={s.floor_count} />
        <Metric
          icon={<DoorOpen className="w-3.5 h-3.5" />}
          label="机房"
          value={s.room_count}
          hint={`已挂设备 ${s.rooms_with_devices} 间（${coverage}%）`}
        />
        <Metric
          icon={<Cpu className="w-3.5 h-3.5" />}
          label="已归属设备"
          value={s.devices_mapped}
          hint={`全库 ${s.devices_total}（${mappedRate}%）`}
        />
        <Metric
          icon={<MapPinned className="w-3.5 h-3.5" />}
          label="机房台账"
          value={s.rooms_with_self_record ?? 0}
          hint="有本体档案的机房"
        />
        <Metric
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label="固定资产待核实归属"
          value={s.asset_pending}
          hint="模糊匹配仅到标段级，未计入机房"
          tone="warn"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">楼栋 × 楼层 设备分布</CardTitle>
          </CardHeader>
          <CardContent>
            {bldRows.length === 0 ? (
              <p className="text-sm text-gray-400 py-16 text-center">无数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={bldRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="building" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {floorKeys.map((f, i) => (
                    <Bar key={f} dataKey={f} stackId="a" fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">子系统分布（已归属设备）</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.subsystems.length === 0 ? (
              <p className="text-sm text-gray-400 py-16 text-center">无数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.subsystems} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={82} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="设备数">
                    {stats.subsystems.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-base">机房类型分布（按设备数）</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.room_families.length === 0 ? (
              <p className="text-sm text-gray-400 py-12 text-center">无数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.room_families.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} height={50} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="device_count" name="设备数" fill="#2563eb" />
                  <Bar dataKey="room_count" name="机房数" fill="#94a3b8" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">设备归属覆盖率</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: '机房已挂设备', pct: coverage, hint: `${s.rooms_with_devices} / ${s.room_count} 间` },
              { label: '设备已定位机房', pct: devCoverage, hint: `${s.devices_mapped} / ${s.devices_total} 台` },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{row.label}</span>
                  <span className="font-semibold text-gray-900">{row.pct}%</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${row.pct}%` }} />
                </div>
                <div className="mt-1 text-xs text-gray-400">{row.hint}</div>
              </div>
            ))}
            <div className="border-t pt-3">
              <div className="text-sm text-gray-700 mb-2">设备数 TOP 机房</div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {stats.top_rooms.slice(0, 8).map((r) => (
                  <div key={r.room_code} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 truncate" title={r.label}>
                      {r.label}
                    </span>
                    <Badge variant="outline" className="ml-2 shrink-0">
                      {r.count}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {onPickBuilding && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span>按楼栋筛选：</span>
          {stats.buildings.map((b) => (
            <button
              key={b.building}
              onClick={() => onPickBuilding(b.building)}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-700"
            >
              {b.building}（{b.device_count}）
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
