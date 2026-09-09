import type { RecordItem, FieldDef } from '@/types/asset'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, ArrowRightLeft } from 'lucide-react'

interface Props {
  title: string
  records: RecordItem[]
  fields: FieldDef[]
  onEdit?: (r: RecordItem) => void
  onDelete?: (r: RecordItem) => void
  /** 开启多选（批量转移用） */
  selectable?: boolean
  selectedIds?: number[]
  onSelectionChange?: (ids: number[]) => void
  /** 行内「转移」：把该条记录按字段映射挪到别的资料表 */
  onTransfer?: (r: RecordItem) => void
}

export default function DynamicRecordTable({
  title,
  records,
  fields,
  onEdit,
  onDelete,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onTransfer,
}: Props) {
  const cols: { key: string; label: string }[] =
    fields.length > 0
      ? fields.map((f) => ({ key: f.key, label: f.label }))
      : Object.keys(records[0]?.data ?? {}).map((k) => ({ key: k, label: k }))

  const hasActions = !!(onEdit || onDelete || onTransfer)
  const selected = new Set(selectedIds)
  const allChecked = records.length > 0 && records.every((r) => selected.has(r.id))

  const toggleAll = () => {
    if (!onSelectionChange) return
    onSelectionChange(allChecked ? [] : records.map((r) => r.id))
  }
  const toggleOne = (id: number) => {
    if (!onSelectionChange) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(records.map((r) => r.id).filter((rid) => next.has(rid)))
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 flex items-center justify-between">
        <span>{title}</span>
        <span className="text-xs text-gray-400">{records.length} 条</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="全选"
                  />
                </TableHead>
              )}
              {cols.map((c) => (
                <TableHead key={c.key}>{c.label}</TableHead>
              ))}
              {hasActions && <TableHead className="text-right">操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0)} className="text-center py-6 text-gray-500">
                  暂无记录
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id} className={selected.has(r.id) ? 'bg-blue-50/50' : undefined}>
                  {selectable && (
                    <TableCell>
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        aria-label={`选择记录 ${r.device_code}`}
                      />
                    </TableCell>
                  )}
                  {cols.map((c) => (
                    <TableCell key={c.key}>{r.data?.[c.key] ?? '-'}</TableCell>
                  ))}
                  {hasActions && (
                    <TableCell className="text-right whitespace-nowrap">
                      {onTransfer && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="转移到其他资料表"
                          className="text-blue-600"
                          onClick={() => onTransfer(r)}
                        >
                          <ArrowRightLeft className="w-4 h-4" />
                        </Button>
                      )}
                      {onEdit && (
                        <Button variant="ghost" size="icon" onClick={() => onEdit(r)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {onDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-600"
                          onClick={() => onDelete(r)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
