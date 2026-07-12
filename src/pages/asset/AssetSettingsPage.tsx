import { useEffect, useState } from 'react'
import type { Subsystem, DataTable, DeviceRelation, Device } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
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
import { Plus, Trash2, Link2 } from 'lucide-react'

export default function AssetSettingsPage() {
  const { toast } = useToast()
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [subId, setSubId] = useState<string>('')
  const [tables, setTables] = useState<DataTable[]>([])
  const [tableId, setTableId] = useState<string>('')
  const [relations, setRelations] = useState<DeviceRelation[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [newTable, setNewTable] = useState({ code: '', name: '' })
  const [relFrom, setRelFrom] = useState('')
  const [relTo, setRelTo] = useState('')
  const [relType, setRelType] = useState('关联')

  const reloadSubsystems = () =>
    assetApi
      .listSubsystems()
      .then(setSubsystems)
      .catch(() => toast({ title: '加载子系统失败', variant: 'destructive' }))
  const reloadTables = (sid: string) =>
    sid ? assetApi.listTables(Number(sid)).then(setTables) : setTables([])
  const reloadRelations = () =>
    assetApi
      .listRelations()
      .then(setRelations)
      .catch(() => toast({ title: '加载关联失败', variant: 'destructive' }))

  useEffect(() => {
    reloadSubsystems()
    reloadRelations()
    assetApi
      .listDevices()
      .then(setDevices)
      .catch(() => {})
  }, [toast])

  useEffect(() => {
    setTableId('')
    reloadTables(subId)
  }, [subId])

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
      })
      toast({ title: '关联已添加' })
      setRelFrom('')
      setRelTo('')
      setRelType('关联')
      reloadRelations()
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
    } catch (e) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  const activeFieldsTable = tables.find((t) => String(t.id) === tableId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">资料配置</h1>
        <p className="text-gray-500 mt-1">
          维护子系统、资料表字段与设备关联关系。
        </p>
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
            <CardContent className="pt-6">
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium text-gray-700">
                        资料表（{tables.length}）
                      </h4>
                    </div>
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
                      {tables.map((t) => (
                        <div
                          key={t.id}
                          className={`flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer ${
                            String(t.id) === tableId ? 'bg-blue-50 border-blue-200' : ''
                          }`}
                          onClick={() => setTableId(String(t.id))}
                        >
                          <div>
                            <span className="font-medium text-sm">{t.name}</span>
                            <span className="text-xs text-gray-400 ml-2">{t.code}</span>
                            <Badge variant="outline" className="ml-2">
                              {t.field_count ?? 0} 字段
                            </Badge>
                          </div>
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
                      ))}
                      {tables.length === 0 && (
                        <p className="text-sm text-gray-500">该子系统下暂无资料表。</p>
                      )}
                    </div>
                  </div>

                  <div>
                    {activeFieldsTable ? (
                      <FieldManager
                        tableId={activeFieldsTable.id}
                        fields={[]}
                        onChanged={() => {
                          reloadTables(subId)
                        }}
                      />
                    ) : (
                      <p className="text-sm text-gray-500">请选择左侧资料表以管理字段。</p>
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

              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-4 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600">
                  <span>源设备</span>
                  <span>关系</span>
                  <span>目标设备</span>
                  <span className="text-right">操作</span>
                </div>
                <div className="divide-y">
                  {relations.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                      暂无关联记录
                    </div>
                  )}
                  {relations.map((r) => (
                    <div
                      key={r.id}
                      className="grid grid-cols-4 px-4 py-3 text-sm items-center"
                    >
                      <span className="font-medium">{r.from_code}</span>
                      <span>
                        <Badge variant="outline">{r.relation_type}</Badge>
                      </span>
                      <span className="text-gray-600">{r.to_code}</span>
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
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
