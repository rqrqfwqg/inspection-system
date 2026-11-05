<template>
  <view class="page">
    <view class="search-bar">
      <input
        class="search-input"
        type="text"
        placeholder="输入固定资产编号 / 名称 / 机身编号"
        placeholder-class="ph"
        v-model="keyword"
        confirm-type="search"
        @confirm="onSearch"
      />
      <view class="search-btn-add" @tap="goCreate">＋</view>
      <button class="search-btn" @tap="onSearch">搜索</button>
    </view>

    <view class="tabs">
      <view class="tab" :class="{ active: tab === 'search' }" @tap="switchTab('search')">搜索</view>
      <view class="tab" :class="{ active: tab === 'tree' }" @tap="switchTab('tree')">区域树</view>
      <view class="tab" :class="{ active: tab === 'recent' }" @tap="switchTab('recent')">最近</view>
    </view>

    <!-- 类别（系统）筛选 + 仅已盘点开关 -->
    <scroll-view class="cat-scroll" scroll-x enable-flex :show-scrollbar="false">
      <view class="cat-row">
        <view class="cat" :class="{ active: !catName }" @tap="pickCat('')">
          全部{{ total ? `(${total})` : '' }}
        </view>
        <view
          v-for="c in categories"
          :key="c.subsystem_name"
          class="cat"
          :class="{ active: catName === c.subsystem_name }"
          @tap="pickCat(c.subsystem_name)"
        >{{ c.subsystem_name }}{{ c.count != null ? `(${c.count})` : '' }}</view>
      </view>
    </scroll-view>

    <view class="switch-row">
      <text class="sw-label">仅显示已盘点资产</text>
      <switch :checked="onlyInspected" color="#1989fa" @change="onSwitchInspected" />
    </view>
    <!-- 待补录清单入口：不新做页面，直接按临时编号前缀 TMP- 搜台账 -->
    <view class="pending-bar">
      <text class="pending-t">现场没编号的设备？</text>
      <text class="pending-btn" @tap="goPendingRebind">待补录编号 ›</text>
    </view>
    <view class="count-hint" v-if="searched || results.length">
      <text v-if="listError" class="err">加载失败：{{ listError }}</text>
      <text v-else-if="onlyInspected">
        已盘点共 {{ total }} 条，已显示 {{ results.length }} 条
        <text v-if="catName">· {{ catName }}</text>
      </text>
      <text v-else>
        共 {{ results.length }} 条
        <text v-if="catName">· {{ catName }}</text>
      </text>
    </view>

    <!-- 搜索结果 -->
    <view v-if="tab === 'search'" class="panel">
      <view v-if="searching" class="hint">搜索中…</view>
      <!-- 🔴 请求异常：明确区分于空数据 -->
      <view v-else-if="listError" class="hint err-box" @tap="retry">
        <text class="e-t">数据加载失败</text>
        <text class="e-d">{{ listError }}</text>
        <text class="e-r">点击重试</text>
      </view>
      <view v-else-if="results.length === 0 && searched" class="hint">
        <text>{{ emptyHint }}</text>
        <text class="e-r" @tap="goCreate">该设备不存在？去新增 ›</text>
      </view>
      <view v-else-if="results.length === 0" class="hint">输入编号或名称开始查询</view>
      <view
        v-for="it in results"
        :key="it.device_code"
        class="card item"
        @tap="openDetail(it.device_code, it.name || it.asset_name || '')"
      >
        <view class="item-code">{{ it.device_code }}</view>
        <view class="item-name">{{ it.name || it.asset_name || '—' }}</view>
        <view class="item-meta">
          <text v-if="it.subsystem_name" class="tag">{{ it.subsystem_name }}</text>
          <text v-if="it.building" class="tag">{{ it.building }} {{ it.floor || '' }}</text>
          <text v-if="it.area" class="tag">{{ it.area }}</text>
        </view>
      </view>

      <!-- 分页：加载更多 / 已加载全部（仅「仅已盘点」场景） -->
      <view v-if="onlyInspected && results.length" class="loadmore">
        <view v-if="loadingMore" class="hint">加载更多…</view>
        <view
          v-else-if="hasMore"
          class="more-btn"
          @tap="loadMore"
        >加载更多（剩余 {{ total - results.length }} 条）</view>
        <view v-else class="hint">已加载全部 {{ total }} 条</view>
      </view>
    </view>

    <!-- 区域树 -->
    <view v-else-if="tab === 'tree'" class="panel">
      <view v-if="treeLoading" class="hint">加载区域树…</view>
      <view v-else-if="treeError" class="hint err-box" @tap="retryTree">
        <text class="e-t">区域数据加载失败</text>
        <text class="e-d">{{ treeError }}</text>
        <text class="e-r">点击重试</text>
      </view>
      <view v-else-if="!rootNodes.length" class="hint">暂无区域数据</view>
      <AreaTree v-else :nodes="rootNodes" :active-key="activeRoomKey" @room="onPickRoomDetail" @device="onPickDevice" />
    </view>

    <!-- 最近查看 -->
    <view v-else class="panel">
      <view v-if="!recent.length" class="hint">暂无最近查看记录</view>
      <view
        v-for="r in recent"
        :key="r.code"
        class="card item"
        @tap="openDetail(r.code, r.name)"
      >
        <view class="item-code">{{ r.code }}</view>
        <view class="item-name">{{ r.name || '—' }}</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow, onReachBottom } from '@dcloudio/uni-app'
