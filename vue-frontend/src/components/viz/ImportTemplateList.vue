<script setup lang="ts">
/** 支持的导入模板清单 */
import { Files } from '@element-plus/icons-vue'
import { templateLabel } from './importShared'
import type { ImportTemplate } from '@/types/assetViz'

defineProps<{ templates: ImportTemplate[] }>()
</script>

<template>
  <section class="itl panel">
    <header class="panel-head">
      <h3 class="panel-title itl__title"><span>支持的模板</span></h3>
    </header>
    <div class="itl__grid">
      <div v-for="t in templates.filter((x) => x.key !== 'unknown')" :key="t.key" class="itl__item">
        <el-icon :size="16" class="itl__icon"><Files /></el-icon>
        <div class="itl__body">
          <p class="itl__name">{{ templateLabel(t.key) }}</p>
          <p class="itl__desc">{{ t.desc }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.itl__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.itl__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

.itl__item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.itl__icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--accent);
}

.itl__body {
  min-width: 0;
}

.itl__name {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.itl__desc {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

@media (max-width: 1279px) {
  .itl__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
