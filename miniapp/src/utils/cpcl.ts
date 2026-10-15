/**
 * CPCL 标签指令构造（普贴 PUTY C51DC 等标签机）
 * ------------------------------------------------------------------
 * 依据：普贴官方小程序 SDK `putysdk@0.0.6` 内 `puty/putyCpclUtils.js` 的
 * 实机写法逐条对齐（见 C:/tmp/putysdk_pkg）。以下是厂家确认的事实：
 *
 *  - 起始指令：`! <offset*8> 200 200 <height*8> <page>` + `PAGE-WIDTH <width*8>`
 *    200 200 = 分辨率(dpi)，与 203dpi 机型兼容。
 *  - 坐标单位 = 毫米，下发前 ×8（200dpi 下 1mm = 8 点）。
 *  - 文本：`TEXT <font> <size> <x> <y> <content>`
 *    font: 24 → 字符 12×24 / 汉字 24×24；55 → 字符 8×16 / 汉字 16×16
 *    size: 个位 = 纵向放大倍数，十位 = 横向放大倍数（0=不放大，22=2×2，33=3×3）
 *  - 二维码：`BARCODE QR <x> <y> M <model> U <unit>` + `<rank>A,<content>` + `ENDQR`
 *  - 走纸到下一标签间隙：`FORM`；真正出纸：`PRINT`
 *  - 整串以 GBK 编码下发（ASCII 兼容，中文必须走码表）
 *
 * 关键约束：BLE 分包固定 20 字节（厂家 printCpcl 即按 20 分包），
 * 发送由 composables/usePutyPrinter.ts 负责，本文件只产出字节流。
 */
import GBK from './gbk.min.js'

/** 200dpi 下 1 毫米 = 8 点 */
export const DOT_PER_MM = 8

/** 毫米 → 点 */
function mm(v: number): number {
  return Math.round(v * DOT_PER_MM)
}

/** 字符串 → GBK 字节 */
export function gbkBytes(text: string): Uint8Array {
  return new Uint8Array(GBK.encode(text))
}

/** 字体：24 = 汉字 24×24 / 字符 12×24；55 = 汉字 16×16 / 字符 8×16 */
export type CpclFont = 24 | 55

/** 对齐方式 */
export type CpclAlign = 'left' | 'center' | 'right'

/**
 * CPCL 快速构建器（链式，与厂家 API 同构便于对照排错）
 * 坐标一律传毫米，内部自动 ×8。
 */
export class CpclBuilder {
  private buf = ''

  /** 起始：offset 水平偏移(mm)、width 纸宽(mm)、height 标签高(mm)、copies 份数 */
  init(opts: { offsetMm?: number; widthMm: number; heightMm: number; copies?: number }): this {
    const offset = mm(opts.offsetMm ?? 0)
    const width = mm(opts.widthMm)
    const height = mm(opts.heightMm)
    const copies = opts.copies && opts.copies > 0 ? Math.min(1024, Math.floor(opts.copies)) : 1
    this.buf += `! ${offset} 200 200 ${height} ${copies}\r\n`
    this.buf += `PAGE-WIDTH ${width}\r\n`
    return this
  }

  /** 对齐（影响后续 TEXT 与条码；x 传 0 时按此对齐定位） */
  align(a: CpclAlign): this {
    this.buf += a === 'center' ? 'CENTER\r\n' : a === 'right' ? 'RIGHT\r\n' : 'LEFT\r\n'
    return this
  }

  /**
   * 文本
   * @param font  字体（24 或 55）
   * @param size  放大：0 原始 / 22 横向2倍纵向2倍 / 33 3倍
   * @param xMm,yMm 坐标（毫米）
   */
  text(font: CpclFont, size: number, xMm: number, yMm: number, content: string): this {
    this.buf += `TEXT ${font} ${size} ${mm(xMm)} ${mm(yMm)} ${content}\r\n`
    return this
  }

  /** 加粗开关（对后续文本生效） */
  bold(on: boolean): this {
    this.buf += `SETBOLD ${on ? 1 : 0}\r\n`
    return this
  }

  /**
   * 二维码
   * @param xMm,yMm  坐标（毫米）
   * @param model    QR 模式 1/2，默认 2
   * @param unit     放大倍数 1..6，默认 6
   * @param rank     纠错等级 L/M/Q/H，默认 M
   */
  qrcode(
    xMm: number,
    yMm: number,
    content: string,
    opts: { model?: 1 | 2; unit?: number; rank?: 'L' | 'M' | 'Q' | 'H' } = {}
  ): this {
    const model = opts.model ?? 2
    const unit = Math.min(6, Math.max(1, opts.unit ?? 6))
    const rank = opts.rank ?? 'M'
    this.buf += `BARCODE QR ${mm(xMm)} ${mm(yMm)} M ${model} U ${unit}\r\n`
    this.buf += `${rank}A,${content}\r\n`
    this.buf += 'ENDQR\r\n'
    return this
  }

