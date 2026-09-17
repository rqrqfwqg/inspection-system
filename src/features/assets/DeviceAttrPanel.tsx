import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Cpu, Hand, Database, Link2, MapPin, Layers, FileStack, AlertTriangle,
} from 'lucide-react'
import { searchDevice, getBaProblems, getDeviceLink } from './api'
import type { SearchResult, BaProblem, DeviceLinkResponse } from './types'
import { FieldList, formatValue } from './FieldList'
import { RelationGraph } from './RelationGraph'
import { LinkEdgeGroup } from './LinkEdgeGroup'

interface DeviceAttrPanelProps {
  /** 当前查看的对象编号（台账设备 / 机房 / 资料域编号均可） */
  code: string | null
  /** 点击关联对象时切换当前查看对象 */
  onNavigate: (code: string) => void
}

/** 三类对象的统一称呼。资料域对象进一步说明"它是什么表里的"（电柜 / 配电箱 / 图纸回路）。 */
function kindLabel(link: DeviceLinkResponse | null): string {
  const k = link?.kind
  if (k === 'device') return link?.in_ledger === false ? '台账设备' : '台账设备'
  if (k === 'room') return '机房'
  if (k === 'record') {
    const t = link?.owner_tables?.[0]?.table_name
    return t ? `资料域 · ${t}` : '资料域对象'
  }
  return '未知'
}

/**
 * 设备属性面板（「设备属性」页右侧主体，跨对象复用）。
 *
 * 一次并取三个真实数据源，与「设备详情」抽屉同源、但以整页形式呈现，便于逐跳下钻：
 *   /search         画像 / 固定资产 / 档案 / 配件 / 别名 / 自动拓扑边
 *   /link/device/*  资料记录（按表分组）+ 关联边（**自动/人工分列**）+ owner_tables
 *   /ba/problems    BA 问题清单
 *
 * 关键：`/link/device/{code}` 现已受理 `records.device_code`，所以自动关联链上的
 * 电柜 / 配电箱 / 图纸回路都能在这里点开，链条可以从台账设备一路走到图纸回路。
 */
