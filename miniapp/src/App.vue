<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'
import { useAuthStore } from '@/store/auth'
import { requestLoginLocationAuth } from '@/composables/useGeolocation'

// 全局启动逻辑（仅巡检系统，不含工器具订阅消息）
onLaunch(() => {
  // 校验本地登录态是否仍有效（token 存在即视为已登录，后续由 request.ts 401 兜底）
  const authStore = useAuthStore()
  if (!authStore.isLoggedIn) {
    console.log('[inspection] App Launch：未登录')
  }
  // 已登录的老用户不会每次走登录页，在启动时兜一次定位授权。
  // 与登录页共用同一节流（会话内只尝试一次）。
  if (authStore.isLoggedIn) {
    requestLoginLocationAuth()
  }
})

onShow(() => {
  console.log('[inspection] App Show')
})

onHide(() => {
  console.log('[inspection] App Hide')
})
</script>

<style lang="scss">
/* 全局基础样式 */
page {
  background-color: $tm-bg;
  color: $tm-text;
  font-size: 28rpx;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

view,
text,
input,
button {
  box-sizing: border-box;
}
</style>