  /** 走纸到下一个标签间隙（间隙纸必设） */
  form(): this {
    this.buf += 'FORM\r\n'
    return this
  }

  /** 出纸打印 */
  print(): this {
    this.buf += 'PRINT\r\n'
    return this
  }

  /** 原始指令（排错用：插入任意 CPCL 行） */
  raw(line: string): this {
    this.buf += line + '\r\n'
    return this
  }

  /** 当前累积的指令文本（调试展示用） */
  text2(): string {
    return this.buf
  }

  /** 产出 GBK 编码字节流 */
  build(): Uint8Array {
    return gbkBytes(this.buf)
  }
}

/** 测试标签参数 */
export interface CpclTestLabelSpec {
  widthMm?: number
  heightMm?: number
  title?: string
  name?: string
  code?: string
  qrContent?: string
  qrUnit?: number
  copies?: number
}

/** 标签纸默认尺寸（mm）：C51DC 为 52mm 纸宽，安全打印宽取 48 */
export const DEFAULT_LABEL = { widthMm: 48, heightMm: 30 }

/**
 * 50×15mm 横向标签预设（设备标签现场默认用纸）。
 * 纸宽 50mm 略超 C51DC 的 52mm 极限内的安全区，故安全打印宽取 48mm、高 15mm。
 */
export const LABEL_50X15 = { widthMm: 48, heightMm: 15 }

/**
 * 按纸高反推可用的二维码放大倍数（unit）。
 *
 * 根因备忘（2026-09-30 真机照片）：15mm 高的纸上若沿用 30mm 版式，
 * 二维码（33 模块 × unit4 = 16.5mm）会**超出纸高被裁切**，打印机会翻到
 * 下一张继续打后半截 → 现场表现为「内容重复、大小不一、跨页」。
 * 故此处按可用高度（纸高 - 上下留白）反推 unit，保证二维码完整装下。
 *
 * @param qrContent 二维码内容（长度决定版本 → 模块数）
 * @param maxMm     二维码可用高度（mm），默认按 15mm 纸取 13
 */
export function fitQrUnit(qrContent: string, maxMm = 13): number {
  const len = (qrContent || '').length
  const ver = len <= 26 ? 2 : len <= 42 ? 3 : len <= 62 ? 4 : len <= 84 ? 5 : 6
  const modules = 21 + (ver - 1) * 4
  const maxUnit = Math.floor((maxMm * DOT_PER_MM) / modules)
  return Math.min(6, Math.max(2, maxUnit)) // unit 上限 6；下限 2 保证可扫
}

/**
 * 极简测试标签：只打一行 ASCII + 二维码，验证「链路 + 指令集」。
 * 版式最小化，跨纸概率最低，适合第一次真机试打。
 */
export function buildMinimalLabel(spec: CpclTestLabelSpec = {}): Uint8Array {
  const widthMm = spec.widthMm ?? DEFAULT_LABEL.widthMm
  const heightMm = spec.heightMm ?? DEFAULT_LABEL.heightMm
  const code = spec.code || 'GTC-TEST-001'
  const qrContent = spec.qrContent || 'GTC-TEST-001'
  const qrUnit = spec.qrUnit ?? 6
  // 版本1 二维码 = 21 模块；宽度 = 模块数 × 放大倍数，手工居中
  const qrDots = 21 * qrUnit
  const qrX = Math.max(0, Math.round((mm(widthMm) - qrDots) / 2))

  return new CpclBuilder()
    .init({ widthMm, heightMm, copies: spec.copies ?? 1 })
    .align('left')
    .text(24, 22, 2, 2, code)
    .qrcode(qrX / DOT_PER_MM, 12, qrContent, { unit: qrUnit, rank: 'M' })
    .form()
    .print()
    .build()
}

/**
 * 文字指令对照标签（真机排错专用）——一次打 2 张，区分「字体写法」与「位置」两种根因。
 *
 * 背景：v1.5.1 真机实测 C51DC 上**二维码正常、文字完全不出**。二维码走
 * `BARCODE QR`（标准指令），文字走 `TEXT`，说明页头 / FORM / PRINT / BLE 全通，
 * 问题只可能在 TEXT 的参数写法上（或文字被顶部留白裁掉）。
 *
 * 第 1 张把两个变量交叉开：font 0 与 font 24 交替，y 自上而下递增。
 * 第 2 张只测写法变体（font 7 / 55、size 1 / 22），y 一律避开顶部。
 *
 * 判读（把实际出现的行告诉我即可定稿模板）：
 *   只出 A0Y8 / C0Y88 / E0Y168  → font 24 这套写法无效，改用标准字体号
 *   只有靠下的行出              → 文字被顶部留白裁掉，整体下移即可
 *   6 行全出                    → 两种写法都有效，原失败另有原因，需再查
 *   6 行全不出且第 2 张也不出    → 根因在 TEXT 之外，走备选通道验证
 */
