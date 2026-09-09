import * as React from 'react'
import { ChevronRight, ChevronDown, Cpu, Network, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getBaSystemTree } from './api'
import type { BaSystemNode } from './types'

interface BaSystemTreePageProps {
  /** 点击设备节点时打开详情抽屉 */
  onOpenDevice: (code: string) => void
}

function BaNodeIcon({ type }: { type: BaSystemNode['type'] }) {
  if (type === 'ba_device') return <Cpu className="w-4 h-4 text-blue-500" />
  return <Network className="w-4 h-4 text-violet-500" />
}

interface BaTreeNodeProps {
  node: BaSystemNode
  depth: number
  expandedKeys: Set<string>
  loadingKeys: Set<string>
  childrenMap: Record<string, BaSystemNode[]>
  onToggle: (node: BaSystemNode) => void
  onOpenDevice: (code: string) => void
}

function BaTreeNode({
  node,
  depth,
  expandedKeys,
  loadingKeys,
  childrenMap,
  onToggle,
  onOpenDevice,
}: BaTreeNodeProps) {
  const isDevice = node.type === 'ba_device'
  const hasChildren = !!node.has_children
  const expanded = expandedKeys.has(node.key)
  const loading = loadingKeys.has(node.key)
  const kids = childrenMap[node.key]
  const problemCount = node.meta?.problem_count ?? 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
          isDevice ? 'hover:bg-blue-50' : 'hover:bg-gray-50'
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => {
          if (isDevice) {
            onOpenDevice(String(node.meta?.device_code ?? ''))
            return
          }
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
        <BaNodeIcon type={node.type} />
        <span
          className={cn(
            'flex-1 truncate text-sm',
            isDevice ? 'text-blue-700 font-mono' : 'text-gray-800'
          )}
        >
          {node.label}
        </span>
        {!isDevice && problemCount > 0 && (
          <Badge variant="destructive" className="text-xs flex items-center gap-0.5">
            <AlertTriangle className="w-3 h-3" />
            {problemCount}
          </Badge>
        )}
        {node.count != null && node.count > 0 && isDevice === false && (
          <Badge variant="outline" className="text-xs">
            {node.count} 设备
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
            <BaTreeNode
              key={k.key}
              node={k}
              depth={depth + 1}
              expandedKeys={expandedKeys}
              loadingKeys={loadingKeys}
              childrenMap={childrenMap}
              onToggle={onToggle}
              onOpenDevice={onOpenDevice}
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

export function BaSystemTreePage({ onOpenDevice }: BaSystemTreePageProps) {
  const { toast } = useToast()
  const [roots, setRoots] = React.useState<BaSystemNode[]>([])
  const [childrenMap, setChildrenMap] = React.useState<Record<string, BaSystemNode[]>>({})
  const [loadingKeys, setLoadingKeys] = React.useState<Set<string>>(new Set())
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [rootLoading, setRootLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    getBaSystemTree()
      .then((data) => {
        if (!cancelled) setRoots(data)
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            title: '加载 BA 系统树失败',
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
    const kids = await getBaSystemTree(key)
    setChildrenMap((prev) => ({ ...prev, [key]: kids }))
    return kids
  }, [])

  const toggle = React.useCallback(
    async (node: BaSystemNode) => {
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

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="w-4 h-4" />BA 系统树（BA 系统 → 设备）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rootLoading ? (
          <p className="text-sm text-gray-400 py-8 text-center">加载中…</p>
        ) : roots.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">暂无 BA 系统数据</p>
        ) : (
          roots.map((n) => (
            <BaTreeNode
              key={n.key}
              node={n}
              depth={0}
              expandedKeys={expandedKeys}
              loadingKeys={loadingKeys}
              childrenMap={childrenMap}
              onToggle={toggle}
              onOpenDevice={onOpenDevice}
            />
          ))
        )}
        <p className="text-xs text-gray-400 mt-4">
          提示：点击 BA 系统展开其下设备（红色徽标为问题数）；点击设备节点查看详情。
        </p>
      </CardContent>
    </Card>
  )
}
