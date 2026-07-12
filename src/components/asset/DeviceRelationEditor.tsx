import { useState } from 'react'
import type { DeviceRelation, Device } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { Trash2, Plus } from 'lucide-react'

interface Props {
  deviceCode: string
  relations: DeviceRelation[]
  devices: Device[]
  onChanged: () => void
}

export default function DeviceRelationEditor({
  deviceCode,
  relations,
  devices,
  onChanged,
}: Props) {
  const { toast } = useToast()
  const [toCode, setToCode] = useState('')
  const [relType, setRelType] = useState('关联')
  const [saving, setSaving] = useState(false)

  const myRels = relations.filter(
    (r) => r.from_code === deviceCode || r.to_code === deviceCode
  )
  const others = devices.filter((d) => d.device_code !== deviceCode)

  const add = async () => {
    if (!toCode) {
      toast({ title: '请选择关联设备', variant: 'destructive' })
      return
    }
    try {
      setSaving(true)
      await assetApi.createRelation({
        from_code: deviceCode,
        to_code: toCode,
        relation_type: relType,
      })
      toast({ title: '关联已添加' })
      setToCode('')
      setRelType('关联')
      onChanged()
    } catch (e) {
      toast({
        title: '添加失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await assetApi.deleteRelation(id)
      toast({ title: '关联已删除' })
      onChanged()
    } catch (e) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="text-xs text-gray-500">关联设备</label>
          <select
            value={toCode}
            onChange={(e) => setToCode(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">选择设备...</option>
            {others.map((d) => (
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
        <Button onClick={add} disabled={saving}>
          <Plus className="w-4 h-4 mr-1" />
          添加关联
        </Button>
      </div>
      <div className="space-y-2">
        {myRels.length === 0 && <p className="text-sm text-gray-500">暂无关联。</p>}
        {myRels.map((r) => {
          const other = r.from_code === deviceCode ? r.to_code : r.from_code
          return (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>
                <Badge variant="outline">{r.relation_type}</Badge>
                <span className="ml-2 text-gray-600">{other}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-red-600"
                onClick={() => remove(r.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
