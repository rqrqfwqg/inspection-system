import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  Database, Cpu, Hand, LayoutGrid, ExternalLink, Link2, AlertTriangle,
  CheckCircle2, Inbox, ArrowRight, RefreshCw,
} from 'lucide-react'
import { getBaOverview, getLinkOverview, getSubsystems } from './api'
import type { BaOverviewItem, Subsystem, LinkOverview } from './types'

interface DashboardPageProps {
  /** 子系统 code 过滤（来自子系统树点击） */
  subsystemFilter?: string
  onClearFilter?: () => void
  /** 切到本页其它 Tab（联动中心 / 数据表管理入口用） */
  onNavigateTab?: (tab: string) => void
}

/**
 * 资产可视化 · 概览
 *
 * 2026-09-15 重做：原版只有「总资产数 / 故障数 / 子系统设备数」三张卡，
 * 数字来自 BA 概览，与「数据表管理」的资料记录毫无关系 —— 页面看起来是**死的**。
 * 现在概览直接以 `/assets/link/overview` 为主数据源，回答三个真问题：
 *   1) 资料表和设备的关联覆盖到什么程度（覆盖率、命中/未解析）
 *   2) 关联关系里哪些是系统自动建立的、哪些是人建的
 *   3) 还有多少编号完全没关联上，需要人工/现场处理
 *
 * 注意：本 Tab 按既有约定**不加统计图表**，一律用数据表 + 覆盖率条呈现，保证可核对。
 */
