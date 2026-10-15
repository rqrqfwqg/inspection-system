<template>
  <view class="page">
    <view class="card user">
      <view class="avatar">{{ initial }}</view>
      <view class="u-info">
        <view class="u-name">{{ auth.user?.real_name || auth.user?.phone || '未命名用户' }}</view>
        <view class="u-role">{{ roleLabel }}</view>
      </view>
    </view>

    <view class="section-title">巡检功能</view>
    <view class="card menu">
      <view class="menu-item" @tap="goAsset">
        <text>🔍 资产查询</text><text class="arrow">›</text>
      </view>
      <view class="menu-item" @tap="goInventory">
        <text>📋 扫码盘点</text><text class="arrow">›</text>
      </view>
      <view class="menu-item" @tap="goPrint">
        <text>🖨️ 批量打印二维码</text><text class="arrow">›</text>
      </view>
      <view class="menu-item" @tap="goScanBind">
        <text>📍 扫码定位绑定</text><text class="arrow">›</text>
      </view>
    </view>

    <view class="section-title">关于</view>
    <view class="card menu">
      <view class="menu-item">
        <text>当前版本</text><text class="value">{{ version }} {{ envTag }}</text>
      </view>
      <view class="menu-item">
        <text>系统</text><text class="value">设备资产巡检</text>
      </view>
    </view>

    <button class="logout" @tap="onLogout">退出登录</button>
    <view class="tip">本系统仅限项目管理部授权人员使用</view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/store/auth'
import { getAppVersion, getEnvVersion, envLabel } from '@/config/version'
import { showModal, showToast } from '@/utils/feedback'

const auth = useAuthStore()
const version = getAppVersion()
const envTag = envLabel(getEnvVersion())

const initial = computed(() => (auth.user?.real_name || auth.user?.phone || '?').charAt(0))
const roleLabel = computed(() => {
  const r = auth.user?.role
  if (r === 'admin') return '管理员'
  if (r === 'team_leader') return '负责人'
  if (r === 'material_manager') return '物料管理员'
  if (r === 'guest') return '访客（只读）'
  return r || '授权人员'
})

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

async function onLogout() {
  const ok = await showModal({ content: '确定要退出登录吗？', confirmText: '退出' })
  if (!ok) return
  auth.logout()
  showToast('已退出登录', 'none')
  uni.reLaunch({ url: '/pages/login/Login' })
}

onShow(() => {})
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
  padding: 28rpx;
  margin-bottom: 24rpx;
  box-shadow: $tm-shadow-card;
}
.user {
  display: flex;
  align-items: center;
  gap: 24rpx;
}
.avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: $tm-primary;
  color: #fff;
  font-size: 44rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.u-name {
  font-size: 34rpx;
  font-weight: 700;
  color: $tm-text;
}
.u-role {
  margin-top: 6rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  margin: 16rpx 8rpx 16rpx;
}
.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  font-size: 30rpx;
  color: $tm-text;
  border-bottom: 1rpx solid $tm-border-light;
}
.menu-item:last-child {
  border-bottom: none;
}
.arrow {
  color: $tm-text-muted;
  font-size: 36rpx;
}
.value {
  color: $tm-text-secondary;
  font-size: 26rpx;
}

.logout {
  margin-top: 16rpx;
  height: 92rpx;
  line-height: 92rpx;
  background: #fff;
  color: $tm-danger;
  border-radius: $tm-radius;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.logout::after {
  border: none;
}
.tip {
  margin-top: 24rpx;
  text-align: center;
  font-size: 22rpx;
  color: $tm-text-muted;
}
</style>
