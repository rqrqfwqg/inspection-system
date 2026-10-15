/**
 * inventory — 盘点域数据层（后端 inspection-system /ops/api）
 *
 * ⚠️ 口径说明（别改，这是事实）：
 * 1. 盘点是**房间级**的。`room_inventory_records` 一行 = 一个房间的盘点结论，
 *    设备数是完成当刻的**快照**，事后台账变动不改写历史。
 * 2. `device_count = 0` 不代表没盘 —— 后端会记 `empty_confirmed=1`，
 *    语义是「现场确认这间房确实没设备」，同样是有效盘点。
 * 3. 因此「设备是否已盘点」只能经由「设备 → 所属房间 → 该房间有盘点记录」推导。
 *
 * 4 态状态机（2026-10-13 起，后端真实实现，非本地推断）：
 *   pending   未盘     — 无记录
 *   doing     进行中   — 已开单，扫了一部分（后端 status='doing'）
 *   completed 已完成   — 扫够（或空房确认）
 *   abnormal  有异常   — 扫不够且已填异常说明
 * 🔴 之前 doing 靠本机 `inv_doing_rooms` 推断，换手机/清缓存就丢；现在以后端为准。
 *
 * 端点：
 *   GET  /assets/rooms/inventory/overview        全部房间 + 绑定设备数
 *   POST /rooms/{code}/inventory/start           开单 → doing（应扫数开单瞬间快照）
 *   POST /rooms/{code}/inventory/scan            记一次扫码（累加 scanned_count）
 *   POST /rooms/{code}/inventory/submit          提交（扫够→completed / 填说明→abnormal）
 *   GET  /rooms/{code}/inventory                 某房间盘点详情（4 态 + 进度）
 *   GET  /inventory/report                       盘点报告
 *   POST /assets/rooms/{code}/inventory/complete  旧端点（无进度直接完成，保留兼容）
 *   DELETE /assets/rooms/{code}/inventory/complete 撤销
 */

import { getToken } from '@/utils/storage'

const BASE: string = (import.meta.env.VITE_ASSET_API_BASE || 'https://www.xmgl-123.cn/ops/api').replace(/\/+$/, '')

function buildHeader(): Record<string, string> {
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Type': 'miniprogram',
  }
  const token = getToken()
  if (token) header.Authorization = `Bearer ${token}`
  return header
}

function extractDetail(data: any, statusCode: number): string {
  if (!data) return `请求失败(${statusCode})`
  if (typeof data === 'string') return data
  const d = data.detail
  if (typeof d === 'string' && d) return d
  if (Array.isArray(d) && d.length && typeof d[0]?.msg === 'string') return d[0].msg
  if (typeof data.message === 'string' && data.message) return data.message
  return `请求失败(${statusCode})`
}

function invRequest<T = any>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', data?: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${BASE}${path}`,
      method,
      data,
      header: buildHeader(),
      timeout: 15000,
      success: (res) => {
        const sc = res.statusCode
        if (sc >= 200 && sc < 300) {
          resolve(res.data as T)
          return
        }
        reject({ statusCode: sc, message: extractDetail(res.data, sc), data: res.data })
      },
      fail: (err) => reject({ statusCode: 0, message: '网络异常，请检查网络连接', data: err }),
    })
  })
}

/** 盘点状态（与后端 room_inventory_records.status 对齐） */
export const INV_STATUS = {
  /** 未盘（无记录） */
  PENDING: 'pending',
  /** 进行中：已开单，扫了一部分 */
  DOING: 'doing',
  /** 已完成：扫够，或空房确认 */
  COMPLETED: 'completed',
  /** 有异常：扫不够且已填说明 */
  ABNORMAL: 'abnormal',
} as const

export type InvStatus = (typeof INV_STATUS)[keyof typeof INV_STATUS]

/** 终态（已提交，不可再扫） */
export const INV_TERMINAL: string[] = [INV_STATUS.COMPLETED, INV_STATUS.ABNORMAL]

export const INV_STATUS_LABEL: Record<string, string> = {
  pending: '待盘点',
  doing: '进行中',
  completed: '已完成',
  abnormal: '有异常',
}

export const INV_STATUS_COLOR: Record<string, string> = {
  pending: '#909399',
  doing: '#e6a23c',
  completed: '#07c160',
  abnormal: '#f56c6c',
}

/** 后端返回的盘点详情块 */
export interface InvRecord {
  inspected: boolean
  status: InvStatus
  device_count: number
  scanned_count: number
  expected_count: number
  diff_count: number
  abnormal: boolean
  abnormal_reason: string
  empty_confirmed: boolean
  operator: string
  remark: string
  source: string
  completed_at: string | null
  started_at: string | null
}

/** 提交结果（扫不够且未填说明时 success=false + need_reason=true） */
export interface InvSubmitResult {
  success: boolean
  message?: string
  need_reason?: boolean
  expected_count: number
  inspected: InvRecord
  room?: any
}

