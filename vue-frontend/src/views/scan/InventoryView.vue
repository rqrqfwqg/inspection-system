<script setup lang="ts">
/**
 * /ops/asset/inventory —— 扫码盘点（房间 ↔ 设备，一对多）。
 *
 * 流程：选房间 → 连续扫码 → 设备自动绑定到该房间。
 * 落点复用既有结构（不新建表）：device_relations 的「所在机房」边
 * （from_code = 设备编号 → to_code = 房间编号）+ devices.room_id/building/floor 回填，
 * 因此绑定后 /asset-viz 的机房区域树与区域统计立即生效。
 *
 * 一台设备只归属一间房：扫到已属其他房间的设备会命中 409 冲突，
 * 必须经用户确认后 move=true 改挂，绝不静默覆盖。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheckFilled, CircleCloseFilled, Connection, Refresh, Search } from '@element-plus/icons-vue'
import PageHead from '@/components/common/PageHead.vue'
import RoomPicker from '@/components/scan/RoomPicker.vue'
import RoomDeviceList from '@/components/scan/RoomDeviceList.vue'
import ScanInput from '@/components/scan/ScanInput.vue'
import DeviceMergeDialog from '@/components/scan/DeviceMergeDialog.vue'
import DeviceDetailDrawer from '@/components/device/DeviceDetailDrawer.vue'
import { useIsAdmin } from '@/composables/useIsAdmin'
import { getAssetLedgerDetail } from '@/api/assetLedger'
import type { AssetLedgerDetail } from '@/types/assetLedger'
import {
  scanBindDeviceToRoom, scanInventoryOverview, scanRoomDevices, scanRooms, scanUnbindDeviceFromRoom,
} from '@/api/scan'
import type {
  InventoryDeviceRow, RoomBrief, RoomInventoryOverview, RoomInventoryRow, ScanRoom,
} from '@/types/scan'

const MAX_ROOM_ROWS = 80
const MAX_LOG_ITEMS = 30

type ScanStatus = 'ok' | 'dup' | 'moved' | 'conflict' | 'missing'
interface ScanLogItem {
  key: string
  code: string
  status: ScanStatus
  name?: string
  detail?: string
}

// ---------- 基础数据 ----------
const rooms = ref<ScanRoom[]>([])
const overview = ref<RoomInventoryOverview | null>(null)
const loadingBase = ref(true)

async function loadBase() {
  loadingBase.value = true
  try {
    const [rs, ov] = await Promise.all([scanRooms(), scanInventoryOverview()])
    rooms.value = rs
    overview.value = ov
  } catch (e) {
    ElMessage({ type: 'error', message: `加载失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  } finally {
    loadingBase.value = false
  }
}

onMounted(() => { void loadBase() })

// ---------- 房间筛选与排序 ----------
const building = ref('')
const floor = ref('')
const query = ref('')

const activeRooms = computed(() => rooms.value.filter((r) => r.is_active !== false))
const buildings = computed(() =>
  Array.from(new Set(activeRooms.value.map((r) => r.building).filter(Boolean))).sort(),
)
const floors = computed(() =>
  Array.from(
    new Set(
      activeRooms.value.filter((r) => r.building === building.value).map((r) => r.floor).filter(Boolean),
    ),
  ).sort(),
)

function onBuildingChange() {
  floor.value = ''
}

const countByRoom = computed(() => {
  const m = new Map<string, number>()
  overview.value?.rooms.forEach((r) => m.set(r.code, r.device_count))
  return m
})

const filteredRooms = computed<RoomInventoryRow[]>(() => {
  const q = query.value.trim().toLowerCase()
  const out = activeRooms.value
    .filter(
      (r) =>
        (!building.value || r.building === building.value) &&
        (!floor.value || r.floor === floor.value) &&
        (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)),
    )
    .map((r) => ({ ...r, device_count: countByRoom.value.get(r.code) ?? 0 }))
  // 排序铁律：已绑定数降序，并列时按编号升序（无空值场景，count 恒为数值）
  return out.sort((a, b) => {
    const d = b.device_count - a.device_count
    return d !== 0 ? d : a.code.localeCompare(b.code)
  })
})
const shownRooms = computed(() => filteredRooms.value.slice(0, MAX_ROOM_ROWS))

// ---------- 选择 / 切换房间 ----------
const current = ref<RoomBrief | null>(null)
const devices = ref<InventoryDeviceRow[]>([])
const count = ref(0)
const loadingRoom = ref(false)

async function pickRoom(room: RoomBrief) {
  current.value = room
  log.value = []
  conflict.value = null
  loadingRoom.value = true
  devices.value = []
  count.value = 0
  try {
    const res = await scanRoomDevices(room.code)
    devices.value = res.devices
    count.value = res.count
  } catch (e) {
    ElMessage({ type: 'error', message: `房间清单加载失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  } finally {
    loadingRoom.value = false
  }
}

function leaveRoom() {
  current.value = null
}

// ---------- 扫码日志 + 冲突待确认 ----------
const log = ref<ScanLogItem[]>([])
const conflict = ref<{ code: string; roomCode: string; message: string } | null>(null)

function pushLog(item: Omit<ScanLogItem, 'key'>) {
  log.value = [{ ...item, key: `${Date.now()}-${Math.random()}` }, ...log.value].slice(0, MAX_LOG_ITEMS)
}
function clearLog() {
  log.value = []
}
const scannedTimes = computed(() => log.value.filter((l) => l.status !== 'missing').length)

// ---------- 扫码绑定 ----------
async function bind(code: string, move: boolean) {
  if (!current.value) return
  try {
    const res = await scanBindDeviceToRoom(current.value.code, code, move)
    if ('conflict' in res) {
      conflict.value = { code, roomCode: res.room_code, message: res.message }
      pushLog({ code, status: 'conflict', detail: res.message })
      return
    }
    conflict.value = null
    count.value = res.count
    const rest = devices.value.filter((d) => d.device_code !== res.device.device_code)
    devices.value = [...rest, res.device].sort((a, b) => a.device_code.localeCompare(b.device_code))
    if (res.already) {
      pushLog({ code: res.device.device_code, status: 'dup', name: res.device.name })
    } else if (res.moved_from) {
      pushLog({ code: res.device.device_code, status: 'moved', name: res.device.name, detail: `原属 ${res.moved_from}` })
    } else {
      pushLog({ code: res.device.device_code, status: 'ok', name: res.device.name })
    }
  } catch (e) {
    // 入队红线：只有 statusCode===0（请求根本没到后端）才允许入离线队列；
    // 此处 404/400 等错误当场提示，不静默、不入队（本页未实现离线队列）。
    conflict.value = null
    pushLog({ code, status: 'missing', detail: e instanceof Error ? e.message : '绑定失败' })
  }
}

function onScan(code: string) {
  void bind(code, false)
}

async function confirmMove() {
  if (!conflict.value) return
  const { code } = conflict.value
  conflict.value = null
  await bind(code, true)
}

function dismissConflict() {
  conflict.value = null
}

// ---------- 解绑 ----------
async function removeDevice(code: string) {
  if (!current.value) return
  try {
    const res = await scanUnbindDeviceFromRoom(current.value.code, code)
    devices.value = devices.value.filter((d) => d.device_code !== code)
    count.value = res.count
    ElMessage({ type: 'success', message: `已解绑：${code}` })
  } catch (e) {
    ElMessage({ type: 'error', message: `解绑失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  }
}

// ---------- 合并同类设备（减少台账同类项）----------
/**
 * 合并需要明确「两台里哪台留、哪台并入」——方向搞反会把主设备变成旧编号，
 * 是最难挽回的一类错误，所以必须让用户先点出保留方，再在弹窗里核对另一台。
 */
