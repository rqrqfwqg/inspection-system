<template>
  <view class="page">
    <view class="card" v-if="route">
      <view class="r-hd">
        <text class="r-name">{{ route.name }}</text>
        <text class="r-code">{{ route.code }}</text>
      </view>
      <view class="r-desc" v-if="route.description">{{ route.description }}</view>
      <view class="r-stat">
        <text>{{ route.node_count }} 个节点 · 负责人 #{{ route.owner_id }}</text>
      </view>
    </view>

    <!-- 线路地图：按 seq 顺序把节点连成规划路线 -->
    <view class="sec-title">线路地图</view>
    <view class="card">
      <MiniMap
        :markers="mapMarkers"
        :polyline="mapPolyline"
        :circles="mapCircles"
        :height="400"
        empty-title="该线路暂无地图数据"
        :empty-desc="mapEmptyDesc"
      />
      <view class="map-note" v-if="nodeLocatedCount > 0">
        已定位 {{ nodeLocatedCount }}/{{ nodeTotal }} 个节点<text v-if="nodeManualCount">，其中 {{ nodeManualCount }} 个为人工选点</text>。
        连线为按 seq 顺序连成的规划路线（打卡可无序，实际轨迹在工单详情页看）。
      </view>
    </view>

    <view class="sec-title">节点清单
      <text class="hint">（seq 仅用于展示，打卡不限制先后顺序）</text>
    </view>

    <view class="card">
      <view class="node" v-for="n in route?.nodes || []" :key="n.id">
        <text class="seq">{{ (n.seq ?? 0) + 1 }}</text>
        <view class="n-main">
          <view class="n-name">
            {{ n.snapshot_name || n.room_code || n.area_code || '未命名节点' }}
            <text class="n-opt" v-if="!n.require_checkin">参考点</text>
            <text class="n-opt n-manual" v-if="manualOf(n.id)">人工</text>
          </view>
          <view class="n-code">{{ n.room_code || n.area_code }}</view>
          <view class="n-geo-tip" v-if="manualOf(n.id)">
            {{ manualGeoHint(manualOf(n.id)) }}
          </view>
        </view>
        <view class="n-ops" v-if="isLocatable(n)">
          <text class="n-op" @tap="onPickNode(n)">
            {{ manualOf(n.id) ? '重新选点' : '选点' }}
          </text>
          <text class="n-op n-op-clear" v-if="manualOf(n.id)" @tap="onClearNode(n)">
            清除
          </text>
        </view>
        <!-- 🔴 area 型节点（只有 area_code、无 room_code）**不渲染选点按钮**（QA P2-2）：
             地图只画有 room_code 的节点（见 located computed），给区域节点渲染按钮会让用户
             「标注成功 → 地图上永远找不到 → 反复标注」。此处明确说明原因。 -->
        <view class="n-ops n-ops-none" v-else>
          <text class="n-none">区域节点无房间，暂不支持地图标注</text>
        </view>
      </view>
      <view class="empty" v-if="route && !route.nodes?.length">该线路暂无节点</view>
      <view class="empty" v-else-if="!route">加载中…</view>
    </view>

    <view class="action-bar" v-if="route">
      <button class="ab-btn ab-scan" @tap="scanAddNode">扫码加节点</button>
      <button class="ab-btn ab-add" @tap="pickNode">从房间选</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getRoute, appendRouteNode, availableNodes } from '@/api/patrol'
import type { RouteDetail } from '@/api/patrol'
import { parseScanPayload } from '@/api/asset'
import { nodeRoomGeo, isUsable } from '@/api/geo'
import type { GeoPoint } from '@/api/geo'
import {
  getManualNodeGeo,
  setManualNodeGeo,
  clearManualNodeGeo,
  manualGeoHint,
} from '@/api/manualGeo'
import type { ManualGeoPoint } from '@/api/manualGeo'
import { chooseLocation, chooseFailText, choosePending } from '@/composables/useChooseLocation'
import MiniMap from '@/components/MiniMap.vue'
import type { MiniMapMarker, MiniMapCircle } from '@/components/MiniMap.vue'
import { showToast, showModal } from '@/utils/feedback'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const operator = computed(() => auth.user?.real_name || auth.user?.phone || '')

