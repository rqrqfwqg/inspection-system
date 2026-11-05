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
        <text class="lbl" :class="{ 'has-tag': !!aiTag('device_code') }">设备编号<text class="req">*</text><text
          class="ai-tag"
          :class="{ edited: aiTag('device_code') === 'AI·已改' }"
          v-if="aiTag('device_code')"
        >{{ aiTag('device_code') }}</text></text>
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
          <text class="lbl" :class="{ 'has-tag': !!aiTag('subsystem_id') }">所属系统<text
            class="ai-tag"
            :class="{ edited: aiTag('subsystem_id') === 'AI·已改' }"
            v-if="aiTag('subsystem_id')"
          >{{ aiTag('subsystem_id') }}</text></text>
          <text class="inp val">{{ form.subsystem_id ? subNameOf(form.subsystem_id) : '未指定' }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <!-- 楼栋（模糊搜索 + 选择确认） -->
      <view class="fld col">
        <text class="lbl" :class="{ 'has-tag': !!aiTag('building') }">所属楼栋<text
          class="ai-tag"
          :class="{ edited: aiTag('building') === 'AI·已改' }"
          v-if="aiTag('building')"
        >{{ aiTag('building') }}</text></text>
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
          <text class="lbl" :class="{ 'has-tag': !!aiTag('floor') }">所属楼层<text
            class="ai-tag"
            :class="{ edited: aiTag('floor') === 'AI·已改' }"
            v-if="aiTag('floor')"
          >{{ aiTag('floor') }}</text></text>
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
          <text class="lbl" :class="{ 'has-tag': !!aiTag('room_id') }">机房<text
            class="ai-tag"
            :class="{ edited: aiTag('room_id') === 'AI·已改' }"
            v-if="aiTag('room_id')"
          >{{ aiTag('room_id') }}</text></text>
          <text class="inp val">{{ roomLabel }}</text>
          <text class="arrow">›</text>
        </view>
      </picker>

      <!-- 位置描述 -->
      <view class="fld col">
        <text class="lbl" :class="{ 'has-tag': !!aiTag('location_desc') }">位置描述<text
          class="ai-tag"
          :class="{ edited: aiTag('location_desc') === 'AI·已改' }"
          v-if="aiTag('location_desc')"
        >{{ aiTag('location_desc') }}</text></text>
        <textarea
          class="ta"
          placeholder="选填，如：西侧墙面，距门 3 米"
          placeholder-class="ph"
          v-model="form.location_desc"
        />
      </view>

      <!-- AI 补全：手动点才跑（不做离开输入框自动执行），结果只进建议面板，采用后才写表单 -->
      <view class="ai-bar">
        <view class="ai-btn" :class="{ disabled: aiLoading }" @tap="onAiSuggest">
          <text class="ai-btn-t">{{ aiLoading ? 'AI 补全中…' : 'AI 补全' }}</text>
          <text class="ai-btn-d">按已填的设备名称 / 位置推断编号与其他字段；结果只是建议，采用后才写入表单</text>
        </view>
      </view>
    </view>

    <view class="err" v-if="submitErr">{{ submitErr }}</view>

    <view class="action-bar">
      <button class="ab-btn" :class="{ disabled: submitting }" @tap="submit">
        {{ submitting ? '提交中…' : '保存设备' }}
      </button>
    </view>

    <!-- AI 补全建议面板（点击「采用」才写表单，点采用之前表单一律不动） -->
    <view v-if="aiOpen" class="sheet-mask" @tap="closeAi">
      <view class="sheet" @tap.stop>
        <view class="sheet-title">AI 补全建议</view>
        <scroll-view scroll-y class="ai-body" :class="{ tall: aiBodyTall }">
          <!-- 失败 / 降级：给明确出路，不白屏、不一直转 -->
          <view class="ai-warn" v-if="aiErr">{{ aiErr }}</view>
          <view class="ai-warn" v-else-if="aiDegraded">{{
            aiRows.length ? 'AI 暂时不可用，已按规则给出编号建议，请核对后采用' : 'AI 暂时不可用，请手动填写'
          }}</view>

          <!-- 推断不出的字段：逐条说清为什么，让用户自己补 -->
          <view class="ai-miss" v-if="aiMissing.length">
            <text class="ai-miss-t">以下信息无法可靠推断，请你补充：</text>
            <view class="ai-miss-i" v-for="(m, i) in aiMissing" :key="`${m.field}-${i}`">
              <text class="ai-miss-k">{{ m.label }}</text>
              <text class="ai-miss-v">{{ m.question }}</text>
            </view>
          </view>

          <view class="ai-info" v-if="aiTypeHint">
            识别到的设备类型：{{ aiTypeHint }}（仅参考，不单独存字段，已体现在编号前缀与名称里）
          </view>

          <view class="ai-row" v-for="r in aiRows" :key="r.field">
            <view class="ai-row-hd">
              <text class="ai-row-k">{{ r.label }}</text>
              <text class="ai-flag low" v-if="r.confidence === 'low'">低置信</text>
              <text class="ai-flag rec" v-else-if="!r.current">建议采用</text>
              <text class="ai-flag done" v-if="r.adopted">已采用</text>
            </view>
            <view class="ai-cell">
              <text class="ai-cell-k">当前</text>
              <text class="ai-cell-v">{{ r.current || '（空）' }}</text>
            </view>
            <view class="ai-cell">
              <text class="ai-cell-k">建议</text>
              <input v-if="r.editable" class="ai-inp" v-model="r.draft" placeholder-class="ph" />
              <text v-else class="ai-cell-v strong">{{ r.display }}</text>
            </view>
            <view class="ai-reason" v-if="r.reason">{{ r.reason }}</view>
            <view class="ai-acts">
              <text class="ai-act ok" :class="{ on: r.adopted }" @tap="applyRow(r)">
                {{ r.adopted ? '已采用' : '采用' }}
              </text>
              <text class="ai-act" :class="{ on: r.ignored }" @tap="ignoreRow(r)">
                {{ r.ignored ? '已忽略' : '忽略' }}
              </text>
            </view>
          </view>

          <view class="ai-empty" v-if="!aiRows.length && !aiErr">没有可自动补全的字段，请手动填写</view>
        </scroll-view>
        <view class="ai-foot">
          <view class="sheet-cancel" @tap="closeAi">关闭</view>
          <view class="sheet-ok" :class="{ disabled: !aiRows.length }" @tap="applyRecommended">采用推荐项</view>
        </view>
      </view>
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
  assetAiSuggest,
} from '@/api/asset'
import type {
  AssetSubsystem,
  AssetRoom,
  AssetAiSuggestPayload,
  AssetAiMissingItem,
} from '@/types/asset'
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

