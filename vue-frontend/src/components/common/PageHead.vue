<script setup lang="ts">
/**
 * 页标题条（全站统一）
 * 高度走 token（compact 档降低），标题不参与换行收缩，右侧插槽放操作按钮。
 */
defineProps<{
  title: string
  /** 副标题/说明，一句话讲清这页是干什么的 */
  desc?: string
}>()
</script>

<template>
  <div class="page-head">
    <div class="page-head__main min-w-0">
      <h1 class="page-head__title ellipsis">{{ title }}</h1>
      <p v-if="desc" class="page-head__desc">{{ desc }}</p>
    </div>
    <div class="page-head__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.page-head__main {
  flex: 1 1 auto;
}
.page-head__title {
  margin: 0;
  font-size: var(--text-xl);
  line-height: var(--leading-tight);
  font-weight: 600;
  color: var(--fg);
}
.page-head__desc {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--muted);
}
.page-head__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
