import type { SearchGroup, FieldDef, RecordItem } from '@/types/asset'
import DynamicRecordTable from './DynamicRecordTable'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface Props {
  group: SearchGroup
  fieldsMap: Record<number, FieldDef[]>
  onEditRecord?: (tableId: number, r: RecordItem) => void
  onDeleteRecord?: (tableId: number, r: RecordItem) => void
}

export default function RecordGroupPanel({ group, fieldsMap, onEditRecord, onDeleteRecord }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">{group.subsystem_name || '未归类'}</CardTitle>
        {group.subsystem_icon && (
          <span className="text-xs text-gray-400">（{group.subsystem_icon}）</span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {group.tables.map((t) => (
          <DynamicRecordTable
            key={t.table_id}
            title={t.table_name}
            records={t.records}
            fields={fieldsMap[t.table_id] || []}
            onEdit={onEditRecord ? (r) => onEditRecord(t.table_id, r) : undefined}
            onDelete={onDeleteRecord ? (r) => onDeleteRecord(t.table_id, r) : undefined}
          />
        ))}
        {group.tables.length === 0 && (
          <p className="text-sm text-gray-500">该子系统下无资料。</p>
        )}
      </CardContent>
    </Card>
  )
}
