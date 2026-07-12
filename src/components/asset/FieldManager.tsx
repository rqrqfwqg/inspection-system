import { useState } from 'react'
import type { FieldDef, FieldType } from '@/types/asset'
import { assetApi } from '@/services/assetApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'device_ref']
const TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  number: '数字',
  date: '日期',
  select: '单选',
  device_ref: '设备引用',
}

interface Props {
  tableId: number
  fields: FieldDef[]
  onChanged: () => void
}

export default function FieldManager({ tableId, fields, onChanged }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<FieldDef | null>(null)
  const [form, setForm] = useState({
    key: '',
    label: '',
    type: 'text' as FieldType,
    options: '',
    is_required: false,
    is_relation_key: false,
  })
  const [saving, setSaving] = useState(false)

  const openAdd = () => {
    setEditing(null)
    setForm({ key: '', label: '', type: 'text', options: '', is_required: false, is_relation_key: false })
    setOpen(true)
  }
  const openEdit = (f: FieldDef) => {
    setEditing(f)
    setForm({
      key: f.key,
      label: f.label,
      type: f.type,
      options: (f.options || []).join(','),
      is_required: f.is_required,
      is_relation_key: f.is_relation_key,
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.key.trim() || !form.label.trim()) {
      toast({ title: '请填写字段 key 与 label', variant: 'destructive' })
      return
    }
    try {
      setSaving(true)
      const payload = {
        table_id: tableId,
        key: form.key.trim(),
        label: form.label.trim(),
        type: form.type,
        options:
          form.type === 'select'
            ? form.options.split(',').map((s) => s.trim()).filter(Boolean)
            : [],
        is_required: form.is_required,
        is_relation_key: form.is_relation_key,
      }
      if (editing) await assetApi.updateField(tableId, editing.id, payload)
      else await assetApi.createField(tableId, payload)
      toast({ title: '字段已保存' })
      setOpen(false)
      onChanged()
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (f: FieldDef) => {
    if (!confirm(`确定删除字段「${f.label}」？`)) return
    try {
      await assetApi.deleteField(tableId, f.id)
      toast({ title: '字段已删除' })
      onChanged()
    } catch (e) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">字段定义（{fields.length}）</h4>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" />
          新增字段
        </Button>
      </div>
      <div className="space-y-2">
        {fields.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <div className="text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="text-gray-400 ml-2 text-xs">{f.key}</span>
              <span className="ml-2 inline-flex gap-1 align-middle">
                <Badge variant="secondary">{TYPE_LABELS[f.type]}</Badge>
                {f.is_relation_key && <Badge variant="default">关联键</Badge>}
                {f.is_required && <Badge variant="outline">必填</Badge>}
              </span>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => openEdit(f)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-red-600"
                onClick={() => remove(f)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        {fields.length === 0 && <p className="text-sm text-gray-500">暂无字段。</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑字段' : '新增字段'}</DialogTitle>
            <DialogDescription>
              字段 key 为系统标识，创建后建议勿随意更改；label 为展示名称。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>字段 key</Label>
                <Input
                  value={form.key}
                  disabled={!!editing}
                  onChange={(e) => setForm((s) => ({ ...s, key: e.target.value }))}
                  placeholder="如 rated_power"
                />
              </div>
              <div className="space-y-1">
                <Label>展示名称</Label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))}
                  placeholder="如 额定功率"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>类型</Label>
                <select
                  value={form.type}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, type: e.target.value as FieldType }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>选项（单选，逗号分隔）</Label>
                <Input
                  value={form.options}
                  disabled={form.type !== 'select'}
                  onChange={(e) => setForm((s) => ({ ...s, options: e.target.value }))}
                  placeholder="LED,荧光"
                />
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_required}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, is_required: e.target.checked }))
                  }
                />
                必填
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_relation_key}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, is_relation_key: e.target.checked }))
                  }
                />
                作为关联键（设备编号）
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
