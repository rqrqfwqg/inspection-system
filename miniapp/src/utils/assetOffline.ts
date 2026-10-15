/**
 * assetOffline — 扫码盘点的离线能力层
 *
 * 现场（机房 / 管廊 / 负二层）常无信号。扫码本身是**本地**能力（相机解码、相册解码
 * 都不需要网络），真正会失败的是「把结果写回后端」这一步。本模块负责三件事：
 *
 *  1) 待同步队列：写入失败（网络类错误）时入队，恢复网络后自动补传；
 *  2) 房间概览缓存：离线时仍能选房间，否则连「盘哪间房」都定不了；
 *  3) 房间设备清单缓存：离线时清单有内容可看，并与本机待同步条目合并展示。
 *
 * 红线：只有**网络类错误**（statusCode=0，请求根本没到后端）才入队。
 * 业务错误（404 编号不存在 / 400 参数）当场提示、不入队 ——
 * 否则会把「扫错了编号」这类问题无限重试到队列里，越积越脏。
 */
import { getJSON, set } from '@/utils/storage'
import {
  assetBindDevice,
  assetCompleteRoomInventory,
  assetCreateGeoObservation,
  assetCreateObservation,
  assetResolveCode,
  assetUploadDevicePhoto,
  type AssetApiError,
} from '@/api/asset'
import type {
  InventoryDeviceRow,
  PendingOp,
  RoomInspectedInfo,
  RoomInventoryOverview,
} from '@/types/asset'

const QUEUE_KEY = 'asset_pending_ops_v1'
const ROOM_CACHE_KEY = 'asset_rooms_cache_v1'
const DEVICE_CACHE_KEY = 'asset_room_devices_cache_v1'

/** 队列上限：超过则丢弃最旧的 bind（防止长期离线把 storage 撑爆） */
const QUEUE_MAX = 500

/* ============================ 网络状态 ============================ */

/** 当前是否有网（getNetworkType 失败时按「有网」处理，让请求自己去试） */
export function isOnline(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.getNetworkType({
      success: (res) => resolve(res.networkType !== 'none'),
      fail: () => resolve(true),
    })
  })
}

/** 订阅网络变化；返回取消订阅函数 */
export function onNetworkChange(cb: (online: boolean) => void): () => void {
  const handler = (res: { isConnected: boolean }) => cb(!!res.isConnected)
  uni.onNetworkStatusChange(handler)
  return () => uni.offNetworkStatusChange(handler)
}

/** 网络类错误判定（statusCode=0 由 api 层在网络异常/超时时统一给出） */
export function isNetworkError(err: unknown): boolean {
  return (err as AssetApiError)?.statusCode === 0
}

/* ============================ 待同步队列 ============================ */

export function loadQueue(): PendingOp[] {
  const list = getJSON<PendingOp[]>(QUEUE_KEY)
  return Array.isArray(list) ? list : []
}

function saveQueue(list: PendingOp[]): void {
  set(QUEUE_KEY, list)
}

export function queueSize(): number {
  return loadQueue().length
}

