<template>
  <view class="page" :class="{ 'page-with-geo': showGeoLane }">
    <!-- ============ 按区域快捷分类 ============ -->
    <view class="area-bar">
      <view class="ab-row">
        <text class="ab-lbl">按区域</text>
        <view class="ab-dims">
          <view
            v-for="d in DIMS"
            :key="d.key"
            class="ab-dim"
            :class="{ active: dim === d.key }"
            @tap="switchDim(d.key)"
          >{{ d.label }}</view>
        </view>
        <text class="ab-clear" v-if="areaKey" @tap="clearArea">清除</text>
      </view>
      <scroll-view class="area-scroll" scroll-x enable-flex :show-scrollbar="false">
        <view class="area-row">
          <view
            class="area"
            :class="{ active: !areaKey }"
            @tap="pickArea('')"
          >全部（{{ rows.length }}）</view>
          <view
            v-for="g in areaGroups"
            :key="g.key"
            class="area"
            :class="{ active: areaKey === g.key }"
            @tap="pickArea(g.key)"
          >
            {{ g.label }}<text class="area-n">（{{ g.count }}）</text>
          </view>
          <view v-if="!areaGroups.length && !loading" class="area area-tip">暂无区域分组</view>
        </view>
      </scroll-view>
      <view class="area-sel" v-if="areaKey">
        已筛选：<text class="as-txt">{{ currentAreaLabel }}</text>
      </view>
    </view>

    <!-- ============ 状态筛选 + 搜索 ============ -->
    <view class="bar2">
      <view class="f-tabs">
        <view
          v-for="f in FILTERS"
          :key="f.key"
          class="f-tab"
          :class="{ active: filter === f.key }"
          @tap="setFilter(f.key)"
        >{{ f.label }}</view>
      </view>
      <view class="srch">
        <input
          class="f-search"
          placeholder="搜机房名/编号/楼栋"
          placeholder-class="ph"
          v-model="kw"
        />
        <text class="f-refresh" @tap="load">刷新</text>
      </view>
    </view>

    <!-- ============ 批量操作条 ============ -->
    <view v-if="batchMode" class="batch">
      <view class="b-check" @tap="toggleAll">
        <view class="box" :class="{ on: allChecked }">{{ allChecked ? '✓' : '' }}</view>
        <text>全选当前{{ rows.length }} 间</text>
      </view>
      <text class="b-count">已选 {{ picked.size }} 间</text>
      <button class="b-btn" @tap="batchDone">批量完成盘点</button>
    </view>

    <!-- ============ 房间列表 ============ -->
    <view class="list-head">
      <view class="lh-mode" @tap="batchMode = !batchMode">
        {{ batchMode ? '退出批量' : '批量盘点' }}
      </view>
      <text class="lh-count">共 {{ rows.length }} 间{{ areaKey ? `（${currentAreaLabel}）` : '' }}</text>
    </view>

    <view v-if="loading" class="tip">加载中…</view>
    <view v-else-if="!rows.length" class="tip">
      {{ all.length ? '当前筛选下没有机房' : '暂无机房数据' }}
    </view>

    <view
      v-for="r in rows"
      :key="r.code"
      class="room"
      :class="{ picked: picked.has(r.code) }"
      @tap="onRoomTap(r)"
    >
      <view v-if="batchMode" class="box" :class="{ on: picked.has(r.code) }">
        {{ picked.has(r.code) ? '✓' : '' }}
      </view>
      <view class="r-main">
        <view class="r-line1">
          <text class="r-name">{{ r.name }}</text>
          <text class="r-dot" :style="{ background: INV_STATUS_COLOR[r.status] }"></text>
          <text class="r-st" :style="{ color: INV_STATUS_COLOR[r.status] }">
            {{ INV_STATUS_LABEL[r.status] }}
          </text>
        </view>
        <view class="r-line2">
          <text class="r-code">{{ r.code }}</text>
          <text class="r-bld">{{ r.building }} · {{ r.floor }}</text>
        </view>
        <view class="r-line3">
          <text class="r-dev">{{ r.deviceCount }} 台设备</text>
          <text v-if="r.status === INV_STATUS.DOING" class="r-prog">
            已扫 {{ r.scannedCount }}/{{ r.deviceCount }}
          </text>
          <text v-if="r.emptyConfirmed" class="r-empty">空房确认</text>
          <text v-if="r.inspectedAt" class="r-time">{{ fmtTime(r.inspectedAt) }} · {{ r.inspector }}</text>
        </view>
        <view v-if="r.status === INV_STATUS.ABNORMAL && r.abnormalReason" class="r-abn">
          ⚠ {{ r.abnormalReason }}
        </view>
      </view>
    </view>

    <!-- ============ 当前房间的设备清单（逐台核对） ============ -->
    <!--
      🔴 2026-10-14 补：原盘点系统的核心能力此前完全没继承过来 ——
      页面只能看到「N 台设备」一个数字，无法逐台核对。
      设计取舍：① 放在当前页展开而非跳新页，避免打断「连���扫几十台」的节奏；
      ② 勾选可手动点，也可扫码后自动勾上，两种现场习惯都支持；
      ③ 空房间明确提示「本房间暂无绑定设备」而不是空白，避免误以为加载失败。
    -->
    <view class="dev-panel" v-if="current">
      <view class="dp-head" @tap="devOpen = !devOpen">
        <text class="dp-title">
          设备清单
          <text class="dp-caret">{{ devOpen ? '▾' : '▸' }}</text>
        </text>
        <text class="dp-count" v-if="roomDevices.length">
          已核对 {{ devCheckedCount }}/{{ roomDevices.length }}
        </text>
        <text class="dp-count dp-empty-hint" v-else-if="!devLoading">共 0 台</text>
      </view>

      <view class="dp-body" v-if="devOpen">
        <view v-if="devLoading" class="dp-hint">清单加载中…</view>

        <!-- 加载失败：与「空房间」区分，可重试 -->
        <view v-else-if="devError" class="dp-err" @tap="current && loadRoom(current.code)">
          <text>清单加载失败：{{ devError }}</text>
          <text class="dp-retry">点击重试</text>
        </view>

        <!-- 空房间：说清是「本来就没有设备」，不是加载失败 -->
        <view v-else-if="!roomDevices.length" class="dp-hint">
          本房间暂无绑定设备。如现场实际有设备，扫一下即可自动挂入。
        </view>

        <view v-else>
          <view
            v-for="d in roomDevices"
            :key="d.device_code"
            class="dev-row"
            :class="{ checked: d.checked, added: d.added }"
            @tap="toggleDeviceChecked(d.device_code)"
          >
            <view class="dr-box" :class="{ on: d.checked }">
              <text v-if="d.checked" class="dr-tick">✓</text>
            </view>
            <view class="dr-main">
              <view class="dr-code">{{ d.device_code }}</view>
              <view class="dr-name">
                {{ d.name }}
                <text class="dr-add" v-if="d.added">本次新增</text>
              </view>
              <view class="dr-meta" v-if="d.subsystem_name || d.brand_model">
                <text v-if="d.subsystem_name">{{ d.subsystem_name }}</text>
                <text v-if="d.brand_model">{{ d.brand_model }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- ============ 扫码后的可选旁路：手动确认位置 ============ -->
    <!--
      🔴 刻意做成**独立可选旁路**，绝不插进扫码主流程的步骤里：
      上一轮明确做过「定位失败绝不阻断扫码」的设计，扫码节奏（连续扫几十台）
      是现场效率的核心；这里只在扫完、且已拿到自动定位坐标时，
      在底部操作条**上方**给一个可选入口，点不点都不影响盘点。
    -->
    <view class="geo-lane" v-if="showGeoLane">
      <view class="gl-main">
        <text class="gl-t">已记录 {{ lastScan }} 的自动定位</text>
        <text class="gl-d">室内定位可能偏差较大，可人工核对修正</text>
      </view>
      <text class="gl-btn" @tap="onManualConfirm">手动确认位置</text>
    </view>

    <!-- ============ 底部操作 ============ -->
    <view class="action-bar" v-if="current">
      <view class="ab-info">
        <text class="ab-name">{{ current.name }}</text>
        <text class="ab-meta">
          {{ current.code }} ·
          <text v-if="current.status === INV_STATUS.DOING">
            已扫 {{ current.scannedCount }}/{{ current.deviceCount }}
          </text>
          <text v-else>{{ current.deviceCount }} 台</text>
        </text>
      </view>
      <button class="ab-btn ab-scan" @tap="onScanBind">扫码绑定</button>
      <button
        v-if="INV_TERMINAL.includes(current.status)"
        class="ab-btn ab-undo"
        @tap="onUndo"
      >撤销</button>
      <button v-else class="ab-btn ab-done" @tap="onComplete">
        {{ current.status === INV_STATUS.DOING ? '提交盘点' : '开始盘点' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  assetInventoryOverview,
  assetRoomDevices,
  assetBindDevice,
  assetCompleteRoomInventory,
  assetUndoRoomInventory,
  assetCreateGeoObservation,
  parseScanPayload,
} from '@/api/asset'
import {
  INV_STATUS,
  INV_STATUS_LABEL,
  INV_STATUS_COLOR,
  INV_TERMINAL,
  fmtTime,
  invStart,
  invScan,
  invSubmit,
  type InvRoomRow,
  type InvStatus,
} from '@/api/inventory'
import type { RoomDevicesResult, BindDeviceOutcome } from '@/types/asset'
import { useScanner } from '@/composables/useScanner'
import { getCurrentPoint } from '@/composables/useGeolocation'
import { chooseLocation, chooseFailText } from '@/composables/useChooseLocation'
import { reportManualDeviceGeo } from '@/api/geo'
import { useAuthStore } from '@/store/auth'
import { getJSON, set as setStore } from '@/utils/storage'
import { showToast, showModal, showInputModal, showLoading, hideLoading } from '@/utils/feedback'

const auth = useAuthStore()
const scanner = useScanner({
  title: '扫码绑定设备',
  manualContent: '未识别到条码，请输入设备编号',
  manualPlaceholder: '请输入固定资产编号',
})

type FilterKey = 'all' | InvStatus
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待盘' },
  { key: 'doing', label: '进行中' },
  { key: 'completed', label: '已盘' },
  { key: 'abnormal', label: '异常' },
]

const all = ref<InvRoomRow[]>([])
const loading = ref(false)
const filter = ref<FilterKey>('all')
const kw = ref('')
const batchMode = ref(false)
const picked = ref<Set<string>>(new Set())
const current = ref<InvRoomRow | null>(null)
const busy = ref(false)

/**
 * 最近一次扫码绑定成功、且**确实取到自动定位**的设备编号。
 * 只有这个场景才显示「手动确认位置」旁路入口 —— 取不到定位就没有"核对"的对象。
 *
 * 🔴 它**必须与 lastScanRoom 成对使用**：只记设备号不记房间，换房后就分不清
 * 「这个设备属于哪间房」，会往生产库写错 room_code（脏数据，QA P1-2）。
 * 两个字段一起清空、一起写入、写入前一起校验。
 */
const lastScan = ref('')
/** lastScan 那台设备**当时所在**的房间编号（与 lastScan 同生共死） */
const lastScanRoom = ref('')

/**
 * 浮条是否显示 —— 同时驱动 `.page` 的动态下边距（QA P1-4）。
 * 过去 padding-bottom 恒为 safe-area+160rpx（只给 action-bar 预留），
 * 浮条一出现就压住设备列表底部 1-2 行，而这正是要连续扫码的那几行，点不到。
 */
/**
 * 🔴 设备清单（原来完全缺失，2026-10-14 补）。
 *
 * 之前 loadRoom() 把 assetRoomDevices 的返回结果只取了一个 count 数字就丢掉，
 * 设备数组从未被接收、更没有渲染 —— 所以现场点进房间只能看到一个台数数字，
 * 原盘点系统的「逐台清单 + 逐台打勾」完全没继承过来。
 *
 * 现在完整接住：选房时拉清单 → 渲染逐行 → 扫码绑定成功后本地勾上并标「新增」
 * （本次扫码才挂上来的设备原本不在该房间清单里，必须单独标出来，
 *  否则打完勾会「消失」，让人以为扫错了或数据丢了）。
 */
interface RoomDeviceRow {
  device_code: string
  name: string
  subsystem_name?: string
  brand_model?: string
  location_desc?: string
  is_active?: boolean
  /** 本次盘点已扫码核对 */
  checked?: boolean
  /** 是本次扫码才绑定到本房间的（不在进入时的原始清单里） */
  added?: boolean
}

const roomDevices = ref<RoomDeviceRow[]>([])
const devLoading = ref(false)
const devError = ref('')
/** 清单是否展开（默认展开：进房就是为了看清单） */
const devOpen = ref(true)

const showGeoLane = computed(() => !!current.value && !!lastScan.value)

const operator = computed(() => auth.user?.real_name || auth.user?.phone || '巡检员')

// ═════════════按区域快捷分类 ═════════════
// 区域字段直接取自 assetInventoryOverview 返回的 building / floor / room_type，
// 后端零改动。三档粒度对应现场不同的巡检范围。
type DimKey = 'building' | 'floor' | 'roomType'
const DIMS: Array<{ key: DimKey; label: string }> = [
  { key: 'building', label: '按楼栋' },
  { key: 'floor', label: '按楼层' },
  { key: 'roomType', label: '按房间类型' },
]
const dim = ref<DimKey>('building')
const areaKey = ref('')

/** 按当前粒度把房间分组，count 为该组房间数（用于 chip 上的数字） */
const areaGroups = computed(() => {
  const map = new Map<string, { key: string; label: string; count: number }>()
  for (const r of all.value) {
    let key = ''
    let label = ''
    if (dim.value === 'building') {
      key = r.building || '未分配楼栋'
      label = key
    } else if (dim.value === 'floor') {
      const b = r.building || '未分配楼栋'
      const f = r.floor || '未分配楼层'
      key = `${b}·${f}`
      label = key
    } else {
      key = r.roomType || '未分类'
      label = key
    }
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { key, label, count: 1 })
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
})

const currentAreaLabel = computed(() => {
  const hit = areaGroups.value.find((g) => g.key === areaKey.value)
  return hit ? hit.label : areaKey.value
})

function switchDim(k: DimKey) {
  if (dim.value === k) return
  dim.value = k
  // 换粒度后旧选中项已失效，自动清空避免出现空列表
  areaKey.value = ''
}
function pickArea(k: string) {
  areaKey.value = k
  // 切区域时退出批量并清空已选，避免跨区域误操作
  if (k) {
    batchMode.value = false
    picked.value = new Set()
  }
}
function clearArea() {
  areaKey.value = ''
}

const rows = computed(() => {
  const q = kw.value.trim().toLowerCase()
  return all.value.filter((r) => {
    if (filter.value !== 'all' && r.status !== filter.value) return false
    // 区域分类与状态、关键字三者叠加
    if (areaKey.value) {
      let key = ''
      if (dim.value === 'building') key = r.building || '未分配楼栋'
      else if (dim.value === 'floor') key = `${r.building || '未分配楼栋'}·${r.floor || '未分配楼层'}`
      else key = r.roomType || '未分类'
      if (key !== areaKey.value) return false
    }
    if (!q) return true
    return (r.name + r.code + r.building + r.floor).toLowerCase().includes(q)
  })
})

const allChecked = computed(
  () => rows.value.length > 0 && rows.value.every((r) => picked.value.has(r.code)),
)

async function load() {
  loading.value = true
  try {
    const res = await assetInventoryOverview()
    const raw = (res && res.rooms ? res.rooms : []) || []
    // 🔴 4 态直接读后端 inv_status（2026-10-13 起）——不再用本机 inv_doing_rooms 推断
    all.value = raw.map((r) => {
      const st = (r.inv_status || (r.inspected ? 'completed' : 'pending')) as InvStatus
      return {
        code: r.code,
        name: r.name || r.code,
        building: r.building || '',
        floor: r.floor || '',
        roomType: r.room_type || '',
        deviceCount: Number(r.device_count || 0),
        status: st,
        scannedCount: Number(r.scanned_count || 0),
        abnormalReason: r.abnormal_reason || '',
        inspectedAt: r.inspected_at || '',
        inspector: r.inspector || '',
        emptyConfirmed: !!r.empty_confirmed,
      }
    })
  } catch (e: any) {
    showToast(e?.message || '盘点数据加载失败', 'none')
    all.value = []
  } finally {
    loading.value = false
  }
}

function setFilter(f: FilterKey) {
  filter.value = f
}

/** 把后端返回的盘点记录块合并到本地行（4 态 + 进度） */
function applyRecord(code: string, rec: any) {
  const hit = all.value.find((r) => r.code === code)
  if (!hit || !rec) return
  hit.status = (rec.status || 'pending') as InvStatus
  hit.scannedCount = Number(rec.scanned_count || 0)
  hit.abnormalReason = rec.abnormal_reason || ''
  if (rec.completed_at) hit.inspectedAt = rec.completed_at
  if (rec.operator) hit.inspector = rec.operator
  if (rec.empty_confirmed != null) hit.emptyConfirmed = !!rec.empty_confirmed
  if (current.value && current.value.code === code) current.value = hit
}

/**
 * 🔴 选定当前盘点房间的**唯一入口**（QA P1-2）。
 *
 * 为什么必须收敛成一个函数：`lastScan`（"已记录XX的自动定位"）只对**它所属的那间房**成立。
 * 过去清空逻辑只写在 onRoomTap 里，而 onShow的prefill 分支也会改 `current`——
 * 于是出现脏数据路径：
 *   A 房扫码 → lastScan=A房设备 → 点 B 房详情「去盘点这间房」→ onShow 把 current 改成 B
 *   → 浮条仍显示「已记录 A 房设备的自动定位」→ 用户点「手动确认位置」
 *   → 写入 deviceCode=A房设备, roomCode=B房（B 房代表点被拉到 A 房，且不可删）。
 * 收敛后「换房即清 lastScan」这条不变量只有一处实现，新增入口不会再漏。
 *
 * @param r null 表示清空当前房间（同时清 lastScan）
 * @param keepScan true 仅在**确认是同一间房**时保留 lastScan（默认换房即清）
 */
function selectRoom(r: InvRoomRow | null, keepScan = false) {
  const sameRoom = !!r && !!current.value && current.value.code === r.code
  // 不变量：lastScan 与 lastScanRoom 永远同生共死，且只属于 current.code 这一间房
  if (!keepScan || !sameRoom) clearLastScan()
  current.value = r
}

/** 清空「手动确认位置」旁路的全部状态（设备号 + 它所属房间），两处必须一起清 */
function clearLastScan() {
  lastScan.value = ''
  lastScanRoom.value = ''
}

async function onRoomTap(r: InvRoomRow) {
  if (batchMode) {
    const s = new Set(picked.value)
    if (s.has(r.code)) s.delete(r.code)
    else s.add(r.code)
    picked.value = s
    return
  }
  // 换房即清掉上一间的「手动确认位置」旁路入口，避免在 A 房点确认却写的是 B 房的设备
  selectRoom(r)
  // 已终态的不重开单；未终态的懒开单（进房即开始，符合现场「进门就开始盘」直觉）
  if (!INV_TERMINAL.includes(r.status)) {
    try {
      const res = await invStart(r.code, operator.value)
      if (res && res.inspected) applyRecord(r.code, res.inspected)
    } catch {
      /* 开单失败不阻断，用户仍可扫码 */
    }
  }
  loadRoom(r.code)
}

async function loadRoom(code: string) {
  devLoading.value = true
  devError.value = ''
  try {
    const res: RoomDevicesResult = await assetRoomDevices(code)
    const hit = all.value.find((x) => x.code === code)
    if (hit) {
      hit.deviceCount = Number(res.count || 0)
      if (current.value && current.value.code === code) current.value = hit
    }
    // 🔴 关键修复：设备数组必须落到状态里，不能只留 count。
    // 已勾选项按device_code 保留（换房再回来时不必重新逐台扫），
    // 但「本次扫码新增」的标记要清掉——那是上一次进房的产物。
    const prev = new Set(roomDevices.value.filter((d) => d.checked).map((d) => d.device_code))
    roomDevices.value = (res.devices || []).map((d) => ({
      device_code: d.device_code,
      name: d.name || '—',
      subsystem_name: d.subsystem_name || '',
      brand_model: d.brand_model || '',
      location_desc: d.location_desc || '',
      is_active: d.is_active !== false,
      checked: prev.has(d.device_code),
      added: false,
    }))
    devOpen.value = true
  } catch (e: any) {
    devError.value = (e?.message || '').trim() || '设备清单加载失败'
    roomDevices.value = []
  } finally {
    devLoading.value = false
  }
}

/** 清单里的勾选数（只算本房间原始设备，不含本次扫码新增的） */
const devCheckedCount = computed(
  () => roomDevices.value.filter((d) => d.checked && !d.added).length,
)

/** 手动切换某台设备的核对状态（现场没扫码时也能逐台核对） */
function toggleDeviceChecked(code: string) {
  const hit = roomDevices.value.find((d) => d.device_code === code)
  if (!hit) return
  hit.checked = !hit.checked
}

function toggleAll() {
  if (allChecked.value) {
    picked.value = new Set()
    return
  }
  picked.value = new Set(rows.value.map((r) => r.code))
}

async function batchDone() {
  const codes = Array.from(picked.value)
  if (!codes.length) {
    showToast('请先选择机房', 'none')
    return
  }
  const ok = await showModal({
    title: '批量完成盘点',
    content: `确认将 ${codes.length} 间机房标记为「已完成」？\n设备数由系统按当前绑定自动统计。`,
    confirmText: '确认',
  })
  if (!ok) return
  showLoading(`提交 ${codes.length} 间`)
  let done = 0
  const failed: string[] = []
  for (const code of codes) {
    try {
      // 批量走 4 态：开单 → 直接提交（未扫码故 scanned=0，有设备的房间会落到 abnormal）
      const started = await invStart(code, operator.value)
      const res = await invSubmit(code, { operator: operator.value })
      if (res && res.inspected) applyRecord(code, res.inspected)
      // 后端要求扫不够须填说明：批量场景统一标为「现场确认无变化」以完成闭环
      if (res && res.need_reason) {
        await invSubmit(code, {
          operator: operator.value,
          abnormal_reason: '批量确认：现场核对无变化（未逐台扫码）',
        })
      }
      done += 1
    } catch {
      failed.push(code)
    }
  }
  hideLoading()
  picked.value = new Set()
  batchMode.value = false
  await load()
  if (failed.length) {
    showToast(`成功 ${done} 间，失败 ${failed.length} 间`, 'none', 2600)
  } else {
    showToast(`已完成 ${done} 间`, 'success')
  }
}

async function recordGeo(deviceCode: string, scanSource: string) {
  try {
    const geo = await getCurrentPoint()
    if (geo.point) {
      // ⚠️ 房间号取**此刻的 current**，并与设备号成对记入 lastScan/lastScanRoom，
      //供 onManualConfirm 写入前复核（QA P1-2）
      const roomCode = current.value?.code || ''
      await assetCreateGeoObservation({
        device_code: deviceCode,
        latitude: geo.point.latitude,
        longitude: geo.point.longitude,
        accuracy: geo.point.accuracy ?? null,
        room_code: roomCode,
        scan_source: scanSource,
        operator: operator.value,
      })
      // 已成功记下自动定位 → 才给「手动确认位置」旁路入口（核对有个前提对象）
      lastScan.value = deviceCode
      lastScanRoom.value = roomCode
    }
  } catch {
    /* 定位可选，失败不阻断绑定 */
  }
}

/**
 * 手动确认位置（**可选旁路**，绝不阻断/延后扫码主流程）：
 * 用户在地图上重新选点 → 追加一条 `scan_source: 'manual'` 的观测（真落库）。
 *
 * 🔴 语义：与设备详情页的「手动修正位置」完全同源 ——
 * 后端该接口每次调用追加一条、不做幂等合并（这是「设备是否被移动过」的证据链），
 * 所以修正 3 次就是 3 条 manual 记录；读取侧由 geo.ts 的 deviceGeo 统一
 * 按「最新一条 manual 为代表点」处理。
 *
 * 🔴 两道防线（QA P1-2，写错 room_code 是**不可删除的脏数据**，会污染房间代表点）：
 *   1. 换房即清（selectRoom 统一处理，onRoomTap / onShow prefill 都走它）；
 *   2. **写入前复核**：lastScanRoom（扫码时那台设备所属的房间）必须等于
 *      当前 current.code，不一致直接拒绝写入 —— 将来新增入口再漏清，
 *      这里也能挡住，不会往生产库写脏记录。
 */
async function onManualConfirm() {
  const code = lastScan.value
  if (!code) return
  if (busy.value) return
  // 🔴 防线 2：设备所属房间 ≠ 当前房间 → 拒绝写入（宁可不做，也不写脏数据）
  if (!current.value || lastScanRoom.value !== current.value.code) {
    clearLastScan()
    showToast('房间已切换，请重新扫码后再确认位置', 'none', 2200)
    return
  }
  busy.value = true
  const picked = await chooseLocation()
  busy.value = false
  // 用户取消 = 正常操作，静默返回，不弹任何错误提示
  if (picked.reason === 'cancel' || !picked.point) {
    if (picked.reason && picked.reason !== 'cancel') {
      showToast(chooseFailText(picked.reason), 'none', 1800)
    }
    return
  }
  // 选点是异步的，回调回来时房间可能又变了 → 落笔前再核一次
  if (!current.value || lastScanRoom.value !== current.value.code) {
    clearLastScan()
    showToast('房间已切换，未保存位置', 'none', 2200)
    return
  }
  try {
    const ok = await reportManualDeviceGeo({
      deviceCode: code,
      latitude: picked.point.latitude,
      longitude: picked.point.longitude,
      roomCode: current.value.code,
      operator: operator.value,
    })
    // 🔴 QA P2-4：返回 false = 根本没写进库，绝不能弹「已保存」
    if (!ok) {
      showToast('保存失败：选点无效或设备编号缺失，未写入记录', 'none', 2200)
      return
    }
    showToast('已保存人工确认位置', 'success')
  } catch (e: any) {
    showToast(e?.message || '保存失败，请重试', 'none')
  }
}

async function doBind(deviceCode: string, scanSource: string, move = false) {
  if (!current.value) return
  const room = current.value.code
  let res: BindDeviceOutcome
  try {
    res = await assetBindDevice(room, deviceCode, move)
  } catch (e: any) {
    showToast(e?.message || '绑定失败', 'none')
    return
  }
  if ('conflict' in res && (res as any).conflict) {
    const c = res as any
    const ok = await showModal({
      title: '设备已归属其他机房',
      content: `${c.message}\n是否改挂到当前机房「${current.value.name}」？`,
      confirmText: '改挂',
    })
    if (ok) await doBind(deviceCode, scanSource, true)
    return
  }
  showToast('绑定成功', 'success')
  await recordGeo(deviceCode, scanSource)
  await loadRoom(room)
  // 扫码绑定的设备就是「这台我核对过了」——同步勾上。
  // 刚绑上的设备会出现在 loadRoom 拉回的新清单里（此时 added=false，
  // 因为它已经是该房间的正式成员）；若因时序没出现，则单独补一行并标 added。
  markChecked(deviceCode)
  // 🔴 绑定成功 = 扫到 1 台 → 累加盘点进度（4 态的「已扫数」由此驱动）
  try {
    const res = await invScan(room, operator.value)
    if (res && res.inspected) applyRecord(room, res.inspected)
  } catch {
    /* 进度累加失败不阻断绑定（绑定是主动作） */
  }
}

/** 把某台设备在清单里勾上；不在清单里则补进来并标记为本次新增 */
function markChecked(deviceCode: string) {
  const hit = roomDevices.value.find((d) => d.device_code === deviceCode)
  if (hit) {
    hit.checked = true
    return
  }
  roomDevices.value = [
    ...roomDevices.value,
    {
      device_code: deviceCode,
      name: '本次扫码新增',
      subsystem_name: '',
      brand_model: '',
      location_desc: '',
      is_active: true,
      checked: true,
      added: true,
    },
  ]
}

async function onScanBind() {
  if (!current.value) {
    showToast('请先选择机房', 'none')
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
  showLoading('绑定中')
  await doBind(code, r.source)
  hideLoading()
}

/**
 * 提交盘点（4 态）。
 * -未开单/未扫 → 走「开始盘点」分支（开单）
 * - 已开单 → 提交；**扫不够时后端返回 need_reason**，此处弹异常说明输入框
 */
async function onComplete() {
  if (!current.value) return
  const room = current.value

  // 还没开单 → 先开单，提示开始盘点
  if (!INV_TERMINAL.includes(room.status) && room.status !== INV_STATUS.DOING) {
    showLoading('开单中')
    try {
      const res = await invStart(room.code, operator.value)
      if (res && res.inspected) applyRecord(room.code, res.inspected)
      showToast(`已开始盘点（应扫 ${res?.expected_count ?? room.deviceCount} 台）`, 'success')
    } catch (e: any) {
      showToast(e?.message || '开单失败', 'none')
    } finally {
      hideLoading()
    }
    return
  }

  const ok = await showModal({
    title: '提交盘点',
    content: `确认提交「${room.name}」的盘点结果？\n已扫 ${room.scannedCount}/${room.deviceCount} 台。\n若数量不足，需填写异常说明后提交。`,
    confirmText: '提交',
  })
  if (!ok) return

  showLoading('提交中')
  try {
    let res = await invSubmit(room.code, { operator: operator.value })
    // 扫不够且没填说明 → 弹异常说明输入框（后端契约：need_reason）
    if (res && res.need_reason) {
      hideLoading()
      const reason = await showInputModal({
        title: `异常说明（${room.scannedCount}/${room.deviceCount}）`,
        placeholderText: '如：3 台设备缺失，疑似已拆除',
        confirmText: '提交为异常',
      })
      if (!reason.confirm || !reason.content.trim()) {
        showToast('异常提交必须填写说明', 'none')
        return
      }
      showLoading('提交中')
      res = await invSubmit(room.code, {
        operator: operator.value,
        abnormal_reason: reason.content.trim(),
      })
    }
    if (res && res.inspected) applyRecord(room.code, res.inspected)
    const st = res?.inspected?.status
    showToast(st === 'abnormal' ? '已提交（有异常）' : '盘点完成', 'success')
    await load()
    invalidateAssetList()
    const fresh = all.value.find((x) => x.code === room.code)
    if (fresh) current.value = fresh
  } catch (e: any) {
    showToast(e?.message || '提交失败', 'none')
  } finally {
    hideLoading()
  }
}

async function onUndo() {
  if (!current.value) return
  const room = current.value
  const ok = await showModal({
    title: '撤销盘点',
    content: `撤销「${room.name}」的已完成标记？\n（设备绑定关系不受影响）`,
    confirmText: '撤销',
  })
  if (!ok) return
  showLoading('提交中')
  try {
    await assetUndoRoomInventory(room.code)
    showToast('已撤销', 'none')
    await load()
    invalidateAssetList()
    const fresh = all.value.find((x) => x.code === room.code)
    if (fresh) current.value = fresh
  } catch (e: any) {
    showToast(e?.message || '撤销失败', 'none')
  } finally {
    hideLoading()
  }
}

function goReport() {
  uni.navigateTo({ url: '/pages/inventory/Report' })
}

/** 盘点提交后让资产列表缓存失效（资产页按「已盘点」筛选，状态已变） */
function invalidateAssetList() {
  try {
    // 动态引入避免与 assetlist 形成静态循环依赖
    import('@/api/assetlist')
      .then((m) => m.assetListInvalidate())
      .catch(() => {})
  } catch {
    /* 忽略 */
  }
}

onShow(() => {
  // 🔴 QA P1-2：无条件清 lastScan。页面重新显示意味着用户可能已跳去别处
  // （如 B 房详情点「去盘点这间房」），上一页残留的 lastScan 绝不能带过来。
  // 这里与 selectRoom 是双保险：即便将来 prefill 分支改动，onShow 已先清干净。
  clearLastScan()
  load().then(() => {
    const prefill = getJSON<string>('asset_prefill_room')
    if (!prefill) return
    const hit = all.value.find((r) => r.code === prefill)
    if (hit) {
      // 走统一入口（换房即清 lastScan），⛔ 不要在这里直接赋 current.value
      selectRoom(hit)
      // 🔴 4 态以后端为准：进入即开单，不再本地打「进行中」标记
      if (!INV_TERMINAL.includes(hit.status)) {
        invStart(hit.code, operator.value)
          .then((res) => {
            if (res && res.inspected) applyRecord(hit.code, res.inspected)
          })
          .catch(() => {})
      }
    }
    setStore('asset_prefill_room', '')
  })
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 160rpx);
}
/* 🔴 QA P1-4：「手动确认位置」浮条显示时，把底部预留从 160rpx 提到 300rpx。
   160rpx 只避开了 action-bar（约 72rpx 按钮 + 内边距），浮条（bottom: safe+150rpx，
   高约 100rpx）会正好压在列表最后 1-2 行上 —— 那几行点不到，直接挡住连续扫码。 */
.page-with-geo {
  padding-bottom: calc(env(safe-area-inset-bottom) + 300rpx);
}

/* ---------- 按区域快捷分类 ---------- */
.area-bar {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.ab-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.ab-lbl {
  font-size: 26rpx;
  color: $tm-text-secondary;
  flex-shrink: 0;
}
.ab-dims {
  flex: 1;
  display: flex;
  background: $tm-bg;
  border-radius: 28rpx;
  padding: 4rpx;
}
.ab-dim {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 10rpx 0;
  border-radius: 24rpx;
}
.ab-dim.active {
  background: $tm-primary;
  color: #fff;
  font-weight: 600;
}
.ab-clear {
  font-size: 24rpx;
  color: $tm-primary;
  flex-shrink: 0;
  padding: 6rpx 12rpx;
}
.area-scroll {
  width: 100%;
  white-space: nowrap;
  margin-top: 14rpx;
}
.area-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 14rpx;
  padding: 2rpx 0;
}
.area {
  flex-shrink: 0;
  padding: 12rpx 24rpx;
  border-radius: 30rpx;
  background: $tm-bg;
  border: 1rpx solid $tm-border;
  font-size: 26rpx;
  color: $tm-text-secondary;
  white-space: nowrap;
}
.area.active {
  background: $tm-primary-bg;
  border-color: $tm-primary;
  color: $tm-primary;
  font-weight: 600;
}
.area-n {
  font-size: 22rpx;
  opacity: 0.75;
}
.area-tip {
  color: $tm-text-muted;
  border-style: dashed;
}
.area-sel {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.as-txt {
  color: $tm-primary;
}

/* ---------- 筛选 ---------- */
.bar2 {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 16rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.f-tabs {
  display: flex;
  background: $tm-bg;
  border-radius: 30rpx;
  padding: 4rpx;
  margin-bottom: 14rpx;
}
.f-tab {
  flex: 1;
  text-align: center;
  font-size: 24rpx;
  color: $tm-text-secondary;
  padding: 12rpx 0;
  border-radius: 26rpx;
}
.f-tab.active {
  background: $tm-primary;
  color: #fff;
  font-weight: 600;
}
.srch {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.f-search {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  background: $tm-bg;
  border-radius: 32rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
}
.ph {
  color: $tm-text-muted;
}
.f-refresh {
  flex-shrink: 0;
  font-size: 24rpx;
  color: $tm-primary;
  padding: 0 8rpx;
}

/* ---------- 批量条 ---------- */
.batch {
  display: flex;
  align-items: center;
  background: $tm-primary-bg;
  border-radius: $tm-radius;
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
}
.b-check {
  display: flex;
  align-items: center;
  gap: 10rpx;
  font-size: 26rpx;
  color: $tm-text;
}
.box {
  width: 38rpx;
  height: 38rpx;
  border: 2rpx solid $tm-border;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  color: #fff;
  flex-shrink: 0;
}
.box.on {
  background: $tm-primary;
  border-color: $tm-primary;
}
.b-count {
  flex: 1;
  font-size: 26rpx;
  color: $tm-text-secondary;
  margin-left: 20rpx;
}
.b-btn {
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 28rpx;
  border-radius: 32rpx;
  background: $tm-primary;
  color: #fff;
  font-size: 26rpx;
  font-weight: 600;
  border: none;
}
.b-btn::after {
  border: none;
}

/* ---------- 列表 ---------- */
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8rpx 12rpx;
}
.lh-mode {
  font-size: 26rpx;
  color: $tm-primary;
}
.lh-count {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.tip {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 80rpx 0;
}
.room {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 22rpx;
  margin-bottom: 14rpx;
  box-shadow: $tm-shadow-card;
}
.room.picked {
  background: $tm-primary-bg;
  border: 2rpx solid $tm-primary;
}
.r-main {
  flex: 1;
  overflow: hidden;
}
.r-line1 {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.r-name {
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 380rpx;
}
.r-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 6rpx;
  flex-shrink: 0;
}
.r-st {
  font-size: 22rpx;
  flex-shrink: 0;
}
.r-line2 {
  display: flex;
  gap: 16rpx;
  margin-top: 8rpx;
}
.r-code {
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.r-bld {
  font-size: 22rpx;
  color: $tm-text-muted;
}
.r-line3 {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 8rpx;
  flex-wrap: wrap;
}
.r-dev {
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.r-empty {
  font-size: 20rpx;
  color: #ad6800;
  background: $tm-warning-bg;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}
.r-time {
  font-size: 20rpx;
  color: $tm-text-muted;
}

/* ---------- 扫码后的可选旁路：手动确认位置 ---------- */
/* ===== 设备清单（逐台核对）===== */
.dev-panel {
  margin-top: 20rpx;
  background: #fff;
  border-radius: 16rpx;
  overflow: hidden;
}
.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx;
  min-height: 88rpx;
}
.dp-title {
  font-size: 28rpx;
  font-weight: 600;
  color: $tm-text;
}
.dp-caret {
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.dp-count {
  font-size: 24rpx;
  color: $tm-primary;
}
.dp-empty-hint {
  color: $tm-text-muted;
}
.dp-body {
  border-top: 1rpx solid $tm-border-light;
}
.dp-hint {
  padding: 30rpx 24rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
  line-height: 1.6;
}
.dp-err {
  padding: 30rpx 24rpx;
  font-size: 24rpx;
  color: $tm-danger;
  line-height: 1.6;
}
.dp-retry {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: $tm-primary;
  min-height: 88rpx;
  line-height: 88rpx;
}
.dev-row {
  display: flex;
  align-items: flex-start;
  gap: 18rpx;
  padding: 20rpx 24rpx;
  border-bottom: 1rpx solid $tm-border-light;
  min-height: 88rpx;
}
.dev-row:last-child {
  border-bottom: none;
}
/* 勾选行整体变灰，一眼看出已核对过哪些 */
.dev-row.checked {
  background: $tm-primary-bg;
}
.dev-row.checked .dr-code,
.dev-row.checked .dr-name {
  color: $tm-text-muted;
}
.dev-row.added {
  background: #fff7ed;
}
.dr-box {
  flex-shrink: 0;
  width: 40rpx;
  height: 40rpx;
  margin-top: 6rpx;
  border: 2rpx solid $tm-border;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dr-box.on {
  background: $tm-primary;
  border-color: $tm-primary;
}
.dr-tick {
  font-size: 26rpx;
  color: #fff;
  line-height: 1;
}
.dr-main {
  flex: 1;
  min-width: 0;
}
.dr-code {
  font-size: 26rpx;
  color: $tm-text;
  font-weight: 500;
}
.dr-name {
  font-size: 26rpx;
  color: $tm-text;
  margin-top: 4rpx;
}
.dr-add {
  font-size: 20rpx;
  color: #ff7d45;
  margin-left: 10rpx;
}
.dr-meta {
  display: flex;
  gap: 16rpx;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.geo-lane {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: calc(env(safe-area-inset-bottom) + 150rpx);
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 20rpx;
  background: #fff7ed;
  border: 1rpx solid #ffbb8a;
  border-radius: $tm-radius;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
  /* 🔴 QA P1-4：与 .action-bar 统一 z-index（此前 action-bar 无 z-index，
     只靠「位置正好不重叠」避让，任何高度变化都会叠在一起互相截点击） */
  z-index: 20;
}
.gl-main {
  flex: 1;
  min-width: 0;
}
.gl-t {
  display: block;
  font-size: 24rpx;
  color: $tm-text;
}
.gl-d {
  display: block;
  margin-top: 2rpx;
  font-size: 21rpx;
  color: #ad4e15;
}
.gl-btn {
  flex-shrink: 0;
  /* QA P2-1：原padding 12rpx*2 + 25rpx 字 ≈ 25px（50rpx），戴手套点不中 → 提到 ≥72rpx */
  min-height: 72rpx;
  line-height: 72rpx;
  padding: 0 26rpx;
  font-size: 25rpx;
  font-weight: 600;
  color: #fff;
  background: #ff7d45;
  border-radius: 36rpx;
}

/* ---------- 底部操作 ---------- */
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 14rpx 24rpx calc(env(safe-area-inset-bottom) + 14rpx);
  background: #fff;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
  /* 🔴 QA P1-4：与 .geo-lane 同层z-index，谁都不靠「位置不重叠」侥幸躲开 */
  z-index: 20;
}
.ab-info {
  flex: 1;
  overflow: hidden;
}
.ab-name {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ab-meta {
  font-size: 20rpx;
  color: $tm-text-secondary;
}
.ab-btn {
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 30rpx;
  border-radius: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  border: none;
  flex-shrink: 0;
}
.ab-btn::after {
  border: none;
}
.ab-scan {
  background: $tm-primary;
  color: #fff;
}
.ab-done {
  background: $tm-success;
  color: #fff;
}
.ab-undo {
  background: #fff;
  color: $tm-danger;
  border: 2rpx solid $tm-danger;
}
</style>
