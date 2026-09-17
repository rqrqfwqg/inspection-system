<script setup lang="ts">
/** 概览 · 子系统联动覆盖表 —— 每个子系统下资料表 / 记录数 / 命中 / 覆盖率 */
import { Grid, Link, Refresh } from '@element-plus/icons-vue'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import { fmtInt } from '@/lib/format'
import type { LinkSubsystemStat } from '@/types/assetViz'

defineProps<{ rows: LinkSubsystemStat[]; loading: boolean }>()
const emit = defineEmits<{ (e: 'refresh'): void; (e: 'go-link'): void }>()
</script>

<template>
  <section class="osp panel">
    <header class="panel-head osp__head">
      <h3 class="panel-title osp__title">
        <el-icon :size="16"><Grid /></el-icon>
        <span>子系统联动覆盖</span>
      </h3>
      <span class="osp__actions">
        <el-button size="small" :loading="loading" @click="emit('refresh')">
          <el-icon v-if="!loading" :size="16"><Refresh /></el-icon>
          <span>刷新</span>
        </el-button>
        <el-button size="small" @click="emit('go-link')">
          <el-icon :size="16"><Link /></el-icon>
          <span>联动中心</span>
        </el-button>
      </span>
    </header>
    <p class="osp__desc">
      每个子系统下有多少张资料表、多少条资料记录真正挂到了设备/机房上。
      「命中」= 资料记录的关联键能在设备台账或机房表中找到对应行。
    </p>
    <el-table :data="rows" size="small" class="osp__table" empty-text="暂无数据">
      <el-table-column prop="name" label="子系统" min-width="160" show-overflow-tooltip />
      <el-table-column label="资料表" min-width="90" align="right">
        <template #default="{ row }"><span class="tnum">{{ fmtInt(row.table_count) }}</span></template>
      </el-table-column>
      <el-table-column label="记录数" min-width="100" align="right">
        <template #default="{ row }"><span class="tnum">{{ fmtInt(row.records) }}</span></template>
      </el-table-column>
      <el-table-column label="登记设备" min-width="100" align="right">
        <template #default="{ row }"><span class="tnum osp__muted">{{ fmtInt(row.devices) }}</span></template>
      </el-table-column>
      <el-table-column label="命中" min-width="90" align="right">
        <template #default="{ row }"><span class="tnum osp__ok">{{ fmtInt(row.resolved) }}</span></template>
      </el-table-column>
      <el-table-column label="覆盖率" min-width="170">
        <template #default="{ row }"><CoverageBar :value="row.coverage" /></template>
      </el-table-column>
      <el-table-column label="未命中" min-width="90" align="right">
        <template #default="{ row }">
          <span class="tnum" :class="row.unresolved > 0 ? 'osp__warn' : 'osp__muted'">
            {{ fmtInt(row.unresolved) }}
          </span>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.osp__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.osp__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.osp__actions {
  display: inline-flex;
  gap: var(--space-2);
}

.osp__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.osp__table {
  width: 100%;
}

.osp__muted { color: var(--fg-2); }
.osp__ok { color: var(--success-fg); }
.osp__warn { color: var(--warn-fg); }
</style>
