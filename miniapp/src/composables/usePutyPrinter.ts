/**
 * usePutyPrinter — 普贴（PUTY）标签机 BLE 通道 + 诊断
 * ------------------------------------------------------------------
 * 为什么不直接用官方 SDK（putysdk@0.0.6）：
 *  1) 它内部把扫描结果过滤为 `name.indexOf('PT-') != -1`
 *     （见 puty/putyBleUtils.js#onBluetoothDeviceFound）——C51DC 的广播名是
 *     `C51DC_85103001`，**根本过不了这个过滤**，官方 SDK 扫不到；
 *  2) 它依赖 `wx.*` 且硬编码 UUID，出问题时无法定位；
 *  3) 最后更新停在 2021 年，且 npm 包 main 指向不存在的 index.js。
 * 所以这里按厂家实现逐条对齐重写，但把所有中间态暴露成日志，方便真机排错。
 *
 * 厂家实测事实（putysdk putyBleUtils.js）：
 *  - 服务 UUID：49535343-FE7D-4AE5-8FA9-9FAFD205E455
 *  - 写特征  ：49535343-8841-43F4-A8D4-ECBE34729BB3
 *  - CPCL 数据固定 20 字节分包，包间 1ms
 *  - 连接成功后先 getBLEDeviceServices，再按上面的服务 UUID 取特征
 *
 * ---------------------------------------------------------------
 * 🔴 单例化（2026-10-08 重构）：
 *  此前每个页面调用 `usePutyPrinter()` 都会 new 出一套局部 `connDeviceId /
 *  serviceId / characteristicId`，页面 `onUnload` 又调 `close()` 关适配器，
 *  导致「在 A 页连上、跳到 B 页就断、B 页还得重选」的跳转混乱。
 *  现在所有连接状态提升到**模块级**，整个小程序生命周期内只有一份；
 *  任何页面调用 `usePutyPrinter()` 拿到的都是同一份连接。
 *  `init()` / `startScan()` 里的原生监听器只注册一次（guard 标志），
 *  避免多页重复注册造成日志/回调翻倍。
 *  页面**不要再在 onUnload 里调 close()** —— 连接应当持久保持，
 *  仅在「用户主动断开」或「退出登录」时才调 `disconnect()` / `close()`。
 */
import { ref } from 'vue'
import { gbkBytes } from '@/utils/cpcl'

/** 普贴透传服务（厂家硬编码，实测值） */
export const PUTY_SERVICE_UUID = '49535343-FE7D-4AE5-8FA9-9FAFD205E455'
/** 普贴写特征（厂家硬编码，实测值） */
export const PUTY_WRITE_UUID = '49535343-8841-43F4-A8D4-ECBE34729BB3'
/**
 * 普贴 notify 特征（用于回读打印状态）。
 * ⚠️ 实测修正（2026-09-22 真机）：C51DC 的 notify 是**独立特征**
 *   49535343-1E4D-4BD9-BA61-23C647249616，
 * 而写特征 49535343-8841-… 属性只有 [write,writeNR]，
 * 对它调 notifyBLECharacteristicValueChange 会报 `property not support`。
 * （厂家 SDK 全程不开 notify，故此项失败不影响打印。）
 */
export const PUTY_NOTIFY_UUID = '49535343-1E4D-4BD9-BA61-23C647249616'

/** CPCL 分包大小（厂家固定 20） */
const CPCL_CHUNK = 20

export interface BleDevice {
  deviceId: string
  name: string
  localName?: string
  RSSI?: number
  /** 广播里带的服务 UUID（部分机型有） */
  advertisServiceUUIDs?: string[]
}

export interface BleCharInfo {
  uuid: string
  read: boolean
  write: boolean
  writeNoResponse: boolean
  notify: boolean
  indicate: boolean
}

export interface BleServiceInfo {
  uuid: string
  isPrimary: boolean
  characteristics: BleCharInfo[]
}

