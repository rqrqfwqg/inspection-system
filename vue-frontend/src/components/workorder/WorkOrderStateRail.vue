<script setup lang="ts">
/**
 * 工单状态机进度条（6 段主链 —— UIUX 页面 2）
 * =====================================================================
 * 主链：待派单 → 已派单 → 处理中 → 已完成 → 待验收 → 已关闭
 * 旁路态（已取消）以小 Tag 挂在右端，**不占主链段位**。
 * 段：10px 圆点 + 1px 连线 + 段名（--text-xs）；已完成/当前点取当前状态 --tone-fg，
 *     未来段取 --border；当前段加 2px 环。连线 1px，**不用渐变**（细线一律 >=4.5:1）。
 */
import { computed } from 'vue'
import WoStatusTag from '@/components/workorder/WoStatusTag.vue'
import { WO_FLOW, woStatusLabel, woToneStyle } from '@/types/workOrderMeta'

const props = defineProps<{ status: string | null | undefined }>()

const currentIndex = computed(() => (props.status ? WO_FLOW.indexOf(props.status as never) : -1))

const steps = computed(() =>
  WO_FLOW.map((s, i) => ({
    value: s,
    label: woStatusLabel(s),
    state: currentIndex.value < 0 ? 'future' : i < currentIndex.value ? 'done' : i === currentIndex.value ? 'current' : 'future',
  })),
)

/** 不在主链上的状态（cancelled 等）作为旁路 Tag 展示 */
const bypass = computed(() =>
  props.status && currentIndex.value < 0 ? props.status : null,
)

const toneStyle = computed(() => woToneStyle(props.status))
</script>

<template>
  <div class="rail panel" :style="toneStyle">
    <ol class="wo-rail" aria-label="工单状态机进度">
      <template v-for="(step, i) in steps" :key="step.value">
        <li v-if="i > 0" class="wo-rail__sep" aria-hidden="true" />
        <li class="wo-rail__step" :class="{ 'is-done': step.state === 'done', 'is-current': step.state === 'current' }">
          <span class="wo-rail__dot" aria-hidden="true" />
          <span>{{ step.label }}</span>
        </li>
      </template>
    </ol>

    <div v-if="bypass" class="rail__bypass">
      <span class="rail__bypass-label">旁路</span>
      <WoStatusTag :status="bypass" />
    </div>
  </div>
</template>

<style scoped>
.rail {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) var(--space-4);
  min-width: 0;
}
/* 语义列表默认样式归零（ol/li） */
.wo-rail { list-style: none; margin: 0; padding: 0; }
.rail__bypass {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: 0 0 auto;
}
.rail__bypass-label { font-size: var(--text-xs); color: var(--muted); }

/* <1024px 折为竖向列表（UIUX 页面 2 约束） */
@media (max-width: 1023px) {
  .rail { flex-direction: column; align-items: flex-start; }
  .wo-rail { flex-direction: column; align-items: flex-start; }
  .wo-rail :deep(.wo-rail__sep) { display: none; }
}
</style>
