<template>
  <view class="page">
    <view class="header">
      <view class="h-title">设备资产巡检</view>
      <view class="h-sub">项目管理部 · 资产盘点与巡查</view>
    </view>

    <!-- ① 设备数据 -->
    <view class="sec">
      <view class="sec-hd">
        <text class="sec-title">设备数据</text>
        <text class="sec-more" @tap="goAsset">全部 ›</text>
      </view>
      <view class="card kv-row" v-if="devStats">
        <view class="kv" v-for="d in devStats" :key="d.label" @tap="goAsset">
          <view class="kv-num">{{ d.value }}</view>
          <view class="kv-label">{{ d.label }}</view>
        </view>
      </view>
      <view class="card" v-else>
        <view class="sk-row">
          <view class="sk-box" v-for="i in 4" :key="i"></view>
        </view>
      </view>
    </view>

    <!-- ② 生产数据（巡查任务指标） -->
    <view class="sec">
      <view class="sec-hd">
        <text class="sec-title">生产数据</text>
        <text class="sec-more" @tap="goWorkOrder">工单 ›</text>
      </view>
      <view class="card kv-row">
        <view class="kv" v-for="d in patrolStats" :key="d.label" @tap="goWorkOrder">
          <view class="kv-num" :class="d.warn ? 'is-warn' : ''">{{ d.value }}</view>
          <view class="kv-label">{{ d.label }}</view>
        </view>
      </view>
      <view class="hint" v-if="!patrolReady">巡查模块待接入，当前为占位数据</view>
    </view>

    <!-- ③ 快捷功能（横向滑动，不换行） -->
    <view class="sec">
      <view class="sec-hd">
        <text class="sec-title">快捷功能</text>
      </view>
      <scroll-view class="quick-scroll" scroll-x enable-flex :show-scrollbar="false">
        <view class="quick-row">
          <view class="quick" v-for="q in quickList" :key="q.name" @tap="onQuick(q)">
            <view class="q-icon" :class="q.cls">{{ q.icon }}</view>
            <view class="q-label">{{ q.name }}</view>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- ④ 数据表管理 -->
    <view class="sec">
      <view class="sec-hd">
        <text class="sec-title">数据表管理</text>
        <text class="sec-more" v-if="tables.length" @tap="goDataTable">{{ tables.length }} 张 ›</text>
      </view>
      <view class="card" v-if="tables.length">
        <view class="tbl" v-for="t in tables.slice(0, 4)" :key="t.id" @tap="goTable(t)">
          <view class="tbl-main">
            <text class="tbl-name">{{ t.name }}</text>
            <text class="tbl-meta">{{ t.subsystem_name || '通用' }}</text>
          </view>
          <view class="tbl-right">
            <text class="tbl-count">{{ t.record_count ?? 0 }} 条</text>
            <text class="tbl-arrow">›</text>
          </view>
        </view>
        <view class="tbl-more" v-if="tables.length > 4" @tap="goDataTable">
          查看全部 {{ tables.length }} 张表 ›
        </view>
      </view>
      <view class="card empty" v-else-if="tablesLoaded">暂未配置数据表</view>
      <view class="card" v-else>
        <view class="sk-row"><view class="sk-box"></view></view>
      </view>
    </view>

    <!-- ⑤ 个人信息 -->
    <view class="sec">
      <view class="card profile" @tap="goProfile">
        <view class="p-avatar">{{ initial }}</view>
        <view class="p-main">
          <view class="p-name">{{ displayName }}</view>
          <view class="p-role">{{ roleName }} · {{ phone || '未绑定手机号' }}</view>
        </view>
        <text class="p-arrow">›</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { assetAreaStats, assetSubsystems } from '@/api/asset'
import type { AssetAreaStats, AssetSubsystem } from '@/types/asset'
import { listDataTables } from '@/api/datatable'
import type { AssetDataTable } from '@/api/datatable'
import { patrolStats as patrolStatsApi } from '@/api/patrol'
import { useAuthStore } from '@/store/auth'
import { showToast } from '@/utils/feedback'

