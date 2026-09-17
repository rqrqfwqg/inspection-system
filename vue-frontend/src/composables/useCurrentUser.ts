/**
 * 当前登录用户（模块级单例，全站共享一份）
 * =====================================================================
 * 生产环境 `DISABLE_AUTH=true`，无登录页；React 版用户信息来自 AuthContext。
 * Vue 版取值顺序：
 *   1) GET /users/me（token 在 localStorage['token']，生产后端放行）
 *   2) 失败回落 localStorage['user']（React 版登录时写入的缓存，logout 时清除）
 *   3) 仍取不到 → null（调用方按「未取到当前用户」降级，不得假装登录）
 *
 * 模块级缓存：多个页面（总览 / 系统设置）共用，避免每页各打一次 /users/me。
 */
import { ref } from 'vue'
import { getMe } from '@/api/users'
import type { User } from '@/types/user'

const currentUser = ref<User | null>(null)
const loading = ref(false)
let started = false

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<User>
    if (parsed && typeof parsed.id === 'number' && typeof parsed.name === 'string') {
      return parsed as User
    }
    return null
  } catch {
    return null
  }
}

async function load(): Promise<User | null> {
  loading.value = true
  try {
    const me = await getMe()
    currentUser.value = me
    return me
  } catch {
    // /users/me 不可达时回落本地缓存（DISABLE_AUTH 下通常 token 为空导致 401）
    currentUser.value = readCachedUser()
    return currentUser.value
  } finally {
    loading.value = false
  }
}

export function useCurrentUser() {
  if (!started) {
    started = true
    void load()
  }
  return { currentUser, loading, reload: load }
}
