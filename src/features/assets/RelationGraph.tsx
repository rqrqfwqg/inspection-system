import * as React from 'react'

/** 设备关联边（来自 /relations，双方向合并后的边）。 */
interface RawEdge {
  id?: number
  from_code?: string
  to_code?: string
  relation_type?: string
  [key: string]: unknown
}

type RawProblem = Record<string, unknown>

interface SimNode {
  id: string
  label: string
  kind: 'center' | 'device' | 'problem'
  code?: string
  x: number
  y: number
  vx: number
  vy: number
}

interface SimLink {
  source: string
  target: string
}

interface RelationGraphProps {
  /** 中心设备编号 */
  centerCode: string
  /** 关联边（来自 /relations，双方向合并） */
  edges: RawEdge[]
  /** 该设备的 BA 问题（来自 /ba/problems?device_code=） */
  problems: RawProblem[]
  /** 点击节点（设备 / 问题关联设备）时回调，用于在该节点上打开详情 */
  onSelectNode?: (code: string) => void
}

const VIEW_W = 640
const VIEW_H = 360
const PAD = 36
const REPULSION = 5200
const SPRING = 0.025
const SPRING_LEN = 110
const CENTER_PULL = 0.012
const DAMP = 0.86

/**
 * 可交互的力导向关联图（P1 升级版）。
 *
 * - 以当前设备为中心节点，关联设备（来自 /relations 双向边）与 BA 问题（来自 /ba/problems）
 *   作为环绕节点，使用轻量自实现力模拟（斥力 + 弹簧 + 向心）布局，无需引入重型 canvas 依赖，
 *   保证 vite build 稳定通过。
 * - 节点可点击：设备 / 问题关联设备点击后回调 onSelectNode，在当前抽屉内跳转到该设备。
 * - 节点可拖拽：拖拽时重新触发布局，邻居随之响应。
 * - 降级：若没有任何关联与问题，仅展示提示文案（列表视图的关联设备列表仍可用）。
 */
