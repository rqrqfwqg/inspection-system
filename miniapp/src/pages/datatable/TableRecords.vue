<template>
  <view class="page">
    <view class="search-bar">
      <input
        v-model="kw"
        class="search-input"
        type="text"
        placeholder="搜索记录内容"
        placeholder-class="ph"
        confirm-type="search"
        @confirm="doSearch"
      />
      <view class="search-btn" @tap="doSearch">搜索</view>
    </view>

    <view class="tip">
      共 {{ records.length }} 条<span v-if="queryKw">（筛选「{{ queryKw }}」）</span>
      <span v-if="queryKw && hasMore">，还有更多匹配，继续下滑加载</span>
    </view>

    <view v-for="(r, idx) in records" :key="r.id" class="card rec" @tap="goDetail(r)">
      <view class="rec-head">
        <text class="rec-seq">{{ idx + 1 }}</text>
        <text class="rec-code">{{ r.device_code || '（无设备编号）' }}</text>
        <text v-if="r.device_name" class="rec-name">{{ r.device_name }}</text>
      </view>
      <view v-for="f in fieldsOf(r).slice(0, 3)" :key="f.label" class="rec-row">
        <text class="rec-k">{{ f.label }}</text>
        <text class="rec-v">{{ f.value }}</text>
      </view>
      <view v-if="fieldsOf(r).length > 3" class="rec-more">还有 {{ fieldsOf(r).length - 3 }} 项 ›</view>
    </view>

    <view v-if="!loading && !records.length" class="empty">
      {{ queryKw ? '没有匹配的记录' : '这张表暂无数据' }}
    </view>
    <view v-else-if="loading && !records.length" class="empty">加载中…</view>

    <!-- 分页：滚动到底自动续拉（裸数组无 has_more，按「返回条数 < limit」判到底） -->
    <view v-if="records.length && hasMore" class="more" @tap="loadMore">
      {{ loading ? '加载中…' : `继续加载（已加载 ${records.length} 条）` }}
    </view>
    <view v-else-if="records.length" class="more-done">已全部加载（共 {{ records.length }} 条）</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import { listTableRecords, recordFields } from '@/api/datatable'
import type { AssetTableRecord } from '@/api/datatable'
import { showToast } from '@/utils/feedback'

/** 每页条数（与后端 limit 上限 500 兼容） */
const PAGE = 50

const records = ref<AssetTableRecord[]>([])
const loading = ref(false)
const kw = ref('')
let tid = 0
let skip = 0
let hasMore = false
/** 当前已展示集合是按哪个关键词取回的（搜索与续拉共用，避免混集） */
let queryKw = ''

onLoad((q) => {
  tid = Number((q && q.tid) || 0)
  if (!tid) {
    showToast('缺少数据表参数', 'none')
    return
  }
  if (q && q.title) uni.setNavigationBarTitle({ title: String(q.title) })
  load(true)
})

function fieldsOf(r: AssetTableRecord) {
  return recordFields(r)
}

function load(reset = true) {
  if (!tid || loading.value) return
  if (reset) {
    skip = 0
    records.value = []
  }
  loading.value = true
  listTableRecords(tid, {
    limit: PAGE,
    skip,
    // 🔴 搜索走服务端 q=，不要在前端过滤已加载页（大表只搜前 50 条会静默漏数据）
    q: queryKw || undefined,
  })
    .then((rows) => {
      const arr = rows || []
      records.value = reset ? arr : records.value.concat(arr)
      hasMore = arr.length >= PAGE
      skip = records.value.length
    })
    .catch(() => {
      records.value = []
      hasMore = false
      showToast('数据加载失败', 'none')
    })
    .finally(() => (loading.value = false))
}

function doSearch() {
  queryKw = kw.value.trim()
  load(true)
}

function loadMore() {
  if (!hasMore || loading.value) return
  load(false)
}

onReachBottom(() => loadMore())

function goDetail(r: AssetTableRecord) {
  if (!r.device_code) return
  uni.navigateTo({ url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(r.device_code)}` })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 40rpx);
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.search-input {
  flex: 1;
  height: 76rpx;
  background: $tm-card-bg;
  border-radius: $tm-radius-sm;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: $tm-text;
}
.ph {
  color: $tm-text-muted;
}
.search-btn {
  height: 76rpx;
  padding: 0 32rpx;
  line-height: 76rpx;
  border-radius: $tm-radius-sm;
  background: $tm-primary;
  color: #fff;
  font-size: 28rpx;
}
.tip {
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 0 8rpx 16rpx;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.rec-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

/* 序号：纯展示（行号 = 当前列表位置），与 Web 端同口径 */
.rec-seq {
  flex-shrink: 0;
  min-width: 44rpx;
  padding: 2rpx 10rpx;
  border-radius: $tm-radius-sm;
  background: $tm-bg;
  color: $tm-text-muted;
  font-size: 22rpx;
  text-align: center;
}
.rec-code {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
}
.rec-name {
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.rec-row {
  display: flex;
  align-items: flex-start;
  padding: 6rpx 0;
}
.rec-k {
  width: 180rpx;
  flex-shrink: 0;
  font-size: 24rpx;
  color: $tm-text-muted;
}
.rec-v {
  flex: 1;
  font-size: 24rpx;
  color: $tm-text;
  word-break: break-all;
}
.rec-more {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: $tm-primary;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 60rpx 0;
}
.more, .more-done {
  text-align: center;
  font-size: 26rpx;
  padding: 20rpx 0;
}
.more { color: $tm-primary; }
.more-done { color: $tm-text-muted; font-size: 24rpx; }
</style>