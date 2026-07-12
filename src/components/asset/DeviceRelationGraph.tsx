import type { SearchNode, SearchEdge } from '@/types/asset'

interface Props {
  nodes: SearchNode[]
  edges: SearchEdge[]
}

export default function DeviceRelationGraph({ nodes, edges }: Props) {
  if (!nodes.length) return null
  const W = 680
  const H = 460
  const cx = W / 2
  const cy = H / 2

  const maxDepth = Math.max(1, ...nodes.map((n) => n.depth))
  const radius = (d: number) => (d / maxDepth) * (Math.min(W, H) / 2 - 70)

  const byDepth: Record<number, SearchNode[]> = {}
  nodes.forEach((n) => {
    ;(byDepth[n.depth] ||= []).push(n)
  })

  const pos: Record<string, { x: number; y: number }> = {}
  Object.entries(byDepth).forEach(([dStr, list]) => {
    const d = Number(dStr)
    const r = radius(d)
    const n = list.length
    list.forEach((node, i) => {
      if (d === 0) {
        pos[node.device_code] = { x: cx, y: cy }
        return
      }
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2
      pos[node.device_code] = {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      }
    })
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-gray-50 rounded-lg border">
      <defs>
        <marker
          id="rel-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill="#94a3b8" />
        </marker>
      </defs>

      {edges.map((e, i) => {
        const a = pos[e.from]
        const b = pos[e.to]
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        return (
          <g key={`e-${i}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#cbd5e1"
              strokeWidth={1.5}
              markerEnd="url(#rel-arrow)"
            />
            {e.type && (
              <text x={mx} y={my - 4} fontSize={11} fill="#64748b" textAnchor="middle">
                {e.type}
              </text>
            )}
          </g>
        )
      })}

      {nodes.map((n) => {
        const p = pos[n.device_code]
        if (!p) return null
        const isCenter = n.depth === 0
        return (
          <g key={n.device_code}>
            <circle
              cx={p.x}
              cy={p.y}
              r={isCenter ? 26 : 20}
              fill={isCenter ? '#2563eb' : '#ffffff'}
              stroke={isCenter ? '#1d4ed8' : '#94a3b8'}
              strokeWidth={2}
            />
            <text x={p.x} y={p.y - 32} fontSize={11} fill="#334155" textAnchor="middle">
              {n.device_code}
            </text>
            {!isCenter && (
              <text x={p.x} y={p.y + 4} fontSize={10} fill="#334155" textAnchor="middle">
                {n.depth}
              </text>
            )}
            {isCenter && (
              <text x={p.x} y={p.y + 4} fontSize={10} fill="#ffffff" textAnchor="middle">
                {n.name?.slice(0, 4)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
