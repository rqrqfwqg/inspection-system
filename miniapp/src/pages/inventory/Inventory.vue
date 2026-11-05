<template>
  <view class="page">
    <!-- ============ 按区域快捷分类 ============ -->
    <view class="area-bar">
      <view class="ab-row">
        <text class="ab-lbl">按区域</text>
        <view class="ab-dims">
          <view
            v-for="d in DIMS"
            :key="d.key"
            class="ab-dim"
            :class="{ active: dim === d.key }"
            @tap="switchDim(d.key)"
          >{{ d.label }}</view>
        </view>
        <text class="ab-clear" v-if="areaKey" @tap="clearArea">清除</text>
      </view>
      <scroll-view class="area-scroll" scroll-x enable-flex :show-scrollbar="false">
        <view class="area-row">
          <view
            class="area"
            :class="{ active: !areaKey }"
            @tap="pickArea('')"
          >全部（{{ rows.length }}）</view>
          <view
            v-for="g in areaGroups"
            :key="g.key"
            class="area"
            :class="{ active: areaKey === g.key }"
            @tap="pickArea(g.key)"
          >
            {{ g.label }}<text class="area-n">（{{ g.count }}）</text>
          </view>
          <view v-if="!areaGroups.length && !loading" class="area area-tip">暂无区域分组</view>
        </view>
      </scroll-view>
      <view class="area-sel" v-if="areaKey">
        已筛选：<text class="as-txt">{{ currentAreaLabel }}</text>
      </view>
    </view>

    <!-- ============ 状态筛选 + 搜索 ============ -->
    <view class="bar2">
      <view class="f-tabs">
        <view
          v-for="f in FILTERS"
          :key="f.key"
          class="f-tab"
          :class="{ active: filter === f.key }"
          @tap="setFilter(f.key)"
        >{{ f.label }}</view>
      </view>
      <view class="srch">
        <input
          class="f-search"
          placeholder="搜机房名/编号/楼栋"
          placeholder-class="ph"
          v-model="kw"
        />
        <text class="f-refresh" @tap="load">刷新</text>
      </view>
    </view>

    <!-- ============ 批量操作条 ============ -->
    <view v-if="batchMode" class="batch">
      <view class="b-check" @tap="toggleAll">
        <view class="box" :class="{ on: allChecked }">{{ allChecked ? '✓' : '' }}</view>
        <text>全选当前{{ rows.length }} 间</text>
      </view>
      <text class="b-count">已选 {{ picked.size }} 间</text>
      <button class="b-btn" @tap="batchDone">批量完成盘点</button>
    </view>

    <!-- ============ 房间列表 ============ -->
    <view class="list-head">
      <view class="lh-mode" @tap="batchMode = !batchMode">
        {{ batchMode ? '退出批量' : '批量盘点' }}
      </view>
      <text class="lh-count">共 {{ rows.length }} 间{{ areaKey ? `（${currentAreaLabel}）` : '' }}</text>
    </view>

    <view v-if="loading" class="tip">加载中…</view>
    <view v-else-if="!rows.length" class="tip">
      {{ all.length ? '当前筛选下没有机房' : '暂无机房数据' }}
    </view>

    <view
      v-for="r in rows"
      :key="r.code"
      class="room"
      :class="{ picked: picked.has(r.code) }"
      @tap="onRoomTap(r)"
    >
      <view v-if="batchMode" class="box" :class="{ on: picked.has(r.code) }">
        {{ picked.has(r.code) ? '✓' : '' }}
      </view>
      <view class="r-main">
        <view class="r-line1">
          <text class="r-name">{{ r.name }}</text>
          <text class="r-dot" :style="{ background: INV_STATUS_COLOR[r.status] }"></text>
          <text class="r-st" :style="{ color: INV_STATUS_COLOR[r.status] }">
            {{ INV_STATUS_LABEL[r.status] }}
          </text>
        </view>
        <view class="r-line2">
          <text class="r-code">{{ r.code }}</text>
          <text class="r-bld">{{ r.building }} · {{ r.floor }}</text>
        </view>
        <view class="r-line3">
          <text class="r-dev">{{ r.deviceCount }} 台设备</text>
          <text v-if="r.status === INV_STATUS.DOING" class="r-prog">
            已扫 {{ r.scannedCount }}/{{ r.deviceCount }}
          </text>
          <text v-if="r.emptyConfirmed" class="r-empty">空房确认</text>
          <text v-if="r.inspectedAt" class="r-time">{{ fmtTime(r.inspectedAt) }} · {{ r.inspector }}</text>
        </view>
        <view v-if="r.status === INV_STATUS.ABNORMAL && r.abnormalReason" class="r-abn">
          ⚠ {{ r.abnormalReason }}
        </view>
      </view>
      <text class="r-go">进入 ›</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { assetInventoryOverview } from '@/api/asset'
