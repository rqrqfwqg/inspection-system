/**
 * 资料域写操作 API（子系统 / 资料表 / 字段 / 记录 / 转移 / 设备 / 关联 + Excel）
 * =====================================================================
 * 来源：React 版 `src/services/assetApi.ts` 的 `AssetApiService`，**逐方法等价迁移**。
 * 挂载前缀 `/assets`（最终请求 `/ops/api/assets`，与后端 asset_router 一致）。
 *
 * 与既有模块的职责边界（**去重，避免同一端点两处实现**）：
 *   - `/assets/asset-ledger/*`（4 个只读端点）→ `@/api/assetLedger`（一期已用，不重复实现）
 *   - `/assets/subsystems` 只读字典          → `@/api/dict#listSubsystems`
 *   - `/assets/search`、`/search/suggest`    → `@/api/search#searchDevice / suggestDevices`
 *   本文件只承担**写操作与动态表 CRUD**（React 版 AssetApiService 去掉上述重复项后的全部方法）。
 *
 * 纪律：不绕过 `@/api/http`（Bearer 注入、422 detail 数组拼消息、SPA catch-all 防 HTML）。
 */
import * as XLSX from 'xlsx'
import http from './http'
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
  TransferMapping,
  TransferPayload,
  TransferResult,
  DeviceRelation,
  DeviceRelationPayload,
  DeviceRelationUpdatePayload,
  BulkResult,
} from '@/types/asset'

const BASE = '/assets'

/** 成功/失败统一返回体（后端 delete 类端点） */
interface OkResult {
  success: boolean
  message: string
}

class AssetApiService {
  // ==================== 子系统 ====================
  createSubsystem(data: SubsystemPayload) {
    return http.post<Subsystem>(`${BASE}/subsystems`, data)
  }
  updateSubsystem(id: number, data: SubsystemUpdatePayload) {
    return http.put<Subsystem>(`${BASE}/subsystems/${id}`, data)
  }
  deleteSubsystem(id: number) {
    return http.delete<OkResult>(`${BASE}/subsystems/${id}`)
  }

  // ==================== 资料表 ====================
  /**
   * 列出资料表。
   * @param subsystemId   可选：按子系统过滤
   * @param includeInactive 是否包含已停用（软删）的表；默认 false（仅启用中）
   * 两参数可共存：`?subsystem_id=N&include_inactive=true`
   */
  listTables(subsystemId?: number, includeInactive = false) {
    const params = new URLSearchParams()
    if (subsystemId) params.set('subsystem_id', String(subsystemId))
    if (includeInactive) params.set('include_inactive', 'true')
    const q = params.toString()
    return http.get<DataTable[]>(`${BASE}/tables${q ? '?' + q : ''}`)
  }
  getTable(id: number) {
    return http.get<DataTable>(`${BASE}/tables/${id}`)
  }
  createTable(data: DataTablePayload) {
    return http.post<DataTable>(`${BASE}/tables`, data)
  }
  updateTable(id: number, data: DataTableUpdatePayload) {
    return http.put<DataTable>(`${BASE}/tables/${id}`, data)
  }
  deleteTable(id: number) {
    return http.delete<OkResult>(`${BASE}/tables/${id}`)
  }

  // ==================== 字段定义 ====================
  listFields(tableId: number) {
    return http.get<FieldDef[]>(`${BASE}/tables/${tableId}/fields`)
  }
  createField(tableId: number, data: FieldPayload) {
    return http.post<FieldDef>(`${BASE}/tables/${tableId}/fields`, data)
  }
  updateField(tableId: number, fieldId: number, data: FieldUpdatePayload) {
    return http.put<FieldDef>(`${BASE}/tables/${tableId}/fields/${fieldId}`, data)
  }
  deleteField(tableId: number, fieldId: number) {
    return http.delete<OkResult>(`${BASE}/tables/${tableId}/fields/${fieldId}`)
  }

  // ==================== 资料记录 ====================
  listRecords(tableId: number, deviceCode?: string) {
    const q = deviceCode ? `?device_code=${encodeURIComponent(deviceCode)}` : ''
    return http.get<RecordItem[]>(`${BASE}/tables/${tableId}/records${q}`)
  }
  createRecord(tableId: number, data: RecordPayload) {
    return http.post<RecordItem>(`${BASE}/tables/${tableId}/records`, data)
  }
  updateRecord(tableId: number, recordId: number, data: RecordUpdatePayload) {
    return http.put<RecordItem>(`${BASE}/tables/${tableId}/records/${recordId}`, data)
  }
  deleteRecord(tableId: number, recordId: number) {
    return http.delete<OkResult>(`${BASE}/tables/${tableId}/records/${recordId}`)
  }
  bulkCreateRecords(tableId: number, records: BulkRecordItem[]) {
    return http.post<BulkResult>(`${BASE}/tables/${tableId}/records/bulk`, { records })
  }

  // ==================== 记录跨表转移（字段映射） ====================
  getTransferMapping(sourceTableId: number, targetTableId: number) {
    return http.get<TransferMapping>(
      `${BASE}/tables/${sourceTableId}/transfer-mapping?target_table_id=${targetTableId}`,
    )
  }
  transferRecords(sourceTableId: number, payload: TransferPayload) {
    return http.post<TransferResult>(`${BASE}/tables/${sourceTableId}/records/transfer`, payload)
  }

  // ==================== 设备台账 ====================
  listDevices(query?: string, subsystemId?: number) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (subsystemId) params.set('subsystem_id', String(subsystemId))
    const q = params.toString()
    return http.get<Device[]>(`${BASE}/devices${q ? '?' + q : ''}`)
  }
  createDevice(data: DevicePayload) {
    return http.post<Device>(`${BASE}/devices`, data)
  }
  updateDevice(id: number, data: DeviceUpdatePayload) {
    return http.put<Device>(`${BASE}/devices/${id}`, data)
  }
  /** 软删除（保留历史资料，仅清理关联） */
  deleteDevice(id: number) {
    return http.delete<OkResult>(`${BASE}/devices/${id}`)
  }

  // ==================== 设备关联 ====================
  listRelations(fromCode?: string, toCode?: string) {
    const params = new URLSearchParams()
    if (fromCode) params.set('from_code', fromCode)
    if (toCode) params.set('to_code', toCode)
    const q = params.toString()
    return http.get<DeviceRelation[]>(`${BASE}/relations${q ? '?' + q : ''}`)
  }
  createRelation(data: DeviceRelationPayload) {
    return http.post<DeviceRelation>(`${BASE}/relations`, data)
  }
  updateRelation(id: number, data: DeviceRelationUpdatePayload) {
    return http.put<DeviceRelation>(`${BASE}/relations/${id}`, data)
  }
  deleteRelation(id: number) {
    return http.delete<OkResult>(`${BASE}/relations/${id}`)
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
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
    })
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
      const data: Record<string, unknown> = {}
      let deviceCode: string | undefined
      let hasContent = false
      for (let c = 0; c < header.length; c++) {
        const raw = row[c]
        const value = raw === undefined || raw === null ? '' : String(raw).trim()
        const f = keyByHeader.get(String(c))
        if (!f) continue
        if (value) hasContent = true
        if (relField && f.key === relField.key) {
          deviceCode = value || undefined
        } else {
          data[f.key] = value
        }
      }
      if (!hasContent) continue
      result.push({ device_code: deviceCode ?? null, data })
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
export default assetApi
