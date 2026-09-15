import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link2, Table2, ArrowRight } from 'lucide-react'
import { getCrossRefs } from '@/features/assets/api'
import type { CrossRefResponse } from '@/features/assets/types'
import type { RecordItem } from '@/types/asset'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: number
  record: RecordItem | null
  /** 点命中编号 → 跳到目标表并按该值过滤 */
  onJump: (targetTableId: number, value: string) => void
}

/**
 * 跨表字段关联弹窗：拿当前记录的编号值（关联键 / *_code 字段）到其他启用资料表
 * 搜索命中，展示「哪张表 · 哪个字段 · 几条 · 具体编号」，点编号直达目标表。
 */
export default function CrossRefDialog({ open, onOpenChange, tableId, record, onJump }: Props) {
  const [data, setData] = useState<CrossRefResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !record) { setData(null); return }
    let cancelled = false
    setLoading(true)
    getCrossRefs(tableId, record.id)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, record, tableId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-4 h-4 text-indigo-600" />
            跨表关联
            {data?.record && (
              <span className="text-xs font-normal text-gray-400">
                {data.record.table_name} · 记录 #{data.record.id}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            拿本条记录的编号字段值，自动到其他资料表里搜索命中；点具体编号可跳到那张表查看。
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-gray-400 py-6 text-center">正在跨表搜索…</p>}

        {!loading && data && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {data.keys.map((k) => (
                <Badge key={k.value + k.key} variant="outline" className="text-xs font-mono">
                  {k.label}：{k.value}
                </Badge>
              ))}
            </div>

            {data.targets.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                已扫描 {data.scanned} 张资料表，没有命中 —— 这条记录的编号在库内没有跨表关联。
              </p>
            ) : (
              <div className="space-y-3">
                {data.targets.map((t) => (
                  <div key={t.table_id} className="rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Table2 className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="text-sm font-medium text-gray-800 truncate">{t.name}</span>
                      <Badge variant="secondary" className="text-xs">{t.total} 条命中</Badge>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {t.matches.map((m) => (
                        <div key={m.field} className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="text-gray-500 shrink-0">{m.label} × {m.count}</span>
                          {m.values.map((v) => (
                            <button
                              key={v}
                              type="button"
                              className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-indigo-700 hover:bg-indigo-100"
                              title={`拿 ${v} 到「${t.name}」查看`}
                              onClick={() => onJump(t.table_id, v)}
                            >
                              {v}
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-gray-400">
                  共扫描 {data.scanned} 张启用资料表 · 命中 {data.targets.length} 张
                </p>
              </div>
            )}
          </div>
        )}

        {!loading && !data && (
          <p className="text-sm text-gray-400 py-6 text-center">加载失败，请重试</p>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
