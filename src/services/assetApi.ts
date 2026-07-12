// 分系统资料管理 · 前端 API 封装
// 挂载前缀：/api/assets
import * as XLSX from 'xlsx'
import { api } from '@/services/api'
import type {
  Subsystem,
  SubsystemPayload,
  SubsystemUpdatePayload,
  Device,
  DevicePayload,
  DeviceUpdatePayload,
  DataTable,
  DataTablePayload,
  DataTableUpdatePayload,
  FieldDef,
  FieldPayload,
  FieldUpdatePayload,
  RecordItem,
  RecordPayload,
  RecordUpdatePayload,
  BulkRecordItem,
  DeviceRelation,
  DeviceRelationPayload,
  DeviceRelationUpdatePayload,
  SearchResult,
  BulkResult,
} from '@/types/asset'

const BASE = '/assets'

class AssetApiService {
  // ==================== 子系统 ====================
  listSubsystems() {
    return api.get<Subsystem[]>(`${BASE}/subsystems`)
  }
  createSubsystem(data: SubsystemPayload) {
    return api.post<Subsystem>(`${BASE}/subsystems`, data)
  }
  updateSubsystem(id: number, data: SubsystemUpdatePayload) {
    return api.put<Subsystem>(`${BASE}/subsystems/${id}`, data)
  }
  deleteSubsystem(id: number) {
    return api.delete<{ success: boolean; message: string }>(`${BASE}/subsystems/${id}`)
  }

  // ==================== 资料表 ====================
  listTables(subsystemId?: number) {
    const q = subsystemId ? `?subsystem_id=${subsystemId}` : ''
    return api.get<DataTable[]>(`${BASE}/tables${q}`)
  }
  getTable(id: number) {
    return api.get<DataTable>(`${BASE}/tables/${id}`)
  }
  createTable(data: DataTablePayload) {
    return api.post<DataTable>(`${BASE}/tables`, data)
  }
  updateTable(id: number, data: DataTableUpdatePayload) {
    return api.put<DataTable>(`${BASE}/tables/${id}`, data)
  }
  deleteTable(id: number) {
    return api.delete<{ success: boolean; message: string }>(`${BASE}/tables/${id}`)
  }

  // ==================== 字段定义 ====================
  listFields(tableId: number) {
    return api.get<FieldDef[]>(`${BASE}/tables/${tableId}/fields`)
  }
  createField(tableId: number, data: FieldPayload) {
    return api.post<FieldDef>(`${BASE}/tables/${tableId}/fields`, data)
  }
  updateField(tableId: number, fieldId: number, data: FieldUpdatePayload) {
    return api.put<FieldDef>(`${BASE}/tables/${tableId}/fields/${fieldId}`, data)
  }
  deleteField(tableId: number, fieldId: number) {
    return api.delete<{ success: boolean; message: string }>(`${BASE}/tables/${tableId}/fields/${fieldId}`)
  }

  // ==================== 资料记录 ====================
  listRecords(tableId: number, deviceCode?: string) {
    const q = deviceCode ? `?device_code=${encodeURIComponent(deviceCode)}` : ''
    return api.get<RecordItem[]>(`${BASE}/tables/${tableId}/records${q}`)
  }
  createRecord(tableId: number, data: RecordPayload) {
    return api.post<RecordItem>(`${BASE}/tables/${tableId}/records`, data)
  }
  updateRecord(tableId: number, recordId: number, data: RecordUpdatePayload) {
    return api.put<RecordItem>(`${BASE}/tables/${tableId}/records/${recordId}`, data)
  }
  deleteRecord(tableId: number, recordId: number) {
    return api.delete<{ success: boolean; message: string }>(`${BASE}/tables/${tableId}/records/${recordId}`)
  }
  bulkCreateRecords(tableId: number, records: BulkRecordItem[]) {
    return api.post<BulkResult>(`${BASE}/tables/${tableId}/records/bulk`, { records })
  }

