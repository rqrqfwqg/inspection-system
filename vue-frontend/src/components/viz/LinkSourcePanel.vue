<script setup lang="ts">
/** 概览 · 关联来源构成 —— 自动（规则引擎）与人工（桌面建边 / 小程序扫码 / 历史导入）对照 */
import { computed } from 'vue'
import { Grid, Link, User } from '@element-plus/icons-vue'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import { fmtInt, fmtPercent } from '@/lib/format'
import type { LinkRelationsBySource } from '@/types/assetViz'

const props = defineProps<{ src: LinkRelationsBySource }>()

const autoDetail = computed(() =>
  Object.entries(props.src.auto_by_rule ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '尚未执行自动关联',
)
const manualDetail = computed(() =>
  props.src.unmarked_legacy ? `其中历史导入未标注来源 ${props.src.unmarked_legacy} 条` : '均带操作留痕',
)
const autoShare = computed(() => (props.src.total ? props.src.auto / props.src.total : 0))
const manualShare = computed(() => (props.src.total ? props.src.manual / props.src.total : 0))
</script>

<template>
  <section class="lsp panel">
    <header class="panel-head">
      <h3 class="panel-title lsp__title">
        <el-icon :size="16"><Link /></el-icon>
        <span>关联来源构成</span>
      </h3>
    </header>
    <p class="lsp__desc">
      自动关联由规则引擎按确定性编号匹配生成（可解释、可整批回滚）；
      人工关联来自桌面建边、小程序现场扫码与历史导入。
    </p>
    <div class="lsp__sources">
      <div class="lsp__source">
        <p class="lsp__source-head">
          <el-icon :size="16"><Grid /></el-icon>
          <span>自动关联</span>
          <b class="tnum">{{ fmtInt(src.auto) }}</b>
          <span class="lsp__hint">（{{ fmtPercent(autoShare) }}）</span>
        </p>
        <CoverageBar :value="autoShare" tone="accent" :percent="false" />
        <p class="lsp__source-detail">{{ autoDetail }}</p>
      </div>
      <div class="lsp__source">
        <p class="lsp__source-head">
          <el-icon :size="16"><User /></el-icon>
          <span>人工关联</span>
          <b class="tnum">{{ fmtInt(src.manual) }}</b>
          <span class="lsp__hint">（{{ fmtPercent(manualShare) }}）</span>
        </p>
        <CoverageBar :value="manualShare" tone="muted" :percent="false" />
        <p class="lsp__source-detail">{{ manualDetail }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lsp__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.lsp__hint {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.lsp__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.lsp__sources {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-8);
}

.lsp__source {
  flex: 1 1 240px;
  min-width: 0;
}

.lsp__source-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-1);
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.lsp__source-detail {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