export function buildTextProbeLabels(widthMm = DEFAULT_LABEL.widthMm, heightMm = DEFAULT_LABEL.heightMm): Uint8Array {
  const w = mm(widthMm)
  const h = mm(heightMm)
  const b = new CpclBuilder()

  // —— 第 1 张：位置 × 字体 交叉（font 0 与 24 交替，y 自上而下递增）——
  //  判读：只出 A0/C0/E0 → font 24 写法无效；只有靠下的出 → 顶部留白/裁切；
  //        全出 → 两种写法都有效（则原失败另有原因）；全不出 → 另有根因。
  b.raw(`! 0 200 200 ${h} 1`).raw(`PAGE-WIDTH ${w}`)
  b.raw(`TEXT 0 0 8 8 A0Y8`)
  b.raw(`TEXT 24 0 8 48 B24Y48`)
  b.raw(`TEXT 0 0 8 88 C0Y88`)
  b.raw(`TEXT 24 0 8 128 D24Y128`)
  b.raw(`TEXT 0 0 8 168 E0Y168`)
  b.raw(`TEXT 24 0 8 208 F24Y208`)
  b.form().print()

  // —— 第 2 张：其他写法变体（y 一律避开顶部，排除位置干扰）——
  b.raw(`! 0 200 200 ${h} 1`).raw(`PAGE-WIDTH ${w}`)
  b.raw(`TEXT 7 0 8 40 F7S0`)
  b.raw(`TEXT 55 0 8 90 F55S0`)
  b.raw(`TEXT 24 1 8 140 F24S1`)
  b.raw(`TEXT 24 22 8 180 F24S22`)
  b.form().print()

  return b.build()
}

/**
 * 中文渲染专项对照标签（真机排错专用，2026-09-30 新增）。
 *
 * 背景：多轮真机反馈「中文仍是乱码」，但**同一张标签上的 ASCII（设备编码、机身编号）
 * 完全正常**，说明：BOM / BLE 分包 / FORM / PRINT / 纸张尺寸 / GBK 码表 全部正确，
 * 问题被收敛到 **TEXT 的 font 参数是否触发汉字字库** 这一点上。
 *
 * 本函数在**同一条 50×15 纸**上并排打印同一个中文词，仅 font 号不同，
 * 一次实打即可定论：哪一行中文正常，生产模板就用哪个 font 号。
 *
 * 判读表（把「哪几行正常」告诉我即可定稿）：
 *   - 只有 F24 行正常            → 维持现状，乱码另有原因（需再查）
 *   - 只有 F0 / F7 行正常        → 切到该字体号（数据量不变，最优解）
 *   - 全部乱码                   → 该机无内置汉字库，改走位图方案（见 buildDeviceLabelBitmap）
 *   - 全部正常                   → 上一版乱码是偶发/内容问题，需复核真实数据
 *
 * ⚠️ 每行只放 2 个汉字（`潜水`），确保在 15mm 纸高 / 20 字节分包下不会因
 * 内容过长触发行截断，避免把「字体问题」和「长度问题」混在一起。
 */
export function buildChineseFontProbe(): Uint8Array {
  const widthMm = LABEL_50X15.widthMm
  const heightMm = LABEL_50X15.heightMm
  const b = new CpclBuilder().init({ widthMm, heightMm, copies: 1 })

  // 候选字体号：0（标准内建）、7（小型内建）、24（厂家文档标注汉字 24×24）、
  // 55（厂家文档标注汉字 16×16）、16、20（CPCL 常见汉字字库号）
  const fonts = [0, 7, 16, 20, 24, 55]
  const word = '潜水' // 2 汉字 = 4 字节 GBK，足够判读且不超行

  // 6 行在 120 点高度内均分：每行 20 点，字高 3mm=24 点会略挤，故用 size 0 靠上下压缩
  fonts.forEach((f, i) => {
    const y = 1.5 + i * 2.1
    b.raw(`TEXT ${f} 0 ${mm(1)} ${mm(y)} F${f}:${word}`)
  })

  b.form().print()
  return b.build()
}

