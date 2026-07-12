import { useEffect, useState } from 'react'
import type { FieldDef, RecordItem } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: number
  fields: FieldDef[]
  initial: RecordItem | null
  onSaved: () => void
}

export default function RecordEditDialog({
  open,
  onOpenChange,
  tableId,
  fields,
  initial,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const [form, setForm] = useState<Record<string, any>>({})
  const [deviceCode, setDeviceCode] = useState('')
  const [saving, setSaving] = useState(false)

  const relField =
    fields.find((f) => f.is_relation_key) || fields.find((f) => f.type === 'device_ref')

  useEffect(() => {
    if (!open) return
    const init: Record<string, any> = {}
    fields.forEach((f) => {
      init[f.key] = initial?.data?.[f.key] ?? ''
    })
    setForm(init)
    setDeviceCode(initial?.device_code ?? '')
  }, [open, initial, fields])

  const handleSave = async () => {
    try {
      setSaving(true)
      const payload: { data: Record<string, any>; device_code?: string } = { data: form }
      if (deviceCode) payload.device_code = deviceCode
      else if (relField) payload.device_code = form[relField.key]
      if (initial) await assetApi.updateRecord(tableId, initial.id, payload)
      else await assetApi.createRecord(tableId, payload)
      toast({ title: '保存成功' })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑记录' : '新增记录'}</DialogTitle>
          <DialogDescription>
            填写以下字段，关联键字段（设备编号）将用于跨系统挂载。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {relField && (
            <div className="space-y-1">
              <Label>设备编号（关联键）</Label>
              <Input
                value={deviceCode}
                onChange={(e) => setDeviceCode(e.target.value)}
                placeholder="可留空，将取关联键字段值"
              />
            </div>
          )}
          {fields.map((f) => (
            <div key={f.id} className="space-y-1">
              <Label>
                {f.label}
                {f.is_required && <span className="text-red-500"> *</span>}
              </Label>
              {f.type === 'select' ? (
                <Select
                  value={form[f.key] || ''}
                  onValueChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={
                    f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'
                  }
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          {fields.length === 0 && (
            <p className="text-sm text-gray-500">该表暂无字段定义。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
