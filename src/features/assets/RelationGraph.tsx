import * as React from 'react'

/**
 * 关联边（来自 /link/device 的 DeviceLinkEdge 或 /search 的 edges）。
 * 只需 from_code / to_code / relation_type / source 四字段即可重建树。
 */
interface RawEdge {
  id?: number
  from_code?: string
  to_code?: string
  /** DeviceLinkEdge 另有 other_code，优先用它定位对端 */
  other_code?: string
  relation_type?: string
  source?: 'auto' | 'manual' | string
  [key: string]: unknown
}

type RawProblem = Record<string, unknown>

interface TreeNode {
  key: string
  /** 显示编号（设备码 / 问题标识） */
  code: string
  /** 分支标签（关系类型 / 问题类型） */
  label: string
  kind: 'device' | 'problem'
  source: 'auto' | 'manual'
  /** 对端类别（/link/device 提供）：device / room / record / unknown */
  otherKind: string
}

interface RelationGraphProps {
  /** 中心设备编号（树根） */
  centerCode: string
  /** 关联边（自动/人工已标注；双方向均可，组件自动定位对端） */
  edges: RawEdge[]
  /** 该设备的 BA 问题（来自 /ba/problems） */
  problems: RawProblem[]
  /** 点击设备节点时回调，用于在当前抽屉内跳转到该设备 */
  onSelectNode?: (code: string) => void
}

/** 边来源 → 线型与配色：自动关联=青色虚线，人工关联=石板灰实线（一眼可辨）。 */
/** 对端类别 → 中文短标（让「自动关联出来的到底是什么」一眼可见：设备 / 机房 / 资料域） */
const KIND_LABEL: Record<string, string> = {
  device: '设备',
  room: '机房',
  record: '资料域',
}

const AUTO_COLOR = '#06b6d4'
const MANUAL_COLOR = '#64748b'
function sourceStyle(source: string | undefined): { stroke: string; dash: string | undefined } {
  return source === 'auto'
    ? { stroke: AUTO_COLOR, dash: '6 4' }
    : { stroke: MANUAL_COLOR, dash: undefined }
}

const ROOT_X = 168
const LEAF_X = 548
const VIEW_W = 724
const PAD_TOP = 40
const PAD_BOT = 24
const ROW_H = 46
const NODE_R = 13

/**
 * 自左向右的树状关联图（替代原力导向星型图）。
 *
 * - 树根 = 当前设备；每个关联对象（设备 / 问题）是一片叶子，纵向均匀分布。
 * - 分支用 S 形贝塞尔曲线，标签带白色底衬（paint-order），各分支走向独立、互不叠压 ——
 *   彻底消除原星型图「所有边标签堆在中心」导致的重影。
 * - 分支颜色即来源：自动=青色虚线 / 人工=石板灰实线；节点可点击跳转到对端设备。
 * - 当关联对象很多时，SVG 按内容定高、外层容器可纵向滚动（不缩放文字，避免模糊）。
 */
