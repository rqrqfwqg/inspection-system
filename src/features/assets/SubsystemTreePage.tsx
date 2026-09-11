import * as React from 'react'
import { ChevronRight, ChevronDown, Boxes, Cpu, Layers, FolderTree, Filter } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getSubsystemTree } from './api'
import type { SubsystemNode } from './types'

interface SubsystemTreePageProps {
  /** 点击设备节点时打开详情抽屉 */
  onOpenDevice: (code: string) => void
  /** 点击子系统节点时，在概览中按该系统过滤 */
  onSelectSubsystem: (code: string) => void
}

function SubNodeIcon({ type }: { type: SubsystemNode['type'] }) {
  if (type === 'device') return <Cpu className="w-4 h-4 text-blue-500" />
  if (type === 'subsystem') return <Boxes className="w-4 h-4 text-indigo-500" />
  return <Layers className="w-4 h-4 text-gray-500" />
}

interface SubTreeNodeProps {
  node: SubsystemNode
  depth: number
  expandedKeys: Set<string>
  loadingKeys: Set<string>
  childrenMap: Record<string, SubsystemNode[]>
  onToggle: (node: SubsystemNode) => void
  onOpenDevice: (code: string) => void
  onSelectSubsystem: (code: string) => void
}

function SubTreeNode({
  node,
  depth,
  expandedKeys,
  loadingKeys,
  childrenMap,
  onToggle,
  onOpenDevice,
  onSelectSubsystem,
}: SubTreeNodeProps) {
  const isDevice = node.type === 'device'
  const isSubsystem = node.type === 'subsystem'
  const hasChildren = !!node.has_children
  const expanded = expandedKeys.has(node.key)
  const loading = loadingKeys.has(node.key)
  const kids = childrenMap[node.key]

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 cursor-pointer transition-colors',
          isDevice ? 'hover:bg-blue-50' : 'hover:bg-gray-50'
        )}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => {
          if (isDevice) {
            onOpenDevice(String(node.meta?.device_code ?? ''))
            return
          }
          // 其他类型（subsystem / category / 根）一律只展开/折叠，不再隐式切 Tab
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
        <SubNodeIcon type={node.type} />
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
        {isSubsystem && node.meta?.subsystem_code && (
          <button
            type="button"
            aria-label={`在概览中按 ${node.label} 过滤`}
            title="在概览中按此系统过滤"
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 p-0.5 rounded transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              onSelectSubsystem(String(node.meta?.subsystem_code ?? ''))
            }}
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {expanded && hasChildren && (
        loading ? (
          <div className="py-2 text-sm text-gray-400" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>
            加载中…
          </div>
        ) : kids && kids.length > 0 ? (
          kids.map((k) => (
            <SubTreeNode
              key={k.key}
              node={k}
              depth={depth + 1}
              expandedKeys={expandedKeys}
              loadingKeys={loadingKeys}
              childrenMap={childrenMap}
              onToggle={onToggle}
              onOpenDevice={onOpenDevice}
              onSelectSubsystem={onSelectSubsystem}
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

export function SubsystemTreePage({ onOpenDevice, onSelectSubsystem }: SubsystemTreePageProps) {
  const { toast } = useToast()
  const [roots, setRoots] = React.useState<SubsystemNode[]>([])
  const [childrenMap, setChildrenMap] = React.useState<Record<string, SubsystemNode[]>>({})
  const [loadingKeys, setLoadingKeys] = React.useState<Set<string>>(new Set())
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [rootLoading, setRootLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    getSubsystemTree()
      .then((data) => {
        if (!cancelled) setRoots(data)
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            title: '加载子系统树失败',
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
    const kids = await getSubsystemTree(key)
    setChildrenMap((prev) => ({ ...prev, [key]: kids }))
    return kids
  }, [])

  const toggle = React.useCallback(
    async (node: SubsystemNode) => {
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
          <FolderTree className="w-4 h-4" />子系统树（子系统 → 分类 → 设备）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rootLoading ? (
          <p className="text-sm text-gray-400 py-8 text-center">加载中…</p>
        ) : roots.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">暂无子系统数据</p>
        ) : (
          roots.map((n) => (
            <SubTreeNode
              key={n.key}
              node={n}
              depth={0}
              expandedKeys={expandedKeys}
              loadingKeys={loadingKeys}
              childrenMap={childrenMap}
              onToggle={toggle}
              onOpenDevice={onOpenDevice}
              onSelectSubsystem={onSelectSubsystem}
            />
          ))
        )}
        <p className="text-xs text-gray-400 mt-4">
          提示：点击节点展开/折叠下级，点击设备节点查看详情；将鼠标悬停在子系统节点上，点右侧漏斗图标可在「概览」中按该系统过滤。
        </p>
      </CardContent>
    </Card>
  )
}
