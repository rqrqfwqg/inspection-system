import * as React from 'react'
import {
  ChevronRight,
  ChevronDown,
  Cpu,
  Wrench,
  Boxes,
  Network,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getDeviceTree } from './api'
import type { DeviceHierarchyNode } from './types'

interface DeviceHierarchyTreePageProps {
  /** 点击设备节点时打开详情抽屉 */
  onOpenDevice: (code: string) => void
}

function NodeIcon({ node }: { node: DeviceHierarchyNode }) {
  if (node.meta?.is_group) return <Boxes className="w-4 h-4 text-indigo-500" />
  if (node.type === 'accessory') return <Wrench className="w-4 h-4 text-emerald-500" />
  return <Cpu className="w-4 h-4 text-blue-500" />
}

interface TreeNodeProps {
  node: DeviceHierarchyNode
  depth: number
  expandedKeys: Set<string>
  loadingKeys: Set<string>
  childrenMap: Record<string, DeviceHierarchyNode[]>
  selectedKey: string | null
  onToggle: (node: DeviceHierarchyNode) => void
  onOpenDevice: (code: string) => void
  onSelect: (node: DeviceHierarchyNode) => void
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
  const isGroup = !!node.meta?.is_group
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
          isDevice && !isGroup && 'hover:bg-blue-50'
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => {
          onSelect(node)
          if (isGroup) {
            onToggle(node)
            return
          }
          if (isDevice) {
            onOpenDevice(String(node.meta?.device_code ?? ''))
            return
          }
          // accessory：叶节点，仅选中
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
        <NodeIcon node={node} />
        <span
          className={cn(
            'flex-1 truncate text-sm',
            isDevice && !isGroup ? 'text-blue-700 font-mono' : 'text-gray-800'
          )}
        >
          {node.label}
        </span>
        {node.count != null && node.count > 0 && (
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

export function DeviceHierarchyTreePage({ onOpenDevice }: DeviceHierarchyTreePageProps) {
  const { toast } = useToast()
  const [roots, setRoots] = React.useState<DeviceHierarchyNode[]>([])
  const [childrenMap, setChildrenMap] = React.useState<Record<string, DeviceHierarchyNode[]>>({})
  const [loadingKeys, setLoadingKeys] = React.useState<Set<string>>(new Set())
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [selectedNode, setSelectedNode] = React.useState<DeviceHierarchyNode | null>(null)
  const [rootLoading, setRootLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    getDeviceTree()
      .then((data) => {
        if (!cancelled) setRoots(data)
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            title: '加载设备层级树失败',
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
    const kids = await getDeviceTree(key)
    setChildrenMap((prev) => ({ ...prev, [key]: kids }))
    return kids
  }, [])

  const toggle = React.useCallback(
    async (node: DeviceHierarchyNode) => {
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

  const handleSelect = React.useCallback((node: DeviceHierarchyNode) => {
    setSelectedKey(node.key)
    setSelectedNode(node)
  }, [])

  const selectedIsDevice = selectedNode?.type === 'device' && !selectedNode?.meta?.is_group

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="w-4 h-4" />设备层级树（子系统 → 主设备 → 配件 / 子设备）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rootLoading ? (
            <p className="text-sm text-gray-400 py-8 text-center">加载中…</p>
          ) : roots.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">暂无设备数据</p>
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
          <p className="text-xs text-gray-400 mt-4">
            提示：根层为「按子系统分组」的主设备入口；点分组展开主设备，点主设备查看详情，
            展开主设备可见其配件与「配件从属」子设备。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">节点详情</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedNode ? (
            <p className="text-sm text-gray-400 py-8 text-center">点选左侧节点查看详情</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <NodeIcon node={selectedNode} />
                <span className="font-medium text-gray-800 truncate">{selectedNode.label}</span>
                <Badge variant="secondary" className="text-xs">
                  {selectedNode.meta?.is_group ? '子系统分组' : selectedNode.type === 'accessory' ? '配件' : '设备'}
                </Badge>
              </div>
              {selectedIsDevice && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onOpenDevice(String(selectedNode.meta?.device_code ?? ''))}
                >
                  查看设备详情
                </Button>
              )}
              <dl className="text-sm divide-y divide-gray-100">
                {Object.entries(selectedNode.meta ?? {}).map(([k, v]) => {
                  if (v == null || v === '') return null
                  return (
                    <div key={k} className="flex justify-between gap-2 py-1">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="text-gray-800 text-right truncate max-w-[60%]">{String(v)}</dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
