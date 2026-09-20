<script setup lang="ts">
/**
 * 优先级标记（UIUX §1.4）
 * =====================================================================
 * 反模式规避：**不给 4 档优先级各配一个颜色**（否则与状态色在同一行产生 8 个色块）。
 * 表达方式：图标 + 中文；仅 urgent 用 danger 底（走 token），high 加粗。
 */
import { computed } from 'vue'
import { Flag } from '@element-plus/icons-vue'
import { woPriorityLabel } from '@/types/workOrderMeta'

const props = defineProps<{ priority: string | null | undefined }>()

const label = computed(() => woPriorityLabel(props.priority))
const isHigh = computed(() => props.priority === 'high')
const isUrgent = computed(() => props.priority === 'urgent')
const showIcon = computed(() => isHigh.value || isUrgent.value)
</script>

<template>
  <span class="wo-prio" :class="{ 'is-high': isHigh, 'is-urgent': isUrgent }">
    <el-icon v-if="showIcon" :size="16"><Flag /></el-icon>
    <span>{{ label }}</span>
  </span>
</template>