/** 盘点报告（GET /inventory/report） */
export interface InvReport {
  total_rooms: number
  pending_rooms: number
  doing_rooms: number
  completed_rooms: number
  abnormal_rooms: number
  empty_confirmed_rooms: number
  scanned_total: number
  expected_total: number
  diff_total: number
  percent: number
  operator: string
  last_at: string | null
  abnormal_items: Array<{
    room_code: string
    room_name: string
    building: string
    floor: string
    scanned_count: number
    expected_count: number
    reason: string
    operator: string
    completed_at: string | null
  }>
}

// ==================== 端点封装 ====================

/** 开单 → doing。expected_count 在开单瞬间快照 */
export function invStart(roomCode: string, operator = '', remark = ''): Promise<{ success: boolean; expected_count: number; inspected: InvRecord }> {
  return invRequest(`/rooms/${encodeURIComponent(roomCode)}/inventory/start`, 'POST', { operator, remark, source: 'miniprogram' })
}

/** 记一次扫码（累加 scanned_count） */
export function invScan(roomCode: string, operator = ''): Promise<{ success: boolean; expected_count: number; inspected: InvRecord }> {
  return invRequest(`/rooms/${encodeURIComponent(roomCode)}/inventory/scan`, 'POST', { operator })
}

/** 提交：扫够 → completed；扫不够必须传 abnormal_reason → abnormal */
export function invSubmit(
  roomCode: string,
  payload: { operator?: string; remark?: string; abnormal_reason?: string } = {},
): Promise<InvSubmitResult> {
  return invRequest(`/rooms/${encodeURIComponent(roomCode)}/inventory/submit`, 'POST', {
    operator: payload.operator || '',
    remark: payload.remark || '',
    abnormal_reason: payload.abnormal_reason || '',
    source: 'miniprogram',
  })
}

/** 某房间盘点详情 */
export function invDetail(roomCode: string): Promise<{ room: any; inspected: InvRecord }> {
  return invRequest(`/rooms/${encodeURIComponent(roomCode)}/inventory`)
}

/** 盘点报告 */
export function invReport(building?: string): Promise<InvReport> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return invRequest<InvReport>(`/inventory/report${q}`)
}

/** 盘点总览统计 */
export interface InvOverview {
  totalRooms: number
  /** 已完成（含空房确认） */
  completedRooms: number
  pendingRooms: number
  doingRooms: number
  /** 有异常（扫不够且已说明） */
  abnormalRooms: number
  /** 空房确认数（已盘但现场确认无设备） */
  emptyRooms: number
  /** 当前已绑定设备总数 */
  boundDevices: number
  /** 完成率 0~100（completed + abnormal 均算已处理） */
  percent: number
  /** 最近一次盘点时间（空串=从未） */
  lastAt: string
}

/** 盘点行（overview 的一行 + 后端 4 态） */
export interface InvRoomRow {
  code: string
  name: string
  building: string
  floor: string
  roomType: string
  /** 当前绑定设备数（应扫数） */
  deviceCount: number
  status: InvStatus
  /** 本次已扫数（doing 态有意义） */
  scannedCount: number
  /** 异常说明（abnormal 态） */
  abnormalReason: string
  /** 已盘时的完成时间 */
  inspectedAt: string
  /** 已盘时的盘点人 */
  inspector: string
  /** 是否空房确认 */
  emptyConfirmed: boolean
}

/** 从 ISO/DB 字符串取出「MM-DD HH:mm」用于展示 */
export function fmtTime(raw?: string | null): string {
  const s = (raw || '').trim()
  if (!s) return ''
  // 后端可能是 "2026-10-11 03:10:05.772445" 或 ISO
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return s
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

/** 把后端时间串规整成可排序的毫秒数（失败返回 0） */
function toMs(raw?: string | null): number {
  if (!raw) return 0
  const s = raw.replace(' ', 'T')
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : t
}

/** 组装总览统计（4 态：pending/doing/completed/abnormal） */
export function buildOverview(rows: InvRoomRow[]): InvOverview {
  let completed = 0
  let doing = 0
  let abnormal = 0
  let empty = 0
  let devices = 0
  let lastMs = 0
  let lastAt = ''
  for (const r of rows) {
    devices += r.deviceCount
    if (r.status === INV_STATUS.COMPLETED) {
      completed += 1
      if (r.emptyConfirmed) empty += 1
      const ms = toMs(r.inspectedAt)
      if (ms > lastMs) {
        lastMs = ms
        lastAt = r.inspectedAt
      }
    } else if (r.status === INV_STATUS.ABNORMAL) {
      abnormal += 1
      const ms = toMs(r.inspectedAt)
      if (ms > lastMs) {
        lastMs = ms
        lastAt = r.inspectedAt
      }
    } else if (r.status === INV_STATUS.DOING) {
      doing += 1
    }
  }
  const total = rows.length
  const percent = total ? Math.round(((completed + abnormal + doing) / total) * 100) : 0
  return {
    totalRooms: total,
    completedRooms: completed,
    pendingRooms: total - completed - abnormal - doing,
    doingRooms: doing,
    abnormalRooms: abnormal,
    emptyRooms: empty,
    boundDevices: devices,
    percent,
    lastAt: fmtTime(lastAt),
  }
}