/**
 * 完整版式测试标签：中文标题 + 编号 + 二维码（上线标签的雏形）。
 * 用于验证 GBK 中文渲染与整体版式。
 *
 * 版式（默认 48×30mm，坐标单位 mm）：
 *   y 1.5  标题      font 55 (汉字 16×16) 居中
 *   y 5.5  编号      font 24 size 22 (2×2 → 48×48 点) 居中
 *   y 12.5 二维码    U=5 → 21×5=105 点 ≈ 13.1mm 居中
 * 二维码内容用 ASCII 短串时模块数为 21，可精确算居中；内容变长会升版本，届时改 qrUnit。
 */
export function buildTestLabel(spec: CpclTestLabelSpec = {}): Uint8Array {
  const widthMm = spec.widthMm ?? DEFAULT_LABEL.widthMm
  const heightMm = spec.heightMm ?? DEFAULT_LABEL.heightMm
  const title = spec.title || '设备标签'
  const code = spec.code || 'GTC-A-0012'
  const qrContent = spec.qrContent || code
  const qrUnit = spec.qrUnit ?? 5
  const qrDots = 21 * qrUnit
  const qrX = Math.max(0, Math.round((mm(widthMm) - qrDots) / 2))

  return new CpclBuilder()
    .init({ widthMm, heightMm, copies: spec.copies ?? 1 })
    .align('center')
    .text(55, 0, 0, 1.5, title)
    .text(24, 22, 0, 5.5, code)
    .align('left')
    .qrcode(qrX / DOT_PER_MM, 12.5, qrContent, { unit: qrUnit, rank: 'M' })
    .form()
    .print()
    .build()
}

/**
 * 设备二维码标签（生产模板）——「批量打印设备二维码」半环的核心产出。
 *
 * 内容：① 中文名（可选，顶部）② 设备编号（放大，中间）③ 二维码（底部居中）。
 * 二维码内容默认 `https://www.xmgl-123.cn/ops/qr/<encodeURIComponent(编号)>`，
 * 与 Web 端设备二维码打印、小程序扫码解析（parseScanPayload）三端同源，
 * 现场扫标签即能直达设备属性页 / 触发定位绑定。
 *
 * 版式（默认 48×30mm，坐标单位 mm，自动避让重叠）：
 *   - 二维码按内容长度估算版本（字节 / M 纠错）反推模块数，水平居中、底部留 1mm；
 *   - 编号放在二维码正上方，名称放在顶部；超长编号会自动压缩二维码放大倍数以避让。
 *   - C51DC 对 TEXT 字体写法敏感，故 name 字体可切 24 / 55（默认 24）。
 *
 * @param qrUnit 二维码放大倍数 1..6，默认 4（在 48mm 宽标签上约 14~16mm，清晰可扫且留出避让空间）
 */
export interface DeviceLabelSpec {
  code: string
  /** 设备中文名（可选；留空则只打编号 + 二维码） */
  name?: string
  /**
   * 机身编号（铭牌编号，可选）。
   * 由 `deviceLabel.ts#extractSerialNo(brand_model)` 抽取，与后端规则镜像。
   * 留空则标签自动省略该行（不占高度）。
   */
  serial?: string
  /** 二维码内容；默认 `…/ops/qr/<编号>` */
  qrContent?: string
  widthMm?: number
  heightMm?: number
  /** 二维码放大倍数；**留空则按纸高自动反推**（推荐），显式传值则被纸高上限夹紧 */
  qrUnit?: number
  /** 名称字体：24（汉字 24×24）/ 55（汉字 16×16），默认 24 */
  font?: CpclFont
  /** 版式：'landscape'=50×15 横向（左码右文，现场默认）；'portrait'=旧竖版（兼容） */
  layout?: 'landscape' | 'portrait'
}

/**
 * 设备二维码标签（生产模板）。
 *
 * ## 版式 A：landscape 横向（50×15，现场默认）
 * 纸 48×15mm 可用区，二维码在**左侧**垂直居中，文字在右侧（最多三行，按可用高度自动取舍）：
 * ```
 * ┌────────┬──────────────────────────┐
 * │        │ 潜水排污泵      ← 中文名（font 24）│
 * │ [QR]   │ 105000620346   ← 设备编码       │
 * │        │ 机身 K6-1234    ← 机身编号（有则显示）│
 * └────────┴──────────────────────────┘
 * ```
 * 三行在 15mm 内排布（行高 3mm + 间隙）：名称 y=1.5 / 编码 y=5.5 / 机身 y=9.5，末行底边 12.5mm。
 *
 * ## 版式 B：portrait 竖版（旧 48×30，保留兼容）
 * 仅在使用 30mm 高纸时才应选择。
 *
 * 二维码内容默认 `https://www.xmgl-123.cn/ops/qr/<encodeURIComponent(编号)>`，
 * 与 Web 端设备二维码打印、小程序扫码解析（parseScanPayload）三端同源。
 */
