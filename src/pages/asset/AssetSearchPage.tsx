import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { SearchResult, FieldDef, RecordItem, Subsystem } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import DeviceSearchBar from '@/components/asset/DeviceSearchBar'
import DeviceDataPanel from '@/components/asset/DeviceDataPanel'
import DeviceInfoCard from '@/components/asset/DeviceInfoCard'
import RecordGroupPanel from '@/components/asset/RecordGroupPanel'
import RecordEditDialog from '@/components/asset/RecordEditDialog'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Layers, FileSearch } from 'lucide-react'

export default function AssetSearchPage() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const code = params.get('code') || ''
  const depth = Math.max(1, Math.min(5, Number(params.get('depth') || 2)))

  const [input, setInput] = useState(code)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [fieldsMap, setFieldsMap] = useState<Record<number, FieldDef[]>>({})
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<{ tableId: number; record: RecordItem | null } | null>(null)

  useEffect(() => {
    assetApi.listSubsystems().then(setSubsystems).catch(() => {})
  }, [])

  /* 搜索以 URL 参数为准：可分享链接、刷新可复现、浏览器后退可回到上一个设备 */
  const runSearch = useCallback(async (target: string, d: number) => {
    const key = target.trim()
    if (!key) return
    try {
      setLoading(true)
      const res = await assetApi.search(key, d)
      setResult(res)

      const tableIds = new Set<number>()
      res.groups.forEach((g) => g.tables.forEach((t) => tableIds.add(t.table_id)))
      const entries = await Promise.all(
        [...tableIds].map(async (id) => {
          try {
            return [id, await assetApi.listFields(id)] as const
          } catch {
            return [id, [] as FieldDef[]] as const
          }
        })
      )
      const map: Record<number, FieldDef[]> = {}
      entries.forEach(([id, f]) => {
        map[id] = f
      })
      setFieldsMap(map)

      if (!res.found) {
        toast({
          title: '未找到该设备',
          description: '请确认编号或名称；也可先在资料表中登记该设备。',
          variant: 'destructive',
        })
      }
    } catch (e) {
      toast({
        title: '检索失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (code) {
      void runSearch(code, depth)
    } else {
      setResult(null)
    }
  }, [code, depth, runSearch])

  const submit = (next?: string, d?: number) => {
    const key = (next ?? input).trim()
    if (!key) {
      toast({ title: '请输入设备编号或名称', variant: 'destructive' })
      return
    }
    setInput(key)
    setParams({ code: key, depth: String(d ?? depth) })
  }

  const handleEditRecord = (tableId: number, r: RecordItem) => setEdit({ tableId, record: r })

  const handleDeleteRecord = async (tableId: number, r: RecordItem) => {
    if (!confirm('确定删除该记录？')) return
    try {
      await assetApi.deleteRecord(tableId, r.id)
      toast({ title: '记录已删除' })
      void runSearch(code, depth)
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
    if (code) void runSearch(code, depth)
  }

  /** 子系统卡 → 滚动到对应明细区块 */
  const openSubsystem = (subCode: string) => {
    const el = document.getElementById(`sub-${subCode || 'none'}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">设备数据面板</h1>
          <p className="text-gray-500 mt-1">
            搜索任意设备（含现场台账设备），查看其供配电、弱电等各系统档案、供电链路与关联设备。
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>关联深度</span>
          <select
            value={depth}
            onChange={(e) => submit(code || input, Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {d} 跳
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DeviceSearchBar
            value={input}
            onChange={setInput}
            onSearch={(c) => submit(c)}
            loading={loading}
          />
        </CardContent>
      </Card>

      {!code && !loading && (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            <FileSearch className="w-10 h-10 mx-auto mb-3 opacity-50" />
            输入设备编号或名称（支持模糊匹配）后开始检索
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-6">
          {result.profile ? (
            <DeviceDataPanel
              result={result}
              subsystems={subsystems}
              onPickDevice={(c) => submit(c)}
              onOpenSubsystem={openSubsystem}
            />
          ) : (
            <DeviceInfoCard device={result.target} />
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">跨子系统资料明细</h2>
              <span className="text-sm text-gray-500">共 {result.total_records} 条</span>
            </div>
            {result.groups.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-gray-400">
                  未检索到该设备的资料记录。
                </CardContent>
              </Card>
            ) : (
              result.groups.map((g, i) => (
                <div key={`${g.subsystem_code}-${i}`} id={`sub-${g.subsystem_code || 'none'}`}>
                  <RecordGroupPanel
                    group={g}
                    fieldsMap={fieldsMap}
                    onEditRecord={handleEditRecord}
                    onDeleteRecord={handleDeleteRecord}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {edit && (
        <RecordEditDialog
          open={!!edit}
          onOpenChange={(o) => !o && setEdit(null)}
          tableId={edit.tableId}
          fields={fieldsMap[edit.tableId] || []}
          initial={edit.record}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