const id = ref(0)
const route = ref<RouteDetail | null>(null)
/** 节点房间 → 反推坐标（节点表本身没有经纬度字段） */
const nodeGeo = ref<Map<string, GeoPoint>>(new Map())
/** 节点 id → 人工选点（**本机暂存**，见 api/manualGeo.ts 顶部说明）。
 *  🔴 优先级：本机人工选点 > 「用节点房间的扫码坐标反推」。 */
const manualNodeGeo = ref<Map<number, ManualGeoPoint>>(new Map())

/** 取该节点的人工标注（无则 null） */
function manualOf(nodeId: number): ManualGeoPoint | null {
  return manualNodeGeo.value.get(nodeId) || null
}

/** 节点代表点：本机人工标注优先于扫码反推 */
function pointOf(nodeId: number, roomCode: string): GeoPoint | null {
  const m = manualNodeGeo.value.get(nodeId)
  if (m && isUsable(m.latitude, m.longitude)) {
    // 人工点无精度半径 → accuracy null，地图层据此不画误差圈
    // id=0：本机标注没有后端观测 id（占位，不代表任何 device_geo_observations 记录）
    return { id: 0, latitude: m.latitude, longitude: m.longitude, accuracy: null }
  }
  return nodeGeo.value.get(roomCode) || null
}

/** 节点是否支持地图标注：**必须有 room_code**（与 located computed 同一判据）。
 *  area 型节点不进地图，给它选点入口就是「标注成功但永远看不到」（QA P2-2）。 */
function isLocatable(n: { room_code?: string | null }): boolean {
  return !!(n.room_code || '').trim()
}

/** 有房间编号的节点（area 型节点无房间，无法定位） */
const located = computed(() =>
  (route.value?.nodes || [])
    .filter((n) => isLocatable(n))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
)

const nodeTotal = computed(() => located.value.length)
const nodeLocatedCount = computed(
  () =>
    located.value.filter((n) => {
      const p = pointOf(n.id, (n.room_code || '').trim())
      return !!p && isUsable(p.latitude, p.longitude)
    }).length,
)
const nodeManualCount = computed(
  () => located.value.filter((n) => !!manualOf(n.id)).length,
)

const mapMarkers = computed<MiniMapMarker[]>(() =>
  located.value.flatMap((n): MiniMapMarker[] => {
    const p = pointOf(n.id, (n.room_code || '').trim())
    if (!p || !isUsable(p.latitude, p.longitude)) return []
    const manual = !!manualOf(n.id)
    return [
      {
        id: n.id,
        latitude: p.latitude,
        longitude: p.longitude,
        title: n.snapshot_name || n.room_code || '',
        label: String((n.seq ?? 0) + 1),
        alwaysShow: true,
        width: manual ? 28 : 24,
        height: manual ? 28 : 24,
        // 人工点与反推点在地图上视觉可区分（橙色 callout + 「人」角标）
        callout: manual
          ? {
              display: 'ALWAYS',
              content: '人工选点',
              color: '#ffffff',
              bgColor: '#ff7d45',
              fontSize: 11,
              borderRadius: 4,
              padding: 4,
              textAlign: 'center',
            }
          : undefined,
      },
    ]
  }),
)

/** 规划路线：按 seq 顺序连成折线（打卡无序，这里画的是「设计路线」） */
const mapPolyline = computed(() =>
  located.value.flatMap((n) => {
    const p = pointOf(n.id, (n.room_code || '').trim())
    return p && isUsable(p.latitude, p.longitude)
      ? [{ latitude: p.latitude, longitude: p.longitude }]
      : []
  }),
)

