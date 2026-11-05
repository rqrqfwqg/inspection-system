<template>
  <view class="page" :class="{ 'page-with-geo': showGeoLane }">
    <!-- ============ 房间头部 ============ -->
    <view class="head">
      <view class="h-top">
        <text class="h-name">{{ room?.name || roomCode }}</text>
        <text class="h-dot" :style="{ background: statusColor }"></text>
        <text class="h-st" :style="{ color: statusColor }">{{ statusLabel }}</text>
      </view>
      <view class="h-meta">{{ room?.code }} · {{ room?.building }} · {{ room?.floor }}</view>
      <view class="h-stat">
        <text class="h-dev">{{ room?.deviceCount ?? 0 }} 台设备</text>
        <text
          v-if="room?.status === INV_STATUS.DOING || room?.status === INV_STATUS.ABNORMAL"
          class="h-prog"
        >已扫 {{ room?.scannedCount ?? 0 }}/{{ room?.deviceCount ?? 0 }}</text>
        <text v-if="room?.emptyConfirmed" class="h-empty">空房确认</text>
        <text v-if="room?.inspectedAt" class="h-time">{{ fmtTime(room.inspectedAt) }} · {{ room.inspector }}</text>
      </view>
      <view v-if="room?.status === INV_STATUS.ABNORMAL && room?.abnormalReason" class="h-abn">
        ⚠ {{ room.abnormalReason }}
      </view>
    </view>

    <!-- ============ 设备清单（逐台核对） ============ -->
    <view class="dev-panel">
      <view class="dp-head" @tap="devOpen = !devOpen">
        <text class="dp-title">
          设备清单
          <text class="dp-caret">{{ devOpen ? '▾' : '▸' }}</text>
        </text>
        <text class="dp-count" v-if="roomDevices.length">已核对 {{ devCheckedCount }}/{{ roomDevices.length }}</text>
        <text class="dp-count dp-empty-hint" v-else-if="!devLoading">共 0 台</text>
      </view>

      <view class="dp-body" v-if="devOpen">
        <view v-if="devLoading" class="dp-hint">清单加载中…</view>

        <view v-else-if="devError" class="dp-err" @tap="roomCode && loadRoom(roomCode)">
          <text>清单加载失败：{{ devError }}</text>
          <text class="dp-retry">点击重试</text>
        </view>

        <view v-else-if="!roomDevices.length" class="dp-hint">
          本房间暂无绑定设备。如现场实际有设备，点下方「扫码绑定」即可挂入；确无设备可点「空房间完成盘点」直接完成。
        </view>

        <view v-else>
          <view
            v-for="d in roomDevices"
            :key="d.device_code"
            class="dev-row"
            :class="{ checked: d.checked, added: d.added }"
            @tap="onDeviceTap(d)"
          >
            <view class="dr-box" :class="{ on: d.checked }">
              <text v-if="d.checked" class="dr-tick">✓</text>
            </view>
            <view class="dr-main">
              <view class="dr-code">{{ d.device_code }}</view>
              <view class="dr-name">
                {{ d.name }}
                <text class="dr-add" v-if="d.added">本次新增</text>
              </view>
              <view class="dr-meta" v-if="d.subsystem_name || d.brand_model">
                <text v-if="d.subsystem_name">{{ d.subsystem_name }}</text>
                <text v-if="d.brand_model">{{ d.brand_model }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- ============ 扫码后的可选旁路：手动确认位置 ============ -->
    <view class="geo-lane" v-if="showGeoLane">
      <view class="gl-main">
        <text class="gl-t">已记录 {{ lastScan }} 的自动定位</text>
        <text class="gl-d">室内定位可能偏差较大，可人工核对修正</text>
      </view>
      <text class="gl-btn" @tap="onManualConfirm">手动确认位置</text>
    </view>

    <!-- ============ 底部操作 ============ -->
    <view class="action-bar" v-if="room">
      <view class="ab-info">
        <text class="ab-name">{{ room.name }}</text>
        <text class="ab-meta">
          {{ room.code }} ·
          <text v-if="room.status === INV_STATUS.DOING">已扫 {{ room.scannedCount }}/{{ room.deviceCount }}</text>
          <text v-else>{{ room.deviceCount }} 台</text>
        </text>
      </view>
      <button class="ab-btn ab-scan" @tap="onScanBind">扫码绑定</button>
      <button
        v-if="INV_TERMINAL.includes(room.status)"
        class="ab-btn ab-undo"
        @tap="onUndo"
      >撤销</button>
      <button
        v-else-if="isEmptyRoom"
        class="ab-btn ab-empty"
        @tap="onEmptyComplete"
      >空房间完成盘点</button>
      <button v-else class="ab-btn ab-done" @tap="onComplete">
        {{ room.status === INV_STATUS.DOING ? '提交盘点' : '开始盘点' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  assetRoomDevices,
  assetBindDevice,
  assetUndoRoomInventory,
  assetCompleteRoomInventory,
  assetCreateGeoObservation,
  parseScanPayload,
} from '@/api/asset'
import {
  INV_STATUS,
  INV_STATUS_LABEL,
  INV_STATUS_COLOR,
  INV_TERMINAL,
  fmtTime,
  invStart,
  invScan,
  invSubmit,
  invDetail,
  type InvRoomRow,
} from '@/api/inventory'
import type { RoomDevicesResult, BindDeviceOutcome } from '@/types/asset'
import { useScanner } from '@/composables/useScanner'
import { getCurrentPoint } from '@/composables/useGeolocation'
import { chooseLocation, chooseFailText } from '@/composables/useChooseLocation'
import { reportManualDeviceGeo } from '@/api/geo'
import { useAuthStore } from '@/store/auth'
import { showToast, showModal, showInputModal, showLoading, hideLoading } from '@/utils/feedback'

const auth = useAuthStore()
const scanner = useScanner({
  title: '扫码绑定设备',
  manualContent: '未识别到条码，请输入设备编号',
  manualPlaceholder: '请输入固定资产编号',
})

interface RoomDeviceRow {
  device_code: string
  name: string
  subsystem_name?: string
  brand_model?: string
  location_desc?: string
  is_active?: boolean
  checked?: boolean
  added?: boolean
}

const roomCode = ref('')
const roomName = ref('')
const room = ref<InvRoomRow | null>(null)
const busy = ref(false)

const roomDevices = ref<RoomDeviceRow[]>([])
const devLoading = ref(false)
const devError = ref('')
const devOpen = ref(true)

const lastScan = ref('')
const lastScanRoom = ref('')
const showGeoLane = computed(() => !!room.value && !!lastScan.value)

const operator = computed(() => auth.user?.real_name || auth.user?.phone || '巡检员')

const statusColor = computed(
  () => INV_STATUS_COLOR[room.value?.status || 'pending'] || '#909399',
)
const statusLabel = computed(
  () => INV_STATUS_LABEL[room.value?.status || 'pending'] || '待盘点',
)

/** 是否「空房间」：当前房间设备数为 0（点房间跳转时从总览带过来的 deviceCount 即权威应扫数） */
const isEmptyRoom = computed(() => !!room.value && Number(room.value.deviceCount || 0) === 0)

onLoad((opts: any) => {
  roomCode.value = (opts?.roomCode || '').toString()
  roomName.value = decodeURIComponent((opts?.roomName || '').toString() || roomCode.value)
  room.value = {
    code: roomCode.value,
    name: roomName.value,
    building: decodeURIComponent((opts?.building || '').toString()),
    floor: decodeURIComponent((opts?.floor || '').toString()),
    roomType: decodeURIComponent((opts?.roomType || '').toString()),
    deviceCount: Number(opts?.deviceCount || 0),
    status: (opts?.status || 'pending') as InvRoomRow['status'],
    scannedCount: Number(opts?.scannedCount || 0),
    abnormalReason: decodeURIComponent((opts?.abnormalReason || '').toString()),
    inspectedAt: decodeURIComponent((opts?.inspectedAt || '').toString()),
    inspector: decodeURIComponent((opts?.inspector || '').toString()),
    emptyConfirmed: opts?.emptyConfirmed === '1' || opts?.emptyConfirmed === 1 || opts?.emptyConfirmed === 'true',
  }
})

onShow(() => {
  // 进房即清上一间的「手动确认位置」旁路，避免在 A 房点确认却写的是 B 房设备
  clearLastScan()
  if (roomCode.value) {
    loadRoom(roomCode.value)
    loadStatus(roomCode.value)
  }
})

async function loadRoom(code: string) {
  devLoading.value = true
  devError.value = ''
  try {
    const res: RoomDevicesResult = await assetRoomDevices(code)
    if (room.value) room.value.deviceCount = Number(res.count || 0)
    // 已勾选项按 device_code 保留（换房再回来不必重新逐台扫），本次新增标记清掉
    const prev = new Set(roomDevices.value.filter((d) => d.checked).map((d) => d.device_code))
    roomDevices.value = (res.devices || []).map((d) => ({
      device_code: d.device_code,
      name: d.name || '—',
      subsystem_name: d.subsystem_name || '',
      brand_model: d.brand_model || '',
      location_desc: d.location_desc || '',
      is_active: d.is_active !== false,
      checked: prev.has(d.device_code),
      added: false,
    }))
    devOpen.value = true
  } catch (e: any) {
    devError.value = (e?.message || '').trim() || '设备清单加载失败'
    roomDevices.value = []
  } finally {
    devLoading.value = false
  }
}

/** 拉取该房间权威 4 态 + 进度（query 初值可能过期，以接口为准） */
async function loadStatus(code: string) {
  try {
    const res = await invDetail(code)
    const rec = res?.inspected
    if (rec && room.value) applyRoom(rec)
  } catch {
    /* 状态拉取失败不阻断（已有 query 初值） */
  }
}

/** 把后端返回的盘点记录块合并到本地房间行（4 态 + 进度） */
function applyRoom(rec: any) {
  if (!room.value || !rec) return
  room.value.status = (rec.status || room.value.status) as InvRoomRow['status']
  room.value.scannedCount = Number(rec.scanned_count || 0)
  room.value.abnormalReason = rec.abnormal_reason || ''
  if (rec.completed_at) room.value.inspectedAt = rec.completed_at
  if (rec.operator) room.value.inspector = rec.operator
  room.value.emptyConfirmed = !!rec.empty_confirmed
}

const devCheckedCount = computed(
  () => roomDevices.value.filter((d) => d.checked && !d.added).length,
)

function clearLastScan() {
  lastScan.value = ''
  lastScanRoom.value = ''
}

/** 设备行点击 → 跳设备详情页（查看该设备完整档案 / 定位 / 台账）；绑定仍由底部「扫码绑定」负责 */
function onDeviceTap(d: RoomDeviceRow) {
  if (!d.device_code) return
  uni.navigateTo({
    url: '/pages/asset/DeviceDetail?code=' + encodeURIComponent(d.device_code),
  })
}

/** 空房间完成盘点：无设备房间直接标记为空房已盘点（后端记 empty_confirmed=true） */
async function onEmptyComplete() {
  if (!room.value) return
  const rm = room.value
  const ok = await showModal({
    title: '空房间完成盘点',
    content: `确认「${rm.name}」现场确无设备，标记为空房已盘点？\n（如实际有设备，请改用「扫码绑定」先挂入）`,
    confirmText: '确认空房',
  })
  if (!ok) return
  showLoading('提交中')
  try {
    await assetCompleteRoomInventory(rm.code, { operator: operator.value })
    showToast('已标记空房完成', 'success')
    await loadStatus(rm.code)
    await loadRoom(rm.code)
  } catch (e: any) {
    showToast(e?.message || '提交失败', 'none')
  } finally {
    hideLoading()
  }
}

async function recordGeo(deviceCode: string, scanSource: string) {
  try {
    const geo = await getCurrentPoint()
    if (geo.point) {
      const roomC = room.value?.code || ''
      await assetCreateGeoObservation({
        device_code: deviceCode,
        latitude: geo.point.latitude,
        longitude: geo.point.longitude,
        accuracy: geo.point.accuracy ?? null,
        room_code: roomC,
        scan_source: scanSource,
        operator: operator.value,
      })
      lastScan.value = deviceCode
      lastScanRoom.value = roomC
    }
  } catch {
    /* 定位可选，失败不阻断绑定 */
  }
}

async function doBind(deviceCode: string, scanSource: string, move = false) {
  if (!room.value) return
  const code = room.value.code
  let res: BindDeviceOutcome
  try {
    res = await assetBindDevice(code, deviceCode, move)
  } catch (e: any) {
    showToast(e?.message || '绑定失败', 'none')
    return
  }
  if ('conflict' in res && (res as any).conflict) {
    const c = res as any
    const ok = await showModal({
      title: '设备已归属其他机房',
      content: `${c.message}\n是否改挂到当前机房「${room.value.name}」？`,
      confirmText: '改挂',
    })
    if (ok) await doBind(deviceCode, scanSource, true)
    return
  }
  showToast('绑定成功', 'success')
  await recordGeo(deviceCode, scanSource)
  await loadRoom(code)
  markChecked(deviceCode)
  try {
    const r = await invScan(code, operator.value)
    if (r && r.inspected) applyRoom(r.inspected)
  } catch {
    /* 进度累加失败不阻断绑定 */
  }
}

/** 把某台设备在清单里勾上；不在清单里则补进来并标记本次新增 */
function markChecked(deviceCode: string) {
  const hit = roomDevices.value.find((d) => d.device_code === deviceCode)
  if (hit) {
    hit.checked = true
    return
  }
  roomDevices.value = [
    ...roomDevices.value,
    {
      device_code: deviceCode,
      name: '本次扫码新增',
      subsystem_name: '',
      brand_model: '',
      location_desc: '',
      is_active: true,
      checked: true,
      added: true,
    },
  ]
}

async function onScanBind() {
  if (!room.value) return
  if (busy.value) return
  busy.value = true
  const r = await scanner.scan()
  busy.value = false
  if (!r) return
  const code = parseScanPayload(r.code)
  if (!code) {
    showToast('无法解析该码', 'none')
    return
  }
  showLoading('绑定中')
  await doBind(code, r.source)
  hideLoading()
}

/** 提交盘点（4 态）：未开单→开单；已开单→提交（扫不够需填异常说明） */
async function onComplete() {
  if (!room.value) return
  const rm = room.value
  if (!INV_TERMINAL.includes(rm.status) && rm.status !== INV_STATUS.DOING) {
    showLoading('开单中')
    try {
      const res = await invStart(rm.code, operator.value)
      if (res && res.inspected) applyRoom(res.inspected)
      showToast(`已开始盘点（应扫 ${res?.expected_count ?? rm.deviceCount} 台）`, 'success')
    } catch (e: any) {
      showToast(e?.message || '开单失败', 'none')
    } finally {
      hideLoading()
    }
    return
  }
  const ok = await showModal({
    title: '提交盘点',
    content: `确认提交「${rm.name}」的盘点结果？\n已扫 ${rm.scannedCount}/${rm.deviceCount} 台。\n若数量不足，需填写异常说明后提交。`,
    confirmText: '提交',
  })
  if (!ok) return
  showLoading('提交中')
  try {
    let res = await invSubmit(rm.code, { operator: operator.value })
    if (res && res.need_reason) {
      hideLoading()
      const reason = await showInputModal({
        title: `异常说明（${rm.scannedCount}/${rm.deviceCount}）`,
        placeholderText: '如：3 台设备缺失，疑似已拆除',
        confirmText: '提交为异常',
      })
      if (!reason.confirm || !reason.content.trim()) {
        showToast('异常提交必须填写说明', 'none')
        return
      }
      showLoading('提交中')
      res = await invSubmit(rm.code, {
        operator: operator.value,
        abnormal_reason: reason.content.trim(),
      })
    }
    if (res && res.inspected) applyRoom(res.inspected)
    const st = res?.inspected?.status
    showToast(st === 'abnormal' ? '已提交（有异常）' : '盘点完成', 'success')
    await loadRoom(rm.code)
  } catch (e: any) {
    showToast(e?.message || '提交失败', 'none')
  } finally {
    hideLoading()
  }
}

async function onUndo() {
  if (!room.value) return
  const rm = room.value
  const ok = await showModal({
    title: '撤销盘点',
    content: `撤销「${rm.name}」的已完成标记？\n（设备绑定关系不受影响）`,
    confirmText: '撤销',
  })
  if (!ok) return
  showLoading('提交中')
  try {
    await assetUndoRoomInventory(rm.code)
    showToast('已撤销', 'none')
    await loadRoom(rm.code)
    loadStatus(rm.code)
  } catch (e: any) {
    showToast(e?.message || '撤销失败', 'none')
  } finally {
    hideLoading()
  }
}

async function onManualConfirm() {
  const code = lastScan.value
  if (!code) return
  if (busy.value) return
  if (!room.value || lastScanRoom.value !== room.value.code) {
    clearLastScan()
    showToast('房间已切换，请重新扫码后再确认位置', 'none', 2200)
    return
  }
  busy.value = true
  const picked = await chooseLocation()
  busy.value = false
  if (picked.reason === 'cancel' || !picked.point) {
    if (picked.reason && picked.reason !== 'cancel') {
      showToast(chooseFailText(picked.reason), 'none', 1800)
    }
    return
  }
  if (!room.value || lastScanRoom.value !== room.value.code) {
    clearLastScan()
    showToast('房间已切换，未保存位置', 'none', 2200)
    return
  }
  try {
    const ok = await reportManualDeviceGeo({
      deviceCode: code,
      latitude: picked.point.latitude,
      longitude: picked.point.longitude,
      roomCode: room.value.code,
      operator: operator.value,
    })
    if (!ok) {
      showToast('保存失败：选点无效或设备编号缺失，未写入记录', 'none', 2200)
      return
    }
    showToast('已保存人工确认位置', 'success')
  } catch (e: any) {
    showToast(e?.message || '保存失败，请重试', 'none')
  }
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 160rpx);
}
/* 浮条显示时抬高底部预留 */
.page-with-geo {
  padding-bottom: calc(env(safe-area-inset-bottom) + 300rpx);
}

/* ---------- 房间头部 ---------- */
.head {
  background: #fff;
  border-radius: $tm-radius;
  padding: 28rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.h-top {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.h-name {
  font-size: 34rpx;
  font-weight: 700;
  color: $tm-text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 460rpx;
}
.h-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 7rpx;
  flex-shrink: 0;
}
.h-st {
  font-size: 24rpx;
  flex-shrink: 0;
}
.h-meta {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
}
.h-stat {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 12rpx;
  flex-wrap: wrap;
}
.h-dev {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.h-prog {
  font-size: 24rpx;
  color: $tm-primary;
}
.h-empty {
  font-size: 20rpx;
  color: #ad6800;
  background: $tm-warning-bg;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}
.h-time {
  font-size: 20rpx;
  color: $tm-text-muted;
}
.h-abn {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: $tm-danger;
  line-height: 1.5;
}

/* ---------- 设备清单 ---------- */
.dev-panel {
  background: #fff;
  border-radius: $tm-radius;
  overflow: hidden;
}
.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx;
  min-height: 88rpx;
}
.dp-title {
  font-size: 28rpx;
  font-weight: 600;
  color: $tm-text;
}
.dp-caret {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.dp-count {
  font-size: 24rpx;
  color: $tm-primary;
}
.dp-empty-hint {
  color: $tm-text-muted;
}
.dp-body {
  border-top: 1rpx solid $tm-border-light;
}
.dp-hint {
  padding: 30rpx 24rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
  line-height: 1.6;
}
.dp-err {
  padding: 30rpx 24rpx;
  font-size: 24rpx;
  color: $tm-danger;
  line-height: 1.6;
}
.dp-retry {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: $tm-primary;
  min-height: 88rpx;
  line-height: 88rpx;
}
.dev-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
  padding: 20rpx 24rpx;
  border-bottom: 1rpx solid $tm-border-light;
  min-height: 88rpx;
}
.dev-row:last-child {
  border-bottom: none;
}
.dev-row.checked {
  background: $tm-primary-bg;
}
.dev-row.checked .dr-code,
.dev-row.checked .dr-name {
  color: $tm-text-muted;
}
.dev-row.added {
  background: #fff7ed;
}
.dr-box {
  flex-shrink: 0;
  width: 40rpx;
  height: 40rpx;
  margin-top: 6rpx;
  border: 2rpx solid $tm-border;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dr-box.on {
  background: $tm-primary;
  border-color: $tm-primary;
}
.dr-tick {
  font-size: 26rpx;
  color: #fff;
  line-height: 1;
}
.dr-main {
  flex: 1;
  min-width: 0;
}
.dr-code {
  font-size: 26rpx;
  color: $tm-text;
  font-weight: 500;
}
.dr-name {
  font-size: 26rpx;
  color: $tm-text;
  margin-top: 4rpx;
}
.dr-add {
  font-size: 20rpx;
  color: #ff7d45;
  margin-left: 10rpx;
}
.dr-meta {
  display: flex;
  gap: 16rpx;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}

/* ---------- 手动确认位置浮条 ---------- */
.geo-lane {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: calc(env(safe-area-inset-bottom) + 150rpx);
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 20rpx;
  background: #fff7ed;
  border: 1rpx solid #ffbb8a;
  border-radius: $tm-radius;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
  z-index: 20;
}
.gl-main {
  flex: 1;
  min-width: 0;
}
.gl-t {
  display: block;
  font-size: 24rpx;
  color: $tm-text;
}
.gl-d {
  display: block;
  margin-top: 2rpx;
  font-size: 21rpx;
  color: #ad4e15;
}
.gl-btn {
  flex-shrink: 0;
  min-height: 72rpx;
  line-height: 72rpx;
  padding: 0 26rpx;
  font-size: 25rpx;
  font-weight: 600;
  color: #fff;
  background: #ff7d45;
  border-radius: 36rpx;
}

/* ---------- 底部操作 ---------- */
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 24rpx calc(env(safe-area-inset-bottom) + 14rpx);
  background: #fff;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
  z-index: 20;
}
.ab-info {
  flex: 1;
  overflow: hidden;
}
.ab-name {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ab-meta {
  font-size: 20rpx;
  color: $tm-text-secondary;
}
.ab-btn {
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 30rpx;
  border-radius: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  border: none;
  flex-shrink: 0;
}
.ab-btn::after {
  border: none;
}
.ab-scan {
  background: $tm-primary;
  color: #fff;
}
.ab-done {
  background: $tm-success;
  color: #fff;
}
.ab-empty {
  background: $tm-success;
  color: #fff;
}
.ab-undo {
  background: #fff;
  color: $tm-danger;
  border: 2rpx solid $tm-danger;
}
</style>
