<template>
  <view class="page">
    <view class="head">
      <view class="h-room">{{ roomName || roomCode }}</view>
      <view class="h-code">{{ roomCode }}</view>
    </view>

    <view class="card target" v-if="deviceCode">
      <view class="t-label">目标设备</view>
      <view class="t-code">{{ deviceCode }}</view>
      <view class="t-name" v-if="deviceName">{{ deviceName }}</view>
    </view>

    <view class="tip">扫一下设备条码 / 二维码，即可将其盘点并绑定到本房间；完成后自动返回。</view>

    <button class="scan-btn" @tap="onScan">扫码盘点</button>
    <button v-if="deviceCode" class="confirm-btn" @tap="onConfirmTarget">
      确认已盘点（无需扫码）
    </button>

    <view class="status" v-if="status">{{ status }}</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { assetBindDevice, assetCreateGeoObservation, parseScanPayload } from '@/api/asset'
import { invScan } from '@/api/inventory'
import { useScanner } from '@/composables/useScanner'
import { getCurrentPoint } from '@/composables/useGeolocation'
import { useAuthStore } from '@/store/auth'
import { showToast, showModal, showLoading, hideLoading } from '@/utils/feedback'

const auth = useAuthStore()
const scanner = useScanner({
  title: '扫码盘点设备',
  manualContent: '未识别到条码，请输入设备编号',
  manualPlaceholder: '请输入固定资产编号',
})

const roomCode = ref('')
const roomName = ref('')
const deviceCode = ref('')
const deviceName = ref('')
const status = ref('')
const busy = ref(false)

onLoad((opts: any) => {
  roomCode.value = (opts?.roomCode || '').toString()
  roomName.value = decodeURIComponent((opts?.roomName || '').toString() || roomCode.value)
  deviceCode.value = (opts?.deviceCode || '').toString()
  deviceName.value = decodeURIComponent((opts?.deviceName || '').toString())
})

function operator(): string {
  return auth.user?.real_name || auth.user?.phone || '巡检员'
}

async function recordGeo(code: string, source: string) {
  try {
    const geo = await getCurrentPoint()
    if (geo.point) {
      await assetCreateGeoObservation({
        device_code: code,
        latitude: geo.point.latitude,
        longitude: geo.point.longitude,
        accuracy: geo.point.accuracy ?? null,
        room_code: roomCode.value,
        scan_source: source,
        operator: operator(),
      })
    }
  } catch {
    /* 定位可选，失败不阻断绑定 */
  }
}

/** 把一台设备绑定到本房间（含 409 改挂确认），并累加已扫数 */
async function doBind(code: string, source: string, move = false): Promise<boolean> {
  let res: any
  try {
    res = await assetBindDevice(roomCode.value, code, move)
  } catch (e: any) {
    showToast(e?.message || '绑定失败', 'none')
    return false
  }
  // 409：设备已归属其他机房 → 确认是否改挂
  if (res && res.conflict) {
    const ok = await showModal({
      title: '设备已归属其他机房',
      content: `${res.message}\n是否改挂到当前机房「${roomName.value || roomCode.value}」？`,
      confirmText: '改挂',
    })
    if (ok) return doBind(code, source, true)
    return false
  }
  showToast('盘点成功', 'success')
  await recordGeo(code, source)
  // 累加「已扫数」（4 态进度由后端 invScan 驱动）
  try {
    await invScan(roomCode.value, operator())
  } catch {
    /* 进度累加失败不阻断绑定 */
  }
  return true
}

async function onScan() {
  if (!roomCode.value) {
    showToast('缺少房间信息', 'none')
    return
  }
  if (busy.value) return
  busy.value = true
  const r = await scanner.scan()
  busy.value = false
  if (!r) return
  const code = parseScanPayload(r.code)
  if (!code) {
    showToast('无法解析该码', 'none')
    return
  }
  showLoading('盘点中')
  const ok = await doBind(code, r.source)
  hideLoading()
  if (ok) finish()
}

async function onConfirmTarget() {
  if (!deviceCode.value) return
  if (busy.value) return
  busy.value = true
  showLoading('盘点中')
  const ok = await doBind(deviceCode.value, 'manual')
  hideLoading()
  busy.value = false
  if (ok) finish()
}

/** 完成后返回盘点页，由其 onShow 重新加载房间设备清单（该设备即显示为已核对） */
function finish() {
  status.value = '已完成，正在返回…'
  setTimeout(() => {
    uni.navigateBack({ delta: 1 })
  }, 500)
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 32rpx 24rpx calc(env(safe-area-inset-bottom) + 32rpx);
}
.head {
  background: #fff;
  border-radius: $tm-radius;
  padding: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.h-room {
  font-size: 34rpx;
  font-weight: 700;
  color: $tm-text;
}
.h-code {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.target .t-label {
  font-size: 24rpx;
  color: $tm-text-muted;
}
.target .t-code {
  margin-top: 6rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: $tm-primary;
}
.target .t-name {
  margin-top: 6rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.tip {
  font-size: 26rpx;
  color: $tm-text-secondary;
  line-height: 1.6;
  margin: 8rpx 4rpx 28rpx;
}
.scan-btn {
  width: 100%;
  height: 92rpx;
  line-height: 92rpx;
  background: $tm-primary;
  color: #fff;
  border-radius: 46rpx;
  font-size: 30rpx;
  border: none;
}
.scan-btn::after {
  border: none;
}
.confirm-btn {
  width: 100%;
  height: 84rpx;
  line-height: 84rpx;
  background: #fff;
  color: $tm-primary;
  border-radius: 42rpx;
  font-size: 28rpx;
  border: 1rpx solid $tm-primary;
  margin-top: 20rpx;
}
.confirm-btn::after {
  border: none;
}
.status {
  margin-top: 28rpx;
  text-align: center;
  font-size: 26rpx;
  color: $tm-success;
}
</style>