/** 某房间的待同步条目（工作台展示与设备清单合并用） */
export function pendingOfRoom(roomCode: string): PendingOp[] {
  return loadQueue().filter((x) => x.roomCode === roomCode)
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 入队一条「设备挂房间」待同步；同房间同设备已存在则不重复入队 */
export function enqueueBind(roomCode: string, deviceCode: string, lastError = ''): PendingOp {
  const list = loadQueue()
  const dup = list.find(
    (x) => x.kind === 'bind' && x.roomCode === roomCode && x.deviceCode === deviceCode,
  )
  if (dup) return dup
  const item: PendingOp = {
    id: newId(),
    kind: 'bind',
    roomCode,
    deviceCode,
    createdAt: Date.now(),
    tries: 0,
    lastError,
  }
  list.push(item)
  saveQueue(list.slice(-QUEUE_MAX))
  return item
}

/**
 * 入队一条「待解析编号」待同步（离线时录入、无法本地唯一确定）。
 * 联网后由 syncQueue 补跑 resolve，**只有唯一精确可确定**才绑定；否则保留待人工。
 * 同房间同原始编号已存在则不重复入队。
 */
export function enqueueResolve(roomCode: string, rawCode: string, lastError = ''): PendingOp {
  const list = loadQueue()
  const dup = list.find(
    (x) => x.kind === 'resolve' && x.roomCode === roomCode && x.rawCode === rawCode,
  )
  if (dup) return dup
  const item: PendingOp = {
    id: newId(),
    kind: 'resolve',
    roomCode,
    rawCode,
    createdAt: Date.now(),
    tries: 0,
    lastError,
  }
  list.push(item)
  saveQueue(list.slice(-QUEUE_MAX))
  return item
}

/**
 * 入队一条「现场补录」待同步（离线时录入、无法选定设备 / 无法联网补录）。
 * 联网后由 syncQueue 补跑 resolve：**只有唯一精确可确定**才补录；零命中/多命中/歧义保留待人工。
 * 按 serialRaw + roomCode 去重（同房间同编号不重复入队）。
 */
export function enqueueObserve(
  roomCode: string,
  serialRaw: string,
  operator = '',
  observedAt = '',
  lastError = '',
): PendingOp {
  const list = loadQueue()
  const dup = list.find(
    (x) => x.kind === 'observe' && x.roomCode === roomCode && x.serialRaw === serialRaw,
  )
  if (dup) return dup
  const item: PendingOp = {
    id: newId(),
    kind: 'observe',
    roomCode,
    serialRaw,
    operator,
    observedAt,
    createdAt: Date.now(),
    tries: 0,
    lastError,
  }
  list.push(item)
  saveQueue(list.slice(-QUEUE_MAX))
  return item
}


/**
 * 入队一条「设备定位」待同步（扫码时取到了坐标，但上报时断网）。
 * 按 deviceCode + 经纬度去重（原地重复扫不重复入队）。
 *
 * 为什么要入队：现场机房/管廊常无信号，而**定位本身是本地硬件能力**——
 * 断网时坐标照样能取到，只是传不上去。不入队就等于白白丢掉现场位置证据。
 */
export function enqueueGeo(
  deviceCode: string,
  latitude: number,
  longitude: number,
  roomCode = '',
  accuracy?: number,
  scanSource = 'camera',
  operator = '',
  observedAt = '',
  lastError = '',
): PendingOp {
  const list = loadQueue()
  const dup = list.find(
    (x) =>
      x.kind === 'geo' &&
      x.deviceCode === deviceCode &&
      x.latitude === latitude &&
      x.longitude === longitude,
  )
  if (dup) return dup
  const item: PendingOp = {
    id: newId(),
    kind: 'geo',
    roomCode,
    deviceCode,
    latitude,
    longitude,
    accuracy,
    scanSource,
    operator,
    observedAt,
    createdAt: Date.now(),
    tries: 0,
    lastError,
  }
  list.push(item)
  saveQueue(list.slice(-QUEUE_MAX))
  return item
}

/** 入队一条「完成盘点」待同步；同房间已存在则覆盖（后一次为准，与后端幂等语义一致） */
export function enqueueComplete(roomCode: string, operator = '', remark = '', lastError = ''): PendingOp {
  const list = loadQueue().filter((x) => !(x.kind === 'complete' && x.roomCode === roomCode))
  const item: PendingOp = {
    id: newId(),
    kind: 'complete',
    roomCode,
    operator,
    remark,
    createdAt: Date.now(),
    tries: 0,
    lastError,
  }
  list.push(item)
  saveQueue(list.slice(-QUEUE_MAX))
  return item
}

/** 入队一条「现场照片」待同步（本地文件已持久化，联网后补传）；同设备同文件不重复入队 */
export function enqueuePhoto(
  deviceCode: string,
  savedPath: string,
  remark = '',
  roomCode = '',
  operator = '',
  lastError = '',
): PendingOp {
  const list = loadQueue()
  const dup = list.find(
    (x) => x.kind === 'photo' && x.deviceCode === deviceCode && x.savedPath === savedPath,
  )
  if (dup) return dup
  const item: PendingOp = {
    id: newId(),
    kind: 'photo',
    roomCode,
    deviceCode,
    savedPath,
    remark,
    operator,
    createdAt: Date.now(),
    tries: 0,
    lastError,
  }
  list.push(item)
  saveQueue(list.slice(-QUEUE_MAX))
  return item
}

/** 某设备待上传的照片（设备卡展示「待同步」用） */
export function pendingPhotosOfDevice(deviceCode: string): PendingOp[] {
  return loadQueue().filter((x) => x.kind === 'photo' && x.deviceCode === deviceCode)
}

/* ==================== 本地文件（照片离线兜底） ==================== */

/**
 * 压缩图片（失败回退原图）。
 * 小程序 saveFile 的本地文件总量只有 10MB 量级，原图直存几张就满，
 * 故入本地前先压一道（质量 60）。
 */
function compressImage(src: string): Promise<string> {
  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    uni.compressImage({
      src,
      quality: 60,
      success: (r: any) => resolve(r.tempFilePath || src),
      fail: () => resolve(src),
    } as any)
    // #endif
    // #ifndef MP-WEIXIN
    resolve(src)
    // #endif
  })
}

