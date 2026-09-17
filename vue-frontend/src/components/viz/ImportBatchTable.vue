<script setup lang="ts">
/**
 * 导入批次表（导入子视图底部）—— 时间字段按 UTC +8 显示为北京时间（见 lib/format 铁律）。
 * 状态：done=完成 / partial=部分 / 其它=失败。
 */
import { computed } from 'vue'
import { Clock, Refresh } from '@element-plus/icons-vue'
import { fmtBeijingUtc } from '@/lib/format'
import type { ImportBatch } from '@/types/assetViz'

const props = defineProps<{ batches: ImportBatch[]; loading: boolean }>()
const emit = defineEmits<{ (e: 'refresh'): void }>()

const rows = computed(() =>
  props.batches.map((b, i) => {
    const st = (b.status ?? 'done') as string
    const tone = st === 'done' ? 'success' : st === 'partial' ? 'warning' : 'danger'
    const label = st === 'done' ? '完成' : st === 'partial' ? '部分' : '失败'
    return {
      key: b.id ?? i,
      name: String(b.batch_name ?? '—'),
      source: String(b.source_type ?? '—'),
      fileCount: b.file_count ?? 0,
      rowCount: b.row_count ?? 0,
      tone,
      label,
      startedAt: fmtBeijingUtc(b.started_at),
      finishedAt: fmtBeijingUtc(b.finished_at),
    }
  }),
)
</script>

<template>
  <section class="ibt panel">
    <header class="panel-head ibt__head">
      <h3 class="panel-title ibt__title"><span>导入批次</span></h3>
      <el-button size="small" :loading="loading" @click="emit('refresh')">
        <el-icon v-if="!loading" :size="16"><Refresh /></el-icon>
        <span>刷新</span>
      </el-button>
    </header>

    <el-table :data="rows" size="small" class="ibt__table" empty-text="暂无导入批次记录。">
      <el-table-column prop="name" label="批次名" min-width="200" show-overflow-tooltip />
      <el-table-column prop="source" label="类型" min-width="140" show-overflow-tooltip />
      <el-table-column label="文件数" min-width="90" align="right">
        <template #default="{ row }"><span class="tnum">{{ row.fileCount }}</span></template>
      </el-table-column>
      <el-table-column label="行数" min-width="90" align="right">
        <template #default="{ row }"><span class="tnum">{{ row.rowCount }}</span></template>
      </el-table-column>
      <el-table-column label="状态" min-width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.tone" effect="light">{{ row.label }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="开始时间" min-width="160">
        <template #default="{ row }">
          <span class="ibt__time">
            <el-icon :size="16"><Clock /></el-icon>{{ row.startedAt }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="finishedAt" label="结束时间" min-width="160" />
    </el-table>
  </section>
</template>

<style scoped>
.ibt {
  min-width: 0;
}

.ibt__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ibt__title {
  font-size: var(--text-base);
}

.ibt__table {
  width: 100%;
}

.ibt__time {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
  color: var(--fg-2);
}
</style>
