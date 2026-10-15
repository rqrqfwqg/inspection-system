/**
 * version — 小程序版本号（单一真源）
 *
 * 取值的优先级：
 * 1) 体验版 / 正式版：微信平台返回的版本号（`getAccountInfoSync().miniProgram.version`），
 *    也就是上传时写入的版本号，最准确 —— 现场/远程排查「手机上跑的是哪一版」就看它；
 * 2) 开发版 / 取不到（低版本基础库）：回退到编译期常量 APP_VERSION。
 *
 * ⚠️ 发版时把 APP_VERSION 与上传脚本的 version 一起改（见 C:/tmp/do_upload_*.cjs），
 *    两者保持一致，避免开发版显示落后。
 * ⚠️ 不要用 manifest.json 的 versionName：那是 uni-app 的配置字段，
 *    上传到微信的版本号由 miniprogram-ci 的 version 参数决定，两者并不联动。
 */

/** 编译期兜底版本号（发版时同步更新） */
export const APP_VERSION = '1.5.0'

/** 小程序运行环境 */
export type MpEnvVersion = 'develop' | 'trial' | 'release'

/**
 * 取当前运行环境：develop=开发版 / trial=体验版 / release=正式版。
 * 基础库过低或异常时返回空串。
 */
export function getEnvVersion(): MpEnvVersion | '' {
  try {
    const env = (uni as any).getAccountInfoSync?.()?.miniProgram?.envVersion
    if (env === 'develop' || env === 'trial' || env === 'release') return env
  } catch {
    /* 低版本基础库无此 API：按未知处理 */
  }
  return ''
}

/** 环境中文标签（未知返回空串，调用方据此隐藏） */
export function envLabel(env: MpEnvVersion | ''): string {
  if (env === 'release') return '正式版'
  if (env === 'trial') return '体验版'
  if (env === 'develop') return '开发版'
  return ''
}

/**
 * 当前运行版本号。
 * 体验版/正式版用微信平台返回的真实版本；开发版回退编译期常量。
 */
export function getAppVersion(): string {
  try {
    const v = (uni as any).getAccountInfoSync?.()?.miniProgram?.version
    if (v && String(v).trim()) return String(v).trim()
  } catch {
    /* ignore */
  }
  return APP_VERSION
}
