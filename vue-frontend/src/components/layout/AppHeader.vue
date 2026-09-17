<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { MENU_ITEMS } from '@/router/menu'

const route = useRoute()

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
      <span class="app-header__user">管理员</span>
      <el-avatar :size="28" class="app-header__avatar">
        <el-icon :size="16"><UserFilled /></el-icon>
      </el-avatar>
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
