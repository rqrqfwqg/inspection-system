<script setup lang="ts">
/** 概览 · 资料表联动明细 —— 记录数 TOP N，可直达数据表管理 */
import { Files } from '@element-plus/icons-vue'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import { fmtInt } from '@/lib/format'
import type { LinkTableStat } from '@/types/assetViz'

defineProps<{ rows: LinkTableStat[]; filtered: boolean }>()
const emit = defineEmits<{ (e: 'open-table', tableId: number): void }>()
</script>

<template>
  <section class="otp panel">
    <header class="panel-head">
      <h3 class="panel-title otp__title">
        <el-icon :size="16"><Files /></el-icon>
        <span>资料表联动明细</span>
        <span class="otp__note">记录数 TOP {{ rows.length }}{{ filtered ? '（当前过滤范围内）' : '' }}</span>
      </h3>
    </header>
    <p class="otp__desc">点「打开表」直接进入数据表管理维护记录 —— 概览与数据表管理看的是同一份数据。</p>
    <el-table :data="rows" size="small" class="otp__table" empty-text="暂无资料表">
      <el-table-column prop="name" label="资料表" min-width="200" show-overflow-tooltip />
      <el-table-column prop="subsystem_name" label="子系统" min-width="140" show-overflow-tooltip />
      <el-table-column label="关联键" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.relation_key_label || '—' }}</template>
      </el-table-column>
      <el-table-column label="记录数" min-width="100" align="right">
        <template #default="{ row }"><span class="tnum">{{ fmtInt(row.records) }}</span></template>
      </el-table-column>
      <el-table-column label="命中设备" min-width="100" align="right">
        <template #default="{ row }"><span class="tnum otp__muted">{{ fmtInt(row.distinct_devices) }}</span></template>
      </el-table-column>
      <el-table-column label="覆盖率" min-width="190">
        <template #default="{ row }"><CoverageBar :value="row.coverage" note="已关联" /></template>
      </el-table-column>
      <el-table-column label="操作" min-width="110">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="emit('open-table', row.table_id)">打开表</el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.otp__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.otp__note {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.otp__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.otp__table {
  width: 100%;
}

.otp__muted { color: var(--fg-2); }
</style>
