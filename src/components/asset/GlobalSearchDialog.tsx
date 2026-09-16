import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Globe2, Table2, ArrowRight, Search } from 'lucide-react'
import { getGlobalSearch } from '@/features/assets/api'
import type { GlobalSearchResponse } from '@/features/assets/types'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** 预填的查询词（可选，从外部带进来） */
  initialQuery?: string
  /** 点「进入并筛选」→ 跳到目标表并按该词过滤行内搜索 */
  onJump: (targetTableId: number, value: string) => void
}

/**
 * 全局资料表搜索弹窗：输入任意关键词，对每一张启用资料表都搜一遍，
 * 列出「命中哪些表 · 各命中几条 · 命中记录样例」，点表即可跳进该表并预填行内搜索框。
 */
export default function GlobalSearchDialog({ open, onOpenChange, initialQuery = '', onJump }: Props) {
  const [input, setInput] = useState(initialQuery)
  const [data, setData] = useState<GlobalSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时同步外部带入的词，并自动聚焦
  useEffect(() => {
    if (open) {
      setInput(initialQuery)
      setData(null)
      setSearched(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, initialQuery])

  const run = (term: string) => {
    const q = term.trim()
    if (!q) return
    setLoading(true)
    setData(null)
    getGlobalSearch(q)
      .then((d) => { setData(d); setSearched(true) })
      .catch(() => { setData(null); setSearched(true) })
      .finally(() => setLoading(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Globe2 className="w-4 h-4 text-emerald-600" />
            全局资料表搜索
          </DialogTitle>
          <DialogDescription className="text-xs">
            对每一张启用资料表都搜一遍：输入任意编号 / 关键词，立刻看到它散落在哪些表、各命中几条。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              ref={inputRef}
              className="pl-8"
              placeholder="输入编号 / 关键词，例如 WP-B2D4ATx4、5SN9-7…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(input) }}
            />
          </div>
          <Button onClick={() => run(input)} disabled={loading || !input.trim()}>
            {loading ? '搜索中…' : '全部搜索'}
          </Button>
        </div>

        {loading && <p className="text-sm text-gray-400 py-6 text-center">正在逐张资料表搜索…</p>}

        {!loading && searched && data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <Badge variant="secondary">{data.tables_hit} 张表命中</Badge>
              <Badge variant="secondary">{data.total_hits} 条记录</Badge>
              <span>关键词「{data.query}」</span>
            </div>

            {data.tables_hit === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">
                已搜索全部启用资料表，没有命中的记录 —— 换个关键词试试。
              </p>
            ) : (
              data.results.map((t) => (
                <div key={t.table_id} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Table2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="text-sm font-medium text-gray-800 truncate">{t.name}</span>
                    {t.subsystem_name && (
                      <Badge variant="outline" className="text-xs">{t.subsystem_name}</Badge>
                    )}
                    <Badge variant="secondary" className="text-xs ml-auto">{t.hit_count} 条命中</Badge>
                  </div>

                  <div className="mt-2 space-y-1.5">
                    {t.samples.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-gray-400 font-mono shrink-0">#{s.id}</span>
                        {s.fields.map((f, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5"
                            title={`${f.label}`}
                          >
                            <span className="text-gray-400">{f.label}</span>
                            <span className="font-mono text-slate-700">{f.value}</span>
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => { onOpenChange(false); onJump(t.table_id, data.query) }}
                    >
                      进入并筛选 {t.hit_count} 条
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {!loading && !searched && (
          <p className="text-sm text-gray-400 py-6 text-center">
            输入一个编号或关键词，点「全部搜索」即可跨所有资料表检索。
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
