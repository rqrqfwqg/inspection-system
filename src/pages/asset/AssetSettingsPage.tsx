import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Subsystem, DataTable, DeviceRelation, Device, FieldDef } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import { getLinkOverview, getLinkTable } from '@/features/assets/api'
import type { LinkOverview, LinkTableDetail, LinkTableStat } from '@/features/assets/types'
import SubsystemManager from '@/components/asset/SubsystemManager'
import FieldManager from '@/components/asset/FieldManager'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Plus, Trash2, Link2, RefreshCw, ArrowRight } from 'lucide-react'

/** 0..1 → 百分比文案 */
function pct(v: number | undefined) {
  return `${Math.round((v || 0) * 100)}%`
}

/** 覆盖率进度条：高=绿 / 中=琥珀 / 低=玫红 */
function CoverageBar({ value, className = '' }: { value: number; className?: string }) {
  const p = Math.max(0, Math.min(1, value || 0))
  const color = p >= 0.9 ? 'bg-emerald-500' : p >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className={`h-1.5 w-full rounded-full bg-gray-100 overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${p * 100}%` }} />
    </div>
  )
}

/** 关联来源徽标：自动（青） / 人工（灰） —— 全站统一口径 */
export function SourceBadge({ source }: { source?: string }) {
  const auto = source === 'auto'
  return (
    <Badge
      variant="outline"
      className={
        auto
          ? 'border-cyan-300 bg-cyan-50 text-cyan-700'
          : 'border-slate-300 bg-slate-50 text-slate-600'
      }
    >
      {auto ? '自动关联' : '人工关联'}
    </Badge>
  )
}

/** 从 meta 里读来源（无标记的历史边一律按人工归类，与后端口径一致） */
function relSource(r: DeviceRelation): 'auto' | 'manual' {
  return (r.meta as Record<string, unknown> | undefined)?.source === 'auto'
    ? 'auto'
    : 'manual'
}

