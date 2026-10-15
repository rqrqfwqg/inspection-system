<template>
  <view class="page">
    <!-- 房间信息 -->
    <view class="card" v-if="room">
      <view class="rm-name">{{ room.name || code }}</view>
      <view class="rm-code">{{ code }}</view>
      <view class="rm-tags">
        <text class="tag" v-if="room.building">{{ room.building }}</text>
        <text class="tag" v-if="room.floor">{{ room.floor }}</text>
        <text class="tag" v-if="room.room_type">{{ room.room_type }}</text>
      </view>
    </view>

    <!-- 房间定位地图 -->
    <view class="section-title">房间定位</view>
    <view class="card">
      <MiniMap
        :markers="mapMarkers"
        :circles="mapCircles"
        :height="400"
        empty-title="该房间暂无定位记录"
        empty-desc="现场扫码盘点这间房的设备后，会自动记下房间位置；也可以直接用下方「人工标注房间位置」在地图上标点"
      />
      <view class="geo-ops">
        <button class="geo-btn" @tap="onMarkRoom">
          {{ manualRoom ? '重新标注房间位置' : '人工标注房间位置' }}
        </button>
        <text class="geo-clear" v-if="manualRoom" @tap="onClearRoom">清除人工标注</text>
      </view>
      <view class="geo-manual-tip" v-if="manualRoom">
        <text class="gmt-flag">人工</text>
        <text class="gmt-txt">{{ manualHint }}</text>
      </view>
      <view class="geo-meta" v-if="displayPoint">
        <view class="gm-row" v-if="manualRoom">
          <text class="gm-k">位置来源</text>
          <text class="gm-v">人工标注（本机数据）</text>
        </view>
        <view class="gm-row" v-else-if="geo.point">
          <text class="gm-k">最近观测</text>
          <text class="gm-v">{{ fmtTime(geo.lastAt) || '—' }}</text>
        </view>
        <view class="gm-row" v-if="geo.samples">
          <text class="gm-k">观测来源</text>
          <text class="gm-v">{{ geo.samples }} 条 / {{ geo.devices }} 台设备</text>
        </view>
        <view class="gm-note" v-if="manualRoom">
          此位置为人工在本机标注，优先于扫码自动推算的位置。
          人工标注仅存在本机，换设备或清缓存会丢失；需要班组共享须由后端加字段与接口。
        </view>
        <view class="gm-note" v-else-if="geo.point">
          淡色小点是房内各设备被扫到时的位置，深色点是最近一次观测。
          同一房间内的点通常高度重叠 —— 这说明大家都在这间房里扫码，
          而不是这些设备分散在楼内各处。
        </view>
      </view>
    </view>

    <!-- 房内设备 -->
    <view class="section-title">
      房内设备
      <text class="cnt" v-if="devices.length">（{{ devices.length }} 台）</text>
    </view>
    <view class="card">
      <view
        class="dev"
        v-for="d in devices"
        :key="d.device_code"
        @tap="openDevice(d.device_code)"
      >
        <view class="dv-dot" :class="{ off: !d.is_registered }"></view>
        <view class="dv-main">
          <view class="dv-name">{{ d.name || d.device_code }}</view>
          <view class="dv-code">{{ d.device_code }}</view>
          <view class="dv-sub" v-if="d.subsystem_name || d.location_desc">
            {{ [d.subsystem_name, d.location_desc].filter(Boolean).join(' · ') }}
          </view>
        </view>
        <text class="dv-arrow">›</text>
      </view>
      <view class="empty" v-if="!loading && !devices.length">该房间暂未绑定设备</view>
      <view class="empty" v-else-if="loading">加载中…</view>
    </view>

    <view class="actions">
      <button class="act act-primary" @tap="goInventory">去盘点这间房</button>
      <button class="act act-outline" @tap="goPrint">批量打印二维码</button>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * RoomDetail —— 房间详情（房间定位 + 房内设备）
 *
 * 入口：资产 → 区域树 → 点机房节点。
 * 🔴 与「盘点页」的关系：区域树原本点机房直接跳盘点（只能去盘点，看不到位置）。
 * 现在改为先进房间详情页，在详情页里再点「去盘点这间房」——
 * 这样「看位置」和「做盘点」两种诉求分开，不会互相顶掉。
 * 盘点页的预填逻辑（asset_prefill_room）保持不变，所以老流程一行没坏。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { assetRoomDevices, assetListGeoObservations } from '@/api/asset'
