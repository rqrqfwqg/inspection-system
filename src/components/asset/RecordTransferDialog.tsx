import { useEffect, useMemo, useState } from 'react'
import type { DataTable, TransferMapping, TransferResult } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { ArrowRightLeft, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  sourceTable: DataTable | null
  recordIds: number[]
  tables: DataTable[]
  onDone: (result: TransferResult) => void
}

const NONE = '__none__'

const CONF_STYLE: Record<string, { text: string; cls: string }> = {
  exact_key: { text: '字段同名', cls: 'text-emerald-600 border-emerald-300' },
  exact_label: { text: '名称相同', cls: 'text-emerald-600 border-emerald-300' },
  normalized: { text: '名称归一', cls: 'text-blue-600 border-blue-300' },
  relation_key: { text: '关联键', cls: 'text-blue-600 border-blue-300' },
  contains: { text: '名称包含', cls: 'text-amber-600 border-amber-300' },
  type_only: { text: '同类型', cls: 'text-amber-600 border-amber-300' },
  none: { text: '未匹配', cls: 'text-gray-400 border-gray-200' },
}

/**
 * 记录跨表转移（字段映射）
 * ==============
 * 场景：早期分类把部分设备分到了错误的子系统/资料表，需要成批挪到正确的表。
 * 两张表字段定义不一致时，先给自动映射建议（同名/同名归一/关联键/包含/同类型），
 * 允许人工逐字段改，未映射字段可选「丢弃 / 合并到备注 / 保留为扩展信息」，
 * 执行前 dry-run 预览将新建/更新/跳过各多少条。
 */