export default function AssetSettingsPage() {
  const { toast } = useToast()
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [subId, setSubId] = useState<string>('')
  const [tables, setTables] = useState<DataTable[]>([])
  const [tableId, setTableId] = useState<string>('')
  const [fields, setFields] = useState<FieldDef[]>([])
  const [relations, setRelations] = useState<DeviceRelation[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [newTable, setNewTable] = useState({ code: '', name: '' })
  const [relFrom, setRelFrom] = useState('')
  const [relTo, setRelTo] = useState('')
  const [relType, setRelType] = useState('关联')

  // ===== 联动数据（真实来源：/assets/link/*，与「数据表管理」同源） =====
  const [overview, setOverview] = useState<LinkOverview | null>(null)
  const [detail, setDetail] = useState<LinkTableDetail | null>(null)
  const [loadingLink, setLoadingLink] = useState(false)

  // 关联管理筛选
  const [relSourceFilter, setRelSourceFilter] = useState<'all' | 'auto' | 'manual'>('all')
  const [relSearch, setRelSearch] = useState('')

  const reloadSubsystems = useCallback(() => {
    assetApi
      .listSubsystems()
      .then(setSubsystems)
      .catch(() => toast({ title: '加载子系统失败', variant: 'destructive' }))
  }, [toast])

  const reloadTables = useCallback(
    (sid: string) =>
      sid ? assetApi.listTables(Number(sid)).then(setTables) : setTables([]),
    [],
  )

  const reloadRelations = useCallback(() => {
    assetApi
      .listRelations()
      .then(setRelations)
      .catch(() => toast({ title: '加载关联失败', variant: 'destructive' }))
  }, [toast])

  const reloadOverview = useCallback(() => {
    setLoadingLink(true)
    getLinkOverview()
      .then(setOverview)
      .catch(() => toast({ title: '加载联动画像失败', variant: 'destructive' }))
      .finally(() => setLoadingLink(false))
  }, [toast])

  useEffect(() => {
    reloadSubsystems()
    reloadRelations()
    reloadOverview()
    assetApi
      .listDevices()
      .then(setDevices)
      .catch(() => {})
  }, [reloadSubsystems, reloadRelations, reloadOverview])

  useEffect(() => {
    setTableId('')
    reloadTables(subId)
  }, [subId, reloadTables])

  const activeFieldsTable = useMemo(
    () => tables.find((t) => String(t.id) === tableId),
    [tables, tableId],
  )

  // 选中资料表 → 拉真实字段定义 + 单表画像（填充率 / 覆盖率 / 未解析）
  useEffect(() => {
    if (!activeFieldsTable) {
      setFields([])
      setDetail(null)
      return
    }
    const tid = activeFieldsTable.id
    assetApi
      .listFields(tid)
      .then(setFields)
      .catch(() => setFields([]))
    getLinkTable(tid)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [activeFieldsTable])

  const tableStatMap = useMemo(() => {
    const m = new Map<number, LinkTableStat>()
    overview?.tables.forEach((t) => m.set(t.table_id, t))
    return m
  }, [overview])

  const fillRates = useMemo(() => {
    const m: Record<number, number> = {}
    detail?.fields.forEach((f) => {
      m[f.id] = f.fill_rate
    })
    return m
  }, [detail])

  const relBySource = overview?.relations_by_source

  const filteredRelations = useMemo(() => {
    const kw = relSearch.trim().toLowerCase()
    return relations.filter((r) => {
      if (relSourceFilter !== 'all' && relSource(r) !== relSourceFilter) return false
      if (kw && !`${r.from_code} ${r.to_code}`.toLowerCase().includes(kw)) return false
      return true
    })
  }, [relations, relSourceFilter, relSearch])

  const handleAddTable = async () => {
    if (!subId || !newTable.code.trim() || !newTable.name.trim()) {
      toast({ title: '请选择子系统并填写编码与名称', variant: 'destructive' })
      return
    }
    try {
      await assetApi.createTable({
        subsystem_id: Number(subId),
        code: newTable.code.trim(),
        name: newTable.name.trim(),
      })
      toast({ title: '资料表已创建' })
      setNewTable({ code: '', name: '' })
      reloadTables(subId)
      reloadOverview()
    } catch (e) {
      toast({
        title: '创建失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteTable = async (t: DataTable) => {
    if (!confirm(`确定删除资料表「${t.name}」及其字段、记录？`)) return
    try {
      await assetApi.deleteTable(t.id)
      toast({ title: '资料表已删除' })
      if (String(t.id) === tableId) setTableId('')
      reloadTables(subId)
      reloadOverview()
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    }
  }

  const handleAddRelation = async () => {
    if (!relFrom || !relTo || relFrom === relTo) {
      toast({ title: '请选择两个不同的设备', variant: 'destructive' })
      return
    }
    try {
      await assetApi.createRelation({
        from_code: relFrom,
        to_code: relTo,
        relation_type: relType,
        // 显式打上来源标记：界面上就能与规则引擎自动建立的边区分开
        meta: { source: 'manual', via: 'web-config' },
      })
      toast({ title: '关联已添加（人工）' })
      setRelFrom('')
      setRelTo('')
      setRelType('关联')
      reloadRelations()
      reloadOverview()
    } catch (e) {
      toast({
        title: '添加失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    }
  }

  const handleDeleteRelation = async (r: DeviceRelation) => {
    try {
      await assetApi.deleteRelation(r.id)
      toast({ title: '关联已删除' })
      reloadRelations()
      reloadOverview()
    } catch (e) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">资料配置</h1>
          <p className="text-gray-500 mt-1">
            维护子系统、资料表字段与设备关联关系。页面数据与「数据表管理」实时联动。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={reloadOverview} disabled={loadingLink}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loadingLink ? 'animate-spin' : ''}`} />
            刷新联动
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/asset-viz?tab=link">
              <Link2 className="w-4 h-4 mr-1" />
              联动中心
            </Link>
          </Button>
        </div>
      </div>

      {/* 全局联动总览条 —— 与数据表管理同源，永远反映真实库 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: '资料表', value: overview?.global.tables ?? tables.length },
          { label: '字段定义', value: overview?.global.fields ?? '—' },
          { label: '资料记录', value: overview?.global.records ?? '—' },
          { label: '关联边', value: overview?.global.relations ?? relations.length },
          {
            label: '自动 / 人工',
            value: relBySource ? `${relBySource.auto} / ${relBySource.manual}` : '—',
          },
          { label: '关联键覆盖率', value: overview ? pct(overview.global.coverage) : '—' },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-gray-500">{m.label}</div>
              <div className="text-xl font-semibold text-gray-900 mt-1">{m.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="subsystems">
        <TabsList>
          <TabsTrigger value="subsystems">子系统</TabsTrigger>
          <TabsTrigger value="fields">资料表与字段</TabsTrigger>
          <TabsTrigger value="relations">关联管理</TabsTrigger>
        </TabsList>

        {/* 子系统 */}
        <TabsContent value="subsystems">
          <Card>
            <CardContent className="pt-6 space-y-4">
              {overview && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {overview.subsystems.map((s) => (
                    <div key={s.id} className="rounded-md border px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">{s.name}</span>
                        <span className="text-xs text-gray-500">
                          {s.table_count} 表 · {s.records} 条
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CoverageBar value={s.coverage} className="flex-1" />
                        <span className="text-xs tabular-nums text-gray-500 w-10 text-right">
                          {pct(s.coverage)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        登记设备 {s.devices} · 已解析 {s.resolved} · 未解析{' '}
                        <span className={s.unresolved > 0 ? 'text-rose-600' : ''}>
                          {s.unresolved}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <SubsystemManager subsystems={subsystems} onChanged={reloadSubsystems} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* 资料表与字段 */}
        <TabsContent value="fields">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-1 max-w-sm">
                <Label>所属子系统</Label>
                <Select value={subId} onValueChange={setSubId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择子系统" />
                  </SelectTrigger>
                  <SelectContent>
                    {subsystems.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!subId ? (
                <p className="text-sm text-gray-500">请先选择子系统。</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-700">
                      资料表（{tables.length}）
                    </h4>
                    <div className="flex gap-2">
                      <Input
                        value={newTable.code}
                        onChange={(e) =>
                          setNewTable((s) => ({ ...s, code: e.target.value }))
                        }
                        placeholder="表编码，如 lighting_fixtures"
                      />
                      <Input
                        value={newTable.name}
                        onChange={(e) =>
                          setNewTable((s) => ({ ...s, name: e.target.value }))
                        }
                        placeholder="表名称，如 灯具台账"
                      />
                      <Button onClick={handleAddTable}>
                        <Plus className="w-4 h-4 mr-1" />
                        新增
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {tables.map((t) => {
                        const st = tableStatMap.get(t.id)
                        const active = String(t.id) === tableId
                        return (
                          <div
                            key={t.id}
                            className={`rounded-md border px-3 py-2 cursor-pointer space-y-1.5 ${
                              active ? 'bg-blue-50 border-blue-200' : ''
                            }`}
                            onClick={() => setTableId(String(t.id))}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="font-medium text-sm">{t.name}</span>
                                <span className="text-xs text-gray-400 ml-2">{t.code}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant="outline">{t.field_count ?? 0} 字段</Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-red-600"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteTable(t)
                                  }}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                            {st ? (
                              <div className="flex items-center gap-2">
                                <CoverageBar value={st.coverage} className="flex-1" />
                                <span className="text-xs text-gray-500 tabular-nums shrink-0">
                                  {st.records} 条 · {pct(st.coverage)}
                                </span>
                                {st.unresolved > 0 && (
                                  <span className="text-xs text-rose-600 tabular-nums shrink-0">
                                    {st.unresolved} 未解析
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">暂无记录</span>
                            )}
                          </div>
                        )
                      })}
                      {tables.length === 0 && (
                        <p className="text-sm text-gray-500">该子系统下暂无资料表。</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {!activeFieldsTable ? (
                      <p className="text-sm text-gray-500">请选择左侧资料表以管理字段。</p>
                    ) : (
                      <>
                        {/* 单表数据画像（真实覆盖率 / 未解析编号） */}
                        {detail && (
                          <div className="rounded-md border bg-gray-50/60 px-4 py-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-800">
                                  数据画像
                                </span>
                                <Badge
                                  variant="outline"
                                  className={
                                    detail.coverage.coverage >= 0.9
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : detail.coverage.coverage >= 0.5
                                        ? 'border-amber-300 bg-amber-50 text-amber-700'
                                        : 'border-rose-300 bg-rose-50 text-rose-700'
                                  }
                                >
                                  覆盖率 {pct(detail.coverage.coverage)}
                                </Badge>
                              </div>
                              {detail.coverage.unresolved > 0 && (
                                <Button size="sm" variant="outline" asChild>
                                  <Link to="/asset-viz?tab=link">
                                    去联动中心处理
                                    <ArrowRight className="w-3.5 h-3.5 ml-1" />
                                  </Link>
                                </Button>
                              )}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                              <div>
                                <div className="text-xs text-gray-500">记录数</div>
                                <div className="font-medium">{detail.coverage.records}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">命中设备（记录）</div>
                                <div className="font-medium">
                                  {detail.coverage.resolved_devices}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">去重设备</div>
                                <div className="font-medium">
                                  {detail.coverage.distinct_devices}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-500">未解析编号</div>
                                <div
                                  className={`font-medium ${
                                    detail.coverage.unresolved > 0 ? 'text-rose-600' : ''
                                  }`}
                                >
                                  {detail.coverage.unresolved}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                              <span>命中机房 {detail.coverage.resolved_rooms}</span>
                              <span>空关联键 {detail.coverage.empty_code}</span>
                              <span>
                                关联边{' '}
                                <span className="text-cyan-700">
                                  自动 {detail.relations.auto}
                                </span>{' '}
                                /{' '}
                                <span className="text-slate-600">
                                  人工 {detail.relations.manual}
                                </span>
                              </span>
                              <span>涉及编号 {detail.relations.distinct_codes}</span>
                            </div>

                            {detail.unresolved_top.length > 0 && (
                              <div className="space-y-1.5">
                                <div className="text-xs text-gray-500">
                                  未解析编号 TOP（对应不到设备台账 / 机房）
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {detail.unresolved_top.slice(0, 12).map((u) => (
                                    <span
                                      key={u.code}
                                      className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                                      title={`${u.code} · ${u.records} 条记录`}
                                    >
                                      {u.code}
                                      <span className="text-rose-400">×{u.records}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <FieldManager
                          tableId={activeFieldsTable.id}
                          fields={fields}
                          fillRates={fillRates}
                          onChanged={() => {
                            reloadTables(subId)
                            if (activeFieldsTable) {
                              getLinkTable(activeFieldsTable.id)
                                .then(setDetail)
                                .catch(() => {})
                            }
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 关联管理 */}
        <TabsContent value="relations">
          <Card>
            <CardContent className="pt-6 space-y-4">
              {/* 来源构成：自动 vs 人工（与联动中心同口径） */}
              <div className="rounded-md border bg-gray-50/60 px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="text-gray-600">
                    关联总数 <span className="font-medium">{relBySource?.total ?? relations.length}</span>
                  </span>
                  <span className="text-cyan-700">
                    自动关联 <span className="font-medium">{relBySource?.auto ?? 0}</span>
                  </span>
                  <span className="text-slate-600">
                    人工关联 <span className="font-medium">{relBySource?.manual ?? 0}</span>
                  </span>
                  {!!relBySource?.unmarked_legacy && (
                    <span className="text-xs text-gray-400">
                      （其中历史无标记 {relBySource.unmarked_legacy} 条，按人工归类）
                    </span>
                  )}
                </div>
                {relBySource && Object.keys(relBySource.auto_by_rule).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(relBySource.auto_by_rule).map(([rule, n]) => (
                      <span
                        key={rule}
                        className="rounded border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700"
                      >
                        {rule} · {n}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  自动关联由规则引擎按确定性编号匹配建立（可解释、可整批回滚）；人工关联来自网页 / 小程序 / 历史导入。
                </p>
              </div>

              {/* 新建人工关联 */}
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">源设备</label>
                  <select
                    value={relFrom}
                    onChange={(e) => setRelFrom(e.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">选择...</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.device_code}>
                        {d.device_code} · {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">目标设备</label>
                  <select
                    value={relTo}
                    onChange={(e) => setRelTo(e.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">选择...</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.device_code}>
                        {d.device_code} · {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">关系类型</label>
                  <Input
                    value={relType}
                    onChange={(e) => setRelType(e.target.value)}
                    className="w-32"
                  />
                </div>
                <Button onClick={handleAddRelation}>
                  <Link2 className="w-4 h-4 mr-1" />
                  添加关联
                </Button>
              </div>

              {/* 筛选 */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={relSearch}
                  onChange={(e) => setRelSearch(e.target.value)}
                  placeholder="按编号搜索（源 / 目标）"
                  className="max-w-xs"
                />
                <Select
                  value={relSourceFilter}
                  onValueChange={(v) => setRelSourceFilter(v as 'all' | 'auto' | 'manual')}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部来源</SelectItem>
                    <SelectItem value="auto">仅自动关联</SelectItem>
                    <SelectItem value="manual">仅人工关联</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-500">
                  显示 {filteredRelations.length} / {relations.length} 条
                </span>
              </div>

              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-5 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
                  <span>源设备</span>
                  <span>关系</span>
                  <span>目标设备</span>
                  <span>来源</span>
                  <span className="text-right">操作</span>
                </div>
                <div className="divide-y">
                  {filteredRelations.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                      暂无关联记录
                    </div>
                  )}
                  {filteredRelations.map((r) => {
                    const src = relSource(r)
                    const rule = (r.meta as Record<string, unknown> | undefined)?.rule
                    const evidence = (r.meta as Record<string, unknown> | undefined)?.evidence
                    return (
                      <div
                        key={r.id}
                        className="grid grid-cols-5 px-4 py-3 text-sm items-center"
                      >
                        <span className="font-medium truncate">{r.from_code}</span>
                        <span>
                          <Badge variant="outline">{r.relation_type}</Badge>
                        </span>
                        <span className="text-gray-600 truncate">{r.to_code}</span>
                        <span
                          className="flex items-center gap-1"
                          title={
                            src === 'auto' && evidence ? String(evidence) : '人工建立'
                          }
                        >
                          <SourceBadge source={src} />
                          {src === 'auto' && !!rule && (
                            <span className="text-xs text-cyan-600">{String(rule)}</span>
                          )}
                        </span>
                        <div className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-600"
                            onClick={() => handleDeleteRelation(r)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