/**
 * 临时文件 → 本地持久文件；返回 savedFilePath。
 *
 * ⚠️ 必须在**上传之前**调用：chooseMedia 给的临时路径只在当次运行时有效，
 * 断网时若只存临时路径，等联网补传时文件早已失效 —— 照片就真丢了。
 */
export function persistLocalFile(tempFilePath: string): Promise<string> {
  return compressImage(tempFilePath).then(
    (src) =>
      new Promise<string>((resolve, reject) => {
        // #ifdef MP-WEIXIN
        uni.getFileSystemManager().saveFile({
          tempFilePath: src,
          success: (res: any) => resolve(res.savedFilePath),
          fail: (err: any) => reject(err),
        })
        // #endif
        // #ifndef MP-WEIXIN
        resolve(src)
        // #endif
      }),
  )
}

/** 删除本地持久文件（上传成功、或业务上确定不再需要时调用） */
export function removeLocalFile(savedPath: string): void {
  if (!savedPath) return
  // #ifdef MP-WEIXIN
  try {
    uni.getFileSystemManager().removeSavedFile({
      filePath: savedPath,
      success: () => {},
      fail: () => {},
    })
  } catch {
    /* 文件已不存在等情况一律忽略 */
  }
  // #endif
}

export function removePending(id: string): void {
  saveQueue(loadQueue().filter((x) => x.id !== id))
}

export function clearQueue(roomCode?: string): void {
  if (!roomCode) {
    saveQueue([])
    return
  }
  saveQueue(loadQueue().filter((x) => x.roomCode !== roomCode))
}

/* ============================ 同步 ============================ */

/** 补传时出现的补录冲突（与台账不一致 / 已被其他设备观测）——需人工复核，不得静默 */
export interface ObserveConflictNote {
  deviceCode: string
  serialRaw: string
  /** conflicts_ledger / conflicts_other_device */
  state: string
  message: string
}

export interface SyncResult {
  /** 成功补传条数 */
  synced: number
  /** 仍未同步（含设备已归属他房的冲突） */
  kept: number
  /** 冲突条目（设备已归属其他房间，需人工确认是否改挂） */
  conflicts: PendingOp[]
  /** 补录冲突（已上传，但与台账/其他观测冲突，需人工复核） */
  observeConflicts: ObserveConflictNote[]
  /** 因编号不存在等原因丢弃的条数 */
  dropped: number
  /** 是否因为还没网而提前中止 */
  offline: boolean
}

/**
 * 补传全部待同步条目。
 * - 网络类错误 → 当前条与其余原样保留并立即中止（避免无谓重试）；
 * - 404/400 → 重试无意义，丢弃；
 * - 409（设备已归属他房）→ 保留并标记 conflictFrom，交由页面问用户要不要改挂。
 */
