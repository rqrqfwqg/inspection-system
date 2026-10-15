<template>
  <view class="page">
    <!-- 状态筛选 -->
    <scroll-view class="tabs" scroll-x enable-flex :show-scrollbar="false">
      <view class="tab-row">
        <view
          class="tab"
          v-for="t in TABS"
          :key="t.key"
          :class="{ active: status === t.key }"
          @tap="switchStatus(t.key)"
        >
          {{ t.label }}
        </view>
      </view>
    </scroll-view>

    <!-- 搜索 -->
    <view class="search-bar">
      <input
        class="search-input"
        placeholder="搜索工单号 / 标题"
        placeholder-class="ph"
        v-model="kw"
        confirm-type="search"
        @confirm="reload"
      />
      <view class="search-btn" @tap="reload">搜索</view>
    </view>

    <!-- 列表 -->
    <view class="list">
      <view class="card wo" v-for="w in list" :key="w.id" @tap="openDetail(w)" @longpress="openMenu(w)">
        <view class="wo-hd">
          <text class="wo-code">{{ w.code }}</text>
          <view class="wo-tags">
            <text class="tag over" v-if="isOverdue(w)">已逾期</text>
            <text class="tag st" :style="{ background: statusColor(w.status) }">{{ statusLabel(w.status) }}</text>
          </view>
        </view>
        <view class="wo-title">{{ w.title }}</view>
        <view class="wo-meta">
          <text class="meta" v-if="routeIdOf(w)">📍 线路巡查</text>
          <text class="meta" v-if="w.priority">优先级 {{ priorityLabel(w.priority) }}</text>
          <text class="meta" v-if="w.due_at">截止 {{ fmtDue(w.due_at) }}</text>
        </view>
        <view class="wo-foot" v-if="w.due_at">
          <text class="due" :class="{ late: isOverdue(w) }">{{ dueText(w.due_at) }}</text>
        </view>
        <!-- 待派工单：列表内直接抢（避免点进详情才发现已被抢走） -->
        <view class="wo-claim" v-if="isClaimable(w)" @tap.stop="claim(w)">
          <text class="wc-hint">{{ takenOf(w) ? `已被 ${takenOf(w)} 接走` : '待接单·谁先抢到是谁的' }}</text>
          <text class="wc-btn" :class="{ off: takenOf(w) }">{{ takenOf(w) ? '已被接走' : '抢单' }}</text>
        </view>
        <view class="wo-taken" v-else-if="isTakenOver(w)">已被 {{ takenOf(w) }} 接走</view>
      </view>

      <view class="card empty" v-if="!list.length && loaded">没有符合条件的工单</view>
      <view class="card empty" v-else-if="!loaded">加载中…</view>

      <view class="more" v-if="list.length && list.length < total" @tap="loadMore">
        {{ loading ? '加载中…' : `加载更多（${list.length}/${total}）` }}
      </view>
    </view>

    <!-- 新建 -->
    <view class="fab" @tap="create">＋</view>

    <!-- 长按工单：编辑 / 删除 -->
    <view class="mask" v-if="menuOpen && menuRow" @tap="closeMenu">
      <view class="menu" @tap.stop>
        <text class="menu-t">{{ menuRow.code }}· {{ menuRow.title }}</text>
        <view class="menu-i" @tap="doEdit">编辑工单</view>
        <view class="menu-i danger" @tap="doRemove">删除工单</view>
        <view class="menu-i cancel" @tap="closeMenu">取消</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow, onReachBottom } from '@dcloudio/uni-app'
import {
  listWorkOrders, WO_STATUS, WO_VIEW, WO_VIEW_LABEL, WO_VIEW_COLOR,
  woViewOf, woViewLabel, woViewColor,
  isOverdue, routeIdOf, claimWorkOrder, parseTakenBy, deleteWorkOrder,
} from '@/api/patrol'
import type { WorkOrder } from '@/api/patrol'
import { showToast, showModal } from '@/utils/feedback'

/** 本次会话里被抢走的工单 → 占用者姓名（后端列表不返回姓名，故本地记） */
const takenMap = ref<Record<number, string>>({})

/** 待派且无人认领 = 可抢 */
function isClaimable(w: WorkOrder) {
  return w.status === WO_STATUS.PENDING_DISPATCH && !w.assignee_id && !takenMap.value[w.id]
}
/** 已被别人接走（本会话抢过失败，或后端已带 assignee） */
function isTakenOver(w: WorkOrder) {
  return !!takenMap.value[w.id] || (w.status === WO_STATUS.PENDING_DISPATCH && !!w.assignee_id)
}
function takenOf(w: WorkOrder) {
  return takenMap.value[w.id] || ''
}

