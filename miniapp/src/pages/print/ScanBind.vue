<template>
  <view class="page">
    <view class="card">
      <view class="label">设备编号</view>
      <view class="code-box">
        <input class="code-input" placeholder="扫码或输入固定资产编号" placeholder-class="ph" v-model="deviceCode" />
        <button class="scan-btn" @tap="onScan">扫码</button>
      </view>
      <view v-if="deviceName" class="dev-name">📦 {{ deviceName }}</view>
      <view v-else-if="deviceCode" class="dev-name muted">未匹配到设备台账（仍可绑定定位）</view>
    </view>

    <view class="card geo" v-if="geoText">
      <view class="label">当前定位</view>
      <view class="geo-text">{{ geoText }}</view>
    </view>

    <view class="section-title">选择目标机房</view>
    <view class="card">
      <view class="filter">
        <input class="filter-input" placeholder="筛选机房名称/编号" placeholder-class="ph" v-model="kw" />
      </view>
      <scroll-view scroll-y class="room-list">
        <view
          v-for="r in filteredRooms"
          :key="r.code"
          class="room-item"
          :class="{ active: targetRoom && targetRoom.code === r.code }"
          @tap="targetRoom = r"
        >
          <text class="room-name">{{ r.name }}</text>
          <text class="room-code">{{ r.code }}</text>
          <text class="room-bld">{{ r.building }} {{ r.floor }}</text>
        </view>
        <view v-if="!filteredRooms.length" class="room-empty">无匹配机房</view>
      </scroll-view>
    </view>

    <view class="action-bar">
      <button class="ab-btn ab-geo" @tap="refreshGeo">刷新定位</button>
      <button class="ab-btn ab-bind" :disabled="!canBind" @tap="onBind">绑定并上报定位</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow, onLoad } from '@dcloudio/uni-app'
import { assetSearchDevice, assetRooms, assetBindDevice, assetCreateGeoObservation, parseScanPayload } from '@/api/asset'
import type { AssetRoom, AssetSearchResult, BindDeviceOutcome } from '@/types/asset'
import { useScanner } from '@/composables/useScanner'
import { getCurrentPoint } from '@/composables/useGeolocation'
import { useAuthStore } from '@/store/auth'
import { showToast, showModal, showLoading, hideLoading } from '@/utils/feedback'

const auth = useAuthStore()
const scanner = useScanner({ title: '扫描设备二维码', manualContent: '未识别到条码，请输入设备编号', manualPlaceholder: '请输入固定资产编号' })

const deviceCode = ref('')
const deviceName = ref('')
const rooms = ref<AssetRoom[]>([])
const kw = ref('')
const targetRoom = ref<AssetRoom | null>(null)
const geo = ref<{ latitude: number; longitude: number; accuracy?: number | null } | null>(null)

const operator = computed(() => auth.user?.real_name || auth.user?.phone || '巡检员')
const canBind = computed(() => !!deviceCode.value.trim() && !!targetRoom.value)
const geoText = computed(() => {
  if (!geo.value) return ''
  const g = geo.value
  return `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}（精度 ±${g.accuracy ?? '?'} m）`
})
const filteredRooms = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return rooms.value
  return rooms.value.filter((r) => (r.name + r.code + r.building + r.floor).toLowerCase().includes(q))
})

async function resolveDevice(code: string) {
  deviceName.value = ''
  if (!code) return
  try {
    const res: AssetSearchResult = await assetSearchDevice(code)
    deviceName.value = res.found && res.target ? res.target.name || '' : ''
  } catch {
    deviceName.value = ''
  }
}

async function onScan() {
  const r = await scanner.scan()
  if (!r) return
  const code = parseScanPayload(r.code)
  if (!code) {
    showToast('无法解析该码', 'none')
    return
  }
  deviceCode.value = code
  await resolveDevice(code)
  await refreshGeo()
}

async function refreshGeo() {
  try {
    const g = await getCurrentPoint()
    if (g.point) geo.value = { latitude: g.point.latitude, longitude: g.point.longitude, accuracy: g.point.accuracy ?? null }
    else showToast('定位失败，可稍后重试', 'none')
  } catch {
    showToast('定位失败', 'none')
  }
}

