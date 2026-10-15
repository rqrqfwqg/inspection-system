/**
 * useChooseLocation —— 微信地图手动选点（wx.chooseLocation）封装
 *
 * 为什么需要它：精确定位在机场这种场景**先天不可靠**——
 * 机房 / 管廊 / 负二层基本取不到 GPS 解，室内退化到 WiFi/基站后误差几十~上百米
 * （见 useGeolocation 顶部「能力上限」说明）。所以现场人员需要一条
 * 「不靠定位、直接在地图上点」的人工兜底通路。
 *
 * 🔴 三条纪律（与 useGeolocation 保持同一套健壮性口径）：
 * 1. **失败绝不抛异常**，统一 resolve 成 `{ point: null, reason }`；
 * 2. **用户取消 = 静默**：用户点返回是「我不想选」，不是错误，
 *    绝不能弹「选择失败」把正常操作报错（现场最招人烦的一类）；
 * 3. **绝不塞 (0,0)**：(0,0) 一律判为无效（复用 geo.ts 的 isUsable），
 *    塞进去会把 <map> 拉到几内亚湾。
 *
 * ⚠️ 权限与声明（三者缺一不可，漏了就是静默失败或提审被拦）：
 * - `manifest.json` 的 `mp-weixin.requiredPrivateInfos` 必须含 **"chooseLocation"**
 *   （与 "getLocation" 并列）。漏了 → 提交代码审核报 **61040**；
 * - 该 appid 须已在微信公众平台「开发管理 → 接口设置」开通
 *   「 choosesLocation / 选择位置 」权限（本 appid 用户已确认开通）；
 * - 反向红线：`requiredPrivateInfos` 里**不能填未开通的接口**，填了反而提审被拦。
 *
 * ⚠️ `wx.chooseLocation` 官方标注「用户授权：需要 scope.userLocation」，
 * app.json 中 scope.userLocation.desc 为共用文案，本项目与 getLocation 共用一条 desc；
 * requiredPrivateInfos 中须声明 chooseLocation。
 * （官方文档：https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.chooseLocation.html）
 *
 * ⚠️ 它打开的地图会以当前定位为中心，所以定位授权被拒时只是「初始视野不准」，
 * 仍可正常选点 —— 故本封装**不因定位未授权而拦死选点**（只把原因如实透出给调用方）。
 *
 * 🔴 并发保护：`chooseLocation` 会拉起微信原生界面，连续快速点击会重复拉起。
 * 本模块统一维护 `pending`（模块级单例 ref），所有调用方共用同一个标志，
 * 不在各个页面各写一份 busy（各写一份必然漏一处）。
 */

import { ref } from 'vue'
import { isUsable } from '@/api/geo'

/**
 * 全局「选点界面正在打开」标志（模块级单例）。
 * true 时应直接 return，不要再拉起 chooseLocation。
 */
export const choosePending = ref(false)

/** 选点结果（与 useGeolocation 的 GeoResult 同构，便于页面统一处理失败） */
export interface ChooseLocationResult {
  /** 用户选定的坐标；取消/失败/非法坐标时为 null */
  point: { latitude: number; longitude: number; name?: string; address?: string } | null
  /** 失败/取消原因；成功时为 undefined */
  reason?: ChooseFailReason
  message?: string
}

export type ChooseFailReason = 'cancel' | 'denied' | 'privacy' | 'unsupported' | 'fail'

/**
 * 调起微信地图选点。
 *
 * 返回**永不 reject**：所有异常路径都收敛成 `{ point: null, reason }`，
 * 调用方只需判 `point` 为空即可，不需要 try/catch。
 *
 * 🔴 并发保护做在这一层（而不是让每个页面各写一份 busy）：
 * 拉起期间 `choosePending` 为 true，再次调用**直接静默返回**，不会重复拉起原生界面；
 * 无论成功/取消/失败都在finally 里复位，不会漏复位把入口永久锁死。
 */
export function chooseLocation(): Promise<ChooseLocationResult> {
  return new Promise((resolve) => {
    // 已在选点界面中：静默返回，不打扰用户（重复拉起才是 bug）
    if (choosePending.value) {
      resolve({ point: null, reason: 'cancel' })
      return
    }
    choosePending.value = true
    const settle = (r: ChooseLocationResult) => {
      choosePending.value = false
      resolve(r)
    }
    // wx 在 TS 全局没有声明 → 走 globalThis（与 useGeolocation.rawGetLocation 同一手法，
    // 不写 `declare const wx`，避免与官方将来可能的声明冲突）
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
    const api =
      g?.wx?.chooseLocation ||
      (typeof uni !== 'undefined' ? (uni as any).chooseLocation : undefined)
    if (typeof api !== 'function') {
      settle({
        point: null,
        reason: 'unsupported',
        message: '当前微信版本过低，请升级微信后重试',
      })
      return
    }
    try {
      api({
        // 不传 lat/lng：由用户在地图上自行选址，避免「默认落在自动定位点」诱导误操作
        success: (res: any) => {
          const lat = Number(res?.latitude)
          const lng = Number(res?.longitude)
          if (!isUsable(lat, lng)) {
            // 选了但坐标非法（理论上不会，兜底不信任第三方返回值）
            settle({ point: null, reason: 'fail', message: '选点坐标无效，请重试' })
            return
          }
          settle({
            point: {
              latitude: lat,
              longitude: lng,
              name: String(res?.name || ''),
              address: String(res?.address || ''),
            },
          })
        },
        fail: (err: any) => {
          const msg = String(err?.errMsg || err || '')
          // 取消（含用户点左上角返回）→ 静默，这是正常操作
          if (msg.includes('cancel')) {
            settle({ point: null, reason: 'cancel' })
            return
          }
          let reason: ChooseFailReason = 'fail'
          if (msg.includes('not a function') || msg.includes('fail unsupported')) {
            reason = 'unsupported'
          } else if (msg.includes('privacy') || msg.includes('隐私')) {
            reason = 'privacy'
          } else if (msg.includes('auth') || msg.includes('authorize') || msg.includes('deny')) {
            reason = 'denied'
          }
          settle({ point: null, reason, message: msg || '选点失败' })
        },
      })
    } catch (e) {
      // 兜底：极端情况下同步抛错也必须复位，否则入口永久锁死
      settle({ point: null, reason: 'fail', message: '选点失败，请重试' })
    }
  })
}

/** 失败原因 → 面向现场的人话（取消不归到这里，调用方先判 cancel） */
export function chooseFailText(reason?: ChooseFailReason): string {
  switch (reason) {
    case 'unsupported':
      return '微信版本过低，请升级微信后重试'
    case 'privacy':
      return '小程序未声明位置权限，请联系管理员'
    case 'denied':
      return '位置权限未开启，可在设置里开启后重试'
    default:
      return '选点失败，请重试'
  }
}