// ===== AI 补全（手动点按钮才跑；结果只进建议面板，采用后才写表单）=====
// 口径：
// - 编号由服务端**规则**生成（拼音首字母 + 尾数唯一性），大模型只推断类型/系统/机房/位置；
// - 用户已手填的字段默认不勾选采用，想覆盖必须自己点；
// - 采用过的字段旁边留「AI」痕迹，用户再改动 → 变「AI·已改」，不悄悄消失；
// - 推断不出的字段由服务端 missing 给出原因，面板顶部逐条提示，绝不替用户猜。

type AiFieldKey =
  | 'device_code'
  | 'subsystem_id'
  | 'building'
  | 'floor'
  | 'room_id'
  | 'location_desc'

interface AiRow {
  field: AiFieldKey
  label: string
  /** 采用前的表单值展示（空 = 用户没填 → 默认推荐） */
  current: string
  /** 服务端建议值（device_code 时可被用户编辑后覆盖） */
  value: string | number
  display: string
  reason: string
  confidence: string
  /** 只有设备编号允许改完再采用 */
  editable: boolean
  draft: string
  adopted: boolean
  ignored: boolean
  /** 采用前的原值，供「忽略」撤销 */
  prev: string | number | null
}

const AI_FIELD_LABEL: Record<AiFieldKey, string> = {
  device_code: '设备编号',
  subsystem_id: '所属系统',
  building: '所属楼栋',
  floor: '所属楼层',
  room_id: '机房',
  location_desc: '位置描述',
}
/** 采用顺序：先把楼栋楼层定位，再选机房（机房候选依赖楼栋+楼层），避免级联把刚选的机房作废 */
const AI_APPLY_ORDER: AiFieldKey[] = [
  'building',
  'floor',
  'room_id',
  'subsystem_id',
  'device_code',
  'location_desc',
]

