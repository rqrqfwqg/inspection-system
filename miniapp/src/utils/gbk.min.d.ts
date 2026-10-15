/**
 * gbk.min.js 类型声明
 * 普贴官方 SDK 的 GBK 码表（UMD 已改造为 ESM，见 mk_gbk.py）。
 * 小程序无内置 TextDecoder('gbk')，中文标签必须走码表。
 */
declare const GBK: {
  /** 字节数组 → 字符串 */
  decode(bytes: number[] | Uint8Array): string
  /** 字符串 → 字节数组（GBK 编码，ASCII 兼容） */
  encode(str: string): number[]
}

export default GBK
