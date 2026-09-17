<script setup lang="ts">
/**
 * 资料配置 · 全局联动总览条（6 个 KPI）
 * =====================================================================
 * 与「数据表管理」同源（`GET /assets/link/overview`），永远反映真实库：
 * 资料表 / 字段定义 / 资料记录 / 关联边 / 自动·人工 / 关联键覆盖率。
 *
 * 纪律：画像未就绪一律显示 `—`（**不显示 0**，0 与「未知」必须可区分）；
 * 数字用 `.tnum` 逐位对齐；占比用 `@/lib/format#fmtPercent`（全站唯一口径）。
 */
import { computed } from 'vue'
import { fmtPercent } from '@/lib/format'
import type { LinkOverview } from '@/types/assetViz'

const props = defineProps<{
  overview: LinkOverview | null
  /** 关联边列表长度（画像不可用时的兜底口径） */
  relationCount: number
}>()

interface Kpi {
  label: string
  value: string
}

const items = computed<Kpi[]>(() => {
  const ov = props.overview
  const bySource = ov?.relations_by_source
  return [
    { label: '资料表', value: ov ? String(ov.global.tables) : '—' },
    { label: '字段定义', value: ov ? String(ov.global.fields) : '—' },
    { label: '资料记录', value: ov ? String(ov.global.records) : '—' },
    { label: '关联边', value: ov ? String(ov.global.relations) : String(props.relationCount) },
    {
      label: '自动 / 人工',
      value: bySource ? `${bySource.auto} / ${bySource.manual}` : '—',
    },
    { label: '关联键覆盖率', value: ov ? fmtPercent(ov.global.coverage, 0) : '—' },
  ]
})
</script>

<template>
  <div class="kpi">
    <article v-for="item in items" :key="item.label" class="panel kpi__card">
      <span class="kpi__label">{{ item.label }}</span>
      <span class="kpi__value tnum">{{ item.value }}</span>
    </article>
  </div>
</template>

<style scoped>
.kpi {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-3);
  min-width: 0;
}

@media (max-width: 1535px) {
  .kpi {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1023px) {
  .kpi {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.kpi__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  min-width: 0;
}

.kpi__label {
  font-size: var(--text-xs);
  color: var(--muted);
}

.kpi__value {
  font-size: var(--text-xl);
  font-weight: var(--weight-announce);
  color: var(--fg);
}
</style>
