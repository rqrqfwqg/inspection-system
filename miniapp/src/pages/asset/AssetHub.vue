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
          全部{{ catCounts.__all ? `(${catCounts.__all})` : '' }}
        </view>
        <view
          v-for="c in categories"
          :key="c"
          class="cat"
          :class="{ active: catName === c }"
          @tap="pickCat(c)"
        >{{ c }}{{ catCounts[c] != null ? `(${catCounts[c]})` : '' }}</view>
        <view v-if="loadCats" class="cat cat-tip">筛选加载中…</view>
      </view>
    </scroll-view>

    <view class="switch-row">
      <text class="sw-label">仅显示已盘点资产</text>
      <switch :checked="onlyInspected" color="#1989fa" @change="onSwitchInspected" />
    </view>
    <view class="count-hint" v-if="searched || results.length">
      <text v-if="listError" class="err">加载失败：{{ listError }}</text>
      <text v-else>
        共 {{ results.length }} 条{{ onlyInspected ? '（已盘点）' : '' }}
        <text v-if="catName">· {{ catName }}</text>
        <text v-if="truncated" class="trunc">（仅预览前 {{ roomLimit }} 个已盘点房间）</text>
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
      <AreaTree v-else :nodes="rootNodes" :active-key="activeRoomKey" @pick="onPickRoom" />
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
import { onShow } from '@dcloudio/uni-app'
import { assetMatchLedger, assetAreaTree } from '@/api/asset'
import type { AssetLedgerItem, AssetAreaNode } from '@/types/asset'
import AreaTree from '@/components/AreaTree.vue'
import { getJSON, set as setStore } from '@/utils/storage'
import { showToast } from '@/utils/feedback'
import {
  assetListInspected,
  assetListCategories,
  assetListCategoryCounts,
  assetListInvalidate,
} from '@/api/assetlist'

type TreeNode = AssetAreaNode & { expanded?: boolean; loading?: boolean; children?: AssetAreaNode[] }

const keyword = ref('')
const tab = ref<'search' | 'tree' | 'recent'>('search')
const results = ref<AssetLedgerItem[]>([])
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

// 类别（子系统名）+ 各分类计数（口径与列表一致）
const categories = ref<string[]>([])
const catCounts = ref<Record<string, number>>({})
const loadCats = ref(false)
const catName = ref('')

// 仅显示已盘点（默认开）
const onlyInspected = ref(true)
// 一次最多拉多少个房间的设备（防一次拉爆）
const roomLimit = ref(40)
const truncated = ref(false)

const emptyHint = computed(() => {
  if (catName.value && keyword.value.trim()) return `没有「${catName.value}」里匹配「${keyword.value.trim()}」的已盘点资产`
  if (catName.value) return `「${catName.value}」下暂无已盘点资产`
  if (keyword.value.trim()) return '未找到匹配的已盘点资产，换个关键词试试'
  return '未找到匹配设备，换个关键词试试'
})

/** 类别 chip 与计数一起拉，失败仅提示不影响主列表 */
async function loadCategories() {
  loadCats.value = true
  try {
    const [cs, counts] = await Promise.all([assetListCategories(), assetListCategoryCounts()])
    categories.value = cs || []
    catCounts.value = counts || {}
  } catch (e: any) {
    categories.value = []
    catCounts.value = {}
    showToast('类别筛选加载失败', 'none')
  } finally {
    loadCats.value = false
  }
}

function pickCat(name: string) {
  catName.value = name
  if (tab.value !== 'search') return
  if (onlyInspected.value) loadInspectedList()
  else if (keyword.value.trim()) onSearch()
}

function onSwitchInspected(e: Event) {
  const val = !!(e as unknown as { detail?: { value?: boolean } }).detail?.value
  onlyInspected.value = val
  if (val) loadInspectedList()
  else if (keyword.value.trim()) onSearch()
}

/** 拉「仅已盘点」列表（按类别 + 关键字过滤） */
async function loadInspectedList() {
  searching.value = true
  searched.value = true
  listError.value = ''
  try {
    const list = await assetListInspected({
      subsystemName: catName.value || undefined,
      keyword: keyword.value.trim() || undefined,
      maxRooms: roomLimit.value,
    })
    truncated.value = false
    // 映射成搜索结果同构形状，模板不用改
    results.value = list.map((r) => ({
      device_code: r.deviceCode,
      name: r.deviceName,
      subsystem_name: r.subsystemName,
      building: r.building,
      floor: r.floor,
      area: r.roomName,
    })) as AssetLedgerItem[]
  } catch (e: any) {
    // 异常：保留提示，不要静默成空列表
    listError.value = (e?.message || '').trim() || '网络或服务异常，请稍后重试'
    results.value = []
  } finally {
    searching.value = false
  }
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

async function onSearch() {
  const q = (keyword.value || '').trim()
  if (!q) {
    showToast('请输入查询关键词', 'none')
    return
  }
  // 开着「仅已盘点」时，走已盘点资产列表，保证筛选口径一致
  if (onlyInspected.value) {
    await loadInspectedList()
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
    results.value = items
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
    const rows = await assetAreaTree({})
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

/**
 * 点机房节点：进房间详情（可看房间定位地图 + 房内设备），
 * 详情页里再点「去盘点这间房」跳盘点。
 * 🔴 原先这里直接 switchTab 去盘点 —— 那样「看房间在哪」这个诉求完全没有入口，
 * 而盘点页只做盘点，两件事混在一起会互相顶掉。
 */
function onPickRoom(room: AssetAreaNode) {
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
  loadCategories()
  if (onlyInspected.value) loadInspectedList()
  else if (keyword.value.trim()) onSearch()
}

onShow(() => {
  loadRecent()
  loadCategories()
  if (tab.value === 'tree') {
    loadTree()
    return
  }
  // 默认进入即展示「已盘点」列表，而不是空页面
  if (onlyInspected.value) loadInspectedList()
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
</style>
