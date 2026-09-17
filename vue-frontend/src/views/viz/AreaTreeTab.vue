<script setup lang="ts">
/**
 * 区域树 Tab（/asset-viz?tab=area）
 * 楼栋 → 楼层 → 房间类型组 → 机房（名称（房间号））→ 设备 逐级下钻，
 * 右侧为所选范围内设备清单；类型组可用「按房间类型分组」开关退回四级。
 *
 * 关键字由后端过滤（真实台账设备名/编号），前端 300ms 防抖，绝不本地全量拉取。
 */
import { computed, ref, watch } from 'vue'
import { Cpu, MapLocation, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AreaTree from '@/components/viz/AreaTree.vue'
import type { RelNode } from '@/types/assetViz'

const emit = defineEmits<{ (e: 'open-device', code: string): void }>()

const input = ref('')
const keyword = ref('')
const onlyWithDevices = ref(false)
const groupByType = ref(true)
const refreshToken = ref(0)
const selectedKey = ref('')
const rangeTitle = ref('')
const rangeNote = ref('')
const rangeDevices = ref<RelNode[]>([])

let timer = 0
watch(input, (v) => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    keyword.value = v.trim()
  }, 300)
})

const treeTitle = computed(
  () => `区域树（楼栋 → 楼层 → ${groupByType.value ? '类型 → ' : ''}机房 → 设备）`,
)

function onLoadError(msg: string) {
  ElMessage({ type: 'error', message: msg, duration: 3000 })
}

function onSelectRange(node: RelNode, devices: RelNode[]) {
  selectedKey.value = node.key
  const building = String(node.meta?.building ?? '')
  const floor = String(node.meta?.floor ?? '')
  rangeTitle.value =
    node.type === 'room_type' ? `${building} ${floor} · ${node.label}`.trim() : node.label
  rangeDevices.value = devices
  if (node.type === 'room') {
    const self = node.meta?.self_record
    rangeNote.value = self ? `机房本体档案：${String(self)}` : ''
  } else if (node.type === 'room_type') {
    rangeNote.value = `${Number(node.meta?.room_count ?? 0)} 间 ${node.label}`
  } else {
    const rooms = new Set(devices.map((d) => String(d.meta?.room_code ?? '')))
    rangeNote.value = `覆盖 ${rooms.size} 间机房`
  }
}

function onSelectOther(node: RelNode) {
  selectedKey.value = node.key
  if (node.type !== 'building') return
  rangeTitle.value = node.label
  rangeDevices.value = []
  const pending = Number(node.meta?.asset_pending ?? 0)
  rangeNote.value =
    `${Number(node.meta?.room_count ?? 0)} 间机房 / ${Number(node.meta?.floor_count ?? 0)} 个楼层` +
    (pending ? ` · 固定资产待核实归属 ${pending}` : '')
}

function reset() {
  input.value = ''
  keyword.value = ''
  onlyWithDevices.value = false
  groupByType.value = true
  selectedKey.value = ''
  rangeTitle.value = ''
  rangeNote.value = ''
  rangeDevices.value = []
  refreshToken.value += 1
}

function refresh() {
  refreshToken.value += 1
}

function deviceCode(node: RelNode): string {
  return String(node.meta?.device_code ?? '')
}
</script>

<template>
  <div class="area">
    <div class="area__bar panel">
      <el-input
        v-model="input"
        class="area__search"
        clearable
        :prefix-icon="Search"
        placeholder="搜索机房或设备：名称 / 编号，如 空调机房 / KTJF-101 / PDF-107"
      />
      <el-button-group>
        <el-button :type="groupByType ? 'primary' : 'default'" @click="groupByType = !groupByType">
          按房间类型分组
        </el-button>
        <el-button
          :type="onlyWithDevices ? 'primary' : 'default'"
          @click="onlyWithDevices = !onlyWithDevices"
        >
          仅有设备的机房
        </el-button>
      </el-button-group>
      <el-button @click="reset">重置</el-button>
      <el-button @click="refresh">
        <el-icon :size="16"><Refresh /></el-icon>
        <span>刷新</span>
      </el-button>
      <span class="area__hint">
        「按房间类型分组」把同类型房间并在一个分组下（楼栋 → 楼层 → 类型 → 机房 → 设备）。
      </span>
    </div>

    <div class="area__grid">
      <section class="panel area__tree">
        <header class="panel-head">
          <h2 class="panel-title area__title">
            <el-icon :size="16"><MapLocation /></el-icon>
            {{ treeTitle }}
          </h2>
        </header>
        <AreaTree
          :keyword="keyword"
          :only-with-devices="onlyWithDevices"
          :group-by-type="groupByType"
          :refresh-token="refreshToken"
          :selected-key="selectedKey"
          @open-device="emit('open-device', $event)"
          @select-range="onSelectRange"
          @select-other="onSelectOther"
          @load-error="onLoadError"
        />
      </section>

      <section class="panel area__range">
        <header class="panel-head">
          <h2 class="panel-title area__title">
            <el-icon :size="16"><Cpu /></el-icon>
            范围内设备
          </h2>
        </header>

        <p v-if="!rangeTitle" class="area__note">
          点选左侧楼栋 / 楼层 / 类型组 / 机房，这里列出其范围内已归属的设备；点设备编号可打开详情。
        </p>

        <div v-else class="area__range-body">
          <p class="area__range-title break-code">{{ rangeTitle }}</p>
          <p class="area__note">
            {{ rangeDevices.length }} 台{{ rangeNote ? ` · ${rangeNote}` : '' }}
          </p>
          <ul v-if="rangeDevices.length" class="area__devices">
            <li v-for="d in rangeDevices" :key="d.key" class="area__device">
              <button type="button" class="area__dev-btn" @click="emit('open-device', deviceCode(d))">
                <el-icon :size="16" class="area__dev-icon"><Cpu /></el-icon>
                <span class="area__dev-label ellipsis" :title="d.label">{{ d.label }}</span>
                <el-tag
                  v-if="d.meta?.subsystem_name"
                  size="small"
                  type="info"
                  effect="plain"
                  class="area__dev-tag"
                >
                  {{ String(d.meta.subsystem_name) }}
                </el-tag>
              </button>
            </li>
          </ul>
          <p v-else class="area__note">该范围内暂无已归属设备。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.area {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.area__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.area__search {
  flex: 1 1 260px;
  min-width: 0;
  max-width: 420px;
}

.area__hint {
  flex: 1 1 200px;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

/* 左树宽、右清单窄；min-width:0 防长编号把栅格撑破 */
.area__grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

.area__tree,
.area__range {
  min-width: 0;
}

.area__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.area__note {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.area__range-body {
  min-width: 0;
}

.area__range-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.area__devices {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  max-height: 52vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.area__dev-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.area__dev-btn:hover {
  background: var(--accent-soft);
}

.area__dev-icon {
  color: var(--accent);
}

.area__dev-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.area__dev-tag {
  flex: 0 0 auto;
}

@media (max-width: 1279px) {
  .area__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
