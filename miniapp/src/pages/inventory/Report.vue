<template>
  <view class="page">
    <view class="sum">
      <text class="sum-t">盘点进度报告</text>
      <text class="sum-time">{{ ov.lastAt ? '最近盘点 ' + ov.lastAt : '尚无盘点记录' }}</text>
      <view class="sum-grid">
        <view class="sum-cell">
          <text class="sum-v">{{ ov.totalRooms }}</text>
          <text class="sum-k">机房总数</text>
        </view>
        <view class="sum-cell">
          <text class="sum-v" style="color: #07c160">{{ ov.completedRooms }}</text>
          <text class="sum-k">已完成</text>
        </view>
        <view class="sum-cell">
          <text class="sum-v" style="color: #e6a23c">{{ ov.doingRooms }}</text>
          <text class="sum-k">进行中</text>
        </view>
        <view class="sum-cell">
          <text class="sum-v" style="color: #f56c6c">{{ ov.abnormalRooms }}</text>
          <text class="sum-k">有异常</text>
        </view>
        <view class="sum-cell">
          <text class="sum-v" style="color: #909399">{{ ov.pendingRooms }}</text>
          <text class="sum-k">待盘点</text>
        </view>
      </view>
      <view class="sum-bar">
        <view class="sum-bar-in" :style="{ width: ov.percent + '%' }"></view>
      </view>
      <text class="sum-pct">完成率 {{ ov.percent }}% · 在册设备 {{ ov.boundDevices }} 台 · 空房确认 {{ ov.emptyRooms }} 间</text>
    </view>

    <view class="tabs">
      <view
        v-for="t in TABS"
        :key="t.key"
        class="tb"
        :class="{ active: tab === t.key }"
        @tap="tab = t.key"
      >{{ t.label }}（{{ tabCount(t.key) }}）</view>
    </view>

    <!-- ============ 异常清单（报告的核心价值：谁没盘对、为什么）============ -->
    <view v-if="tab === 'abnormal'" class="sum" style="padding: 20rpx 28rpx">
      <text class="sum-t" style="font-size: 28rpx">异常明细（需跟进处理）</text>
      <view v-for="a in abnormalItems" :key="a.room_code" class="abn-item">
        <view class="abn-hd">
          <text class="abn-name">{{ a.room_name }}</text>
          <text class="abn-cnt">{{ a.scanned_count }}/{{ a.expected_count }}</text>
        </view>
        <text class="abn-meta">{{ a.room_code }} · {{ a.building }} {{ a.floor }} · {{ a.operator || '—' }}</text>
        <text class="abn-reason">{{ a.reason }}</text>
      </view>
      <view v-if="!abnormalItems.length" class="tip">暂无异常房间</view>
    </view>

    <view v-if="!rows.length" class="tip">该状态下暂无机房</view>

    <view v-for="r in rows" :key="r.code" class="row">
      <view class="rw-l">
        <text class="rw-name">{{ r.name }}</text>
        <text class="rw-code">{{ r.code }}</text>
      </view>
      <view class="rw-r">
        <text class="rw-dev">
          <text v-if="r.status === INV_STATUS.DOING">{{ r.scannedCount }}/</text>{{ r.deviceCount }} 台
        </text>
        <text class="rw-st" :style="{ color: INV_STATUS_COLOR[r.status] }">
          {{ INV_STATUS_LABEL[r.status] }}
        </text>
      </view>
      <view v-if="r.abnormalReason" class="rw-f abn">⚠ {{ r.abnormalReason }}</view>
      <view v-else-if="r.inspectedAt" class="rw-f">
        {{ fmtTime(r.inspectedAt) }} · {{ r.inspector || '—' }}
        <text v-if="r.emptyConfirmed"> · 空房确认</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { assetInventoryOverview } from '@/api/asset'
import {
  INV_STATUS,
  INV_STATUS_LABEL,
  INV_STATUS_COLOR,
  buildOverview,
  fmtTime,
  invReport,
  type InvRoomRow,
  type InvStatus,
} from '@/api/inventory'

type TabKey = 'all' | InvStatus
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待盘' },
  { key: 'doing', label: '进行中' },
  { key: 'completed', label: '已盘' },
  { key: 'abnormal', label: '异常' },
]

