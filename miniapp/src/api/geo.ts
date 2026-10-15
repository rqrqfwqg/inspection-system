/**
 * geo.ts —— 地图坐标聚合层
 *
 * 为什么单独一层：设备定位、房间定位、工单路线三条业务线都要把
 * 「观测记录 / 打卡记录 / 线路节点」换算成地图点，但换算口径必须**完全一致**：
 *   - 统一剔除 (0,0) 与越界脏坐标（塞进 <map> 会把视图拉到几内亚湾）；
 *   - 统一用**最新一条**作为代表点（不是平均——平均会把不同时期的位置抹平）；
 *   - 统一用 accuracy 画误差圆（室内误差上百米，不画出来等于骗人）。
 * 口径散在三个页面各写一遍，迟早会出现「设备页准、房间页偏」的不一致。
 *
 * ⚠️ 坐标来源与能力边界（写清楚免得后面误判数据可信度）：
 *   - `device_geo_observations`：扫码时记的坐标，**是该设备被扫到的位置**，
 *     不是设备安装位置（同一房间内多台设备的点会互相重叠，这是正常的）。
 *   - `inspection_checkins`：打卡时上报的坐标，工单路线轨迹的唯一来源。
 *   - 线路节点表**本身没有经纬度**，所以节点坐标只能由「该节点房间的观测」反推；
 *     房间没观测记录时该节点在地图上无点（前端明确标注「未定位」，不瞎画）。
 *
 * 除 `reportManualDeviceGeo`（人工修正设备位置，走现成观测接口）外全部**只读**。
 */
import { assetListGeoObservations, assetCreateGeoObservation } from '@/api/asset'
import { listCheckins } from '@/api/patrol'
import type { DeviceGeoObservation } from '@/types/asset'
import type { Checkin } from '@/api/patrol'

/** 地图可用坐标点 */
export interface GeoPoint {
  /**
   * 观测记录主键（来自 device_geo_observations.id）。
   *
   * 🔴 用途：代表点与历史散点必须按 **id** 精确互斥，不能按坐标比较 ——
   * 同一设备被重复扫到时出现「同坐标、不同记录」是完全合法的，
   * 按坐标剔除会把别的记录连带删掉。本机人工标注（如房间/线路节点）没有后端观测 id，用 0 占位。
   */
  id: number
  latitude: number
  longitude: number
  /** 水平精度半径（米） */
  accuracy?: number | null
}

/** 房间定位结果（含代表性坐标与观测条数） */
export interface RoomGeoResult {
  /** 代表坐标：有观测取最新一条，否则 null */
  point: GeoPoint | null
  /** 该房间的有效观测条数 */
  samples: number
  /** 参与统计的设备数（去重） */
  devices: number
  /** 最近一次观测时间 */
  lastAt?: string | null
}

/** 工单路线轨迹结果 */
export interface TrackResult {
  /** 按打卡时间排序的轨迹点（已剔除无坐标记录） */
  points: Array<GeoPoint & { id: number; nodeId: number; at?: string | null }>
  /** 有坐标的打卡数 */
  located: number
  /** 打卡总数（含没定位成功的） */
  total: number
  /** 轨迹总长（米，按相邻点直线距离累加） */
  distanceM: number
}

/** GTC 中心（兜底视野用，避免无点时地图乱飞） */
export const GTC_CENTER = { latitude: 23.3626, longitude: 113.3206 }

/** 坐标是否可用：非数值、(0,0)、越界一律判否 */
export function isUsable(lat?: number | null, lng?: number | null): boolean {
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (a === 0 || b === 0) return false
  return a >= -90 && a <= 90 && b >= -180 && b <= 180
}

/**
 * 两点间距离（米，Haversine）。
 * 用它算轨迹里程：巡查路线里程是给现场看的执行指标，
 * 不能用直线连乘的粗算（节点少时误差不大，但顺序错乱会算飞）。
 */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const la1 = toRad(a.latitude)
  const la2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 把观测记录转成地图点，非法坐标返回 null（保留观测 id，供调用方按 id 精确去重） */
function toPoint(o: DeviceGeoObservation | null | undefined): GeoPoint | null {
  if (!o || !isUsable(o.latitude, o.longitude)) return null
  return {
    id: Number(o.id) || 0,
    latitude: Number(o.latitude),
    longitude: Number(o.longitude),
    accuracy: o.accuracy,
  }
}

/**
 * 设备定位结果。
 *
 * `manual` 字段是本轮新增：它标明 `point` 到底取自**人工选点**还是**扫码自动定位**，
 * 页面据此在地图上换气泡颜色/标签（用户分不清哪个是人工的就会误判数据可信度）。
 */
