<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppHeader from '@/components/layout/AppHeader.vue'

/**
 * 壳层响应式 —— 严格依据 docs/rewrite-vue/UIUX.md §6.2 的「每档行为矩阵（写死，不得即兴发挥）」：
 *
 * | 视口宽 (CSS px) | 侧栏          |
 * |-----------------|---------------|
 * | >= 1536 (xl/2xl)| 240px 展开    |
 * | <= 1535 (lg/md) | 64px 图标条   |
 *
 * 另设高度轴（§6.1：720 档的痛点在高度，不在宽度）：
 *   视口高 <= 760（即 1920x1080 @150% → 1280x720）→ compact：页头 48 / 工具条 32 / 行高 32
 *
 * 判定只用 CSS px 视口尺寸；禁止用 window.screen.width / devicePixelRatio 判布局（ARCHITECTURE §4.4）。
 */
const SIDER_COLLAPSE_MAX = 1535
const COMPACT_HEIGHT_MAX = 760

const collapsed = ref(false)
const compactHeight = ref(false)

function syncViewport() {
  collapsed.value = window.innerWidth <= SIDER_COLLAPSE_MAX
  compactHeight.value = window.innerHeight <= COMPACT_HEIGHT_MAX
}

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})
onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
})
</script>

<template>
  <!-- 外壳固定 100vh；滚动只发生在内容区（AC-01） -->
  <div class="shell" :class="{ 'shell--compact': compactHeight }">
    <AppSidebar :collapsed="collapsed" />
    <div class="shell-main">
      <AppHeader />
      <main class="shell-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
}

/*
 * 高度轴 compact：覆盖 token 级变量。CSS 自定义属性会向下继承，
 * 因此内容区里按 var(--toolbar-h) / var(--row-h) 实现的组件会同步收窄。
 */
.shell--compact {
  --shell-header-h: var(--shell-header-h-compact);
  --toolbar-h: var(--toolbar-h-compact);
  --row-h: 32px;
}

/* min-width:0 是硬规则：否则宽表格会把主区撑破（AC-15） */
.shell-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* min-height:0 同理：flex 子项默认 min-height:auto 会让外壳被顶高、滚动逃逸到 body */
.shell-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--space-5);
}
</style>