const all = ref<InvRoomRow[]>([])
const tab = ref<TabKey>('all')
/** 后端报告的异常清单（比前端过滤更完整：含原因/盘点人/时间） */
const abnormalItems = ref<any[]>([])

const ov = computed(() => buildOverview(all.value))
const rows = computed(() =>
  tab.value === 'all' ? all.value : all.value.filter((r) => r.status === tab.value),
)
function tabCount(k: TabKey) {
  return k === 'all' ? all.value.length : all.value.filter((r) => r.status === k).length
}

onLoad(async () => {
  // 两个请求并行：总览拿逐房间 4 态，报告拿异常明细
  const [ovRes, rpt] = await Promise.allSettled([
    assetInventoryOverview(),
    invReport(),
  ])
  if (rpt.status === 'fulfilled' && rpt.value) {
    abnormalItems.value = rpt.value.abnormal_items || []
  }
  if (ovRes.status !== 'fulfilled') return
  const raw = (ovRes.value && ovRes.value.rooms ? ovRes.value.rooms : []) || []
  // 🔴 4 态读后端 inv_status，不再用 inspected 布尔推断
  all.value = raw.map((r) => ({
    code: r.code,
    name: r.name || r.code,
    building: r.building || '',
    floor: r.floor || '',
    roomType: r.room_type || '',
    deviceCount: Number(r.device_count || 0),
    status: (r.inv_status || (r.inspected ? 'completed' : 'pending')) as InvStatus,
    scannedCount: Number(r.scanned_count || 0),
    abnormalReason: r.abnormal_reason || '',
    inspectedAt: r.inspected_at || '',
    inspector: r.inspector || '',
    emptyConfirmed: !!r.empty_confirmed,
  }))
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx;
}
.sum {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}

/* 异常明细条目 */
.abn-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.abn-item:last-child {
  border-bottom: none;
}
.abn-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.abn-name {
  font-size: 27rpx;
  font-weight: 600;
  color: $tm-text;
}
.abn-cnt {
  font-size: 24rpx;
  color: $tm-danger;
}
.abn-meta {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  color: $tm-text-muted;
}
.abn-reason {
  display: block;
  margin-top: 6rpx;
  font-size: 23rpx;
  color: $tm-danger;
}
.rw-f.abn {
  color: $tm-danger;
}
.sum-t {
  font-size: 32rpx;
  font-weight: 700;
  color: $tm-text;
  display: block;
}
.sum-time {
  font-size: 22rpx;
  color: $tm-text-muted;
  display: block;
  margin-top: 6rpx;
}
.sum-grid {
  display: flex;
  margin: 24rpx 0 20rpx;
}
.sum-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.sum-v {
  font-size: 40rpx;
  font-weight: 700;
  color: $tm-text;
  line-height: 1.2;
}
.sum-k {
  font-size: 22rpx;
  color: $tm-text-secondary;
  margin-top: 4rpx;
}
.sum-bar {
  height: 14rpx;
  background: $tm-bg;
  border-radius: 7rpx;
  overflow: hidden;
}
.sum-bar-in {
  height: 100%;
  background: $tm-primary;
  border-radius: 7rpx;
}
.sum-pct {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
  text-align: center;
}
.tabs {
  display: flex;
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 4rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.tb {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 14rpx 0;
  border-radius: 26rpx;
}
.tb.active {
  background: $tm-primary;
  color: #fff;
  font-weight: 600;
}
.tip {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 80rpx 0;
}
.row {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 22rpx;
  margin-bottom: 14rpx;
  box-shadow: $tm-shadow-card;
}
.rw-l {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.rw-name {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
}
.rw-code {
  font-size: 22rpx;
  color: $tm-text-muted;
}
.rw-r {
  display: flex;
  gap: 20rpx;
  margin-top: 10rpx;
  align-items: center;
}
.rw-dev {
  font-size: 26rpx;
  color: $tm-text;
  font-weight: 600;
}
.rw-st {
  font-size: 22rpx;
}
.rw-f {
  margin-top: 8rpx;
  font-size: 20rpx;
  color: $tm-text-muted;
}
</style>