import { roomGeo, isUsable } from '@/api/geo'
import type { RoomGeoResult } from '@/api/geo'
import type { GeoPoint } from '@/api/geo'
import {
  getManualRoomGeo,
  setManualRoomGeo,
  clearManualRoomGeo,
  manualGeoHint,
} from '@/api/manualGeo'
import type { ManualGeoPoint } from '@/api/manualGeo'
import { chooseLocation, chooseFailText, choosePending } from '@/composables/useChooseLocation'
import type { AssetRoomBrief, InventoryDeviceRow } from '@/types/asset'
import type { DeviceGeoObservation } from '@/types/asset'
import MiniMap from '@/components/MiniMap.vue'
import type { MiniMapCircle, MiniMapMarker } from '@/components/MiniMap.vue'
import { set as setStore } from '@/utils/storage'
import { showToast, showModal } from '@/utils/feedback'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const operator = computed(() => auth.user?.real_name || auth.user?.phone || '')

const code = ref('')
const room = ref<AssetRoomBrief | null>(null)
const devices = ref<InventoryDeviceRow[]>([])
const loading = ref(false)

const geo = ref<RoomGeoResult>({ point: null, samples: 0, devices: 0, lastAt: null })
/** 房内各设备的观测点（同一房间多台设备会在此重叠） */
const devicePoints = ref<DeviceGeoObservation[]>([])
/**
 * 房间人工标注（**本机暂存**，见 api/manualGeo.ts 顶部说明）。
 * 优先级：本机人工标注 > 扫码观测自动推算的代表点。
 */
const manualRoom = ref<ManualGeoPoint | null>(null)

const manualHint = computed(() => manualGeoHint(manualRoom.value))

/** 地图代表点：人工标注优先 */
const displayPoint = computed<GeoPoint | null>(() => {
  const m = manualRoom.value
  if (m && isUsable(m.latitude, m.longitude)) {
    // 人工点没有精度半径 → accuracy 给 null，地图层据此不画误差圈
    // id=0：本机标注没有后端观测 id（占位，不代表任何 device_geo_observations 记录）
    return { id: 0, latitude: m.latitude, longitude: m.longitude, accuracy: null }
  }
  return geo.value.point
})

const mapMarkers = computed<MiniMapMarker[]>(() => {
  const out: MiniMapMarker[] = []
  devicePoints.value.forEach((o, i) => {
    if (!isUsable(o.latitude, o.longitude)) return
    out.push({
      id: 100 + i,
      latitude: Number(o.latitude),
      longitude: Number(o.longitude),
      title: o.device_code,
      opacity: 0.45,
      width: 10,
      height: 10,
    })
  })
  const p = displayPoint.value
  if (p && isUsable(p.latitude, p.longitude)) {
    const manual = !!manualRoom.value
    out.unshift({
      id: 1,
      latitude: p.latitude,
      longitude: p.longitude,
      title: room.value?.name || code.value,
      label: manual ? '人工' : '房间位置',
      alwaysShow: true,
      width: manual ? 28 : 24,
      height: manual ? 28 : 24,
      callout: manual
        ? {
            display: 'ALWAYS',
            content: '人工标注',
            color: '#ffffff',
            bgColor: '#ff7d45',
            fontSize: 11,
            borderRadius: 4,
            padding: 4,
            textAlign: 'center',
          }
        : undefined,
    })
  }
  return out
})

const mapCircles = computed<MiniMapCircle[]>(() => {
  const p = displayPoint.value
  // 人工点无 accuracy → 不画圈，画个假圈反而误导
  if (!p || manualRoom.value) return []
  if (!isUsable(p.latitude, p.longitude)) return []
  const r = Number(p.accuracy || 0)
  if (!(r > 0)) return []
  return [
    {
      id: 1,
      latitude: p.latitude,
      longitude: p.longitude,
      radius: Math.min(r, 500),
      color: 'rgba(25,137,250,0.5)',
      fillColor: 'rgba(25,137,250,0.15)',
    },
  ]
})

