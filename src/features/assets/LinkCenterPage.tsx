import * as React from 'react'
import {
  Link2, Sparkles, Hand, RefreshCw, Play, Undo2, AlertTriangle, Eye,
  ArrowRight, Search as SearchIcon, CheckCircle2, Info, Database, Cpu, Inbox,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  getAutoRules, runAutoAssociate, rollbackAutoAssociate,
  getManualQueue, manualAssociate, getLinkOverview, getRelations,
} from './api'
import type {
  AutoRulesResponse, AutoAssociatePreview, AutoAssociateResult,
  ManualQueueResponse, LinkOverview, RelationEdge,
} from './types'

/**
 * 联动中心 —— 「资产可视化 ↔ 数据表管理 ↔ 关联」三者的操作台。
 *
 * 解决两件事：
 *  1) **自动/预先关联**：规则引擎只做确定性编号等值匹配，每条候选带证据；
 *     执行前可预览（dry_run），执行后按批次可整批回滚，绝不污染人工数据。
 *  2) **无法自动关联的兜底**：未解析编号进入待办队列，桌面建边；
 *     现场则由小程序扫码建边，两边写同一张表、同一套来源标注（manual）。
 *
 * 界面上 自动关联（青色）/ 人工关联（灰色）**始终成对出现、颜色与图标固定**，
 * 避免用户分不清某条边是谁建立的。
 */