/** 抢单：谁先抢到是谁的；409 → 灰掉并标「已被 X 接走」 */
function claim(w: WorkOrder) {
  if (isTakenOver(w)) return
  showModal({
    title: '抢单',
    content: `接单后「${w.title}」即归你负责，确认接单？`,
    confirmText: '确认接单',
  }).then((ok) => {
    if (!ok) return
    return claimWorkOrder(w.id, w.version)
      .then(() => {
        showToast('接单成功', 'success')
        reload()
      })
      .catch((e) => {
        const err = e as any
        if (err?.statusCode === 409) {
          const who = parseTakenBy(err?.message || '')
          takenMap.value = { ...takenMap.value, [w.id]: who || '他人' }
          showToast(`已被${who || '他人'}接走`, 'none')
          reload()
        } else if (err?.statusCode === 403) {
          showToast('你当前角色无接单权限，请联系调度派单', 'none')
        } else {
          showToast(err?.message || '接单失败', 'none')
        }
      })
  }).catch(() => {})
}

/**
 * 🔴 状态筛选项：前台只呈现三档（用户口径）。
 * 注意传回后端的仍是**后台原状态集合**——后端只认 7 态枚举，
 * 直接传 pending/doing 会 400 或查不到。
 */
const TABS = [
  { key: '', label: '全部' },
  { key: WO_VIEW.PENDING, label: '待接单', backend: [WO_STATUS.PENDING_DISPATCH] },
  { key: WO_VIEW.DOING, label: '进行中', backend: [WO_STATUS.ASSIGNED, WO_STATUS.IN_PROGRESS] },
  {
    key: WO_VIEW.DONE,
    label: '已完成',
    backend: [WO_STATUS.COMPLETED, WO_STATUS.PENDING_REVIEW, WO_STATUS.CLOSED],
  },
]

const status = ref('')
const kw = ref('')
const list = ref<WorkOrder[]>([])
const total = ref(0)
const page = ref(1)
const loaded = ref(false)
const loading = ref(false)

/** 当前 tab 对应的后台状态集合（空 = 全部） */
const backendStatus = computed<string[]>(() => {
  const hit = TABS.find((t) => t.key === status.value)
  return hit && hit.backend ? hit.backend : []
})

function statusLabel(s: string) {
  return woViewLabel(s)
}
function statusColor(s: string) {
  return woViewColor(s)
}
function viewOf(s: string) {
  return woViewOf(s)
}
function priorityLabel(p: string) {
  return ({ low: '低', medium: '中', high: '高', urgent: '紧急' } as Record<string, string>)[p] || p
}
function fmtDue(s: string) {
  return String(s).replace('T', ' ').slice(0, 16)
}
function dueText(s: string) {
  const t = new Date(s).getTime()
  const diff = t - Date.now()
  if (diff < 0) return '已超过截止时间'
  const h = Math.floor(diff / 3600000)
  if (h < 1) return `剩余 ${Math.max(1, Math.floor(diff / 60000))} 分钟`
  if (h < 24) return `剩余 ${h} 小时`
  return `剩余 ${Math.floor(h / 24)} 天`
}

/**
 * 加载工单列表。
 *
 * ⚠️ 后端 `status` 是 `Optional[Literal[单值]]`，**不接受逗号多状态**
 * （传非法值会 400，后端刻意不静默忽略，避免「假筛选」）。
 * 所以前台三档里「进行中」「已完成」各对应多个后台态时，
 * 这里并发拉取后按 id 去重合并 —— 不能只传第一个，会漏数据。
 */
function load(reset = true) {
  if (loading.value) return
  loading.value = true
  if (reset) {
    page.value = 1
    list.value = []
  }
  const base = {
    q: kw.value.trim() || undefined,
    page: page.value,
    page_size: 20,
  }
  const states = backendStatus.value
  const jobs = states.length
    ? states.map((s) => listWorkOrders({ ...base, status: s }))
    : [listWorkOrders({ ...base })]
  Promise.all(jobs)
    .then((results) => {
      const seen = new Set<string>()
      const merged: WorkOrder[] = []
      let sum = 0
      for (const r of results) {
        const items = r?.items || []
        sum += r?.total ?? items.length
        for (const it of items) {
          const key = String(it.id)
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(it)
        }
      }
      // 合并后按 id 倒序，保证与后端默认排序一致
      merged.sort((a, b) => Number(b.id) - Number(a.id))
      list.value = reset ? merged : list.value.concat(merged)
      total.value = sum
      loaded.value = true
    })
    .catch((e) => {
      loaded.value = true
      showToast((e as any)?.message || '加载失败', 'none')
    })
    .finally(() => (loading.value = false))
}

function reload() {
  load(true)
}
function switchStatus(k: string) {
  if (status.value === k) return
  status.value = k
  load(true)
}
function loadMore() {
  if (loading.value || list.value.length >= total.value) return
  page.value += 1
  load(false)
}

onShow(() => load(true))
onReachBottom(() => loadMore())

function openDetail(w: WorkOrder) {
  uni.navigateTo({ url: `/pages/workorder/WorkOrderDetail?id=${w.id}` })
}
function create() {
  uni.navigateTo({ url: '/pages/workorder/WorkOrderEdit' })
}

/* ========== 长按菜单：编辑 / 删除 ========== */
const menuOpen = ref(false)
const menuRow = ref<WorkOrder | null>(null)

