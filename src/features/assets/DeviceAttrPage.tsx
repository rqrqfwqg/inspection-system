import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Search, ChevronRight, ChevronDown, Cpu, Boxes, Wrench, Network, X, Loader2,
} from 'lucide-react'
import { getDeviceTree, resolveLedger } from './api'
import type { DeviceHierarchyNode, LedgerResolveCandidate } from './types'
import { DeviceAttrPanel } from './DeviceAttrPanel'

/**
 * 「设备属性」页 —— 搜索 + 树两条入口抵达任意对象，右侧整页展示属性与全部关联。
 *
 * 与既有「设备层级 / 检索」的区别：
 *  1. 搜索走 `/asset-ledger/resolve`（后端权威匹配内核），**同时**能命中已登记设备与
 *     资料域编号（电柜 `G-…` / 配电箱 / 图纸回路）—— 后者是整条供电链的入口；
 *  2. 右侧面板内联展示，不弹抽屉，便于沿「关联关系」逐跳下钻而不丢上下文；
 *  3. 台账设备 →（供配电）→ 电柜 →（上级配电·自动）→ 配电箱 → 图纸回路 全程可走通。
 */
export default function DeviceAttrPage() {
  const [selected, setSelected] = React.useState<string | null>(null)

  // ---------- 搜索 ----------
  const [q, setQ] = React.useState('')
  const [hits, setHits] = React.useState<LedgerResolveCandidate[]>([])
  const [hint, setHint] = React.useState<string | null>(null)
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    const kw = q.trim()
    if (kw.length < 2) {
      setHits([])
      setHint(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      resolveLedger(kw)
        .then((r) => {
          if (cancelled) return
          setHits(r.candidates || [])
          setHint((r.candidates || []).length === 0 ? '未命中任何编号（可试完整的机身编码或电柜编号）。' : null)
        })
        .catch(() => {
          if (!cancelled) {
            setHits([])
            setHint('检索失败，请稍后重试。')
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 320)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ==================== 左：搜索 + 树 ==================== */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" />按编号搜索
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="relative">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="机身编码 / 资产号 / 电柜编号…"
                className="pr-8"
              />
              {searching && (
                <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />
              )}
              {!searching && q && (
                <button
                  type="button"
                  aria-label="清空"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setQ('')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {hint && <p className="text-xs text-gray-500">{hint}</p>}

            {hits.length > 0 && (
              <ul className="divide-y rounded-md border max-h-64 overflow-auto">
                {hits.map((c) => (
                  <li key={c.device_code}>
                    <button
                      type="button"
                      className={cn(
                        'w-full text-left px-2.5 py-2 hover:bg-gray-50 transition-colors',
                        selected === c.device_code && 'bg-blue-50',
                      )}
                      onClick={() => setSelected(c.device_code)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-800 truncate">{c.device_code}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] shrink-0',
                            c.in_devices
                              ? 'text-blue-700 border-blue-300 bg-blue-50'
                              : 'text-amber-700 border-amber-300 bg-amber-50',
                          )}
                        >
                          {c.in_devices ? '已登记' : '仅资料'}
                        </Badge>
                        <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                          {c.confidence}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {[c.name || c.asset_name, c.location].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-400 leading-relaxed">
              匹配走台账权威内核：会从品牌型号里反解机身号，所以设备编号与它的上级电柜编号都能搜到。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4" />设备层级树
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeviceTree onPick={setSelected} selected={selected} />
          </CardContent>
        </Card>
      </div>

      {/* ==================== 右：属性 + 关联 ==================== */}
      <div className="lg:col-span-2">
        <DeviceAttrPanel code={selected} onNavigate={setSelected} />
      </div>
    </div>
  )
}

// ==================== 设备层级树（子系统 → 类型 → 设备 / 配件） ====================

function NodeIcon({ node }: { node: DeviceHierarchyNode }) {
  if (node.meta?.is_group) return <Boxes className="w-3.5 h-3.5 text-indigo-500" />
  if (node.type === 'accessory') return <Wrench className="w-3.5 h-3.5 text-emerald-500" />
  return <Cpu className="w-3.5 h-3.5 text-blue-500" />
}

function DeviceTree({ onPick, selected }: { onPick: (code: string) => void; selected: string | null }) {
  const [roots, setRoots] = React.useState<DeviceHierarchyNode[]>([])
  const [kids, setKids] = React.useState<Record<string, DeviceHierarchyNode[]>>({})
  const [busy, setBusy] = React.useState<Set<string>>(new Set())
  const [open, setOpen] = React.useState<Set<string>>(new Set())
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    getDeviceTree()
      .then((d) => {
        if (!cancelled) setRoots(d)
      })
      .catch(() => {
        if (!cancelled) setErr('设备层级树加载失败。')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = React.useCallback(
    async (node: DeviceHierarchyNode) => {
      const key = node.key
      setOpen((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      if (kids[key] || busy.has(key)) return
      setBusy((prev) => new Set(prev).add(key))
      try {
        const children = await getDeviceTree(key)
        setKids((prev) => ({ ...prev, [key]: children }))
      } catch {
        setKids((prev) => ({ ...prev, [key]: [] }))
      } finally {
        setBusy((prev) => {
          const n = new Set(prev)
          n.delete(key)
          return n
        })
      }
    },
    [kids, busy],
  )

  const renderNodes = (nodes: DeviceHierarchyNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const isGroup = !!node.meta?.is_group
      const isDevice = node.type === 'device' && !isGroup
      const code = String(node.meta?.device_code ?? '')
      const expanded = open.has(node.key)
      const children = kids[node.key]
      const isLoading = busy.has(node.key)
      return (
        <div key={node.key}>
          <button
            type="button"
            className={cn(
              'w-full flex items-center gap-1 rounded-md py-1 pr-1 text-left transition-colors',
              selected && isDevice && code === selected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50',
            )}
            style={{ paddingLeft: depth * 14 + 4 }}
            onClick={() => {
              if (isGroup) void toggle(node)
              else if (isDevice) onPick(code)
            }}
          >
            <span className="w-3.5 flex items-center justify-center shrink-0">
              {node.has_children ? (
                expanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                )
              ) : null}
            </span>
            <NodeIcon node={node} />
            <span
              className={cn(
                'flex-1 truncate text-xs',
                isDevice ? 'text-blue-700 font-mono' : 'text-gray-800',
              )}
              title={node.label}
            >
              {node.label}
            </span>
            {!!node.count && (
              <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{node.count}</span>
            )}
          </button>
          {expanded && (
            isLoading ? (
              <div className="text-[11px] text-gray-400 py-1" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>
                加载中…
              </div>
            ) : children && children.length > 0 ? (
              renderNodes(children, depth + 1)
            ) : (
              <div className="text-[11px] text-gray-400 py-1" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>
                无下级节点
              </div>
            )
          )}
        </div>
      )
    })

  if (err) return <p className="text-xs text-gray-500 py-4 text-center">{err}</p>
  if (roots.length === 0) return <p className="text-xs text-gray-400 py-4 text-center">加载中…</p>

  return (
    <div className="max-h-[520px] overflow-auto -mx-1 px-1">
      {renderNodes(roots, 0)}
      <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
        层级为 子系统 → 设备类型（同名聚合）→ 主设备 → 配件 / 子设备；点分组展开，点设备在右侧查看属性与关联。
      </p>
    </div>
  )
}