import {
  INV_STATUS,
  INV_STATUS_LABEL,
  INV_STATUS_COLOR,
  invStart,
  invSubmit,
  fmtTime,
  type InvRoomRow,
  type InvStatus,
} from '@/api/inventory'
import { useAuthStore } from '@/store/auth'
import { getJSON, set as setStore } from '@/utils/storage'
import { showToast, showModal, showLoading, hideLoading } from '@/utils/feedback'

const auth = useAuthStore()

type FilterKey = 'all' | InvStatus
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待盘' },
  { key: 'doing', label: '进行中' },
  { key: 'completed', label: '已盘' },
  { key: 'abnormal', label: '异常' },
]

const all = ref<InvRoomRow[]>([])
const loading = ref(false)
const filter = ref<FilterKey>('all')
const kw = ref('')
const batchMode = ref(false)
const picked = ref<Set<string>>(new Set())

const operator = computed(() => auth.user?.real_name || auth.user?.phone || '巡检员')

// ═════════════按区域快捷分类 ═════════════
type DimKey = 'building' | 'floor' | 'roomType'
const DIMS: Array<{ key: DimKey; label: string }> = [
  { key: 'building', label: '按楼栋' },
  { key: 'floor', label: '按楼层' },
  { key: 'roomType', label: '按房间类型' },
]
const dim = ref<DimKey>('building')
const areaKey = ref('')

const areaGroups = computed(() => {
  const map = new Map<string, { key: string; label: string; count: number }>()
  for (const r of all.value) {
    let key = ''
    let label = ''
    if (dim.value === 'building') {
      key = r.building || '未分配楼栋'
      label = key
    } else if (dim.value === 'floor') {
      const b = r.building || '未分配楼栋'
      const f = r.floor || '未分配楼层'
      key = `${b}·${f}`
      label = key
    } else {
      key = r.roomType || '未分类'
      label = key
    }
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { key, label, count: 1 })
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
})

const currentAreaLabel = computed(() => {
  const hit = areaGroups.value.find((g) => g.key === areaKey.value)
  return hit ? hit.label : areaKey.value
})

function switchDim(k: DimKey) {
  if (dim.value === k) return
  dim.value = k
  areaKey.value = ''
}
function pickArea(k: string) {
  areaKey.value = k
  if (k) {
    batchMode.value = false
    picked.value = new Set()
  }
}
function clearArea() {
  areaKey.value = ''
}

const rows = computed(() => {
  const q = kw.value.trim().toLowerCase()
  return all.value.filter((r) => {
    if (filter.value !== 'all' && r.status !== filter.value) return false
    if (areaKey.value) {
      let key = ''
      if (dim.value === 'building') key = r.building || '未分配楼栋'
      else if (dim.value === 'floor') key = `${r.building || '未分配楼栋'}·${r.floor || '未分配楼层'}`
      else key = r.roomType || '未分类'
      if (key !== areaKey.value) return false
    }
    if (!q) return true
    return (r.name + r.code + r.building + r.floor).toLowerCase().includes(q)
  })
})

const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((r) => picked.value.has(r.code)),
)

async function load() {
  loading.value = true
  try {
    const res = await assetInventoryOverview()
    const raw = (res && res.rooms ? res.rooms : []) || []
    all.value = raw.map((r) => {
      const st = (r.inv_status || (r.inspected ? 'completed' : 'pending')) as InvStatus
      return {
        code: r.code,
        name: r.name || r.code,
        building: r.building || '',
        floor: r.floor || '',
        roomType: r.room_type || '',
        deviceCount: Number(r.device_count || 0),
        status: st,
        scannedCount: Number(r.scanned_count || 0),
        abnormalReason: r.abnormal_reason || '',
        inspectedAt: r.inspected_at || '',
        inspector: r.inspector || '',
        emptyConfirmed: !!r.empty_confirmed,
      }
    })
  } catch (e: any) {
    showToast(e?.message || '盘点数据加载失败', 'none')
    all.value = []
  } finally {
    loading.value = false
  }
}