export interface DeviceGeoResult {
  /** 代表坐标：优先取最新一条 manual 观测，否则取最新一条自动观测 */
  point: GeoPoint | null
  /** 代表点是否来自人工选点（scan_source === 'manual'） */
  manual: boolean
  /** 最近一次**人工选点**时间（无人工记录时 null） */
  manualAt?: string | null
  /**
   * 代表点那条观测自带的精度半径（米）；没有该字段时为 null。
   * 🔴 与 manual 配套：人工点**永久优先**（不设有效期阈值），但线上存在
   * accuracy=1134 米的旧 manual 记录，页面必须靠这个字段警示「精度不可信」，
   * 否则一个已知标错的数据会显示成「人工修正后的可信位置」。
   */
  manualAccuracy?: number | null
  samples: number
  /**
   * 历史观测点（淡色小点）。
   * 🔴 **已剔除代表点本身**（按观测 id 精确剔除），页面可直接全量遍历，
   * 不需要也不允许再 slice(1) —— 过去正是靠「第 0 条是代表点」的假设，
   * 在「先扫码后人工修正」的场景下漏掉了最近那次真实扫码点。
   */
  history: GeoPoint[]
  lastAt?: string | null
}

/** 设备定位：代表点 = **最新一条 manual 观测**；没有人工记录时退回最新一条自动观测。
 *
 * 为什么这样取（后端语义决定的，不是随便挑的）：
 * `assetCreateGeoObservation` 是**每次调用追加一条**、不做幂等合并的语义 ——
 * 后端注释写明这张表是「判断设备是否被移动过」的**证据链**，
 * 所以用户重复修正 3 次就是 3 条 manual 记录，**这是符合设计的，不要去覆盖/删除旧记录**。
 * 既然不能覆盖，读取侧就只能按「最新的 manual 为准」来体现人工修正的结果：
 * 最新一条 manual 代表**当前人工认定的安装位置**，它比任何自动定位都更可信
 * （自动定位在室内误差上百米，见 useGeolocation 的能力上限说明）。
 *
 * 不用平均：同一设备被不同人在不同时段扫到，平均值没有物理含义。
 *
 * 🔴 `history` 的口径（QA 整改后）：代表点已从 history 中**按观测 id 精确剔除**，
 * 二者严格互斥。调用方全量遍历 history 即可，⛔ 不要再用 slice(1) ——
 * 旧代码假设「第 0 条一定是代表点」，在「先扫码 camera、后人工修正 manual」时
 * （list[0]=camera、list[1]=manual）会漏画最近那次真实扫码点，并把人工点画两遍。
 */
export async function deviceGeo(deviceCode: string, limit = 20): Promise<DeviceGeoResult> {
  const rows = await assetListGeoObservations(deviceCode, limit)
  const list = (rows || []).filter((o) => isUsable(o.latitude, o.longitude))
  const first = toPoint(list[0])
  // list 已按时间倒序（后端「最新在前」），所以第一条 manual 即最新一条人工修正
  const newestManual = list.find((o) => (o.scan_source || '') === 'manual')
  const representative = newestManual || list[0]
  // 代表点的观测 id（人工/自动观测都带真实 id；为 0 时不剔除任何记录）
  const repId = representative ? Number(representative.id) || 0 : 0
  return {
    point: representative ? toPoint(representative) : first,
    manual: !!newestManual,
    manualAt: newestManual ? newestManual.observed_at || newestManual.created_at || null : null,
    // 代表点是人工时把它的 accuracy 带出来，供页面警示「精度不可信」（无该字段 → null）
    manualAccuracy:
      newestManual && newestManual.accuracy != null ? Number(newestManual.accuracy) : null,
    samples: list.length,
    history: list.flatMap((o) => {
      // 🔴 守卫：代表点（含人工点）绝不能同时出现在淡点集合里 —— 按 id 比对，不按坐标
      if (repId && Number(o.id) === repId) return []
      const p = toPoint(o)
      return p ? [p] : []
    }),
    lastAt: (representative?.observed_at || representative?.created_at) ?? null,
  }
}

/**
 * 房间定位：按 room_code 取该房间的定位观测，取最新一条为代表点。
 *
 * ⚠️ 后端已支持 `room_code` 过滤，但前端封装的 assetListGeoObservations
 * 只暴露 device_code 参数，所以这里直接按「房间内观测」取窗口再本地过滤，
 * **limit 必须给足**（上限 200）：否则房间观测较老时会因窗口截断而查不到。
 */
export async function roomGeo(roomCode: string): Promise<RoomGeoResult> {
  const rows = await assetListGeoObservations('', 200)
  const list = (rows || []).filter(
    (o) => o.room_code === roomCode && isUsable(o.latitude, o.longitude),
  )
  const newest = list[0]
  return {
    point: toPoint(newest),
    samples: list.length,
    devices: new Set(list.map((o) => o.device_code)).size,
    lastAt: newest?.observed_at || newest?.created_at || null,
  }
}

/**
 * 批量房间定位：一次窗口内按房间分组，供「房间页展示房内所有设备分布点」用。
 * 返回 Map<room_code, 观测数组>（数组已按时间倒序）。
 */
export async function roomGeoBatch(
  roomCodes: string[],
  limit = 200,
): Promise<Map<string, DeviceGeoObservation[]>> {
  const want = new Set((roomCodes || []).filter(Boolean))
  const map = new Map<string, DeviceGeoObservation[]>()
  if (!want.size) return map
  const rows = await assetListGeoObservations('', limit)
  for (const o of rows || []) {
    const rc = o.room_code || ''
    if (!want.has(rc) || !isUsable(o.latitude, o.longitude)) continue
    if (!map.has(rc)) map.set(rc, [])
    map.get(rc)!.push(o)
  }
  return map
}

