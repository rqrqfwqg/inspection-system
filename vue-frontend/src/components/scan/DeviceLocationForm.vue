<script setup lang="ts">
/**
 * 位置补录表单（扫码现场用）：
 * 楼栋 → 楼层 → 机房三级联动选择（数据源 rooms），选中机房自动带出楼栋/楼层；
 * 也可不选机房仅手填楼栋/楼层/位置描述。保存走 PUT /assets/devices/{id}（后端级联校验房间存在）。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Location } from '@element-plus/icons-vue'
import { scanUpdateDevice } from '@/api/scan'
import type { ScanDevice, ScanRoom } from '@/types/scan'

const props = defineProps<{
  device: ScanDevice
  rooms: ScanRoom[]
  onSaved?: (updated: ScanDevice) => void
}>()

const saving = ref(false)
const building = ref(props.device.building ?? '')
const floor = ref(props.device.floor ?? '')
const roomCode = ref('')
const locationDesc = ref(props.device.location_desc ?? '')

const active = computed(() => props.rooms.filter((r) => r.is_active !== false))
const buildings = computed(() =>
  Array.from(new Set(active.value.map((r) => r.building).filter(Boolean))).sort(),
)
const floors = computed(() =>
  Array.from(
    new Set(
      active.value.filter((r) => r.building === building.value).map((r) => r.floor).filter(Boolean),
    ),
  ).sort(),
)
const roomOptions = computed(() =>
  active.value.filter((r) => r.building === building.value && (!floor.value || r.floor === floor.value)),
)

/** 楼栋/楼层变更即清空机房选择：机房与楼栋楼层必须一致，不允许出现矛盾组合 */
function onBuildingChange() {
  roomCode.value = ''
}
function onFloorChange() {
  roomCode.value = ''
}

function onRoomPick(code: string) {
  roomCode.value = code
  const room = active.value.find((r) => r.code === code)
  if (room) {
    building.value = room.building
    floor.value = room.floor
  }
}

const canSave = computed(
  () =>
    building.value.trim() !== '' ||
    floor.value.trim() !== '' ||
    locationDesc.value.trim() !== '' ||
    roomCode.value !== '',
)

async function save() {
  const room = roomCode.value ? active.value.find((r) => r.code === roomCode.value) : undefined
  saving.value = true
  try {
    const updated = await scanUpdateDevice(props.device.id, {
      room_id: room ? room.id : null,
      building: room ? room.building : building.value,
      floor: room ? room.floor : floor.value,
      location_desc: locationDesc.value.trim(),
    })
    ElMessage({ type: 'success', message: `位置已保存：${updated.device_code}` })
    props.onSaved?.(updated)
  } catch (e) {
    ElMessage({ type: 'error', message: `保存失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="loc-form">
    <el-form label-position="top" size="default" @submit.prevent>
      <div class="loc-form__grid">
        <el-form-item label="楼栋">
          <el-select v-model="building" aria-label="楼栋" @change="onBuildingChange">
            <el-option label="未指定" value="" />
            <el-option v-for="b in buildings" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼层">
          <el-select v-model="floor" aria-label="楼层" @change="onFloorChange">
            <el-option label="未指定" value="" />
            <el-option v-for="f in floors" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>
      </div>

      <el-form-item :label="`机房（共 ${rooms.length} 间 · 按楼栋/楼层过滤）`">
        <el-select v-model="roomCode" aria-label="机房" @change="onRoomPick">
          <el-option label="不选机房（可手动填楼栋楼层）" value="" />
          <el-option
            v-for="r in roomOptions"
            :key="r.id"
            :label="`${r.code}（${r.name}）`"
            :value="r.code"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="位置描述（现场定位细节，如「3F-A 区走道尽头」）">
        <el-input
          v-model="locationDesc"
          placeholder="柜号 / 参照物 / 图纸标注"
          aria-label="位置描述"
        />
      </el-form-item>

      <el-button type="primary" class="loc-form__save" :loading="saving" :disabled="!canSave" @click="save">
        保存位置
      </el-button>
      <p class="loc-form__note">
        <el-icon :size="14"><Location /></el-icon>
        <span>位置同时作为资产可视化区域树的挂靠依据</span>
      </p>
    </el-form>
  </div>
</template>

<style scoped>
.loc-form { min-width: 0; }
.loc-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.loc-form :deep(.el-select) { width: 100%; }
.loc-form__save { width: 100%; }
.loc-form__note {
  display: flex; align-items: center; gap: var(--space-1);
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs); color: var(--muted);
}
</style>
