import { useEffect, useState } from 'react'
import type { Device, DeviceRelation, Subsystem, DevicePayload } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import DeviceRelationEditor from '@/components/asset/DeviceRelationEditor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Search, Plus, Trash2, Boxes } from 'lucide-react'

export default function DeviceLedgerPage() {
  const { toast } = useToast()
  const [devices, setDevices] = useState<Device[]>([])
  const [relations, setRelations] = useState<DeviceRelation[]>([])
  const [subsystems, setSubsystems] = useState<Subsystem[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Device | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<DevicePayload>({
    device_code: '',
    name: '',
    subsystem_id: null,
    building: '',
    floor: '',
    location_desc: '',
  })
  const [saving, setSaving] = useState(false)

  const loadDevices = (q?: string) => {
    assetApi
      .listDevices(q || undefined)
      .then(setDevices)
      .catch(() => toast({ title: '加载设备失败', variant: 'destructive' }))
  }
  const loadRelations = () => {
    assetApi
      .listRelations()
      .then(setRelations)
      .catch(() => toast({ title: '加载关联失败', variant: 'destructive' }))
  }

  useEffect(() => {
    assetApi
      .listSubsystems()
      .then(setSubsystems)
      .catch(() => {})
    loadDevices()
    loadRelations()
  }, [toast])

  useEffect(() => {
    const t = setTimeout(() => loadDevices(query.trim() || undefined), 200)
    return () => clearTimeout(t)
  }, [query])

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
      setForm({
        device_code: '',
        name: '',
        subsystem_id: null,
        building: '',
        floor: '',
        location_desc: '',
      })
      loadDevices(query.trim() || undefined)
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

  const handleDelete = async (d: Device) => {
    if (!confirm(`确定注销设备「${d.name}」？历史资料将保留，仅清理关联关系。`)) return
    try {
      await assetApi.deleteDevice(d.id)
      toast({ title: '设备已注销', description: '历史资料已保留' })
      if (selected?.id === d.id) setSelected(null)
      loadDevices(query.trim() || undefined)
    } catch (e) {
      toast({
        title: '注销失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">设备台账</h1>
          <p className="text-gray-500 mt-1">
            登记与管理各系统设备，建立跨系统关联（注销设备保留历史资料）。
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          登记设备
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 设备列表 */}
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">设备列表（{devices.length}）</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="搜索设备编号 / 名称 / 位置"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[60vh] overflow-y-auto divide-y">
              {devices.length === 0 && (
                <p className="text-sm text-gray-500 py-6 text-center">暂无设备</p>
              )}
              {devices.map((d) => (
                <div
                  key={d.id}
                  className={`flex items-center justify-between py-3 px-2 rounded-md cursor-pointer transition-colors ${
                    selected?.id === d.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelected(d)}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{d.name}</span>
                      <Badge variant={d.is_active ? 'success' : 'secondary'}>
                        {d.is_active ? '在用' : '已注销'}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {d.device_code}
                      {d.subsystem_name ? ` · ${d.subsystem_name}` : ''}
                      {d.location_desc ? ` · ${d.location_desc}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-600"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(d)
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 设备详情 + 关联 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">设备详情与关联</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className="py-16 text-center text-gray-400">
                <Boxes className="w-10 h-10 mx-auto mb-3 opacity-50" />
                从左侧选择一台设备查看详情并维护关联
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{selected.name}</span>
                    <Badge variant={selected.is_active ? 'success' : 'secondary'}>
                      {selected.is_active ? '在用' : '已注销'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    编号：{selected.device_code}
                    {selected.subsystem_name ? ` · ${selected.subsystem_name}` : ''}
                    {selected.building ? ` · ${selected.building}` : ''}
                    {selected.floor ? ` · ${selected.floor}` : ''}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">关联设备</h4>
                  <DeviceRelationEditor
                    deviceCode={selected.device_code}
                    relations={relations}
                    devices={devices}
                    onChanged={loadRelations}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                onValueChange={(v) =>
                  setForm((s) => ({ ...s, subsystem_id: v ? Number(v) : null }))
                }
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