async function doBind(roomCode: string, code: string, move = false) {
  let res: BindDeviceOutcome
  try {
    res = await assetBindDevice(roomCode, code, move)
  } catch (e: any) {
    showToast(e?.message || '绑定失败', 'none')
    return false
  }
  if ('conflict' in res && (res as any).conflict) {
    const c = res as any
    const ok = await showModal({
      title: '设备已归属其他机房',
      content: `${c.message}\n是否改挂到「${targetRoom.value?.name}」？`,
      confirmText: '改挂',
    })
    if (ok) return doBind(roomCode, code, true)
    return false
  }
  return true
}

async function onBind() {
  if (!canBind.value || !targetRoom.value) return
  showLoading('绑定中')
  try {
    const ok = await doBind(targetRoom.value.code, deviceCode.value.trim())
    if (!ok) return
    // 上报定位观测（与绑定解耦：失败不回滚绑定）
    if (geo.value) {
      try {
        await assetCreateGeoObservation({
          device_code: deviceCode.value.trim(),
          latitude: geo.value.latitude,
          longitude: geo.value.longitude,
          accuracy: geo.value.accuracy ?? null,
          room_code: targetRoom.value.code,
          scan_source: 'camera',
          operator: operator.value,
        })
      } catch {
        /* 定位上报可选 */
      }
    }
    showToast('绑定并定位成功', 'success')
    deviceCode.value = ''
    deviceName.value = ''
    targetRoom.value = null
    geo.value = null
  } finally {
    hideLoading()
  }
}

onLoad((opts: any) => {
  const c = (opts?.code || '').trim()
  if (c) {
    deviceCode.value = c
    resolveDevice(c)
  }
})

onShow(() => {
  assetRooms()
    .then((rs) => (rooms.value = rs))
    .catch(() => showToast('机房列表加载失败', 'none'))
  refreshGeo()
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 140rpx);
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.label {
  font-size: 26rpx;
  color: $tm-text-secondary;
  margin-bottom: 12rpx;
}
.code-box {
  display: flex;
  gap: 16rpx;
}
.code-input {
  flex: 1;
  height: 80rpx;
  background: $tm-bg;
  border-radius: $tm-radius-sm;
  padding: 0 24rpx;
  font-size: 28rpx;
}
.ph {
  color: $tm-text-muted;
}
.scan-btn {
  width: 160rpx;
  height: 80rpx;
  line-height: 80rpx;
  background: $tm-primary;
  color: #fff;
  border-radius: $tm-radius-sm;
  font-size: 28rpx;
  border: none;
}
.scan-btn::after {
  border: none;
}
.dev-name {
  margin-top: 16rpx;
  font-size: 28rpx;
  color: $tm-text;
}
.dev-name.muted {
  color: $tm-text-muted;
}
.geo-text {
  font-size: 28rpx;
  color: $tm-text;
  font-family: monospace;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  margin: 16rpx 8rpx;
}
.filter {
  margin-bottom: 12rpx;
}
.filter-input {
  height: 64rpx;
  background: $tm-bg;
  border-radius: 32rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
}
.room-list {
  max-height: 440rpx;
}
.room-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 16rpx;
  border-bottom: 1rpx solid $tm-border-light;
}
.room-item.active {
  background: $tm-primary-bg;
  border-radius: $tm-radius-sm;
}
.room-name {
  flex: 1;
  font-size: 28rpx;
  color: $tm-text;
}
.room-code {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.room-bld {
  font-size: 22rpx;
  color: $tm-text-muted;
  width: 160rpx;
  text-align: right;
}
.room-empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 24rpx;
  padding: 30rpx 0;
}

.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 16rpx;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: #fff;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}
.ab-btn {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.ab-btn::after {
  border: none;
}
.ab-geo {
  width: 220rpx;
  background: #fff;
  color: $tm-primary;
  border: 1rpx solid $tm-primary;
}
.ab-bind {
  flex: 1;
  background: $tm-primary;
  color: #fff;
}
.ab-bind[disabled] {
  background: #c8d6e8;
}
</style>
