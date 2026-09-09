import { useEffect, useMemo, useRef, useState } from 'react'
import type { Subsystem, DataTable, FieldDef, RecordItem } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import DynamicRecordTable from '@/components/asset/DynamicRecordTable'
import RecordEditDialog from '@/components/asset/RecordEditDialog'
import RecordTransferDialog from '@/components/asset/RecordTransferDialog'
import type { TransferResult } from '@/types/asset'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  Plus,
  Upload,
  Download,
  ArrowLeft,
  Search,
  Database,
  Table2,
  Layers,
  PencilLine,
  ArrowRightLeft,
} from 'lucide-react'

/**
 * 数据表工作台（/asset/ledger）
 * ===================
 * 一级入口直接浏览「每一个数据表」：所有动态资料表以卡片平铺（名称/子系统/记录数/字段数/关联键），
 * 支持表名搜索与子系统筛选；点任意表进入该表的行级维护：
 *   新增 / 编辑 / 删除 / Excel 批量导入 / 导出，字段按 field_defs 动态渲染。
 *
 * 说明：这些表共用 data_tables+field_defs+records 泛化机制（结构同构，仅字段定义不同），
 * 故一套页面即可管理全部。系统主表（devices/rooms/fixed_assets…）字段异构且有业务约束，
 * 不进本页通用行编辑，走各自专属页面。
 */