const mergeOpen = ref(false)
const mergeKeep = ref<InventoryDeviceRow | null>(null)
const mergeFrom = ref<InventoryDeviceRow | null>(null)

/** 待选第二台：排除保留方自己，避免用户选成自己和自己合并 */
const mergeCandidates = computed(() => devices.value.filter((d) => d.device_code !== mergeKeep.value?.device_code))

function startMerge(code: string) {
  const keep = devices.value.find((d) => d.device_code === code)
  if (!keep) return
  if (devices.value.length < 2) {
    ElMessage({ type: 'warning', message: '本房间只有一台设备，无需合并' })
    return
  }
  mergeKeep.value = keep
  mergeFrom.value = null
  mergeOpen.value = true
}

/** 选中「并入方」→ 关掉选择框、打开合并确认框（确认框自己管预演与写库） */
function pickMergeFrom(code: string) {
  const target = devices.value.find((d) => d.device_code === code)
  if (!target) return
  mergeFrom.value = target
  mergeOpen.value = false
}

/**
 * 选择框关闭。
 * 🔴 只有「用户主动取消」才清空保留方：选中并入方时我们也会把选择框关掉，
 *    若在这里无条件清 mergeKeep，合并确认框的「保留（主设备）」一侧会变成空白，
 *    用户看到的是「确认把某设备并入某个看不见的设备」——最危险的形态。
 */
