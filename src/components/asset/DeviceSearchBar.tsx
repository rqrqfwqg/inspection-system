import { useEffect, useRef, useState } from 'react'
import { Search, Database, HardDrive, Tags, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { assetApi } from '@/services/assetApi'
import type { DeviceSuggestItem } from '@/types/asset'

interface Props {
  value: string
  onChange: (v: string) => void
  onSearch: (code?: string) => void
  loading?: boolean
}

/** 来源徽章：区分「已登记主表 / 现场台账 / 别名」——现场台账设备占多数，必须让用户看得见 */
function sourceBadge(item: DeviceSuggestItem) {
  if (item.in_ledger) {
    return (
      <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
        <Database className="w-3 h-3" />
        设备台账
      </Badge>
    )
  }
  if (item.source.startsWith('别名')) {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 font-normal">
        <Tags className="w-3 h-3" />
        别名
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="shrink-0 gap-1 font-normal">
      <HardDrive className="w-3 h-3" />
      现场台账
    </Badge>
  )
}

export default function DeviceSearchBar({ value, onChange, onSearch, loading }: Props) {
  const [items, setItems] = useState<DeviceSuggestItem[]>([])
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  /* 输入防抖取候选：真实台账设备多只存在于 records，必须由后端 suggest 检索而非前端过滤。
     仅在输入框聚焦时弹出——URL 直达（?code=xxx）初始化输入框时不得遮挡下方面板 */
  useEffect(() => {
    const key = value.trim()
    if (key.length < 2) {
      setItems([])
      setOpen(false)
      return
    }
    const seq = ++seqRef.current
    setFetching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await assetApi.suggest(key, 10)
        if (seq !== seqRef.current) return
        setItems(res)
        setOpen(res.length > 0 && document.activeElement === inputRef.current)
      } catch {
        if (seq === seqRef.current) setItems([])
      } finally {
        if (seq === seqRef.current) setFetching(false)
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [value])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
    onSearch(code)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1" ref={boxRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          {fetching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
          )}
          <Input
            ref={inputRef}
            placeholder="搜索设备：编号或名称，如 PDF-107 / 配电房 / 排风机"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => items.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setOpen(false)
                onSearch()
              }
              if (e.key === 'Escape') setOpen(false)
            }}
            className="pl-10"
          />
          {open && items.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-input bg-background shadow-sm max-h-80 overflow-y-auto">
              {items.map((it) => (
                <button
                  key={it.code}
                  type="button"
                  onClick={() => pick(it.code)}
                  className="w-full text-left px-3 py-2 hover:bg-accent border-b border-border/50 last:border-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{it.code}</span>
                    {sourceBadge(it)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                    {it.name && <span className="truncate">{it.name}</span>}
                    {it.subsystem_name && <span>· {it.subsystem_name}</span>}
                    {it.tables && it.tables.length > 0 && (
                      <span className="truncate">· {it.tables.slice(0, 2).join(' / ')}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button onClick={() => onSearch()} disabled={loading}>
          {loading ? '检索中...' : '检索设备'}
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        支持设备编号、名称关键字与编号别名（移交编号 / 资产代码 / BIM 标签）模糊检索。
        真实台账设备（电柜、机房、BA 设备）多数未登记设备台账，同样可检索。
      </p>
    </div>
  )
}