export function buildDeviceLabel(spec: DeviceLabelSpec): Uint8Array {
  const layout = spec.layout ?? 'landscape'
  const isLandscape = layout === 'landscape'
  // 横向默认 48×15；竖版默认沿用 48×30
  const widthMm = spec.widthMm ?? (isLandscape ? LABEL_50X15.widthMm : DEFAULT_LABEL.widthMm)
  const heightMm = spec.heightMm ?? (isLandscape ? LABEL_50X15.heightMm : DEFAULT_LABEL.heightMm)

  const code = (spec.code || '').trim()
  const name = (spec.name || '').trim()
  const serial = (spec.serial || '').trim()
  const qrContent =
    spec.qrContent || `https://www.xmgl-123.cn/ops/qr/${encodeURIComponent(code || 'X')}`
  const font = spec.font ?? 24

  // 可用高度内边距：横向纸矮，留 1mm 上下；竖版留 1mm 底部
  const qrMaxMm = Math.max(6, heightMm - (isLandscape ? 2 : 1))
  // 纸高允许的最大倍率（硬上限，防跨页）
  const unitByPaper = fitQrUnit(qrContent, qrMaxMm)
  // 用户显式传的倍率也要被纸高上限夹紧——纸只有 15mm 时不允许打出 16.5mm 的码
  const qrUnit = Math.min(unitByPaper, Math.max(1, spec.qrUnit ?? unitByPaper))

  // 二维码版本 → 模块数 → 物理边长（mm）
  const len = qrContent.length
  const ver = len <= 26 ? 2 : len <= 42 ? 3 : len <= 62 ? 4 : len <= 84 ? 5 : 6
  const modules = 21 + (ver - 1) * 4
  const qrWmm = (modules * qrUnit) / DOT_PER_MM

  const b = new CpclBuilder().init({ widthMm, heightMm, copies: 1 })

  if (isLandscape) {
    // —— 横向版式：左二维码垂直居中 + 右三行文字 ——
    //
    // ⚠️ 2026-09-30 真机多轮照片暴露的坑（务必保留）：
    //  1) 文字**不能压到二维码**：`BARCODE QR` 在 C51DC 上除码本身还占静区（白边），
    //     实测文字起点需 ≥ 码右边 + 3mm。故此处间隙固定 3mm。
    //  2) 中文**必须用 font 24**：真机上 font 55 打 GBK 中文会渲染成乱码字块。
    //  3) 15mm 高最多容纳**三行**（每行 3mm 字高 + 间隙）：
    //     名称 y=1.5 / 编码 y=5.5 / 机身 y=9.5，末行底边 12.5mm < 15mm ✅
    //  4) 无机身编号时自动只打两行，不浪费空间。
    const qrX = 1 // 左边距 1mm
    const qrYmm = Math.max(0, (heightMm - qrWmm) / 2) // 垂直居中
    const textX = Math.round(qrX + qrWmm + 3) // 文字起点 = 码右侧 + 3mm 静区余量
    const availMm = Math.max(6, widthMm - textX - 1) // 文字可用宽度（右侧留 1mm）

    // 各行按可用宽度截断，绝不让内容溢到纸外
    // 中文名称：汉字 3mm/字；设备编码/机身编号：ASCII 1.5mm/字符
    function fitText(text: string, perCharMm: number): string {
      const maxChars = Math.max(1, Math.floor(availMm / perCharMm))
      return text.length <= maxChars ? text : text.slice(0, maxChars)
    }

    // 编码优先放大：2×2（3mm/字符）；装不下则普通（1.5mm/字符）
    const codePerChar = code.length * 3 <= availMm ? 3 : 1.5
    const codeZoomed = codePerChar === 3
    const codeSize = codeZoomed ? 22 : 0
    const codeHmm = codeZoomed ? 6 : 3

    // 三行动态排布：名称在最上（中文名是现场最需要一眼认出的信息）
    let curY = 1.5
    b.align('left')
    if (name) {
      b.text(24, 0, textX, curY, fitText(name, 3))
      curY += 3 + 1 // 名称字高 3mm + 行距 1mm
    }
    b.text(24, codeSize, textX, curY, fitText(code || '—', codePerChar))
    curY += codeHmm + 1
    if (serial) {
      // 机身编号：前缀「机身」便于现场区分，ASCII 1.5mm/字符
      const label = '机身' + serial
      b.text(55, 0, textX, curY, fitText(label, 1.5))
    }
    b.qrcode(qrX, qrYmm, qrContent, { unit: qrUnit, rank: 'M' })
  } else {
    // —— 竖版（旧 48×30 兼容）——
    const qrX = Math.max(0, Math.round((widthMm - qrWmm) / 2))
    const qrY = Math.max(0, Math.round(heightMm - qrWmm - 1))
    const codeY = Math.max(name ? 5 : 2, qrY - 7)

    if (name) {
      b.align('center').text(font, 0, 0, 1.5, name).align('left')
    }
    b.align('center').text(24, 22, 0, codeY, code || '—').align('left')
    b.qrcode(qrX, qrY, qrContent, { unit: qrUnit, rank: 'M' })
  }

  b.form().print()
  return b.build()
}

