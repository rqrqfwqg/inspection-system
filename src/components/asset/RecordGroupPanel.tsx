import type { SearchGroup, FieldDef, RecordItem } from '@/types/asset'
import DynamicRecordTable from './DynamicRecordTable'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface Props {
  group: SearchGroup
  fieldsMap: Record<number, FieldDef[]>
  onEditRecord?: (tableId: number, r: RecordItem) => void
  onDeleteRecord?: (tableId: number, r: RecordItem) => void
  /** 表头「数据表管理」跳转（可视化 / 检索 → 数据表管理 方向联动） */
  onOpenTable?: (tableId: number) => void
  /** 关联键列可点击（records → 设备 方向联动） */
  onOpenDevice?: (code: string) => void
}

/**
 * 某一个子系统下的资料明细：按资料表分块渲染。
 * 它是「设备 ↔ 资料表」双向联动的落点：
 *   - 表头 → 去数据表管理维护这张表；
 *   - 关联键列 → 打开该编号的设备详情。
 */
export default function RecordGroupPanel({
  group,
  fieldsMap,
  onEditRecord,
  onDeleteRecord,
  onOpenTable,
  onOpenDevice,
}: Props) {
  const total = group.tables.reduce((s, t) => s + t.records.length, 0)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">{group.subsystem_name || '未归类'}</CardTitle>
        <span className="text-xs text-gray-400">
          {group.tables.length} 张表 · {total} 条
        </span>
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
            onOpenTable={onOpenTable ? () => onOpenTable(t.table_id) : undefined}
            onOpenDevice={onOpenDevice}
          />
        ))}
        {group.tables.length === 0 && (
          <p className="text-sm text-gray-500">该子系统下无资料。</p>
        )}
      </CardContent>
    </Card>
  )
}
