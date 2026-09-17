<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const title = computed(() => (route.meta?.title as string) || '该功能')
</script>

<template>
  <div class="placeholder panel">
    <el-empty :description="`${title}计划于后续期次交付`">
      <div class="placeholder__hint">
        一期交付范围为「全局壳 + 设备台账 + 资料检索」，功能边界与旧版一致，不做删减。
      </div>
    </el-empty>
  </div>
</template>

<style scoped>
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: var(--space-6);
}
.placeholder__hint {
  max-width: 460px;
  font-size: var(--text-sm);
  color: var(--muted);
  line-height: var(--leading-body);
}
</style>
