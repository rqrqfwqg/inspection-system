import { Badge } from '@/components/ui/badge'
import { Cpu, Hand } from 'lucide-react'
import type { DeviceLinkEdge } from './types'

/** 对端类别徽标文案（与 RelationGraph 的 KIND_LABEL 同口径） */
const OTHER_KIND_LABEL: Record<string, string> = {
  device: '设备',
  room: '机房',
  record: '资料编号',
  unknown: '未知',
}

interface LinkEdgeGroupProps {
  title: string
  /** cyan = 自动关联 / slate = 人工关联 */
  tone: 'cyan' | 'slate'
  edges: DeviceLinkEdge[]
  /** 点击对端编号时切换当前查看对象 */
  onNavigate: (code: string) => void
}

/**
 * 关联边分组列表（自动 / 人工分列）。
 *
 * 每条边展示：关系类型 + 对端类别 + 方向 + 对端编号 + 对端名称 + 命中规则 + 判定证据，
 * 点编号即可下钻到对端（台账设备 / 电柜 / 配电箱 / 图纸回路 都能接得上）。
 */
export function LinkEdgeGroup({ title, tone, edges, onNavigate }: LinkEdgeGroupProps) {
  const tones = {
    cyan: {
      bar: 'border-l-cyan-400',
      badge: 'bg-cyan-100 text-cyan-800 border-cyan-200',
      text: 'text-cyan-700',
    },
    slate: {
      bar: 'border-l-gray-300',
      badge: 'bg-gray-100 text-gray-700 border-gray-200',
      text: 'text-gray-600',
    },
  } as const
  const t = tones[tone]
  return (
    <div className="space-y-1.5">
      <div className={`text-xs font-medium flex items-center gap-1.5 ${t.text}`}>
        {tone === 'cyan' ? <Cpu className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
        {title}（{edges.length}）
      </div>
      {edges.map((e) => (
        <div key={e.id} className={`border-l-2 ${t.bar} pl-3 py-1 space-y-0.5`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={`text-[10px] ${t.badge}`}>
              {e.relation_type}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {OTHER_KIND_LABEL[e.other_kind] || '未知'}
            </Badge>
            <span className="text-gray-500 text-xs">{e.direction === 'out' ? '→' : '←'}</span>
            <button
              type="button"
              className="font-mono text-gray-800 hover:text-blue-600 hover:underline"
              onClick={() => onNavigate(e.other_code)}
            >
              {e.other_code}
            </button>
            {e.other_name && <span className="text-gray-500 text-xs">{e.other_name}</span>}
            {e.rule && <span className="text-[10px] text-gray-400">规则 {e.rule}</span>}
          </div>
          {e.evidence && <div className="text-[11px] text-gray-400 leading-relaxed">{e.evidence}</div>}
        </div>
      ))}
    </div>
  )
}
