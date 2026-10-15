/**
 * storage — 统一存储层（抹平 localStorage → uni storage）
 *
 * 约定（设计文档 §8.1）：所有持久化读写必须经本模块，禁止页面直用 uni.*Storage*。
 * 存储 key 统一：token / user / scan_history / inventory_entered_<checkId>
 */
const TOKEN_KEY = 'token'
const USER_KEY = 'user'
/** 本机登录账号（手机号）：个人主体小程序无法获取微信手机号，改用手机号本地记住，
 *  启动自动登录；登出/账号失效时清除，下次需重新输入 */
const LOGIN_PHONE_KEY = 'login_phone'
/** 本机微信是否曾成功绑定过系统账号：启动时据此决定要不要先试「一键登录」，
 *  避免未绑定的用户每次冷启动都白跑一次 `uni.login` + `/auth/wx-login`。
 *  与 token 生命周期**解耦** —— token 过期被清后仍保留（这时正靠它免输手机号恢复登录）；
 *  用户在「我的」页主动解绑时清除。 */
const WX_BOUND_KEY = 'wx_bound'

/** 读取原始值（uni storage 在 App 端直接存对象、H5 端存字符串，此处原样返回） */
export function get(key: string): any {
  try {
    return uni.getStorageSync(key)
  } catch (err) {
    console.warn(`[storage] get ${key} failed`, err)
    return null
  }
}

/** 读取字符串值（缺失/空返回 ''） */
export function getString(key: string): string {
  const value = get(key)
  if (value == null) return ''
  return typeof value === 'string' ? value : String(value)
}

/** 读取并解析 JSON（兼容已序列化字符串与对象两种存储形态） */
export function getJSON<T = any>(key: string): T | null {
  try {
    const value = get(key)
    if (value == null || value === '') return null
    if (typeof value === 'object') return value as T
    return JSON.parse(String(value)) as T
  } catch (err) {
    console.warn(`[storage] getJSON ${key} failed`, err)
    return null
  }
}

/** 写入（任意可序列化值；uni storage 自动处理） */
export function set(key: string, value: any): void {
  try {
    uni.setStorageSync(key, value)
  } catch (err) {
    console.warn(`[storage] set ${key} failed`, err)
  }
}

/** 删除指定 key */
export function remove(key: string): void {
  try {
    uni.removeStorageSync(key)
  } catch (err) {
    console.warn(`[storage] remove ${key} failed`, err)
  }
}

/** 清空全部本地存储 */
export function clear(): void {
  try {
    uni.clearStorageSync()
  } catch (err) {
    console.warn('[storage] clear failed', err)
  }
}

/* ===== 鉴权便捷方法（key 统一收口，避免散落字符串） ===== */

/** 读取登录 token（request.ts 拦截器使用） */
export function getToken(): string {
  return getString(TOKEN_KEY)
}

/** 写入登录 token */
export function setToken(token: string): void {
  set(TOKEN_KEY, token)
}

/** 读取缓存的用户对象 */
export function getStoredUser<T = any>(): T | null {
  return getJSON<T>(USER_KEY)
}

/** 写入缓存的用户对象 */
export function setStoredUser(user: any): void {
  set(USER_KEY, user)
}

/** 读取本机记住的登录手机号（空串=未记住） */
export function getLoginPhone(): string {
  return getString(LOGIN_PHONE_KEY)
}

/** 记住本机登录手机号（登录成功后写入） */
export function setLoginPhone(phone: string): void {
  set(LOGIN_PHONE_KEY, phone)
}

/** 清除本机记住的登录手机号（登出 / 账号失效时调用） */
export function clearLoginPhone(): void {
  remove(LOGIN_PHONE_KEY)
}

/** 本机微信是否曾绑定过系统账号（true 才值得先试一键登录） */
export function getWxBoundFlag(): boolean {
  const v = get(WX_BOUND_KEY)
  return v === true || v === 'true'
}

/** 标记/清除「本机微信已绑定」；解绑微信时传 false */
export function setWxBoundFlag(bound: boolean): void {
  if (bound) set(WX_BOUND_KEY, true)
  else remove(WX_BOUND_KEY)
}

/** 清空鉴权相关存储（401 / 退出登录时调用） */
export function clearAuth(): void {
  remove(TOKEN_KEY)
  remove(USER_KEY)
  remove('saved_credentials')
  remove(LOGIN_PHONE_KEY)
}