const mapCircles = computed<MiniMapCircle[]>(() =>
  // 精度不可信（>400m）或缺失时不画圈 —— 画个巨大的误导圈比不画更糟
  // ⚠️ 人工选点一律不画圈（它没有精度半径）
  located.value.flatMap((n): MiniMapCircle[] => {
    if (manualOf(n.id)) return []
    const p = pointOf(n.id, (n.room_code || '').trim())
    if (!p || !isUsable(p.latitude, p.longitude)) return []
    const r = Number(p.accuracy || 0)
    if (!(r > 0) || r > 400) return []
    return [
      {
        id: n.id,
        latitude: p.latitude,
        longitude: p.longitude,
        radius: r,
        color: 'rgba(25,137,250,0.4)',
        fillColor: 'rgba(25,137,250,0.1)',
      },
    ]
  }),
)

const mapEmptyDesc = computed(() => {
  if (!nodeTotal.value) return '该线路还没有房间类型的节点'
  if (!nodeLocatedCount.value) {
    return '这些节点所在房间还没有扫码定位记录，可在下方节点清单里点「选点」人工标注'
  }
  return ''
})

function load() {
  if (!id.value) return
  loadManual()
  getRoute(id.value)
    .then(async (r) => {
      route.value = r
      // 地图坐标反推失败只影响地图，不影响节点清单
      try {
        const codes = (r.nodes || []).map((n) => (n.room_code || '').trim()).filter(Boolean)
        nodeGeo.value = codes.length ? await nodeRoomGeo(codes) : new Map()
      } catch {
        nodeGeo.value = new Map()
      }
      // 节点清单可能在 load 期间被改动（扫码/从房间选加节点），重读一次本机标注
      loadManual()
    })
    .catch((e) => showToast((e as any)?.message || '加载失败', 'none'))
}

/** 读本机人工选点（本机存储读取无副作用，失败一律按「无标注」处理） */
function loadManual() {
  const m = new Map<number, ManualGeoPoint>()
  for (const n of route.value?.nodes || []) {
    const hit = getManualNodeGeo(id.value, n.id)
    if (hit) m.set(n.id, hit)
  }
  manualNodeGeo.value = m
}

/** 选点/清除的目标节点（只用到 id，字段放宽以兼容 nodes 的 nullable 类型） */
type RouteNodeRef = { id: number }

/** 单节点人工选点：wx.chooseLocation → 存本机（B 类，不落库）。取消静默。
 *
 *  ⚠️ 并发保护用共享的 choosePending（QA P2-3）；本函数**不自己置位**该标志。
 *  ⚠️ 额外挡一道：area 型节点直接拒绝（即便将来 UI 被改回去也不会写进无用的本机标注）。 */
