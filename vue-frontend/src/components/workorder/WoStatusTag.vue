<script setup lang="ts">
/**
 * 工单状态标签（**自绘**，禁用 `<el-tag type>`）
 * =====================================================================
 * 为什么自绘（UIUX §4 通用约束 #2）：
 *   EP 的 tag type 只有 5 类，覆盖不了工单 7 态 + 预留态；且会引入 EP 默认浅色，
 *   与本项目 token 不一致（同一状态会出现两种绿）。
 * 三通道（WCAG 1.4.1：颜色不是唯一线索）：
 *   图标（16px EP）+ 中文标签 + 状态色标（bg/fg，走 --wo-* token）。
 * 色标来源：`@/types/workOrderMeta` 的 tokenPrefix；本组件**零字面色值**。
 */
import { computed } from 'vue'
import { woStatusMeta, woToneStyle } from '@/types/workOrderMeta'

const props = defineProps<{
  /** 工单状态枚举值（pending_dispatch / assigned / …） */
  status: string | null | undefined
}>()

const meta = computed(() => woStatusMeta(props.status))
const toneStyle = computed(() => woToneStyle(props.status))
</script>

<template>
  <span
    class="wo-tag"
    :class="{ 'is-plain': meta.shape === 'plain', 'is-final': meta.final }"
    :style="toneStyle"
    :title="meta.label"
  >
    <el-icon :size="16"><component :is="meta.icon" /></el-icon>
    <span>{{ meta.label }}</span>
  </span>
</template>
