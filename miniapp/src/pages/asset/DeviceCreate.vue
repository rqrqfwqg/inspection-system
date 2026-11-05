<template>
  <view class="page">
    <!-- 说明：仅内部授权人员可建档，不对外开放 -->
    <view class="tip-bar">
      <text class="tb-t">现场新建设备</text>
      <text class="tb-d">仅限已登记人员；编号优先填铭牌上的固定资产编号；现场没有铭牌或铭牌损坏，点「暂无编号」生成临时编号，事后再补录</text>
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
        <text class="scan tmp" @tap="onTempCode">{{ tempLoading ? '取号…' : '暂无编号' }}</text>
      </view>
      <view class="chk" v-if="checking">
        <text class="c-tip">{{ checkMsg }}</text>
        <text class="c-link" v-if="dupCode" @tap="goDup">查看该设备 ›</text>
      </view>
      <view class="chk" v-if="tempHint">
        <text class="c-tip">{{ tempHint }}</text>
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
      <!-- 机型只读提示（扫码回填，不落库） -->
      <view class="model-hint" v-if="modelHint">机型：{{ modelHint }}</view>

      <!-- 所属系统 -->
      <picker mode="selector" :range="subLabels" :value="subIndex" @change="onSub">
        <view class="fld">
          <text class="lbl">所属系统</text>
          <text class="inp val">{{ form.subsystem_id ? subNameOf(form.subsystem_id) : '未指定' }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <!-- 楼栋（模糊搜索 + 选择确认） -->
      <view class="fld col">
        <text class="lbl">所属楼栋</text>
        <input
          class="inp bld-inp"
          placeholder="输入楼栋关键字，如：GTC / 6号仓"
          placeholder-class="ph"
          :value="form.building"
          @input="onBldInput"
          @focus="onBldFocus"
          @blur="onBldBlur"
        />
        <view class="sug" v-if="bldOpen && bldFiltered.length">
          <view
            class="sug-item"
            v-for="(b, i) in bldFiltered"
            :key="i"
            @tap="selectBuilding(b)"
          >{{ b }}</view>
        </view>
        <text class="sug-tip" v-if="bldOpen && bldQuery && !bldFiltered.length">无匹配楼栋，将以上述文字作为楼栋名</text>
      </view>
      <picker mode="selector" :range="floorLabels" :value="floorIndex" @change="onFloor">
        <view class="fld" :class="{ muted: !form.building }">
          <text class="lbl">所属楼层</text>
          <text class="inp val">{{ form.floor || (form.building ? '未指定' : '请先选楼栋') }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <!-- 机房（依赖楼栋 + 楼层；级联筛选） -->
      <picker
        mode="selector"
        :range="roomLabels"
        :value="roomIndex"
        :disabled="!form.building || !form.floor"
        @change="onRoom"
      >
        <view class="fld" :class="{ muted: !form.building || !form.floor }">
          <text class="lbl">机房</text>
          <text class="inp val">{{ roomLabel }}</text>
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
import {
  assetCreateDevice,
  assetSubsystems,
  assetRooms,
  parseScanPayload,
  assetSearchDevice,
  assetTempCode,
} from '@/api/asset'
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
  room_id: null as number | null,
})

const subsystems = ref<AssetSubsystem[]>([])
const rooms = ref<AssetRoom[]>([])
const submitting = ref(false)
const submitErr = ref('')
const checking = ref(false)
const checkMsg = ref('')
/** 从扫码/预填带进来的编号不允许手改，避免建错档 */
const lockedCode = ref(false)
/** 扫码回填的固定资产机型（brand_model），仅作只读提示，不落库 */
const modelHint = ref('')
/** 「暂无编号」取号中（防重复点击） */
const tempLoading = ref(false)
/** 临时编号提示（取到 TMP- 号后显示，避免用户以为这就是铭牌上的固定资产编号） */
const tempHint = ref('')
/** 查重命中的既有设备编号：非空时给出「查看该设备」入口 */
const dupCode = ref('')

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

/** 机房候选：仅限当前楼栋 + 楼层命中的机房（首位「未指定」用于清空） */
const roomLabels = computed(() => {
  const matched = rooms.value.filter(
    (r) => r.building === form.building && r.floor === form.floor,
  )
  return ['未指定'].concat(matched.map((r) => `${r.name}（${r.code}）`))
})

/** 当前已选机房展示名（按 room_id 反查） */
const roomLabel = computed(() => {
  if (form.room_id == null) return '未指定'
  const rm = rooms.value.find((r) => r.id === form.room_id)
  return rm ? `${rm.name}（${rm.code}）` : '未指定'
})