function setFilter(f: FilterKey) {
  filter.value = f
}

/** 把后端返回的盘点记录块合并到本地行（4 态 + 进度） */
function applyRecord(code: string, rec: any) {
  const hit = all.value.find((r) => r.code === code)
  if (!hit || !rec) return
  hit.status = (rec.status || 'pending') as InvStatus
  hit.scannedCount = Number(rec.scanned_count || 0)
  hit.abnormalReason = rec.abnormal_reason || ''
  if (rec.completed_at) hit.inspectedAt = rec.completed_at
  if (rec.operator) hit.inspector = rec.operator
  if (rec.empty_confirmed != null) hit.emptyConfirmed = !!rec.empty_confirmed
}

/** 组装进入房间盘点页的 URL（把列表已掌握的房间信息带过去，避免新房再发一次总览） */
function roomUrl(r: InvRoomRow): string {
  const p = (k: string, v: string | number | boolean) =>
    `${k}=${encodeURIComponent(String(v ?? ''))}`
  return (
    '/pages/inventory/RoomInventory?' +
    [
      p('roomCode', r.code),
      p('roomName', r.name),
      p('building', r.building),
      p('floor', r.floor),
      p('roomType', r.roomType),
      p('status', r.status),
      p('deviceCount', r.deviceCount),
      p('scannedCount', r.scannedCount),
      p('abnormalReason', r.abnormalReason),
      p('inspector', r.inspector),
      p('inspectedAt', r.inspectedAt),
      p('emptyConfirmed', r.emptyConfirmed ? 1 : 0),
    ].join('&')
  )
}

/** 点房间 → 跳独立房间盘点页（2026-10-19 改为跳转，旧版只在当前页内联展开） */
function onRoomTap(r: InvRoomRow) {
  if (batchMode.value) {
    const s = new Set(picked.value)
    if (s.has(r.code)) s.delete(r.code)
    else s.add(r.code)
    picked.value = s
    return
  }
  uni.navigateTo({ url: roomUrl(r) })
}

function toggleAll() {
  if (allChecked.value) {
    picked.value = new Set()
    return
  }
  picked.value = new Set(rows.value.map((r) => r.code))
}

async function batchDone() {
  const codes = Array.from(picked.value)
  if (!codes.length) {
    showToast('请先选择机房', 'none')
    return
  }
  const ok = await showModal({
    title: '批量完成盘点',
    content: `确认将 ${codes.length} 间机房标记为「已完成」？\n设备数由系统按当前绑定自动统计。`,
    confirmText: '确认',
  })
  if (!ok) return
  showLoading(`提交 ${codes.length} 间`)
  let done = 0
  const failed: string[] = []
  for (const code of codes) {
    try {
      await invStart(code, operator.value)
      const res = await invSubmit(code, { operator: operator.value })
      if (res && res.inspected) applyRecord(code, res.inspected)
      if (res && res.need_reason) {
        await invSubmit(code, {
          operator: operator.value,
          abnormal_reason: '批量确认：现场核对无变化（未逐台扫码）',
        })
      }
      done += 1
    } catch {
      failed.push(code)
    }
  }
  hideLoading()
  picked.value = new Set()
  batchMode.value = false
  await load()
  if (failed.length) {
    showToast(`成功 ${done} 间，失败 ${failed.length} 间`, 'none', 2600)
  } else {
    showToast(`已完成 ${done} 间`, 'success')
  }
}

/** 盘点提交后让资产列表缓存失效（资产页按「已盘点」筛选，状态已变） */
function invalidateAssetList() {
  try {
    import('@/api/assetlist')
      .then((m) => m.assetListInvalidate())
      .catch(() => {})
  } catch {
    /* 忽略 */
  }
}

onShow(() => {
  load().then(() => {
    // 资产页带过来的「待盘点房间」：直接进入其房间盘点页
    const prefill = getJSON<string>('asset_prefill_room')
    if (prefill) {
      const hit = all.value.find((r) => r.code === prefill)
      if (hit) uni.navigateTo({ url: roomUrl(hit) })
      setStore('asset_prefill_room', '')
    }
  })
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 24rpx);
}