export default function LinkCenterPage() {
  const { toast } = useToast()
  const [overview, setOverview] = React.useState<LinkOverview | null>(null)
  const [rules, setRules] = React.useState<AutoRulesResponse | null>(null)
  const [queue, setQueue] = React.useState<ManualQueueResponse | null>(null)
  const [relations, setRelations] = React.useState<RelationEdge[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<AutoAssociatePreview | null>(null)
  const [lastBatch, setLastBatch] = React.useState<AutoAssociateResult | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [ov, ru, mq, rel] = await Promise.all([
        getLinkOverview(), getAutoRules(), getManualQueue({ limit: 30 }), getRelations(),
      ])
      setOverview(ov)
      setRules(ru)
      setQueue(mq)
      setRelations(rel)
    } catch (e) {
      toast({
        title: '加载联动数据失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void load() }, [load])

  // ---- 自动关联：预览 ----
  const doPreview = async () => {
    setBusy('preview')
    try {
      const r = (await runAutoAssociate({ dryRun: true })) as AutoAssociatePreview
      setPreview(r)
      toast({
        title: `预览完成：将新建 ${r.would_create} 条自动关联`,
        description: `已存在跳过 ${r.already_linked} 条，自环剔除 ${r.skipped_self_loop} 条（未写库）`,
      })
    } catch (e) {
      toast({ title: '预览失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  // ---- 自动关联：执行 ----
  const doApply = async (ruleIds?: string[]) => {
    setBusy(ruleIds ? ruleIds.join(',') : 'apply')
    try {
      const r = (await runAutoAssociate({ ruleIds })) as AutoAssociateResult
      setLastBatch(r)
      setPreview(null)
      toast({
        title: `自动关联完成：新建 ${r.created} 条`,
        description: `批次 ${r.batch}；已存在跳过 ${r.already_linked} 条、自环剔除 ${r.skipped_self_loop} 条`,
      })
      await load()
    } catch (e) {
      toast({ title: '执行失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  // ---- 自动关联：回滚 ----
  const doRollback = async (opts: { batch?: string; rule?: string }) => {
    setBusy('rollback')
    try {
      const r = await rollbackAutoAssociate(opts)
      toast({ title: `已回滚 ${r.deleted} 条自动关联`, description: '人工关联不受影响' })
      setLastBatch(null)
      await load()
    } catch (e) {
      toast({ title: '回滚失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const g = overview?.global
  const src = overview?.relations_by_source
  const autoTypes = src?.auto_by_type || {}
  const manualByType: Record<string, number> = {}
  for (const r of overview?.relations || []) {
    manualByType[r.type] = Math.max(0, r.count - (autoTypes[r.type] || 0))
  }
  const typeRows = Array.from(new Set([...Object.keys(autoTypes), ...Object.keys(manualByType)]))
    .map((t) => ({ type: t, auto: autoTypes[t] || 0, manual: manualByType[t] || 0 }))
    .sort((a, b) => b.auto + b.manual - (a.auto + a.manual))

  return (
    <div className="space-y-4">
      {/* ============ 顶部指标 ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Database className="w-4 h-4" />} tone="slate"
          label="资料记录" value={fmt(g?.records)}
          sub={`${fmt(g?.tables)} 张资料表 · 关联命中 ${fmt(g?.resolved_devices)} 条`}
          loading={loading}
        />
        <StatCard
          icon={<Cpu className="w-4 h-4" />} tone="cyan"
          label="自动关联" value={fmt(g?.relations_auto)}
          sub={`${(rules?.rules || []).filter((r) => r.candidates > 0).length} 条规则命中 · 可回滚`}
          loading={loading}
        />
        <StatCard
          icon={<Hand className="w-4 h-4" />} tone="slate"
          label="人工关联" value={fmt(g?.relations_manual)}
          sub={`含历史导入未标注 ${fmt(g?.relations_unmarked)} 条`}
          loading={loading}
        />
        <StatCard
          icon={<Inbox className="w-4 h-4" />} tone="amber"
          label="待人工处理" value={fmt(queue?.total_unresolved_codes)}
          sub="无法自动关联的编号（可小程序现场建边）"
          loading={loading}
        />
      </div>

      {/* ============ 自动关联 ============ */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-cyan-600" />
              自动关联（预先关联）
            </CardTitle>
            <CardDescription className="mt-1">
              只做<b>确定性编号等值匹配</b>，不做模糊猜测；每条候选都带判定证据，先预览再执行，
              执行结果按批次可整批回滚。
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={doPreview} disabled={!!busy}>
              {busy === 'preview' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              <span className="ml-1">预览候选</span>
            </Button>
            <Button size="sm" onClick={() => doApply()} disabled={!!busy || !rules?.total_pending}>
              <Play className="w-4 h-4" />
              <span className="ml-1">执行全部（{fmt(rules?.total_pending)}）</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-3">
                {(rules?.rules || []).map((r) => (
                  <div key={r.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {r.name}
                        <Badge variant="outline" className="text-cyan-700 border-cyan-300 bg-cyan-50">
                          {r.relation_type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost" size="sm"
                        disabled={!!busy || !r.pending}
                        onClick={() => doApply([r.id])}
                      >
                        {busy === r.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        <span className="ml-1 text-xs">执行 {r.pending}</span>
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{r.basis}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-gray-600">候选 <b>{fmt(r.candidates)}</b></span>
                      <span className="text-cyan-700">待建 <b>{fmt(r.pending)}</b></span>
                      <span className="text-gray-400">已存在 {fmt(r.already_linked)}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {r.domain === 'records' ? '资料域编号' : r.domain}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              {/* 自环剔除 —— 如实呈现，不静默丢弃 */}
              {!!rules?.skipped_self_loop && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    已剔除 {rules.skipped_self_loop} 条「自己连自己」的候选
                  </div>
                  <p className="mt-1 leading-relaxed">
                    原因：同一编号同时存在于电柜表与配电箱表，两端同号建边无意义。
                    例：
                    {(rules.skipped_sample || []).slice(0, 3).map((s) => s.from_code).join('、')}
                  </p>
                </div>
              )}

              {/* 预览结果 */}
              {preview && (
                <div className="rounded-lg border bg-cyan-50/50 p-3 space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Eye className="w-4 h-4 text-cyan-700" />
                    预览：将新建 {preview.would_create} 条
                    <span className="text-xs font-normal text-gray-500">
                      （待建合计 {preview.pending_total}，已存在 {preview.already_linked}，自环 {preview.skipped_self_loop}）
                    </span>
                  </div>
                  <div className="max-h-56 overflow-auto rounded border bg-white divide-y">
                    {(preview.sample || []).map((s, i) => (
                      <div key={i} className="px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 font-mono text-gray-700">
                          <span>{s.from_code}</span>
                          <ArrowRight className="w-3 h-3 text-cyan-600" />
                          <span>{s.to_code}</span>
                          <Badge variant="outline" className="ml-auto text-[10px]">{s.relation_type}</Badge>
                        </div>
                        <div className="text-gray-500 mt-0.5">{s.evidence}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">仅展示前 {preview.sample?.length || 0} 条样本；执行后可在下方按批次回滚。</p>
                </div>
              )}

              {/* 最近一次执行 + 回滚 */}
              {lastBatch && (
                <div className="rounded-lg border bg-white p-3 flex flex-wrap items-center gap-3 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>本次批次 <b className="font-mono">{lastBatch.batch}</b> 新建 <b>{lastBatch.created}</b> 条</span>
                  <span className="text-gray-500">
                    {Object.entries(lastBatch.by_rule).map(([k, v]) => `${k} ${v}`).join(' · ')}
                  </span>
                  <Button
                    variant="outline" size="sm" className="ml-auto"
                    disabled={!!busy}
                    onClick={() => doRollback({ batch: lastBatch.batch })}
                  >
                    <Undo2 className="w-3.5 h-3.5" /><span className="ml-1">撤销本批</span>
                  </Button>
                </div>
              )}

              {!!src?.auto && (
                <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>库内自动关联 {fmt(src.auto)} 条</span>
                  <span>按规则：{Object.entries(src.auto_by_rule).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</span>
                  <Button
                    variant="ghost" size="sm" className="h-6 px-2 text-rose-600 hover:text-rose-700"
                    disabled={!!busy}
                    onClick={() => doRollback({})}
                  >
                    <Undo2 className="w-3 h-3 mr-1" />全部回滚
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ============ 关联来源对照 ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-4 h-4 text-gray-600" />
            关联来源对照
            <Badge variant="outline" className="text-cyan-700 border-cyan-300 bg-cyan-50">自动</Badge>
            <Badge variant="outline" className="text-gray-600">人工</Badge>
          </CardTitle>
          <CardDescription>同一种关系类型下，自动关联与人工关联各有多少 —— 用于判断哪些链路已可自动维护。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-32 w-full" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="py-2 pr-4 font-medium">关系类型</th>
                    <th className="py-2 pr-4 font-medium w-40">自动</th>
                    <th className="py-2 pr-4 font-medium w-40">人工</th>
                    <th className="py-2 font-medium w-20 text-right">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {typeRows.length === 0 ? (
                    <tr><td colSpan={4} className="py-6 text-center text-gray-400">暂无关联数据</td></tr>
                  ) : typeRows.map((r) => {
                    const max = Math.max(1, ...typeRows.map((x) => Math.max(x.auto, x.manual)))
                    return (
                      <tr key={r.type} className="border-b last:border-0">
                        <td className="py-2 pr-4">{r.type}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 rounded bg-cyan-500" style={{ width: `${(r.auto / max) * 100}%`, minWidth: r.auto ? 4 : 0 }} />
                            <span className="text-xs text-cyan-700 tabular-nums">{r.auto}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 rounded bg-gray-400" style={{ width: `${(r.manual / max) * 100}%`, minWidth: r.manual ? 4 : 0 }} />
                            <span className="text-xs text-gray-600 tabular-nums">{r.manual}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-700">{r.auto + r.manual}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ 待人工关联 ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hand className="w-4 h-4 text-amber-600" />
            待人工关联（无法自动关联）
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            <Info className="w-3.5 h-3.5" />
            这些编号在设备台账与机房表中都找不到对应。桌面可在此建边；
            现场可用小程序「扫码关联」直接扫两端编号建边，写入结果与这里完全一致（均标记为人工关联）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ManualCreateForm
            busy={!!busy}
            onSubmit={async (from, to, rtype, note) => {
              setBusy('manual')
              try {
                const r = await manualAssociate({ fromCode: from, toCode: to, relationType: rtype, note, operator: 'web' })
                toast({
                  title: '人工关联已建立',
                  description: `${r.from.code} → ${r.to.code} · ${r.relation_type}`,
                })
                await load()
              } catch (e) {
                toast({ title: '建边失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
              } finally {
                setBusy(null)
              }
            }}
          />

          {loading ? <Skeleton className="h-40 w-full" /> : (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs text-gray-600 flex items-center justify-between">
                <span>未解析编号 TOP（共 {fmt(queue?.total_unresolved_codes)} 个）</span>
                <span>{queue?.items.length || 0} 条待处理</span>
              </div>
              <div className="max-h-96 overflow-auto divide-y">
                {(queue?.items || []).map((it) => (
                  <div key={it.code} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{it.code}</span>
                      <Badge variant="secondary" className="text-[10px]">{it.records} 条记录</Badge>
                      {it.tables.slice(0, 3).map((t) => (
                        <Badge key={t.table_id} variant="outline" className="text-[10px]">{t.name}</Badge>
                      ))}
                      {it.tables.length > 3 && (
                        <span className="text-[10px] text-gray-400">+{it.tables.length - 3}</span>
                      )}
                    </div>
                    {it.sample && Object.keys(it.sample).length > 0 && (
                      <div className="text-xs text-gray-500 line-clamp-2">
                        {Object.entries(it.sample).slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join('；')}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <SearchIcon className="w-3 h-3" />候选：
                      </span>
                      {it.suggestions.length === 0 ? (
                        <span className="text-xs text-gray-400">无相近编号，需现场确认</span>
                      ) : it.suggestions.map((s) => (
                        <Button
                          key={s.code} variant="outline" size="sm" className="h-6 px-2 text-xs"
                          disabled={!!busy}
                          title={`${s.reason}（${s.kind === 'device' ? '设备' : '机房'}）`}
                          onClick={() => {
                            const el = document.getElementById('manual-from') as HTMLInputElement | null
                            const el2 = document.getElementById('manual-to') as HTMLInputElement | null
                            if (el) el.value = s.code
                            if (el2) el2.value = it.code
                            toast({ title: '已填入建边表单', description: `${s.code} → ${it.code}（${s.reason}）` })
                          }}
                        >
                          {s.code}
                          <span className="ml-1 text-[10px] text-gray-400">{s.kind === 'device' ? '设备' : '机房'}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
                {(queue?.items || []).length === 0 && (
                  <div className="py-8 text-center text-sm text-gray-400">暂无待人工关联的编号</div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ 最近关联边（来源可辨） ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-4 h-4" />
            最近关联边
            <span className="text-xs font-normal text-gray-400">共 {fmt(relations.length)} 条</span>
          </CardTitle>
          <CardDescription>自动关联为青色、人工关联为灰色 —— 每条边都能看出是谁建立的。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <div className="max-h-80 overflow-auto rounded-lg border divide-y">
              {relations.slice(0, 60).map((r) => {
                const meta = (r.meta || {}) as Record<string, unknown>
                const isAuto = String(meta.source || '').toLowerCase() === 'auto'
                return (
                  <div key={r.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                    {isAuto
                      ? <Badge className="bg-cyan-100 text-cyan-800 hover:bg-cyan-100 border-cyan-200">自动</Badge>
                      : <Badge variant="secondary">人工</Badge>}
                    <span className="font-mono text-gray-700">{r.from_code}</span>
                    <ArrowRight className="w-3 h-3 text-gray-400" />
                    <span className="font-mono text-gray-700">{r.to_code}</span>
                    <Badge variant="outline" className="text-[10px]">{r.relation_type}</Badge>
                    {isAuto && meta.rule ? (
                      <span className="text-gray-400">规则 {String(meta.rule)}</span>
                    ) : null}
                    {isAuto && meta.evidence ? (
                      <span className="text-gray-400 truncate max-w-md" title={String(meta.evidence)}>{String(meta.evidence)}</span>
                    ) : null}
                  </div>
                )
              })}
              {relations.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">暂无关联边</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ==================== 子组件 ====================

function StatCard({
  icon, label, value, sub, tone, loading,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone: 'cyan' | 'slate' | 'amber'
  loading?: boolean
}) {
  const tones = {
    cyan: 'bg-cyan-50 text-cyan-700',
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-50 text-amber-700',
  } as const
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${tones[tone]}`}>{icon}</span>
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-2" />
        ) : (
          <div className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{value}</div>
        )}
        {sub && <div className="text-xs text-gray-500 mt-1 leading-relaxed">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function ManualCreateForm({
  busy, onSubmit,
}: {
  busy: boolean
  onSubmit: (from: string, to: string, rtype: string, note: string) => Promise<void>
}) {
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [rtype, setRtype] = React.useState('关联')
  const [note, setNote] = React.useState('')

  const TYPES = ['供电', '供配电', '取电', '上级配电', '冷源', '所在机房', '网络', '控制', '管路连接', '配件从属', '关联']

  return (
    <div className="rounded-lg border bg-gray-50/60 p-3">
      <div className="text-sm font-medium mb-2 flex items-center gap-2">
        <Hand className="w-4 h-4 text-amber-600" />
        手工建边
        <span className="text-xs font-normal text-gray-500">两端可以是设备、机房，或资料里的编号</span>
      </div>
      <div className="grid md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">起点编号</Label>
          <Input id="manual-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="如 G-1D1AL" className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">终点编号</Label>
          <Input id="manual-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="如 GE1F-KTJF-101" className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">关系类型</Label>
          <Select value={rtype} onValueChange={setRtype}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">说明（可选）</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="现场确认依据" className="h-9" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !from.trim() || !to.trim()}
          onClick={async () => {
            await onSubmit(from.trim(), to.trim(), rtype, note.trim())
            setFrom(''); setTo(''); setNote('')
          }}
        >
          <Link2 className="w-4 h-4" /><span className="ml-1">建立关联</span>
        </Button>
        <span className="text-xs text-gray-500">写入后标记为「人工关联」，与自动关联在界面上可区分。</span>
      </div>
    </div>
  )
}

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  return n.toLocaleString('zh-CN')
}