/**
 * 设备标签横向版式 v2 ——「编号优先放大」（2026-09-30 用户要求「设备编号可以做大点」）。
 *
 * ## 为什么需要单独一个函数
 * 48mm 纸宽要同时放下 二维码 + 名称 + 编号 + 机身，宽度是硬约束：
 * ```
 *   左距 0.5 + 二维码边长 Q + 静区 2 + 文字宽 W + 右距 0.5 = 48mm
 * ```
 * 编号用 `size22`（2×2 放大，3mm/字符）时，12 字符需 **36mm**。
 * 代入得 `Q ≤ 9.3mm`，即二维码必须缩到 **unit=2（33 模块 → 8.3mm）**。
 *
 * 实测矩阵（12 字符编号 / v4 二维码）：
 * | 二维码 unit | 码边长 | 文字可用宽 | size22 需 36mm |
 * |---|---|---|---|
 * | 4（旧默认） | 16.5mm | 28.5mm | ❌ 差 7.5mm |
 * | 3 | 12.4mm | 32.6mm | ❌ 差 3.4mm |
 * | **2** | **8.3mm** | **36.8mm** | **✅ 可放下** |
 *
 * ## 取舍（现场需知）
 * 二维码缩到 8.3mm 后，扫码距离需**靠近到 5~10cm**；换来的是编号字号**翻倍**
 * （1.5mm → 3mm 字宽、3mm → 6mm 字高），远距离一眼可读、抄录不易错。
 * 若现场更需要远距离扫码，把 `qrScale` 调回 3，编号会自动降级为 size0。
 *
 * ## 高度预算（15mm 内）
 * ```
 *   y=0.5   名称      font 24 size0   高 3mm   底边 3.5mm
 *   y=4.5   设备编号  font 24 size22  高 6mm   底边 10.5mm   ← 大号
 *   y=11.0  机身编号  font 55 size0   高 2mm   底边 13.0mm
 * ```
 */
export function buildDeviceLabelBigCode(spec: DeviceLabelSpec): Uint8Array {
  const widthMm = spec.widthMm ?? LABEL_50X15.widthMm
  const heightMm = spec.heightMm ?? LABEL_50X15.heightMm

  const code = (spec.code || '').trim()
  const name = (spec.name || '').trim()
  const serial = (spec.serial || '').trim()
  const qrContent =
    spec.qrContent || `https://www.xmgl-123.cn/ops/qr/${encodeURIComponent(code || 'X')}`

  // 二维码尺寸档：2=最小(给编号腾宽度) / 3=中等 / 4~6 更保守
  const qrScale = Math.min(6, Math.max(1, spec.qrUnit ?? 2))

  const leftPad = 0.5
  const gapMm = 2 // 码与文字静区（缩到 2mm 以腾宽度）
  const rightPad = 0.5

  // 二维码物理边长
  const len = qrContent.length
  const ver = len <= 26 ? 2 : len <= 42 ? 3 : len <= 62 ? 4 : len <= 84 ? 5 : 6
  const modules = 21 + (ver - 1) * 4
  const qrWmm = (modules * qrScale) / DOT_PER_MM

  const textX = leftPad + qrWmm + gapMm
  const availMm = Math.max(6, widthMm - textX - rightPad)

  const b = new CpclBuilder().init({ widthMm, heightMm, copies: 1 })
  const qrYmm = Math.max(0, (heightMm - qrWmm) / 2)

  // 截断到可用宽度
  const fit = (text: string, perCharMm: number): string => {
    const maxChars = Math.max(1, Math.floor(availMm / perCharMm))
    return text.length <= maxChars ? text : text.slice(0, maxChars)
  }

  // 编号字号：优先 size22（3mm/字符、6mm 高）；实在放不下才降 size0
  const codeZoomed = code.length * 3 <= availMm
  const codeSize = codeZoomed ? 22 : 0
  const codePerChar = codeZoomed ? 3 : 1.5
  const codeHmm = codeZoomed ? 6 : 3

  let curY = 0.5
  b.align('left')

  // 1) 名称：font 24（真机唯一可靠的中文字体），固定 3mm 高
  if (name) {
    b.text(24, 0, textX, curY, fit(name, 3))
    curY += 3 + 1
  }

  // 2) 设备编号（主角，尽量放大）
  b.text(24, codeSize, textX, curY, fit(code || '—', codePerChar))
  curY += codeHmm + 0.5

  // 3) 机身编号：纯 ASCII，font 55 省空间（2mm 高）
  //    ⚠️ 必须做高度兜底：二维码放大后垂直居中会下探，机身行可能被顶出 15mm。
  //       判据 = 机身行底边 与 二维码底边 的最大值 ≤ 纸高 - 0.5mm 安全边。
  if (serial) {
    const serialBottom = curY + 2
    const qrBottom = qrYmm + qrWmm
    if (Math.max(serialBottom, qrBottom) <= heightMm - 0.5) {
      b.text(55, 0, textX, curY, fit('机身' + serial, 1.5))
    }
  }

  b.qrcode(leftPad, qrYmm, qrContent, { unit: qrScale, rank: 'M' })
  b.form().print()
  return b.build()
}

