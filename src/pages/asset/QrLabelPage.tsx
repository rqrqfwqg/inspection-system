import * as React from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Search, Printer, X, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { APP_BASE } from '@/config'
import { scanSubsystems, scanListDevices } from '@/features/scan/api'
import type { ScanSubsystem, QrDeviceRow } from '@/features/scan/types'

const MAX_LOAD = 3000
const MAX_SELECT = 300

/**
 * 二维码标签打印页（P0）：
 * 按 楼栋/楼层/子系统/关键词 筛选设备 → 勾选 → 生成「扫码直达页」二维码标签 → A4 批量打印。
 * 二维码内容 = https://<origin>/ops/qr/<encodeURIComponent(编号)>，微信/相机扫后直达现场设备卡。
 */
export default function QrLabelPage() {
  const { toast } = useToast()
  const [subsystems, setSubsystems] = React.useState<ScanSubsystem[]>([])
  const [rows, setRows] = React.useState<QrDeviceRow[]>([])
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [loading, setLoading] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [filter, setFilter] = React.useState({ building: '', floor: '', subsystem_id: '', q: '' })
  const [printOpen, setPrintOpen] = React.useState(false)

  React.useEffect(() => {
    scanSubsystems().then(setSubsystems).catch(() => undefined)
  }, [])

  const query = async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const out: QrDeviceRow[] = []
      let skip = 0
      // 循环分页到 MAX_LOAD 上限（后端单次 limit≤1000）
      while (skip < MAX_LOAD) {
        const batch = await scanListDevices({
          building: filter.building.trim() || undefined,
          floor: filter.floor.trim() || undefined,
          subsystem_id: filter.subsystem_id ? Number(filter.subsystem_id) : undefined,
          q: filter.q.trim() || undefined,
          limit: 1000,
          skip,
        })
        out.push(...batch)
        if (batch.length < 1000) break
        skip += batch.length
      }
      setRows(out)
      setLoaded(true)
      toast({ title: `加载完成`, description: `共 ${out.length} 台设备（上限 ${MAX_LOAD}）` })
    } catch (e) {
      toast({ title: '加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allChecked = rows.length > 0 && selected.size === rows.length
  const toggleAll = () => {
    if (allChecked) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.slice(0, MAX_SELECT).map((r) => r.id)))
    }
  }
  const labels = rows.filter((r) => selected.has(r.id))

  const qrUrl = (code: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}${APP_BASE}/qr/${encodeURIComponent(code)}`
  }

  const openPrint = () => {
    if (labels.length === 0) {
      toast({ title: '请先勾选设备', variant: 'destructive' })
      return
    }
    setPrintOpen(true)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">二维码标签打印</h1>
        <p className="text-gray-500 mt-1 text-sm">
          筛选并勾选设备，打印「扫码直达」二维码标签贴到现场——扫码即打开该设备卡，用于位置/照片/供配电补录与关联。
        </p>
      </div>

      <Card className="no-print">
        <CardHeader className="py-3"><CardTitle className="text-sm">筛选条件</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <select
            value={filter.subsystem_id}
            onChange={(e) => setFilter((f) => ({ ...f, subsystem_id: e.target.value }))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">全部子系统</option>
            {subsystems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Input value={filter.building} onChange={(e) => setFilter((f) => ({ ...f, building: e.target.value }))} placeholder="楼栋，如 GTC / 东停车楼" />
          <Input value={filter.floor} onChange={(e) => setFilter((f) => ({ ...f, floor: e.target.value }))} placeholder="楼层，如 2F / B1" />
          <Input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="编号/名称关键词" />
          <Button onClick={query} disabled={loading} variant="secondary">
            <Search className="w-4 h-4 mr-2" />查询
          </Button>
        </CardContent>
      </Card>

      <Card className="no-print">
        <CardHeader className="py-3 flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">设备清单{loaded && <span className="ml-2 text-gray-400 font-normal">命中 {rows.length} · 已选 {selected.size}</span>}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleAll}>
              {allChecked ? <CheckSquare className="w-4 h-4 mr-1 text-blue-600" /> : <Square className="w-4 h-4 mr-1" />}
              {allChecked ? '取消全选' : '全选'}
            </Button>
            <Button size="sm" onClick={openPrint}>
              <Printer className="w-4 h-4 mr-2" />打印标签（{labels.length}）
            </Button>
          </div>
        </CardHeader>
        <CardContent className="max-h-[46vh] overflow-auto">
          {!loaded && !loading && <p className="text-sm text-gray-400">输入条件后点“查询”。一次最多加载 {MAX_LOAD} 台、勾选 {MAX_SELECT} 张。</p>}
          {loading && <p className="text-sm text-gray-400 animate-pulse">加载中，请稍候</p>}
          {loaded && rows.length === 0 && <p className="text-sm text-gray-400">无匹配设备</p>}
          <div className="divide-y divide-gray-100">
            {rows.map((r) => (
              <label key={r.id} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-blue-600 w-4 h-4 shrink-0" />
                <span className="font-mono text-sm text-gray-800 w-44 truncate shrink-0">{r.device_code}</span>
                <span className="text-sm text-gray-700 flex-1 truncate">{r.name}</span>
                {r.subsystem_name && <Badge variant="outline" className="shrink-0 font-normal hidden md:inline-flex">{r.subsystem_name}</Badge>}
                <span className="text-xs text-gray-500 w-28 text-right truncate shrink-0">
                  {[r.building, r.floor].filter(Boolean).join(' ')}
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {printOpen && createPortal(
        <div className="labels-sheet bg-white" data-print-root>
          <div className="no-print sticky top-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between z-10">
            <span className="text-sm text-gray-700">标签预览（{labels.length} 张 · 打印纸选 A4 横向）</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPrintOpen(false)}><X className="w-4 h-4 mr-1" />关闭</Button>
              <Button size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />打印</Button>
            </div>
          </div>
          <div className="labels-grid p-4">
            {labels.map((r) => (
              <div key={r.id} className="label-cell">
                <QRCodeSVG value={qrUrl(r.device_code)} size={104} level="M" marginSize={1} />
                <div className="label-text">
                  <p className="label-code">{r.device_code}</p>
                  <p className="label-name">{r.name}</p>
                  <p className="label-pos">{[r.building, r.floor, r.location_desc].filter(Boolean).join(' ')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