export async function syncQueue(): Promise<SyncResult> {
  const list = loadQueue()
  if (!list.length) {
    return { synced: 0, kept: 0, conflicts: [], observeConflicts: [], dropped: 0, offline: false }
  }

  const keep: PendingOp[] = []
  const conflicts: PendingOp[] = []
  const observeConflicts: ObserveConflictNote[] = []
  let synced = 0
  let dropped = 0
  let offline = false

  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    try {
      if (item.kind === 'complete') {
        await assetCompleteRoomInventory(item.roomCode, {
          operator: item.operator || '',
          remark: item.remark || '',
          source: 'miniprogram',
        })
      } else if (item.kind === 'photo') {
        await assetUploadDevicePhoto(
          item.deviceCode || '',
          item.savedPath || '',
          item.remark || '',
          item.operator || '',
        )
        // 传成功才删本地文件，避免「上传失败还把原件清了」
        removeLocalFile(item.savedPath || '')
      } else if (item.kind === 'resolve') {
        // 离线录入的原始编号：联网后补跑 resolve，**只有唯一精确可确定**才绑定；
        // 歧义 / 多命中 / 无命中 → 保留待人工（绝不猜、不静默丢弃、不误绑）。
        const rr = await assetResolveCode(item.rawCode || '', 8)
        const cands = rr.candidates || []
        if (rr.kind !== 'ambiguous' && rr.exact && cands.length === 1) {
          // 守门：候选 device_code 为空则不入队、不绑定（后端理论不可达，仍守死）
          const code = String(cands[0].device_code || '').trim()
          if (!code) {
            keep.push({ ...item, tries: item.tries + 1, lastError: '候选缺少设备编号，已跳过' })
            continue
          }
          const outr = await assetBindDevice(item.roomCode, code, false)
          if ('conflict' in outr) {
            const merged: PendingOp = {
              ...item,
              tries: item.tries + 1,
              conflictFrom: outr.room_code || '',
              lastError: outr.message,
            }
            conflicts.push(merged)
            keep.push(merged)
            continue
          }
        } else {
          keep.push({ ...item, tries: item.tries + 1, lastError: '需人工确认（歧义或多命中）' })
          continue
        }
      } else if (item.kind === 'observe') {
        // 离线补录的原始机身编号：联网后补跑 resolve，只有唯一精确可确定才补录；
        // 零命中 / 多命中 / 歧义 → 保留待人工（绝不猜、不静默丢弃）。
        const rr2 = await assetResolveCode(item.serialRaw || '', 8)
        const cands2 = rr2.candidates || []
        if (rr2.kind !== 'ambiguous' && rr2.exact && cands2.length === 1) {
          const code2 = String(cands2[0].device_code || '').trim()
          if (!code2) {
            keep.push({ ...item, tries: item.tries + 1, lastError: '候选缺少设备编号，已跳过' })
            continue
          }
          const obr = await assetCreateObservation({
            device_code: code2,
            serial_raw: item.serialRaw || '',
            room_code: item.roomCode || '',
            operator: item.operator || '',
            observed_at: item.observedAt || '',
          })
          // 冲突显式收集（不静默吞掉）
          if (obr.conflict_state && obr.conflict_state !== 'none') {
            observeConflicts.push({
              deviceCode: code2,
              serialRaw: item.serialRaw || '',
              state: String(obr.conflict_state),
              message: obr.conflict?.message || '',
            })
          }
        } else {
          keep.push({ ...item, tries: item.tries + 1, lastError: '需人工确认（补录编号零命中/多命中/歧义）' })
          continue
        }
      } else if (item.kind === 'geo') {
        // 离线时取到了定位但没能上报：联网后补传。
        // 注意本表**不做幂等合并**（每次扫码一条），所以重试是安全的：
        // 只有「网络类错误」会保留重试，404/400 当场丢弃（见下方 catch）。
        await assetCreateGeoObservation({
          device_code: item.deviceCode || '',
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          accuracy: typeof item.accuracy === 'number' ? item.accuracy : null,
          room_code: item.roomCode || '',
          scan_source: item.scanSource || 'camera',
          operator: item.operator || '',
          observed_at: item.observedAt || '',
        })
      } else {
        const out = await assetBindDevice(item.roomCode, item.deviceCode || '', false)
        if ('conflict' in out) {
          const merged: PendingOp = {
            ...item,
            tries: item.tries + 1,
            conflictFrom: out.room_code || '',
            lastError: out.message,
          }
          conflicts.push(merged)
          keep.push(merged)
          continue
        }
      }
      synced += 1
    } catch (e) {
      if (isNetworkError(e)) {
        // 还没网：本条与剩余全部保留，直接结束
        offline = true
        keep.push(item, ...list.slice(i + 1))
        break
      }
      const err = e as AssetApiError
      if (err.statusCode === 404 || err.statusCode === 400) {
        // 照片的 404/400 重试无意义；但本地文件**保留**（原件比记录更珍贵），仅出队
        dropped += 1
        continue
      }
      keep.push({ ...item, tries: item.tries + 1, lastError: err.message })
    }
  }

  saveQueue(keep)
  return { synced, kept: keep.length, conflicts, observeConflicts, dropped, offline }
}