/** 双编号标签参数：固定资产编号 + 机身编号（均为纯 ASCII） */
export interface DualCodeLabelSpec {
  /** 固定资产编号（devices.device_code，105 开头 12 位数字，**100% 有效**） */
  code: string
  /** 机身编号（从 brand_model 抽取，如 `G-1D9APt`；仅 34.7% 的设备有值，可为空） */
  serialNo?: string
  /** 二维码内容；默认 `…/ops/qr/<固定资产编号>` */
  qrContent?: string
  widthMm?: number
  heightMm?: number
  /** 二维码放大倍数，默认 2（给大号文字腾宽度；下限 2 保证可扫） */
  qrUnit?: number
}

/**
 * 设备标签「双编号」版式 —— **只打固定资产编号 + 机身编号**（均为纯 ASCII）。
 *
 * ## 为什么砍掉中文名
 * 2026-09-30 多轮真机验证：C51DC 的 `font 0/7/16/20/24/55` **全部无法正常渲染 GBK 中文**
 * （ASCII 完全正常）。厂家 SDK 的正规中文方案是走位图（`EG` 指令），但 48×15 全宽位图
 * ≈11.5KB / 578 包，蓝牙吞吐下体验不可接受。故**放弃中文名**，只打两个纯 ASCII 编号。
 *
 * ## 字段口径（2026-09-30 查线上库核对，用户确认）
 * | 标签行 | 字段 | 形态 | 覆盖率 |
 * |---|---|---|---|
 * | 固定资产编号 | `devices.device_code` | `105000620923`（105 开头 12 位数字） | **100%** |
 * | 机身编号 | `extractSerialNo(brand_model)` | `G-1D9APt` | 34.7% |
 *
 * ⚠️ 不要用 `fixed_assets.asset_code`！该列 7 位纯数字形态（如 `0603001`）是**资产分类码**
 * （68 个码挂 5775 台，平均 84.9 台/码），打上标签同型号设备会同号、毫无区分度。
 *
 * ## 版式（50×15 横向）
 * ```
 * ┌──────┬────────────────────────────────┐
 * │      │ 105000620923     ← 固定资产编号（size22 大字 3mm/字）│
 * │ [QR] │ G-1D9APt         ← 机身编号（size0 小字 1.5mm/字）│
 * └──────┴────────────────────────────────┘
 * ```
 * 机身编号为空时**整行省略**，固定资产编号行自动垂直居中（实测大部分设备无此值）。
 *
 * ## 为什么两行**不**等大
 * 用户先要求「两行同样字高大小」，但几何算不通：两行等大 → 字号由**较长那行**决定
 * → 机身编号最长可达 18 字符，48mm 内最多只能 1.5mm/字 → 固定资产编号被从 3mm 拖到
 * 1.5mm，**反而比原来更小**，与用户「编号做大点」的首要诉求直接冲突。
 * 故改为：**固定资产编号保持 size22 大字，机身编号用 size0 小字**（用户已确认）。
 *
 * ## 宽度方程（决定二维码能多大）
 * `左0.5 + 二维码Q + 静区2 + 文字宽 + 右0.5 = 48`。
 * 固定资产编号固定 12 位 × 3.0mm = **36.0mm**
 * → unit=2 时二维码 7.3mm → 可用 37.8mm ✅
 *
 * ## 高度核算
 * 行1 size22 高 6mm + 行距 0.5 + 行2 size0 高 3mm = 9.5mm，垂直居中
 * `y1=2.75 → y2=9.25 → 底边 12.25mm < 15mm` ✅（多长度组合 5/5 通过）
 */
