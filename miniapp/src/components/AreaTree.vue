<template>
  <view class="tree">
    <view v-for="n in nodes" :key="n.key" class="node">
      <view
        class="node-row"
        :class="{ active: n.type === 'room' && activeKey === n.key }"
        :style="{ paddingLeft: depth * 28 + 16 + 'rpx' }"
        @tap="onTap(n)"
      >
        <text v-if="n.has_children || n.type === 'room'" class="caret">{{ n.expanded ? '▾' : '▸' }}</text>
        <text v-else class="caret placeholder">·</text>
        <text class="node-label">{{ n.label }}</text>
        <text v-if="n.count > 0" class="node-count">{{ n.count }}</text>
      </view>

      <!-- 展开子层（区域：楼栋/楼层/类型组）—— 继续一层层往下钻 -->
      <view v-if="n.expanded && n.children && n.children.length" class="node-children">
        <AreaTree
          :nodes="n.children"
          :depth="depth + 1"
          :active-key="activeKey"
          @room="onChildRoom"
          @device="onChildDevice"
        />
      </view>

      <!-- 房间展开：内联显示该房间全部设备 + 房间详情入口（不再跳走） -->
      <view v-else-if="n.expanded && n.type === 'room'" class="room-devices">
        <view
          v-if="n.devicesLoading"
          class="node-loading"
          :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
        >
          <text class="sk sk1"></text>
          <text class="sk sk2"></text>
          <text class="sk sk3"></text>
        </view>
        <view
          v-else-if="n.devicesError"
          class="node-error"
          :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
          @tap="reloadDevices(n)"
        >
          加载失败，点击重试
        </view>
        <view
          v-else-if="!n.devices || !n.devices.length"
          class="node-empty"
          :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
        >
          该房间暂未绑定设备
        </view>
        <template v-else>
          <view
            v-for="d in n.devices"
            :key="d.device_code"
            class="dev-row"
            :style="{ paddingLeft: (depth + 1) * 28 + 16 + 'rpx' }"
            @tap="onDeviceTap(d)"
          >
            <text class="dv-dot" :class="{ off: !d.is_registered }"></text>
            <view class="dv-main">
              <text class="dv-name">{{ d.name || d.device_code }}</text>
              <text class="dv-code">{{ d.device_code }}</text>
            </view>
            <text class="dv-arrow">›</text>
          </view>
          <view
            class="room-more"
            :style="{ paddingLeft: (depth + 1) * 28 + 16 + 'rpx' }"
            @tap="onRoomDetail(n)"
          >房间详情 / 去盘点 ›</view>
        </template>
      </view>

      <!-- 非房间节点展开中：骨架占位 -->
      <view
        v-else-if="n.expanded && n.loading"
        class="node-loading"
        :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
      >
        <text class="sk sk1"></text>
        <text class="sk sk2"></text>
        <text class="sk sk3"></text>
      </view>

      <!-- 非房间节点加载失败：与「无下级」区分开，可点击重试 -->
      <view
        v-else-if="n.expanded && n.loadError"
        class="node-error"
        :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
        @tap="reload(n)"
      >
        加载失败，点击重试
      </view>

      <!-- 已展开但确实是空的 -->
      <view
        v-else-if="n.expanded && n.children && !n.children.length"
        class="node-empty"
        :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
      >
        无下级
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { assetAreaTree, assetRoomDevices } from '@/api/asset'
import type { AssetAreaNode, InventoryDeviceRow } from '@/types/asset'

defineOptions({ name: 'AreaTree' })

type TreeRow = AssetAreaNode & {
  expanded?: boolean
  loading?: boolean
  loadError?: string
  children?: AssetAreaNode[]
  devices?: InventoryDeviceRow[]
  devicesLoading?: boolean
  devicesError?: string
}

withDefaults(
  defineProps<{
    nodes: TreeRow[]
    depth?: number
    /** 当前选中的机房节点 key（高亮联动） */
    activeKey?: string
  }>(),
  { depth: 0, activeKey: '' },
)

/**
 * 事件：
 * - `room`   ：点「房间详情 / 去盘点」→ 由上层跳 RoomDetail（地图 + 去盘点 + 打印）
 * - `device` ：点设备行 → 由上层跳 DeviceDetail
 * 区域节点只负责展开下钻，不再抛出任何跳转事件。
 */
const emit = defineEmits<{
  (e: 'room', room: AssetAreaNode): void
  (e: 'device', code: string): void
}>()

