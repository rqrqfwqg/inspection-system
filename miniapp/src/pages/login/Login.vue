<template>
  <view class="login">
    <view class="hero">
      <view class="logo">巡</view>
      <view class="title">设备资产巡检</view>
      <view class="subtitle">项目管理部 · 机房盘点与设备定位</view>
    </view>

    <!-- 内部系统声明卡（满足微信审核：账号仅限特定人群） -->
    <view class="notice">
      <view class="notice-icon">🔒</view>
      <view class="notice-body">
        <view class="notice-title">内部系统 · 仅限特定人群使用</view>
        <view class="notice-desc">本系统为项目管理部内部资产巡检工具，仅对已在系统登记的授权人员开放。未登记手机号无法登录。</view>
      </view>
    </view>

    <view class="form">
      <button class="btn btn-primary" :loading="loading" @tap="onWxLogin">微信一键登录</button>

      <view class="divider"><text>或</text></view>

      <input
        class="input"
        type="number"
        maxlength="11"
        placeholder="输入已登记的手机号登录"
        placeholder-class="ph"
        v-model="phone"
      />
      <button class="btn btn-outline" :loading="loading" @tap="onPhoneLogin">手机号登录</button>
    </view>

    <view class="footer-tip">登录即表示你已获授权使用该内部系统</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/store/auth'
import { getWxCode } from '@/utils/wx'
import { showToast, showLoading, hideLoading } from '@/utils/feedback'

const auth = useAuthStore()
const phone = ref('')
const loading = ref(false)

function goHome() {
  uni.reLaunch({ url: '/pages/home/Home' })
}

onShow(() => {
  if (auth.isLoggedIn) goHome()
})

async function onWxLogin() {
  if (loading.value) return
  loading.value = true
  try {
    const res = await auth.wxOneKeyLogin()
    if (res && !res.guest && res.access_token) {
      goHome()
      return
    }
    showToast('该微信未登记，请使用已登记手机号登录', 'none')
  } catch {
    showToast('微信登录失败，请使用手机号登录', 'none')
  } finally {
    loading.value = false
  }
}

async function onPhoneLogin() {
  const p = (phone.value || '').trim()
  if (!/^1\d{10}$/.test(p)) {
    showToast('请输入有效的 11 位手机号', 'none')
    return
  }
  if (loading.value) return
  loading.value = true
  showLoading('登录中')
  try {
    const code = await getWxCode().catch(() => '')
    await auth.accountLogin(p, code || undefined)
    hideLoading()
    goHome()
  } catch {
    hideLoading()
    // 统一鉴权失败文案（满足微信审核要求）
    showToast('鉴权未通过：该手机号未在系统登记，本系统仅限特定授权人员使用', 'none')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login {
  min-height: 100vh;
  background: linear-gradient(180deg, #e8f3ff 0%, #f7f8fa 320rpx);
  padding: calc(env(safe-area-inset-top) + 80rpx) 48rpx 48rpx;
  display: flex;
  flex-direction: column;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 48rpx;
}
.logo {
  width: 128rpx;
  height: 128rpx;
  border-radius: 32rpx;
  background: $tm-primary;
  color: #fff;
  font-size: 64rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(25, 137, 250, 0.3);
}
.title {
  margin-top: 24rpx;
  font-size: 44rpx;
  font-weight: 700;
  color: $tm-text;
}
.subtitle {
  margin-top: 8rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
}

.notice {
  display: flex;
  gap: 16rpx;
  background: $tm-success-bg;
  border: 1rpx solid #b7e8c8;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 48rpx;
}
.notice-icon {
  font-size: 36rpx;
  line-height: 1.2;
}
.notice-body {
  flex: 1;
}
.notice-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #07a152;
}
.notice-desc {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #3f9c6d;
  line-height: 1.5;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}
.btn {
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 46rpx;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.btn::after {
  border: none;
}
.btn-primary {
  background: $tm-primary;
  color: #fff;
}
.btn-outline {
  background: #fff;
  color: $tm-primary;
  border: 1rpx solid $tm-primary;
}
.divider {
  text-align: center;
  color: $tm-text-muted;
  font-size: 24rpx;
  position: relative;
}
.divider::before,
.divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 30%;
  height: 1rpx;
  background: $tm-border;
}
.divider::before {
  left: 0;
}
.divider::after {
  right: 0;
}
.input {
  height: 92rpx;
  background: #fff;
  border-radius: $tm-radius-sm;
  padding: 0 28rpx;
  font-size: 30rpx;
  border: 1rpx solid $tm-border;
}
.ph {
  color: $tm-text-muted;
}

.footer-tip {
  margin-top: auto;
  padding-top: 48rpx;
  text-align: center;
  font-size: 22rpx;
  color: $tm-text-muted;
}
</style>