export function buildDualCodeLabel(spec: DualCodeLabelSpec): Uint8Array {
  const widthMm = spec.widthMm ?? LABEL_50X15.widthMm
  const heightMm = spec.heightMm ?? LABEL_50X15.heightMm

  const code = (spec.code || '').trim()
  const serialNo = (spec.serialNo || '').trim()

  const leftPad = 0.5
  const gapMm = 2 // 码与文字静区（二维码白边会侵占相邻区域，至少留 2mm）
  const rightPad = 0.5

  // 二维码 unit 下限 2：unit=1 模块仅 0.125mm，手机扫不出（实测结论，勿降）
  const qrUnitMax = Math.min(6, Math.max(2, spec.qrUnit ?? 2))

  // 行1：固定资产编号 —— size22（2×2 放大）= 3.0mm/字符、6.0mm 高（大字优先）
  // 行2：机身编号     —— size0（1×1）  = 1.5mm/字符、3.0mm 高（能装下长串）
  const BIG_PER_CHAR = 3.0
  const SML_PER_CHAR = 1.5
  const BIG_H = 6.0
  const SML_H = 3.0

  /** 按内容长度与 unit 估二维码版本 → 模块数 → 边长（mm）与文字可用宽 */
  const measure = (contentLen: number, unit: number) => {
    const ver = contentLen <= 26 ? 2 : contentLen <= 42 ? 3 : contentLen <= 62 ? 4
      : contentLen <= 84 ? 5 : 6
    const modules = 21 + (ver - 1) * 4
    const qrWmm = (modules * unit) / DOT_PER_MM
    const textX = leftPad + qrWmm + gapMm
    const availMm = Math.max(6, widthMm - textX - rightPad)
    return { ver, modules, qrWmm, textX, availMm }
  }

  // 二维码内容：默认直达链接（微信扫一扫可跳网页）。
  // ⚠️ URL 形式有 43 字符 → ver4/33 模块 → unit=2 时占 8.25mm，文字可用仅 36.75mm，
  //    而 12 位固定资产编号 size22 需 36.0mm —— **只剩 0.75mm 余量**，字体渲染稍宽即溢出。
  //    故要求**余量 ≥ 1.5mm** 才用 URL；否则退回**纯编号**（12 字符 → ver2 → 6.25mm，
  //    余量 2.75mm）。`parseScanPayload` 对两种形式都兼容（纯编号走兜底 return）。
  const SAFE_MARGIN_MM = 1.5
  const urlContent = spec.qrContent
    || `https://www.xmgl-123.cn/ops/qr/${encodeURIComponent(code || 'X')}`
  const urlOk =
    code.length * BIG_PER_CHAR + SAFE_MARGIN_MM <= measure(urlContent.length, qrUnitMax).availMm
  const qrContent = urlOk ? urlContent : (code || 'X')

  // 自动降 unit：若当前 unit 下编号装不下 size22，逐级下调直到装得下（下限 2）。
  // 保证「固定资产编号始终保持大字」——这是用户的首要诉求，优先级高于二维码大小。
  // （反正 unit=2 模块 0.25mm 已足够可扫，没必要为了更大的码牺牲编号字号。）
  let qrUnit = qrUnitMax
  while (
    qrUnit > 2
    && code.length * BIG_PER_CHAR + SAFE_MARGIN_MM > measure(qrContent.length, qrUnit).availMm
  ) {
    qrUnit -= 1
  }

  const { qrWmm, textX, availMm } = measure(qrContent.length, qrUnit)

  // 固定资产编号放不下 size22 时退化为小字，绝不留空白
  const codeBig = code.length * BIG_PER_CHAR <= availMm
  const codePerChar = codeBig ? BIG_PER_CHAR : SML_PER_CHAR
  const codeH = codeBig ? BIG_H : SML_H
  const codeSize = codeBig ? 22 : 0

  const fit = (text: string, perChar: number): string => {
    const maxChars = Math.max(1, Math.floor(availMm / perChar))
    return text.length <= maxChars ? text : text.slice(0, maxChars)
  }

  const b = new CpclBuilder().init({ widthMm, heightMm, copies: 1 })
  b.align('left')

  // 垂直居中：总高 = 编号行高 +（有机身编号时）行距 + 机身行高
  const lineGap = 0.5
  const totalH = codeH + (serialNo ? lineGap + SML_H : 0)
  const curY = Math.max(0.5, (heightMm - totalH) / 2)

  // 行 1：固定资产编号（大字）
  b.text(24, codeSize, textX, curY, fit(code || '—', codePerChar))

  // 行 2：机身编号（小字）—— 无值则整行省略，编号行垂直居中
  if (serialNo) {
    b.text(24, 0, textX, curY + codeH + lineGap, fit(serialNo, SML_PER_CHAR))
  }

  // 二维码垂直居中（与文字块各自独立居中，观感更稳）
  b.qrcode(leftPad, Math.max(0, (heightMm - qrWmm) / 2), qrContent, { unit: qrUnit, rank: 'M' })
  b.form().print()
  return b.build()
}