const aiOpen = ref(false)
const aiLoading = ref(false)
/** 接口失败提示（与「降级」区分：降级仍有编号建议，失败是连建议都没有） */
const aiErr = ref('')
const aiDegraded = ref(false)
/** 识别到的设备类型，仅作参考展示（不单独存字段） */
const aiTypeHint = ref('')
const aiMissing = ref<AssetAiMissingItem[]>([])
const aiRows = ref<AiRow[]>([])
/** 已采用字段的写入值快照：与该值不同即说明用户改过 → 标签变「AI·已改」 */
const aiSnap = reactive<Record<string, string>>({})
/**
 * 面板内容多时给 scroll-view 一个确定高度（小程序里 scroll-view 必须定高才能滚动，
 * 只给 max-height 可能滚不动 → 底部字段被挡在屏外）。内容少时不定高，避免大片空白。
 */
const aiBodyTall = computed(() => aiRows.value.length > 2 || aiMissing.value.length >= 2)

function readField(f: AiFieldKey): string | number | null {
  switch (f) {
    case 'device_code':
      return form.device_code
    case 'subsystem_id':
      return form.subsystem_id
    case 'building':
      return form.building
    case 'floor':
      return form.floor
    case 'room_id':
      return form.room_id
    case 'location_desc':
      return form.location_desc
  }
}

/** 字段当前值的展示文案（系统/机房要显示名称而不是裸 id） */
function fieldText(f: AiFieldKey): string {
  if (f === 'subsystem_id') return form.subsystem_id ? subNameOf(form.subsystem_id) : ''
  if (f === 'room_id') return form.room_id == null ? '' : roomLabel.value
  const v = readField(f)
  return v == null ? '' : String(v)
}

function writeField(f: AiFieldKey, v: string | number | null) {
  if (f === 'device_code') {
    form.device_code = String(v ?? '')
  } else if (f === 'subsystem_id') {
    form.subsystem_id = v == null || v === '' ? null : Number(v)
  } else if (f === 'building') {
    form.building = String(v ?? '')
    bldQuery.value = form.building
  } else if (f === 'floor') {
    form.floor = String(v ?? '')
  } else if (f === 'room_id') {
    form.room_id = v == null || v === '' ? null : Number(v)
  } else {
    form.location_desc = String(v ?? '')
  }
}

/** 字段旁的 AI 留痕：`AI` = 当前值仍是 AI 给的值；`AI·已改` = 采用后被手动改过 */
function aiTag(f: AiFieldKey): string {
  const snap = aiSnap[f]
  if (snap === undefined) return ''
  return fieldText(f) === snap ? 'AI' : 'AI·已改'
}

/** 楼栋/楼层变了 → 已选机房若不属于新位置就清掉（否则会挂错机房） */
function ensureRoomConsistent() {
  if (form.room_id == null) return
  const rm = rooms.value.find((x) => x.id === form.room_id)
  if (!rm || rm.building !== form.building || rm.floor !== form.floor) form.room_id = null
}

function roomLabelOfId(id: number): string {
  const rm = rooms.value.find((x) => x.id === id)
  return rm ? `${rm.name}（${rm.code}）` : `机房 #${id}`
}

/** 接口建议 → 面板行（只渲染服务端真的给了值的字段，不造空行） */
function buildAiRows(s: Record<string, any>) {
  const order: AiFieldKey[] = [
    'device_code',
    'subsystem_id',
    'building',
    'floor',
    'room_id',
    'location_desc',
  ]
  const rows: AiRow[] = []
  for (const f of order) {
    const item = s?.[f]
    if (!item || item.value === undefined || item.value === null || item.value === '') continue
    const value = item.value as string | number
    let display = String(value)
    if (f === 'subsystem_id') display = String(item.subsystem_name || subNameOf(Number(value)))
    else if (f === 'room_id') display = String(s?.room_name || roomLabelOfId(Number(value)))
    rows.push({
      field: f,
      label: AI_FIELD_LABEL[f],
      current: fieldText(f),
      value,
      display,
      reason: String(item.reason || ''),
      confidence: String(item.confidence || ''),
      editable: f === 'device_code',
      draft: display,
      adopted: false,
      ignored: false,
      prev: null,
    })
  }
  aiRows.value = rows
}