export interface DiagOptions {
  /** 首选服务 UUID（不传则用普贴默认） */
  serviceUuid?: string
  /** 首选写特征 UUID */
  writeUuid?: string
  /** 分包大小，默认 20 */
  chunk?: number
  /** 包间延时 ms，默认 10（厂家用 1，稳妥起见略放大） */
  gapMs?: number
  /** 单包写失败是否中断，默认 false（真机上部分机型每包都回 fail 但实际写入成功） */
  strict?: boolean
}

function callUni<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    ;(uni as any)[method]({
      ...params,
      success: (res: T) => resolve(res),
      fail: (err: any) => reject(err)
    })
  })
}

/** Uint8Array → 独立 ArrayBuffer（避免 subarray 共享 buffer 的坑） */
function toAB(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.length)
  new Uint8Array(ab).set(u8)
  return ab
}

/** 时间戳 HH:MM:SS.mmm */
function ts(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/* =========================================================================
 * 模块级单例状态（整个小程序进程只有一份，跨页面共享）
 * ========================================================================= */
const adapterAvailable = ref(false)
const scanning = ref(false)
const busy = ref(false)
const connected = ref(false)
const devices = ref<BleDevice[]>([])
const services = ref<BleServiceInfo[]>([])
const logs = ref<string[]>([])
const error = ref('')
const progress = ref(0)
/** 当前连接的设备名（展示用） */
const currentName = ref('')

let connDeviceId = ''
let serviceId = ''
let characteristicId = ''

/** 原生监听器只注册一次，避免多页重复注册 */
let stateListenerRegistered = false
let foundListenerRegistered = false

/** 写日志（保留最近 300 条） */
function log(msg: string) {
  logs.value.push(`[${ts()}] ${msg}`)
  if (logs.value.length > 300) logs.value.splice(0, logs.value.length - 300)
}

function clearLogs() {
  logs.value = []
}

/** 初始化蓝牙适配器（幂等；多页调用只真正开一次） */
async function init(): Promise<boolean> {
  error.value = ''
  try {
    await callUni('openBluetoothAdapter')
    adapterAvailable.value = true
    log('蓝牙适配器已开启')
    // 连接状态变化监听：只注册一次（单例）
    if (!stateListenerRegistered) {
      uni.onBLEConnectionStateChange((res: any) => {
        if (res.deviceId === connDeviceId) {
          log(`连接状态变化：connected=${res.connected}`)
          if (!res.connected) {
            connected.value = false
            currentName.value = ''
            error.value = '打印机已断开'
          }
        }
      })
      stateListenerRegistered = true
    }
    return true
  } catch (e: any) {
    const msg = e?.errMsg || String(e)
    // 'already opened' / 'already init' / 'already started' 等：适配器其实已开，直接复用
    if (/\balready\b/i.test(msg) || msg.indexOf('init') >= 0) {
      adapterAvailable.value = true
      log('蓝牙适配器此前已开启（复用）')
      if (!stateListenerRegistered) {
        uni.onBLEConnectionStateChange((res: any) => {
          if (res.deviceId === connDeviceId) {
            log(`连接状态变化：connected=${res.connected}`)
            if (!res.connected) {
              connected.value = false
              currentName.value = ''
              error.value = '打印机已断开'
            }
          }
        })
        stateListenerRegistered = true
      }
      return true
    }
    error.value = '蓝牙初始化失败：' + msg
    log('✗ 蓝牙初始化失败：' + msg)
    return false
  }
}

/**
 * 开始扫描：**不做任何名称过滤**，列出全部 BLE 设备。
 * （官方 SDK 卡在 PT- 过滤上，这正是要绕开的地方）
 * 设备发现监听只注册一次（单例），之后复用。
 */
function startScan(onFound?: (d: BleDevice) => void) {
  if (!adapterAvailable.value) {
    log('✗ 适配器未就绪，无法扫描')
    return
  }
  devices.value = []
  scanning.value = true
  log('开始扫描（无名称过滤）…')

  if (!foundListenerRegistered) {
    uni.onBluetoothDeviceFound((res: any) => {
      const list: any[] = res.devices || []
      for (const raw of list) {
        const name = raw.name || raw.localName || ''
        if (!raw.deviceId) continue
        const dev: BleDevice = {
          deviceId: raw.deviceId,
          name,
          localName: raw.localName,
          RSSI: raw.RSSI,
          advertisServiceUUIDs: raw.advertisServiceUUIDs
        }
        const idx = devices.value.findIndex((d) => d.deviceId === dev.deviceId)
        if (idx >= 0) devices.value[idx] = { ...devices.value[idx], ...dev, name: dev.name || devices.value[idx].name }
        else {
          devices.value.push(dev)
          log(`发现设备：${name || '(无名)'} | ${dev.deviceId} | RSSI=${dev.RSSI ?? '-'}`)
        }
        onFound?.(dev)
      }
    })
    foundListenerRegistered = true
  }

  uni.startBluetoothDevicesDiscovery({
    services: [],
    allowDuplicatesKey: false,
    interval: 0,
    success: () => log('扫描已启动'),
    fail: (e: any) => {
      error.value = '扫描失败：' + (e?.errMsg || e)
      scanning.value = false
      log('✗ 扫描失败：' + (e?.errMsg || JSON.stringify(e)))
    }
  })
}

function stopScan() {
  if (scanning.value) {
    uni.stopBluetoothDevicesDiscovery({ complete: () => {} })
    scanning.value = false
    log(`停止扫描，共发现 ${devices.value.length} 台设备`)
  }
}

/**
 * 连接 + 诊断：枚举全部服务与特征，选出可用写特征。
 * 优先级：厂家指定写特征 > 厂家指定服务下的可写特征 > 任意服务的可写特征。
 */
async function connect(dev: BleDevice, opts: DiagOptions = {}): Promise<boolean> {
  if (!dev?.deviceId) return false
  // 已连接同一设备则复用：v1.5.1 真机日志里出现两次连续 createBLEConnection，
  // 第二次纯重复，会让服务枚举与日志翻倍（也掩盖真正的问题）
  if (connected.value && connDeviceId === dev.deviceId && characteristicId) {
    log(`已连接 ${dev.name || dev.deviceId}，复用现有连接`)
    return true
  }
  busy.value = true
  error.value = ''
  services.value = []
  const preferService = (opts.serviceUuid || PUTY_SERVICE_UUID).toUpperCase()
  const preferWrite = (opts.writeUuid || PUTY_WRITE_UUID).toUpperCase()

  try {
    log(`连接 ${dev.name || dev.deviceId} …`)
    await callUni('createBLEConnection', { deviceId: dev.deviceId, timeout: 10000 })
    log('✓ createBLEConnection 成功')
    // 连接后稍等再取服务，部分安卓机型需要一点时间
    await new Promise((r) => setTimeout(r, 300))

    const svcRes: any = await callUni('getBLEDeviceServices', { deviceId: dev.deviceId })
    const rawServices: any[] = svcRes.services || []
    log(`getBLEDeviceServices → ${rawServices.length} 个服务`)

    const infos: BleServiceInfo[] = []
    for (const s of rawServices) {
      const info: BleServiceInfo = {
        uuid: s.uuid,
        isPrimary: !!s.isPrimary,
        characteristics: []
      }
      try {
        const chRes: any = await callUni('getBLEDeviceCharacteristics', {
          deviceId: dev.deviceId,
          serviceId: s.uuid
        })
        for (const c of chRes.characteristics || []) {
          const p = c.properties || {}
          info.characteristics.push({
            uuid: c.uuid,
            read: !!p.read,
            write: !!p.write,
            writeNoResponse: !!p.writeNoResponse,
            notify: !!p.notify,
            indicate: !!p.indicate
          })
        }
      } catch (e: any) {
        log(`  ✗ 服务 ${s.uuid} 取特征失败：${e?.errMsg || e}`)
      }
      infos.push(info)
      const writable = info.characteristics.filter((c) => c.write || c.writeNoResponse)
      log(
        `  服务 ${s.uuid}${s.uuid.toUpperCase() === preferService ? ' ★(普贴透传)' : ''} → ` +
          `${info.characteristics.length} 特征，可写 ${writable.length}`
      )
      for (const c of info.characteristics) {
        const flags = [
          c.read ? 'read' : '',
          c.write ? 'write' : '',
          c.writeNoResponse ? 'writeNR' : '',
          c.notify ? 'notify' : '',
          c.indicate ? 'indicate' : ''
        ]
          .filter(Boolean)
          .join(',')
        log(`      ${c.uuid} [${flags}]`)
      }
    }
    services.value = infos

    // 选写特征
    let picked: { svc: string; chr: string } | null = null
    const psvc = infos.find((s) => s.uuid.toUpperCase() === preferService)
    if (psvc) {
      const exact = psvc.characteristics.find((c) => c.uuid.toUpperCase() === preferWrite)
      if (exact) {
        picked = { svc: psvc.uuid, chr: exact.uuid }
        log(`✓ 命中厂家写特征：${exact.uuid}`)
      } else {
        const w = psvc.characteristics.find((c) => c.write) || psvc.characteristics.find((c) => c.writeNoResponse)
        if (w) {
          picked = { svc: psvc.uuid, chr: w.uuid }
          log(`△ 普贴服务下未找到 ${preferWrite}，改用可写特征：${w.uuid}`)
        }
      }
    }
    if (!picked) {
      for (const s of infos) {
        const w = s.characteristics.find((c) => c.write) || s.characteristics.find((c) => c.writeNoResponse)
        if (w) {
          picked = { svc: s.uuid, chr: w.uuid }
          log(`△ 未命中普贴透传服务，回退到 ${s.uuid} / ${w.uuid}`)
          break
        }
      }
    }
    if (!picked) throw new Error('所有服务都没有可写特征（该设备可能不是打印模块）')

    serviceId = picked.svc
    characteristicId = picked.chr
    connDeviceId = dev.deviceId
    currentName.value = dev.name || dev.deviceId
    connected.value = true
    stopScan()
    log(`✓ 已就绪：service=${serviceId} write=${characteristicId}`)

    // 开启 notify（回读打印状态）——必须用**带 notify 属性**的特征。
    // 用写特征开 notify 会得到 property not support（v1.5.1 日志即此）。
    // 厂家 SDK 全程不开 notify，故这里失败一律不影响打印。
    const pickedSvc = infos.find((s) => s.uuid === picked.svc)
    const notifyChar =
      pickedSvc?.characteristics.find((c) => c.uuid.toUpperCase() === PUTY_NOTIFY_UUID) ||
      pickedSvc?.characteristics.find((c) => c.notify)
    if (notifyChar) {
      try {
        await callUni('notifyBLECharacteristicValueChange', {
          deviceId: connDeviceId,
          serviceId: picked.svc,
          characteristicId: notifyChar.uuid,
          state: true
        })
        log(`✓ 通知已开启：${notifyChar.uuid}`)
      } catch (e: any) {
        log('通知开启失败（不影响打印）：' + (e?.errMsg || e))
      }
    } else {
      log('该服务下无 notify 特征，跳过状态回读（不影响打印）')
    }

    return true
  } catch (e: any) {
    const msg = e?.errMsg || e?.message || JSON.stringify(e)
    error.value = '连接失败：' + msg
    log('✗ 连接失败：' + msg)
    connected.value = false
    return false
  } finally {
    busy.value = false
  }
}

/**
 * 写入字节流（分包，顺序发送）。
 * 返回 { sent, failed }，便于判断「真失败」还是「每包都回 fail 但其实打出来了」。
 */
async function writeBytes(bytes: Uint8Array, opts: DiagOptions = {}): Promise<{ sent: number; failed: number }> {
  if (!connected.value || !connDeviceId || !serviceId || !characteristicId) {
    throw new Error('打印机未连接')
  }
  const chunk = Math.max(1, opts.chunk ?? CPCL_CHUNK)
  const gapMs = opts.gapMs ?? 10
  const total = Math.ceil(bytes.length / chunk)
  let sent = 0
  let failed = 0
  progress.value = 0
  log(`开始发送 ${bytes.length} 字节 / ${total} 包（每包 ${chunk}B，间隔 ${gapMs}ms）`)

  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    try {
      await callUni('writeBLECharacteristicValue', {
        deviceId: connDeviceId,
        serviceId,
        characteristicId,
        value: toAB(part)
      })
      sent++
    } catch (e: any) {
      failed++
      const idx = Math.floor(i / chunk) + 1
      log(`  ✗ 第 ${idx}/${total} 包写入失败：${e?.errMsg || e}`)
      if (opts.strict) throw new Error(`第 ${idx} 包写入失败：${e?.errMsg || e}`)
    }
    progress.value = Math.round(((i + chunk) / bytes.length) * 100)
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs))
  }
  progress.value = 100
  log(`发送结束：成功 ${sent} 包，失败 ${failed} 包`)
  return { sent, failed }
}

