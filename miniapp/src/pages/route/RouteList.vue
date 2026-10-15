<template>
  <view class="page">
    <view class="search-bar">
      <input
        class="search-input"
        placeholder="搜索线路名称"
        placeholder-class="ph"
        v-model="kw"
        confirm-type="search"
        @confirm="load"
      />
    </view>

    <view class="list">
      <view class="card route" v-for="r in list" :key="r.id" @tap="open(r)" @longpress="openMenu(r)">
        <view class="r-hd">
          <text class="r-name">{{ r.name }}</text>
          <view class="r-ops">
            <text class="op" @tap.stop="edit(r)">编辑</text>
            <text class="op danger" @tap.stop="remove(r)">删除</text>
          </view>
        </view>
        <view class="r-meta">
          <text class="m-code">{{ r.code }}</text>
          <text class="m">{{ r.node_count }} 个节点</text>
        </view>
        <view class="r-desc" v-if="r.description">{{ r.description }}</view>
      </view>
      <view class="card empty" v-if="!list.length && loaded">暂无巡查线路</view>
      <view class="card empty" v-else-if="!loaded">加载中…</view>
    </view>

    <view class="fab" @tap="create">＋</view>

    <view class="mask" v-if="menuOpen && menuRow" @tap="closeMenu">
      <view class="menu" @tap.stop>
        <text class="menu-t">{{ menuRow.name }}</text>
        <view class="menu-i" @tap="doEdit">编辑线路</view>
        <view class="menu-i" @tap="doToggle">
          {{ menuRow.status === 'archived' ? '启用' : '归档停用' }}
        </view>
        <view class="menu-i danger" @tap="doRemove">删除线路</view>
        <view class="menu-i cancel" @tap="closeMenu">取消</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listRoutes, deleteRoute, updateRoute } from '@/api/patrol'
import type { RouteItem } from '@/api/patrol'
import { showToast, showModal } from '@/utils/feedback'

const kw = ref('')
const list = ref<RouteItem[]>([])
const loaded = ref(false)
const menuOpen = ref(false)
const menuRow = ref<RouteItem | null>(null)

function load() {
  listRoutes({ q: kw.value.trim() || undefined, status: 'active' })
    .then((r) => {
      list.value = r || []
      loaded.value = true
    })
    .catch((e) => {
      loaded.value = true
      showToast((e as any)?.message || '加载失败', 'none')
    })
}

onShow(() => load())

function open(r: RouteItem) {
  uni.navigateTo({ url: `/pages/route/RouteDetail?id=${r.id}&name=${encodeURIComponent(r.name)}` })
}
function create() {
  uni.navigateTo({ url: '/pages/route/RouteEdit' })
}

/** 长按卡片：更多操作菜单（编辑/归档/删除） */
function openMenu(r: RouteItem) {
  menuRow.value = r
  menuOpen.value = true
}
function closeMenu() {
  menuOpen.value = false
}

function edit(r: RouteItem) {
  closeMenu()
  uni.navigateTo({ url: `/pages/route/RouteEdit?id=${r.id}` })
}
function remove(r: RouteItem) {
  closeMenu()
  showModal({
    title: '删除线路',
    content: `确定删除「${r.name}」？该线路的 ${r.node_count} 个节点会一并移除，且不可恢复。`,
    confirmText: '删除',
    cancelText: '取消',
  })
    .then((ok) => {
      if (!ok) return
      return deleteRoute(r.id)
        .then(() => {
          showToast('已删除', 'success')
          load()
        })
        .catch((e) => showToast((e as any)?.message || '删除失败', 'none'))
    })
    .catch(() => {
      // 取消
    })
}

/** 归档/启用：停用后不再出现在新建工单的线路选择里，但不丢历史 */
function doToggle() {
  const r = menuRow.value
  if (!r) return
  const archived = r.status === 'archived'
  closeMenu()
  updateRoute(r.id, { status: archived ? 'active' : 'archived' })
    .then(() => {
      showToast(archived ? '已启用' : '已归档停用', 'success')
      load()
    })
    .catch((e) => showToast((e as any)?.message || '操作失败', 'none'))
}
function doEdit() {
  if (menuRow.value) edit(menuRow.value)
}
function doRemove() {
  if (menuRow.value) remove(menuRow.value)
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding-bottom: calc(env(safe-area-inset-bottom) + 140rpx);
}
.search-bar {
  display: flex;
  padding: 16rpx 24rpx;
}
.search-input {
  flex: 1;
  height: 72rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
  background: $tm-card-bg;
  border-radius: 36rpx;
}
.ph { color: $tm-text-muted; }
.list { padding: 0 24rpx; }
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.r-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.r-name {
  font-size: 30rpx;
  font-weight: 600;
  color: $tm-text;
}
.r-st {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  color: $tm-success;
  background: $tm-success-bg;
  border-radius: 20rpx;
}
.r-st.archived {
  color: $tm-text-muted;
  background: $tm-bg;
}
.r-meta {
  margin-top: 10rpx;
}
.m-code, .m {
  margin-right: 24rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.r-desc {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 40rpx 0;
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

/* 卡片右上角快捷操作（长按也有完整菜单） */
.r-ops {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  margin-left: 16rpx;
}
.op {
  padding: 6rpx 16rpx;
  margin-left: 12rpx;
  font-size: 24rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  border-radius: 8rpx;
}
.op.danger {
  color: $tm-danger;
  background: $tm-danger-bg;
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
</style>