/**
 * useGeolocation —— 小程序定位封装（扫码记设备坐标用 · 批次⑤）
 *
 * 背景：现场盘点时「设备在哪」过去只能靠房间号，而房间归属覆盖率很低；
 * 批次⑤ 起，扫码的同时把手机定位记一条观测
 * （POST /ops/api/assets/asset-ledger/geo-observations），形成设备的空间位置证据链。
 *
 * ⚠️ 2026-09-15 晚：微信侧 **精确定位 `wx.getLocation` 已审核通过**，
 * 本文件由模糊定位（`wx.getFuzzyLocation`）**切回精确**。
 * 模糊版只在当天短暂存在，原因是当时后台只批了模糊；用户明确反馈「模糊定位不能满足需求」。
 * 切换必须**三处同改**，漏一处就是静默失败或在提审时被拦：
 *   ① 接口调用点（本文件）；
 *   ② `manifest.json` 的 `requiredPrivateInfos` → **"getLocation"**；
 *   ③ 授权 scope → **`scope.userLocation`**。
 * 反向也要记住：`requiredPrivateInfos` 里**不能出现未开通的接口**，
 * 否则会在**代码提审环节被直接拦截**（微信 2022-07-14 起的校验）。
 *
 * 设计要点（每条都是踩过/想清楚的，别随手改）：
 * 1) **gcj02**：必须显式传，默认的 wgs84 叠到高德/腾讯地图底图上会整体偏移。
 * 2) **isHighAccuracy**：开高精度（优先 GPS）；`highAccuracyExpireTime` 是
 *    「等 GPS 解的时限」，超时后回落到 WiFi/基站结果 —— 宁可慢 5 秒也要拿 GPS，
 *    否则楼内会直接给出几百米误差的基站坐标。基础库需 ≥ 2.9.0。
 * 3) **短时缓存（默认 60s）**：现场连续扫几十台设备，如果每次都原地等定位，
 *    扫码节奏会被彻底拖死。同一位置短时间内坐标几乎不变 → 复用上一次结果。
 * 4) **失败绝不阻断扫码**：室内（机房 / 管廊 / 负二层）定位常失败，
 *    取不到就**不上报**（后端也就没有记录），扫码主流程照常走；
 *    绝不塞 (0,0) 假坐标——那会污染后续所有位置核验。
 * 5) **区分失败原因**：拒绝授权（可引导去设置页恢复）/ 隐私未声明 / 超时 / 微信版本过低，
 *    文案不同。尤其「隐私未声明」报错长得像「接口没开通」，最容易误判成权限没批。
 *
 * 权限前提（真机，缺一不可）：
 * - `manifest.json`：`requiredPrivateInfos: ["getLocation"]` + `permission.scope.userLocation`；
 * - 微信公众平台「开发管理 → 接口设置」已开通「获取当前的地理位置、速度」（2026-09-15 审核通过）；
 * - 后台《用户隐私保护指引》须勾选「位置信息」，否则接口会被隐私校验拦下。
 *
 * ⚠️ **能力上限（别对精度抱幻想）**：精确定位的「米级」是**室外指标**——
 * 室外 5~20m 可用；进楼后退化为 WiFi/基站（几十~几百米）；负二层/管廊很可能取不到解。
 * 因此坐标只能证明「这台设备是在机场这一片被扫的」，**不能**用来判断它在哪间机房。
 * 设备归属仍以「房间 + 扫码绑定」人工流程为准，定位只作旁证。
 */
import { assetCreateGeoObservation } from '@/api/asset'
import type { AssetApiError } from '@/api/asset'
import type { GeoObservationPayload } from '@/types/asset'
import { enqueueGeo, isNetworkError } from '@/utils/assetOffline'
import { showToast } from '@/utils/feedback'

