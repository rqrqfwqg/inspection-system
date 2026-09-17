<script setup lang="ts">
/**
 * 关联来源构成面板（资料配置 → 关联管理）
 * =====================================================================
 * 展示 关联总数 / 自动 / 人工 / 历史无标记，以及自动关联的规则命中分布。
 * 口径与联动中心一致（同源于 `/assets/link/overview` 的 `relations_by_source`）。
 *
 * 纪律：无画像时用 `fallbackTotal`（列表长度）兜底，自动/人工显示 0 并给出说明，不白屏。
 */
import { computed } from 'vue'
import type { LinkOverview } from '@/types/assetViz'

const props = defineProps<{
  overview: LinkOverview | null
  /** 关联边列表长度（画像不可用时的总数兜底） */
  fallbackTotal: number
}>()

const bySource = computed(() => props.overview?.relations_by_source ?? null)

const autoRules = computed<[string, number][]>(() =>
  Object.entries(bySource.value?.auto_by_rule ?? {}),
)
</script>

<template>
  <section class="rss">
    <div class="rss__row">
      <span class="rss__item">
        关联总数 <span class="rss__strong tnum">{{ bySource?.total ?? props.fallbackTotal }}</span>
      </span>
      <span class="rss__item rss__item--auto">
        自动关联 <span class="rss__strong tnum">{{ bySource?.auto ?? 0 }}</span>
      </span>
      <span class="rss__item">
        人工关联 <span class="rss__strong tnum">{{ bySource?.manual ?? 0 }}</span>
      </span>
      <span v-if="bySource?.unmarked_legacy" class="rss__legacy">
        （历史无标记 <span class="tnum">{{ bySource.unmarked_legacy }}</span> 条，按人工归类）
      </span>
    </div>

    <div v-if="autoRules.length > 0" class="rss__rules">
      <span v-for="[rule, count] in autoRules" :key="rule" class="rss__rule">
        {{ rule }} · <span class="tnum">{{ count }}</span>
      </span>
    </div>

    <p class="rss__note">
      自动关联由规则引擎按确定性编号匹配建立（可解释、可整批回滚）；人工关联来自网页 / 小程序 / 历史导入。
    </p>
  </section>
</template>

<style scoped>
.rss {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  min-width: 0;
}

.rss__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-6);
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.rss__item--auto {
  color: var(--info-fg);
}

.rss__strong {
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.rss__legacy {
  font-size: var(--text-xs);
  color: var(--meta);
}

.rss__rules {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.rss__rule {
  padding: 2px var(--space-2);
  border: 1px solid var(--info);
  border-radius: var(--radius-sm);
  background: var(--info-bg);
  color: var(--info-fg);
  font-size: var(--text-xs);
}

.rss__note {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}
</style>
