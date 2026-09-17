/**
 * 扫码补录 API（设备聚合检索 / 照片 / 现场建边 / 供电冷源链 / 扫码盘点）
 * =====================================================================
 * 来源：React 版 `src/features/scan/api.ts`，**逐方法等价迁移**。
 *
 * 两处必须用原生 fetch（拿状态码），不能用 `@/api/http`：
 *   1) `scanUploadPhoto` —— multipart 直传（不经 JSON 序列化）
 *   2) `scanBindDeviceToRoom` —— 需区分 **409 冲突**（设备已归属其他机房，等用户确认改挂）
 *      与其他错误（404 未找到 / 400 参数）；通用 http 层只抛 message，拿不到状态码。
 *
 * 【易错】机房列表是 `/ops/api/rooms`（后端 main.py），**不是** `/assets/rooms`。
 */
import http from './http'
import { API_BASE } from '@/config'
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
  RoomInventoryOverview,
  RoomDevicesResult,
  BindDeviceResult,
  BindDeviceOutcome,
  UnbindDeviceResult,
} from '@/types/scan'

const BASE = '/assets'

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {}
  const token = localStorage.getItem('token')
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

/** GET /assets/subsystems —— 子系统字典（打印筛选用） */
export function scanSubsystems(): Promise<ScanSubsystem[]> {
  return http.get<ScanSubsystem[]>(`${BASE}/subsystems`)
}

/** GET /assets/search?code= —— 设备聚合检索（扫码直达卡核心） */
export function scanSearchDevice(code: string): Promise<ScanSearchResult> {
  return http.get<ScanSearchResult>(`${BASE}/search?code=${encodeURIComponent(code)}`)
}

export interface ListDevicesParams {
  q?: string
  subsystem_id?: number
  building?: string
  floor?: string
  limit?: number
  skip?: number
}

/** GET /assets/devices —— 支持 building/floor 过滤 + 分页 */
export async function scanListDevices(p: ListDevicesParams = {}): Promise<QrDeviceRow[]> {
  const q = new URLSearchParams()
  if (p.q) q.set('q', p.q)
  if (p.subsystem_id !== undefined) q.set('subsystem_id', String(p.subsystem_id))
  if (p.building) q.set('building', p.building)
  if (p.floor) q.set('floor', p.floor)
  q.set('limit', String(p.limit ?? 200))
  q.set('skip', String(p.skip ?? 0))
  return http.get<QrDeviceRow[]>(`${BASE}/devices?${q.toString()}`)
}

/** PUT /assets/devices/{id} —— 位置补录（room_id/building/floor/location_desc，排除未设字段） */
export async function scanUpdateDevice(
  id: number,
  data: Partial<Pick<ScanDevice, 'room_id' | 'building' | 'floor' | 'location_desc'>>,
): Promise<ScanDevice> {
  return http.put<ScanDevice>(`${BASE}/devices/${id}`, data)
}

/** GET /assets/devices/{id}/photos —— 设备照片列表 */
export function scanListPhotos(did: number): Promise<DevicePhotoItem[]> {
  return http.get<DevicePhotoItem[]>(`${BASE}/devices/${did}/photos`)
}