function fmtTime(s?: string | null) {
  if (!s) return ''
  let t = String(s)
  if (!/[Zz]$/.test(t)) t += 'Z'
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(s).slice(0, 16)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

onLoad((opts: any) => {
  const c = (opts?.code || '').trim()
  if (!c) {
    showToast('缺少房间编号', 'none')
    return
  }
  code.value = c
  loadManual()
  load()
  loadGeo()
})

async function load() {
  loading.value = true
  try {
    const r = await assetRoomDevices(code.value)
    room.value = r.room
    devices.value = r.devices || []
  } catch {
    showToast('房间信息加载失败', 'none')
  } finally {
    loading.value = false
  }
}

/**
 * 房间坐标与设备清单**并行加载**：
 * 定位取不到只影响地图空态，不该让「房内设备」也空着。
 */
async function loadGeo() {
  try {
    const [g] = await Promise.all([roomGeo(code.value), loadDevicePoints()])
    geo.value = g
  } catch {
    geo.value = { point: null, samples: 0, devices: 0, lastAt: null }
  }
}

async function loadDevicePoints() {
  try {
    const rows = await assetListGeoObservations('', 200)
    devicePoints.value = (rows || []).filter(
      (o) => o.room_code === code.value && isUsable(o.latitude, o.longitude),
    )
  } catch {
    devicePoints.value = []
  }
}

/**
 * 人工标注房间位置：wx.chooseLocation 选点→ 存**本机**（B 类，不落库）。
 * 取消选点静默返回；失败只提示，绝不阻断页面。
 *
 * ⚠️ 并发保护用共享的 choosePending（QA P2-3）：chooseLocation 打开微信原生界面，
 * 连续快速点击会重复拉起。本页面**不自己置位**该标志，只做入口早退。
 */
async function onMarkRoom() {
  if (choosePending.value) return
  const picked = await chooseLocation()
  if (picked.reason === 'cancel' || !picked.point) {
    if (picked.reason && picked.reason !== 'cancel') {
      showToast(chooseFailText(picked.reason), 'none', 1800)
    }
    return
  }
  const ok = setManualRoomGeo(code.value, {
    latitude: picked.point.latitude,
    longitude: picked.point.longitude,
    name: picked.point.name,
    address: picked.point.address,
    at: Date.now(),
    operator: operator.value,
  })
  if (!ok) {
    showToast('保存失败，请重试', 'none')
    return
  }
  loadManual()
  showToast('已标注房间位置（本机）', 'success')
}

/** 清除人工标注 → 回落到扫码观测自动推算的位置 */
async function onClearRoom() {
  const ok = await showModal({
    title: '清除人工标注',
    content: '清除后将回落到扫码自动推算的位置（可能偏差较大），确认清除？',
    confirmText: '清除',
  })
  if (!ok) return
  clearManualRoomGeo(code.value)
  loadManual()
  showToast('已清除人工标注', 'none')
}

function loadManual() {
  manualRoom.value = getManualRoomGeo(code.value)
}

function openDevice(c: string) {
  uni.navigateTo({ url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(c)}` })
}

/** 去盘点：沿用盘点页既有的 storage 中转预填机制 */
function goInventory() {
  setStore('asset_prefill_room', code.value)
  uni.switchTab({ url: '/pages/inventory/Inventory' })
}

function goPrint() {
  setStore('print_prefill_codes', devices.value.map((d) => d.device_code))
  uni.navigateTo({ url: '/pages/print/DeviceLabelPrint' })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 24rpx);
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  margin: 16rpx 8rpx;
}
.cnt {
  font-size: 24rpx;
  font-weight: 400;
  color: $tm-text-secondary;
}

.rm-name {
  font-size: 34rpx;
  font-weight: 700;
  color: $tm-text;
}
.rm-code {
  margin-top: 6rpx;
  font-size: 25rpx;
  color: $tm-primary;
  letter-spacing: 1rpx;
}
.rm-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}
.tag {
  font-size: 22rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  padding: 4rpx 14rpx;
  border-radius: $tm-radius-sm;
}

.geo-ops {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 20rpx;
}
.geo-btn {
  flex: 1;
  height: 84rpx;
  line-height: 84rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #ff7d45;
  background: #fff7ed;
  border: 1rpx solid #ffbb8a;
  border-radius: 42rpx;
}
.geo-btn::after {
  border: none;
}
.geo-clear {
  flex-shrink: 0;
  /* QA P2-1：裸text 约 12px，戴手套点不中 → 撑到 ≥88rpx（44px）可点高度 */
  display: inline-block;
  min-height: 88rpx;
  line-height: 88rpx;
  padding: 0 16rpx;
  font-size: 25rpx;
  color: $tm-text-secondary;
  text-decoration: underline;
}
.geo-manual-tip {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 16rpx;
  padding: 12rpx 16rpx;
  background: #fff7ed;
  border-radius: $tm-radius-sm;
}
.gmt-flag {
  flex-shrink: 0;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: #fff;
  background: #ff7d45;
  border-radius: 6rpx;
}
.gmt-txt {
  flex: 1;
  font-size: 22rpx;
  color: #ad4e15;
  line-height: 1.6;
}

.geo-meta {
  margin-top: 20rpx;
  padding-top: 8rpx;
  border-top: 1rpx solid $tm-border-light;
}
.gm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12rpx 0;
}
.gm-k {
  font-size: 25rpx;
  color: $tm-text-secondary;
}
.gm-v {
  font-size: 25rpx;
  color: $tm-text;
}
.gm-note {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.7;
}

.dev {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.dev:last-of-type {
  border-bottom: none;
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
  font-size: 28rpx;
  color: $tm-text;
}
.dv-code {
  margin-top: 4rpx;
  font-size: 23rpx;
  color: $tm-text-secondary;
}
.dv-sub {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.dv-arrow {
  font-size: 32rpx;
  color: $tm-text-muted;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 40rpx 0;
}

.actions {
  display: flex;
  gap: 20rpx;
  margin-top: 24rpx;
}
.act {
  flex: 1;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.act::after {
  border: none;
}
.act-primary {
  background: $tm-primary;
  color: #fff;
}
.act-outline {
  background: #fff;
  color: $tm-primary;
  border: 1rpx solid $tm-primary;
}
</style>
