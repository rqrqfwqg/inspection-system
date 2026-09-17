<script setup lang="ts">
/** 自动关联「候选预览」 —— 纯展示，展示前 N 条样本、每条带判定证据 */
import { TopRight, View } from '@element-plus/icons-vue'
import type { AutoAssociatePreview } from '@/types/assetViz'

defineProps<{ preview: AutoAssociatePreview }>()
</script>

<template>
  <div class="apl">
    <p class="apl__head">
      <el-icon :size="16"><View /></el-icon>
      <span>预览：将新建 {{ preview.would_create }} 条</span>
      <span class="apl__muted">
        （待建合计 {{ preview.pending_total }}，已存在 {{ preview.already_linked }}，自环 {{ preview.skipped_self_loop }}）
      </span>
    </p>
    <div class="apl__list">
      <div v-for="(s, i) in preview.sample" :key="i" class="apl__item">
        <div class="apl__codes mono">
          <span>{{ s.from_code }}</span>
          <el-icon :size="16" class="apl__arrow"><TopRight /></el-icon>
          <span>{{ s.to_code }}</span>
          <el-tag size="small" type="info" effect="plain" class="apl__relation">{{ s.relation_type }}</el-tag>
        </div>
        <p class="apl__evidence">{{ s.evidence }}</p>
      </div>
    </div>
    <p class="apl__muted">仅展示前 {{ preview.sample?.length || 0 }} 条样本；执行后可在下方按批次回滚。</p>
  </div>
</template>

<style scoped>
.apl {
  padding: var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}

.apl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.apl__list {
  max-height: 14rem;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

.apl__item {
  padding: var(--space-2) var(--space-3);
}

.apl__item + .apl__item {
  border-top: 1px solid var(--border-soft);
}

.apl__codes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--fg);
}

.apl__arrow {
  color: var(--info);
}

.apl__relation {
  margin-left: auto;
}

.apl__evidence {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.apl__muted {
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