/**
 * 工单打卡轨迹：读该工单全部打卡记录，取有坐标的按时间排序成折线。
 *
 * 注意打卡记录里有 `lat/lng` 但**允许为 NULL**（定位失败不阻断打卡），
 * 所以 located 与 total 必须分开报，页面上要显示「N/M 次打卡有坐标」，
 * 不能只画有坐标的点却让用户以为只有这么几次打卡。
 */
export async function workOrderTrack(woId: number): Promise<TrackResult> {
  const rows = await listCheckins(woId)
  const list = rows || []
  const points = list
    .filter((c: Checkin) => isUsable(c.lat, c.lng))
    .sort((a: Checkin, b: Checkin) => {
      const ta = a.checked_at ? Date.parse(a.checked_at) : 0
      const tb = b.checked_at ? Date.parse(b.checked_at) : 0
      return ta - tb
    })
    .map((c: Checkin) => ({
      id: c.id,
      nodeId: c.node_id,
      latitude: Number(c.lat),
      longitude: Number(c.lng),
      at: c.checked_at,
    }))

  let distance = 0
  for (let i = 1; i < points.length; i++) {
    distance += distanceMeters(points[i - 1], points[i])
  }
  return { points, located: points.length, total: list.length, distanceM: distance }
}

/**
 * 线路节点坐标反推：节点表无经纬度，只能用「节点所属房间的观测坐标」代替。
 *
 * 返回 Map<room_code, GeoPoint>。查不到的房间**不在结果里**——
 * 调用方必须把这类节点显示成「未定位」而不是随便给个点（否则地图上会出现
 * 一堆重叠在 GTC 中心的假点，看起来像都定位好了，实际全是编的）。
 */
export async function nodeRoomGeo(roomCodes: string[]): Promise<Map<string, GeoPoint>> {
  const rows = await roomGeoBatch(roomCodes, 200)
  const out = new Map<string, GeoPoint>()
  for (const [rc, list] of rows) {
    const p = toPoint(list[0])
    if (p) out.set(rc, p)
  }
  return out
}

/** 米 → 友好文案（<1000m 显示米，否则公里） */
export function fmtDistance(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '0 m'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}

/**
 * 时间戳 → 「约 N 天前 / N 小时前 / N 分钟前」（**实时计算**，不写死）。
 *
 * 🔴 为什么人工标注必须显示相对时间：本项目口径是「人工点永久优先、不设有效期」，
 * 但一条 23 天前、精度 1134 米的旧标注和一个刚标的点，**可信度完全不同**。
 * 只给绝对日期，用户会默认「人工 = 当前位置 = 可信」，这是误导。
 * 相对时间实时算（不落库、不缓存），页面停留多久都不会显示过期数字。
 */
export function fmtAgo(input?: string | number | null): string {
  if (input == null || input === '') return ''
  const t = typeof input === 'number' ? input : Date.parse(/[Zz]$/.test(String(input)) ? String(input) : `${input}Z`)
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  // 后端时间是裸 UTC 字符串，未来时间（时钟偏差）按「刚刚」处理，不显示负数
  if (diff <= 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 60) return `约 ${Math.max(1, min)} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `约 ${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `约 ${day} 天前`
  return `约 ${Math.floor(day / 30)} 个月前`
}

// ===== 人工修正设备位置（A 类：真落库）=====

/**
 * 上报一条**人工选点**的设备定位观测（`scan_source: 'manual'`）。
 *
 * 🔴 语义要点（后端确认过，别改）：
 * - 该接口是**每次调用追加一条**，不做幂等合并；用户重复修正 3 次 = 3 条 manual 记录，
 *   这是「设备是否被移动过」的证据链，**不要试图覆盖或删除旧记录**；
 * - 读取侧由 `deviceGeo` 统一按「最新一条 manual 为代表点」处理。
 *
 * ⚠️ `accuracy` **不传**：人工在地图上选点没有精度半径的概念，
 * 填 0 会被下游误读成「极其精准」。后端该字段可空，留 null。
 */
export async function reportManualDeviceGeo(opts: {
  deviceCode: string
  latitude: number
  longitude: number
  roomCode?: string
  operator?: string
}): Promise<boolean> {
  const code = String(opts.deviceCode || '').trim()
  // 绝不塞假坐标：(0,0) 一律判无效（复用 isUsable，不重复实现）
  if (!code || !isUsable(opts.latitude, opts.longitude)) return false
  await assetCreateGeoObservation({
    device_code: code,
    latitude: Number(opts.latitude),
    longitude: Number(opts.longitude),
    // 人工选点没有精度半径 → 明确给 null，不编造数值
    accuracy: null,
    altitude: null,
    coord_type: 'gcj02',
    room_code: opts.roomCode || '',
    scan_source: 'manual',
    operator: opts.operator || '',
    observed_at: new Date().toISOString(),
  })
  return true
}
