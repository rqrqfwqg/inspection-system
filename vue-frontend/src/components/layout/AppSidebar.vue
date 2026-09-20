<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MENU_ITEMS } from '@/router/menu'

const props = defineProps<{ collapsed: boolean }>()

const route = useRoute()
const router = useRouter()

// 生产 DISABLE_AUTH=true 恒为管理员，9 项全量可见（与 React 版 filter 结果一致）
const visibleItems = computed(() => MENU_ITEMS)

/** 当前激活项：路由显式指定的 menuPath 优先，其次精确匹配，最后前缀匹配
 *  （/workorder/12 详情、/workorder/new 均通过 meta.menuPath 归到「工单」） */
const activePath = computed(() => {
  const p = route.path
  const hinted = route.meta?.menuPath
  if (typeof hinted === 'string' && visibleItems.value.some((m) => m.path === hinted)) return hinted
  const exact = visibleItems.value.find((m) => m.path === p)
  if (exact) return exact.path
  const prefix = visibleItems.value
    .filter((m) => m.path !== '/' && p.startsWith(m.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return prefix ? prefix.path : ''
})

function goto(path: string) {
  if (route.path !== path) router.push(path)
}
</script>

<template>
  <aside class="sider" :class="{ 'sider--collapsed': props.collapsed }">
    <div class="sider__brand">
      <div class="sider__logo">
        <el-icon :size="20"><OfficeBuilding /></el-icon>
      </div>
      <span v-show="!props.collapsed" class="sider__title">项目管理部运维系统</span>
    </div>

    <nav class="sider__nav">
      <el-menu
        :collapse="props.collapsed"
        :default-active="activePath"
        :collapse-transition="false"
        class="sider__menu"
        @select="goto"
      >
        <el-menu-item v-for="item in visibleItems" :key="item.path" :index="item.path">
          <el-icon :size="18"><component :is="item.icon" /></el-icon>
          <template #title>{{ item.label }}</template>
        </el-menu-item>
      </el-menu>
    </nav>

    <div v-show="!props.collapsed" class="sider__footer">管理员模式</div>
  </aside>
</template>

<style scoped>
.sider {
  flex: 0 0 auto;
  width: var(--sider-w);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--border-soft);
  transition: width var(--motion-base) var(--ease-standard);
}
.sider--collapsed {
  width: var(--sider-w-collapsed);
}

.sider__brand {
  flex: 0 0 auto;
  height: var(--shell-header-h);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--border-soft);
  overflow: hidden;
}
.sider__logo {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-lg);
  background: var(--accent);
  color: var(--accent-on);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sider__title {
  font-weight: var(--weight-announce);
  color: var(--fg);
  white-space: nowrap;
}

.sider__nav {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-2);
}
.sider__menu {
  border-right: none;
}
.sider__menu :deep(.el-menu-item) {
  height: 40px;
  line-height: 40px;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-1);
  color: var(--fg-2);
}
.sider__menu :deep(.el-menu-item.is-active) {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: var(--weight-emphasize);
}
.sider__menu :deep(.el-menu-item:hover) {
  background: var(--surface-3);
}

.sider__footer {
  flex: 0 0 auto;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-soft);
  font-size: var(--text-xs);
  color: var(--muted);
  text-align: center;
}
</style>
