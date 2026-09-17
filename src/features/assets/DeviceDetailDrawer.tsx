import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  Cpu, Hand, Database, ChevronRight, ExternalLink, Link2,
  MapPin, Image as ImageIcon, Layers, AlertTriangle, Wrench, Tag, Crosshair,
} from 'lucide-react'
import { searchDevice, getBaProblems, getDeviceLink, getGeoObservations } from './api'
import type {
  SearchResult, BaProblem, DeviceLinkResponse, DeviceLinkEdge, GeoObservation,
} from './types'
import { FieldList, formatValue } from './FieldList'
import { RelationGraph } from './RelationGraph'

interface DeviceDetailDrawerProps {
  /** 当前设备编号；为 null 时抽屉关闭 */
  deviceCode: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 关联图谱中点击某节点时，跳转到该设备（在当前抽屉内联动） */
  onNavigate?: (code: string) => void
}

/**
 * 设备详情抽屉（区域树 / 子系统树 / 设备层级 / BA / 检索 共用）。
 *
 * 2026-09-15 重做：改造前只读 `/search` 的 `device` 字段（后端根本没这个字段），
 * 于是「基础信息 / 关联设备」整块永远空白 —— 这是"像死数据"的直接原因。
 * 现在一次并取三个真实数据源，全部落到位：
 *   /search          画像 profile / 固定资产 / 档案 / 配件 / 别名 / BA 问题 / 机房
 *   /link/device/*   资料记录（按资料表分组）+ 关联边（**自动/人工分列**）+ 分组统计
 *   /ba/problems     该设备的 BA 问题清单
 */
