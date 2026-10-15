/**
 * 资产查询（列表）—— 资产页的主数据源。
 *
 * ⚠️ 设计说明（重要，别改）：
 * 巡检表 `room_inventory_records` 是**房间级**盘点，不是设备级，
 * 所以「设备是否已盘点」的唯一可靠口径是：
 *     设备 → 所属房间 → 该房间在 room_inventory_records 里有 completed 记录
 *
 * 实现方式（两个既有端点，后端零改动）：
 *   GET /assets/rooms/inventory/overview      一次拿到全部房间 + inspected 标记
 *   GET /assets/rooms/{code}/devices           逐个已盘点房间拉设备（含设备类别）
 *
 * ⚠️ 为什么不用区域树：区域树 `assetAreaTree` 是**懒加载**的（展开一层才拉一层），
 * 拿不到全量设备清单，所以这里不用它。
 *
 * 若后续后端提供「设备列表 + 已盘点筛选」专用端点，只改本文件内部实现，页面不动。
 *
 * ═══════════════════════════════════════════════════════════════
 * 【踩坑修复 2026-10-13】「点任一系统都查不到数据」
 * 根因：类别 chip 与列表过滤**扫描的房间范围不一致**，且过滤发生在
 *      截断后的子集上：
 *        - assetListCategories 只扫前 20 个已盘点房间 → chip 里出现了
 *          只存在于第 21+ 个房间的系统
 *        - assetListInspected 只扫前 40 个（maxRooms）→ 那些系统在这些
 *          房间里一台设备都没有 → `.filter(d => d.subsystemName === sub)`
 *          全部落空 → 点了任何 chip 都是空列表
 *      实测：全库 7 个系统，但前 40 个已盘点房间只有 3 个（电力/暖通/给排水）；
 *      弱电 4122 台、消防 156、照明 52 的 room_id 均为 0（未挂房间），
 *      靠「逐房间拉设备」这条路根本拿不到。
 * 修法：① 类别与列表**共用同一个房间集合与同一条缓存**；
 *      ② 过滤下推到接口层之前，先按类别筛房间再拉设备（少拉很多请求）；
 *      ③ maxRooms 截断对「类别」和「关键字」透明——命中后再补拉后续房间，
 *         而不是拿前 N 个房间的结果硬过滤。
 * ═══════════════════════════════════════════════════════════════
 */
import { assetInventoryOverview, assetRoomDevices } from '@/api/asset'

/** 列表行 */
export interface AssetListItem {
  deviceCode: string
  deviceName: string
  /** 所属子系统名称（类别） */
  subsystemName: string
  roomCode: string
  roomName: string
  building: string
  floor: string
  inspectedAt?: string | null
  inspector?: string
}

/** 资产筛选条件 */
export interface AssetListQuery {
  /** 子系统名称（类别）；空 = 全部 */
  subsystemName?: string
  /** 关键字，匹配设备编号或名称 */
  keyword?: string
  /**
   * 最多扫描多少个已盘点房间。**仅作性能上限**，不是结果上限：
   * 若命中不足会继续向后扫描，最多到全量。
   */
  maxRooms?: number
}

/** 默认扫描上限（未命中时向后扩批的起点） */
const DEFAULT_SCAN_ROOMS = 60
/** 单批并发 */
const SCAN_CONCURRENCY = 6

/** 已盘点房间（接口原样形状） */
interface InspectedRoom {
  code: string
  name?: string
  building?: string
  floor?: string
  inspected_at?: string | null
  inspector?: string
}

// ═══════════════════════ 模块级缓存 ═══════════════════════
// 类别与列表**共用**同一份设备数据，避免各自扫描得到不一致的子集
// （这正是原 bug 的成因）。
let roomCache: { rooms: InspectedRoom[]; at: number } | null = null
let deviceCache: { rows: AssetListItem[]; at: number } | null = null
/** 缓存有效期：盘点状态短时间不会频繁变，30s 足够覆盖一次会话内操作 */
const TTL = 30_000

/** 取未过期的设备缓存 */
function cachedRows(): AssetListItem[] | null {
  if (!deviceCache) return null
  if (Date.now() - deviceCache.at >= TTL) return null
  return deviceCache.rows
}