export function RelationGraph({ centerCode, edges, problems, onSelectNode }: RelationGraphProps) {
  const onSelectRef = React.useRef<((code: string) => void) | undefined>(onSelectNode)
  onSelectRef.current = onSelectNode

  const tree = React.useMemo<TreeNode[]>(() => {
    const deviceMap = new Map<string, TreeNode>()
    for (const e of edges) {
      const f = String(e.from_code ?? '')
      const t = String(e.to_code ?? '')
      if (!f || !t) continue
      const other = e.other_code != null ? String(e.other_code) : (f === centerCode ? t : f === t ? '' : f)
      if (!other || other === centerCode) continue
      const prev = deviceMap.get(other)
      if (prev) {
        // 同一对端有多条边：优先保留「自动」来源，关系类型合并展示
        if ((e.source ?? 'manual') === 'auto' && prev.source !== 'auto') prev.source = 'auto'
        if (prev.label !== (e.relation_type ?? '') && (e.relation_type ?? '')) {
          prev.label = `${prev.label}・${e.relation_type}`
        }
        continue
      }
      deviceMap.set(other, {
        key: `d:${other}`,
        code: other,
        label: String(e.relation_type ?? '关联'),
        kind: 'device',
        source: (e.source ?? 'manual') === 'auto' ? 'auto' : 'manual',
        otherKind: String(e.other_kind ?? 'unknown'),
      })
    }
    const devices = [...deviceMap.values()].sort((a, b) => a.code.localeCompare(b.code))

    const probs: TreeNode[] = problems.map((p, i) => ({
      key: `p:${i}`,
      code: p.device_code != null ? String(p.device_code) : `问题${i + 1}`,
      label: String((p.problem_type as string) || (p.status as string) || 'BA 问题'),
      kind: 'problem',
      source: 'manual',
      otherKind: 'unknown',
    }))

    return [...devices, ...probs]
  }, [centerCode, edges, problems])

  const hasContent = tree.length > 0

  if (!hasContent) {
    return <p className="text-sm text-gray-500 py-8 text-center">该设备暂无可展示的关联与问题。</p>
  }

  const n = tree.length
  const VIEW_H = Math.max(260, PAD_TOP + n * ROW_H + PAD_BOT)
  const rootY = VIEW_H / 2
  const yOf = (i: number) => PAD_TOP + ROW_H * (i + 0.5)

  return (
    <div className="space-y-3">
      <div className="overflow-auto max-h-[440px] rounded-lg border bg-gray-50">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width={VIEW_W}
          height={VIEW_H}
          className="block"
          style={{ maxWidth: '100%' }}
        >
          {/* 分支（S 形曲线 + 标签带白底衬） */}
          {tree.map((node, i) => {
            const y = yOf(i)
            const st = sourceStyle(node.source)
            const isProb = node.kind === 'problem'
            const stroke = isProb ? '#fca5a5' : st.stroke
            const dash = isProb ? undefined : st.dash
            const midX = (ROOT_X + LEAF_X) / 2
            const d = `M ${ROOT_X} ${rootY} C ${midX} ${rootY}, ${midX} ${y}, ${LEAF_X} ${y}`
            // 标签放在曲线 1/4 处（靠近根部左侧），错开各行，带白底衬避免重影
            const lx = ROOT_X + 88
            return (
              <g key={`b-${node.key}`}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={1.8} strokeDasharray={dash} />
                <g transform={`translate(${lx}, ${y - 9})`}>
                  <rect x={-4} y={-11} width={Math.min(150, node.label.length * 12 + 10)} height={18} rx={5} fill="#f9fafb" stroke="#e5e7eb" strokeWidth={0.8} />
                  <text x={1} y={3} textAnchor="start" fontSize={11} fill={isProb ? '#b91c1c' : (node.source === 'auto' ? '#0e7490' : '#475569')} className="pointer-events-none select-none">
                    {node.label.length > 12 ? node.label.slice(0, 12) + '…' : node.label}
                  </text>
                </g>
              </g>
            )
          })}

          {/* 树根（当前设备） */}
          <g>
            <circle cx={ROOT_X} cy={rootY} r={NODE_R + 4} fill="#2563eb" stroke="#1d4ed8" strokeWidth={1.5} />
            <text x={ROOT_X} y={rootY + 4} textAnchor="middle" fontSize={12} fill="#fff" className="pointer-events-none select-none">本</text>
            <text x={ROOT_X - 14} y={rootY - NODE_R - 8} textAnchor="end" fontSize={12} fontWeight={600} fill="#1e3a8a" className="pointer-events-none select-none">
              {centerCode.length > 22 ? centerCode.slice(0, 22) + '…' : centerCode}
            </text>
            <text x={ROOT_X - 14} y={rootY - NODE_R + 6} textAnchor="end" fontSize={10} fill="#64748b" className="pointer-events-none select-none">当前设备</text>
          </g>

          {/* 叶子节点（关联设备 / BA 问题） */}
          {tree.map((node, i) => {
            const y = yOf(i)
            const isProb = node.kind === 'problem'
            const fill = isProb ? '#fee2e2' : '#e2e8f0'
            const stroke = isProb ? '#ef4444' : node.source === 'auto' ? '#06b6d4' : '#64748b'
            const codeLabel = node.code.length > 22 ? node.code.slice(0, 22) + '…' : node.code
            return (
              <g
                key={node.key}
                className={isProb ? '' : 'cursor-pointer'}
                onClick={() => { if (!isProb && onSelectRef.current) onSelectRef.current(node.code) }}
              >
                <circle cx={LEAF_X} cy={y} r={NODE_R} fill={fill} stroke={stroke} strokeWidth={1.6} />
                <text x={LEAF_X} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={isProb ? '#b91c1c' : '#334155'} className="pointer-events-none select-none">
                  {isProb ? '!' : (node.source === 'auto' ? 'A' : 'M')}
                </text>
                <text x={LEAF_X + NODE_R + 6} y={y + 4} textAnchor="start" fontSize={11} fill="#334155" className="pointer-events-none select-none">
                  {codeLabel}
                </text>
                {!isProb && (
                  <text x={LEAF_X + NODE_R + 6} y={y + 18} textAnchor="start" fontSize={9.5} fill={node.source === 'auto' ? '#0e7490' : '#94a3b8'} className="pointer-events-none select-none">
                    {node.source === 'auto' ? '自动关联' : '人工关联'}
                    {KIND_LABEL[node.otherKind] ? ` · ${KIND_LABEL[node.otherKind]}` : ''}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* 图例：节点类型 + 来源（自动/人工） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-600" /> 当前设备
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-slate-300 border border-slate-500" /> 关联设备（{tree.filter((t) => t.kind === 'device').length}）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-200 border border-red-500" /> BA 问题（{tree.filter((t) => t.kind === 'problem').length}）
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <svg width="26" height="8" className="inline-block">
            <line x1="0" y1="4" x2="26" y2="4" stroke={AUTO_COLOR} strokeWidth="1.8" strokeDasharray="6 4" />
          </svg>
          自动关联（青・虚线）
        </span>
        <span className="flex items-center gap-1">
          <svg width="26" height="8" className="inline-block">
            <line x1="0" y1="4" x2="26" y2="4" stroke={MANUAL_COLOR} strokeWidth="1.8" />
          </svg>
          人工关联（灰・实线）
        </span>
        <span className="text-gray-400">
          叶子节点标注对端类别（设备 / 机房 / 资料域），点击即切换查看该对象
        </span>
      </div>
    </div>
  )
}