export default function AssetLedgerPage() {
  const { toast } = useToast()
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [tables, setTables] = useState<DataTable[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)

  // 概览筛选
  const [q, setQ] = useState('')
  const [subFilter, setSubFilter] = useState('all') // 'all' | 子系统 id 字符串

  // 维护模式
  const [tableId, setTableId] = useState<number | null>(null)
  const [fields, setFields] = useState<FieldDef[]>([])
  const [records, setRecords] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<RecordItem | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 跨表转移（单行 or 批量）
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [transferIds, setTransferIds] = useState<number[]>([])
  const [transferOpen, setTransferOpen] = useState(false)
  // 单表内行级搜索：便于从大量记录里挑出分错系统的那些
  const [rowQ, setRowQ] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [ss, ts] = await Promise.all([assetApi.listSubsystems(), assetApi.listTables()])
        if (cancelled) return
        setSubsystems(ss)
        setTables(ts)
      } catch (e) {
        if (!cancelled)
          toast({ title: '加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [toast])

  const filteredTables = useMemo(() => {
    let list = tables
    if (subFilter !== 'all') list = list.filter((t) => String(t.subsystem_id) === subFilter)
    const kw = q.trim().toLowerCase()
    if (kw) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(kw) ||
          (t.code || '').toLowerCase().includes(kw) ||
          (t.subsystem_name || '').toLowerCase().includes(kw),
      )
    }
    return list
  }, [tables, q, subFilter])

  const activeTable = tableId ? tables.find((t) => t.id === tableId) || null : null

  const loadRecords = async (tid: number) => {
    try {
      setLoading(true)
      const [f, r] = await Promise.all([assetApi.listFields(tid), assetApi.listRecords(tid)])
      setFields(f)
      setRecords(r)
    } catch (e) {
      toast({
        title: '加载记录失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const openTable = (tid: number) => {
    setTableId(tid)
    setEdit(undefined)
    setRecords([])
    setFields([])
    setSelectedIds([])
    void loadRecords(tid)
  }

  const backToCatalog = () => {
    setTableId(null)
    setEdit(undefined)
    setRecords([])
    setFields([])
    setSelectedIds([])
  }

  const openTransfer = (ids: number[]) => {
    if (ids.length === 0) {
      toast({ title: '请先勾选要转移的记录', variant: 'destructive' })
      return
    }
    setTransferIds(ids)
    setTransferOpen(true)
  }

  const handleTransferred = (res: TransferResult) => {
    setSelectedIds([])
    setTransferIds([])
    // 记录数变化 → 顺带刷新表目录（概览卡片的记录数）
    void assetApi.listTables().then(setTables).catch(() => {})
    if (tableId) void loadRecords(tableId)
    if (res.moved > 0) {
      toast({ title: `已移动 ${res.moved} 条`, description: '原表记录已移除' })
    }
  }

  const handleDeleteRecord = async (r: RecordItem) => {
    if (!confirm('确定删除该记录？')) return
    try {
      await assetApi.deleteRecord(Number(tableId), r.id)
      toast({ title: '记录已删除' })
      if (tableId) void loadRecords(tableId)
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    }
  }

  const handleSaved = () => {
    setEdit(null)
    if (tableId) void loadRecords(tableId)
  }

  const handleImportClick = () => fileRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file || !tableId) return
    try {
      setImporting(true)
      const items = await assetApi.parseExcelToRecords(file, fields)
      if (items.length === 0) {
        toast({ title: '未解析到有效数据', description: '请检查表头是否与字段匹配', variant: 'destructive' })
        return
      }
      const res = await assetApi.bulkCreateRecords(Number(tableId), items)
      toast({
        title: '导入完成',
        description: `新增 ${res.created} 条，跳过 ${res.skipped} 条（缺关联键）`,
      })
      if (tableId) void loadRecords(tableId)
    } catch (err) {
      toast({
        title: '导入失败',
        description: err instanceof Error ? err.message : '',
        variant: 'destructive',
      })
    } finally {
      setImporting(false)
    }
  }

  const handleExport = () => {
    if (records.length === 0) {
      toast({ title: '暂无可导出的记录', variant: 'destructive' })
      return
    }
    assetApi.exportRecordsToExcel(records, fields, activeTable?.name || '资料导出')
  }

  const relationField = fields.find((f) => f.is_relation_key)

  // 行级过滤（按任意字段值或设备编号）
  const visibleRecords = useMemo(() => {
    const kw = rowQ.trim().toLowerCase()
    if (!kw) return records
    return records.filter((r) => {
      if ((r.device_code || '').toLowerCase().includes(kw)) return true
      return Object.values(r.data || {}).some((v) => String(v ?? '').toLowerCase().includes(kw))
    })
  }, [records, rowQ])

  /* ==================== 概览：所有表 ==================== */
  if (!tableId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">数据表管理</h1>
          <p className="text-gray-500 mt-1">
            共 {tables.length} 张动态资料表 · 每张表均可直接维护行数据（新增/编辑/删除/Excel 导入导出）。
            系统主表（设备/机房/固定资产）在各自专属页面管理。
          </p>
        </div>

        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              className="pl-8"
              placeholder="搜表名 / 代码 / 子系统…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={subFilter} onValueChange={setSubFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="全部子系统" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部子系统</SelectItem>
              {subsystems.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-400">命中 {filteredTables.length} 张表</span>
        </div>

        {catalogLoading ? (
          <Card>
            <CardContent className="py-16 text-center text-gray-400">加载中…</CardContent>
          </Card>
        ) : filteredTables.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
              没有匹配的资料表，换个关键词或清空筛选
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTables.map((t) => (
              <Card
                key={t.id}
                className="cursor-pointer transition hover:border-blue-400 hover:shadow-md"
                onClick={() => openTable(t.id)}
              >
                <CardHeader className="pb-2 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Table2 className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="truncate">{t.name}</span>
                    </CardTitle>
                    {t.subsystem_name && <Badge variant="secondary">{t.subsystem_name}</Badge>}
                  </div>
                  <p className="text-[11px] text-gray-400 font-mono truncate">{t.code}</p>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Database className="w-3.5 h-3.5 text-gray-400" />
                      {t.record_count ?? 0} 条记录
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-gray-400" />
                      {t.field_count ?? 0} 个字段
                    </span>
                    <span className="inline-flex items-center gap-1 text-blue-600 font-medium">
                      <PencilLine className="w-3.5 h-3.5" />
                      维护
                    </span>
                  </div>
                  {t.relation_key_label && (
                    <p className="text-[11px] text-gray-400 mt-2 truncate">
                      关联键：{t.relation_key_label}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  /* ==================== 单表维护模式 ==================== */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={backToCatalog}>
            <ArrowLeft className="w-4 h-4" />
            全部表
          </Button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              {activeTable?.name}
              <Badge variant="outline">{records.length} 条</Badge>
              {activeTable?.subsystem_name && <Badge variant="secondary">{activeTable.subsystem_name}</Badge>}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              关联键：{relationField?.label || '—'} · 字段 {fields.length} 个
              {activeTable?.code ? ` · ${activeTable.code}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEdit(null)}>
            <Plus className="w-4 h-4 mr-1" />
            新增记录
          </Button>
          <Button variant="outline" onClick={handleImportClick} disabled={importing}>
            <Upload className="w-4 h-4 mr-1" />
            {importing ? '导入中…' : 'Excel 导入'}
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" />
            导出
          </Button>
          {selectedIds.length > 0 && (
            <Button variant="secondary" onClick={() => openTransfer(selectedIds)}>
              <ArrowRightLeft className="w-4 h-4 mr-1" />
              转移选中 {selectedIds.length} 条
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {selectedIds.length > 0 && (
          <Button variant="secondary" onClick={() => openTransfer(selectedIds)}>
            <ArrowRightLeft className="w-4 h-4 mr-1" />
            转移选中 {selectedIds.length} 条
          </Button>
        )}
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
          <Input
            className="pl-8"
            placeholder="表内搜索（挑出分错系统的）"
            value={rowQ}
            onChange={(e) => setRowQ(e.target.value)}
          />
        </div>
        {rowQ && (
          <span className="text-xs text-gray-400">
            命中 {visibleRecords.length} / {records.length} 条（全选仅作用于筛选结果）
          </span>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-gray-500 py-6">加载中…</p>
          ) : (
            <DynamicRecordTable
              title={activeTable?.name || ''}
              records={visibleRecords}
              fields={fields}
              onEdit={(r) => setEdit(r)}
              onDelete={handleDeleteRecord}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onTransfer={(r) => openTransfer([r.id])}
            />
          )}
        </CardContent>
      </Card>

      <RecordEditDialog
        open={edit !== undefined}
        onOpenChange={(o) => !o && setEdit(undefined)}
        tableId={Number(tableId)}
        fields={fields}
        initial={edit ?? null}
        onSaved={handleSaved}
      />

      <RecordTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        sourceTable={activeTable}
        recordIds={transferIds}
        tables={tables}
        onDone={handleTransferred}
      />
    </div>
  )
}
