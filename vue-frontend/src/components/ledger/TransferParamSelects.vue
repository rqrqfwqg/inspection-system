<script setup lang="ts">
/**
 * 记录跨表转移 · 参数选择行（目标表 / 转移方式 / 冲突策略）
 * =====================================================================
 * 从 `RecordTransferDialog` 抽出，降低单文件行数（ARCHITECTURE §7 规则 2）。
 * 本组件**纯受控**：状态由弹窗持有，只把变更回传（`update:*`）。
 *
 * 纪律：宽度用 `flex: 1 1 220px` 自适应折行，不写死像素（AS-8）。
 */
import type { DataTable } from '@/types/asset'

defineProps<{
  targetId: string
  mode: 'move' | 'copy'
  conflict: 'skip' | 'update' | 'duplicate'
  candidates: DataTable[]
}>()

const emit = defineEmits<{
  (e: 'update:targetId', value: string): void
  (e: 'update:mode', value: 'move' | 'copy'): void
  (e: 'update:conflict', value: 'skip' | 'update' | 'duplicate'): void
}>()
</script>

<template>
  <div class="tps">
    <label class="tps__param">
      <span class="tps__label">目标资料表</span>
      <el-select
        :model-value="targetId"
        class="tps__ctl"
        filterable
        placeholder="选择要转移到的表"
        @update:model-value="emit('update:targetId', $event)"
      >
        <el-option
          v-for="table in candidates"
          :key="table.id"
          :label="table.subsystem_name ? `${table.name}（${table.subsystem_name}）` : table.name"
          :value="String(table.id)"
        />
      </el-select>
    </label>

    <label class="tps__param">
      <span class="tps__label">转移方式</span>
      <el-select :model-value="mode" class="tps__ctl" @update:model-value="emit('update:mode', $event)">
        <el-option label="移动（源表删除）" value="move" />
        <el-option label="复制（源表保留）" value="copy" />
      </el-select>
    </label>

    <label class="tps__param">
      <span class="tps__label">编号冲突时</span>
      <el-select :model-value="conflict" class="tps__ctl" @update:model-value="emit('update:conflict', $event)">
        <el-option label="跳过（不覆盖）" value="skip" />
        <el-option label="覆盖更新已有记录" value="update" />
        <el-option label="仍然新建一条" value="duplicate" />
      </el-select>
    </label>
  </div>
</template>

<style scoped>
.tps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  min-width: 0;
}

/* 三列参数：窄档自然折行，不写死宽度 */
.tps__param {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1 1 220px;
  min-width: 0;
}

.tps__label {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.tps__ctl {
  width: 100%;
}
</style>
