<script setup lang="ts">
/**
 * 转移预览与风险提示（转移弹窗的下半区）
 * =====================================================================
 * 干跑（dry_run）结果的呈现：将新建 / 更新 / 跳过各多少条，以及前 5 条被跳过的原因；
 * 同时把「目标表必填字段无来源」这条硬风险显式列出 —— 它直接决定记录会不会被静默跳过。
 *
 * 三态齐全（UIUX §7.2）：预览中 / 有预览 / 暂无预览，不给空白。
 */
import { computed } from 'vue'
import { CircleCheck, Loading, WarningFilled } from '@element-plus/icons-vue'
import type { TransferResult } from '@/types/asset'

const props = defineProps<{
  previewing: boolean
  preview: TransferResult | null
  /** 目标表必填但无来源的字段中文名 */
  requiredGaps: string[]
}>()

const skippedVisible = computed(() => props.preview?.skipped_details.slice(0, 5) ?? [])
const skippedRest = computed(() => Math.max(0, (props.preview?.skipped ?? 0) - skippedVisible.value.length))
</script>

<template>
  <div class="tprev">
    <p v-if="requiredGaps.length > 0" class="tprev__warn">
      <el-icon :size="16"><WarningFilled /></el-icon>
      <span>
        目标表有必填字段无来源：<span class="tprev__strong">{{ requiredGaps.join('、') }}</span>。
        请在映射表里为其指定来源字段，否则对应记录会被跳过。
      </span>
    </p>

    <div class="tprev__box">
      <p class="tprev__line">
        <template v-if="previewing">
          <el-icon :size="16" class="tprev__spin"><Loading /></el-icon>
          <span>正在按当前映射干跑预览…</span>
        </template>
        <template v-else-if="preview">
          <el-icon :size="16" class="tprev__ok"><CircleCheck /></el-icon>
          <span class="tnum">
            预览：新建 {{ preview.created }} 条 · 更新 {{ preview.updated }} 条 · 跳过 {{ preview.skipped }} 条
          </span>
          <span v-if="preview.conflicts > 0" class="tnum">（其中编号冲突 {{ preview.conflicts }} 条）</span>
        </template>
        <span v-else class="tprev__idle">尚未产生预览：请先选择目标资料表。</span>
      </p>

      <ul v-if="!previewing && skippedVisible.length > 0" class="tprev__skips">
        <li v-for="item in skippedVisible" :key="item.record_id">
          <span class="mono break-code">{{ item.device_code || `记录 #${item.record_id}` }}</span>
          <span>：{{ item.reason }}</span>
        </li>
        <li v-if="skippedRest > 0">…另有 {{ skippedRest }} 条被跳过</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.tprev {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.tprev__warn {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--warn-bg);
  color: var(--warn-fg);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
}

.tprev__strong {
  font-weight: var(--weight-emphasize);
}

.tprev__box {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  min-width: 0;
}

.tprev__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.tprev__spin {
  color: var(--accent);
}

.tprev__ok {
  color: var(--success);
}

.tprev__idle {
  color: var(--muted);
}

.tprev__skips {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--text-xs);
  color: var(--warn-fg);
}
</style>