/** 一次定位结果 */
export interface GeoPoint {
  latitude: number
  longitude: number
  /** 水平精度半径（米）。精确定位正常会返回；极少数回落路径可能不给 → undefined，
   *  展示层需容忍缺失，不要显示成 0。 */
  accuracy?: number
  altitude?: number
  /** 固定 gcj02（与地图底图一致） */
  coordType: string
  /** true = 模糊定位产物（公里级，仅供区域级参考）。
   *  当前**恒为 false**（已切精确）；保留该字段是为了展示层的双模式判断与历史数据兼容。 */
  fuzzy: boolean
  /** 取到定位的时间戳（本地时钟） */
  at: number
  /** true = 复用缓存，不是本次重新定位 */
  cached?: boolean
}

export type GeoFailReason = 'denied' | 'privacy' | 'timeout' | 'unsupported' | 'fail'

export interface GeoResult {
  point: GeoPoint | null
  reason?: GeoFailReason
  message?: string
}

/** 缓存有效期：60s 内复用上一次坐标（连续扫码场景） */
export const GEO_CACHE_TTL = 60_000

/**
 * 定位抖动量级（米）——判断「两次定位是否构成位移」的阈值。
 * 精确定位室外常态抖动 5~20m，取 20m 作门限：低于它的差值一律视为抖动。
 * （模糊定位时代这里曾是 1000m，因为模糊版自身抖动就是公里级。）
 */
export const GEO_NOISE_METERS = 20

/** 是否请求高精度（优先 GPS 解）——楼内定位质量的关键开关 */
export const GEO_HIGH_ACCURACY = true

/** 等待高精度解的时限（毫秒）；超时后回落到 WiFi/基站结果 */
export const GEO_HIGH_ACCURACY_EXPIRE_MS = 5000

let cache: GeoPoint | null = null

/** 最近一次取到的坐标（含缓存），供页面展示；无则 null */
export function lastGeoPoint(): GeoPoint | null {
  return cache
}

/** 缓存年龄（毫秒）；无缓存返回 -1 */
export function geoCacheAge(): number {
  return cache ? Date.now() - cache.at : -1
}

/** 清空缓存（换房间/怀疑定位漂移时可手动调） */
export function clearGeoCache(): void {
  cache = null
}

/**
 * 包装 `wx.getLocation`（精确定位）。
 *
 * - `type: 'gcj02'`：必传，否则叠地图整体偏移；
 * - `isHighAccuracy` + `highAccuracyExpireTime`：基础库 ≥ 2.9.0 才支持；
 *   不支持的老版本传了也只是被忽略，不影响调用；
 * - 注意 `scope.userLocation` 是**精确定位专属** scope，与 `scope.userFuzzyLocation` 独立。
 */
function rawGetLocation(): Promise<any> {
  return new Promise((resolve, reject) => {
    // wx 在 TS 全局**没有声明**（@dcloudio/types 不把 wx 作为全局注入，实测 TS2304）→
    // 走 globalThis 取，既不用 `declare const wx`（会与官方将来可能的声明冲突），
    // 也不影响运行时。
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
    const api =
      g?.wx?.getLocation || (typeof uni !== 'undefined' ? (uni as any).getLocation : undefined)
    if (typeof api !== 'function') {
      reject({ errMsg: 'getLocation:fail 当前微信版本过低，请升级微信后重试' })
      return
    }
    api({
      type: 'gcj02',
      isHighAccuracy: GEO_HIGH_ACCURACY,
      highAccuracyExpireTime: GEO_HIGH_ACCURACY_EXPIRE_MS,
      success: (res: any) => resolve(res),
      fail: (err: any) => reject(err),
    })
  })
}

/** 位置授权三态（对应 `getSetting().authSetting[SCOPE]`） */
export type LocationAuthState = 'granted' | 'denied' | 'neverAsked' | 'unknown'

/** 精确定位专属scope —— 与 `scope.userFuzzyLocation` 独立，用错会 authorize 失败且报错含糊 */
const LOCATION_SCOPE = 'scope.userLocation'