/** 打 CPCL 指令（传入 CpclBuilder.build() 的结果） */
async function printCpcl(bytes: Uint8Array, opts: DiagOptions = {}) {
  return writeBytes(bytes, opts)
}

/** 打印纯 ASCII 文本（绕过 GBK，最小验证） */
async function printAscii(text: string, opts: DiagOptions = {}) {
  const line = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) line[i] = text.charCodeAt(i) & 0xff
  return writeBytes(line, opts)
}

/**
 * 手动切换写通道（真机排错用）。
 * 同一台机可能暴露多条可写通道（普贴透传 / 标准打印服务 / 通用透传），
 * 若默认通道不出纸，可直接换通道重试，无需重新连接。
 */
function switchChannel(serviceUuid: string, charUuid: string): boolean {
  const su = String(serviceUuid || '').toUpperCase()
  const cu = String(charUuid || '').toUpperCase()
  const s = services.value.find((x) => x.uuid.toUpperCase() === su)
  if (!s) {
    log(`✗ 未找到服务 ${serviceUuid}`)
    return false
  }
  const c = s.characteristics.find((x) => x.uuid.toUpperCase() === cu)
  if (!c) {
    log(`✗ ${serviceUuid} 下未找到特征 ${charUuid}`)
    return false
  }
  if (!c.write && !c.writeNoResponse) {
    log(`✗ 特征 ${charUuid} 不可写，不能作为写通道`)
    return false
  }
  serviceId = s.uuid
  characteristicId = c.uuid
  log(`✓ 写通道已切换：service=${serviceId} write=${characteristicId}`)
  return true
}

