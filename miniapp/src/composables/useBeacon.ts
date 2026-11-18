/**
 * useBeacon — iBeacon 蓝牙信标扫描（2026-11-18）
 * ------------------------------------------------------------------
 * 用途：打卡瞬间的「第二因子」取证。定位仍必填，信标只是叠加校验。
 * 需求文档：docs/小程序-蓝牙信标打卡需求-v1.0.md
 *
 * 🔴 关键约束（写在最前，防止后人踩坑）：
 *  1. 只用 wx/uni 的 iBeacon 专用 API：startBeaconDiscovery / onBeaconUpdate /
 *     getBeacons / stopBeaconDiscovery。**绝不能**用 onBluetoothDeviceFound——
 *     那是普通 BLE 搜索，拿不到 iBeacon 的 major/minor。
 *  2. UUID 一律转大写、保留连字符再比对（iOS 传小写会扫不到）。
 *  3. major/minor 类型在不同平台/回调里可能是 string 或 number，统一 Number() 后比。
 *  4. onBeaconUpdate 会持续推同一颗，按 uuid+major+minor 去重、只保留最强 rssi
 *     （rssi 越大越强，-65 强于 -80）。
 *  5. 扫描必须在超时后主动 stopBeaconDiscovery + 移除监听；页面卸载也要 stop，
 *     否则离开页面还在扫，耗电且回调泄漏（EARS AC-07）。
 *  6. 任何异常都只降级、不抛死：最坏情况返回 scanned=true 但无命中，
 *     由后端按 enforce 决定拦不拦，前端保证打卡按钮永不卡死。
 *
 * 与 usePutyPrinter（标签机 BLE 透传）互不干扰：那是 GATT 连接通道，
 * 这是 iBeacon 广播扫描，两者可同时开启。
 */
import { ref } from 'vue'

/** 一次扫描要找的目标信标（来自后端节点信标上下文） */
export interface BeaconTarget {
  uuid: string
  major: number | string
  minor: number | string
  rssiThreshold: number
  timeoutMs: number
}

/** 扫描结果（供打卡提交直接取用） */
export interface BeaconScanResult {
  /** 是否真正执行过 BLE 扫描（房间未绑标/未扫描为 false） */
  scanned: boolean
  /** 是否扫到了三元组完全匹配的那一颗 */
  matched: boolean
  /** 命中信标信息（仅 matched=true 时有值） */
  uuid?: string
  major?: number
  minor?: number
  /** 命中信标的最强 rssi（dBm，负值） */
  rssi?: number
  /** 本次扫描去重后看到的信标总数（诊断用） */
  scanCount: number
  /** 失败/降级原因（用于页面提示，不影响打卡继续） */
  reason?: BeaconFailReason
}

export type BeaconFailReason =
  | 'bluetooth_off'   // 蓝牙未开启（errCode 10001）
  | 'unsupported'     // 手机/系统不支持 BLE
  | 'denied'          // 用户拒绝蓝牙授权
  | 'timeout'         // 超时未扫到匹配信标
  | 'not_found'       // 扫到信标但三元组不匹配
  | 'error'           // 其它错误

/** 是否有扫描在进行中（供按钮显示「正在确认位置…」） */
export const beaconScanning = ref(false)

/** 当前扫描的取消句柄；重复调用 startBeaconScan 会先取消上一次 */
let activeCancel: (() => void) | null = null