/**
 * 只**读取**授权状态，不弹任何 UI。
 *
 * 单独抽出来是因为有两处需要它、且语义必须一致：
 * - `ensureLocationAuth`：要按状态分流（放行 / 引导设置页 / 弹系统框）；
 * - `prewarmLocationAuth`：登录后预授权，**只在「从未询问」时**弹一次，
 *   对「曾拒绝」必须静默跳过（反复引导去设置页是骚扰）。
 * 任何一边改了判定口径，另一边就会跟着错。
 */
export function getLocationAuthState(): Promise<LocationAuthState> {
  return new Promise((resolve) => {
    uni.getSetting({
      success: (res: any) => {
        const v = res?.authSetting?.[LOCATION_SCOPE]
        if (v === true) resolve('granted')
        else if (v === false) resolve('denied')
        else resolve('neverAsked') // undefined = 从未询问过
      },
      // 拿不到设置 → unknown（不是 denied！调用方据此选择「不猜、不弹」）
      fail: () => resolve('unknown'),
    } as any)
  })
}

/**
 * 弹系统授权框（仅在「从未询问」时有效）。
 *
 * ⚠️ 曾拒绝过的用户调这个**不会**再弹框，success/fail 都可能走 fail ——
 * 所以调用方必须先用 `getLocationAuthState` 判断，否则会出现「点了没反应」。
 */
export function requestLocationAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    uni.authorize({
      scope: LOCATION_SCOPE,
      success: () => resolve(true),
      fail: () => resolve(false),
    } as any)
  })
}

/** 会话内是否已尝试过登录预授权（节流，见 `prewarmLocationAuth` 纪律 2） */
let authAttemptedThisSession = false

/**
 * 确保已获得位置授权（扫码等**被动**场景用这个：失败会引导去设置页）。
 *
 * ⚠️ scope 用 **`scope.userLocation`**（精确定位专属），不是 `scope.userFuzzyLocation`——
 * 两者独立，用错会导致 authorize 失败且报错含糊。
 *
 * 三种状态：
 * - 已授权(true) → 直接放行；
 * - 从未询问(undefined) → 调 `uni.authorize` 弹系统授权框；
 * - **曾拒绝(false)** → 系统不会再弹框，只能引导用户去「设置」里手动开启
 *   （`uni.openSetting`），这是小程序定位最常见的坑：不处理的话
 *   定位接口会一直静默失败，用户以为「功能坏了」。
 */
export async function ensureLocationAuth(): Promise<boolean> {
  const state = await getLocationAuthState()
  if (state === 'granted') return true
  if (state === 'unknown') return true // 状态不明就不拦，让定位接口自己去试（避免误伤）
  if (state === 'neverAsked') return requestLocationAuth()
  // denied：系统不会再弹，只能引导去设置页手动开启
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '需要位置权限',
      content: '记录设备现场坐标需要「位置信息」权限，请在设置中开启后重试。',
      confirmText: '去设置',
      cancelText: '暂不',
      success: (m: any) => {
        if (!m?.confirm) {
          resolve(false)
          return
        }
        uni.openSetting({
          success: (st: any) => resolve(!!st?.authSetting?.[LOCATION_SCOPE]),
          fail: () => resolve(false),
        })
      },
      fail: () => resolve(false),
    } as any)
  })
  return ok
}

/**
 * 取当前位置（带短时缓存）。
 *
 * @param ttlMs 缓存有效期；传 0 强制重新定位
 * @returns 失败时 `point` 为 null 并给出 `reason`，**不抛异常**（调用方不必 try）
 */
