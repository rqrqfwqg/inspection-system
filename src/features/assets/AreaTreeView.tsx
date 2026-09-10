import * as React from 'react'
import { Building2, ChevronDown, ChevronRight, Cpu, DoorOpen, Layers } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getAreaTree } from './api'
import type { AreaNode } from './types'

interface Props {
  keyword?: string
  onlyWithDevices?: boolean
  building?: string
  selectedKey: string | null
  refreshToken?: number
  /** 选中房间/楼层：回调该范围内设备 */
  onSelectRange: (node: AreaNode, devices: AreaNode[]) => void
  onSelectOther: (node: AreaNode) => void
  onOpenDevice: (code: string) => void
  onError?: (msg: string) => void
}

function NodeIcon({ type }: { type: AreaNode['type'] }) {
  if (type === 'device') return <Cpu className="w-4 h-4 text-blue-500 shrink-0" />
  if (type === 'room') return <DoorOpen className="w-4 h-4 text-amber-500 shrink-0" />
  if (type === 'building') return <Building2 className="w-4 h-4 text-indigo-500 shrink-0" />
  return <Layers className="w-4 h-4 text-gray-500 shrink-0" />
}

/**
 * 节点文案：房间/设备为「名称（编号）」格式，编号以灰色等宽字体区分，便于同层同名机房辨识。
 */
function NodeLabel({ node }: { node: AreaNode }) {
  const m = node.label.match(/^(.*?)（(.+)）$/)
  if (!m) {
    return <span className="truncate">{node.label}</span>
  }
  return (
    <span className="truncate">
      {m[1]}
      <span className="ml-0.5 font-mono text-xs text-gray-400">（{m[2]}）</span>
    </span>
  )
}

export default function AreaTreeView({
  keyword,
  onlyWithDevices,
  building,
  selectedKey,
  refreshToken,
  onSelectRange,
  onSelectOther,
  onOpenDevice,
  onError,
}: Props) {
  const [roots, setRoots] = React.useState<AreaNode[]>([])
  const [childrenMap, setChildrenMap] = React.useState<Record<string, AreaNode[]>>({})
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [loadingKeys, setLoadingKeys] = React.useState<Set<string>>(new Set())
  const [rootLoading, setRootLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setRootLoading(true)
    setChildrenMap({})
    setExpanded(new Set())
    getAreaTree(undefined, { keyword, onlyWithDevices, building })
      .then((data) => {
        if (!cancelled) setRoots(data)
      })
      .catch((e) => {
        if (!cancelled) onError?.(e instanceof Error ? e.message : '加载区域树失败')
      })
      .finally(() => {
        if (!cancelled) setRootLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [keyword, onlyWithDevices, building, refreshToken, onError])

  const loadChildren = React.useCallback(
    async (node: AreaNode): Promise<AreaNode[]> => {
      const kids = await getAreaTree(node.key, { keyword, onlyWithDevices })
      setChildrenMap((prev) => ({ ...prev, [node.key]: kids }))
      return kids
    },
    [keyword, onlyWithDevices]
  )

  const toggle = React.useCallback(
    async (node: AreaNode) => {
      const key = node.key
      const isOpen = expanded.has(key)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (isOpen) next.delete(key)
        else next.add(key)
        return next
      })
      if (isOpen || childrenMap[key] || loadingKeys.has(key)) return
      setLoadingKeys((prev) => new Set(prev).add(key))
      try {
        await loadChildren(node)
      } catch (e) {
        onError?.(e instanceof Error ? e.message : '展开失败')
      } finally {
        setLoadingKeys((prev) => {
          const n = new Set(prev)
          n.delete(key)
          return n
        })
      }
    },
    [expanded, childrenMap, loadingKeys, loadChildren, onError]
  )

  /** 楼层范围：并行下钻其所有房间，聚合设备（单间失败不影响其余） */
  const collectFloorDevices = React.useCallback(
    async (floorNode: AreaNode): Promise<AreaNode[]> => {
      const rooms = childrenMap[floorNode.key] ?? (await loadChildren(floorNode))
      const results = await Promise.allSettled(
        rooms.filter((r) => r.type === 'room').map((r) => loadChildren(r))
      )
      const out: AreaNode[] = []
      results.forEach((res) => {
        if (res.status === 'fulfilled') out.push(...res.value.filter((k) => k.type === 'device'))
      })
      return out
    },
    [childrenMap, loadChildren]
  )

  const handleClick = React.useCallback(
    async (node: AreaNode) => {
      if (node.type === 'device') {
        onOpenDevice(String(node.meta?.device_code ?? ''))
        return
      }
      onSelectOther(node)
      if (node.has_children) void toggle(node)
      if (node.type === 'room') {
        try {
          const kids = childrenMap[node.key] ?? (await loadChildren(node))
          onSelectRange(node, kids.filter((k) => k.type === 'device'))
        } catch (e) {
          onError?.(e instanceof Error ? e.message : '加载机房设备失败')
        }
      } else if (node.type === 'floor') {
        try {
          onSelectRange(node, await collectFloorDevices(node))
        } catch (e) {
          onError?.(e instanceof Error ? e.message : '加载楼层设备失败')
        }
      }
    },
    [childrenMap, loadChildren, collectFloorDevices, onOpenDevice, onSelectOther, onSelectRange, toggle, onError]
  )

  const renderNode = (node: AreaNode, depth: number): React.ReactNode => {
    const isDevice = node.type === 'device'
    const hasChildren = !!node.has_children
    const isOpen = expanded.has(node.key)
    const isSelected = selectedKey === node.key
    const kids = childrenMap[node.key]
    return (
      <div key={node.key}>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
            isSelected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'
          )}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => void handleClick(node)}
        >
          <span className="w-4 flex items-center justify-center shrink-0">
            {hasChildren ? (
              isOpen ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )
            ) : null}
          </span>
          <NodeIcon type={node.type} />
          <span
            className={cn(
              'flex-1 text-sm flex items-baseline min-w-0',
              isDevice ? 'text-blue-700' : 'text-gray-800'
            )}
          >
            <NodeLabel node={node} />
          </span>
          {node.type === 'device' && node.meta?.subsystem_name ? (
            <Badge variant="outline" className="text-xs shrink-0 hidden md:inline-flex">
              {String(node.meta.subsystem_name)}
            </Badge>
          ) : null}
          {node.count != null && node.type !== 'device' && (
            <Badge variant="outline" className="text-xs shrink-0">
              {node.count}
            </Badge>
          )}
        </div>
        {isOpen && hasChildren && (
          <>
            {loadingKeys.has(node.key) ? (
              <div className="py-2 text-sm text-gray-400" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
                加载中…
              </div>
            ) : kids && kids.length > 0 ? (
              kids.map((k) => renderNode(k, depth + 1))
            ) : (
              <div className="py-2 text-sm text-gray-400" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
                无下级节点
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (rootLoading) {
    return <p className="text-sm text-gray-400 py-8 text-center">加载中…</p>
  }
  if (roots.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">暂无区域数据</p>
  }
  return <div>{roots.map((n) => renderNode(n, 0))}</div>
}
