<script setup lang="ts">
/**
 * 本房间已绑定设备清单：子系统 / 仅台账 / 已注销徽标 + 两步确认解绑。
 * 解绑确认状态（pendingRemove）只关乎展示，收在本组件内部。
 */
import { ref } from 'vue'
import { Connection, Delete, View } from '@element-plus/icons-vue'
import type { InventoryDeviceRow } from '@/types/scan'

defineProps<{
  devices: InventoryDeviceRow[]
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'remove', deviceCode: string): void
  /** 打开设备详情（复用全局 DeviceDetailDrawer） */
  (e: 'detail', deviceCode: string): void
  /** 请求合并：以该设备为「保留方」，与另一台合并 */
  (e: 'merge', deviceCode: string): void
}>()

const pendingRemove = ref<string | null>(null)

function askRemove(code: string) {
  pendingRemove.value = code
}
function cancelRemove() {
  pendingRemove.value = null
}
function confirmRemove(code: string) {
  pendingRemove.value = null
  emit('remove', code)
}

function descOf(d: InventoryDeviceRow): string {
  return [d.name, d.location_desc].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="room-devices">
    <el-skeleton v-if="loading" :rows="3" animated />
    <p v-else-if="devices.length === 0" class="room-devices__empty">
      该房间暂无绑定设备，扫码即可添加。
    </p>
    <div v-else class="room-devices__list">
      <div v-for="d in devices" :key="d.device_code" class="room-devices__row">
        <div
          class="room-devices__main min-w-0"
          role="button"
          tabindex="0"
          :aria-label="`查看 ${d.device_code} 的设备详情`"
          @click="emit('detail', d.device_code)"
          @keydown.enter="emit('detail', d.device_code)"
          @keydown.space.prevent="emit('detail', d.device_code)"
        >
          <div class="room-devices__tags">
            <span class="room-devices__code mono break-code">{{ d.device_code }}</span>
            <span v-if="d.subsystem_name" class="room-devices__badge">{{ d.subsystem_name }}</span>
            <span v-if="!d.is_registered" class="room-devices__badge room-devices__badge--warn">仅台账</span>
            <span v-if="d.is_active === false" class="room-devices__badge room-devices__badge--muted">已注销</span>
          </div>
          <p v-if="descOf(d)" class="room-devices__desc ellipsis">{{ descOf(d) }}</p>
        </div>
        <div v-if="pendingRemove === d.device_code" class="room-devices__confirm">
          <el-button size="small" type="danger" @click="confirmRemove(d.device_code)">确认移除</el-button>
          <el-button size="small" text @click="cancelRemove">取消</el-button>
        </div>
        <div v-else class="room-devices__ops">
          <el-tooltip content="查看设备详情" :show-after="300" append-to-body>
            <el-button
              size="small"
              text
              class="room-devices__op"
              :aria-label="`查看 ${d.device_code} 的设备详情`"
              @click="emit('detail', d.device_code)"
            >
              <el-icon :size="16"><View /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="与本房间另一台设备合并（减少同类项）" :show-after="300" append-to-body>
            <el-button
              size="small"
              text
              class="room-devices__op"
              :aria-label="`合并 ${d.device_code} 与另一台设备`"
              @click="emit('merge', d.device_code)"
            >
              <el-icon :size="16"><Connection /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="从本房间解绑" :show-after="300" append-to-body>
            <el-button
              size="small"
              text
              class="room-devices__remove"
              :aria-label="`从本房间解绑 ${d.device_code}`"
              @click="askRemove(d.device_code)"
            >
              <el-icon :size="16"><Delete /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-devices { min-width: 0; }
.room-devices__empty { margin: 0; font-size: var(--text-sm); color: var(--muted); }
.room-devices__list { display: flex; flex-direction: column; max-height: 46vh; overflow-y: auto; }
.room-devices__row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border-soft); }
.room-devices__row:last-child { border-bottom: none; }
.room-devices__main { flex: 1 1 auto; cursor: pointer; border-radius: var(--radius-sm); }
.room-devices__main:hover .room-devices__code { color: var(--accent); }
.room-devices__main:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.room-devices__tags { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.room-devices__code { font-size: var(--text-sm); color: var(--fg); }
.room-devices__badge { padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--fg-2); white-space: nowrap; }
.room-devices__badge--warn { border-color: color-mix(in srgb, var(--warn) 35%, #fff); background: var(--warn-bg); color: var(--warn-fg); }
.room-devices__badge--muted { color: var(--meta); }
.room-devices__desc { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.room-devices__confirm { display: flex; align-items: center; gap: var(--space-1); flex: 0 0 auto; }
.room-devices__ops { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.room-devices__op { flex: 0 0 auto; color: var(--meta); }
.room-devices__op:hover { color: var(--accent); }
.room-devices__remove { flex: 0 0 auto; color: var(--meta); }
.room-devices__remove:hover { color: var(--danger); }
</style>
