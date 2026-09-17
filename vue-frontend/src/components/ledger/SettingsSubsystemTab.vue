<script setup lang="ts">
/**
 * 资料配置 · 子系统 Tab
 * =====================================================================
 * 上半：子系统维度的联动覆盖（表数 / 记录数 / 覆盖率 / 登记设备 · 已解析 · 未解析），
 *       数据源同 `/assets/link/overview`（与数据表管理、联动中心一致）。
 * 下半：子系统增删改（SubsystemManager）。
 *
 * 纪律：覆盖率条复用 `components/viz/CoverageBar.vue`；`unresolved` 只在 > 0 时着色强调。
 */
import { fmtPercent } from '@/lib/format'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import SubsystemManager from './SubsystemManager.vue'
import type { Subsystem } from '@/api/dict'
import type { LinkOverview } from '@/types/assetViz'

defineProps<{
  overview: LinkOverview | null
  subsystems: Subsystem[]
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()
</script>

<template>
  <div class="sstab">
    <div v-if="overview" class="sstab__grid">
      <article v-for="item in overview.subsystems" :key="item.id" class="sstab__card">
        <header class="sstab__head">
          <span class="sstab__name ellipsis" :title="item.name">{{ item.name }}</span>
          <span class="sstab__scale tnum">
            {{ item.table_count }} 表 · {{ item.records }} 条
          </span>
        </header>

        <div class="sstab__cov">
          <CoverageBar :value="item.coverage" class="sstab__bar" />
          <span class="sstab__pct tnum">{{ fmtPercent(item.coverage, 0) }}</span>
        </div>

        <p class="sstab__meta">
          登记设备 <span class="tnum">{{ item.devices }}</span>
          <span class="sstab__dot">·</span>
          已解析 <span class="tnum">{{ item.resolved }}</span>
          <span class="sstab__dot">·</span>
          未解析
          <span class="tnum" :class="{ 'sstab__miss': item.unresolved > 0 }">{{ item.unresolved }}</span>
        </p>
      </article>
    </div>

    <p v-else class="sstab__empty">
      联动画像尚未就绪（加载失败可点页头「刷新联动」重试）；下方子系统管理不受影响。
    </p>

    <SubsystemManager :subsystems="subsystems" @changed="emit('changed')" />
  </div>
</template>

<style scoped>
.sstab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.sstab__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
  min-width: 0;
}

.sstab__card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  min-width: 0;
}

.sstab__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.sstab__name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.sstab__scale {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.sstab__cov {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.sstab__bar {
  flex: 1 1 auto;
  min-width: 0;
}

.sstab__pct {
  flex: 0 0 auto;
  min-width: 40px;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.sstab__meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.sstab__dot {
  margin: 0 var(--space-1);
  color: var(--border);
}

.sstab__miss {
  color: var(--danger-fg);
  font-weight: var(--weight-emphasize);
}

.sstab__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}
</style>