/** 楼栋模糊搜索：候选 = 去重楼栋列表（剔除「未指定」），按输入关键字子串过滤 */
const bldQuery = ref('')
const bldOpen = ref(false)
const bldFiltered = computed(() => {
  const all = bldLabels.value.filter((b) => b && b !== '未指定')
  const q = (bldQuery.value || '').trim().toLowerCase()
  if (!q) return all
  return all.filter((b) => b.toLowerCase().includes(q))
})
function onBldInput(e: any) {
  const v = (e.detail.value || '').trim()
  bldQuery.value = v
  form.building = v
  bldOpen.value = true
}
function onBldFocus() {
  bldOpen.value = true
}
function onBldBlur() {
  // 延迟关闭：确保点击候选项时先触发选中，而非先失焦把列表关掉
  setTimeout(() => { bldOpen.value = false }, 150)
}
/** 从候选里点选确认楼栋：回填 + 触发级联重置（楼层/机房随之失效，避免错配） */
function selectBuilding(name: string) {
  form.building = name
  bldQuery.value = name
  bldOpen.value = false
  form.floor = ''
  form.room_id = null
}
const floorIndex = computed(() => {
  const i = form.floor ? floorLabels.value.indexOf(form.floor) : 0
  return i < 0 ? 0 : i
})
const roomIndex = computed(() => {
  if (form.room_id == null) return 0
  const matched = rooms.value.filter(
    (r) => r.building === form.building && r.floor === form.floor,
  )
  const i = matched.findIndex((r) => r.id === form.room_id)
  return i < 0 ? 0 : i + 1
})
/** 所属系统 picker 的 :value（subLabels 首位为「未指定」，故 +1 偏移） */
const subIndex = computed(() => {
  if (form.subsystem_id == null) return 0
  const i = subsystems.value.findIndex((s) => s.id === form.subsystem_id)
  return i < 0 ? 0 : i + 1
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
function onFloor(e: any) {
  const i = Number(e.detail.value) || 0
  form.floor = i === 0 ? '' : floorLabels.value[i]
  // 楼层变了，机房候选随之变化，已选机房失效
  form.room_id = null
}
/** 机房下拉：range 第 0 项为「未指定」→ null，其余按 roomLabels 偏移反查 room.id */
function onRoom(e: any) {
  const i = Number(e.detail.value) || 0
  form.room_id = i === 0 ? null : roomIdOf(i)
}
function roomIdOf(index: number): number | null {
  if (index <= 0) return null
  const matched = rooms.value.filter(
    (r) => r.building === form.building && r.floor === form.floor,
  )
  return matched[index - 1]?.id ?? null
}

/**
 * 「暂无编号」：向服务端取一个未被占用的临时编号并锁定。
 *
 * 现场大量设备没有固定资产编号铭牌（或铭牌被油污/掉漆看不清），
 * 强拦编号 = 逼作业员拿别人的号顶着，台账从此不可信。故给一条「先建档、后补录」的正路：
 * 取 `TMP-<区域>-<日期>-<流水>` 存入编号框（锁定，防手改成别的号），
 * 后续在设备详情页补录正式编号时，后端会把全部关联处一起改写。
 */
async function onTempCode() {
  if (tempLoading.value) return
  tempLoading.value = true
  try {
    const r = await assetTempCode()
    if (!r?.device_code) throw new Error('未取到临时编号')
    form.device_code = r.device_code
    lockedCode.value = true
    dupCode.value = ''
    checkMsg.value = ''
    tempHint.value = '临时编号，后续可补录正式编号'
  } catch (e: any) {
    // 不许静默：取号失败用户必须知道，否则会以为编号已填好
    showToast((e?.message || '').trim() || '取临时编号失败，请稍后重试', 'none', 2500)
  } finally {
    tempLoading.value = false
  }
}

/** 查重命中 → 跳到该设备详情（原文案「继续保存将新增一条记录」与后端 400 拒绝自相矛盾） */
function goDup() {
  if (!dupCode.value) return
  uni.navigateTo({ url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(dupCode.value)}` })
}

/** 扫码填编号（锁定不可改，防止扫完又被改错）；命中台账则跳详情，否则预填 */
async function onScan() {
  const r = await scanner.scan()
  if (!r) return
  const code = parseScanPayload(r.code) || (r.code || '').trim()
  if (!code) {
    showToast('无法识别该码，请手动输入', 'none')
    return
  }
  // 不直接写进输入框：先让用户确认识别到的编号，避免误扫到别的设备建错档
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '确认设备编号',
      content: `识别到固定资产编号：\n${code}\n\n确认录入该设备？`,
      confirmText: '确认录入',
      cancelText: '重新扫描',
      success: (m) => resolve(!!m.confirm),
      fail: () => resolve(false),
    })
  })
  if (!ok) return
  form.device_code = code
  lockedCode.value = true
  tempHint.value = ''
  try {
    const res = await assetSearchDevice(code, 1)
    // 已在 devices 台账（target.id 非空）→ 直接跳详情，不预填、不建档
    if (res.target && res.target.id) {
      showToast('该设备已在台账，跳转详情', 'success')
      // 延迟跳转：让 toast 先显示出来（navigateTo 可返回本页，不销毁预填表单）
      setTimeout(() => {
        uni.navigateTo({ url: `/pages/asset/DeviceDetail?code=${encodeURIComponent(code)}` })
      }, 250)
      return
    }
    // 进入预填分支先整体重置，避免连续扫两台设备时上一台的楼栋/机房残留（串味）
    form.name = ''
    form.subsystem_id = null
    form.building = ''
    form.floor = ''
    form.room_id = null
    modelHint.value = ''
    // 预填名称：台账名优先，其次固定资产名；都为空则留空（由用户手动填）
    form.name = (res.target?.name) || (res.fixed_asset?.asset_name) || ''
    // 预填子系统：按子系统名称匹配本地字典（早退分支后 target 恒为空，不能再依赖 target.subsystem_id）
    const subName = (res.profile?.subsystem_name) || (res.target?.subsystem_name) || ''
    if (subName) {
      const hit = subsystems.value.find((s) => s.name === subName)
      if (hit) form.subsystem_id = hit.id
    }
    // 机房匹配：候选 code 优先取 room 块，其次固定资产 room_code
    const candidateRoomCode = (res.room?.room_code) || (res.fixed_asset?.room_code) || ''
    if (candidateRoomCode) {
      const room = rooms.value.find((rm) => rm.code === candidateRoomCode)
      if (room) {
        // 命中机房：楼栋/楼层一律按 room 回填（保证与楼层选择器口径一致）
        form.building = room.building
        form.floor = room.floor
        // fuzzy = 系统推断的机房归属，不自动选中，提示现场核实后手选
        const isFuzzy = String(res.fixed_asset?.room_match_method || '') === 'fuzzy'
        if (isFuzzy) {
          form.room_id = null
          showToast('该机房为系统推断，请核实后手动选择', 'none')
        } else {
          form.room_id = room.id
        }
      } else {
        // 降级：仅当 room 块自带楼栋/楼层时回填，机房留空并提示手动选
        if (res.room?.building) form.building = res.room.building
        if (res.room?.floor) form.floor = res.room.floor
        form.room_id = null
        showToast('未能自动匹配机房，请手动选择', 'none')
      }
    }
    // 兜底：机房信息缺失时，用档案（profile）的楼栋/楼层回填，但不猜机房（room_id 保持空）
    if (!form.building && res.profile?.building) form.building = res.profile.building
    if (!form.floor && res.profile?.floor) form.floor = res.profile.floor
    // 机型只读提示（固定资产 brand_model，不落库）
    modelHint.value = res.fixed_asset?.brand_model || ''
  } catch (e: any) {
    // 检索失败不阻断建档：编号已锁，用户可手动补全其余字段
    showToast(e?.message || '设备信息检索失败，请手动填写', 'none')
  }
  // 保留原查重逻辑，给即时占用提示（已在台账分支已提前 return，不会重复跳转）
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
    const res = await assetSearchDevice(code, 1)
    const target = res && res.target
    if (target && target.device_code) {
      // 🔴 旧文案「继续保存将新增一条记录」是错的：后端对重复编号直接 400 拒绝。
      // 提示必须与后端一致（不能重复创建），并给出「查看该设备」的出口。
      dupCode.value = target.device_code
      checkMsg.value = `⚠ 该编号已在台账（${target.name || '未命名'}），不能重复创建`
    } else {
      dupCode.value = ''
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
  // 位置为空只做**二次确认**、不硬拦：有些设备确实跨层/临时摆放，
  // 强填机房会逼作业员随手选一个 → 位置数据比空着更糟。但要让他知道后果。
  if (!form.room_id && !form.building) {
    const goOn = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: '位置未填写',
        content: '该设备将无法在巡检地图上定位，仍要保存？',
        confirmText: '仍要保存',
        cancelText: '返回填写',
        success: (m) => resolve(!!m.confirm),
        fail: () => resolve(false),
      })
    })
    if (!goOn) return
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
      room_id: form.room_id ?? undefined,
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
.bld-inp { padding: 16rpx 0; }
.sug {
  margin-top: 8rpx;
  border: 1rpx solid $tm-border-light;
  border-radius: 12rpx;
  background: $tm-card-bg;
  max-height: 360rpx;
  overflow-y: auto;
}
.sug-item {
  padding: 20rpx 24rpx;
  font-size: 27rpx;
  color: $tm-text;
  border-bottom: 1rpx solid $tm-border-light;
}
.sug-item:last-child { border-bottom: none; }
.sug-item:active { background: $tm-primary-bg; }
.sug-tip {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.scan {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 8rpx 24rpx;
  font-size: 24rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  border-radius: 28rpx;
}
/* 「暂无编号」：与扫码并列的备选路径，弱化配色以示不是主路径 */
.scan.tmp {
  color: $tm-text-secondary;
  background: $tm-bg;
}
.c-link {
  margin-left: 12rpx;
  font-size: 22rpx;
  color: $tm-primary;
}
.arrow {
  flex-shrink: 0;
  margin-left: 12rpx;
  color: $tm-text-muted;
  font-size: 30rpx;
}
.model-hint {
  padding: 0 0 18rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
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