function onPickClosed() {
  if (!mergeFrom.value) mergeKeep.value = null
}

function onMergeDone() {
  mergeOpen.value = false
  mergeKeep.value = null
  mergeFrom.value = null
  // 合并后本房间清单与数量都会变，重新拉一次以服务端为准
  if (current.value) void pickRoom(current.value)
}

// ---------- 设备详情（复用设备台账的抽屉，保证同一设备两处看到的内容一致）----------
const { isAdmin } = useIsAdmin()

/** 网页端没有扫码枪/摄像头场景，扫码添加设备整块隐藏（2026-10-15 用户要求）；
 *  小程序端负责现场扫码。要恢复网页扫码，把本开关改回 true 即可。 */
const SHOW_SCAN_INPUT = false
const detailCode = ref('')
const detail = ref<AssetLedgerDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailSeq = 0

async function loadDetail(code: string) {
  detailError.value = ''
  if (!code) {
    detailSeq += 1
    detail.value = null
    detailLoading.value = false
    return
  }
  const my = ++detailSeq
  detailLoading.value = true
  try {
    const d = await getAssetLedgerDetail(code)
    if (my === detailSeq) detail.value = d
  } catch (e) {
    if (my === detailSeq) {
      detail.value = null
      detailError.value = e instanceof Error ? e.message : '未知错误'
    }
  } finally {
    if (my === detailSeq) detailLoading.value = false
  }
}

function openDetail(code: string) {
  if (!code) return
  detailCode.value = code
  void loadDetail(code)
}

function closeDetail() {
  detailCode.value = ''
  detail.value = null
  detailError.value = ''
}

function retryDetail() {
  void loadDetail(detailCode.value)
}

/** 撤销合并成功后：详情与房间设备清单都要刷新（编号归属已还原） */
async function onUnmerged() {
  if (detailCode.value) void loadDetail(detailCode.value)
  if (current.value) await pickRoom(current.value)
}
</script>