export function getCurrentPoint(ttlMs: number = GEO_CACHE_TTL): Promise<GeoResult> {
  if (cache && ttlMs > 0 && Date.now() - cache.at <= ttlMs) {
    return Promise.resolve({ point: { ...cache, cached: true } })
  }
  return rawGetLocation().then(
    (res: any): GeoResult => {
      const lat = Number(res?.latitude)
      const lng = Number(res?.longitude)
      // (0,0) 是小程序/webview 定位失败的经典兜底值，视为失败
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
        return { point: null, reason: 'fail', message: '定位结果无效（0,0）' }
      }
      const p: GeoPoint = {
        latitude: lat,
        longitude: lng,
        // 精确接口正常会返回；仍写成条件取值——回落路径可能缺席，缺失就是 undefined，
        // **不要**补 0（0 米会被误读成「极其精准」）
        accuracy: typeof res?.accuracy === 'number' ? res.accuracy : undefined,
        altitude: typeof res?.altitude === 'number' ? res.altitude : undefined,
        coordType: 'gcj02',
        fuzzy: false,
        at: Date.now(),
      }
      cache = p
      return { point: p }
    },
    (err: any): GeoResult => {
      const msg = String(err?.errMsg || err || '')
      let reason: GeoFailReason = 'fail'
      if (msg.includes('版本过低') || msg.includes('not a function')) {
        reason = 'unsupported'
      } else if (msg.includes('privacy') || msg.includes('隐私')) {
        // 《用户隐私保护指引》未声明位置信息 → 报错很像「接口没开通」，最易误判
        reason = 'privacy'
      } else if (msg.includes('auth') || msg.includes('authorize') || msg.includes('permission')) {
        reason = 'denied'
      } else if (msg.includes('timeout')) {
        reason = 'timeout'
      }
      return { point: null, reason, message: msg || '定位失败' }
    },
  )
}

/**
 * 登录成功后**一次性**预授权定位（用户诉求：登录时直接拿到权限）。
 *
 * 与 `reportScanGeo` 内部那次 `ensureLocationAuth` 的区别（这是本函数存在的理由）：
 * - 扫码时那次是**被动**的：用户已经在那次才第一次被问，静默失败就静默失败；
 * - 本函数是**主动**的：在登录成功这个确定时刻就问一次，把权限前置，
 *   避免到了机房/管廊（定位本就难解）才第一次被弹窗打断。
 *
 * 三条纪律（每条都对应一种真实会被用户骂的场景）：
 * 1. **绝不阻断登录**：权限是可选增强，不是登录凭据。拿不到就静默返回false，
 *    登录流程照常往下走 —— 否则「拒绝定位 = 登不进系统」，用户直接流失。
 * 2. **绝不每次登录都弹**：曾拒绝过的用户，微信**不会再弹系统框**，
 *    只能引导去设置页。若每次冷启动都弹一次「去设置」，是骚扰而非帮忙。
 *    故：同一会话内只尝试一次；且本版本**不主动引导去设置页**（那属于
 *    扫码时的既有路径），这里只在**从未询问过**时弹一次系统授权框。
 * 3. **不主动上报坐标**：只拿权限，不在登录时刻取位置也不上报 ——
 *    登录瞬间的坐标对设备归属毫无价值（人在办公室不在机房），反而污染观测表。
 *
 * @returns true = 已获得定位授权；false = 未获得（可忽略，扫码时会再引导）
 */
export async function prewarmLocationAuth(): Promise<boolean> {
  // 会话内节流：已尝试过就不再打扰（含用户主动拒绝的情况）
  if (authAttemptedThisSession) return false
  authAttemptedThisSession = true
  try {
    const res = await getLocationAuthState()
    // 已授权：不打扰，静默通过
    if (res === 'granted') return true
    // 曾拒绝 / 状态不明：系统不会再弹，引导路径留给扫码，这里静默跳过（纪律 2）
    if (res === 'denied' || res === 'unknown') return false
    // 从未询问 → 弹一次系统授权框
    return await requestLocationAuth()
  } catch {
    // 拿不到设置状态：不猜、不弹，让扫码时的既有逻辑兜底
    return false
  }
}

/** 登录成功后调用的统一入口：预授权定位，失败不阻断 */
export function requestLoginLocationAuth(): void {
  void prewarmLocationAuth().catch(() => false)
}

export interface ReportScanGeoOptions {
  /** 已确认 canonical 的设备编号（必填） */
  deviceCode: string
  /** 扫码时所在房间（可空） */
  roomCode?: string
  /** camera / album / manual */
  scanSource?: string
  operator?: string
  /** 是否弹提示（默认 false：扫码流程里静默成败，避免打断连续扫码） */
  notify?: boolean
  /** 缓存有效期覆盖（默认 60s） */
  ttlMs?: number
  /** 上报成功回调（页面可用于刷新设备卡的定位展示） */
  onDone?: (point: GeoPoint) => void
  /** 入离线队列回调 */
  onQueued?: () => void
}

