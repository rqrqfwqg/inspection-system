// 类型声明：weapp-qrcode-canvas-2d v1.1.6（库本身无 .d.ts）
// 运行时 drawQrcode(options) 只接收 1 个参数（options 对象），
// 第二个参数 e 是库内部回调，外部调用无需传入。
declare module 'weapp-qrcode-canvas-2d' {
  export interface DrawQrcodeOptions {
    /** canvas 2d 节点（优先）；与 canvasId 二选一 */
    canvas?: any
    /** 旧式 canvas 上下文 id（2d 模式用 canvas 节点即可） */
    canvasId?: string
    /** 二维码内容 */
    text?: string
    /** 输出宽度 px（2d 模式建议 = 显示尺寸 * dpr） */
    width?: number
    /** 输出高度 px */
    height?: number
    /** 内边距 px */
    padding?: number
    /** -1 表示自动选择版本 */
    typeNumber?: number
    /** 纠错等级 L/M/Q/H */
    correctLevel?: number
    /** 背景色 */
    background?: string
    /** 前景色 */
    foreground?: string
    /** 中心图标 */
    image?: {
      imageResource?: string
      width?: number
      height?: number
      round?: boolean
    }
  }

  export default function drawQrcode(options: DrawQrcodeOptions): void
}