export function RelationGraph({ centerCode, edges, problems, onSelectNode }: RelationGraphProps) {
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const nodesRef = React.useRef<SimNode[]>([])
  const linksRef = React.useRef<SimLink[]>([])
  const byIdRef = React.useRef<Map<string, SimNode>>(new Map())
  const rafRef = React.useRef<number | null>(null)
  const runningRef = React.useRef(false)
  const tickRef = React.useRef(0)
  const energyRef = React.useRef(0)
  const dragRef = React.useRef<{ id: string; moved: boolean; sx: number; sy: number } | null>(null)
  const justDraggedRef = React.useRef(false)
  const onSelectRef = React.useRef<((code: string) => void) | undefined>(onSelectNode)
  onSelectRef.current = onSelectNode

  const [, forceRender] = React.useReducer((x: number) => (x + 1) % 1_000_000, 0)
  const [hasContent, setHasContent] = React.useState(false)

  const buildGraph = React.useCallback((): { nodes: SimNode[]; links: SimLink[] } => {
    const cx = VIEW_W / 2
    const cy = VIEW_H / 2
    const nodes: SimNode[] = []
    const links: SimLink[] = []
    const byId = new Map<string, SimNode>()

    const center: SimNode = { id: '__center__', label: '中心', kind: 'center', code: centerCode, x: cx, y: cy, vx: 0, vy: 0 }
    nodes.push(center)
    byId.set(center.id, center)

    const addDevice = (code: string) => {
      const key = `d:${code}`
      if (byId.has(key)) return
      const ang = Math.random() * Math.PI * 2
      const r = 90 + Math.random() * 70
      const n: SimNode = {
        id: key, label: code, kind: 'device', code,
        x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), vx: 0, vy: 0,
      }
      nodes.push(n)
      byId.set(key, n)
    }

    for (const e of edges) {
      const f = String(e.from_code ?? '')
      const t = String(e.to_code ?? '')
      if (!f || !t) continue
      let other: string | null = null
      if (f === centerCode && t !== centerCode) other = t
      else if (t === centerCode && f !== centerCode) other = f
      else if (f !== centerCode && t !== centerCode) other = f
      if (!other) continue
      addDevice(other)
      links.push({ source: center.id, target: `d:${other}` })
    }

    problems.forEach((p, idx) => {
      const dc = p.device_code != null ? String(p.device_code) : ''
      const label = (p.problem_type as string) || (p.status as string) || '问题'
      const id = `p:${idx}`
      const targetCode = dc && dc !== centerCode ? dc : null
      const targetId = targetCode && byId.has(`d:${targetCode}`) ? `d:${targetCode}` : center.id
      const ang = Math.random() * Math.PI * 2
      const r = 70 + Math.random() * 50
      const n: SimNode = {
        id, label, kind: 'problem', code: targetCode || undefined,
        x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), vx: 0, vy: 0,
      }
      nodes.push(n)
      links.push({ source: targetId, target: id })
    })

    return { nodes, links }
  }, [centerCode, edges, problems])

  const step = React.useCallback(() => {
    const nodes = nodesRef.current
    const links = linksRef.current
    const cx = VIEW_W / 2
    const cy = VIEW_H / 2
    const byId = new Map<string, SimNode>()
    for (const n of nodes) byId.set(n.id, n)
    byIdRef.current = byId

    for (const n of nodes) {
      if (n.kind === 'center') { n.vx = 0; n.vy = 0; continue }
      n.vx = 0; n.vy = 0
    }
    // 斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j]
        let dx = a.x - b.x; let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) d2 = 1
        const dist = Math.sqrt(d2)
        const f = REPULSION / d2
        const ux = dx / dist; const uy = dy / dist
        if (a.kind !== 'center') { a.vx += ux * f; a.vy += uy * f }
        if (b.kind !== 'center') { b.vx -= ux * f; b.vy -= uy * f }
      }
    }
    // 弹簧
    for (const l of links) {
      const a = byId.get(l.source); const b = byId.get(l.target)
      if (!a || !b) continue
      let dx = b.x - a.x; let dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const f = SPRING * (dist - SPRING_LEN)
      const ux = dx / dist; const uy = dy / dist
      a.vx += ux * f; a.vy += uy * f
      b.vx -= ux * f; b.vy -= uy * f
    }
    // 积分
    let energy = 0
    for (const n of nodes) {
      if (n.kind === 'center') { n.x = cx; n.y = cy; continue }
      if (dragRef.current && dragRef.current.id === n.id) { n.vx = 0; n.vy = 0; continue }
      n.vx += (cx - n.x) * CENTER_PULL
      n.vy += (cy - n.y) * CENTER_PULL
      n.vx *= DAMP; n.vy *= DAMP
      n.x += n.vx; n.y += n.vy
      n.x = Math.max(PAD, Math.min(VIEW_W - PAD, n.x))
      n.y = Math.max(PAD, Math.min(VIEW_H - PAD, n.y))
      energy += n.vx * n.vx + n.vy * n.vy
    }
    energyRef.current = energy
  }, [])

  const loop = React.useCallback(() => {
    if (!runningRef.current) return
    step()
    forceRender()
    tickRef.current += 1
    if (tickRef.current > 600 || (tickRef.current > 40 && energyRef.current < 0.6)) {
      runningRef.current = false
      rafRef.current = null
      return
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [step])

  const startSim = React.useCallback(() => {
    tickRef.current = 0
    runningRef.current = true
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop)
  }, [loop])

  const stopSim = React.useCallback(() => {
    runningRef.current = false
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])

  React.useEffect(() => {
    const { nodes, links } = buildGraph()
    nodesRef.current = nodes
    linksRef.current = links
    setHasContent(nodes.length > 1 || problems.length > 0)
    startSim()
    return () => stopSim()
  }, [buildGraph, problems.length, startSim, stopSim])

  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left) * (VIEW_W / rect.width),
      y: (clientY - rect.top) * (VIEW_H / rect.height),
    }
  }

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    dragRef.current = { id, moved: false, sx: e.clientX, sy: e.clientY }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (Math.abs(e.clientX - d.sx) > 3 || Math.abs(e.clientY - d.sy) > 3) d.moved = true
    const p = toSvg(e.clientX, e.clientY)
    const n = byIdRef.current.get(d.id)
    if (n) { n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0 }
    if (!runningRef.current) startSim()
  }
  const onPointerUp = () => {
    if (dragRef.current?.moved) justDraggedRef.current = true
    dragRef.current = null
  }
  const onClickNode = (n: SimNode) => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return }
    if (n.code && n.code !== centerCode && onSelectRef.current) onSelectRef.current(n.code)
  }

  const byId = byIdRef.current

  if (!hasContent) {
    return <p className="text-sm text-gray-500 py-8 text-center">该设备暂无可展示的关联与问题。</p>
  }

  return (
    <div className="space-y-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto bg-gray-50 rounded-lg border touch-none select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {linksRef.current.map((l, i) => {
          const a = byId.get(l.source); const b = byId.get(l.target)
          if (!a || !b) return null
          return (
            <line key={`e-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#cbd5e1" strokeWidth={1.5} />
          )
        })}
        {nodesRef.current.map((n) => {
          const isCenter = n.kind === 'center'
          const fill = isCenter ? '#2563eb' : n.kind === 'problem' ? '#ef4444' : '#e2e8f0'
          const stroke = isCenter ? '#1d4ed8' : n.kind === 'problem' ? '#b91c1c' : '#64748b'
          const r = isCenter ? 26 : n.kind === 'problem' ? 12 : 14
          const label = n.label.length > 14 ? n.label.slice(0, 14) + '…' : n.label
          return (
            <g
              key={n.id}
              className="cursor-pointer"
              onPointerDown={(e) => onPointerDown(e, n.id)}
              onClick={() => onClickNode(n)}
            >
              <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke={stroke} strokeWidth={1.5} />
              <text x={n.x} y={n.y + 4} textAnchor="middle" className="fill-white text-[11px] font-medium pointer-events-none">
                {isCenter ? '中心' : n.kind === 'problem' ? '!' : ''}
              </text>
              <text x={n.x} y={n.y - r - 4} textAnchor="middle" className="fill-gray-700 text-[10px] pointer-events-none">
                {label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-600" /> 当前设备
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-slate-300 border border-slate-500" /> 关联设备（{Math.max(0, nodesRef.current.length - 1 - problems.length)}）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" /> BA 问题（{problems.length}）
        </span>
        <span className="text-gray-400">可拖拽节点 / 点击节点跳转</span>
      </div>
    </div>
  )
}