function openMenu(w: WorkOrder) {
  menuRow.value = w
  menuOpen.value = true
}
function closeMenu() {
  menuOpen.value = false
}
function doEdit() {
  const w = menuRow.value
  if (!w) return
  closeMenu()
  uni.navigateTo({ url: `/pages/workorder/WorkOrderEdit?id=${w.id}` })
}
function doRemove() {
  const w = menuRow.value
  if (!w) return
  closeMenu()
  showModal({
    title: '删除工单',
    content: `确定删除「${w.title}」？删除后不可恢复。`,
    confirmText: '删除',
    cancelText: '取消',
  })
    .then((ok) => {
      if (!ok) return
      return deleteWorkOrder(w.id)
        .then(() => {
          showToast('已删除', 'success')
          load(true)
        })
        .catch((e) => {
          const err = e as any
          // 已完成/已闭环的工单后端可能禁止删除，提示而非静默失败
          showToast(err?.message || '删除失败', 'none')
        })
    })
    .catch(() => {})
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 140rpx);
}
.tabs {
  width: 100%;
  white-space: nowrap;
  background: $tm-card-bg;
}
.tab-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  padding: 16rpx 16rpx 0;
}
.tab {
  flex-shrink: 0;
  padding: 12rpx 26rpx;
  margin-right: 12rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
  background: $tm-bg;
  border-radius: 30rpx;
  white-space: nowrap;
}
.tab.active {
  color: #fff;
  background: $tm-primary;
  font-weight: 600;
}
.search-bar {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
  background: $tm-card-bg;
  border-radius: 36rpx;
}
.ph {
  color: $tm-text-muted;
}
.search-btn {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 0 28rpx;
  height: 72rpx;
  line-height: 72rpx;
  font-size: 26rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 36rpx;
}
.list {
  padding: 0 24rpx;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.wo-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wo-code {
  font-size: 24rpx;
  color: $tm-text-muted;
}
.wo-tags {
  display: flex;
  flex-shrink: 0;
}
.tag {
  margin-left: 10rpx;
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  color: #fff;
  border-radius: 20rpx;
}
.tag.over {
  background: $tm-danger;
}
.wo-title {
  margin-top: 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: $tm-text;
}
.wo-meta {
  margin-top: 12rpx;
  display: flex;
  flex-wrap: wrap;
}
.meta {
  margin-right: 24rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.wo-foot {
  margin-top: 12rpx;
}
.due {
  font-size: 24rpx;
  color: $tm-text-muted;
}
.due.late {
  color: $tm-danger;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 40rpx 0;
}
.more {
  text-align: center;
  font-size: 26rpx;
  color: $tm-primary;
  padding: 20rpx 0;
}
.fab {
  position: fixed;
  right: 40rpx;
  bottom: calc(env(safe-area-inset-bottom) + 60rpx);
  width: 108rpx;
  height: 108rpx;
  line-height: 108rpx;
  text-align: center;
  font-size: 56rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 50%;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.2);
}

/* ---------- 列表内抢单 ---------- */
.wo-claim {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
}
.wc-hint {
  flex: 1;
  font-size: 22rpx;
  color: $tm-text-secondary;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wc-btn {
  flex-shrink: 0;
  margin-left: 16rpx;
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 28rpx;
  border-radius: 28rpx;
  background: $tm-primary;
  color: #fff;
  font-size: 24rpx;
  font-weight: 600;
}
.wc-btn.off {
  background: #f2f3f5;
  color: $tm-text-muted;
}
.wo-taken {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
  font-size: 22rpx;
  color: $tm-text-muted;
}

/* 长按弹出的操作菜单 */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0.45);
}
.menu {
  position: absolute;
  left: 24rpx;
  right: 24rpx;
  bottom: calc(env(safe-area-inset-bottom) + 24rpx);
  padding: 8rpx 0;
  background: $tm-card-bg;
  border-radius: 20rpx;
  overflow: hidden;
}
.menu-t {
  display: block;
  padding: 24rpx;
  text-align: center;
  font-size: 26rpx;
  color: $tm-text-muted;
  border-bottom: 1rpx solid $tm-border-light;
}
.menu-i {
  padding: 28rpx 24rpx;
  text-align: center;
  font-size: 30rpx;
  color: $tm-text;
  border-bottom: 1rpx solid $tm-border-light;
}
.menu-i.danger { color: $tm-danger; }
.menu-i.cancel {
  color: $tm-text-secondary;
  border-bottom: none;
}
.fab {
  position: fixed;
  right: 40rpx;
  bottom: calc(env(safe-area-inset-bottom) + 60rpx);
  width: 108rpx;
  height: 108rpx;
  line-height: 108rpx;
  text-align: center;
  font-size: 56rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 50%;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.2);
}

/* ---------- 列表内抢单 ---------- */
.wo-claim {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
}
.wc-hint {
  flex: 1;
  font-size: 22rpx;
  color: $tm-text-secondary;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wc-btn {
  flex-shrink: 0;
  margin-left: 16rpx;
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 28rpx;
  border-radius: 28rpx;
  background: $tm-primary;
  color: #fff;
  font-size: 24rpx;
  font-weight: 600;
}
.wc-btn.off {
  background: #f2f3f5;
  color: $tm-text-muted;
}
.wo-taken {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
  font-size: 22rpx;
  color: $tm-text-muted;
}
</style>