function onChildRoom(room: AssetAreaNode) {
  emit('room', room)
}
function onChildDevice(code: string) {
  emit('device', code)
}

async function loadChildren(n: TreeRow) {
  n.loading = true
  n.loadError = ''
  try {
    // 🔴 与根节点 loadTree 保持一致传 group_by_type=false：
    // 根用四級（楼栋→楼层→机房→设备），下钻也必须四級，否则会多冒出一层「房间类型组」
    // （设备机房/卫生间…），层级对不上、用户以为点开没内容。
    const rows = await assetAreaTree({ parent: n.key, group_by_type: false })
    n.children = rows || []
  } catch (e: any) {
    n.children = []
    n.loadError = (e?.message || '').trim() || '加载失败'
  } finally {
    n.loading = false
  }
}

/**
 * 房间节点就地展开时，拉该房间全部设备（复用 GET /assets/rooms/{code}/devices）。
 * 首次展开才拉，之后缓存，折叠再展开不再请求。
 */
async function loadRoomDevices(n: TreeRow) {
  const code = n.meta?.room_code
  if (!code) {
    n.devices = []
    return
  }
  n.devicesLoading = true
  n.devicesError = ''
  try {
    const r = await assetRoomDevices(code)
    n.devices = r.devices || []
  } catch (e: any) {
    n.devices = []
    n.devicesError = (e?.message || '').trim() || '加载失败'
  } finally {
    n.devicesLoading = false
  }
}

async function onTap(n: TreeRow) {
  // 房间节点：内联展开，就地显示设备（不再 navigateTo 跳走）
  if (n.type === 'room') {
    const willExpand = !n.expanded
    n.expanded = willExpand
    if (willExpand && !n.devices && !n.devicesLoading) {
      await loadRoomDevices(n)
    }
    return
  }
  if (!n.has_children) return
  // 区域节点：懒加载逐层下钻
  const willExpand = !n.expanded
  n.expanded = willExpand
  if (willExpand && !n.children) {
    await loadChildren(n)
  }
}

function reload(n: TreeRow) {
  n.children = undefined
  n.expanded = true
  loadChildren(n)
}

function reloadDevices(n: TreeRow) {
  n.devices = undefined
  n.devicesLoading = false
  n.devicesError = ''
  loadRoomDevices(n)
}

function onDeviceTap(d: InventoryDeviceRow) {
  emit('device', d.device_code)
}

function onRoomDetail(n: TreeRow) {
  emit('room', n)
}
</script>

<style scoped lang="scss">
.node-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 20rpx 16rpx;
  border-bottom: 1rpx solid $tm-border-light;
}
/* 选中态：机房节点被选中后高亮，与上层 activeKey 联动 */
.node-row.active {
  background: $tm-primary-bg;
}
.node-row.active .node-label {
  color: $tm-primary;
  font-weight: 600;
}
.caret {
  width: 28rpx;
  color: $tm-text-secondary;
  font-size: 24rpx;
}
.caret.placeholder {
  color: $tm-text-muted;
}
.node-label {
  flex: 1;
  font-size: 28rpx;
  color: $tm-text;
}
.node-count {
  font-size: 22rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}
.node-loading {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 20rpx 0;
}
.sk {
  height: 22rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f2f4f7, #e9ecf1, #f2f4f7);
}
.sk1 { width: 60%; }
.sk2 { width: 80%; }
.sk3 { width: 45%; }
.node-error {
  padding: 20rpx 0;
  font-size: 24rpx;
  color: $tm-danger;
}
.node-empty {
  padding: 18rpx 0;
  font-size: 22rpx;
  color: $tm-text-muted;
}

/* ===== 房间内联设备 ===== */
.dev-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 16rpx;
  border-bottom: 1rpx solid $tm-border-light;
}
.dev-row:active {
  background: $tm-primary-bg;
}
.dv-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: $tm-success;
  flex-shrink: 0;
}
.dv-dot.off {
  background: $tm-text-muted;
}
.dv-main {
  flex: 1;
  min-width: 0;
}
.dv-name {
  font-size: 27rpx;
  color: $tm-text;
}
.dv-code {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.dv-arrow {
  font-size: 30rpx;
  color: $tm-text-muted;
}
.room-more {
  padding: 18rpx 16rpx;
  font-size: 26rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
}
.room-more:active {
  opacity: 0.85;
}
</style>
