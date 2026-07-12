import { useEffect, useRef, useState } from 'react'
import type { Subsystem, DataTable, FieldDef, RecordItem } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import DynamicRecordTable from '@/components/asset/DynamicRecordTable'
import RecordEditDialog from '@/components/asset/RecordEditDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Plus, Upload, Download, FileSpreadsheet } from 'lucide-react'

export default function AssetLedgerPage() {
  const { toast } = useToast()
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [tables, setTables] = useState<DataTable[]>([])
  const [subId, setSubId] = useState<string>('')
  const [tableId, setTableId] = useState<string>('')
  const [fields, setFields] = useState<FieldDef[]>([])
  const [records, setRecords] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<RecordItem | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    assetApi
      .listSubsystems()
      .then(setSubsystems)
      .catch(() => toast({ title: '加载子系统失败', variant: 'destructive' }))
  }, [toast])

  useEffect(() => {
    if (!subId) {
      setTables([])
      setTableId('')
      return
    }
    assetApi
      .listTables(Number(subId))
      .then(setTables)
      .catch(() => toast({ title: '加载资料表失败', variant: 'destructive' }))
  }, [subId, toast])

  const loadRecords = async (tid: string) => {
    if (!tid) {
      setRecords([])
      setFields([])
      return
    }
    try {
      setLoading(true)
      const [f, r] = await Promise.all([
        assetApi.listFields(Number(tid)),
        assetApi.listRecords(Number(tid)),
      ])
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

  useEffect(() => {
    setEdit(undefined)
    loadRecords(tableId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  const handleDeleteRecord = async (r: RecordItem) => {
    if (!confirm('确定删除该记录？')) return
    try {
      await assetApi.deleteRecord(Number(tableId), r.id)
      toast({ title: '记录已删除' })
      loadRecords(tableId)
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
    loadRecords(tableId)
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
        description: `新增 ${res.created} 条，跳过 ${res.skipped} 条（缺设备编号）`,
      })
      loadRecords(tableId)
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
    const tbl = tables.find((t) => String(t.id) === tableId)
    assetApi.exportRecordsToExcel(records, fields, tbl?.name || '资料导出')
  }

  const activeTable = tables.find((t) => String(t.id) === tableId)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">资料台账</h1>
          <p className="text-gray-500 mt-1">
            按子系统、资料表浏览与维护各类设备资料，支持 Excel 批量导入 / 导出。
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-gray-500">子系统</label>
            <Select value={subId} onValueChange={setSubId}>
              <SelectTrigger className="w-56">
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
          <div className="space-y-1">
            <label className="text-xs text-gray-500">资料表</label>
            <Select
              value={tableId}
              onValueChange={setTableId}
              disabled={!subId}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="选择资料表" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {activeTable && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setEdit(null)} disabled={!tableId}>
                <Plus className="w-4 h-4 mr-1" />
                新增记录
              </Button>
              <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                <Upload className="w-4 h-4 mr-1" />
                {importing ? '导入中...' : 'Excel 导入'}
              </Button>
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4 mr-1" />
                导出
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
        </CardContent>
      </Card>

      {!tableId && (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-50" />
            请先选择子系统与资料表
          </CardContent>
        </Card>
      )}

      {tableId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {activeTable?.name}
              <Badge variant="outline" className="ml-2">
                {records.length} 条
              </Badge>
            </CardTitle>
            <span className="text-xs text-gray-400">
              关联键：{fields.find((f) => f.is_relation_key)?.label || '—'}
            </span>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-gray-500 py-6">加载中...</p>
            ) : (
              <DynamicRecordTable
                title={activeTable?.name || ''}
                records={records}
                fields={fields}
                onEdit={(r) => setEdit(r)}
                onDelete={handleDeleteRecord}
              />
            )}
          </CardContent>
        </Card>
      )}

      {tableId && (
        <RecordEditDialog
          open={!!tableId && edit !== undefined}
          onOpenChange={(o) => !o && setEdit(undefined)}
          tableId={Number(tableId)}
          fields={fields}
          initial={edit ?? null}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
