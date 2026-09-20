/**
 * 工单权限位（wo.dispatch / wo.execute / wo.review / wo.cancel）
 * =====================================================================
 * 契约（§0）：动作端点按权限位校验，不足返 403。
 * 前端职责边界：
 *   - 权限位**只用于「提前禁用 + tooltip 说明原因」**（硬点：按钮禁用不隐藏）；
 *   - 前端权限永远不是安全边界——真实校验在后端，403 响应仍须兜底为只读降级。
 *
 * 取值顺序（当前 `User` 契约无 permissions 字段，故做成 best-effort）：
 *   1) 当前用户对象上的 `permissions: string[]`（Phase 0 RBAC 就绪后由 /users/me 返回）；
 *   2) 角色含 admin / superuser → 视为全量权限（生产 DISABLE_AUTH=true 即管理员）；
 *   3) 取不到 → `known=false`：不误判为「无权限」（否则会错误禁用按钮），
 *      交由后端 403 驱动只读降级。
 */
import { computed, type ComputedRef } from 'vue'
import { useCurrentUser } from '@/composables/useCurrentUser'

export const WO_PERMISSIONS = ['wo.dispatch', 'wo.execute', 'wo.review', 'wo.cancel'] as const
export type WoPermission = (typeof WO_PERMISSIONS)[number]

function readPermissions(user: unknown): string[] | null {
  if (!user || typeof user !== 'object') return null
  const raw = (user as { permissions?: unknown }).permissions
  if (Array.isArray(raw)) {
    const list = raw.filter((x): x is string => typeof x === 'string')
    return list
  }
  return null
}

function isAdminRole(user: unknown): boolean {
  if (!user || typeof user !== 'object') return false
  const role = (user as { role?: unknown }).role
  if (typeof role !== 'string') return false
  const r = role.toLowerCase()
  return r.includes('admin') || r.includes('superuser')
}

function readCachedUser(): unknown {
  try {
    const raw = localStorage.getItem('user')
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

export interface UseWoPermissionsResult {
  /** 已知权限位集合；null 表示来源不可用（未知，不据此禁用） */
  permissions: ComputedRef<string[] | null>
  /** 是否拿到了权威权限信息（false 时 has() 恒返回 true，交由后端校验） */
  known: ComputedRef<boolean>
  has: (perm: WoPermission) => boolean
}

export function useWoPermissions(): UseWoPermissionsResult {
  const { currentUser } = useCurrentUser()

  const permissions = computed<string[] | null>(() => {
    const fromUser = readPermissions(currentUser.value) ?? readPermissions(readCachedUser())
    if (fromUser) return fromUser
    const admin = isAdminRole(currentUser.value) || isAdminRole(readCachedUser())
    if (admin) return [...WO_PERMISSIONS]
    return null
  })

  const known = computed(() => permissions.value !== null)

  function has(perm: WoPermission): boolean {
    if (!permissions.value) return true // 未知 → 不禁用，交给后端 403 兜底
    return permissions.value.includes(perm)
  }

  return { permissions, known, has }
}
