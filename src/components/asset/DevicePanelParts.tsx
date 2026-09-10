import type { PowerChainNode } from '@/types/asset'

/** 子系统档案卡：空子系统也显示（虚线灰卡），避免"这台设备不属于任何系统"的误解 */
export function SubsystemCard({
  name,
  count,
  tables,
  onClick,
}: {
  name: string
  count: number
  tables: string[]
  onClick?: () => void
}) {
  const empty = count === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      className={`text-left rounded-lg border p-3 transition-colors ${
        empty
          ? 'border-dashed border-gray-200 opacity-60 cursor-default'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-medium ${empty ? 'text-gray-400' : 'text-gray-900'}`}>
          {name}
        </span>
        <span className={`text-sm font-semibold ${empty ? 'text-gray-300' : 'text-gray-900'}`}>
          {count}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-500 leading-relaxed">
        {empty ? (
          <span className="text-gray-400">暂无资料</span>
        ) : (
          tables.slice(0, 3).map((t) => (
            <div key={t} className="truncate">
              {t}
            </div>
          ))
        )}
      </div>
    </button>
  )
}

/** 供电链路上的设备徽标组（上游 / 下游） */
export function ChainChips({ items, tone }: { items: PowerChainNode[]; tone: 'up' | 'down' }) {
  if (items.length === 0) {
    return <span className="text-xs text-gray-400">无</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((n) => (
        <span
          key={n.device_code}
          className={`px-2 py-1 rounded-md text-xs ${
            tone === 'up' ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-600'
          }`}
          title={n.device_code}
        >
          {n.name || n.device_code}
        </span>
      ))}
    </div>
  )
}
