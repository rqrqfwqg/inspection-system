import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { searchDevice, getRelations, getBaProblems } from './api'
import type { SearchResult, RelationEdge, BaProblem } from './types'
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
 * 设备详情抽屉（被区域树 / 子系统树 / 检索页复用）。
 * 聚合 /search + /relations(双向) + /ba/problems?device_code= 的全部信息。
 */
export function DeviceDetailDrawer({ deviceCode, open, onOpenChange, onNavigate }: DeviceDetailDrawerProps) {
  const { toast } = useToast()
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState<SearchResult | null>(null)
  const [relations, setRelations] = React.useState<RelationEdge[]>([])
  const [baProblems, setBaProblems] = React.useState<BaProblem[]>([])

  React.useEffect(() => {
    if (!open || !deviceCode) return
    const code = deviceCode
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [s, relFrom, relTo, ba] = await Promise.all([
          searchDevice(code),
          getRelations({ from_code: code }),
          getRelations({ to_code: code }),
          getBaProblems({ device_code: code, page_size: 100 }),
        ])
        if (cancelled) return
        // 合并双方向边并去重（按 id）
        const merged: RelationEdge[] = [...relFrom, ...relTo]
        const seen = new Set<number>()
        const uniq = merged.filter((e) => {
          if (e.id == null) return true
          if (seen.has(e.id)) return false
          seen.add(e.id)
          return true
        })
        setSearch(s)
        setRelations(uniq)
        setBaProblems(ba.items)
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
    load()
    return () => {
      cancelled = true
    }
  }, [open, deviceCode, toast])

  const code = deviceCode ?? ''
  const device = search?.device
  const name =
    (device?.name as string) ||
    (device?.device_name as string) ||
    (device?.device_code as string) ||
    code

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>设备详情</span>
            <Badge variant="secondary" className="font-mono">
              {code}
            </Badge>
            {name && name !== code && (
              <span className="text-base font-normal text-gray-600">{name}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {!loading && search && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">设备基础信息</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldList data={device ?? null} emptyText="未检索到设备基础信息" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">关联图谱（以当前设备为中心）</CardTitle>
              </CardHeader>
              <CardContent>
                <RelationGraph
                  centerCode={code}
                  edges={relations}
                  problems={baProblems}
                  onSelectNode={(c) => onNavigate?.(c)}
                />
              </CardContent>
            </Card>

            {search.fixed_asset && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">固定资产</CardTitle>
                </CardHeader>
                <CardContent>
                  <FieldList data={search.fixed_asset} />
                </CardContent>
              </Card>
            )}

            {search.archive && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">设备档案</CardTitle>
                </CardHeader>
                <CardContent>
                  <FieldList data={search.archive} />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">BA 问题（{baProblems.length}）</CardTitle>
              </CardHeader>
              <CardContent>
                {baProblems.length === 0 ? (
                  <p className="text-sm text-gray-500">无</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {baProblems.map((p, i) => (
                      <li
                        key={p.id ?? i}
                        className="border-b border-dashed border-gray-100 py-1 flex flex-wrap gap-2 items-center"
                      >
                        <Badge
                          variant={
                            p.status === 'closed'
                              ? 'success'
                              : p.status === 'processing'
                                ? 'warning'
                                : 'destructive'
                          }
                        >
                          {formatValue(p.status ?? '未知')}
                        </Badge>
                        <span className="text-gray-700">{formatValue(p.problem_type ?? '')}</span>
                        <span className="text-gray-400">
                          · {formatValue(p.location ?? p.group_area ?? '')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">配件（{search.accessories?.length ?? 0}）</CardTitle>
              </CardHeader>
              <CardContent>
                {!search.accessories || search.accessories.length === 0 ? (
                  <p className="text-sm text-gray-500">无</p>
                ) : (
                  <div className="space-y-2">
                    {search.accessories.map((a, i) => (
                      <div key={i} className="border-b border-dashed border-gray-100 py-1">
                        <FieldList data={a} emptyText="—" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">别名（{search.aliases?.length ?? 0}）</CardTitle>
              </CardHeader>
              <CardContent>
                {!search.aliases || search.aliases.length === 0 ? (
                  <p className="text-sm text-gray-500">无</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {search.aliases.map((a, i) => {
                      const aliasVal = (a as Record<string, unknown>)?.alias
                      return (
                        <Badge key={i} variant="outline">
                          {formatValue(aliasVal ?? a)}
                        </Badge>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">关联设备（{relations.length}）</CardTitle>
              </CardHeader>
              <CardContent>
                {relations.length === 0 ? (
                  <p className="text-sm text-gray-500">无</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {relations.map((e, i) => {
                      const other = e.from_code === code ? e.to_code : e.from_code
                      return (
                        <li key={e.id ?? i} className="border-b border-dashed border-gray-100 py-1 flex gap-2 items-center">
                          <Badge variant="outline">{formatValue(e.relation_type ?? '关联')}</Badge>
                          <span className="font-mono text-gray-700">{String(other ?? '')}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {!loading && !search && (
          <p className="text-sm text-gray-500 py-8 text-center">未检索到该设备的信息。</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
