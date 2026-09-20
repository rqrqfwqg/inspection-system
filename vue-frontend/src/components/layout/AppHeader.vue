<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { UserFilled } from '@element-plus/icons-vue'
import { MENU_ITEMS } from '@/router/menu'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { logout } from '@/api/users'

const route = useRoute()
const router = useRouter()
const { currentUser } = useCurrentUser()

/** 面包屑当前项：取前缀最长的匹配菜单项 */
const currentLabel = computed(() => {
  const p = route.path
  const direct = MENU_ITEMS.find((m) => m.path === p)
  if (direct) return direct.label
  const prefix = MENU_ITEMS.filter((m) => p.startsWith(m.path + '/')).sort(
    (a, b) => b.path.length - a.path.length
  )[0]
  if (prefix) return prefix.label
  return (route.meta?.title as string) || ''
})

/** 头部显示名：优先接口取到的当前用户，取不到降级「未登录」（不得假装登录） */
const displayName = computed(() => currentUser.value?.name || '未登录')

async function onCommand(cmd: string | number | object) {
  if (cmd !== 'logout') return
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  logout()
  // 守卫会把 /login 放行；token 已清，直接去登录页
  router.push({ path: '/login' })
}
</script>

<template>
  <header class="app-header">
    <div class="app-header__left">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>运维系统</el-breadcrumb-item>
        <el-breadcrumb-item v-if="currentLabel">{{ currentLabel }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <div class="app-header__right">
      <el-dropdown trigger="click" @command="onCommand">
        <span class="app-header__user-wrap">
          <span class="app-header__user">{{ displayName }}</span>
          <el-avatar :size="28" class="app-header__avatar">
            <el-icon :size="16"><UserFilled /></el-icon>
          </el-avatar>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>
              {{ currentUser?.department || currentUser?.email || '—' }}
            </el-dropdown-item>
            <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  flex: 0 0 auto;
  /* 高度走 token：compact 视口下由 MainLayout 的 .shell--compact 覆盖为 48px */
  height: var(--shell-header-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 0 var(--space-5);
  background: var(--surface);
  border-bottom: 1px solid var(--border-soft);
}

.app-header__left {
  min-width: 0;
  overflow: hidden;
}

.app-header__right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 下拉触发区：click 触发需要可聚焦 */
.app-header__user-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  outline: none;
}

.app-header__user {
  font-size: var(--text-sm);
  color: var(--fg-2);
}

/* 头像用 Token 纯色底，取代 React 版的蓝→紫渐变（P0 规则） */
.app-header__avatar {
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
