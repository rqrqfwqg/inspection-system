import * as React from 'react'
import {
  Upload, FileSpreadsheet, Database, AlertCircle, RefreshCw, Clock,
  CheckCircle2, Loader2, Trash2, Eye,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { getImportBatches, getImportTemplates, uploadImport } from './api'
import type { ImportBatch, ImportTemplate, ImportResult } from './types'

const SOURCE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'fixed_assets', label: '固定资产清单' },
  { value: 'device_archive', label: '设备档案明细' },
  { value: 'ba_system', label: 'BA 系统设备' },
  { value: 'rooms', label: '机房信息汇总' },
]

interface PendingFile {
  id: string
  file: File
  sourceType: string
}

interface FileResult extends ImportResult {
  id: string
  filename: string
  ok: boolean
  error?: string
}

function fmt(ts?: string): string {
  if (!ts) return '—'
  return ts.replace('T', ' ').slice(0, 19)
}

const TEMPLATE_LABEL: Record<string, string> = {
  fixed_assets: '固定资产清单',
  device_archive: '设备档案明细',
  ba_system: 'BA 系统设备',
  rooms: '机房信息汇总',
  unknown: '未识别',
}

export function ImportCenterPage() {
  const { toast } = useToast()
  const [batches, setBatches] = React.useState<ImportBatch[]>([])
  const [templates, setTemplates] = React.useState<ImportTemplate[]>([])
  const [pending, setPending] = React.useState<PendingFile[]>([])
  const [results, setResults] = React.useState<FileResult[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [dragActive, setDragActive] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const refresh = React.useCallback(() => {
    getImportBatches().then(setBatches).catch(() => setBatches([]))
  }, [])

  React.useEffect(() => {
    let cancelled = false
    Promise.all([getImportBatches(), getImportTemplates()])
      .then(([b, t]) => {
        if (!cancelled) {
          setBatches(b)
          setTemplates(t)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const next: PendingFile[] = []
    for (const f of Array.from(list)) {
      if (!f.name.toLowerCase().endsWith('.xlsx') && !f.name.toLowerCase().endsWith('.xls')) {
        toast({ title: '仅支持 Excel 文件', description: f.name, variant: 'destructive' })
        continue
      }
      next.push({ id: `${Date.now()}-${f.name}-${Math.random()}`, file: f, sourceType: 'auto' })
    }
    setPending((p) => [...p, ...next])
    setResults([])
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    addFiles(e.dataTransfer.files)
  }

  const runImport = async (dryRun: boolean) => {
    if (pending.length === 0) {
      toast({ title: '请先选择文件', variant: 'destructive' })
      return
    }
    setBusy(true)
    const out: FileResult[] = []
    try {
      for (const p of pending) {
        try {
          const res = await uploadImport(p.file, {
            sourceType: p.sourceType === 'auto' ? undefined : p.sourceType,
            dryRun,
          })
          out.push({ ...res, id: p.id, filename: p.file.name, ok: true })
        } catch (err) {
          out.push({
            id: p.id, filename: p.file.name, ok: false,
            error: err instanceof Error ? err.message : '未知错误',
          })
        }
      }
      setResults(out)
      const failed = out.filter((r) => !r.ok).length
      if (dryRun) {
        toast({
          title: failed ? '校验完成（有失败）' : '校验通过',
          description: `共 ${out.length} 个文件，${failed} 个失败`,
          variant: failed ? 'destructive' : 'default',
        })
      } else {
        refresh()
        toast({
          title: failed ? '导入完成（有失败）' : '导入成功',
          description: `共 ${out.length} 个文件，${failed} 个失败`,
          variant: failed ? 'destructive' : 'default',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />数据导入中心
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>
            上传 Excel 即自动识别模板并写入系统（支持固定资产清单 / 设备档案明细 / BA 系统设备 / 机房信息汇总）。
            重复导入按设备编号幂等更新，不会重复建记录。建议先「校验」再「确认导入」。
          </p>

          {/* 拖拽上传区 */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{ cursor: 'pointer' }}
          >
            <Upload className="w-8 h-8 mx-auto text-gray-400" />
            <p className="mt-2 text-gray-600">点击或拖拽 Excel 文件到此处（可多选）</p>
            <p className="text-xs text-gray-400">.xlsx / .xls，单文件 ≤ 50MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {/* 已选文件列表 */}
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-2 border rounded px-3 py-2">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="flex-1 truncate text-gray-800 text-sm">{p.file.name}</span>
                  <span className="text-xs text-gray-400">{(p.file.size / 1024).toFixed(0)} KB</span>
                  <select
                    value={p.sourceType}
                    onChange={(e) => setPending((arr) =>
                      arr.map((x) => (x.id === p.id ? { ...x, sourceType: e.target.value } : x)))}
                    className="text-xs border rounded px-1 py-1"
                  >
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    className="text-gray-400 hover:text-red-500"
                    onClick={() => setPending((arr) => arr.filter((x) => x.id !== p.id))}
                    title="移除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button onClick={() => runImport(true)} disabled={busy} variant="outline">
                  {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
                  校验（不落库）
                </Button>
                <Button onClick={() => runImport(false)} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                  确认导入
                </Button>
                <Button variant="ghost" onClick={() => { setPending([]); setResults([]) }} disabled={busy}>
                  清空
                </Button>
              </div>
            </div>
          )}

          {/* 导入结果 */}
          {results.length > 0 && (
            <div className="space-y-2">
              <div className="font-medium text-gray-700">导入结果</div>
              {results.map((r) => (
                <div
                  key={r.id}
                  className={`border rounded px-3 py-2 text-sm ${
                    r.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {r.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="font-medium text-gray-800 truncate">{r.filename}</span>
                    {r.dry_run && <Badge variant="secondary">校验</Badge>}
                    {r.ok && r.template && (
                      <Badge variant="outline">{TEMPLATE_LABEL[r.template] ?? r.template}</Badge>
                    )}
                  </div>
                  {r.ok ? (
                    <div className="mt-1 text-gray-600">
                      主设备/记录 <span className="font-semibold">{r.rows ?? 0}</span> 条
                      {typeof r.accessory_rows === 'number' && r.accessory_rows > 0 && (
                        <>, 配件 <span className="font-semibold">{r.accessory_rows}</span> 条</>
                      )}
                      {r.batches && r.batches.length > 1 && (
                        <span className="text-gray-400">（{r.batches.length} 个分表）</span>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-red-600">{r.error}</div>
                  )}
                  {r.warnings && r.warnings.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-xs text-amber-600">
                      {r.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                      {r.warnings.length > 5 && <li>…等 {r.warnings.length} 条提示</li>}
                    </ul>
                  )}
                  {r.errors && r.errors.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-xs text-red-600">
                      {r.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 支持的模板说明 */}
      {templates.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">支持的模板</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {templates.filter((t) => t.key !== 'unknown').map((t) => (
                <div key={t.key} className="flex items-start gap-2 border rounded px-3 py-2">
                  <Database className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium text-gray-800">{TEMPLATE_LABEL[t.key] ?? t.key}</div>
                    <div className="text-xs text-gray-500">{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">导入批次</CardTitle>
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4 mr-1" />刷新
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-400">加载中…</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-gray-400">暂无导入批次记录。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-3 font-medium">批次名</th>
                    <th className="py-2 pr-3 font-medium">类型</th>
                    <th className="py-2 pr-3 font-medium text-right">文件数</th>
                    <th className="py-2 pr-3 font-medium text-right">行数</th>
                    <th className="py-2 pr-3 font-medium">状态</th>
                    <th className="py-2 pr-3 font-medium">开始时间</th>
                    <th className="py-2 font-medium">结束时间</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => {
                    const st = (b.status ?? 'done') === 'done'
                      ? { label: '完成', variant: 'success' as const }
                      : (b.status ?? 'done') === 'partial'
                      ? { label: '部分', variant: 'warning' as const }
                      : { label: '失败', variant: 'destructive' as const }
                    return (
                      <tr key={b.id ?? i} className="border-b border-dashed border-gray-100">
                        <td className="py-2 pr-3 font-medium text-gray-800">{String(b.batch_name ?? '—')}</td>
                        <td className="py-2 pr-3 text-gray-600">{String(b.source_type ?? '—')}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{b.file_count ?? 0}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{b.row_count ?? 0}</td>
                        <td className="py-2 pr-3"><Badge variant={st.variant}>{st.label}</Badge></td>
                        <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />{fmt(b.started_at as string | undefined)}
                          </span>
                        </td>
                        <td className="py-2 text-gray-500 whitespace-nowrap">{fmt(b.finished_at as string | undefined)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
