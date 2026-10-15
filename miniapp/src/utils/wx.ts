/**
 * wx — 微信登录临时 code 获取（小程序端唯一入口）
 *
 * 为什么走 openid 而不是手机号：
 * `wx.getPhoneNumber` 要求「**非个人主体 + 已完成微信认证**」才开放（微信官方硬条件），
 * 本项目未开通；而 `uni.login` → `jscode2session` 换 openid 属**基础能力，个人主体可用**
 * （受限的是手机号与昵称头像，不是 wx.login）。后端用 openid 匹配 `users.wx_openid`
 * 即可实现「不需要用户输入任何东西」的一键登录。
 *
 * 契约：**永不抛异常**。拿不到 code 时返回空串，由调用方静默降级到手机号登录
 * —— 登录是主流程，不能因为微信侧抖动把用户拦在门外。
 *
 * 注意：code 有效期 5 分钟、**只能消费一次**，且与 `getPhoneNumber` 的 code 不可混用。
 * 因此调用方应「取一次、用完即弃」，不要在多个请求里复用同一个 code。
 */

/** 获取微信登录临时 code（失败返回 ''，不抛异常） */
export function getWxCode(): Promise<string> {
  return new Promise((resolve) => {
    try {
      uni.login({
        provider: 'weixin',
        success: (res: any) => resolve(String(res?.code || '')),
        fail: (err: any) => {
          console.warn('[wx] uni.login 失败（降级到手机号登录）', err?.errMsg || err)
          resolve('')
        }
      })
    } catch (err) {
      console.warn('[wx] uni.login 调用异常（降级到手机号登录）', err)
      resolve('')
    }
  })
}