/** POST /assets/devices/{id}/photos —— 上传现场照片（multipart 直传） */
export async function scanUploadPhoto(
  did: number,
  file: File,
  note = '',
): Promise<DevicePhotoItem> {
  const formData = new FormData()
  formData.append('file', file)
  if (note) formData.append('note', note)
  const resp = await fetch(`${API_BASE}${BASE}/devices/${did}/photos`, {
    method: 'POST',
    headers: authHeaders(),
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
  return http.delete<{ success: boolean }>(`${BASE}/photos/${pid}`)
}

/** GET /ops/api/rooms —— 机房全量（位置补录房间选择器数据源） */
export function scanRooms(building?: string): Promise<ScanRoom[]> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return http.get<ScanRoom[]>(`/rooms${q}`)
}

// ===== 现场建边 + 上游供电/冷源链 =====

/** GET /assets/relation-types —— 关联类型字典（建边下拉/链着色） */
export function scanRelationTypes(): Promise<ScanRelationType[]> {
  return http.get<ScanRelationType[]>(`${BASE}/relation-types`)
}

/** GET /assets/devices/{did}/power-chain?side=up&depth=2 —— 上游供电/冷源链 */
export function scanPowerChain(
  did: number,
  side: 'up' | 'down' | 'both' = 'up',
  depth = 2,
): Promise<PowerChainResult> {
  return http.get<PowerChainResult>(
    `${BASE}/devices/${did}/power-chain?side=${side}&depth=${depth}`,
  )
}

/**
 * POST /assets/relations —— 现场建边。
 * 两端可传 移交编号/标签号/别名 任一种（后端别名桥接 + 设备存在校验 + 防自环 + 类型归一）。
 */
export function scanCreateRelation(payload: CreateRelationPayload): Promise<{ id: number }> {
  return http.post<{ id: number }>(`${BASE}/relations`, payload)
}

/** DELETE /assets/relations/{rid} —— 删除一条关联（现场误建纠错） */
export function scanDeleteRelation(rid: number): Promise<{ success: boolean; message: string }> {
  return http.delete<{ success: boolean; message: string }>(`${BASE}/relations/${rid}`)
}

// ===== 扫码盘点 · 房间 ↔ 设备（一对多） =====

/** GET /assets/rooms/inventory/overview —— 各房间已绑定设备数（盘点进度，按设备数倒序） */
export function scanInventoryOverview(building?: string): Promise<RoomInventoryOverview> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return http.get<RoomInventoryOverview>(`${BASE}/rooms/inventory/overview${q}`)
}

/** GET /assets/rooms/{roomCode}/devices —— 某房间已绑定（已盘）设备清单 */
export function scanRoomDevices(roomCode: string): Promise<RoomDevicesResult> {
  return http.get<RoomDevicesResult>(`${BASE}/rooms/${encodeURIComponent(roomCode)}/devices`)
}

/** DELETE /assets/rooms/{roomCode}/devices/{deviceCode} —— 解绑（删「所在机房」边 + 清 room_id） */
export function scanUnbindDeviceFromRoom(
  roomCode: string,
  deviceCode: string,
): Promise<UnbindDeviceResult> {
  return http.delete<UnbindDeviceResult>(
    `${BASE}/rooms/${encodeURIComponent(roomCode)}/devices/${encodeURIComponent(deviceCode)}`,
  )
}

/**
 * POST /assets/rooms/{roomCode}/devices —— 扫码把设备绑定到房间（幂等）。
 *
 * 用原生 fetch 而非 http.post：需要区分 **409 冲突**（设备已归属其他机房，等用户确认改挂）
 * 与其他错误（404 未找到 / 400 参数）。move=true 时后端会清掉原房间的边，
 * 保证一台设备只归属一间房。
 */
export async function scanBindDeviceToRoom(
  roomCode: string,
  deviceCode: string,
  move = false,
): Promise<BindDeviceOutcome> {
  const resp = await fetch(
    `${API_BASE}${BASE}/rooms/${encodeURIComponent(roomCode)}/devices`,
    {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ device_code: deviceCode, move }),
    },
  )
  const data = await resp.json().catch(() => ({} as Record<string, unknown>))
  if (resp.ok) return data as BindDeviceResult

  const detail = String((data as { detail?: unknown })?.detail ?? '')
  if (resp.status === 409) {
    // detail 形如「该设备已归属机房 P12W2F-PDF-102（配电房）」
    const roomCode2 = detail.replace(/^该设备已归属机房\s*/, '').split('（')[0].trim()
    return { conflict: true, room_code: roomCode2, message: detail || '该设备已归属其他机房' }
  }
  throw new Error(detail || `绑定失败 (${resp.status})`)
}

/**
 * 扫码内容 → 设备编号。
 *
 * 标签打印的二维码内容是 `/ops/qr/<encodeURIComponent(编号)>` 直达链接（见 QrLabelPage），
 * 扫码枪扫标签会输出整条 URL，摄像头同理；也兼容现场手输纯编号。
 */
export function parseScanPayload(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return ''
  const m = /[/#]qr\/([^?#\s]+)/.exec(s)
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim()
    } catch {
      return m[1].trim()
    }
  }
  return s
}