<template>
  <div class="inv">
    <PageHead
      title="扫码盘点"
      desc="选房间 → 连续扫码 → 设备自动挂到该房间。一间房多台设备，一台设备只归属一间房。"
    >
      <template #actions>
        <el-button :loading="loadingBase" @click="loadBase">
          <el-icon v-if="!loadingBase" :size="16"><Refresh /></el-icon>
          <span>刷新</span>
        </el-button>
      </template>
    </PageHead>

    <section v-if="overview" class="panel inv__stats">
      <span>已关联设备的房间 <b class="tnum">{{ overview.rooms_with_devices }}</b> / <span class="tnum">{{ overview.total_rooms }}</span></span>
      <span>已绑定设备 <b class="tnum">{{ overview.total_bound_devices }}</b> 台</span>
      <span class="inv__stats-note">绑定后自动同步到「资产可视化」的机房区域树与区域统计</span>
    </section>

    <template v-if="!current">
      <div class="inv__filters panel">
        <el-select v-model="building" aria-label="楼栋" placeholder="全部楼栋" @change="onBuildingChange">
          <el-option label="全部楼栋" value="" />
          <el-option v-for="b in buildings" :key="b" :label="b" :value="b" />
        </el-select>
        <el-select v-model="floor" aria-label="楼层" placeholder="全部楼层">
          <el-option label="全部楼层" value="" />
          <el-option v-for="f in floors" :key="f" :label="f" :value="f" />
        </el-select>
        <el-input v-model="query" clearable aria-label="搜索房间" placeholder="搜索房间号 / 名称">
          <template #prefix>
            <el-icon :size="16"><Search /></el-icon>
          </template>
        </el-input>
      </div>
      <RoomPicker
        :rooms="shownRooms"
        :matched-total="filteredRooms.length"
        :loading="loadingBase"
        :max-rows="MAX_ROOM_ROWS"
        @pick="pickRoom"
      />
    </template>

    <template v-else>
      <section class="panel inv__current">
        <div class="inv__current-main min-w-0">
          <div class="inv__current-tags">
            <span class="inv__current-code mono break-code">{{ current.code }}</span>
            <span class="inv__badge">{{ current.name }}</span>
            <span v-if="current.room_type" class="inv__badge">{{ current.room_type }}</span>
          </div>
          <p class="inv__current-loc">{{ current.building }} {{ current.floor }}</p>
          <p class="inv__current-count">
            已绑定设备 <b class="tnum">{{ count }}</b> 台
            <span v-if="SHOW_SCAN_INPUT" class="inv__current-scan">本次已扫 {{ scannedTimes }} 次</span>
          </p>
        </div>
        <el-button class="inv__back" @click="leaveRoom">换房间</el-button>
      </section>

      <section v-if="SHOW_SCAN_INPUT" class="panel inv__scan">
        <h3 class="inv__panel-title">扫码添加设备</h3>
        <ScanInput :on-scan="onScan" :disabled="loadingRoom" />

        <div v-if="conflict" class="inv__conflict" role="alert">
          <p class="inv__conflict-msg break-code">{{ conflict.message }}</p>
          <div class="inv__conflict-actions">
            <el-button size="small" type="primary" @click="confirmMove">
              改挂到本房间（{{ current.code }}）
            </el-button>
            <el-button size="small" @click="dismissConflict">忽略</el-button>
          </div>
        </div>

        <div v-if="log.length > 0" class="inv__log">
          <div class="inv__log-head">
            <span>本次扫码记录</span>
            <el-button text size="small" @click="clearLog">清空</el-button>
          </div>
          <ul class="inv__log-list">
            <li v-for="l in log" :key="l.key" class="inv__log-item" :class="`inv__log-item--${l.status}`">
              <el-icon :size="14" class="inv__log-icon">
                <CircleCheckFilled v-if="l.status === 'ok' || l.status === 'moved'" />
                <CircleCloseFilled v-else />
              </el-icon>
              <span class="mono ellipsis">{{ l.code }}</span>
              <span v-if="l.name" class="inv__log-name ellipsis">{{ l.name }}</span>
              <span class="inv__log-result">
                {{ LOG_LABEL[l.status] }}{{ l.detail ? ` · ${l.detail}` : '' }}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section class="panel">
        <h3 class="inv__panel-title">本房间已绑定设备（{{ count }}）</h3>
        <p class="inv__panel-tip">
          点设备行看详情；两台其实是同一台设备时，用
          <el-icon :size="12"><Connection /></el-icon> 合并掉重复项。
        </p>
        <RoomDeviceList
          :devices="devices"
          :loading="loadingRoom"
          @remove="removeDevice"
          @detail="openDetail"
          @merge="startMerge"
        />
      </section>
    </template>

    <!-- 选第二台：先点「保留方」，再在这里点「并入方」，方向不会搞反 -->
    <el-dialog
      v-model="mergeOpen"
      title="选择要并入的设备"
      width="520px"
      :close-on-click-modal="false"
      append-to-body
      @close="onPickClosed"
    >
      <p class="inv__pick-lead">
        保留 <b class="mono">{{ mergeKeep?.device_code }}</b>
        <span class="inv__pick-dim">{{ mergeKeep?.name }}</span>
      </p>
      <p class="inv__pick-lead">并入下面其中一台：</p>
      <el-radio-group :model-value="mergeFrom?.device_code ?? ''" class="inv__pick-list">
        <el-radio
          v-for="d in mergeCandidates"
          :key="d.device_code"
          :value="d.device_code"
          class="inv__pick-item"
          @change="pickMergeFrom(d.device_code)"
        >
          <span class="mono break-code">{{ d.device_code }}</span>
          <span class="inv__pick-name">{{ d.name }}</span>
        </el-radio>
      </el-radio-group>
      <p v-if="!mergeCandidates.length" class="inv__pick-dim">本房间没有其它设备可合并。</p>
      <template #footer>
        <el-button @click="mergeOpen = false">取消</el-button>
      </template>
    </el-dialog>

    <!-- 合并确认：并排展示两台 + 预演影响面，确认后才写库 -->
    <DeviceMergeDialog
      v-if="mergeFrom"
      :model-value="true"
      :room="current!"
      :keep="mergeKeep"
      :merge="mergeFrom"
      @update:model-value="(v: boolean) => { if (!v) mergeFrom = null }"
      @done="onMergeDone"
    />

    <!-- 设备详情：复用设备台账抽屉 -->
    <DeviceDetailDrawer
      :model-value="!!detailCode"
      :code="detailCode"
      :detail="detail"
      :loading="detailLoading"
      :error="detailError"
      :can-override="isAdmin"
      @update:model-value="(v: boolean) => { if (!v) closeDetail() }"
      @open-code="openDetail"
      @retry="retryDetail"
      @unmerged="onUnmerged"
    />
  </div>