import { assetMatchLedger, assetAreaTree } from '@/api/asset'
import type { AssetAreaNode } from '@/types/asset'
import AreaTree from '@/components/AreaTree.vue'
import { getJSON, set as setStore } from '@/utils/storage'
import { showToast } from '@/utils/feedback'
import {
  fetchInspectedFirstPage,
  fetchInspectedPage,
  assetListInvalidate,
  type AssetListItem,
} from '@/api/assetlist'

type TreeNode = AssetAreaNode & { expanded?: boolean; loading?: boolean; children?: AssetAreaNode[] }

const keyword = ref('')
const tab = ref<'search' | 'tree' | 'recent'>('search')
const results = ref<AssetListItem[]>([])
const searching = ref(false)
const searched = ref(false)
const rootNodes = ref<TreeNode[]>([])
const treeLoading = ref(false)
const treeError = ref('')
const recent = ref<{ code: string; name: string }[]>([])
/** 区域树选中高亮的节点 key */
const activeRoomKey = ref('')

// 🔴 请求异常与「查无数据」必须分开：原先 catch 里一律置空，
// 故障被伪装成「无数据」，用户无从判断是重试还是换关键词。
const listError = ref('')

// 类别（子系统名）+ 各分类计数（来自分页接口，口径与列表一致）
const categories = ref<Array<{ subsystem_name: string; count: number }>>([])
const catName = ref('')

// 仅显示已盘点（默认开）
const onlyInspected = ref(true)

// 分页状态（取代原先「一次拉爆全量」的扇出式加载）
const total = ref(0)
const page = ref(1)
const loadingMore = ref(false)
const hasMore = ref(false)

const emptyHint = computed(() => {
  if (catName.value && keyword.value.trim()) return `没有「${catName.value}」里匹配「${keyword.value.trim()}」的已盘点资产`
  if (catName.value) return `「${catName.value}」下暂无已盘点资产`
  if (keyword.value.trim()) return '未找到匹配的已盘点资产，换个关键词试试'
  return '未找到匹配设备，换个关键词试试'
})

/** 当前筛选条件（类别 + 关键字） */
function currentQuery() {
  return {
    subsystemName: catName.value || undefined,
    keyword: keyword.value.trim() || undefined,
  }
}

/**
 * 拉「仅已盘点」第一页（重置分页）。
 * 后端一次返回当前页 + 总数 + 子系统计数，彻底消除逐房间扇出。
 */
async function reloadInspected() {
  searching.value = true
  searched.value = true
  listError.value = ''
  page.value = 1
  try {
    const p = await fetchInspectedFirstPage(currentQuery())
    results.value = p.items
    total.value = p.total
    categories.value = p.categories
    hasMore.value = results.value.length < total.value
  } catch (e: any) {
    // 异常：保留提示，不要静默成空列表
    listError.value = (e?.message || '').trim() || '网络或服务异常，请稍后重试'
    results.value = []
    total.value = 0
    categories.value = []
    hasMore.value = false
  } finally {
    searching.value = false
  }
}

/** 加载更多（追加下一页） */
async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const rows = await fetchInspectedPage(next, currentQuery())
    if (!rows.length) {
      hasMore.value = false
      return
    }
    results.value = [...results.value, ...rows]
    page.value = next
    hasMore.value = results.value.length < total.value
  } catch (e: any) {
    showToast('加载更多失败，请稍后重试', 'none')
  } finally {
    loadingMore.value = false
  }
}

function pickCat(name: string) {
  catName.value = name
  if (tab.value !== 'search') return
  if (onlyInspected.value) reloadInspected()
  else if (keyword.value.trim()) onSearch()
}

