// 扫码补录 P0 · API 客户端
// 请求前缀与后端一致：/assets → /ops/api/assets（见 src/config.ts）
import { api } from '@/services/api'
import type {
  ScanDevice,
  ScanSearchResult,
  DevicePhotoItem,
  ScanRoom,
  ScanSubsystem,
  QrDeviceRow,
  ScanRelationType,
  PowerChainResult,
  CreateRelationPayload,
} from './types'

const BASE = '/assets'

/** GET /assets/subsystems —— 子系统字典（打印筛选用） */
export function scanSubsystems(): Promise<ScanSubsystem[]> {
  return api.get<ScanSubsystem[]>(`${BASE}/subsystems`)
}

/** GET /assets/search?code= —— 设备聚合检索（扫码直达卡核心） */
export function scanSearchDevice(code: string): Promise<ScanSearchResult> {
  return api.get<ScanSearchResult>(`${BASE}/search?code=${encodeURIComponent(code)}`)
}

export interface ListDevicesParams {
  q?: string
  subsystem_id?: number
  building?: string
  floor?: string
  limit?: number
  skip?: number
}

/** GET /assets/devices —— 支持 building/floor 过滤 + 分页（后端 P0 增强） */
export async function scanListDevices(p: ListDevicesParams = {}): Promise<QrDeviceRow[]> {
  const q = new URLSearchParams()
  if (p.q) q.set('q', p.q)
  if (p.subsystem_id !== undefined) q.set('subsystem_id', String(p.subsystem_id))
  if (p.building) q.set('building', p.building)
  if (p.floor) q.set('floor', p.floor)
  q.set('limit', String(p.limit ?? 200))
  q.set('skip', String(p.skip ?? 0))
  return api.get<QrDeviceRow[]>(`${BASE}/devices?${q.toString()}`)
}

/** PUT /assets/devices/{id} —— 位置补录（room_id/building/floor/location_desc，排除未设字段） */
export async function scanUpdateDevice(
  id: number,
  data: Partial<Pick<ScanDevice, 'room_id' | 'building' | 'floor' | 'location_desc'>>,
): Promise<ScanDevice> {
  return api.put<ScanDevice>(`${BASE}/devices/${id}`, data)
}

/** GET /assets/devices/{id}/photos —— 设备照片列表 */
export function scanListPhotos(did: number): Promise<DevicePhotoItem[]> {
  return api.get<DevicePhotoItem[]>(`${BASE}/devices/${did}/photos`)
}

/**
 * POST /assets/devices/{id}/photos —— 上传现场照片（multipart，仿 features/assets uploadImport 模式）。
 * note 走 FormData 文本域；响应为新照片记录。
 */
export async function scanUploadPhoto(did: number, file: File, note = ''): Promise<DevicePhotoItem> {
  const formData = new FormData()
  formData.append('file', file)
  if (note) formData.append('note', note)
  const headers: Record<string, string> = {}
  const token = (api as unknown as { token?: string | null }).token
  if (token) headers['Authorization'] = `Bearer ${token}`
  const resp = await fetch(`${'/ops/api'}${BASE}/devices/${did}/photos`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: '上传失败' }))
    throw new Error(typeof err?.detail === 'string' ? err.detail : '上传失败')
  }
  return resp.json()
}

/** DELETE /assets/photos/{pid} —— 删除照片（含文件本体） */
export function scanDeletePhoto(pid: number): Promise<{ success: boolean }> {
  return api.delete<{ success: boolean }>(`${BASE}/photos/${pid}`)
}

/** GET /ops/api/rooms —— 机房全量（516 间；位置补录房间选择器数据源） */
export function scanRooms(building?: string): Promise<ScanRoom[]> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return api.get<ScanRoom[]>(`/rooms${q}`)
}

// ===== P1：现场建边 + 上游供电/冷源链 =====

/** GET /assets/relation-types —— 关联类型字典（建边下拉/链着色） */
export function scanRelationTypes(): Promise<ScanRelationType[]> {
  return api.get<ScanRelationType[]>(`${BASE}/relation-types`)
}

/** GET /assets/devices/{did}/power-chain?side=up&depth=2 —— 上游供电/冷源链 */
export function scanPowerChain(
  did: number,
  side: 'up' | 'down' | 'both' = 'up',
  depth = 2,
): Promise<PowerChainResult> {
  return api.get<PowerChainResult>(`${BASE}/devices/${did}/power-chain?side=${side}&depth=${depth}`)
}

/**
 * POST /assets/relations —— 现场建边。
 * 两端可传 移交编号/标签号/别名 任一种（后端别名桥接 + 设备存在校验 + 防自环 + 类型归一）。
 */
export function scanCreateRelation(payload: CreateRelationPayload): Promise<{ id: number }> {
  return api.post<{ id: number }>(`${BASE}/relations`, payload)
}

/** DELETE /assets/relations/{rid} —— 删除一条关联（现场误建纠错） */
export function scanDeleteRelation(rid: number): Promise<{ success: boolean; message: string }> {
  return api.delete<{ success: boolean; message: string }>(`${BASE}/relations/${rid}`)
}