/** UUID 归一：大写 + 保留连字符 + 去两端空白 */
export function normalizeUuid(uuid: string): string {
  return (uuid || '').trim().toUpperCase()
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * 启动一次 iBeacon 扫描。
 * - 返回的 Promise 一定 resolve（不会 reject）——异常走 result.reason 降级。
 * - 超时 / 手动取消 / 页面卸载都会走同一套清理逻辑。
 */
export function startBeaconScan(target: BeaconTarget): Promise<BeaconScanResult> {
  // 先把上一次扫描清掉，避免两个监听同时回调
  if (activeCancel) {
    activeCancel()
    activeCancel = null
  }

  const wantedUuid = normalizeUuid(target.uuid)
  const wantedMajor = num(target.major)
  const wantedMinor = num(target.minor)
  // 信号门限（rssiThreshold）**不在这里判定**：命中与否只比三元组，
  // 强弱一律由后端 verify_checkin 用房间门限判定（单一真源，避免前后端口径漂移）。
  // 前端只负责把扫到的最强 rssi 原样上报。
  const timeoutMs = Math.max(500, num(target.timeoutMs) || 3000)

  return new Promise((resolve) => {
    // 目标三元组非法（后端数据异常）→ 直接按未命中降级，不碰蓝牙
    if (!wantedUuid || !Number.isFinite(wantedMajor) || !Number.isFinite(wantedMinor)) {
      resolve({ scanned: false, matched: false, scanCount: 0, reason: 'error' })
      return
    }

    beaconScanning.value = true
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    /** 去重表：key = uuid|major|minor，value = 最强 rssi */
    const seen = new Map<string, { uuid: string; major: number; minor: number; rssi: number }>()
    let matchedOne: { uuid: string; major: number; minor: number; rssi: number } | null = null

    const finish = (reason?: BeaconFailReason) => {
      if (settled) return
      settled = true
      if (timer) { clearTimeout(timer); timer = null }
      // 移除监听 + 停扫描（幂等，失败也忽略）
      try { (uni as any).offBeaconUpdate?.(onUpdate) } catch { /* 老基础库可能没有 off，忽略 */ }
      try { uni.stopBeaconDiscovery({ fail: () => {} } as any) } catch { /* 未开启时 stop 会报错，忽略 */ }
      activeCancel = null
      beaconScanning.value = false

      if (matchedOne) {
        resolve({
          scanned: true,
          matched: true,
          uuid: matchedOne.uuid,
          major: matchedOne.major,
          minor: matchedOne.minor,
          rssi: matchedOne.rssi,
          scanCount: seen.size,
        })
        return
      }
      resolve({ scanned: true, matched: false, scanCount: seen.size, reason: reason || 'not_found' })
    }

    // 取消句柄暴露给外部（页面卸载时调用）
    activeCancel = () => finish('not_found')

    const onUpdate = (res: any) => {
      const beacons: any[] = Array.isArray(res?.beacons) ? res.beacons : []
      for (const b of beacons) {
        const uuid = normalizeUuid(b?.uuid)
        if (!uuid) continue
        const major = num(b?.major)
        const minor = num(b?.minor)
        const rssi = num(b?.rssi)
        if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(rssi)) continue

        const key = `${uuid}|${major}|${minor}`
        const prev = seen.get(key)
        // 同一颗取最强 rssi（-65 强于 -80）；更弱的回调不覆盖
        if (!prev || rssi > prev.rssi) {
          const rec = { uuid, major, minor, rssi }
          seen.set(key, rec)
          // 只在完全匹配目标三元组时才记得这颗（不因别的信标更强就改上报对象）
          if (uuid === wantedUuid && major === wantedMajor && minor === wantedMinor) {
            if (!matchedOne || rssi > matchedOne.rssi) matchedOne = rec
          }
        }
      }
    }

    const fail = (err: any) => {
      const msg = String(err?.errMsg || '')
      const code = err?.errCode
      let reason: BeaconFailReason = 'error'
      if (code === 10001 || msg.includes('not open') || msg.includes('未开启')) reason = 'bluetooth_off'
      else if (code === 10002 || msg.includes('auth') || msg.includes('授权') || msg.includes('deny')) reason = 'denied'
      else if (msg.includes('not support') || msg.includes('不支持')) reason = 'unsupported'
      else if (msg.includes('system capability') || msg.includes('systemType')) reason = 'unsupported'
      finish(reason)
    }

    // 1) 开适配器（幂等：已开时 success 立即回）
    uni.openBluetoothAdapter({
      success: () => {
        // 2) 注册回调（在 start 之前，避免错过首批广播）
        uni.onBeaconUpdate(onUpdate)
        // 3) 开始扫描指定 UUID（ignoreBluetoothAvailable: true 让部分机型在
        //    蓝牙开关状态未同步时不直接报错，仍能靠回调/超时兜底）
        uni.startBeaconDiscovery({
          uuids: [wantedUuid],
          ignoreBluetoothAvailable: true,
          success: () => {
            // 4) 兜底：主动拉一次，防止漏掉早期回调
            try {
              uni.getBeacons({
                success: (r: any) => onUpdate({ beacons: r?.beacons || [] }),
                fail: () => {},
              } as any)
            } catch { /* 部分基础库可能无 getBeacons，忽略 */ }
            // 5) 超时收口
            timer = setTimeout(() => finish('timeout'), timeoutMs)
          },
          fail,
        } as any)
      },
      fail,
    })
  })
}

/** 页面卸载 / 放弃打卡时调用：停掉正在进行的扫描 */
export function cancelBeaconScan() {
  if (activeCancel) {
    activeCancel()
    activeCancel = null
  }
}