// ===== ① 设备数据 =====
const stats = ref<AssetAreaStats | null>(null)
const devStats = computed(() => {
  const s = stats.value
  if (!s) return null
  return [
    { label: '台账设备', value: s.summary.devices_total },
    { label: '机房总数', value: s.summary.room_count },
    { label: '已定位', value: s.summary.devices_mapped },
    { label: '有设备机房', value: s.summary.rooms_with_devices },
  ]
})

// ===== ② 生产数据（接后端 /stats/patrol）=====
// 注意：value 显式声明为 string | number —— 初始占位是 '--'（string），
// 接口返回是数字，不显式声明会被推断成 string[] 而报 TS2322
const patrolReady = ref(false)
const patrolStats = ref<Array<{ label: string; value: string | number; warn: boolean }>>([
  { label: '进行中工单', value: '--', warn: false },
  { label: '今日打卡率', value: '--', warn: false },
  { label: '逾期提醒', value: '--', warn: true },
])

function loadPatrol() {
  patrolStatsApi()
    .then((s) => {
      patrolStats.value = [
        { label: '进行中工单', value: s.wo_doing ?? 0, warn: false },
        { label: '今日打卡率', value: `${s.today_checkin_rate ?? 0}%`, warn: false },
        { label: '逾期提醒', value: s.wo_overdue ?? 0, warn: true },
      ]
      patrolReady.value = true
    })
    .catch(() => {
      // 接口不可用时保留占位符，不显示假 0（假 0 会被现场当成「真的没有工单」）
      patrolReady.value = false
    })
}

// ===== ③ 快捷功能 =====
const quickList = [
  { name: '巡查打卡', icon: '📋', cls: 'q-blue', path: '/pages/workorder/WorkOrderList', tab: false },
  { name: '巡查线路', icon: '🗺️', cls: 'q-indigo', path: '/pages/route/RouteList', tab: false },
  { name: '盘点台账', icon: '🔍', cls: 'q-green', path: '/pages/inventory/Inventory', tab: true },
  { name: '盘点报告', icon: '📊', cls: 'q-teal', path: '/pages/inventory/Report', tab: false },
  { name: '批量打印', icon: '🖨️', cls: 'q-orange', path: '/pages/print/DeviceLabelPrint', tab: false },
  { name: '定位绑定', icon: '📍', cls: 'q-purple', path: '/pages/print/ScanBind', tab: false },
  { name: '资产查询', icon: '📦', cls: 'q-cyan', path: '/pages/asset/AssetHub', tab: true },
]

// ===== ④ 数据表 =====
const tables = ref<AssetDataTable[]>([])
const tablesLoaded = ref(false)

// ===== ⑤ 个人信息 =====
const auth = useAuthStore()
const displayName = computed(() => auth.user?.real_name || auth.user?.phone || '未命名用户')
const roleName = computed(() => auth.user?.role_name || '项目管理员')
const phone = computed(() => auth.user?.phone || '')
const initial = computed(() => displayName.value.charAt(0))

// 子系统类别（供资产页筛选用，这里预取一次）
const subsystems = ref<AssetSubsystem[]>([])

function load() {
  assetAreaStats()
    .then((s) => (stats.value = s))
    .catch(() => showToast('设备数据加载失败', 'none'))

  loadPatrol()

  listDataTables()
    .then((t) => {
      tables.value = (t || []).filter((x) => x.is_active !== false)
      tablesLoaded.value = true
    })
    .catch(() => {
      tables.value = []
      tablesLoaded.value = true
    })

  assetSubsystems()
    .then((s) => (subsystems.value = s || []))
    .catch(() => (subsystems.value = []))
}

onShow(() => load())

// ===== 跳转 =====
function goAsset() {
  uni.switchTab({ url: '/pages/asset/AssetHub' })
}
function goInventory() {
  uni.switchTab({ url: '/pages/inventory/Inventory' })
}
function goPrint() {
  uni.navigateTo({ url: '/pages/print/DeviceLabelPrint' })
}
function goScanBind() {
  uni.navigateTo({ url: '/pages/print/ScanBind' })
}
function goProfile() {
  uni.switchTab({ url: '/pages/profile/Profile' })
}
function goTable(t: AssetDataTable) {
  uni.navigateTo({
    url: `/pages/datatable/TableRecords?tid=${t.id}&title=${encodeURIComponent(t.name)}`,
  })
}
function goDataTable() {
  uni.switchTab({ url: '/pages/asset/AssetHub' })
}
function goWorkOrder() {
  uni.navigateTo({ url: '/pages/workorder/WorkOrderList' })
}

