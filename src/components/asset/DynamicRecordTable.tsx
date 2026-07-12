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
import { Pencil, Trash2 } from 'lucide-react'

interface Props {
  title: string
  records: RecordItem[]
  fields: FieldDef[]
  onEdit?: (r: RecordItem) => void
  onDelete?: (r: RecordItem) => void
}

export default function DynamicRecordTable({ title, records, fields, onEdit, onDelete }: Props) {
  const cols: { key: string; label: string }[] =
    fields.length > 0
      ? fields.map((f) => ({ key: f.key, label: f.label }))
      : Object.keys(records[0]?.data ?? {}).map((k) => ({ key: k, label: k }))

  const hasActions = !!(onEdit || onDelete)

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
              {cols.map((c) => (
                <TableHead key={c.key}>{c.label}</TableHead>
              ))}
              {hasActions && <TableHead className="text-right">操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols.length + (hasActions ? 1 : 0)} className="text-center py-6 text-gray-500">
                  暂无记录
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  {cols.map((c) => (
                    <TableCell key={c.key}>{r.data?.[c.key] ?? '-'}</TableCell>
                  ))}
                  {hasActions && (
                    <TableCell className="text-right whitespace-nowrap">
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