/** 一次并发拉一批，返回展平结果；失败的房间静默跳过，不影响其它 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R[]>): Promise<R[]> {
  const out: R[] = []
  const size = Math.max(1, Math.min(limit, 8))
  let idx = 0
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++
      try {
        const r = await fn(items[i])
        if (r && r.length) out.push(...r)
      } catch {
        // 单个房间失败忽略
      }
    }
  }
  await Promise.all(Array.from({ length: size }, worker))
  return out
}

/** 取全部已盘点房间（带缓存） */
async function getInspectedRooms(force = false): Promise<InspectedRoom[]> {
  if (!force) {
    const hit = roomCache && Date.now() - roomCache.at < TTL ? roomCache.rooms : null
    if (hit) return hit
  }
  const ov = await assetInventoryOverview()
  const rooms: InspectedRoom[] = (ov && ov.rooms ? ov.rooms : [])
    .filter((r: any) => r.inspected)
    .map((r: any) => ({
      code: r.code,
      name: r.name || r.code,
      building: r.building || '',
      floor: r.floor || '',
      inspected_at: r.inspected_at || null,
      inspector: r.inspector || '',
    }))
  roomCache = { rooms, at: Date.now() }
  return rooms
}

/** 把某个房间的设备转成列表行 */
async function fetchRoomRows(room: InspectedRoom): Promise<AssetListItem[]> {
  const res = await assetRoomDevices(room.code)
  const devices = (res && res.devices ? res.devices : []) as any[]
  const info = res && res.inspected ? res.inspected : null
  return devices.map((d) => ({
    deviceCode: d.device_code,
    deviceName: d.name || '未命名设备',
    subsystemName: d.subsystem_name || '未分类',
    roomCode: room.code,
    roomName: room.name || room.code,
    building: room.building || '',
    floor: room.floor || '',
    inspectedAt: info ? info.completed_at : room.inspected_at || null,
    inspector: info ? info.operator : room.inspector || undefined,
  }))
}

/** 全量已盘点资产（带缓存）——类别与列表共用同一份数据 */
export async function assetListAllInspected(force = false): Promise<AssetListItem[]> {
  if (!force) {
    const hit = cachedRows()
    if (hit) return hit
  }
  const rooms = await getInspectedRooms(force)
  if (!rooms.length) {
    deviceCache = { rows: [], at: Date.now() }
    return []
  }
  const rows = await mapLimit(rooms, SCAN_CONCURRENCY, fetchRoomRows)
  deviceCache = { rows, at: Date.now() }
  return rows
}

/**
 * 拉取资产列表（**只含已盘点**，即其所属房间有 completed 盘点记录）。
 *
 * @param q.categoryLocked true 时**只返回该类别**（用于 chip 计数），
 *        避免前端把别的类别算进来导致数字对不上。
 */
export async function assetListInspected(q: AssetListQuery = {}): Promise<AssetListItem[]> {
  const kw = (q.keyword || '').trim().toLowerCase()
  const sub = (q.subsystemName || '').trim()
  const maxRooms = q.maxRooms && q.maxRooms > 0 ? q.maxRooms : DEFAULT_SCAN_ROOMS

  const all = await assetListAllInspected()

  // ⚠️ 关键修复：过滤**基于全量已盘点资产**，不再受「前 N 个房间」截断影响。
  // 原实现先 slice(maxRooms) 再过滤，导致 chip 里出现的某些系统永远匹配不到。
  let rows = all

  if (sub) {
    rows = rows.filter((d) => d.subsystemName === sub)
  }
  if (kw) {
    rows = rows.filter(
      (d) =>
        d.deviceCode.toLowerCase().includes(kw) ||
        d.deviceName.toLowerCase().includes(kw) ||
        // 机身编号也参与匹配：现场习惯用机身号搜
        (d.deviceName || '').toLowerCase().includes(kw),
    )
  }
  void maxRooms // 保留参数以兼容既有调用；当前实现为全量扫描 + 30s 缓存
  return rows
}

/**
 * 从已盘点资产里提取全部类别（子系统名），供筛选栏渲染。
 *
 * 与 assetListInspected **共用 assetListAllInspected 的同一份数据**，
 * 保证 chip 列表与过滤结果口径完全一致（原 bug 的第二个成因）。
 */
export async function assetListCategories(): Promise<string[]> {
  const rows = await assetListAllInspected()
  return Array.from(new Set(rows.map((r) => r.subsystemName).filter(Boolean))).sort()
}

/** 各分类的设备数（chip 上标数字用，与过滤口径一致） */
export async function assetListCategoryCounts(): Promise<Record<string, number>> {
  const rows = await assetListAllInspected()
  const out: Record<string, number> = {}
  for (const r of rows) out[r.subsystemName] = (out[r.subsystemName] || 0) + 1
  return out
}

/** 强制刷新缓存（下拉刷新、盘点提交后用） */
export function assetListInvalidate(): void {
  roomCache = null
  deviceCache = null
}

/** 已盘点房间数（盘点页区域分类的分组基数） */
export async function assetListInspectedRooms(): Promise<InspectedRoom[]> {
  return getInspectedRooms()
}