function onSwitchInspected(e: Event) {
  const val = !!(e as unknown as { detail?: { value?: boolean } }).detail?.value
  onlyInspected.value = val
  if (val) reloadInspected()
  else if (keyword.value.trim()) onSearch()
}

function loadRecent() {
  const list = getJSON<{ code: string; name: string }[]>('asset_recent') || []
  recent.value = list.slice(0, 20)
}

function addRecent(code: string, name: string) {
  const list = getJSON<{ code: string; name: string }[]>('asset_recent') || []
  const next = [{ code, name }, ...list.filter((x) => x.code !== code)].slice(0, 20)
  setStore('asset_recent', next)
}

function openDetail(code: string, name: string) {
  addRecent(code, name || '')
  uni.navigateTo({ url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(code)}` })
}

/** 新增设备入口 */
function goCreate() {
  uni.navigateTo({ url: '/pages/asset/DeviceCreate' })
}

/**
 * 待补录清单：按临时编号前缀 `TMP-` 搜台账，复用现成的搜索结果列表。
 *
 * 🔴 必须关掉「仅已盘点」：临时编号设备是刚建的，还没做过盘点，
 *    开着这个开关搜出来永远是 0 条（用户会以为功能坏了）。
 */
function goPendingRebind() {
  tab.value = 'search'
  onlyInspected.value = false
  keyword.value = 'TMP-'
  onSearch()
}

async function onSearch() {
  const q = (keyword.value || '').trim()
  if (!q) {
    showToast('请输入查询关键词', 'none')
    return
  }
  // 开着「仅已盘点」时，走已盘点资产列表，保证筛选口径一致
  if (onlyInspected.value) {
    await reloadInspected()
    return
  }
  searching.value = true
  searched.value = true
  listError.value = ''
  try {
    const res = await assetMatchLedger(q, 30, 1)
    let items = res.items || []
    // 类别筛选：搜索结果里按子系统名称过滤
    if (catName.value) {
      items = items.filter((i) => i.subsystem_name === catName.value)
    }
    // 映射成 AssetListItem（snake_case，与卡片模板对齐）
    results.value = items.map((i) => ({
      device_code: i.device_code,
      name: i.name || '',
      asset_name: i.asset_name || '',
      subsystem_name: i.subsystem_name || '',
      room_code: i.room_code || '',
      building: i.building || '',
      floor: i.floor || '',
      area: i.area || '',
      brand_model: i.brand_model || '',
      location: i.location || '',
    }))
    total.value = results.value.length
    categories.value = []
    hasMore.value = false
  } catch (e: any) {
    listError.value = (e?.message || '').trim() || '搜索失败，请稍后重试'
    results.value = []
  } finally {
    searching.value = false
  }
}

/** 🔴 修复：区域树加载失败不再静默伪装成「暂无数据」 */
async function loadTree(force = false) {
  if (treeLoading.value) return
  if (!force && rootNodes.value.length) return
  treeLoading.value = true
  treeError.value = ''
  try {
    // 🔴 固定「楼栋 → 楼层 → 房间」三级（group_by_type=false 压掉「房间类型 / 设备」两级），
    // 房间作为叶子节点，点一下即跳房间详情，逐级展开不再卡死。
    const rows = await assetAreaTree({ group_by_type: false })
    rootNodes.value = (rows || []) as TreeNode[]
  } catch (e: any) {
    treeError.value = (e?.message || '').trim() || '区域数据获取失败'
    rootNodes.value = []
  } finally {
    treeLoading.value = false
  }
}

function retryTree() {
  loadTree(true)
}

/** 点设备行 → 设备详情 */
function onPickDevice(code: string) {
  uni.navigateTo({ url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(code)}` })
}

/**
 * 点「房间详情 / 去盘点」→ 进 RoomDetail（房间定位地图 + 房内设备 + 去盘点 + 打印）。
 * 区域树里房间节点已改为「就地展开列设备」，不再跳走；这入口保留看地图 / 做盘点 / 批量打印的能力。
 */
function onPickRoomDetail(room: AssetAreaNode) {
  const code = room.meta?.room_code
  if (!code) {
    showToast('该节点无房间编号', 'none')
    return
  }
  // 选中高亮（同一节点重复点不重复跳转）
  activeRoomKey.value = room.key
  uni.navigateTo({
    url: `/pages/asset/RoomDetail?code=${encodeURIComponent(code)}`,
  })
}