export function DeviceDetailDrawer({ deviceCode, open, onOpenChange, onNavigate }: DeviceDetailDrawerProps) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState<SearchResult | null>(null)
  const [link, setLink] = React.useState<DeviceLinkResponse | null>(null)
  const [baProblems, setBaProblems] = React.useState<BaProblem[]>([])
  /** 现场定位观测（扫码即记坐标；最新在前，已按 observed_at 倒序、空值排最后） */
  const [geoRows, setGeoRows] = React.useState<GeoObservation[]>([])
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({})

  React.useEffect(() => {
    if (!open || !deviceCode) return
    const code = deviceCode
    let cancelled = false
    async function load() {
      setLoading(true)
      setSearch(null)
      setLink(null)
      setGeoRows([])
      try {
        // 四个源相互独立：link / geo 是新增能力，旧后端没有时不能拖垮整屏
        const [s, ba, lk, geo] = await Promise.all([
          searchDevice(code).catch(() => null),
          getBaProblems({ device_code: code, page_size: 100 }).catch(() => ({ items: [] as BaProblem[], total: 0 })),
          getDeviceLink(code).catch(() => null),
          getGeoObservations(code, 20),
        ])
        if (cancelled) return
        setSearch(s)
        setBaProblems(ba.items || [])
        setLink(lk)
        setGeoRows(geo)
      } catch (e) {
        if (!cancelled) {
          toast({
            title: '加载设备详情失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, deviceCode, toast])

  const code = deviceCode ?? ''
  const prof = search?.profile
  const name = link?.name || prof?.name || search?.target?.name || code
  const edgeSummary = link?.edge_summary
  const groups = link?.groups || []
  const totalRecords = link?.record_count ?? search?.total_records ?? 0

  // 图谱用 /search 的完整 edges（含 type），叠加 link 的来源标注
  const originByKey = React.useMemo(() => {
    const m: Record<string, string> = {}
    for (const e of link?.edges || []) {
      m[`${e.from_code}->${e.to_code}`] = e.source
    }
    return m
  }, [link])
  const graphEdges = React.useMemo(() => {
    const raw = (search?.edges || []) as unknown as Record<string, unknown>[]
    return raw.map((e) => {
      const f = String(e.from ?? e.from_code ?? '')
      const t = String(e.to ?? e.to_code ?? '')
      return {
        ...e,
        from_code: f,
        to_code: t,
        relation_type: String(e.relation_type ?? e.type ?? '关联'),
        source: originByKey[`${f}->${t}`] || originByKey[`${t}->${f}`] || 'manual',
      }
    })
  }, [search, originByKey])

  // ==================== 现场定位（精确坐标）派生值 ====================
  // 说明：坐标来自小程序扫码时的 wx.getLocation（GCJ02），只写观测表、不改台账。
  // 时间字段后端落的是 UTC → 一律 +8 显示为北京时间（Web 侧先行纠正，小程序当前仍按原值显示）。
  const latestGeo = geoRows[0] ?? null
  const coordText = fmtCoord(latestGeo)
  const accTone = accToneOf(latestGeo)
  const geoTimeText = fmtBeijingUtc(latestGeo?.observed_at)
  const geoMapUrl = coordText
    ? `https://uri.amap.com/marker?position=${Number(latestGeo?.longitude)},${Number(latestGeo?.latitude)}`
      + `&name=${encodeURIComponent(name)}&coordinate=gaode&callnative=1`
    : ''
  const geoDrift = driftMeters(geoRows[0], geoRows[1])
  const geoDriftText = geoDrift !== null && geoDrift >= GEO_NOISE_METERS
    ? `较上次观测偏移约 ${geoDrift >= 1000 ? `${(geoDrift / 1000).toFixed(2)} km` : `${Math.round(geoDrift)} m`}`
    : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>设备详情</span>
            <Badge variant="secondary" className="font-mono">{code}</Badge>
            {name && name !== code && (
              <span className="text-base font-normal text-gray-600">{name}</span>
            )}
            {edgeSummary && edgeSummary.total > 0 && (
              <span className="flex items-center gap-1.5 ml-auto">
                {edgeSummary.auto > 0 && (
                  <Badge className="bg-cyan-100 text-cyan-800 hover:bg-cyan-100 border-cyan-200 gap-1">
                    <Cpu className="w-3 h-3" />自动 {edgeSummary.auto}
                  </Badge>
                )}
                {edgeSummary.manual > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Hand className="w-3 h-3" />人工 {edgeSummary.manual}
                  </Badge>
                )}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {!loading && !search && !link && (
          <p className="text-sm text-gray-500 py-8 text-center">未检索到该设备的信息。</p>
        )}

        {!loading && (search || link) && (
          <div className="space-y-4">
            {/* ============ 画像 ============ */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-gray-500" />设备画像
                  {prof ? (
                    prof.in_ledger
                      ? <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50">已登记台账</Badge>
                      : <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">未登记（仅资料）</Badge>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MiniStat icon={<Database className="w-3.5 h-3.5" />} label="资料记录" value={totalRecords} />
                  <MiniStat icon={<Layers className="w-3.5 h-3.5" />} label="涉及资料表" value={link?.table_count ?? prof?.source_tables?.length ?? 0} />
                  <MiniStat icon={<Link2 className="w-3.5 h-3.5" />} label="关联关系" value={edgeSummary?.total ?? 0} />
                  <MiniStat icon={<ImageIcon className="w-3.5 h-3.5" />} label="现场照片" value={prof?.photo_count ?? 0} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                  {prof?.subsystem_name && (
                    <span>子系统：<b className="text-gray-800">{prof.subsystem_name}</b></span>
                  )}
                  {(prof?.building || link?.building) && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {[prof?.building || link?.building, prof?.floor || link?.floor, prof?.location || '']
                        .filter(Boolean).join(' / ')}
                    </span>
                  )}
                  {(prof?.room || link?.groups) && (
                    <span>
                      机房：
                      <b className="text-gray-800">
                        {prof?.room?.room_name || prof?.room?.room_code || '—'}
                      </b>
                    </span>
                  )}
                  {prof?.tag_no && <span>标签：<b className="text-gray-800">{prof.tag_no}</b></span>}
                </div>
                {search?.aliases && search.aliases.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Tag className="w-3 h-3 text-gray-400" />
                    <span className="text-gray-500">编号别名：</span>
                    {search.aliases.map((a, i) => (
                      <Badge key={i} variant="outline" className="font-mono text-[10px]">
                        {formatValue(a.alias_code ?? a.alias ?? a)}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ============ 现场定位（精确坐标 · 扫码即记） ============ */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <Crosshair className="w-4 h-4 text-gray-500" />现场定位（精确坐标）
                  {latestGeo && (
                    <Badge variant="outline" className={accTone.className}>{accTone.text}</Badge>
                  )}
                  {geoRows.length > 1 && (
                    <span className="text-xs font-normal text-gray-400">历史 {geoRows.length} 条</span>
                  )}
                  <span className="text-[11px] font-normal text-gray-400 ml-auto">
                    小程序扫码时自动记录 · 只记观测不动台账
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!latestGeo || !coordText ? (
                  <p className="text-sm text-gray-500">
                    暂无现场坐标记录。在微信小程序「设备卡」扫码查询该设备时，
                    会自动记一条手机定位（需开启位置权限）——室内漂移较大，据此判断位置时可先看精度。
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-xs text-gray-500">
                          最新坐标（{String(latestGeo.coord_type || 'gcj02').toUpperCase()}）
                        </div>
                        <div className="font-mono text-sm text-gray-900 tabular-nums">{coordText}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-xs text-gray-500">定位精度</div>
                        <div className="text-sm text-gray-900">{fmtAcc(latestGeo)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 px-3 py-2">
                        <div className="text-xs text-gray-500">记录时间（北京时间）</div>
                        <div className="text-sm text-gray-900">{geoTimeText || '—'}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                      {latestGeo.room_code && (
                        <span>记录时所在机房：<b className="text-gray-800">{latestGeo.room_code}</b></span>
                      )}
                      {latestGeo.operator && (
                        <span>记录人：<b className="text-gray-800">{latestGeo.operator}</b></span>
                      )}
                      {geoMapUrl && (
                        <a
                          className="text-blue-600 hover:underline flex items-center gap-0.5"
                          href={geoMapUrl} target="_blank" rel="noreferrer"
                        >
                          地图查看<ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {geoDriftText && (
                      <p className="text-[11px] text-amber-600">
                        {geoDriftText}（可能被挪动，或台账位置有误 —— 超过 {GEO_NOISE_METERS}m 才提示）
                      </p>
                    )}
                    {geoRows.length > 1 && (
                      <div className="border-t pt-2 space-y-1">
                        <div className="text-xs text-gray-500">历史记录（最新在前）</div>
                        {geoRows.slice(1, 6).map((g, i) => (
                          <div key={g.id ?? i} className="text-[11px] text-gray-500 flex flex-wrap gap-x-3">
                            <span className="font-mono tabular-nums">{fmtCoord(g) || '—'}</span>
                            <span>{fmtAcc(g)}</span>
                            <span>{fmtBeijingUtc(g.observed_at) || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* ============ 关联关系（自动 / 人工分列） ============ */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  <Link2 className="w-4 h-4 text-gray-500" />关联关系
                  <span className="text-xs font-normal text-gray-400">
                    共 {edgeSummary?.total ?? 0} 条
                  </span>
                  {!!edgeSummary?.auto && (
                    <Badge className="bg-cyan-100 text-cyan-800 hover:bg-cyan-100 border-cyan-200 gap-1">
                      <Cpu className="w-3 h-3" />自动 {edgeSummary.auto}
                    </Badge>
                  )}
                  {!!edgeSummary?.manual && (
                    <Badge variant="secondary" className="gap-1">
                      <Hand className="w-3 h-3" />人工 {edgeSummary.manual}
                    </Badge>
                  )}
                  <Button
                    variant="ghost" size="sm" className="ml-auto h-7 text-xs"
                    onClick={() => { onOpenChange(false); navigate('/asset-viz?tab=link') }}
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />联动中心
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(link?.edges || []).length === 0 ? (
                  <p className="text-sm text-gray-500">该设备暂无关联关系。</p>
                ) : (
                  <>
                    {link?.edges_auto && link.edges_auto.length > 0 && (
                      <EdgeGroup title="自动关联" tone="cyan" icon={<Cpu className="w-3.5 h-3.5" />}
                        edges={link.edges_auto} onNavigate={onNavigate} />
                    )}
                    {link?.edges_manual && link.edges_manual.length > 0 && (
                      <EdgeGroup title="人工关联" tone="slate" icon={<Hand className="w-3.5 h-3.5" />}
                        edges={link.edges_manual} onNavigate={onNavigate} />
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* ============ 关联图谱 ============ */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">关联图谱（以当前对象为中心）</CardTitle>
              </CardHeader>
              <CardContent>
                <RelationGraph
                  centerCode={code}
                  edges={link?.edges && link.edges.length ? link.edges : graphEdges}
                  problems={baProblems}
                  onSelectNode={(c) => onNavigate?.(c)}
                />
              </CardContent>
            </Card>

            {/* ============ 资料记录（按子系统 → 资料表分组，与数据表管理同源） ============ */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-gray-500" />
                  资料记录（{totalRecords}）
                  <span className="text-xs font-normal text-gray-400">
                    {groups.length} 张表 · 与「数据表管理」同源
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {groups.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    该编号在资料表中暂无记录（可能它是台账设备但没有对应资料行）。
                  </p>
                ) : groups.map((g) => {
                  const isOpen = !!expanded[g.table_id]
                  return (
                    <div key={g.table_id} className="rounded-lg border">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                        onClick={() => setExpanded((p) => ({ ...p, [g.table_id]: !isOpen }))}
                      >
                        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        <span className="text-sm font-medium">{g.table_name}</span>
                        {g.subsystem && (
                          <Badge variant="outline" className="text-[10px]">{g.subsystem.name}</Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] ml-auto">{g.records.length} 条</Badge>
                        <span
                          role="link"
                          tabIndex={0}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            onOpenChange(false)
                            navigate(`/asset/ledger/${g.table_id}`)
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') {
                              ev.stopPropagation()
                              onOpenChange(false)
                              navigate(`/asset/ledger/${g.table_id}`)
                            }
                          }}
                        >
                          打开表<ExternalLink className="w-3 h-3" />
                        </span>
                      </button>
                      {isOpen && (
                        <div className="border-t divide-y">
                          {g.records.map((r) => (
                            <div key={r.id} className="p-3">
                              <FieldList data={r.data as Record<string, unknown>} columns={3} emptyText="（空记录）" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* ============ 固定资产 / 设备档案 ============ */}
            {search?.fixed_asset && (
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm">固定资产</CardTitle></CardHeader>
                <CardContent><FieldList data={search.fixed_asset as Record<string, unknown>} /></CardContent>
              </Card>
            )}
            {search?.archive && (
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm">设备档案</CardTitle></CardHeader>
                <CardContent><FieldList data={search.archive as Record<string, unknown>} /></CardContent>
              </Card>
            )}

            {/* ============ BA 问题 ============ */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />BA 问题（{baProblems.length}）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {baProblems.length === 0 ? (
                  <p className="text-sm text-gray-500">无</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {baProblems.map((p, i) => (
                      <li key={p.id ?? i} className="border-b border-dashed border-gray-100 py-1 flex flex-wrap gap-2 items-center">
                        <Badge variant={p.status === 'closed' ? 'success' : p.status === 'processing' ? 'warning' : 'destructive'}>
                          {formatValue(p.status ?? '未知')}
                        </Badge>
                        <span className="text-gray-700">{formatValue(p.problem_type ?? '')}</span>
                        <span className="text-gray-400">· {formatValue(p.location ?? p.group_area ?? '')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* ============ 配件 ============ */}
            {!!search?.accessories?.length && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-gray-500" />配件（{search.accessories.length}）
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {search.accessories.map((a, i) => (
                    <div key={i} className="border-b border-dashed border-gray-100 py-1">
                      <FieldList data={a as Record<string, unknown>} emptyText="—" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ==================== 现场定位工具 ====================

/**
 * 与小程序 `useGeolocation.GEO_NOISE_METERS` 保持一致：精确定位室外抖动 5~20m，
 * 低于该阈值视为抖动不提示，超过才提示「较上次偏移」。
 */
const GEO_NOISE_METERS = 20

/**
 * 观测时间统一按 **UTC** 解析后 +8 显示为北京时间。
 *
 * 后端 `observed_at` 由小程序 `new Date().toISOString()` 写入（UTC），`created_at`
 * 也是 UTC —— 直接展示会差 8 小时。解析失败返回空串（不猜、不错显）。
 */
function fmtBeijingUtc(raw?: string | null): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const hasZone = /([Zz]|[+-]\d{2}:?\d{2})$/.test(s)
  const iso = hasZone ? s : `${s.replace(' ', 'T')}Z`
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const b = new Date(t.getTime() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`
}

/** 坐标文本：固定 6 位小数（与小程序一致）；非法值返回空串。 */
function fmtCoord(g?: GeoObservation | null): string {
  if (!g) return ''
  const lat = Number(g.latitude)
  const lng = Number(g.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

/**
 * 精度文本。`accuracy` 缺失时**绝不补 0**（±0m 会被误读成「极其精准」），
 * 而是明确写「精度未知」—— `accuracy` 是「是不是精确定位」的硬判据。
 */
function fmtAcc(g?: GeoObservation | null): string {
  if (!g) return ''
  const a = Number(g.accuracy)
  if (g.accuracy === null || g.accuracy === undefined || g.accuracy === '' || !Number.isFinite(a)) {
    return '精度未知（非精确定位）'
  }
  return `±${Math.round(a)} m`
}

/** 精度色调：≤50m 视为可信（绿），>50m 偏弱（橙），未知（灰）。 */
function accToneOf(g?: GeoObservation | null) {
  const a = Number(g?.accuracy)
  const known = !!g && g.accuracy !== null && g.accuracy !== undefined && g.accuracy !== '' && Number.isFinite(a)
  if (!known) {
    return { text: '精度未知', className: 'text-gray-600 border-gray-300 bg-gray-50' }
  }
  return a <= 50
    ? { text: `精确 ±${Math.round(a)}m`, className: 'text-green-700 border-green-300 bg-green-50' }
    : { text: `精度偏弱 ±${Math.round(a)}m`, className: 'text-amber-700 border-amber-300 bg-amber-50' }
}

/** 两次观测的球面距离（米）；任一坐标非法返回 null。 */
function driftMeters(a?: GeoObservation | null, b?: GeoObservation | null): number | null {
  if (!a || !b) return null
  const la1 = Number(a.latitude), lo1 = Number(a.longitude)
  const la2 = Number(b.latitude), lo2 = Number(b.longitude)
  if (![la1, lo1, la2, lo2].every((v) => Number.isFinite(v))) return null
  const rad = (d: number) => (d * Math.PI) / 180
  const dLa = rad(la2 - la1)
  const dLo = rad(lo2 - lo1)
  const h = Math.sin(dLa / 2) ** 2
    + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ==================== 子组件 ====================

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500 flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  )
}

/** 关联边分组：自动（青）/ 人工（灰），每条带证据与跳转 */
function EdgeGroup({
  title, tone, icon, edges, onNavigate,
}: {
  title: string
  tone: 'cyan' | 'slate'
  icon: React.ReactNode
  edges: DeviceLinkEdge[]
  onNavigate?: (code: string) => void
}) {
  const tones = {
    cyan: { bar: 'border-l-cyan-400', badge: 'bg-cyan-100 text-cyan-800 border-cyan-200', text: 'text-cyan-700' },
    slate: { bar: 'border-l-gray-300', badge: 'bg-gray-100 text-gray-700 border-gray-200', text: 'text-gray-600' },
  } as const
  const t = tones[tone]
  return (
    <div className="space-y-1.5">
      <div className={`text-xs font-medium flex items-center gap-1.5 ${t.text}`}>
        {icon}{title}（{edges.length}）
      </div>
      {edges.map((e) => (
        <div key={e.id} className={`border-l-2 ${t.bar} pl-3 py-1 space-y-0.5`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={`text-[10px] ${t.badge}`}>{e.relation_type}</Badge>
            <Badge variant="outline" className="text-[10px]">
              {e.other_kind === 'device' ? '设备' : e.other_kind === 'room' ? '机房' : e.other_kind === 'record' ? '资料编号' : '未知'}
            </Badge>
            <span className="text-gray-500 text-xs">{e.direction === 'out' ? '→' : '←'}</span>
            <button
              type="button"
              className="font-mono text-gray-800 hover:text-blue-600 hover:underline"
              onClick={() => onNavigate?.(e.other_code)}
            >
              {e.other_code}
            </button>
            {e.other_name && <span className="text-gray-500 text-xs">{e.other_name}</span>}
            {e.rule && <span className="text-[10px] text-gray-400">规则 {e.rule}</span>}
          </div>
          {e.evidence && (
            <div className="text-[11px] text-gray-400 leading-relaxed">{e.evidence}</div>
          )}
        </div>
      ))}
    </div>
  )
}
