import * as React from 'react'
import {
  ChevronRight,
  ChevronDown,
  Building2,
  DoorOpen,
  Cpu,
  Layers,
  MapPin,
  Boxes,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getAreaTree } from './api'
import type { AreaNode } from './types'

interface AreaTreePageProps {
  /** 点击设备节点时打开详情抽屉 */
  onOpenDevice: (code: string) => void
}

function NodeIcon({ type }: { type: AreaNode['type'] }) {
  if (type === 'device') return <Cpu className="w-4 h-4 text-blue-500" />
  if (type === 'room') return <DoorOpen className="w-4 h-4 text-amber-500" />
  if (type === 'building') return <Building2 className="w-4 h-4 text-indigo-500" />
  return <Layers className="w-4 h-4 text-gray-500" />
}

interface TreeNodeProps {
  node: AreaNode
  depth: number
  expandedKeys: Set<string>
  loadingKeys: Set<string>
  childrenMap: Record<string, AreaNode[]>
  selectedKey: string | null
  onToggle: (node: AreaNode) => void
  onOpenDevice: (code: string) => void
  onSelect: (node: AreaNode) => void
}

function TreeNode({
  node,
  depth,
  expandedKeys,
  loadingKeys,
  childrenMap,
  selectedKey,
  onToggle,
  onOpenDevice,
  onSelect,
}: TreeNodeProps) {
  const isDevice = node.type === 'device'
  const hasChildren = !!node.has_children
  const expanded = expandedKeys.has(node.key)
  const loading = loadingKeys.has(node.key)
  const kids = childrenMap[node.key]
  const selected = selectedKey === node.key

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
          selected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50',
          isDevice && 'hover:bg-blue-50'
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => {
          if (isDevice) {
            onOpenDevice(String(node.meta?.device_code ?? ''))
            return
          }
          onSelect(node)
          if (hasChildren) onToggle(node)
        }}
      >
        <span className="w-4 flex items-center justify-center">
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )
          ) : null}
        </span>
        <NodeIcon type={node.type} />
        <span
          className={cn(
            'flex-1 truncate text-sm',
            isDevice ? 'text-blue-700 font-mono' : 'text-gray-800'
          )}
        >
          {node.label}
        </span>
        {node.count != null && (
          <Badge variant="outline" className="text-xs">
            {node.count}
          </Badge>
        )}
      </div>
      {expanded && hasChildren && (
        loading ? (
          <div className="py-2 text-sm text-gray-400" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
            加载中…
          </div>
        ) : kids && kids.length > 0 ? (
          kids.map((k) => (
            <TreeNode
              key={k.key}
              node={k}
              depth={depth + 1}
              expandedKeys={expandedKeys}
              loadingKeys={loadingKeys}
              childrenMap={childrenMap}
              selectedKey={selectedKey}
              onToggle={onToggle}
              onOpenDevice={onOpenDevice}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className="py-2 text-sm text-gray-400" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
            无下级节点
          </div>
        )
      )}
    </div>
  )
}

export function AreaTreePage({ onOpenDevice }: AreaTreePageProps) {
  const { toast } = useToast()
  const [roots, setRoots] = React.useState<AreaNode[]>([])
  const [childrenMap, setChildrenMap] = React.useState<Record<string, AreaNode[]>>({})
  const [loadingKeys, setLoadingKeys] = React.useState<Set<string>>(new Set())
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [rootLoading, setRootLoading] = React.useState(true)
  const [rangeDevices, setRangeDevices] = React.useState<AreaNode[]>([])
  const [rangeLabel, setRangeLabel] = React.useState<string>('')
  const [rangeLoading, setRangeLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    getAreaTree()
      .then((data) => {
        if (!cancelled) setRoots(data)
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            title: '加载区域树失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
      })
      .finally(() => {
        if (!cancelled) setRootLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const loadChildren = React.useCallback(async (key: string) => {
    const kids = await getAreaTree(key)
    setChildrenMap((prev) => ({ ...prev, [key]: kids }))
    return kids
  }, [])

  const toggle = React.useCallback(
    async (node: AreaNode) => {
      const key = node.key
      setExpandedKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      if (!childrenMap[key] && !loadingKeys.has(key)) {
        setLoadingKeys((prev) => new Set(prev).add(key))
        try {
          await loadChildren(key)
        } catch (e) {
          toast({
            title: '展开失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
        } finally {
          setLoadingKeys((prev) => {
            const n = new Set(prev)
            n.delete(key)
            return n
          })
        }
      }
    },
    [childrenMap, loadingKeys, loadChildren, toast]
  )

  const handleSelect = React.useCallback(
    async (node: AreaNode) => {
      setSelectedKey(node.key)
      if (node.type === 'room') {
        const kids =
          childrenMap[node.key] ?? (await loadChildren(node.key).catch(() => [] as AreaNode[]))
        setRangeLabel(node.label)
        setRangeDevices(kids.filter((k) => k.type === 'device'))
      } else if (node.type === 'floor') {
        // 楼层范围设备：并行下钻其所有房间再聚合设备（任一房间失败不影响其余）
        setRangeLabel(node.label)
        setRangeLoading(true)
        try {
          const rooms = await loadChildren(node.key)
          const results = await Promise.allSettled(
            rooms
              .filter((r) => r.type === 'room')
              .map((r) => loadChildren(r.key))
          )
          const devices: AreaNode[] = []
          results.forEach((res) => {
            if (res.status === 'fulfilled') {
              devices.push(...res.value.filter((k) => k.type === 'device'))
            }
          })
          setRangeDevices(devices)
        } catch (e) {
          toast({
            title: '加载楼层设备失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
        } finally {
          setRangeLoading(false)
        }
      }
    },
    [childrenMap, loadChildren, toast]
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" />区域树（楼栋 → 楼层 → 房间 → 设备）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rootLoading ? (
            <p className="text-sm text-gray-400 py-8 text-center">加载中…</p>
          ) : roots.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">暂无区域数据</p>
          ) : (
            roots.map((n) => (
              <TreeNode
                key={n.key}
                node={n}
                depth={0}
                expandedKeys={expandedKeys}
                loadingKeys={loadingKeys}
                childrenMap={childrenMap}
                selectedKey={selectedKey}
                onToggle={toggle}
                onOpenDevice={onOpenDevice}
                onSelect={handleSelect}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Boxes className="w-4 h-4" />范围内设备
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!rangeLabel ? (
            <p className="text-sm text-gray-400 py-8 text-center">
              点选左侧房间或楼层以高亮其范围内设备
            </p>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">
                {rangeLabel}（{rangeLoading ? '加载中…' : `${rangeDevices.length} 台`}）
              </div>
              <div className="max-h-[60vh] overflow-y-auto space-y-1">
                {rangeDevices.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => onOpenDevice(String(d.meta?.device_code ?? ''))}
                    className="w-full text-left text-sm font-mono text-blue-700 hover:bg-blue-50 rounded px-2 py-1.5 truncate"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