/**
 * 🔴 根本原因修复：原先切到「区域树」tab 只是给变量赋值，
 * 没有任何地方调 loadTree()，导致 rootNodes 永远为空 → 显示「暂无区域数据」。
 * 现在切 tab 带副作用，并用 watch 兜底。
 */
function switchTab(k: 'search' | 'tree' | 'recent') {
  tab.value = k
  if (k === 'tree') loadTree()
  else if (k === 'recent') loadRecent()
}

watch(tab, (k) => {
  if (k === 'tree') loadTree()
  if (k === 'recent') loadRecent()
})

function retry() {
  // 盘点状态可能已变，顺带把资产列表缓存清掉
  assetListInvalidate()
  if (onlyInspected.value) reloadInspected()
  else if (keyword.value.trim()) onSearch()
}

onShow(() => {
  loadRecent()
  if (tab.value === 'tree') {
    loadTree()
    return
  }
  // 默认进入即展示「已盘点」列表，而不是空页面
  if (onlyInspected.value) reloadInspected()
})

/** 触底自动加载更多（仅「仅已盘点」列表场景，搜索场景由后端分页控制） */
onReachBottom(() => {
  if (tab.value === 'search' && onlyInspected.value) loadMore()
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 24rpx);
}
.search-bar {
  display: flex;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.search-input {
  flex: 1;
  height: 80rpx;
  background: #fff;
  border-radius: 40rpx;
  padding: 0 28rpx;
  font-size: 28rpx;
  border: 1rpx solid $tm-border;
}
.ph {
  color: $tm-text-muted;
}
.search-btn {
  width: 140rpx;
  height: 80rpx;
  line-height: 80rpx;
  background: $tm-primary;
  color: #fff;
  border-radius: 40rpx;
  font-size: 28rpx;
  border: none;
}
/* 新增设备入口（现场扫码无结果时最常用） */
.search-btn-add {
  width: 80rpx;
  height: 80rpx;
  line-height: 74rpx;
  text-align: center;
  font-size: 40rpx;
  color: #fff;
  background: $tm-success;
  border-radius: 40rpx;
  flex-shrink: 0;
}
.search-btn::after {
  border: none;
}

.tabs {
  display: flex;
  background: #fff;
  border-radius: $tm-radius;
  padding: 8rpx;
  margin-bottom: 20rpx;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 28rpx;
  color: $tm-text-secondary;
  border-radius: $tm-radius-sm;
}
.tab.active {
  background: $tm-primary-bg;
  color: $tm-primary;
  font-weight: 600;
}

.cat-scroll {
  width: 100%;
  white-space: nowrap;
  margin-bottom: 16rpx;
}
.cat-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 16rpx;
  padding: 2rpx 0;
}
.cat {
  flex-shrink: 0;
  padding: 12rpx 28rpx;
  border-radius: 32rpx;
  background: #fff;
  border: 1rpx solid $tm-border;
  font-size: 26rpx;
  color: $tm-text-secondary;
  white-space: nowrap;
}
.cat.active {
  background: $tm-primary-bg;
  border-color: $tm-primary;
  color: $tm-primary;
  font-weight: 600;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: $tm-radius-sm;
  padding: 16rpx 24rpx;
  margin-bottom: 16rpx;
}
.sw-label {
  font-size: 28rpx;
  color: $tm-text;
}
.count-hint {
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 0 8rpx 16rpx;
}
.trunc {
  color: $tm-text-muted;
}

.panel {
  min-height: 200rpx;
}
.hint {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 60rpx 0;
}
/* 请求异常与空数据区分显示 */
.err-box {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.e-t {
  font-size: 28rpx;
  color: $tm-danger;
  font-weight: 600;
}
.e-d {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.e-r {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  color: $tm-primary;
}
.err {
  color: $tm-danger;
  font-size: 24rpx;
}
.cat-tip {
  color: $tm-text-muted;
  border-style: dashed;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.item:active {
  background: $tm-primary-bg;
}
.item-code {
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
}
.item-name {
  margin-top: 6rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.item-meta {
  margin-top: 12rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.tag {
  font-size: 22rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
}
.loadmore {
  margin-top: 8rpx;
}
.more-btn {
  text-align: center;
  font-size: 26rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 40rpx;
  padding: 18rpx 0;
  margin: 16rpx 0;
}
.more-btn:active {
  opacity: 0.85;
}
/* 待补录编号入口 */
.pending-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-radius: $tm-radius-sm;
  padding: 16rpx 24rpx;
  margin-bottom: 16rpx;
}
.pending-t {
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.pending-btn {
  font-size: 26rpx;
  color: $tm-primary;
  font-weight: 600;
}
</style>
