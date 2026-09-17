<script setup lang="ts">
/**
 * 单张资料表的「数据画像」区块（资料配置 → 资料表与字段）
 * =====================================================================
 * 数据源 `GET /assets/link/table/{tid}`（真实库），展示覆盖率 / 记录数 / 命中与去重设备数 /
 * 未解析编号及其 TOP 清单（对应不到设备台账 / 机房的编号）。
 *
 * 纪律：`unresolved > 0` 才用危险色强调；0 不刷屏；编号走 `.break-code` 不省略（编号少一位就查不到）。
 */
import { computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { fmtPercent } from '@/lib/format'
import type { LinkTableDetail } from '@/types/assetViz'

const props = defineProps<{
  detail: LinkTableDetail
}>()

const coverageType = computed<'success' | 'warning' | 'danger'>(() => {
  const value = props.detail.coverage.coverage
  if (value >= 0.9) return 'success'
  if (value >= 0.5) return 'warning'
  return 'danger'
})
</script>

<template>
  <section class="tpp">
    <header class="tpp__head">
      <span class="tpp__title">数据画像</span>
      <el-tag size="small" effect="light" :type="coverageType">
        覆盖率 {{ fmtPercent(detail.coverage.coverage, 0) }}
      </el-tag>
      <router-link
        v-if="detail.coverage.unresolved > 0"
        class="tpp__go"
        :to="{ path: '/asset-viz', query: { tab: 'link' } }"
      >
        <span>去联动中心处理</span>
        <el-icon :size="14"><ArrowRight /></el-icon>
      </router-link>
    </header>

    <div class="tpp__metrics">
      <div class="tpp__metric">
        <span class="tpp__metric-label">记录数</span>
        <span class="tpp__metric-value tnum">{{ detail.coverage.records }}</span>
      </div>
      <div class="tpp__metric">
        <span class="tpp__metric-label">命中设备（记录）</span>
        <span class="tpp__metric-value tnum">{{ detail.coverage.resolved_devices }}</span>
      </div>
      <div class="tpp__metric">
        <span class="tpp__metric-label">去重设备</span>
        <span class="tpp__metric-value tnum">{{ detail.coverage.distinct_devices }}</span>
      </div>
      <div class="tpp__metric">
        <span class="tpp__metric-label">未解析编号</span>
        <span
          class="tpp__metric-value tnum"
          :class="{ 'tpp__miss': detail.coverage.unresolved > 0 }"
        >
          {{ detail.coverage.unresolved }}
        </span>
      </div>
    </div>

    <p class="tpp__extra">
      <span>命中机房 <span class="tnum">{{ detail.coverage.resolved_rooms }}</span></span>
      <span>空关联键 <span class="tnum">{{ detail.coverage.empty_code }}</span></span>
      <span>
        关联边 自动 <span class="tnum">{{ detail.relations.auto }}</span> /
        人工 <span class="tnum">{{ detail.relations.manual }}</span>
      </span>
      <span>涉及编号 <span class="tnum">{{ detail.relations.distinct_codes }}</span></span>
    </p>

    <div v-if="detail.unresolved_top.length > 0" class="tpp__unresolved">
      <span class="tpp__unresolved-title">未解析编号 TOP（对应不到设备台账 / 机房）</span>
      <div class="tpp__chips">
        <span
          v-for="item in detail.unresolved_top.slice(0, 12)"
          :key="item.code"
          class="tpp__chip mono break-code"
          :title="`${item.code} · ${item.records} 条记录`"
        >
          <span>{{ item.code }}</span>
          <span class="tpp__chip-n tnum">×{{ item.records }}</span>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tpp {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  min-width: 0;
}

.tpp__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.tpp__title {
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.tpp__go {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--accent);
  text-decoration: none;
}

.tpp__go:hover {
  text-decoration: underline;
}

.tpp__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
  min-width: 0;
}

@media (max-width: 1023px) {
  .tpp__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.tpp__metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.tpp__metric-label {
  font-size: var(--text-xs);
  color: var(--muted);
}

.tpp__metric-value {
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.tpp__miss {
  color: var(--danger-fg);
}

.tpp__extra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.tpp__unresolved {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.tpp__unresolved-title {
  font-size: var(--text-xs);
  color: var(--muted);
}

.tpp__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
}

.tpp__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 2px var(--space-2);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: var(--text-xs);
}

.tpp__chip-n {
  color: var(--muted);
}
</style>