/** 断开当前设备（用户主动断开时调用；不关适配器，可随时重连） */
async function disconnect() {
  if (connDeviceId) {
    try {
      await callUni('closeBLEConnection', { deviceId: connDeviceId })
      log('已断开连接')
    } catch (e: any) {
      log('断连异常（忽略）：' + (e?.errMsg || e))
    }
  }
  connected.value = false
  connDeviceId = ''
  serviceId = ''
  characteristicId = ''
  currentName.value = ''
}

/** 关闭适配器（退出登录等需要彻底释放时调用，页面卸载**不要**调） */
async function close() {
  await disconnect()
  try {
    await callUni('closeBluetoothAdapter')
    log('蓝牙适配器已关闭')
  } catch {
    /* ignore */
  }
  adapterAvailable.value = false
}

/**
 * 单例 composable：返回模块级共享状态 + 动作。
 * 任何页面调用都拿到同一份连接，实现「匹配一次、全局持久」。
 */
export function usePutyPrinter() {
  return {
    // 状态
    adapterAvailable,
    scanning,
    busy,
    connected,
    devices,
    services,
    logs,
    error,
    progress,
    currentName,
    // 动作
    init,
    startScan,
    stopScan,
    connect,
    switchChannel,
    writeBytes,
    printCpcl,
    printAscii,
    disconnect,
    close,
    log,
    clearLogs,
    gbkBytes
  }
}
