import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  AssetLedgerRow,
  AssetLedgerSummary,
  AssetLedgerDetail,
  AssetLedgerQuery,
  FieldDef,
  Subsystem,
  DevicePayload,
} from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  Search,
  Plus,
  Trash2,
  Boxes,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  AlertTriangle,
  Database,
  Link2,
  Wallet,
  MapPinOff,
  Loader2,
} from 'lucide-react'

/**
 * 设备台账 / 资产总台账（/asset/devices）
 * =====================================
 * 数据源是 **全集合**：devices ∪ 台账 records ∪ fixed_assets。
 *
 * 为什么不能只读 devices（本次升级的原因）：
 *   1) devices 的 building/floor/location_desc 几乎全空（线上 7868/7878 无楼栋），
 *      只读它页面就是「一堆光秃秃的编号」；
 *   2) 真正可读的资产信息在 fixed_assets（7237 条，位置/名称/品牌型号/使用单位 100% 填充）
 *      和 20 张台账表（records）里；
 *   3) 线上还有上千台设备只存在于台账、从未登记进 devices —— 只看 devices 会直接漏掉。
 *
 * 因此本页把三者并起来，提供：汇总卡 + 多维筛选 + 分页排序表格 + 全字段详情抽屉。
 * 原有「登记设备」「注销设备」能力保留不变。
 */

const PAGE_SIZES = [20, 50, 100, 200]

const STATE_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'with_asset', label: '有固定资产' },
  { value: 'without_asset', label: '无固定资产' },
  { value: 'ledger_only', label: '仅台账（未登记）' },
  { value: 'has_records', label: '有台账记录' },
  { value: 'warranty_expired', label: '保修已过期' },
  { value: 'warranty_soon', label: '保修将到期(90天)' },
  { value: 'bim', label: '已标 BIM' },
  { value: 'no_location', label: '缺位置' },
]

/** 固定资产中文字段名（详情抽屉用，避免展示英文 key） */
const FA_LABELS: Record<string, string> = {
  device_code: '资产标识',
  transfer_no: '移交编号',
  tag_no: '标签号',
  owner_unit: '权属单位',
  use_dept: '使用单位',
  location: '所在地点',
  asset_name: '资产名称',
  asset_code: '资产代码',
  brand_model: '品牌型号',
  serial_no: '出厂序列号',
  recv_date: '接收日期',
  warranty_end: '保修截止',
  price_tax: '含税价',
  price_notax: '不含税价',
  tax: '税额',
  budget_item: '概算项目',
  contract_no: '合同编号',
  bim_tag: 'BIM 标签',
  builder: '承建单位',
  responsible: '责任人',
  proj_manager: '项目负责人',
  warranty_contact: '保修联系人',
  remark: '备注',
  room_code: '关联机房',
  room_match_method: '机房匹配方式',
}

/** 设备主表中文字段名 */
const DEV_LABELS: Record<string, string> = {
  id: '主表ID',
  device_code: '设备编号',
  name: '设备名称',
  subsystem_id: '子系统ID',
  subsystem_name: '所属子系统',
  building: '楼栋',
  floor: '楼层',
  location_desc: '位置描述',
  is_active: '在用状态',
  transfer_no: '移交编号',
  asset_code: '资产代码',
  bim_tag: 'BIM 标签',
}

/** 设备档案中文字段名 */
const ARCHIVE_LABELS: Record<string, string> = {
  device_code: '设备编号',
  pre_no: '原编号',
  project: '项目',
  system_text: '系统（原文）',
  location: '位置',
  building: '楼栋',
  floor: '楼层',
  old_name: '原名',
  asset_name: '资产名称',
  old_code: '原代码',
  manufacturer: '厂商',
  brand_model: '品牌型号',
  recv_date: '接收日期',
  qty: '数量',
  unit: '单位',
  original_value: '原值',
  residual_rate: '残值率',
  net_value: '净值',
  status_name: '状态',
  remark: '备注',
  room_code: '关联机房',
  room_match_method: '机房匹配方式',
}

const SORT_LABELS: Record<string, string> = {
  device_code: '编号',
  name: '名称',
  area: '区域',
  subsystem: '子系统',
  use_dept: '使用单位',
  price_tax: '含税价',
  warranty_end: '保修到期',
  record_count: '台账记录',
}

