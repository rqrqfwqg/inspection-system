/**
 * 当前用户是否管理员（逃生舱 / 敏感操作可见性 best-effort 判断）
 * =====================================================================
 * 前端永远不是安全边界——真实校验在后端（require_admin 守护，非 admin → 403）。
 * 此处仅用于「提前隐藏」管理动作入口；取不到用户时不误判（沿用 useWoPermissions 的同款兜底）。
 * 生产 DISABLE_AUTH=true 下用户角色通常为 admin，视具体情况由后端放行。
 */
import { computed } from 'vue'
import { useCurrentUser } from '@/composables/useCurrentUser'

export function useIsAdmin() {
  const { currentUser } = useCurrentUser()

  const isAdmin = computed(() => {
    const role = currentUser.value?.role?.toLowerCase() ?? ''
    return role.includes('admin') || role.includes('superuser')
  })

  return { isAdmin }
}
