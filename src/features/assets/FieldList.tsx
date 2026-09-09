/** 将任意值格式化为可读字符串 */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

interface FieldListProps {
  /** 待展示的对象；为 null/undefined 时显示空文案 */
  data?: Record<string, unknown> | null
  emptyText?: string
  /** 列数（响应式网格） */
  columns?: number
}

/**
 * 通用键值列表渲染器。
 * 后端字段名未完全冻结，P0 直接以原始字段名展示，便于后续按需求定制中文标签。
 */
export function FieldList({ data, emptyText = '无', columns = 2 }: FieldListProps) {
  if (!data) return <p className="text-sm text-gray-500">{emptyText}</p>
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length === 0) return <p className="text-sm text-gray-500">{emptyText}</p>
  return (
    <dl
      className="grid gap-x-4 gap-y-1.5 text-sm"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 border-b border-dashed border-gray-100 py-1 min-w-0">
          <dt className="text-gray-500 shrink-0 w-24 truncate" title={k}>
            {k}
          </dt>
          <dd className="text-gray-900 break-all">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  )
}
