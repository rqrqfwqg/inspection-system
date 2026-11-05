/**
 * labelNameBitmap — 把「设备名（中文）」渲染成 CPCL `EG` 单色点阵。
 * ------------------------------------------------------------------
 * ## 为什么必须走位图（2026-10-13 定论，不是保守选择）
 * 2026-09-30 多轮真机验证：目标机 C51DC 的 `TEXT` 指令在 `font 0/7/16/20/24/55`
 * **全部无法正常渲染 GBK 中文**（同一张纸上 ASCII 完全正常）——即该机没有可用汉字库。
 * 厂家 SDK 的正规中文方案就是 `EG` 位图（见 `putysdk/puty/putyCpclUtils.js#image()`），
 * 所以标签上的中文只能由手机端渲染成点阵再下发。
 *
 * ## 为什么不用现成图片文件
 * 设备名是**任意中文**（如「其他安全专用设备-门禁系统」），无法预置图片，
 * 只能运行时用 canvas 按字画点阵。
 *
 * ## 点阵格式（与厂家 SDK 逐字对齐）
 * - 行优先、每行 `widthDots / 8` 字节、**MSB 在左**、`1` = 打黑；
 * - 宽度必须是 8 的倍数（CPCL `EG` 的宽度单位是字节）；
 * - 二值化：白底黑字，像素亮度 < `INK_THRESHOLD` 判为墨点。
 *
 * ## 平台能力依据
 * `wx.createOffscreenCanvas({type:'2d'})` 基础库 **2.16.1** 起支持，官方示例即包含
 * `ctx.getImageData()`；低版本返回 null（调用方留白并提示，不静默）。
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/api/canvas/wx.createOffscreenCanvas.html
 */
import type { LabelBitmap } from './cpcl'

// 小程序全局 wx（仅 mp-weixin 构建使用；其它端由 typeof 守卫跳过）
declare const wx: any

/**
 * 二值化阈值（0-255，取 RGB 均值）。
 * 取 150（比纯中点 128 偏高）= 灰边也判成墨，热敏打印后笔画更实；
 * 取 180（厂家 SDK 的判定线）在 24 点小字上会把细笔画吃掉，故不用。
 */
const INK_THRESHOLD = 150

/** 字号收缩下限（相对行高）：再小就糊成一团，宁可截断 */
const MIN_FONT_RATIO = 0.6

/** 复用的离屏 canvas（同一批标签尺寸固定，反复 create 会拖慢批量打印） */
let cachedCanvas: any = null
let cachedKey = ''

function getCanvas(width: number, height: number): any {
  const key = `${width}x${height}`
  if (cachedCanvas && cachedKey === key) return cachedCanvas
  if (typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') return null
  try {
    const c = wx.createOffscreenCanvas({ type: '2d', width, height })
    if (!c || typeof c.getContext !== 'function') return null
    cachedCanvas = c
    cachedKey = key
    return c
  } catch {
    return null
  }
}

/**
 * 文本 → `LabelBitmap`。渲染失败（低版本基础库 / canvas 异常）返回 `null`，
 * **由调用方决定留白还是提示**——本函数不抛错，避免一张标签失败中断整批打印。
 *
 * @param text      设备名（中文）
 * @param widthDots 可用宽度（点，8 的倍数；由 `measureDualCodeLabel().nameMaxWidthDots` 给出）
 * @param heightDots 行高（点；由 `measureDualCodeLabel().nameDots` 给出）
 */
export function renderNameBitmap(
  text: string,
  widthDots: number,
  heightDots: number,
): LabelBitmap | null {
  const content = (text || '').replace(/[\r\n]+/g, ' ').trim()
  if (!content) return null

  // 宽度对齐到 8 的倍数（EG 宽度单位是字节）
  const w = Math.max(8, Math.floor(widthDots / 8) * 8)
  const h = Math.max(8, Math.round(heightDots))

  const canvas = getCanvas(w, h)
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof ctx.getImageData !== 'function') return null

  try {
    // 白底：保证未画到的地方是「纸」（位图 0 = 不打黑）
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#000000'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'

    // 字号自适应：先按行高定字号，装不下逐步缩，缩到下限还装不下才截断
    let fontSize = h
    const minFont = Math.max(9, Math.round(h * MIN_FONT_RATIO))
    const setFont = (px: number) => {
      // 不用 bold：24 点小字加粗会糊笔画（实测阈值下的经验取舍）
      ctx.font = `${px}px sans-serif`
    }
    setFont(fontSize)
    while (ctx.measureText(content).width > w && fontSize > minFont) {
      fontSize -= 1
      setFont(fontSize)
    }

    // 仍超宽 → 按可用宽度截断并加省略号（不是写死字符数，是按实测字宽算）
    let shown = content
    if (ctx.measureText(shown).width > w) {
      const ell = '…'
      while (shown.length > 1 && ctx.measureText(shown + ell).width > w) {
        shown = shown.slice(0, -1)
      }
      shown = shown + ell
    }

    ctx.fillText(shown, 0, Math.round(h / 2))

    const img = ctx.getImageData(0, 0, w, h)
    const px = img.data
    const stride = w / 8
    const bytes = new Uint8Array(stride * h)
    let lastInkCol = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        // 白底黑字：取 RGB 均值判墨（alpha 恒为 255，不参与判定）
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3
        if (lum < INK_THRESHOLD) {
          bytes[y * stride + (x >> 3)] |= 0x80 >> (x & 7)
          if (x > lastInkCol) lastInkCol = x
        }
      }
    }

    // 裁掉右侧整列为空的区域（名字短时省一半以上蓝牙包），仍对齐 8 点
    if (lastInkCol < 0) return null
    const usedW = Math.max(8, Math.ceil((lastInkCol + 1) / 8) * 8)
    const usedStride = usedW / 8
    let hex = ''
    for (let y = 0; y < h; y++) {
      for (let b = 0; b < usedStride; b++) {
        hex += bytes[y * stride + b].toString(16).padStart(2, '0').toUpperCase()
      }
    }

    return { widthDots: usedW, heightDots: h, hex }
  } catch {
    return null
  }
}
