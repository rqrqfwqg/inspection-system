import { useState } from 'react'
import type { Subsystem, SubsystemPayload } from '@/types/asset'
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
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { Plus, Pencil, Trash2 } from 'lucide-react'

const ICON_OPTIONS = [
  'Zap',
  'Flame',
  'Cable',
  'Snowflake',
  'Lightbulb',
  'Droplets',
  'Fan',
  'Cpu',
  'Wrench',
  'Database',
]

interface Props {
  subsystems: Subsystem[]
  onChanged: () => void
}

export default function SubsystemManager({ subsystems, onChanged }: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Subsystem | null>(null)
  const [form, setForm] = useState<SubsystemPayload>({
    code: '',
    name: '',
    icon: 'Zap',
    sort_order: subsystems.length + 1,
  })
  const [saving, setSaving] = useState(false)

  const openAdd = () => {
    setEditing(null)
    setForm({ code: '', name: '', icon: 'Zap', sort_order: subsystems.length + 1 })
    setOpen(true)
  }
  const openEdit = (s: Subsystem) => {
    setEditing(s)
    setForm({ code: s.code, name: s.name, icon: s.icon, sort_order: s.sort_order })
    setOpen(true)
  }

  const save = async () => {
    if (!form.code?.trim() || !form.name?.trim()) {
      toast({ title: '请填写编码与名称', variant: 'destructive' })
      return
    }
    try {
      setSaving(true)
      if (editing) await assetApi.updateSubsystem(editing.id, form)
      else await assetApi.createSubsystem(form)
      toast({ title: '子系统已保存' })
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

  const remove = async (s: Subsystem) => {
    if (!confirm(`确定删除子系统「${s.name}」及其下全部资料表？`)) return
    try {
      await assetApi.deleteSubsystem(s.id)
      toast({ title: '子系统已删除' })
      onChanged()
    } catch (e) {
      toast({ title: '删除失败', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">子系统（{subsystems.length}）</h4>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" />
          新增子系统
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {subsystems.map((s) => (
          <div key={s.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="secondary">{s.icon}</Badge>
                <span className="font-medium truncate">{s.name}</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-600"
                  onClick={() => remove(s)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">code: {s.code}</p>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑子系统' : '新增子系统'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>编码（唯一）</Label>
                <Input
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
                  placeholder="如 lighting"
                />
              </div>
              <div className="space-y-1">
                <Label>名称</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="如 照明系统"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>图标</Label>
                <select
                  value={form.icon}
                  onChange={(e) => setForm((s) => ({ ...s, icon: e.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ICON_OPTIONS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>排序</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, sort_order: Number(e.target.value) }))
                  }
                />
              </div>
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
