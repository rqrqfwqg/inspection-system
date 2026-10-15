/**
 * useScanner — 小程序扫码封装（重写）
 *
 * 自 mobile-frontend/src/composables/useScanner.ts 重写：
 * - html5-qrcode（浏览器摄像头）不可用于小程序 → uni.scanCode 原生扫码
 * - 扫码类型：条形码 + 二维码（scanType: ['barCode', 'qrCode']）
 * - 取消/失败 → uni.showModal editable 手动输入兜底
 * - 不支持 torch/弱光增强（useBrightness.ts 不迁移，设计文档 §1.2）
 *
 * 导出 scan(): Promise<{ code, source: 'camera' | 'manual' | 'album' } | null>
 * source 标识来源：camera=原生扫码，album=相册照片本地解码，manual=手动输入兜底
 */
import { ref } from 'vue'
import { showInputModal, showToast } from '@/utils/feedback'

export interface ScanResult {
  code: string
  /** 来源：camera=原生扫码，album=相册照片本地解码，manual=手动输入 */
  source: 'camera' | 'manual' | 'album'
}

export interface ScannerOptions {
  /** 扫码类型（默认条形码 + 二维码） */
  scanType?: Array<'barCode' | 'qrCode' | 'datamatrix' | 'pdf417'>
  /** 是否启用手动输入兜底（默认 true） */
  needManualFallback?: boolean
  /** 手动输入弹窗标题（默认 '扫码'） */
  title?: string
  /** 手动输入弹窗正文（默认工器具语境「未识别到条码，请手动输入编码」） */
  manualContent?: string
  /** 手动输入弹窗占位符（默认工器具语境「请输入工具/物料编码」） */
  manualPlaceholder?: string
}

/** 微信扫码返回结构（multiple 模式下含 scanResults 数组） */
interface ScanCodeResult {
  result?: string
  scanResults?: Array<{ result?: string }>
}

/** 包装 uni.scanCode 为 Promise（不依赖类型重载，兼容各版本 @dcloudio/types）
 *  multiple: true 一次可识别多个码（真机生效，模拟器可能只返回单个 result） */
function scanCode(options: { scanType: string[]; multiple: boolean }): Promise<ScanCodeResult> {
  return new Promise((resolve, reject) => {
    uni.scanCode({
      scanType: options.scanType as any,
      multiple: options.multiple,
      success: (res: any) =>
        resolve({ result: res.result || '', scanResults: res.scanResults || undefined }),
      fail: (err) => reject(err)
    })
  })
}

export function useScanner(options: ScannerOptions = {}) {
  const {
    scanType = ['barCode', 'qrCode'],
    needManualFallback = true,
    title = '扫码',
    // 默认文案保持工器具语境不变，保证既有调用方行为零变化
    manualContent = '未识别到条码，请手动输入编码',
    manualPlaceholder = '请输入工具/物料编码'
  } = options

  const scanning = ref(false)
  const error = ref('')
  const lastCode = ref('')
  /** 小程序原生扫码始终可用（与 H5 摄像头权限场景不同，保留字段兼容页面） */
  const cameraSupported = ref(true)

  /** 手动输入兜底：弹出可编辑 modal，返回输入编码 */
  async function manualFallback(): Promise<ScanResult | null> {
    // ⚠️ content 仅作「无 placeholder 时的兜底占位」，
    //    showInputModal 不会把它送进输入框（微信 editable 下 content = 输入框初值，会导致用户必须先删除才能输入）
    const res = await showInputModal({
      title,
      content: manualContent,
      placeholderText: manualPlaceholder
    })
    if (res.confirm) {
      const code = (res.content || '').trim()
      if (!code) {
        showToast('编码不能为空', 'none')
        return null
      }
      lastCode.value = code
      return { code, source: 'manual' }
    }
    return null
  }

  /**
   * 执行一次扫码（支持一次识别多个码 → 多选一）
   * @returns Promise<ScanResult | null>：扫码/手动输入成功返回结果；用户取消返回 null
   */
  async function scan(): Promise<ScanResult | null> {
    scanning.value = true
    error.value = ''
    try {
      const res = await scanCode({ scanType, multiple: true })
      scanning.value = false
      // 兼容两种返回：multiple 真机返回 scanResults 数组；单码/模拟器返回 result
      const results = Array.isArray(res.scanResults) && res.scanResults.length
        ? res.scanResults
        : res.result
          ? [{ result: res.result }]
          : []
      const codes = results
        .map((r) => (r.result || '').trim())
        .filter(Boolean)
      if (!codes.length) {
        return needManualFallback ? manualFallback() : null
      }
      // 识别到多个码 → 弹出选择让用户挑一个（多选一）
      const picked = codes.length === 1 ? codes[0] : await pickOne(codes)
      if (!picked) return null
      lastCode.value = picked
      return { code: picked, source: 'camera' }
    } catch (err: any) {
      scanning.value = false
      error.value = err?.errMsg || String(err)
      // 用户取消（cancel）或扫码失败 → 手动输入兜底
      if (needManualFallback) {
        return manualFallback()
      }
      return null
    }
  }

  /** 多个码时弹出选择器（多选一）；showActionSheet 最多展示 6 项 */
  function pickOne(codes: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const list = codes.slice(0, 6)
      uni.showActionSheet({
        alertText: codes.length > 6 ? `识别到 ${codes.length} 个码，请选择（仅显示前 6 个）` : `识别到 ${codes.length} 个码，请选择`,
        itemList: list,
        success: (r: any) => resolve(list[r.tapIndex] ?? null),
        fail: () => resolve(null)
      })
    })
  }

  /** 兼容旧接口形态（startScanning 等价于 scan） */
  function startScanning(): Promise<ScanResult | null> {
    return scan()
  }

  /** 停止扫码（原生扫码为一次性调用，无持续会话；置位扫描态即可） */
  async function stopScanning(): Promise<void> {
    scanning.value = false
  }

  /** 手动输入编码（页面直接调用入口） */
  function manualInput(code: string): ScanResult | null {
    const c = (code || '').trim()
    if (!c) return null
    lastCode.value = c
    return { code: c, source: 'manual' }
  }

  return {
    scanning,
    error,
    lastCode,
    cameraSupported,
    scan,
    startScanning,
    stopScanning,
    manualInput,
    manualFallback
  }
}
