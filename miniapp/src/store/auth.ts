/**
 * auth store（小程序适配版）
 *
 * 登录策略 = **两级自动降级**：
 * 1) **微信一键登录（首选）**：`uni.login` 的 code → 后端 `jscode2session` 换 openid
 *    → 命中 `users.wx_openid` 即签发 token，用户无需输入任何内容。
 *    走的是**基础能力，个人主体可用**（`wx.getPhoneNumber` 那条要求非个人主体+已认证，未开通，故不用）。
 * 2) **手机号免密登录（首次 / 兜底）**：手机号匹配 `users.phone` 即签发；首次登录会**顺带把当前微信
 *    绑定到该账号**（后端返回 `bound_openid`），此后本机自动走 1)。
 *
 * 两条纪律：
 * - **成功才落 token**。`wxOneKeyLogin` 遇到 `guest`（该微信未绑任何账号）时**不写 token**，
 *   否则用户会被静默带进「游客只读」态，却以为登录成功了。
 * - code **只能消费一次**，由调用方取一次、传进来复用（见 `utils/wx.ts`）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, WxLoginResult } from '@/types'
import { getToken, setToken as persistToken, getStoredUser, setStoredUser, clearAuth } from '@/utils/storage'
import { login as loginApi, wxLogin as wxLoginApi } from '@/api'
import { getWxCode } from '@/utils/wx'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(getToken())
  const user = ref<User | null>(getStoredUser<User>())

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isApprover = computed(() => user.value?.role === 'admin' || user.value?.role === 'team_leader')
  /** 物料管理员：可写物料/安全防护用品（录入/编辑/删除/完成检查） */
  const isMaterialManager = computed(
    () => user.value?.role === 'material_manager' || user.value?.role === 'admin'
  )
  /** 游客模式（只读）：未匹配到系统账号的微信用户 */
  const isGuest = computed(() => user.value?.role === 'guest')
  /** 当前账号是否已绑定微信（已绑定则本机可免输手机号一键登录） */
  const wxBound = computed(() => !!user.value?.wx_openid)

  function setToken(t: string) {
    token.value = t
    persistToken(t)
  }

  function setUser(u: User) {
    user.value = u
    setStoredUser(u)
  }

  /** 落盘一次成功登录（token + user 一起写，避免只写一半） */
  function applyLogin(result: WxLoginResult) {
    if (result?.access_token) setToken(result.access_token)
    if (result?.user) setUser(result.user)
  }

  function logout() {
    token.value = ''
    user.value = null
    clearAuth()
  }

  /**
   * 手机号免密登录：identifier 为手机号（或用户名），匹配系统账号即签发 token。
   * @param wxCode 可选。携带时后端会在登录成功后**把当前微信绑定到该账号**，
   *               此后本机可一键登录（响应 `bound_openid=true` 表示本次发生了绑定）。
   */
  async function accountLogin(identifier: string, wxCode?: string): Promise<WxLoginResult> {
    const result = await loginApi(identifier, wxCode)
    applyLogin(result)
    return result
  }

  /**
   * 微信一键登录（openid 认人，用户无需输入任何内容）。
   * @param code 可选。不传则内部调 `uni.login` 现取（**只消费一次**，勿在多处复用同一个值）。
   * @returns 后端响应；`guest=true` 表示该微信尚未绑定任何系统账号，调用方应回退手机号登录；
   *          返回 `null` 表示拿不到 code 或请求失败（调用方静默降级，不必打扰用户）。
   */
  async function wxOneKeyLogin(code?: string): Promise<WxLoginResult | null> {
    const c = code || (await getWxCode())
    if (!c) return null
    const result = await wxLoginApi(c)
    // guest = 该微信未绑定任何账号：**绝不落 token**，交回调用方走手机号登录
    if (result?.guest || !result?.access_token) return result || null
    applyLogin(result)
    return result
  }

  return {
    token,
    user,
    isLoggedIn,
    isAdmin,
    isApprover,
    isMaterialManager,
    isGuest,
    wxBound,
    setToken,
    setUser,
    logout,
    accountLogin,
    wxOneKeyLogin
  }
})