</template>

<script lang="ts">
const LOG_LABEL: Record<string, string> = {
  ok: '已绑定', dup: '已在清单', moved: '已改挂', conflict: '归属冲突', missing: '未找到设备',
}
</script>

<style scoped>
.inv { display: flex; flex-direction: column; gap: var(--space-4); max-width: 896px; min-width: 0; }
.inv__stats { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-6); font-size: var(--text-sm); color: var(--fg-2); }
.inv__stats b { color: var(--fg); font-weight: var(--weight-emphasize); }
.inv__stats-note { font-size: var(--text-xs); color: var(--muted); }
.inv__filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); padding: var(--space-3); }
.inv__filters :deep(.el-select) { width: 100%; }
.inv__panel-title { margin: 0 0 var(--space-3); font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.inv__panel-tip { margin: calc(-1 * var(--space-2)) 0 var(--space-2); display: flex; align-items: center; gap: 2px; font-size: var(--text-xs); color: var(--muted); }
.inv__panel-tip .el-icon { flex: 0 0 auto; width: 12px; height: 12px; font-size: 12px; }
.inv__pick-lead { margin: 0 0 var(--space-2); font-size: var(--text-sm); color: var(--fg-2); }
.inv__pick-dim { margin-left: var(--space-2); font-size: var(--text-xs); color: var(--muted); }
.inv__pick-list { display: flex; flex-direction: column; gap: var(--space-1); max-height: 40vh; overflow-y: auto; }
.inv__pick-item { display: flex !important; align-items: center; gap: var(--space-2); height: auto; min-height: 32px; margin: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--border-soft); border-radius: var(--radius-sm); }
.inv__pick-item :deep(.el-radio__label) { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.inv__pick-name { font-size: var(--text-xs); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.inv__current { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.inv__current-tags { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.inv__current-code { font-size: var(--text-lg); color: var(--fg); }
.inv__badge { padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--fg-2); white-space: nowrap; }
.inv__current-loc { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.inv__current-count { margin: var(--space-2) 0 0; padding-top: var(--space-2); border-top: 1px solid var(--border-soft); font-size: var(--text-sm); color: var(--fg-2); }
.inv__current-count b { color: var(--accent); font-size: var(--text-lg); font-weight: var(--weight-emphasize); }
.inv__current-scan { margin-left: var(--space-3); font-size: var(--text-xs); color: var(--muted); }
.inv__back { flex: 0 0 auto; }
.inv__scan { display: flex; flex-direction: column; gap: var(--space-3); }
.inv__conflict { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid color-mix(in srgb, var(--danger) 35%, #fff); border-radius: var(--radius-md); background: var(--danger-bg); }
.inv__conflict-msg { margin: 0; font-size: var(--text-sm); color: var(--danger-fg); }
.inv__conflict-actions { display: flex; gap: var(--space-2); }
.inv__log { display: flex; flex-direction: column; gap: var(--space-1); }
.inv__log-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--text-xs); color: var(--muted); }
.inv__log-list { display: flex; flex-direction: column; gap: var(--space-1); max-height: 176px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.inv__log-item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--border-soft); border-radius: var(--radius-sm); font-size: var(--text-xs); min-width: 0; }
.inv__log-icon { flex: 0 0 auto; }
.inv__log-item--ok, .inv__log-item--moved { color: var(--success-fg); background: var(--success-bg); border-color: color-mix(in srgb, var(--success) 30%, #fff); }
.inv__log-item--dup { color: var(--warn-fg); background: var(--warn-bg); border-color: color-mix(in srgb, var(--warn) 30%, #fff); }
.inv__log-item--conflict, .inv__log-item--missing { color: var(--danger-fg); background: var(--danger-bg); border-color: color-mix(in srgb, var(--danger) 30%, #fff); }
.inv__log-name { flex: 1 1 auto; min-width: 0; }
.inv__log-result { flex: 0 0 auto; margin-left: auto; white-space: nowrap; }
@media (max-width: 1279px) { .inv__filters { grid-template-columns: minmax(0, 1fr); } }
</style>