/** 金额（元，两位小数） */
function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 大额金额压缩显示（万 / 亿） */
function fmtBig(v: number | null | undefined) {
  if (!v) return '¥0'
  if (v >= 1e8) return `¥${(v / 1e8).toFixed(2)} 亿`
  if (v >= 1e4) return `¥${(v / 1e4).toFixed(2)} 万`
  return '¥' + v.toLocaleString('zh-CN')
}

function WarrantyCell({ row }: { row: AssetLedgerRow }) {
  if (!row.warranty_end) return <span className="text-gray-300">—</span>
  if (row.warranty_state === 'expired')
    return <Badge variant="destructive">{row.warranty_end} 已过保</Badge>
  if (row.warranty_state === 'soon')
    return <Badge variant="warning">{row.warranty_end} 即将到期</Badge>
  return <span className="text-gray-600">{row.warranty_end}</span>
}

/** 汇总卡 */
function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'default',
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warn' | 'danger' | 'brand'
  onClick?: () => void
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'brand'
          ? 'text-indigo-600'
          : 'text-gray-900'
  return (
    <Card
      className={onClick ? 'cursor-pointer transition-shadow hover:shadow-md' : undefined}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {icon}
          <span>{label}</span>
        </div>
        <div
          data-stat="value"
          className={`mt-2 text-xl font-bold tabular-nums ${toneCls}`}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
      </CardContent>
    </Card>
  )
}

