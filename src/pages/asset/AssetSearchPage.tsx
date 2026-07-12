import { useState } from 'react'
import type { SearchResult, FieldDef, RecordItem } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import DeviceSearchBar from '@/components/asset/DeviceSearchBar'
import DeviceInfoCard from '@/components/asset/DeviceInfoCard'
import DeviceRelationGraph from '@/components/asset/DeviceRelationGraph'
import RecordGroupPanel from '@/components/asset/RecordGroupPanel'
import RecordEditDialog from '@/components/asset/RecordEditDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Network, Layers, FileSearch } from 'lucide-react'

export default function AssetSearchPage() {
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [depth, setDepth] = useState(2)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [fieldsMap, setFieldsMap] = useState<Record<number, FieldDef[]>>({})
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<{ tableId: number; record: RecordItem | null } | null>(null)

  const doSearch = async () => {
    const c = code.trim()
    if (!c) {
      toast({ title: '请输入设备编号', variant: 'destructive' })
      return
    }
    try {
      setLoading(true)
      const res = await assetApi.search(c, depth)
      setResult(res)

      const tableIds = new Set<number>()
      res.groups.forEach((g) => g.tables.forEach((t) => tableIds.add(t.table_id)))
      const entries = await Promise.all(
        [...tableIds].map(async (id) => {
          try {
            const f = await assetApi.listFields(id)
            return [id, f] as const
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
          description: '请确认设备编号是否正确，或先在设备台账中登记。',
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
  }

  const handleEditRecord = (tableId: number, r: RecordItem) =>
    setEdit({ tableId, record: r })
  const handleDeleteRecord = async (tableId: number, r: RecordItem) => {
    if (!confirm('确定删除该记录？')) return
    try {
      await assetApi.deleteRecord(tableId, r.id)
      toast({ title: '记录已删除' })
      doSearch()
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
    doSearch()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">资料全局检索</h1>
          <p className="text-gray-500 mt-1">
            输入设备编号，聚合该设备跨子系统的全部资料，并追溯其关联设备。
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>关联深度</span>
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
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
          <DeviceSearchBar value={code} onChange={setCode} onSearch={doSearch} loading={loading} />
        </CardContent>
      </Card>

      {!result && !loading && (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            <FileSearch className="w-10 h-10 mx-auto mb-3 opacity-50" />
            输入设备编号后点击「全局检索」开始追溯
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 space-y-4">
              <DeviceInfoCard device={result.target} />
              <Card>
                <CardContent className="pt-6 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{result.nodes.length}</div>
                    <div className="text-xs text-gray-500">关联节点</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{result.edges.length}</div>
                    <div className="text-xs text-gray-500">关联边</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{result.total_records}</div>
                    <div className="text-xs text-gray-500">资料条数</div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                  <Network className="w-4 h-4 text-gray-500" />
                  <CardTitle className="text-base">关联追溯图</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.nodes.length > 0 ? (
                    <DeviceRelationGraph nodes={result.nodes} edges={result.edges} />
                  ) : (
                    <p className="text-sm text-gray-500 py-8 text-center">
                      该设备暂无关联记录。
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">跨子系统资料聚合</h2>
            </div>
            {result.groups.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-gray-400">
                  未检索到该设备的资料记录。
                </CardContent>
              </Card>
            ) : (
              result.groups.map((g, i) => (
                <RecordGroupPanel
                  key={`${g.subsystem_code}-${i}`}
                  group={g}
                  fieldsMap={fieldsMap}
                  onEditRecord={handleEditRecord}
                  onDeleteRecord={handleDeleteRecord}
                />
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