export function DeviceAttrPanel({ code, onNavigate }: DeviceAttrPanelProps) {
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState<SearchResult | null>(null)
  const [link, setLink] = React.useState<DeviceLinkResponse | null>(null)
  const [baProblems, setBaProblems] = React.useState<BaProblem[]>([])

  React.useEffect(() => {
    if (!code) {
      setSearch(null)
      setLink(null)
      setBaProblems([])
      return
    }
    const target = code
    let cancelled = false
    async function load() {
      setLoading(true)
      setSearch(null)
      setLink(null)
      setBaProblems([])
      // 三源相互独立：任一不可用都不该拖垮整屏
      const [s, ba, lk] = await Promise.all([
        searchDevice(target).catch(() => null),
        getBaProblems({ device_code: target, page_size: 50 }).catch(
          () => ({ items: [] as BaProblem[], total: 0 }),
        ),
        getDeviceLink(target).catch(() => null),
      ])
      if (cancelled) return
      setSearch(s)
      setBaProblems(ba.items || [])
      setLink(lk)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [code])

  if (!code) {
    return (
      <Card className="h-full">
        <CardContent className="py-16 text-center text-sm text-gray-500">
          从左侧搜索或树中选择一个对象，这里会显示它的属性与全部关联。
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  const prof = search?.profile
  const name = link?.name || prof?.name || ''
  const primary = link?.groups?.[0]
  const attrs = (primary?.records?.[0]?.data || {}) as Record<string, unknown>
  const autoEdges = link?.edges_auto || []
  const manualEdges = link?.edges_manual || []

  // 图谱优先用 /link 的边（带来源标注），退回 /search 的拓扑边
  const graphEdges = React.useMemo(() => {
    if (link?.edges?.length) return link.edges as unknown as Record<string, unknown>[]
    return ((search?.edges || []) as unknown as Record<string, unknown>[])
  }, [link, search])

  return (
    <div className="space-y-3">
      {/* ============ 标识 ============ */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="font-mono">{code}</Badge>
            <Badge
              variant="outline"
              className={
                link?.kind === 'device'
                  ? 'text-blue-700 border-blue-300 bg-blue-50'
                  : link?.kind === 'room'
                    ? 'text-teal-700 border-teal-300 bg-teal-50'
                    : 'text-amber-700 border-amber-300 bg-amber-50'
              }
            >
              {kindLabel(link)}
            </Badge>
            {name && name !== code && (
              <span className="text-sm font-normal text-gray-700 truncate">{name}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            {link?.subsystem?.name && (
              <span>子系统：<b className="text-gray-800">{link.subsystem.name}</b></span>
            )}
            {(link?.building || link?.floor) && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {[link?.building, link?.floor].filter(Boolean).join(' / ')}
              </span>
            )}
            {(prof?.room?.room_name || prof?.room?.room_code) && (
              <span>机房：<b className="text-gray-800">{prof?.room?.room_name || prof?.room?.room_code}</b></span>
            )}
            {prof?.tag_no && <span>标签：<b className="text-gray-800">{prof.tag_no}</b></span>}
            {link?.kind === 'record' && <span className="text-amber-700">未登记台账（仅资料域）</span>}
          </div>
          {link?.owner_tables && link.owner_tables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <FileStack className="w-3 h-3 text-gray-400" />
              <span className="text-gray-500">资料来源：</span>
              {link.owner_tables.map((t) => (
                <Badge key={t.table_id} variant="outline" className="text-[10px] font-normal">
                  {t.table_name} · {t.record_count}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Database className="w-3 h-3" />资料记录 {link?.record_count ?? search?.total_records ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3" />资料表 {link?.table_count ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <Link2 className="w-3 h-3" />关联 {link?.edge_summary?.total ?? 0}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ============ 属性 ============ */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-500" />对象属性
            {primary && (
              <span className="text-xs font-normal text-gray-400">
                来自《{primary.table_name}》
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldList data={attrs} columns={2} emptyText="该对象在资料表中暂无字段数据。" />
        </CardContent>
      </Card>

      {/* ============ 关联关系（自动 / 人工分列） ============ */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Link2 className="w-4 h-4 text-gray-500" />关联关系
            <span className="text-xs font-normal text-gray-400">
              共 {link?.edge_summary?.total ?? 0} 条
            </span>
            {!!link?.edge_summary?.auto && (
              <Badge className="bg-cyan-100 text-cyan-800 hover:bg-cyan-100 border-cyan-200 gap-1">
                <Cpu className="w-3 h-3" />自动 {link.edge_summary.auto}
              </Badge>
            )}
            {!!link?.edge_summary?.manual && (
              <Badge variant="secondary" className="gap-1">
                <Hand className="w-3 h-3" />人工 {link.edge_summary.manual}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {autoEdges.length === 0 && manualEdges.length === 0 ? (
            <p className="text-sm text-gray-500">该对象暂无关联关系。</p>
          ) : (
            <>
              {autoEdges.length > 0 && (
                <LinkEdgeGroup title="自动关联" tone="cyan" edges={autoEdges} onNavigate={onNavigate} />
              )}
              {manualEdges.length > 0 && (
                <LinkEdgeGroup title="人工关联" tone="slate" edges={manualEdges} onNavigate={onNavigate} />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ============ 关联图谱 ============ */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">关联图谱（以当前对象为中心，可点节点下钻）</CardTitle>
        </CardHeader>
        <CardContent>
          <RelationGraph
            centerCode={code}
            edges={graphEdges}
            problems={baProblems}
            onSelectNode={onNavigate}
          />
        </CardContent>
      </Card>

      {/* ============ BA 问题 ============ */}
      {baProblems.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />BA 问题（{baProblems.length}）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {baProblems.map((p, i) => (
                <li
                  key={p.id ?? i}
                  className="border-b border-dashed border-gray-100 py-1 flex flex-wrap gap-2 items-center"
                >
                  <Badge
                    variant={
                      p.status === 'closed' ? 'success' : p.status === 'processing' ? 'warning' : 'destructive'
                    }
                  >
                    {formatValue(p.status ?? '未知')}
                  </Badge>
                  <span className="text-gray-700">{formatValue(p.problem_type ?? '')}</span>
                  <span className="text-gray-400">· {formatValue(p.location ?? p.group_area ?? '')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
