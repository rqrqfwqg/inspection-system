import * as React from 'react'
import { useParams, Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { scanSearchDevice, scanRooms } from '@/features/scan/api'
import type { ScanRoom, ScanSearchResult } from '@/features/scan/types'
import { DeviceLocationForm } from '@/components/scan/DeviceLocationForm'
import { DevicePhotoPanel } from '@/components/scan/DevicePhotoPanel'
import { DeviceRelationPanel, relationKindBadge } from '@/components/scan/DeviceRelationPanel'
import { cn } from '@/lib/utils'
import { QrCode, FileText, Boxes, MapPin, Network } from 'lucide-react'

/**
 * /ops/qr/:code —— 现场扫码直达页（P0）。
 * 二维码内容 = https://<origin>/ops/qr/<encodeURIComponent(设备编号)>，
 * 编号可为 移交编号/标签号/资产代码/BIM/新编号 任一种：后端 /search 走别名桥接收敛到 canonical。
 * 页面 = 移动优先设备卡：基础信息 + 位置补录 + 现场照片 + 关联设备/资料摘要。
 */
export default function ScanDevicePage() {
  const { code: rawCode } = useParams<{ code: string }>()
  const code = React.useMemo(() => (rawCode ? decodeURIComponent(rawCode).trim() : ''), [rawCode])
  const { toast } = useToast()
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState<ScanSearchResult | null>(null)
  const [rooms, setRooms] = React.useState<ScanRoom[]>([])
  const [rev, setRev] = React.useState(0)

  React.useEffect(() => {
    if (!code) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [s, r] = await Promise.all([scanSearchDevice(code), scanRooms()])
        if (cancelled) return
        setSearch(s)
        setRooms(r)
        if (!s.found) {
          toast({ title: '未检索到该设备', description: `编号：${code}`, variant: 'destructive' })
        }
      } catch (e) {
        if (!cancelled) {
          toast({ title: '加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [code, toast, rev])

  const device = search?.target ?? null
  const name = device?.name || (search?.archive?.['asset_name'] as string) || (search?.fixed_asset?.['asset_name'] as string) || code
  const nodeName = (c: string) => {
    const n = search?.nodes?.find((x) => x.device_code === c)
    return n?.name ? `${n.name}（${c}）` : c
  }
  const neighbors = React.useMemo(() => {
    if (!search?.edges?.length || !device) return []
    const out: Array<{ code: string; type: string; kind?: string }> = []
    for (const e of search.edges) {
      if (e.from === device.device_code) out.push({ code: e.to, type: e.type || '关联', kind: e.kind })
      else if (e.to === device.device_code) out.push({ code: e.from, type: e.type || '关联', kind: e.kind })
    }
    return out
  }, [search, device])

  const archiveLocation = (search?.archive?.['location'] as string) || ''

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-medium text-gray-900">现场扫码 · 设备卡</h1>
          </div>
          <p className="text-xs text-gray-500 mt-1 break-all font-mono">{code}</p>
        </div>
        <Link to="/asset/search" className="shrink-0 text-xs text-blue-600 hover:underline">
          高级检索
        </Link>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      )}

      {!loading && search && (
        <>
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Boxes className="w-4 h-4 text-blue-600" />
                设备基础信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-medium text-gray-900">{name}</span>
                {device?.subsystem_name && <Badge variant="secondary">{device.subsystem_name}</Badge>}
              </div>
              {!device && (
                <p className="text-xs text-amber-600">
                  该编号未在设备台账登记（可能仅存在于资料记录）——仍可查看下方聚合资料，但无法补录位置/照片。
                </p>
              )}
              {(device?.building || device?.floor) && (
                <p className="text-sm text-gray-600 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  台账位置：{device?.building || ''} {device?.floor || ''} {device?.location_desc || ''}
                </p>
              )}
              {search.room && (
                <p className="text-sm text-gray-600">
                  档案机房：{search.room.room_code}（{search.room.room_name} · {search.room.building} {search.room.floor}）
                </p>
              )}
              {archiveLocation && <p className="text-xs text-gray-500">设备档案位置：{archiveLocation}</p>}
            </CardContent>
          </Card>

          {device && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">位置补录（扫码核实现场）</CardTitle>
              </CardHeader>
              <CardContent>
                <DeviceLocationForm key={device.id + code} device={device} rooms={rooms} />
              </CardContent>
            </Card>
          )}

          {device && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">现场照片</CardTitle>
              </CardHeader>
              <CardContent>
                <DevicePhotoPanel deviceId={device.id} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Network className="w-4 h-4 text-blue-600" />
                关联与供电链（{neighbors.length}）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {neighbors.length === 0 && <p className="text-sm text-gray-400">暂无关联设备</p>}
              {neighbors.length > 0 && (
                <ul className="space-y-1.5">
                  {neighbors.map((n, i) => (
                    <li key={i} className="flex items-center justify-between text-sm gap-2">
                      <Link
                        to={`/qr/${encodeURIComponent(n.code)}`}
                        className="truncate text-blue-700 hover:underline"
                        title="扫码页直达该设备"
                      >
                        {nodeName(n.code)}
                      </Link>
                      <Badge
                        variant="outline"
                        className={cn('shrink-0 font-normal', relationKindBadge(n.kind))}
                      >
                        {n.type}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {device && <DeviceRelationPanel device={device} onChanged={() => setRev((x) => x + 1)} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                聚合资料（{search.total_records ?? 0} 条记录）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(!search.groups || search.groups.length === 0) && (
                <p className="text-sm text-gray-400">无动态资料记录</p>
              )}
              {search.groups?.map((g) => (
                <div key={g.subsystem_name || 'none'} className="text-sm">
                  <span className="text-gray-900 font-medium">{g.subsystem_name || '未归类'}</span>
                  <span className="text-gray-500 text-xs ml-2">
                    {g.tables.map((t) => `${t.table_name}(${t.records.length})`).join(' · ')}
                  </span>
                </div>
              ))}
              {search.fixed_asset && (
                <div className="pt-1 border-t border-gray-100 text-sm space-y-0.5">
                  <p className="text-gray-500">固定资产</p>
                  <p>资产名称：{(search.fixed_asset['asset_name'] as string) || '-'}　品牌型号：{(search.fixed_asset['brand_model'] as string) || '-'}</p>
                  <p>序列号：{(search.fixed_asset['serial_no'] as string) || '-'}　所在位置：{(search.fixed_asset['location'] as string) || '-'}</p>
                  <p className="text-xs text-gray-500">
                    使用单位：{(search.fixed_asset['use_dept'] as string) || '-'}　责任人：{(search.fixed_asset['responsible'] as string) || '-'}
                  </p>
                </div>
              )}
              {search.problems && search.problems.length > 0 && (
                <p className="text-xs text-amber-600">BA 问题 {search.problems.length} 条未闭环</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!loading && !search && (
        <p className="text-sm text-gray-500">未获取到数据，请确认二维码链接完整。</p>
      )}
    </div>
  )
}