async function onPickNode(n: RouteNodeRef) {
  if (!id.value || !n?.id) return
  if (choosePending.value) return
  const node = (route.value?.nodes || []).find((x) => x.id === n.id)
  if (node && !isLocatable(node)) {
    showToast('区域节点暂不支持地图标注', 'none', 1800)
    return
  }
  const picked = await chooseLocation()
  if (picked.reason === 'cancel' || !picked.point) {
    if (picked.reason && picked.reason !== 'cancel') {
      showToast(chooseFailText(picked.reason), 'none', 1800)
    }
    return
  }
  const ok = setManualNodeGeo(id.value, n.id, {
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
  showToast('已保存该节点选点（本机）', 'success')
}

/** 清除单节点人工标注 → 回落到扫码反推坐标 */
async function onClearNode(n: RouteNodeRef) {
  if (!id.value || !n?.id) return
  const ok = await showModal({
    title: '清除人工选点',
    content: '清除后该节点将回落到房间扫码坐标反推的位置（可能偏差较大），确认清除？',
    confirmText: '清除',
  })
  if (!ok) return
  clearManualNodeGeo(id.value, n.id)
  loadManual()
  showToast('已清除该节点人工选点', 'none')
}

onLoad((opt) => {
  id.value = Number(opt?.id) || 0
  if (opt?.name) uni.setNavigationBarTitle({ title: decodeURIComponent(String(opt.name)) })
})
onShow(() => load())

function addNode(roomCode: string, name: string) {
  appendRouteNode(id.value, {
    node_type: 'room',
    room_code: roomCode,
    snapshot_name: name || '',
  })
    .then((r) => {
      route.value = r
      showToast('已加入线路', 'success')
    })
    .catch((e) => {
      const err = e as any
      // 409 = 该房间已在线路中（后端去重），不是错误，静默提示即可
      showToast(err?.statusCode === 409 ? '该房间已在线路中' : err?.message || '添加失败', 'none')
    })
}

/** 从房间列表选（本地过滤 available-nodes 的返回，避免再发一次请求） */
function pickNode() {
  availableNodes('room')
    .then((list) => {
      if (!list || !list.length) {
        showToast('暂无可选房间', 'none')
        return
      }
      uni.showActionSheet({
        itemList: list.slice(0, 6).map((r: any) => `${r.snapshot_name || r.room_code}（${r.room_code}）`),
        success: (res) => {
          const r = list[res.tapIndex]
          addNode(r.room_code, r.snapshot_name)
        },
        fail: () => {},
      })
    })
    .catch(() => showToast('房间列表加载失败', 'none'))
}

/** 扫码加节点：复用已验证的扫码解析；设备码需反查房间（此处先按房间码处理） */
function scanAddNode() {
  uni.scanCode({
    success: (res) => {
      const code = parseScanPayload(res.result || '')
      if (!code) {
        showToast('未识别到编码', 'none')
        return
      }
      showModal({
        title: '加入节点',
        content: `识别到 ${code}，确认作为节点加入该线路？`,
      }).then((ok) => {
        if (ok) addNode(code, code)
      })
    },
    fail: () => {},
  })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 160rpx);
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.r-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.r-name {
  font-size: 32rpx;
  font-weight: 700;
  color: $tm-text;
}
.r-code {
  font-size: 22rpx;
  color: $tm-text-muted;
}
.r-desc {
  margin-top: 10rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.r-stat {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
}
.sec-title {
  padding: 8rpx 8rpx 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
}
.hint {
  font-size: 22rpx;
  font-weight: 400;
  color: $tm-text-muted;
}
.node {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  padding: 18rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.node:last-child { border-bottom: none; }
.seq {
  width: 48rpx;
  height: 48rpx;
  flex-shrink: 0;
  line-height: 48rpx;
  text-align: center;
  font-size: 24rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  border-radius: 50%;
}
.n-main {
  flex: 1;
  min-width: 0;
  margin-left: 18rpx;
}
.n-name {
  font-size: 28rpx;
  color: $tm-text;
}
.n-opt {
  margin-left: 10rpx;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: $tm-text-muted;
  background: $tm-bg;
  border-radius: 8rpx;
}
.n-manual {
  color: #fff;
  background: #ff7d45;
}
.n-geo-tip {
  margin-top: 4rpx;
  font-size: 21rpx;
  color: #ad4e15;
}
.n-ops {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8rpx;
  padding-left: 16rpx;
}
.n-op {
  /* QA P2-1：裸 text 约 17px，戴手套会误触相邻节点名 → 可点高度 ≥88rpx（44px） */
  display: inline-block;
  min-height: 88rpx;
  line-height: 88rpx;
  padding: 0 16rpx;
  font-size: 25rpx;
  color: $tm-primary;
}
.n-op-clear {
  font-size: 22rpx;
  color: $tm-text-muted;
  text-decoration: underline;
}
/* area 型节点的说明文字（QA P2-2） */
.n-ops-none {
  justify-content: center;
  max-width: 200rpx;
}
.n-none {
  font-size: 21rpx;
  color: $tm-text-muted;
  line-height: 1.4;
  text-align: right;
}
.n-code {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 40rpx 0;
}
.map-note {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.7;
}
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: $tm-card-bg;
}
.ab-btn {
  flex: 1;
  margin: 0 8rpx;
  height: 84rpx;
  line-height: 84rpx;
  font-size: 28rpx;
  border-radius: 42rpx;
}
.ab-scan {
  color: #fff;
  background: $tm-primary;
}
.ab-add {
  color: $tm-primary;
  background: $tm-primary-bg;
}
</style>