/* ---------- 按区域快捷分类 ---------- */
.area-bar {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.ab-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.ab-lbl {
  font-size: 26rpx;
  color: $tm-text-secondary;
  flex-shrink: 0;
}
.ab-dims {
  flex: 1;
  display: flex;
  background: $tm-bg;
  border-radius: 28rpx;
  padding: 4rpx;
}
.ab-dim {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 10rpx 0;
  border-radius: 24rpx;
}
.ab-dim.active {
  background: $tm-primary;
  color: #fff;
  font-weight: 600;
}
.ab-clear {
  font-size: 24rpx;
  color: $tm-primary;
  flex-shrink: 0;
  padding: 6rpx 12rpx;
}
.area-scroll {
  width: 100%;
  white-space: nowrap;
  margin-top: 14rpx;
}
.area-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 14rpx;
  padding: 2rpx 0;
}
.area {
  flex-shrink: 0;
  padding: 12rpx 24rpx;
  border-radius: 30rpx;
  background: $tm-bg;
  border: 1rpx solid $tm-border;
  font-size: 26rpx;
  color: $tm-text-secondary;
  white-space: nowrap;
}
.area.active {
  background: $tm-primary-bg;
  border-color: $tm-primary;
  color: $tm-primary;
  font-weight: 600;
}
.area-n {
  font-size: 22rpx;
  opacity: 0.75;
}
.area-tip {
  color: $tm-text-muted;
  border-style: dashed;
}
.area-sel {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.as-txt {
  color: $tm-primary;
}

/* ---------- 筛选 ---------- */
.bar2 {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 16rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.f-tabs {
  display: flex;
  background: $tm-bg;
  border-radius: 30rpx;
  padding: 4rpx;
  margin-bottom: 14rpx;
}
.f-tab {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 12rpx 0;
  border-radius: 26rpx;
}
.f-tab.active {
  background: $tm-primary;
  color: #fff;
  font-weight: 600;
}
.srch {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.f-search {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  background: $tm-bg;
  border-radius: 32rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
}
.ph {
  color: $tm-text-muted;
}
.f-refresh {
  flex-shrink: 0;
  font-size: 24rpx;
  color: $tm-primary;
  padding: 0 8rpx;
}

/* ---------- 批量条 ---------- */
.batch {
  display: flex;
  align-items: center;
  background: $tm-primary-bg;
  border-radius: $tm-radius;
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
}
.b-check {
  display: flex;
  align-items: center;
  gap: 10rpx;
  font-size: 26rpx;
  color: $tm-text;
}
.box {
  width: 38rpx;
  height: 38rpx;
  border: 2rpx solid $tm-border;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  color: #fff;
  flex-shrink: 0;
}
.box.on {
  background: $tm-primary;
  border-color: $tm-primary;
}
.b-count {
  flex: 1;
  font-size: 26rpx;
  color: $tm-text-secondary;
  margin-left: 20rpx;
}
.b-btn {
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 28rpx;
  border-radius: 32rpx;
  background: $tm-primary;
  color: #fff;
  font-size: 26rpx;
  font-weight: 600;
  border: none;
}
.b-btn::after {
  border: none;
}

/* ---------- 列表 ---------- */
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8rpx 12rpx;
}
.lh-mode {
  font-size: 26rpx;
  color: $tm-primary;
}
.lh-count {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.tip {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 80rpx 0;
}
.room {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 22rpx;
  margin-bottom: 14rpx;
  box-shadow: $tm-shadow-card;
}
.room.picked {
  background: $tm-primary-bg;
  border: 2rpx solid $tm-primary;
}
.r-main {
  flex: 1;
  overflow: hidden;
}
.r-line1 {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.r-name {
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 360rpx;
}
.r-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 6rpx;
  flex-shrink: 0;
}
.r-st {
  font-size: 22rpx;
  flex-shrink: 0;
}
.r-line2 {
  display: flex;
  gap: 16rpx;
  margin-top: 8rpx;
}
.r-code {
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.r-bld {
  font-size: 22rpx;
  color: $tm-text-muted;
}
.r-line3 {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 8rpx;
  flex-wrap: wrap;
}
.r-dev {
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.r-prog {
  font-size: 22rpx;
  color: $tm-primary;
}
.r-empty {
  font-size: 20rpx;
  color: #ad6800;
  background: $tm-warning-bg;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}
.r-time {
  font-size: 20rpx;
  color: $tm-text-muted;
}
.r-abn {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-danger;
}
.r-go {
  flex-shrink: 0;
  font-size: 26rpx;
  color: $tm-primary;
  padding-left: 8rpx;
}
</style>