async function onAiSuggest() {
  if (aiLoading.value) return
  const name = form.name.trim()
  const loc = form.location_desc.trim()
  if (!name && !loc) {
    showToast('请先填写设备名称或位置描述', 'none')
    return
  }
  const payload: AssetAiSuggestPayload = {
    device_code: form.device_code.trim() || undefined,
    name: name || undefined,
    location_desc: loc || undefined,
    building: form.building || undefined,
    floor: form.floor || undefined,
    room_id: form.room_id,
    subsystem_id: form.subsystem_id,
  }
  aiLoading.value = true
  aiErr.value = ''
  aiDegraded.value = false
  aiTypeHint.value = ''
  aiMissing.value = []
  aiRows.value = []
  try {
    const r = await assetAiSuggest(payload)
    aiMissing.value = Array.isArray(r?.missing) ? r.missing : []
    aiDegraded.value = !!r?.degraded
    aiTypeHint.value = String(r?.suggest?.device_type?.value ?? '')
    buildAiRows((r?.suggest || {}) as Record<string, any>)
    aiOpen.value = true
  } catch (e: any) {
    // 失败也要能继续建档：面板给出明确提示 + 手填出路，不白屏、不一直转圈
    aiErr.value = (e?.message || '').trim() || 'AI 暂时不可用，请手动填写'
    aiRows.value = []
    aiMissing.value = []
    aiOpen.value = true
    showToast(aiErr.value, 'none', 2500)
  } finally {
    aiLoading.value = false
  }
}

function applyRow(r: AiRow) {
  if (r.adopted) return
  let v: string | number = r.value
  if (r.editable) {
    const t = (r.draft || '').trim()
    if (!t) {
      showToast('编号不能为空', 'none')
      return
    }
    v = t
  }
  r.prev = readField(r.field)
  // 机房：先把楼栋/楼层对齐到该机房，否则级联筛选会把刚选的机房清掉
  if (r.field === 'room_id') {
    const rm = rooms.value.find((x) => x.id === Number(v))
    if (rm) {
      form.building = rm.building
      bldQuery.value = rm.building
      form.floor = rm.floor
    }
  }
  writeField(r.field, v)
  if (r.field === 'building' || r.field === 'floor') ensureRoomConsistent()
  if (r.field === 'device_code') {
    tempHint.value = ''
    dupCheck(form.device_code.trim())
  }
  r.adopted = true
  r.ignored = false
  aiSnap[r.field] = fieldText(r.field)
}

/** 忽略 = 不采用；若已采用过则撤销回原值（避免「点了没反应又改不回去」的死角） */
function ignoreRow(r: AiRow) {
  if (r.adopted) {
    writeField(r.field, r.prev)
    if (r.field === 'building' || r.field === 'floor') ensureRoomConsistent()
    delete aiSnap[r.field]
    r.adopted = false
    r.ignored = true
    return
  }
  r.ignored = !r.ignored
}

/** 一键采用「用户没填过」的字段（已手填的不动） */
function applyRecommended() {
  const targets = aiRows.value.filter((r) => !r.adopted && !r.ignored && !r.current)
  if (!targets.length) {
    showToast('没有可采用的空字段', 'none')
    return
  }
  let n = 0
  for (const key of AI_APPLY_ORDER) {
    for (const r of targets) {
      if (r.field !== key || r.adopted) continue
      applyRow(r)
      n += 1
    }
  }
  showToast(`已填入 ${n} 项`, 'success')
}