/** 冲突条目批量改挂到各自的目标房间（move=true） */
export async function moveConflicts(ids: string[]): Promise<{ moved: number; failed: number }> {
  const list = loadQueue()
  const rest: PendingOp[] = []
  let moved = 0
  let failed = 0
  for (const item of list) {
    if (item.kind !== 'bind' || ids.indexOf(item.id) < 0) {
      rest.push(item)
      continue
    }
    try {
      await assetBindDevice(item.roomCode, item.deviceCode || '', true)
      moved += 1
    } catch {
      failed += 1
      rest.push(item)
    }
  }
  saveQueue(rest)
  return { moved, failed }
}

/* ============================ 本地缓存 ============================ */

export interface RoomCache {
  at: number
  data: RoomInventoryOverview
}

export function saveRoomCache(data: RoomInventoryOverview): void {
  set(ROOM_CACHE_KEY, { at: Date.now(), data })
}

export function loadRoomCache(): RoomCache | null {
  const c = getJSON<RoomCache>(ROOM_CACHE_KEY)
  return c && c.data && Array.isArray(c.data.rooms) ? c : null
}

/** 单房间清单缓存条目：设备行 + 该房间已盘点状态（离线也要能看到「已盘点」） */
export interface RoomDeviceCacheItem {
  at: number
  devices: InventoryDeviceRow[]
  inspected: RoomInspectedInfo | null
}

export type DeviceCache = Record<string, RoomDeviceCacheItem>

export function saveRoomDevices(
  roomCode: string,
  devices: InventoryDeviceRow[],
  inspected: RoomInspectedInfo | null = null,
): void {
  const all = getJSON<DeviceCache>(DEVICE_CACHE_KEY) || {}
  all[roomCode] = { at: Date.now(), devices, inspected }
  // 只保留最近 40 间房，避免 storage 无限膨胀
  const keys = Object.keys(all)
  if (keys.length > 40) {
    keys
      .sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0))
      .slice(0, keys.length - 40)
      .forEach((k) => delete all[k])
  }
  set(DEVICE_CACHE_KEY, all)
}

export function loadRoomDevices(roomCode: string): RoomDeviceCacheItem | null {
  const all = getJSON<DeviceCache>(DEVICE_CACHE_KEY) || {}
  return all[roomCode] || null
}

/* ============================ 展示辅助 ============================ */

/** 时间戳 → HH:mm（日志/待同步条目的紧凑展示） */
export function hhmm(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * ISO 时间串 → MM-DD HH:mm（后端 observed_at / created_at / completed_at 展示）
 *
 * ⚠️ 时区：inspection-system 后端统一存 UTC，但 SQLite 会剥掉时区，
 * 接口返回的是「裸 UTC」串（如 2026-09-17T07:39:56，无 Z / 无 +00:00）。
 * 直接 new Date() 会被当成「本地时间」解析 → 中国区（UTC+8）显示早 8 小时。
 * 因此：裸串一律补 'Z' 当作 UTC 解析，再由 getHours() 等本地方法转回用户时区。
 */
export function fmtIso(iso?: string | null): string {
  if (!iso) return ''
  let s = iso.trim()
  // 已带时区（Z 或 ±HH:MM / ±HHMM）则原样解析，避免重复偏移
  if (!/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z'
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
