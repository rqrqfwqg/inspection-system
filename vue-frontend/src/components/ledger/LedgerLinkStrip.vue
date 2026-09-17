<script setup lang="ts">
/**
 * 单表「联动画像」信息条（数据表管理 → 单表页头下方）
 * =====================================================================
 * 数据源 `GET /assets/link/table/{tid}`，与「资料配置 / 联动中心」**同源**，
 * 保证覆盖率、自动/人工关联数在三处永远一致（避免各页自算口径漂移）。
 *
 * 纪律：`unresolved > 0` 才提示「未解析」（0 不刷屏）；所有数字用 `.tnum` 逐位对齐；
 * 跳「联动中心」用 `router-link`（不手写 `window.location`，保留 SPA 导航）。
 */
import { CircleCheck, Connection, Cpu, Pointer, TopRight } from '@element-plus/icons-vue'
import type { LinkTableDetail } from '@/types/assetViz'

defineProps<{
  detail: LinkTableDetail
}>()
</script>

<template>
  <div class="lls">
    <span class="lls__item">
      <el-icon :size="14" class="lls__ok"><CircleCheck /></el-icon>
      <span>命中设备 <span class="tnum">{{ detail.coverage.resolved_devices }}</span></span>
      <span class="lls__sep">·</span>
      <span>机房 <span class="tnum">{{ detail.coverage.resolved_rooms }}</span></span>
    </span>

    <span class="lls__item">
      <el-icon :size="14" class="lls__dim"><Cpu /></el-icon>
      <span>去重设备 <span class="tnum">{{ detail.coverage.distinct_devices }}</span></span>
    </span>

    <span class="lls__item lls__item--auto">
      <el-icon :size="14"><Connection /></el-icon>
      <span>自动关联 <span class="tnum">{{ detail.relations.auto }}</span></span>
    </span>

    <span class="lls__item">
      <el-icon :size="14" class="lls__dim"><Pointer /></el-icon>
      <span>人工关联 <span class="tnum">{{ detail.relations.manual }}</span></span>
    </span>

    <span v-if="detail.coverage.unresolved > 0" class="lls__miss">
      未解析 <span class="tnum">{{ detail.coverage.unresolved }}</span>
    </span>

    <router-link class="lls__go" :to="{ path: '/asset-viz', query: { tab: 'link' } }">
      <el-icon :size="14"><TopRight /></el-icon>
      <span>联动中心</span>
    </router-link>
  </div>
</template>

<style scoped>
.lls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  font-size: var(--text-xs);
  min-width: 0;
}

.lls__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--fg-2);
  min-width: 0;
}

.lls__sep {
  color: var(--border);
}

.lls__item--auto {
  color: var(--info-fg);
}

.lls__ok {
  color: var(--success);
}

.lls__dim {
  color: var(--muted);
}

.lls__miss {
  color: var(--warn-fg);
}

.lls__go {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
  color: var(--accent);
  text-decoration: none;
}

.lls__go:hover {
  text-decoration: underline;
}
</style>