function closeAi() {
  aiOpen.value = false
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

/* ===== AI 补全：字段旁留痕标签 ===== */
/* 有标签的字段：标签跟在字段名后，标签行不折行；无标签时宽度与其它行一致（不动既有版式） */
.lbl.has-tag {
  width: auto;
  min-width: 170rpx;
  white-space: nowrap;
}
.ai-tag {
  margin-left: 8rpx;
  padding: 0 8rpx;
  font-size: 18rpx;
  line-height: 26rpx;
  color: #b26a00;
  background: #fff4e0;
  border-radius: 6rpx;
}
.ai-tag.edited {
  color: #8a6d3b;
  background: #f1ece3;
}

/* ===== AI 补全：入口按钮（表单卡片底部） ===== */
.ai-bar { padding: 20rpx 0 24rpx; }
.ai-btn {
  padding: 18rpx 22rpx;
  border: 1rpx dashed $tm-primary;
  border-radius: $tm-radius-sm;
  background: $tm-primary-bg;
}
.ai-btn.disabled { opacity: 0.6; }
.ai-btn-t {
  display: block;
  font-size: 27rpx;
  font-weight: 600;
  color: $tm-primary;
}
.ai-btn-d {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  color: $tm-text-secondary;
}

/* ===== AI 补全：建议面板（与补录弹层同一套 sheet 观感） ===== */
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 60;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: $tm-card-bg;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx 24rpx calc(env(safe-area-inset-bottom) + 24rpx);
}
.sheet-title {
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
  margin-bottom: 20rpx;
}
.ai-body { max-height: 58vh; }
.ai-body.tall { height: 58vh; }
.ai-warn {
  margin-bottom: 16rpx;
  padding: 16rpx 20rpx;
  font-size: 24rpx;
  color: #8a5a00;
  background: #fff6e5;
  border-radius: 12rpx;
}
.ai-miss {
  margin-bottom: 16rpx;
  padding: 16rpx 20rpx;
  background: #fff8e6;
  border: 1rpx solid #ffe2a8;
  border-radius: 12rpx;
}
.ai-miss-t {
  display: block;
  margin-bottom: 8rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #8a5a00;
}
.ai-miss-i {
  display: flex;
  align-items: flex-start;
  margin-top: 6rpx;
}
.ai-miss-k {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #8a5a00;
  font-weight: 600;
}
.ai-miss-k::after { content: '：'; }
.ai-miss-v {
  flex: 1;
  font-size: 22rpx;
  line-height: 32rpx;
  color: #7a5b1f;
}
.ai-info {
  margin-bottom: 16rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.ai-row {
  margin-bottom: 18rpx;
  padding: 16rpx 20rpx;
  background: $tm-bg;
  border-radius: 14rpx;
}
.ai-row-hd {
  display: flex;
  align-items: center;
  margin-bottom: 10rpx;
}
.ai-row-k {
  font-size: 26rpx;
  font-weight: 600;
  color: $tm-text;
}
.ai-flag {
  margin-left: 10rpx;
  padding: 0 8rpx;
  font-size: 18rpx;
  line-height: 26rpx;
  border-radius: 6rpx;
}
.ai-flag.rec { color: #2f7cf6; background: #eaf2ff; }
.ai-flag.low { color: #d9534f; background: #fdecec; }
.ai-flag.done { color: #2e8b57; background: #e8f6ee; }
.ai-cell {
  display: flex;
  align-items: flex-start;
  margin-top: 6rpx;
}
.ai-cell-k {
  width: 70rpx;
  flex-shrink: 0;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.ai-cell-v {
  flex: 1;
  font-size: 25rpx;
  line-height: 34rpx;
  color: $tm-text-secondary;
  word-break: break-all;
}
.ai-cell-v.strong {
  color: $tm-text;
  font-weight: 600;
}
.ai-inp {
  flex: 1;
  height: 60rpx;
  padding: 0 16rpx;
  font-size: 25rpx;
  color: $tm-text;
  background: $tm-card-bg;
  border: 1rpx solid $tm-border-light;
  border-radius: 10rpx;
}
.ai-reason {
  margin-top: 8rpx;
  font-size: 20rpx;
  line-height: 28rpx;
  color: $tm-text-muted;
}
.ai-acts {
  display: flex;
  gap: 16rpx;
  margin-top: 12rpx;
}
.ai-act {
  padding: 8rpx 28rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
  background: $tm-card-bg;
  border: 1rpx solid $tm-border-light;
  border-radius: 26rpx;
}
.ai-act.ok {
  color: $tm-primary;
  border-color: $tm-primary;
}
.ai-act.on {
  color: #fff;
  background: $tm-primary;
  border-color: $tm-primary;
}
.ai-empty {
  padding: 24rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: $tm-text-muted;
}
.ai-foot {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 20rpx;
}
.sheet-cancel {
  width: 200rpx;
  height: 88rpx;
  line-height: 88rpx;
  text-align: center;
  font-size: 28rpx;
  color: $tm-text-secondary;
  background: $tm-bg;
  border-radius: 44rpx;
}
.sheet-ok {
  flex: 1;
  height: 88rpx;
  line-height: 88rpx;
  text-align: center;
  border-radius: 44rpx;
  background: $tm-primary;
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
}
.sheet-ok.disabled { opacity: 0.6; }
</style>