export function DashboardPage({ subsystemFilter, onClearFilter, onNavigateTab }: DashboardPageProps) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [ba, setBa] = React.useState<BaOverviewItem[]>([])
  const [link, setLink] = React.useState<LinkOverview | null>(null)
  const [subsystems, setSubsystems] = React.useState<Subsystem[]>([])
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [o, l, subs] = await Promise.all([
        getBaOverview().catch(() => [] as BaOverviewItem[]),
        getLinkOverview(),
        getSubsystems(),
      ])
      setBa(o)
      setLink(l)
      setSubsystems(subs)
    } catch (e) {
      toast({
        title: '加载概览数据失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => { void load() }, [load])

  const g = link?.global
  const src = link?.relations_by_source

  const subs = React.useMemo(() => {
    const all = link?.subsystems || []
    return subsystemFilter ? all.filter((s) => s.code === subsystemFilter) : all
  }, [link, subsystemFilter])

  const tables = React.useMemo(() => {
    const all = (link?.tables || []).filter((t) => t.records > 0)
    const scoped = subsystemFilter ? all.filter((t) => t.subsystem_code === subsystemFilter) : all
    return [...scoped].sort((a, b) => b.records - a.records).slice(0, 12)
  }, [link, subsystemFilter])

  const scoped = React.useMemo(() => {
    if (!subsystemFilter) return null
    const ts = (link?.tables || []).filter((t) => t.subsystem_code === subsystemFilter)
    const rec = ts.reduce((a, t) => a + t.records, 0)
    const ok = ts.reduce((a, t) => a + t.resolved_devices + t.resolved_rooms, 0)
    return { records: rec, resolved: ok, coverage: rec ? ok / rec : 0, tables: ts.length }
  }, [link, subsystemFilter])

  const baScoped = React.useMemo(() => {
    const rows = subsystemFilter ? ba.filter((o) => o.subsystem_code === subsystemFilter) : ba
    return {
      problems: rows.reduce((a, o) => a + (o.problem || 0), 0),
      normal: rows.reduce((a, o) => a + (o.normal || 0), 0),
      total: rows.reduce((a, o) => a + (o.total || 0), 0),
    }
  }, [ba, subsystemFilter])

  const filterName = subsystemFilter
    ? subsystems.find((s) => s.code === subsystemFilter)?.name || subsystemFilter
    : ''

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 过滤提示 */}
      {subsystemFilter && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
          <span className="text-sm text-blue-700">
            已按「{filterName}」子系统过滤
            {scoped && `　资料记录 ${scoped.records.toLocaleString()} 条 · 命中 ${scoped.resolved.toLocaleString()} 条`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onNavigateTab?.('subsystem')}>
              看子系统树
            </Button>
            <Button variant="outline" size="sm" onClick={onClearFilter}>清除过滤</Button>
          </div>
        </div>
      )}

      {/* ============ 指标 ============ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={<Database className="w-4 h-4" />} tone="slate" label="资料记录"
          value={fmt(scoped?.records ?? g?.records)}
          sub={`${fmt(g?.tables)} 张资料表 · ${fmt(g?.fields)} 个字段`}
        />
        <MetricCard
          icon={<CheckCircle2 className="w-4 h-4" />} tone="green" label="关联命中"
          value={fmt(scoped?.resolved ?? (g ? g.resolved_devices + g.resolved_rooms : undefined))}
          sub={`覆盖率 ${pct(scoped?.coverage ?? g?.coverage)} · 命中设备 ${fmt(g?.resolved_devices)} 条`}
        />
        <MetricCard
          icon={<Link2 className="w-4 h-4" />} tone="cyan" label="关联关系"
          value={fmt(g?.relations)}
          sub={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-cyan-700 inline-flex items-center gap-0.5">
                <Cpu className="w-3 h-3" />自动 {fmt(g?.relations_auto)}
              </span>
              <span className="text-gray-600 inline-flex items-center gap-0.5">
                <Hand className="w-3 h-3" />人工 {fmt(g?.relations_manual)}
              </span>
            </span>
          }
        />
        <MetricCard
          icon={<Inbox className="w-4 h-4" />} tone="amber" label="未关联编号"
          value={fmt(g?.unresolved_codes)}
          sub={`覆盖 ${fmt(g?.unresolved)} 条记录 · 需人工/现场处理`}
        />
      </div>

      {/* ============ 子系统 × 资料表 联动 ============ */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <LayoutGrid className="w-4 h-4 text-gray-600" />
              子系统联动覆盖
            </CardTitle>
            <CardDescription className="mt-1">
              每个子系统下有多少张资料表、多少条资料记录真正挂到了设备/机房上。
              「命中」= 资料记录的关联键能在设备台账或机房表中找到对应行。
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigateTab?.('link')}>
              <Link2 className="w-3.5 h-3.5 mr-1" />联动中心
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">子系统</th>
                  <th className="py-2 pr-3 font-medium text-right w-20">资料表</th>
                  <th className="py-2 pr-3 font-medium text-right w-24">记录数</th>
                  <th className="py-2 pr-3 font-medium text-right w-24">登记设备</th>
                  <th className="py-2 pr-3 font-medium text-right w-24">命中</th>
                  <th className="py-2 pr-3 font-medium w-48">覆盖率</th>
                  <th className="py-2 font-medium text-right w-24">未命中</th>
                </tr>
              </thead>
              <tbody>
                {subs.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400">暂无数据</td></tr>
                ) : subs.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <span className="text-gray-900">{s.name}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{fmt(s.table_count)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(s.records)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{fmt(s.devices)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-green-700">{fmt(s.resolved)}</td>
                    <td className="py-2 pr-3"><CoverageBar value={s.coverage} /></td>
                    <td className="py-2 text-right tabular-nums">
                      <span className={s.unresolved > 0 ? 'text-amber-700' : 'text-gray-400'}>{fmt(s.unresolved)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ============ 资料表联动（TOP） ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-4 h-4 text-gray-600" />
            资料表联动明细
            <span className="text-xs font-normal text-gray-400">
              记录数 TOP {tables.length}{subsystemFilter ? '（当前过滤范围内）' : ''}
            </span>
          </CardTitle>
          <CardDescription>
            点「打开表」直接进入数据表管理维护记录 —— 概览与数据表管理看的是同一份数据。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">资料表</th>
                  <th className="py-2 pr-3 font-medium">子系统</th>
                  <th className="py-2 pr-3 font-medium">关联键</th>
                  <th className="py-2 pr-3 font-medium text-right w-24">记录数</th>
                  <th className="py-2 pr-3 font-medium text-right w-24">命中设备</th>
                  <th className="py-2 pr-3 font-medium w-44">覆盖率</th>
                  <th className="py-2 font-medium text-right w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {tables.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400">暂无资料表</td></tr>
                ) : tables.map((t) => (
                  <tr key={t.table_id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-3 text-gray-900">{t.name}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{t.subsystem_name}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{t.relation_key_label || '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(t.records)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{fmt(t.distinct_devices)}</td>
                    <td className="py-2 pr-3"><CoverageBar value={t.coverage} showCount /></td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        onClick={() => navigate(`/asset/ledger/${t.table_id}`)}
                      >
                        打开表<ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ============ 未关联编号告警 + BA ============ */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              未关联编号 TOP
              <span className="text-xs font-normal text-gray-400">
                共 {fmt(g?.unresolved_codes)} 个编号 · {fmt(g?.unresolved)} 条记录
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(link?.unresolved_top || []).length === 0 ? (
              <p className="text-sm text-gray-500">全部编号都已关联。</p>
            ) : (
              <>
                <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
                  {link?.unresolved_top.slice(0, 10).map((u) => (
                    <li key={u.code} className="border-b border-dashed border-gray-100 py-1 flex flex-wrap gap-2 items-center">
                      <span className="font-mono text-gray-800">{u.code}</span>
                      <Badge variant="secondary" className="text-[10px]">{u.records} 条</Badge>
                      <span className="text-xs text-gray-400 truncate">{u.tables.slice(0, 2).join('、')}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => onNavigateTab?.('link')}>
                    去联动中心处理<ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                  <span className="text-xs text-gray-500">现场可用小程序扫码建边</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              BA 问题概览
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-4">
              <div>
                <div className="text-xs text-gray-500">待处理问题</div>
                <div className="text-2xl font-bold text-red-600 tabular-nums">{fmt(baScoped.problems)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">正常</div>
                <div className="text-2xl font-bold text-gray-800 tabular-nums">{fmt(baScoped.normal)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">点位数</div>
                <div className="text-2xl font-bold text-gray-500 tabular-nums">{fmt(baScoped.total)}</div>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 pt-1">
              {(subsystemFilter ? ba.filter((o) => o.subsystem_code === subsystemFilter) : ba)
                .filter((o) => o.problem > 0)
                .slice(0, 8)
                .map((o) => (
                  <div key={o.ba_system_code} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate">{o.ba_system}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Badge variant="destructive" className="text-[10px]">{o.problem}</Badge>
                      <span className="text-xs text-gray-400">{(o.problem_rate * 100).toFixed(1)}%</span>
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ============ 关系来源说明 ============ */}
      {src && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="w-4 h-4 text-gray-500" />关联来源构成
            </CardTitle>
            <CardDescription>
              自动关联由规则引擎按确定性编号匹配生成（可解释、可整批回滚）；
              人工关联来自桌面建边、小程序现场扫码与历史导入。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <SourceStat tone="cyan" icon={<Cpu className="w-4 h-4" />} label="自动关联"
                value={src.auto} total={src.total}
                detail={Object.entries(src.auto_by_rule).map(([k, v]) => `${k} ${v}`).join(' · ') || '尚未执行自动关联'} />
              <SourceStat tone="slate" icon={<Hand className="w-4 h-4" />} label="人工关联"
                value={src.manual} total={src.total}
                detail={src.unmarked_legacy ? `其中历史导入未标注来源 ${src.unmarked_legacy} 条` : '均带操作留痕'} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ==================== 子组件 ====================

const TONES = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-green-50 text-green-700',
  cyan: 'bg-cyan-50 text-cyan-700',
  amber: 'bg-amber-50 text-amber-700',
} as const

function MetricCard({
  icon, tone, label, value, sub,
}: {
  icon: React.ReactNode
  tone: keyof typeof TONES
  label: string
  value: string
  sub?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${TONES[tone]}`}>{icon}</span>
          {label}
        </div>
        <div className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{value}</div>
        {sub && <div className="text-xs text-gray-500 mt-1 leading-relaxed">{sub}</div>}
      </CardContent>
    </Card>
  )
}

/** 覆盖率条（数据可视化用条而非图表，符合本 Tab 的既有约定） */
function CoverageBar({ value, showCount }: { value: number; showCount?: boolean }) {
  const p = Math.max(0, Math.min(1, value || 0))
  const tone = p >= 0.95 ? 'bg-green-500' : p >= 0.6 ? 'bg-cyan-500' : p > 0 ? 'bg-amber-500' : 'bg-gray-300'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden min-w-[60px]">
        <div className={`h-full ${tone}`} style={{ width: `${p * 100}%` }} />
      </div>
      <span className="text-xs text-gray-600 tabular-nums w-12 text-right">{(p * 100).toFixed(0)}%</span>
      {showCount && <span className="text-[10px] text-gray-400 tabular-nums w-14">已关联</span>}
    </div>
  )
}

function SourceStat({
  tone, icon, label, value, total, detail,
}: {
  tone: 'cyan' | 'slate'
  icon: React.ReactNode
  label: string
  value: number
  total: number
  detail: string
}) {
  const share = total ? value / total : 0
  return (
    <div className="flex-1 min-w-[240px] space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${TONES[tone]}`}>{icon}</span>
        <span className="text-gray-700">{label}</span>
        <span className="font-semibold text-gray-900 tabular-nums">{value.toLocaleString('zh-CN')}</span>
        <span className="text-xs text-gray-400">（{(share * 100).toFixed(1)}%）</span>
      </div>
      <div className="h-2 rounded bg-gray-100 overflow-hidden">
        <div className={`h-full ${tone === 'cyan' ? 'bg-cyan-500' : 'bg-gray-400'}`} style={{ width: `${share * 100}%` }} />
      </div>
      <div className="text-xs text-gray-500">{detail}</div>
    </div>
  )
}

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  return n.toLocaleString('zh-CN')
}

function pct(v: number | undefined): string {
  if (v === undefined || v === null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
