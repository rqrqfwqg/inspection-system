<template>
  <view class="page">
    <!-- 说明：仅内部授权人员可建档，不对外开放 -->
    <view class="tip-bar">
      <text class="tb-t">现场新建设备</text>
      <text class="tb-d">仅限已登记人员；编号须与现场铭牌一致，重复编号无法保存</text>
    </view>

    <view class="card">
      <!-- 设备编号 -->
      <view class="fld">
        <text class="lbl">设备编号<text class="req">*</text></text>
        <input
          class="inp"
          placeholder="扫描或输入固定资产编号"
          placeholder-class="ph"
          v-model="form.device_code"
          :disabled="lockedCode"
        />
        <text class="scan" @tap="onScan">扫码</text>
      </view>
      <view class="chk" v-if="checking">
        <text class="c-tip">{{ checkMsg }}</text>
      </view>

      <!-- 设备名称 -->
      <view class="fld">
        <text class="lbl">设备名称<text class="req">*</text></text>
        <input
          class="inp"
          placeholder="如：1# 送风机 / 照明配电箱"
          placeholder-class="ph"
          v-model="form.name"
        />
      </view>

      <!-- 所属系统 -->
      <picker mode="selector" :range="subLabels" @change="onSub">
        <view class="fld">
          <text class="lbl">所属系统</text>
          <text class="inp val">{{ form.subsystem_id ? subNameOf(form.subsystem_id) : '未指定' }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <!-- 楼栋 / 楼层（级联） -->
      <picker mode="selector" :range="bldLabels" @change="onBuilding">
        <view class="fld">
          <text class="lbl">所属楼栋</text>
          <text class="inp val">{{ form.building || '未指定' }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>
      <picker mode="selector" :range="floorLabels" @change="onFloor">
        <view class="fld" :class="{ muted: !form.building }">
          <text class="lbl">所属楼层</text>
          <text class="inp val">{{ form.floor || (form.building ? '未指定' : '请先选楼栋') }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <!-- 位置描述 -->
      <view class="fld col">
        <text class="lbl">位置描述</text>
        <textarea
          class="ta"
          placeholder="选填，如：西侧墙面，距门 3 米"
          placeholder-class="ph"
          v-model="form.location_desc"
        />
      </view>
    </view>

    <view class="err" v-if="submitErr">{{ submitErr }}</view>

    <view class="action-bar">
      <button class="ab-btn" :class="{ disabled: submitting }" @tap="submit">
        {{ submitting ? '提交中…' : '保存设备' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { assetCreateDevice, assetSubsystems, assetRooms, parseScanPayload } from '@/api/asset'
import type { AssetSubsystem, AssetRoom } from '@/types/asset'
import { useScanner } from '@/composables/useScanner'
import { showToast, showLoading, hideLoading } from '@/utils/feedback'

const scanner = useScanner({
  title: '扫描设备二维码',
  manualContent: '未识别到条码，请手动输入设备编号',
  manualPlaceholder: '请输入固定资产编号',
})

const form = reactive({
  device_code: '',
  name: '',
  subsystem_id: null as number | null,
  building: '',
  floor: '',
  location_desc: '',
})

const subsystems = ref<AssetSubsystem[]>([])
const rooms = ref<AssetRoom[]>([])
const submitting = ref(false)
const submitErr = ref('')
const checking = ref(false)
const checkMsg = ref('')
/** 从扫码/预填带进来的编号不允许手改，避免建错档 */
const lockedCode = ref(false)

const subLabels = computed(() => ['未指定'].concat(subsystems.value.map((s) => s.name)))
const bldLabels = computed(() => {
  const set = new Set<string>()
  for (const r of rooms.value) if (r.building) set.add(r.building)
  return ['未指定'].concat(Array.from(set).sort())
})
const floorLabels = computed(() => {
  const set = new Set<string>()
  for (const r of rooms.value) {
    if (r.building === form.building && r.floor) set.add(r.floor)
  }
  return ['未指定'].concat(Array.from(set).sort())
})

function subNameOf(id: number) {
  const hit = subsystems.value.find((s) => s.id === id)
  return hit ? hit.name : '未指定'
}

onLoad(async (opt) => {
  // 支持从别处带编号进来（如扫码后直接建档）
  const pre = (opt as any)?.code ? decodeURIComponent(String((opt as any).code)) : ''
  if (pre) {
    form.device_code = pre
    lockedCode.value = true
  }
  try {
    const [subs, rs] = await Promise.all([assetSubsystems(), assetRooms()])
    subsystems.value = subs || []
    rooms.value = rs || []
  } catch (e: any) {
    showToast(e?.message || '基础数据加载失败', 'none')
  }
})

function onSub(e: any) {
  const i = Number(e.detail.value) || 0
  form.subsystem_id = i === 0 ? null : subsystems.value[i - 1]?.id ?? null
}
function onBuilding(e: any) {
  const i = Number(e.detail.value) || 0
  form.building = i === 0 ? '' : bldLabels.value[i]
  // 楼栋变了，楼层必须清空，否则会出现「A栋-3F」这种错配
  form.floor = ''
}
function onFloor(e: any) {
  const i = Number(e.detail.value) || 0
  form.floor = i === 0 ? '' : floorLabels.value[i]
}

/** 扫码填编号（锁定不可改，防止扫完又被改错） */
async function onScan() {
  const r = await scanner.scan()
  if (!r) return
  const code = parseScanPayload(r.code) || (r.code || '').trim()
  if (!code) {
    showToast('无法识别该码，请手动输入', 'none')
    return
  }
  form.device_code = code
  lockedCode.value = true
  dupCheck(code)
}

/** 编号查重：后端也会防重，这里先给即时反馈（不阻断提交） */
async function dupCheck(code: string) {
  if (!code) {
    checkMsg.value = ''
    return
  }
  checking.value = true
  checkMsg.value = '正在校验编号…'
  try {
    const { assetSearchDevice } = await import('@/api/asset')
    const res = await assetSearchDevice(code, 1)
    const target = res && res.target
    if (target && target.device_code) {
      checkMsg.value = `⚠ 台账已存在该编号（${target.name || '未命名'}），继续保存将新增一条记录`
    } else {
      checkMsg.value = '✓ 编号未被占用'
    }
  } catch {
    checkMsg.value = '编号校验失败，保存时由服务端最终校验'
  } finally {
    checking.value = false
  }
}

/** 提交前校验：返回错误文案，null = 通过 */
function validate(): string | null {
  const code = form.device_code.trim()
  if (!code) return '请填写设备编号'
  if (code.length > 64) return '设备编号过长（上限 64 字符）'
  if (!form.name.trim()) return '请填写设备名称'
  if (form.name.trim().length > 100) return '设备名称过长（上限 100 字符）'
  // 楼栋选了但没选楼层是允许的（有些设备跨层），不拦
  return null
}

async function submit() {
  if (submitting.value) return
  submitErr.value = ''
  const bad = validate()
  if (bad) {
    submitErr.value = bad
    showToast(bad, 'none')
    return
  }
  submitting.value = true
  showLoading('提交中')
  try {
    const res = await assetCreateDevice({
      device_code: form.device_code.trim(),
      name: form.name.trim(),
      subsystem_id: form.subsystem_id,
      building: form.building || undefined,
      floor: form.floor || undefined,
      location_desc: form.location_desc.trim() || undefined,
    })
    hideLoading()
    submitting.value = false
    showToast('设备已创建', 'success')
    // 成功即跳详情，让用户立刻确认建档是否正确
    setTimeout(() => {
      uni.redirectTo({
        url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(res.device_code)}`,
      })
    }, 600)
  } catch (e: any) {
    hideLoading()
    submitting.value = false
    // 优先透传后端 detail（如「设备编号已存在」），比笼统报错有用
    const msg = (e?.message || '').trim() || '创建失败，请稍后重试'
    submitErr.value = msg
    showToast(msg, 'none', 2500)
  }
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 160rpx);
}
.tip-bar {
  background: $tm-primary-bg;
  border-radius: $tm-radius-sm;
  padding: 20rpx 24rpx;
  margin-bottom: 20rpx;
}
.tb-t {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: $tm-primary;
}
.tb-d {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 8rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.fld {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  padding: 22rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.fld:last-child { border-bottom: none; }
.fld.col { flex-direction: column; align-items: stretch; }
.fld.muted { opacity: 0.55; }
.lbl {
  width: 170rpx;
  flex-shrink: 0;
  font-size: 27rpx;
  color: $tm-text-secondary;
}
.req { color: $tm-danger; }
.inp {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: $tm-text;
}
.inp.val {
  text-align: right;
  color: $tm-text-secondary;
}
.ph { color: $tm-text-muted; }
.scan {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 8rpx 24rpx;
  font-size: 24rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  border-radius: 28rpx;
}
.arrow {
  flex-shrink: 0;
  margin-left: 12rpx;
  color: $tm-text-muted;
  font-size: 30rpx;
}
.chk {
  padding: 0 0 16rpx;
}
.c-tip {
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.ta {
  width: 100%;
  height: 130rpx;
  margin-top: 12rpx;
  padding: 16rpx;
  font-size: 26rpx;
  background: $tm-bg;
  border-radius: 12rpx;
}
.err {
  margin-bottom: 16rpx;
  padding: 18rpx 24rpx;
  font-size: 25rpx;
  color: $tm-danger;
  background: $tm-danger-bg;
  border-radius: $tm-radius-sm;
}
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: $tm-card-bg;
}
.ab-btn {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #fff;
  background: $tm-primary;
  border: none;
}
.ab-btn::after { border: none; }
.ab-btn.disabled { opacity: 0.6; }
</style>