function onQuick(q: { path: string; tab: boolean; name: string }) {
  if (q.tab) {
    uni.switchTab({ url: q.path })
    return
  }
  uni.navigateTo({
    url: q.path,
    fail: () => {
      // 跳转失败必须给提示：navigateTo 无 fail 回调时是静默的，
      // 现场会描述成「点了没反应」（见 MEMORY.md 小程序跳转红线）
      showToast(`打开「${q.name}」失败`, 'none')
    },
  })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 32rpx);
  box-sizing: border-box;
}
.header {
  padding: 20rpx 8rpx 28rpx;
}
.h-title {
  font-size: 40rpx;
  font-weight: 700;
  color: $tm-text;
}
.h-sub {
  margin-top: 6rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
}

/* 每个板块独立外边距，块与块之间不会被挤压 —— 排版错位的根因修复 */
.sec {
  margin-bottom: 32rpx;
}
.sec-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8rpx 16rpx;
}
.sec-title {
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
}
.sec-more {
  font-size: 24rpx;
  color: $tm-primary;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  box-shadow: $tm-shadow-card;
}

/* 数字卡片：等分 + 固定字号 + 不换行 */
.kv-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
}
.kv {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
}
.kv-num {
  font-size: 38rpx;
  font-weight: 700;
  color: $tm-primary;
  line-height: 1.2;
  white-space: nowrap;
}
.kv-num.is-warn {
  color: $tm-danger;
}
.kv-label {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
  white-space: nowrap;
}
.hint {
  margin-top: 12rpx;
  padding: 0 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}

/* 快捷功能：横向滚动容器，flex nowrap 保证不换行 */
.quick-scroll {
  width: 100%;
  white-space: nowrap;
}
.quick-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 20rpx;
  padding: 4rpx 0 8rpx;
}
.quick {
  flex-shrink: 0;
  width: 148rpx;
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx 8rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: $tm-shadow-card;
}
.q-icon {
  width: 84rpx;
  height: 84rpx;
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42rpx;
}
.q-label {
  margin-top: 14rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: $tm-text;
  white-space: nowrap;
}
.q-blue { background: $tm-primary-bg; }
.q-green { background: $tm-success-bg; }
.q-orange { background: $tm-warning-bg; }
.q-purple { background: #eef0ff; }
.q-cyan { background: #e6f7f8; }
.q-indigo { background: #e8eeff; }
.q-teal { background: #e4f7f2; }

/* 数据表列表 */
.tbl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.tbl:last-child {
  border-bottom: none;
}
.tbl-main {
  flex: 1;
  min-width: 0;
}
.tbl-name {
  font-size: 28rpx;
  font-weight: 600;
  color: $tm-text;
}
.tbl-meta {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.tbl-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 16rpx;
}
.tbl-count {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.tbl-arrow {
  margin-left: 8rpx;
  font-size: 30rpx;
  color: $tm-text-muted;
}
.tbl-more {
  padding-top: 20rpx;
  text-align: center;
  font-size: 26rpx;
  color: $tm-primary;
}

/* 个人信息 */
.profile {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
}
.p-avatar {
  width: 96rpx;
  height: 96rpx;
  flex-shrink: 0;
  border-radius: 50%;
  background: $tm-primary;
  color: #fff;
  font-size: 40rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-main {
  flex: 1;
  min-width: 0;
  margin-left: 24rpx;
}
.p-name {
  font-size: 32rpx;
  font-weight: 700;
  color: $tm-text;
}
.p-role {
  margin-top: 6rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-arrow {
  flex-shrink: 0;
  font-size: 36rpx;
  color: $tm-text-muted;
}

.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 30rpx 0;
}

.sk-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  justify-content: space-between;
}
.sk-box {
  width: 22%;
  height: 72rpx;
  background: #f0f0f0;
  border-radius: 8rpx;
}
</style>