/**
 * 扫码后「取定位 → 上报」的一体化封装（失败不抛异常、不阻断扫码）。
 *
 * 红线：
 * - 取不到定位 → 直接返回 null，**不上报假坐标**；
 * - 业务错误（404 设备不存在 / 400 坐标非法）→ 当场提示、**不入离线队列**（重试无意义）；
 * - 网络错误（statusCode=0）→ 入离线队列，联网后自动补传。
 * - `source` **不传**（走后端默认 `miniprogram`）——后端匹配内核只认白名单来源，
 *   传错会让这条观测进不了索引（`ledger_text` 那批脏数据的教训）。
 */
export async function reportScanGeo(opts: ReportScanGeoOptions): Promise<GeoPoint | null> {
  const code = String(opts.deviceCode || '').trim()
  if (!code) return null

  const notify = !!opts.notify
  const auth = await ensureLocationAuth()
  if (!auth) {
    if (notify) showToast('未开启定位权限，本次未记录坐标', 'none', 1800)
    return null
  }

  const { point, reason } = await getCurrentPoint(opts.ttlMs)
  if (!point) {
    if (notify) {
      showToast(
        reason === 'privacy'
          ? '小程序未声明位置权限，请联系管理员'
          : reason === 'unsupported'
            ? '微信版本过低，请升级微信后重试'
            : reason === 'timeout'
              ? '定位超时，本次未记录坐标'
              : reason === 'denied'
                ? '定位权限未开启，本次未记录坐标'
                : '定位失败，本次未记录坐标',
        'none',
        1800,
      )
    }
    return null
  }

  const observedAt = new Date().toISOString()
  const payload: GeoObservationPayload = {
    device_code: code,
    latitude: point.latitude,
    longitude: point.longitude,
    // 拿不到精度/海拔 → null（不是 0，别编造）；后端字段本身可空
    accuracy: point.accuracy ?? null,
    altitude: point.altitude ?? null,
    coord_type: 'gcj02',
    room_code: opts.roomCode || '',
    scan_source: opts.scanSource || 'camera',
    operator: opts.operator || '',
    observed_at: observedAt,
  }

  try {
    await assetCreateGeoObservation(payload)
    opts.onDone?.(point)
    return point
  } catch (e) {
    const err = e as AssetApiError
    if (isNetworkError(err)) {
      // 断网：定位是本地能力，坐标已经拿到，别丢 —— 入队等联网补传
      enqueueGeo(
        code,
        point.latitude,
        point.longitude,
        opts.roomCode || '',
        point.accuracy,
        opts.scanSource || 'camera',
        opts.operator || '',
        observedAt,
        err.message,
      )
      opts.onQueued?.()
      if (notify) showToast('无网络，坐标已暂存，联网后自动上传', 'none', 1800)
      return point
    }
    // 404/400：业务错误，重试无意义，不入队
    if (notify) showToast(err.message || '坐标上报失败', 'none', 1800)
    return null
  }
}

/** 两点球面距离（米）—— 设备卡上提示「较上次定位偏移 X 米」 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 坐标文本（6 位小数） */
export function formatGeoPoint(p?: GeoPoint | null): string {
  if (!p) return ''
  return `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`
}

/** 精度文本：精确定位 `±12m`；模糊定位（历史数据/异常产物）返回「模糊定位」；
 *  两者都不成立（精度字段缺失）返回空串，**不要编造数值**。 */
export function formatGeoAccuracy(p?: GeoPoint | null): string {
  if (!p) return ''
  if (p.fuzzy) return '模糊定位'
  if (typeof p.accuracy !== 'number' || !isFinite(p.accuracy)) return ''
  return `±${Math.round(p.accuracy)}m`
}