export default function RecordTransferDialog({
  open,
  onOpenChange,
  sourceTable,
  recordIds,
  tables,
  onDone,
}: Props) {
  const { toast } = useToast()
  const [targetId, setTargetId] = useState<string>('')
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [policy, setPolicy] = useState<'drop' | 'remark' | 'extra'>('extra')
  const [remarkKey, setRemarkKey] = useState<string>('')
  const [mode, setMode] = useState<'move' | 'copy'>('move')
  const [conflict, setConflict] = useState<'skip' | 'update' | 'duplicate'>('skip')

  const [suggestion, setSuggestion] = useState<TransferMapping | null>(null)
  const [preview, setPreview] = useState<TransferResult | null>(null)
  const [loadingMapping, setLoadingMapping] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)

  const candidates = useMemo(
    () => tables.filter((t) => t.id !== sourceTable?.id),
    [tables, sourceTable?.id],
  )

  // 选目标表 → 拉映射建议并初始化映射
  useEffect(() => {
    if (!open || !sourceTable || !targetId) return
    let cancelled = false
    async function load() {
      try {
        setLoadingMapping(true)
        const res = await assetApi.getTransferMapping(sourceTable!.id, Number(targetId))
        if (cancelled) return
        setSuggestion(res)
        const init: Record<string, string | null> = {}
        for (const m of res.matches) init[m.source_key] = m.target_key
        setMapping(init)
        setRemarkKey(res.remark_candidates[0]?.key ?? '')
      } catch (e) {
        if (!cancelled)
          toast({
            title: '获取字段映射失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
      } finally {
        if (!cancelled) setLoadingMapping(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId, sourceTable?.id])

  // 打开时重置
  useEffect(() => {
    if (open) {
      setTargetId('')
      setMapping({})
      setPolicy('extra')
      setRemarkKey('')
      setMode('move')
      setConflict('skip')
      setSuggestion(null)
      setPreview(null)
    }
  }, [open])

  // 参数变化 → dry-run 预览
  useEffect(() => {
    if (!open || !sourceTable || !targetId || recordIds.length === 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        setPreviewing(true)
        const res = await assetApi.transferRecords(sourceTable!.id, {
          target_table_id: Number(targetId),
          record_ids: recordIds,
          mapping,
          unmapped_policy: policy,
          remark_target_key: policy === 'remark' ? remarkKey : null,
          mode,
          on_conflict: conflict,
          dry_run: true,
        })
        if (!cancelled) setPreview(res)
      } catch {
        if (!cancelled) setPreview(null)
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId, mapping, policy, remarkKey, mode, conflict, recordIds.join(',')])

  const mappedCount = Object.values(mapping).filter((v) => v && v !== NONE).length

  const handleRun = async () => {
    if (!sourceTable || !targetId) return
    if (mode === 'move' && !confirm(`确认移动 ${recordIds.length} 条记录？移动后源表将不再保留这些记录。`))
      return
    try {
      setRunning(true)
      const res = await assetApi.transferRecords(sourceTable.id, {
        target_table_id: Number(targetId),
        record_ids: recordIds,
        mapping,
        unmapped_policy: policy,
        remark_target_key: policy === 'remark' ? remarkKey : null,
        mode,
        on_conflict: conflict,
        dry_run: false,
      })
      toast({
        title: '转移完成',
        description: `新建 ${res.created} 条 · 更新 ${res.updated} 条 · 跳过 ${res.skipped} 条`,
      })
      onOpenChange(false)
      onDone(res)
    } catch (e) {
      toast({
        title: '转移失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            数据转移（按字段映射）
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 目标与模式 */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs text-gray-500">目标资料表</p>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择要转移到的表" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                      {t.subsystem_name ? `（${t.subsystem_name}）` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-500">转移方式</p>
              <Select value={mode} onValueChange={(v) => setMode(v as 'move' | 'copy')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="move">移动（源表删除）</SelectItem>
                  <SelectItem value="copy">复制（源表保留）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-500">编号冲突时</p>
              <Select
                value={conflict}
                onValueChange={(v) => setConflict(v as 'skip' | 'update' | 'duplicate')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">跳过（不覆盖）</SelectItem>
                  <SelectItem value="update">覆盖更新已有记录</SelectItem>
                  <SelectItem value="duplicate">仍然新建一条</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            已选 <span className="font-medium text-gray-800">{recordIds.length}</span> 条记录，从
            <span className="font-medium text-gray-800"> {sourceTable?.name} </span>
            转移。
          </p>

          {!targetId ? (
            <div className="py-10 text-center text-sm text-gray-400">
              请先选择目标资料表，系统会自动给出字段映射建议
            </div>
          ) : loadingMapping ? (
            <div className="py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在计算字段映射…
            </div>
          ) : suggestion ? (
            <>
              {/* 字段映射表 */}
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 flex items-center justify-between">
                  <span>字段映射（可手工调整）</span>
                  <span className="text-gray-400">已映射 {mappedCount} / {suggestion.matches.length} 个源字段</span>
                </div>
                <div className="divide-y">
                  {suggestion.matches.map((m) => {
                    const conf = CONF_STYLE[m.confidence] || CONF_STYLE.none
                    const val = mapping[m.source_key] ?? NONE
                    return (
                      <div key={m.source_key} className="flex items-center gap-3 px-3 py-2">
                        <div className="w-44 shrink-0">
                          <p className="text-sm text-gray-800 truncate">{m.source_label}</p>
                          <p className="text-[11px] text-gray-400 font-mono truncate">{m.source_key}</p>
                        </div>
                        <ArrowRightLeft className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                        <div className="w-52 shrink-0">
                          <Select
                            value={val || NONE}
                            onValueChange={(v) =>
                              setMapping((prev) => ({
                                ...prev,
                                [m.source_key]: v === NONE ? null : v,
                              }))
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="不转移" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>不转移</SelectItem>
                              {suggestion.unfilled_targets
                                .concat(
                                  suggestion.matches
                                    .filter((x) => x.target_key)
                                    .map((x) => ({
                                      key: x.target_key as string,
                                      label: x.target_label || (x.target_key as string),
                                      type: null,
                                      required: false,
                                    })),
                                )
                                .map((t) => (
                                  <SelectItem key={t.key} value={t.key}>
                                    {t.label}
                                    {t.required ? '（必填）' : ''}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Badge variant="outline" className={`text-[11px] ${conf.cls}`}>
                          {conf.text}
                        </Badge>
                        <span className="text-[11px] text-gray-400 truncate">{m.reason}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 未映射字段处置 */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">未被映射的源字段</p>
                  <Select
                    value={policy}
                    onValueChange={(v) => setPolicy(v as 'drop' | 'remark' | 'extra')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="extra">保留为扩展信息（推荐，不丢失）</SelectItem>
                      <SelectItem value="remark">合并写入文本字段</SelectItem>
                      <SelectItem value="drop">丢弃</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {policy === 'remark' && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">合并到目标字段</p>
                    <Select value={remarkKey} onValueChange={setRemarkKey}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择文本字段" />
                      </SelectTrigger>
                      <SelectContent>
                        {suggestion.remark_candidates.map((c) => (
                          <SelectItem key={c.key} value={c.key}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {suggestion.unfilled_targets.some((t) => t.required) && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">
                    目标表有必填字段无来源：
                    <span className="font-medium">
                      {suggestion.unfilled_targets
                        .filter((t) => t.required)
                        .map((t) => t.label)
                        .join('、')}
                    </span>
                    。请为其指定来源字段，否则对应记录会被跳过。
                  </p>
                </div>
              )}

              {/* 预览 */}
              <div className="rounded-lg border bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  {previewing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在预览…
                    </>
                  ) : preview ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      预览：新建 {preview.created} 条 · 更新 {preview.updated} 条 · 跳过{' '}
                      {preview.skipped} 条
                      {preview.conflicts > 0 ? `（其中编号冲突 ${preview.conflicts} 条）` : ''}
                    </>
                  ) : (
                    <span className="text-gray-400">暂无预览</span>
                  )}
                </div>
                {preview && preview.skipped_details.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
                    {preview.skipped_details.slice(0, 5).map((s, i) => (
                      <li key={i}>
                        {s.device_code || `#${s.record_id}`}：{s.reason}
                      </li>
                    ))}
                    {preview.skipped > 5 && <li>…另有 {preview.skipped - 5} 条</li>}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleRun}
            disabled={!targetId || loadingMapping || running || recordIds.length === 0}
          >
            {running && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {mode === 'move' ? '移动' : '复制'} {recordIds.length} 条
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
