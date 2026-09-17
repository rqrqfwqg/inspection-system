<script setup lang="ts">
/**
 * 设备基础信息卡（检索页顶部）
 * 只读展示：名称 + 在用状态 + 编号 + 系统 / 楼栋 / 楼层 / 位置。
 * 编号走 `.code-break`（含 `()` `#` 的长编号不得省略），其余字段单行省略。
 */
import { Monitor } from '@element-plus/icons-vue'
import type { Device as DeviceModel } from '@/types/asset'

const props = defineProps<{
  device: DeviceModel | null
}>()

function metaLine(): string[] {
  const device = props.device
  if (!device) return []
  const parts: string[] = []
  if (device.subsystem_name) parts.push(`系统：${device.subsystem_name}`)
  if (device.building) parts.push(`楼栋：${device.building}`)
  if (device.floor) parts.push(`楼层：${device.floor}`)
  if (device.location_desc) parts.push(`位置：${device.location_desc}`)
  return parts
}
</script>

<template>
  <section v-if="device" class="dic panel">
    <el-icon :size="24" class="dic__icon"><Monitor /></el-icon>
    <div class="dic__main min-w-0">
      <div class="dic__title-row">
        <span class="dic__name ellipsis" :title="device.name">{{ device.name || '未命名设备' }}</span>
        <el-tag size="small" :type="device.is_active ? 'success' : 'info'" effect="light">
          {{ device.is_active ? '在用' : '已注销' }}
        </el-tag>
      </div>
      <p class="dic__code">
        设备编号：<span class="mono break-code">{{ device.device_code }}</span>
      </p>
      <p v-if="metaLine().length" class="dic__meta">
        <span v-for="item in metaLine()" :key="item" class="ellipsis">{{ item }}</span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.dic {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}

.dic__icon {
  flex: 0 0 auto;
  color: var(--accent);
}

.dic__main {
  flex: 1 1 auto;
}

.dic__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.dic__name {
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.dic__code {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.dic__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}
</style>