/** 详情抽屉里的一组键值对 */
function KV({ title, dict, labels }: {
  title: string
  dict: Record<string, unknown> | null | undefined
  labels?: Record<string, string>
}) {
  if (!dict) return null
  const entries = Object.entries(dict).filter(
    ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
  )
  if (!entries.length) return null
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-gray-800">{title}</h4>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <span className="w-28 flex-shrink-0 text-gray-500">{labels?.[k] || k}</span>
            <span className="min-w-0 break-all text-gray-900">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DeviceLedgerPage() {
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---- 筛选条件 ----
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [subsystemId, setSubsystemId] = useState('all')
  const [area, setArea] = useState('all')
  const [useDept, setUseDept] = useState('all')
  const [state, setState] = useState('all')
  const [sort, setSort] = useState('device_code')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // ---- 数据 ----
  const [rows, setRows] = useState<AssetLedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(0)
  const [facets, setFacets] = useState<{
    areas: string[]
    use_depts: string[]
    subsystems: { id: number; name: string }[]
  }>({ areas: [], use_depts: [], subsystems: [] })
  const [summary, setSummary] = useState<AssetLedgerSummary | null>(null)
  const [loading, setLoading] = useState(true)

  // ---- 详情抽屉 ----
  const selectedCode = searchParams.get('code')
  const [detail, setDetail] = useState<AssetLedgerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [fieldLabels, setFieldLabels] = useState<Record<number, Record<string, string>>>({})

  // ---- 登记 / 注销 ----
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<DevicePayload>({
    device_code: '',
    name: '',
    subsystem_id: null,
    building: '',
    floor: '',
    location_desc: '',
  })

  const buildQuery = useCallback(
    (overrides: Partial<AssetLedgerQuery> = {}): AssetLedgerQuery => ({
      q: qDebounced || undefined,
      subsystem_id: subsystemId === 'all' ? undefined : Number(subsystemId),
      area: area === 'all' ? undefined : area,
      use_dept: useDept === 'all' ? undefined : useDept,
      state: state === 'all' ? undefined : state,
      sort,
      order,
      page,
      page_size: pageSize,
      ...overrides,
    }),
    [qDebounced, subsystemId, area, useDept, state, sort, order, page, pageSize]
  )

  // 关键字防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  // 列表
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    assetApi
      .listAssetLedger(buildQuery())
      .then((res) => {
        if (cancelled) return
        setRows(res.items || [])
        setTotal(res.total || 0)
        setPages(res.pages || 0)
        if (res.facets) setFacets(res.facets)
      })
      .catch(() =>
        toast({ title: '加载资产台账失败', variant: 'destructive' })
      )
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [buildQuery, toast])

  // 汇总（不含分页，跟着筛选走）
  useEffect(() => {
    let cancelled = false
    assetApi
      .getAssetLedgerSummary(buildQuery({ page: undefined, page_size: undefined }))
      .then((s) => !cancelled && setSummary(s))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [buildQuery])

  // 子系统下拉（登记设备用）
  useEffect(() => {
    assetApi.listSubsystems().then(setSubsystems).catch(() => {})
  }, [])

  // 详情
  useEffect(() => {
    if (!selectedCode) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    assetApi
      .getAssetLedgerDetail(selectedCode)
      .then(async (d) => {
        if (cancelled) return
        setDetail(d)
        // 取字段中文名，避免详情里全是英文 key
        const tids = Array.from(new Set((d.records || []).map((r) => r.table_id)))
        const maps: Record<number, Record<string, string>> = {}
        await Promise.all(
          tids.map(async (tid) => {
            try {
              const fs = await assetApi.listFields(tid)
              maps[tid] = Object.fromEntries(fs.map((f: FieldDef) => [f.key, f.label]))
            } catch {
              maps[tid] = {}
            }
          })
        )
        if (!cancelled) setFieldLabels(maps)
      })
      .catch(() => {
        if (!cancelled) {
          toast({ title: '加载详情失败', variant: 'destructive' })
          setDetail(null)
        }
      })
      .finally(() => !cancelled && setDetailLoading(false))
    return () => {
      cancelled = true
    }
  }, [selectedCode, toast])

  const openDetail = (code: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('code', code)
    setSearchParams(next)
  }
  const closeDetail = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('code')
    setSearchParams(next)
  }

  const resetFilters = () => {
    setQ('')
    setQDebounced('')
    setSubsystemId('all')
    setArea('all')
    setUseDept('all')
    setState('all')
    setPage(1)
  }

  const toggleSort = (key: string) => {
    if (sort === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(key)
      setOrder('asc')
    }
    setPage(1)
  }

  const hasFilters =
    !!qDebounced || subsystemId !== 'all' || area !== 'all' || useDept !== 'all' || state !== 'all'

  // ---- 登记 / 注销 ----
  const handleAdd = async () => {
    if (!form.device_code.trim() || !form.name.trim()) {
      toast({ title: '请填写设备编号与名称', variant: 'destructive' })
      return
    }
    try {
      setSaving(true)
      await assetApi.createDevice(form)
      toast({ title: '设备已登记' })
      setAddOpen(false)
      setForm({ device_code: '', name: '', subsystem_id: null, building: '', floor: '', location_desc: '' })
      const res = await assetApi.listAssetLedger(buildQuery({ page: 1 }))
      setRows(res.items || [])
      setTotal(res.total || 0)
      setPages(res.pages || 0)
    } catch (e) {
      toast({
        title: '登记失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: AssetLedgerRow) => {
    if (row.source !== 'devices') {
      toast({
        title: '该设备未登记进设备主表',
        description: '它只存在于现场台账中，无需注销；如需处理请在对应台账表内操作。',
      })
      return
    }
    if (!confirm(`确定注销设备「${row.name}」（${row.device_code}）？历史资料将保留，仅清理关联关系。`))
      return
    try {
      // 注销需要 devices.id，列表不一定带；直接查详情拿 id
      const d = detail?.code === row.device_code ? detail : await assetApi.getAssetLedgerDetail(row.device_code)
      const id = d.device?.id
      if (!id) {
        toast({ title: '未找到该设备主表记录', variant: 'destructive' })
        return
      }
      await assetApi.deleteDevice(id)
      toast({ title: '设备已注销', description: '历史资料已保留' })
      if (selectedCode === row.device_code) closeDetail()
      const res = await assetApi.listAssetLedger(buildQuery())
      setRows(res.items || [])
      setTotal(res.total || 0)
      setPages(res.pages || 0)
    } catch (e) {
      toast({
        title: '注销失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    }
  }

  // 详情里台账记录按表分组
  const groupedRecords = useMemo(() => {
    const m = new Map<string, { table_id: number; table_name: string; subsystem: string; items: Record<string, unknown>[] }>()
    ;(detail?.records || []).forEach((r) => {
      const key = `${r.table_id}`
      const g = m.get(key) || {
        table_id: r.table_id,
        table_name: r.table_name || `表#${r.table_id}`,
        subsystem: r.subsystem_name || '',
        items: [],
      }
      g.items.push(r.data as Record<string, unknown>)
      m.set(key, g)
    })
    return Array.from(m.values())
  }, [detail])

  const sortHead = (key: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={`inline-flex items-center gap-1 hover:text-gray-900 ${
        sort === key ? 'font-semibold text-gray-900' : 'text-gray-500'
      }`}
    >
      {SORT_LABELS[key] || key}
      <ChevronsUpDown className="h-3 w-3 opacity-60" />
    </button>
  )

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="space-y-5">
      {/* 标题 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">设备台账</h1>
          <p className="mt-1 text-sm text-gray-500">
            全量资产总台账：合并「设备主表 + 现场台账记录 + 固定资产」，可按子系统、区域、使用单位、
            保修状态检索。
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="flex-shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          登记设备
        </Button>
      </div>

      {/* 汇总卡 */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            icon={<Boxes className="h-3.5 w-3.5" />}
            label="资产总数"
            value={summary.total.toLocaleString('zh-CN')}
            hint={`已登记 ${summary.registered.toLocaleString('zh-CN')} · 仅台账 ${summary.ledger_only.toLocaleString('zh-CN')}`}
            tone="brand"
            onClick={resetFilters}
          />
          <StatCard
            icon={<Wallet className="h-3.5 w-3.5" />}
            label="固定资产含税总额"
            value={fmtBig(summary.amount_total)}
            hint={`有固定资产 ${summary.with_asset.toLocaleString('zh-CN')} 项`}
          />
          <StatCard
            icon={<Database className="h-3.5 w-3.5" />}
            label="有台账记录"
            value={summary.with_records.toLocaleString('zh-CN')}
            hint={`已标 BIM ${summary.with_bim.toLocaleString('zh-CN')}`}
            onClick={() => {
              setState('has_records')
              setPage(1)
            }}
          />
          <StatCard
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="保修已过期"
            value={summary.warranty_expired.toLocaleString('zh-CN')}
            tone={summary.warranty_expired ? 'danger' : 'default'}
            onClick={() => {
              setState('warranty_expired')
              setPage(1)
            }}
          />
          <StatCard
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label={`保修 ${summary.warranty_soon_days} 天内到期`}
            value={summary.warranty_soon.toLocaleString('zh-CN')}
            tone={summary.warranty_soon ? 'warn' : 'default'}
            onClick={() => {
              setState('warranty_soon')
              setPage(1)
            }}
          />
          <StatCard
            icon={<MapPinOff className="h-3.5 w-3.5" />}
            label="缺位置信息"
            value={summary.no_location.toLocaleString('zh-CN')}
            onClick={() => {
              setState('no_location')
              setPage(1)
            }}
          />
        </div>
      )}

      {/* 筛选栏 */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="搜索 编号 / 名称 / 品牌型号 / 位置 / 资产代码 / 合同号 / 使用单位"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Select
              value={subsystemId}
              onValueChange={(v) => {
                setSubsystemId(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="子系统" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部子系统</SelectItem>
                {facets.subsystems.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={area}
              onValueChange={(v) => {
                setArea(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="区域" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部区域</SelectItem>
                {facets.areas.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={useDept}
              onValueChange={(v) => {
                setUseDept(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="使用单位" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部使用单位</SelectItem>
                {facets.use_depts.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={state}
              onValueChange={(v) => {
                setState(v)
                setPage(1)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                {STATE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      每页 {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="flex-shrink-0">
                  <X className="mr-1 h-3.5 w-3.5" />
                  重置
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              命中 <b className="text-gray-900">{total.toLocaleString('zh-CN')}</b> 条
              {total > 0 && ` · 当前显示 ${start}-${end}`}
            </span>
            <span className="flex items-center gap-1">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              共 {pages} 页
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 表格 */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">{sortHead('device_code')}</TableHead>
                  <TableHead className="min-w-[160px]">{sortHead('name')}</TableHead>
                  <TableHead className="w-[110px]">{sortHead('subsystem')}</TableHead>
                  <TableHead className="min-w-[200px]">位置</TableHead>
                  <TableHead className="min-w-[180px]">品牌型号</TableHead>
                  <TableHead className="w-[110px]">资产代码</TableHead>
                  <TableHead className="w-[150px]">{sortHead('use_dept')}</TableHead>
                  <TableHead className="w-[130px] text-right">{sortHead('price_tax')}</TableHead>
                  <TableHead className="w-[150px]">{sortHead('warranty_end')}</TableHead>
                  <TableHead className="w-[90px] text-center">{sortHead('record_count')}</TableHead>
                  <TableHead className="w-[70px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-16 text-center text-gray-400">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      加载中…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-16 text-center text-gray-400">
                      没有符合条件的资产
                      {hasFilters && (
                        <button className="ml-2 text-blue-600 hover:underline" onClick={resetFilters}>
                          清除筛选
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => (
                  <TableRow
                    key={row.device_code}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => openDetail(row.device_code)}
                  >
                    <TableCell className="font-mono text-xs text-gray-700">
                      <div className="flex items-center gap-1.5">
                        <span className="break-all">{row.device_code}</span>
                        {row.source === 'ledger_only' && (
                          <Badge variant="warning" className="flex-shrink-0 text-[10px]">
                            未登记
                          </Badge>
                        )}
                        {!row.is_active && (
                          <Badge variant="secondary" className="flex-shrink-0 text-[10px]">
                            已注销
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-medium text-gray-900">
                      {row.name}
                      {row.asset_name && row.asset_name !== row.name && (
                        <div className="text-xs font-normal text-gray-400">{row.asset_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {row.subsystem_name || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {row.location ? (
                        <>
                          <div className="mb-0.5">
                            <Badge variant="outline" className="text-[10px]">
                              {row.area}
                            </Badge>
                          </div>
                          <div className="line-clamp-2 text-xs" title={row.location}>
                            {row.location}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-gray-600">
                      <div className="line-clamp-2" title={row.brand_model}>
                        {row.brand_model || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">
                      {row.asset_code || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-gray-600">
                      <div className="line-clamp-1" title={row.use_dept}>
                        {row.use_dept || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-gray-900">
                      {fmtMoney(row.price_tax)}
                    </TableCell>
                    <TableCell>
                      <WarrantyCell row={row} />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
                        {row.record_count > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-blue-700"
                            title={`台账记录 ${row.record_count} 条：${(row.record_tables || []).join('、')}`}
                          >
                            <Database className="h-3 w-3" />
                            {row.record_count}
                          </span>
                        )}
                        {row.relation_count > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
                            title={`关联 ${row.relation_count} 条`}
                          >
                            <Link2 className="h-3 w-3" />
                            {row.relation_count}
                          </span>
                        )}
                        {row.record_count === 0 && row.relation_count === 0 && (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-600"
                        title={row.source === 'devices' ? '注销设备' : '未登记设备，无需注销'}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(row)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* 分页 */}
          {pages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <span className="text-xs text-gray-500">
                第 {page} / {pages} 页 · 共 {total.toLocaleString('zh-CN')} 条
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                  上一页
                </Button>
                {Array.from({ length: Math.min(5, pages) }, (_, i) => {
                  const base = Math.max(1, Math.min(page - 2, pages - 4))
                  return base + i
                })
                  .filter((p) => p >= 1 && p <= pages)
                  .map((p) => (
                    <Button
                      key={p}
                      variant={p === page ? 'default' : 'outline'}
                      size="sm"
                      className="w-9"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  下一页
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 详情抽屉 */}
      <Dialog open={!!selectedCode} onOpenChange={(o) => !o && closeDetail()}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
              <span>{detail?.fixed_asset?.asset_name as string || detail?.device?.name || selectedCode || '资产详情'}</span>
              <span className="font-mono text-sm font-normal text-gray-500">{selectedCode}</span>
              {detail?.source === 'ledger_only' && (
                <Badge variant="warning">仅台账·未登记</Badge>
              )}
              {detail?.area && <Badge variant="outline">{detail.area}</Badge>}
            </DialogTitle>
          </DialogHeader>

          {detailLoading && (
            <div className="py-12 text-center text-gray-400">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              加载中…
            </div>
          )}

          {!detailLoading && detail && !detail.found && (
            <div className="py-12 text-center text-gray-400">未找到该编号的资产信息</div>
          )}

          {!detailLoading && detail?.found && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 rounded-md bg-gray-50 p-3 text-sm">
                <span>
                  <span className="text-gray-500">子系统：</span>
                  {detail.device?.subsystem_name || (detail.profile as { subsystem_name?: string })?.subsystem_name || '—'}
                </span>
                <span>
                  <span className="text-gray-500">区域：</span>
                  {detail.area || '—'}
                </span>
                <span>
                  <span className="text-gray-500">台账记录：</span>
                  {detail.record_count} 条
                </span>
                <span>
                  <span className="text-gray-500">关联：</span>
                  {detail.relations.length} 条
                </span>
                <span>
                  <span className="text-gray-500">来源：</span>
                  {detail.source === 'devices'
                    ? '设备主表已登记'
                    : detail.source === 'fixed_asset'
                      ? '仅固定资产清单'
                      : detail.source === 'archive'
                        ? '仅设备档案'
                        : '仅现场台账记录'}
                </span>
              </div>

              <KV title="固定资产" dict={detail.fixed_asset} labels={FA_LABELS} />
              <KV
                title="设备主表"
                dict={detail.device as Record<string, unknown> | null}
                labels={DEV_LABELS}
              />
              <KV title="设备档案" dict={detail.archive} labels={ARCHIVE_LABELS} />

              {/* 跨表台账记录 */}
              {groupedRecords.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-800">
                    台账记录（{detail.record_count} 条，跨 {groupedRecords.length} 张表）
                  </h4>
                  {groupedRecords.map((g) => (
                    <div key={g.table_id} className="rounded-md border">
                      <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-1.5 text-xs">
                        <span className="font-medium text-gray-800">{g.table_name}</span>
                        <span className="text-gray-500">
                          {g.subsystem}
                          {g.subsystem && ' · '}
                          {g.items.length} 条
                        </span>
                      </div>
                      <div className="divide-y">
                        {g.items.map((item, idx) => (
                          <div key={idx} className="px-3 py-2">
                            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                              {Object.entries(item)
                                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                                .map(([k, v]) => (
                                  <div key={k} className="flex gap-2 text-xs">
                                    <span className="w-24 flex-shrink-0 text-gray-500">
                                      {fieldLabels[g.table_id]?.[k] || k}
                                    </span>
                                    <span className="min-w-0 break-all text-gray-900">{String(v)}</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 关联链路 */}
              {detail.relations.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-gray-800">
                    关联设备（{detail.relations.length} 条）
                  </h4>
                  <div className="space-y-1">
                    {detail.relations.map((r) => (
                      <div
                        key={r.relation_id}
                        className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs"
                      >
                        <Badge variant={r.direction === 'out' ? 'default' : 'secondary'} className="text-[10px]">
                          {r.direction === 'out' ? '下游' : '上游'}
                        </Badge>
                        <span className="text-gray-500">{r.relation_type}</span>
                        <button
                          className="font-mono text-blue-600 hover:underline"
                          onClick={() => openDetail(r.other_code)}
                        >
                          {r.other_code}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 登记设备对话框 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记设备</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>设备编号 *</Label>
                <Input
                  value={form.device_code}
                  onChange={(e) => setForm((s) => ({ ...s, device_code: e.target.value }))}
                  placeholder="如 L-3F-A-001"
                />
              </div>
              <div className="space-y-1">
                <Label>名称 *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="如 走道筒灯"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>所属子系统</Label>
              <Select
                value={form.subsystem_id ? String(form.subsystem_id) : ''}
                onValueChange={(v) => setForm((s) => ({ ...s, subsystem_id: v ? Number(v) : null }))}
              >
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>楼栋</Label>
                <Input
                  value={form.building}
                  onChange={(e) => setForm((s) => ({ ...s, building: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>楼层</Label>
                <Input
                  value={form.floor}
                  onChange={(e) => setForm((s) => ({ ...s, floor: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>位置描述</Label>
              <Input
                value={form.location_desc}
                onChange={(e) => setForm((s) => ({ ...s, location_desc: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? '保存中...' : '登记'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