  // ==================== 设备台账 ====================
  listDevices(query?: string, subsystemId?: number) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (subsystemId) params.set('subsystem_id', String(subsystemId))
    const q = params.toString()
    return api.get<Device[]>(`${BASE}/devices${q ? '?' + q : ''}`)
  }
  createDevice(data: DevicePayload) {
    return api.post<Device>(`${BASE}/devices`, data)
  }
  updateDevice(id: number, data: DeviceUpdatePayload) {
    return api.put<Device>(`${BASE}/devices/${id}`, data)
  }
  // 软删除（保留历史资料，仅清理关联）
  deleteDevice(id: number) {
    return api.delete<{ success: boolean; message: string }>(`${BASE}/devices/${id}`)
  }

  // ==================== 设备关联 ====================
  listRelations(fromCode?: string, toCode?: string) {
    const params = new URLSearchParams()
    if (fromCode) params.set('from_code', fromCode)
    if (toCode) params.set('to_code', toCode)
    const q = params.toString()
    return api.get<DeviceRelation[]>(`${BASE}/relations${q ? '?' + q : ''}`)
  }
  createRelation(data: DeviceRelationPayload) {
    return api.post<DeviceRelation>(`${BASE}/relations`, data)
  }
  updateRelation(id: number, data: DeviceRelationUpdatePayload) {
    return api.put<DeviceRelation>(`${BASE}/relations/${id}`, data)
  }
  deleteRelation(id: number) {
    return api.delete<{ success: boolean; message: string }>(`${BASE}/relations/${id}`)
  }

  // ==================== 核心：设备全局检索 ====================
  search(code: string, depth = 2) {
    return api.get<SearchResult>(`${BASE}/search?code=${encodeURIComponent(code)}&depth=${depth}`)
  }

  // ==================== Excel 导入 / 导出 ====================

  /**
   * 解析 Excel 为记录数组。
   * 规则：首行为表头；表头匹配 field_defs 的 label（优先）或 key；
   * 命中 is_relation_key（device_ref）的列值作为 device_code，其余作为 data[key]。
   */
  async parseExcelToRecords(file: File, fields: FieldDef[]): Promise<BulkRecordItem[]> {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: false, defval: '' })
    if (rows.length < 2) return []
    const header = rows[0].map((h) => String(h ?? '').trim())
    const relField = fields.find((f) => f.is_relation_key) || fields.find((f) => f.type === 'device_ref')

    const keyByHeader = new Map<string, FieldDef>()
    for (const f of fields) {
      const idxByLabel = header.findIndex((h) => h === f.label)
      const idxByKey = header.findIndex((h) => h === f.key)
      const idx = idxByLabel !== -1 ? idxByLabel : idxByKey
      if (idx !== -1) keyByHeader.set(String(idx), f)
    }

    const result: BulkRecordItem[] = []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const data: Record<string, any> = {}
      let device_code: string | undefined
      let hasContent = false
      for (let c = 0; c < header.length; c++) {
        const raw = row[c]
        const value = raw === undefined || raw === null ? '' : String(raw).trim()
        const f = keyByHeader.get(String(c))
        if (!f) continue
        if (value) hasContent = true
        if (relField && f.key === relField.key) {
          device_code = value || undefined
        } else {
          data[f.key] = value
        }
      }
      if (!hasContent) continue
      result.push({ device_code: device_code ?? null, data })
    }
    return result
  }

  /** 将记录导出为 Excel 并触发下载。 */
  exportRecordsToExcel(records: RecordItem[], fields: FieldDef[], filename: string) {
    const header = fields.map((f) => f.label)
    const aoa: (string | number)[][] = [header]
    for (const r of records) {
      aoa.push(fields.map((f) => (r.data?.[f.key] ?? '') as string | number))
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '资料')
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
  }
}

export const assetApi = new AssetApiService()
