<template>
  <view class="page">
    <!-- 打印机连接 -->
    <view class="card conn">
      <view class="conn-row">
        <view class="conn-status">
          <text class="dot" :class="printer.connected.value ? 'on' : 'off'"></text>
          <text class="conn-text">{{ printer.connected.value ? '已连接：' + printer.currentName.value : '未连接打印机' }}</text>
        </view>
        <button class="mini-btn" v-if="!printer.connected.value" @tap="connectPrinter">连接</button>
        <button class="mini-btn ghost" v-else @tap="printer.disconnect()">断开</button>
      </view>

      <view v-if="printer.scanning.value" class="scan-hint">扫描蓝牙设备中…</view>
      <view v-if="printer.devices.value.length" class="dev-list">
        <view
          v-for="d in printer.devices.value"
          :key="d.deviceId"
          class="dev-item"
          @tap="() => printer.connect(d)"
        >
          <text>{{ d.name || d.deviceId }}</text>
          <text class="link">连接</text>
        </view>
      </view>
      <view v-if="printer.error.value" class="err">{{ printer.error.value }}</view>

      <!-- 中文自检：设备名走位图打印；打一张自检标签即可看出「位图 + 各 font 号」在本机的实际效果 -->
      <view class="probe-bar">
        <text class="probe-tip">标签含：二维码＋固定资产编号＋设备名＋机身编号</text>
        <button class="mini-btn sm" :disabled="!printer.connected.value" @tap="printFontProbe">中文自检</button>
      </view>
    </view>

    <!-- 导入来源 -->
    <view class="card">
      <view class="imp-bar">
        <button class="imp-btn" @tap="openManualSearch">＋ 添加设备</button>
        <button class="imp-btn" @tap="openImport('room')">从机房导入</button>
        <button class="imp-btn" @tap="openImport('table')">从数据表导入</button>
      </view>

      <!-- 机房 / 数据表 选择 -->
      <view v-if="importPanel" class="imp-panel">
        <view class="imp-title">{{ importPanel === 'room' ? '选择机房' : '选择数据表' }}</view>
        <!-- 🔴 机房走服务端搜索：原来一次拉全量 938 间（222KB），现在按关键字取前 50 条 -->
        <view v-if="importPanel === 'room'" class="imp-search">
          <input
            class="imp-search-input"
            placeholder="搜索机房名称 / 编号 / 楼栋"
            placeholder-class="ph"
            v-model="impKw"
          />
        </view>
        <scroll-view scroll-y class="imp-scroll">
          <view
            v-for="s in sources"
            :key="s.id"
            class="imp-opt"
            @tap="() => pickSource(s.id)"
          >
            <text class="imp-opt-main">
              <text class="imp-name">{{ s.name }}</text>
              <text class="imp-code">{{ s.code }}</text>
            </text>
            <text class="imp-sub">{{ s.code }}</text>
          </view>
          <view v-if="importPanel === 'room' && !sources.length && !sourceLoading && impErr" class="imp-loading" @tap="searchRoomSources(impKw, true)">
            {{ impErr }}（点此重试）
          </view>
          <view v-else-if="importPanel === 'room' && !sources.length && !sourceLoading" class="imp-loading">
            无匹配机房，换个关键字试试
          </view>
        </scroll-view>
        <view v-if="sourceLoading" class="imp-loading">加载来源中…</view>
        <button class="imp-cancel" @tap="importPanel = null">取消</button>
      </view>

      <!-- 添加设备：按名称 / 固定资产编号 / 机身编号 模糊搜索，多选确认 -->
      <view v-if="manualPanel" class="imp-panel">
        <view class="imp-title">添加设备（按名称或编号搜索）</view>
        <view class="imp-search">
          <input
            class="imp-search-input"
            placeholder="设备名称 / 固定资产编号 / 机身编号"
            placeholder-class="ph"
            v-model="mkKw"
            confirm-type="search"
          />
        </view>
        <view class="mk-hint">
          {{ mkLoading ? '搜索中…' : mkKw.trim() ? '匹配 ' + mkTotal + ' 台，已显示 ' + mkHits.length + ' 台' : '输入名称或编号，至少 1 个字就自动搜索' }}
        </view>
        <scroll-view scroll-y class="imp-scroll">
          <view
            v-for="h in mkHits"
            :key="h.device_code"
            class="imp-opt col"
            :class="{ checked: mkChecked.has(h.device_code) }"
            @tap="toggleMk(h.device_code)"
          >
            <text class="imp-opt-main">
              <text class="imp-name">{{ h.name || h.device_name || h.asset_name || '（无名称）' }}</text>
              <text class="imp-code">{{ h.device_code }}</text>
              <text class="imp-sub">机身编号：{{ serialOf(h) || '无' }}</text>
              <text class="imp-sub">{{ h.location || '位置未登记' }}<text v-if="h.subsystem_name"> · {{ h.subsystem_name }}</text></text>
              <text v-if="list.some((x) => x.code === h.device_code)" class="mk-badge">已在清单</text>
            </text>
            <text class="imp-check">{{ mkChecked.has(h.device_code) ? '✓' : '' }}</text>
          </view>
          <view v-if="mkErr && !mkHits.length" class="imp-loading" @tap="searchManual(1)">{{ mkErr }}（点此重试）</view>
          <view v-else-if="mkKw.trim() && !mkLoading && !mkHits.length" class="imp-loading">
            没搜到匹配的设备；若确认编号无误，可点下方「按此编号直接添加」
          </view>
          <view v-if="mkHits.length < mkTotal" class="imp-loading mk-more" @tap="searchManual(mkPage + 1)">
            加载更多（还剩 {{ mkTotal - mkHits.length }} 台）
          </view>
        </scroll-view>
        <view class="imp-actions">
          <button class="imp-cancel" @tap="closeManual">取消</button>
          <button
            class="imp-cancel mk-raw"
            v-if="mkKw.trim() && !mkHits.length && !mkLoading"
            @tap="addRawCode"
          >按此编号直接添加</button>
          <button class="imp-confirm" @tap="addCheckedManual">加入清单（{{ mkChecked.size }}）</button>
        </view>
      </view>

      <!-- 候选多选 -->
      <view v-if="candidates.length" class="imp-panel">
        <view class="imp-title">选择要打印的设备（已选 {{ checked.size }} / 共 {{ candidates.length }}）</view>
        <view class="cand-tools">
          <button class="mini-btn ghost sm" @tap="checkAllCandidates">全选</button>
          <button class="mini-btn ghost sm" @tap="uncheckAllCandidates">全不选</button>
        </view>
        <scroll-view scroll-y class="imp-scroll">
          <view
            v-for="c in candidates"
            :key="c.code"
            class="imp-opt col"
            :class="{ checked: checked.has(c.code) }"
            @tap="toggleCheck(c.code)"
          >
            <text class="imp-opt-main">
              <text class="imp-code">{{ c.code }}</text>
              <text class="imp-name">{{ c.name || '（无名称）' }}</text>
              <text class="imp-sub">{{ c.brandModel || c.serial || '无品牌型号 / 机身编号' }}</text>
            </text>
            <text class="imp-check">{{ checked.has(c.code) ? '✓' : '' }}</text>
          </view>
        </scroll-view>
        <view class="imp-actions">
          <button class="imp-cancel" @tap="candidates = []">取消</button>
          <button class="imp-confirm" @tap="confirmCandidates">加入清单（{{ checked.size }}）</button>
        </view>
      </view>
    </view>

    <!-- 打印清单（表格） -->
    <view class="section-title">
      打印清单<text class="count">（{{ list.length }} 条{{ kw ? ' / 匹配 ' + filtered.length : '' }}）</text>
    </view>

    <view class="card search-card" v-if="list.length">
      <input
        class="search-input"
        v-model="kw"
        placeholder="搜索编号 / 名称 / 品牌型号 / 位置"
        placeholder-class="search-ph"
        confirm-type="search"
      />
      <text v-if="kw" class="search-clear" @tap="kw = ''">清除</text>
    </view>

    <view class="card table-card" v-if="filtered.length">
      <scroll-view scroll-x class="table-x">
        <view class="table-inner">
          <!-- 表头 -->
          <view class="tr th">
            <text class="td c-idx">#</text>
            <text class="td c-code">固定资产编号</text>
            <text class="td c-name">设备名称</text>
            <text class="td c-brand">品牌型号</text>
            <text class="td c-sys">所属系统</text>
            <text class="td c-loc">位置</text>
            <text class="td c-serial">机身编号</text>
            <text class="td c-src">来源</text>
            <text class="td c-op">操作</text>
          </view>
          <!-- 表体 -->
          <view
            class="tr"
            v-for="(it, idx) in filtered"
            :key="it.code + idx"
            @tap="preview = it; previewQr = qrOf(it.code)"
          >
            <text class="td c-idx">{{ idx + 1 }}</text>
            <text class="td c-code strong">{{ it.code }}</text>
            <text class="td c-name">{{ it.name || '—' }}</text>
            <text class="td c-brand">{{ it.brandModel || '—' }}</text>
            <text class="td c-sys">{{ it.subsystem || '—' }}</text>
            <text class="td c-loc">{{ it.location || '—' }}</text>
            <text class="td c-serial">{{ it.serial || '—' }}</text>
            <text class="td c-src">{{ it.source || '手动' }}</text>
            <text class="td c-op danger" @tap.stop="removeItem(it.code)">删除</text>
          </view>
        </view>
      </scroll-view>
      <view class="table-tip">左右滑动查看完整字段 · 点击任意行可预览二维码</view>
    </view>
    <view class="card empty" v-else-if="list.length">没有匹配「{{ kw }}」的设备</view>
    <view class="card empty" v-else>清单为空，先从上方添加设备</view>

    <view class="action-bar">
      <button class="ab-btn ab-clear" @tap="clearList">清空</button>
      <button class="ab-btn ab-print" :disabled="!canPrint" @tap="printAll">
        打印{{ printing ? '中…' : '清单' }}（{{ list.length }}）
      </button>
    </view>

    <!-- 二维码预览 -->
    <view class="mask" v-if="preview" @tap="preview = null">
      <view class="preview-box" @tap.stop>
        <view class="preview-title">{{ preview.code }}</view>
        <view class="preview-name">{{ preview.name || '（无名称）' }}</view>
        <QrCode v-if="previewQr" :text="previewQr" :size="220" />
        <view class="preview-row"><text class="pk">品牌型号</text><text>{{ preview.brandModel || '—' }}</text></view>
        <view class="preview-row"><text class="pk">机身编号</text><text>{{ preview.serial || '—' }}</text></view>
        <view class="preview-row"><text class="pk">所属系统</text><text>{{ preview.subsystem || '—' }}</text></view>
        <view class="preview-row"><text class="pk">位置</text><text>{{ preview.location || '—' }}</text></view>
        <button class="imp-cancel" @tap="preview = null">关闭</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { usePutyPrinter } from '@/composables/usePutyPrinter'
import { buildDualCodeLabel, buildChineseFontProbe, measureDualCodeLabel } from '@/utils/cpcl'
import { renderNameBitmap } from '@/utils/labelNameBitmap'
import { extractSerialNo, splitBrandModel } from '@/utils/deviceLabel'
import { assetRoomPage, assetRoomDevices, assetDataTables, assetTableRecords, assetMatchLedger } from '@/api/asset'
import type { AssetTableRecord, RoomDevicesResult, InventoryDeviceRow, AssetLedgerItem } from '@/types/asset'
import QrCode from '@/components/QrCode.vue'
import { getJSON, set as setStore } from '@/utils/storage'
import { showToast, showInputModal, showLoading, hideLoading } from '@/utils/feedback'

const printer = usePutyPrinter()

interface PrintItem {
  code: string
  name: string
  brandModel: string
  serial: string
  subsystem: string
  location: string
  source: string
}

const list = ref<PrintItem[]>([])
const importPanel = ref<null | 'room' | 'table'>(null)
const sources = ref<{ id: string; name: string; code: string }[]>([])
/** 机房来源的搜索关键字（服务端匹配，避免一次拉全量 938 间） */
const impKw = ref('')
const impErr = ref('')
let impSeq = 0
let impTimer: ReturnType<typeof setTimeout> | null = null

/** 按关键字向服务端要机房候选（前 50 条），带防抖与竞态丢弃 */
async function searchRoomSources(keyword: string, immediate = false): Promise<void> {
  if (impTimer) clearTimeout(impTimer)
  const run = async () => {
    const seq = ++impSeq
    sourceLoading.value = true
    impErr.value = ''
    try {
      const res = await assetRoomPage({ keyword: keyword.trim() || undefined, limit: 50 })
      if (seq !== impSeq) return
      sources.value = (res.items || []).map((r) => ({
        id: r.code,
        name: `${r.building || ''}${r.name || ''}`.trim() || r.name,
        code: r.code,
      }))
    } catch (e: any) {
      if (seq !== impSeq) return
      sources.value = []
      impErr.value = e?.message || '机房列表加载失败'
    } finally {
      if (seq === impSeq) sourceLoading.value = false
    }
  }
  if (immediate) await run()
  else impTimer = setTimeout(() => void run(), 320)
}

watch(impKw, (v) => {
  if (importPanel.value === 'room') void searchRoomSources(v)
})
const candidates = ref<PrintItem[]>([])
const checked = ref<Set<string>>(new Set())
const sourceLoading = ref(false)
const kw = ref('')
const printing = ref(false)
const preview = ref<PrintItem | null>(null)
const previewQr = ref('')

const filtered = computed(() => {
  const k = kw.value.trim().toLowerCase()
  if (!k) return list.value
  return list.value.filter((it) =>
    [it.code, it.name, it.brandModel, it.serial, it.subsystem, it.location, it.source]
      .join(' ')
      .toLowerCase()
      .includes(k)
  )
})

const canPrint = computed(() => printer.connected.value && list.value.length > 0 && !printing.value)

function qrOf(code: string) {
  return `https://www.xmgl-123.cn/ops/qr/${encodeURIComponent(code)}`
}

/** 从数据表记录的自由字段里取值（表头命名不统一，逐个兜底） */
function pick(data: Record<string, unknown> | undefined, keys: string[]): string {
  if (!data) return ''
  for (const k of keys) {
    const v = data[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

async function connectPrinter() {
  try {
    const ok = await printer.init()
    if (ok) printer.startScan()
    else showToast('蓝牙初始化失败', 'none')
  } catch {
    showToast('蓝牙初始化失败', 'none')
  }
}

// ── 添加设备：服务端模糊搜索（设备名称 / 固定资产编号 / 机身编号） ──
// 后端 /assets/asset-ledger?q= 跨字段匹配（device_code / name / brand_model / serial_no / location…），
// 机身编号嵌在 brand_model 文本里也能命中；同一关键字命中多台时全部列出，由人确认。
const manualPanel = ref(false)
const mkKw = ref('')
const mkHits = ref<AssetLedgerItem[]>([])
const mkChecked = ref<Set<string>>(new Set())
const mkTotal = ref(0)
const mkPage = ref(1)
const mkLoading = ref(false)
const mkErr = ref('')
let mkSeq = 0
let mkTimer: ReturnType<typeof setTimeout> | null = null

function openManualSearch() {
  manualPanel.value = true
  mkKw.value = ''
  mkHits.value = []
  mkChecked.value = new Set()
  mkTotal.value = 0
  mkPage.value = 1
  mkErr.value = ''
}

function closeManual() {
  manualPanel.value = false
  mkChecked.value = new Set()
  mkErr.value = ''
}

watch(mkKw, () => {
  if (mkTimer) clearTimeout(mkTimer)
  const q = mkKw.value.trim()
  if (!q) {
    mkHits.value = []
    mkTotal.value = 0
    mkPage.value = 1
    mkErr.value = ''
    mkLoading.value = false
    return
  }
  mkTimer = setTimeout(() => void searchManual(1), 350)
})

async function searchManual(page = 1) {
  const q = mkKw.value.trim()
  if (!q) return
  const seq = ++mkSeq
  mkLoading.value = true
  mkErr.value = ''
  try {
    const res = await assetMatchLedger(q, 20, page)
    if (seq !== mkSeq) return
    mkTotal.value = res.total || 0
    mkPage.value = res.page || page
    const items = res.items || []
    mkHits.value = page <= 1 ? items : mkHits.value.concat(items)
  } catch {
    if (seq !== mkSeq) return
    mkErr.value = '搜索失败'
    if (page <= 1) {
      mkHits.value = []
      mkTotal.value = 0
    }
  } finally {
    if (seq === mkSeq) mkLoading.value = false
  }
}

function toggleMk(code: string) {
  const set = new Set(mkChecked.value)
  if (set.has(code)) set.delete(code)
  else set.add(code)
  mkChecked.value = set
}

/** 机身编号：先按铭牌规则从 brand_model 抠；抠不到再看 serial_no 是否本身就是短代码 */
function serialOf(it: AssetLedgerItem): string {
  const hit = extractSerialNo(it.brand_model || '') || extractSerialNo(it.serial_no || '')
  if (hit) return hit
  const raw = String(it.serial_no || '').trim()
  if (!raw || raw.length > 40 || /\s/.test(raw) || !/\d/.test(raw)) return ''
  return raw
}

function toPrintItem(it: AssetLedgerItem): PrintItem {
  return {
    code: it.device_code,
    name: it.name || it.device_name || it.asset_name || '',
    brandModel: it.brand_model || '',
    serial: serialOf(it),
    subsystem: it.subsystem_name || '',
    location: it.location || '',
    source: it.source === 'ledger_only' ? '台账（未登记设备档）' : '台账搜索',
  }
}

function addCheckedManual() {
  let n = 0
  mkChecked.value.forEach((code) => {
    const hit = mkHits.value.find((h) => h.device_code === code)
    if (!hit) return
    if (list.value.some((x) => x.code === hit.device_code)) return
    list.value.push(toPrintItem(hit))
    n += 1
  })
  showToast(n ? `已加入 ${n} 台设备` : '所选设备都已在清单中', 'none')
  if (n) closeManual()
}

/** 兜底：台账里确实搜不到这台设备时，仍允许按输入的编号打一张（名称/机身编号留白） */
function addRawCode() {
  const code = mkKw.value.trim()
  if (!code) return
  addItem({ code, name: '', brandModel: '', serial: '', subsystem: '', location: '', source: '手动编号' })
  closeManual()
}

function addItem(it: PrintItem) {
  if (list.value.some((x) => x.code === it.code)) {
    showToast(`${it.code} 已在清单中`, 'none')
    return
  }
  list.value.push(it)
}

function removeItem(code: string) {
  const i = list.value.findIndex((x) => x.code === code)
  if (i >= 0) list.value.splice(i, 1)
}
function clearList() {
  if (!list.value.length) return
  list.value = []
  kw.value = ''
}

async function openImport(kind: 'room' | 'table') {
  importPanel.value = kind
  candidates.value = []
  checked.value = new Set()
  sourceLoading.value = true
  sources.value = []
  impKw.value = ''
  impErr.value = ''
  try {
    if (kind === 'room') {
      // 只取前 50 条 + 关键字搜索，不再整包拉 938 间
      await searchRoomSources('', true)
    } else {
      sources.value = (await assetDataTables()).map((t) => ({ id: String(t.id), name: t.name, code: t.code }))
    }
  } catch {
    showToast('加载来源失败', 'none')
    sources.value = []
  } finally {
    sourceLoading.value = false
  }
}

async function pickSource(id: string) {
  showLoading('加载设备')
  try {
    if (importPanel.value === 'room') {
      const res: RoomDevicesResult = await assetRoomDevices(id)
      const roomName = res.room ? `${res.room.building || ''}${res.room.name || ''}`.trim() : ''
      candidates.value = (res.devices || []).map((d: InventoryDeviceRow) => ({
        code: d.device_code,
        // 设备名：devices.name 优先；为空再退回「品牌型号里剥掉机身编号后的型号段」
        name: d.name || splitBrandModel(d.brand_model || '').rest,
        brandModel: d.brand_model || '',
        // 机身编号：**后端解析值优先**（含现场观测表兜底），取不到才本地正则兜底
        serial: d.serial_no || extractSerialNo(d.brand_model || ''),
        subsystem: d.subsystem_name || '',
        location: d.location_desc || roomName,
        source: roomName || '机房',
      }))
    } else {
      const recs: AssetTableRecord[] = await assetTableRecords(Number(id))
      candidates.value = (recs || []).map((r: AssetTableRecord) => {
        const d = (r.data || {}) as Record<string, unknown>
        const brandModel = pick(d, ['brand_model', '品牌型号', '规格型号', '型号'])
        return {
          code: r.device_code,
          name: r.device_name || pick(d, ['device_name', '设备名称', '名称']),
          brandModel,
          serial: extractSerialNo(brandModel) || pick(d, ['serial_no', '机身编号', '出厂编号']),
          subsystem: pick(d, ['subsystem_name', '所属系统', '系统', '专业']),
          location: pick(d, ['location_desc', '位置', '安装位置', 'room_name', '房间']),
          source: r.table_name || '数据表',
        }
      })
    }
    checked.value = new Set(candidates.value.map((c) => c.code))
    if (!candidates.value.length) showToast('该来源下没有设备', 'none')
  } catch {
    showToast('加载设备失败', 'none')
    candidates.value = []
  } finally {
    hideLoading()
  }
}

function toggleCheck(code: string) {
  const s = new Set(checked.value)
  if (s.has(code)) s.delete(code)
  else s.add(code)
  checked.value = s
}

function checkAllCandidates() {
  checked.value = new Set(candidates.value.map((c) => c.code))
}

function uncheckAllCandidates() {
  checked.value = new Set()
}

function confirmCandidates() {
  const set = checked.value
  candidates.value.forEach((c) => {
    if (set.has(c.code)) addItem({ ...c })
  })
  candidates.value = []
  checked.value = new Set()
  importPanel.value = null
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function printAll() {
  if (!canPrint.value) return
  const targets = filtered.value.length ? filtered.value : list.value
  showLoading(`打印中 0/${targets.length}`)
  printing.value = true
  let nameSkipped = 0
  try {
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i]
      // 四要素标签：二维码 + 固定资产编号 + 设备名（位图）+ 机身编号
      // 设备名必须走位图——该机 TEXT 无汉字库（见 utils/cpcl.ts 的定论注释）。
      // 顺序：先量版式拿到「名称行可用宽 × 行高」→ 按该尺寸渲染点阵 → 最后拼指令。
      const layout = measureDualCodeLabel({ code: it.code, name: it.name, serialNo: it.serial })
      const bmp = it.name
        ? renderNameBitmap(it.name, layout.nameMaxWidthDots, layout.nameDots)
        : null
      if (it.name && !bmp) nameSkipped += 1
      const bytes = buildDualCodeLabel({
        code: it.code,
        name: it.name,
        serialNo: it.serial,
        nameBitmap: bmp || undefined,
      })
      await printer.printCpcl(bytes)
      showLoading(`打印中 ${i + 1}/${targets.length}`)
      await delay(350)
    }
    if (nameSkipped) {
      // 不静默失败：位图生成不了（多为基础库过低）就说清楚，别让现场以为打全了
      showToast(`已完成，但有 ${nameSkipped} 张设备名未打印（微信版本过低，请更新微信后重打）`, 'none')
    } else {
      showToast('全部打印完成', 'success')
    }
  } catch (e: any) {
    showToast(e?.message || '打印中断', 'none')
  } finally {
    printing.value = false
    hideLoading()
  }
}

/**
 * 打印「中文自检标签」：同一张纸上先打一行**位图**中文，再打 6 行不同 font 号的 TEXT 中文。
 * 现场判读：位图行正常 + TEXT 行乱码 = 位图方案成立（生产模板走的就是这条）；
 * 位图行也乱 = 问题不在打印机字库，需回来查 canvas 渲染。
 */
async function printFontProbe() {
  if (!printer.connected.value) {
    showToast('请先连接打印机', 'none')
    return
  }
  showLoading('打印自检标签')
  try {
    const sample = list.value.find((x) => x.name)?.name || '潜水排污泵'
    const layout = measureDualCodeLabel({ code: '105000620923', name: sample })
    const bmp = renderNameBitmap(sample, layout.nameMaxWidthDots, layout.nameDots)
    await printer.printCpcl(buildChineseFontProbe(bmp || undefined))
    showToast('自检标签已打印', 'success')
  } catch (e: any) {
    showToast(e?.message || '自检标签打印失败', 'none')
  } finally {
    hideLoading()
  }
}

onShow(() => {
  const prefill = getJSON<string[]>('print_prefill_codes')
  if (prefill && prefill.length) {
    prefill.forEach((code) =>
      addItem({ code, name: '', brandModel: '', serial: '', subsystem: '', location: '', source: '扫码' })
    )
    setStore('print_prefill_codes', [])
  }
})
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 160rpx);
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.conn-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.conn-status {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
}
.dot.on {
  background: $tm-success;
}
.dot.off {
  background: $tm-text-muted;
}
.conn-text {
  font-size: 28rpx;
  color: $tm-text;
}
.mini-btn {
  background: $tm-primary;
  color: #fff;
  font-size: 24rpx;
  padding: 0 28rpx;
  height: 60rpx;
  line-height: 60rpx;
  border-radius: 30rpx;
  border: none;
}
.mini-btn::after {
  border: none;
}
.mini-btn.ghost {
  background: #fff;
  color: $tm-danger;
  border: 1rpx solid $tm-danger;
}
.mini-btn.sm {
  height: 52rpx;
  line-height: 52rpx;
  font-size: 22rpx;
  padding: 0 20rpx;
}
.scan-hint {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.dev-list {
  margin-top: 12rpx;
  border-top: 1rpx solid $tm-border-light;
}
.dev-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
  font-size: 26rpx;
  color: $tm-text;
}
.link {
  color: $tm-primary;
  font-size: 24rpx;
}
.err {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: $tm-danger;
}
.probe-bar {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}
.probe-tip {
  flex: 1;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.5;
}

.imp-bar {
  display: flex;
  gap: 12rpx;
}
.imp-btn {
  flex: 1;
  height: 72rpx;
  line-height: 72rpx;
  background: $tm-primary-bg;
  color: $tm-primary;
  font-size: 24rpx;
  border-radius: $tm-radius-sm;
  border: none;
}
.imp-btn::after {
  border: none;
}
.imp-panel {
  margin-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
  padding-top: 16rpx;
}
.imp-search {
  margin: 8rpx 0 12rpx;
}
.imp-search-input {
  height: 64rpx;
  background: $tm-bg;
  border-radius: $tm-radius-sm;
  padding: 0 20rpx;
  font-size: 24rpx;
  color: $tm-text;
}
.imp-title {
  font-size: 26rpx;
  font-weight: 600;
  color: $tm-text;
  margin-bottom: 12rpx;
}
.imp-loading {
  font-size: 24rpx;
  color: $tm-text-muted;
  padding: 12rpx 0;
}
.imp-scroll {
  max-height: 380rpx;
}
.imp-opt {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18rpx 16rpx;
  border-bottom: 1rpx solid $tm-border-light;
  font-size: 26rpx;
  color: $tm-text;
}
.imp-opt.col {
  align-items: flex-start;
}
.imp-opt-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.imp-name {
  font-size: 26rpx;
  color: $tm-text;
  word-break: break-all;
}
.imp-code {
  font-size: 26rpx;
  font-weight: 600;
  color: $tm-text;
  word-break: break-all;
}
.imp-opt.checked {
  background: $tm-primary-bg;
}
.imp-check {
  width: 48rpx;
  text-align: right;
  font-size: 30rpx;
  color: $tm-primary;
  font-weight: 700;
}
.imp-sub {
  font-size: 22rpx;
  color: $tm-text-muted;
  word-break: break-all;
}
.cand-tools {
  display: flex;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.imp-cancel {
  margin-top: 12rpx;
  height: 72rpx;
  background: #fff;
  color: $tm-text-secondary;
  border: 1rpx solid $tm-border;
  border-radius: $tm-radius-sm;
  font-size: 26rpx;
}
.imp-cancel::after {
  border: none;
}
.imp-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
}
.imp-confirm {
  flex: 1;
  height: 72rpx;
  background: $tm-primary;
  color: #fff;
  border-radius: $tm-radius-sm;
  font-size: 26rpx;
  border: none;
}
.imp-confirm::after {
  border: none;
}

.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  margin: 16rpx 8rpx;
}
.count {
  color: $tm-text-secondary;
  font-weight: 400;
}

.search-card {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 20rpx;
}
.search-input {
  flex: 1;
  height: 64rpx;
  font-size: 26rpx;
  color: $tm-text;
}
.search-ph {
  color: $tm-text-muted;
  font-size: 24rpx;
}
.search-clear {
  font-size: 24rpx;
  color: $tm-primary;
  padding: 8rpx;
}

.table-card {
  padding: 12rpx 0 16rpx;
}
.table-x {
  width: 100%;
}
.table-inner {
  display: flex;
  flex-direction: column;
}
.tr {
  display: flex;
  align-items: stretch;
  border-bottom: 1rpx solid $tm-border-light;
}
.tr:last-child {
  border-bottom: none;
}
.th {
  background: $tm-primary-bg;
  position: sticky;
  top: 0;
  z-index: 2;
}
.td {
  flex-shrink: 0;
  padding: 14rpx 12rpx;
  font-size: 22rpx;
  color: $tm-text;
  word-break: break-all;
  border-right: 1rpx solid $tm-border-light;
  display: flex;
  align-items: center;
}
.td:last-child {
  border-right: none;
}
.th .td {
  font-weight: 700;
  color: $tm-primary;
  font-size: 22rpx;
}
.td.strong {
  font-weight: 600;
}
.td.danger {
  color: $tm-danger;
}
.c-idx {
  width: 64rpx;
  text-align: center;
}
.c-code {
  width: 220rpx;
}
.c-name {
  width: 220rpx;
}
.c-brand {
  width: 300rpx;
}
.c-sys {
  width: 160rpx;
}
.c-loc {
  width: 220rpx;
}
.c-serial {
  width: 200rpx;
}
.c-src {
  width: 140rpx;
}
.c-op {
  width: 100rpx;
  text-align: center;
}
.table-tip {
  margin-top: 12rpx;
  padding: 0 20rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
}

.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}
.preview-box {
  width: 600rpx;
  max-height: 80vh;
  overflow-y: auto;
  background: #fff;
  border-radius: $tm-radius;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.preview-title {
  font-size: 32rpx;
  font-weight: 700;
  color: $tm-text;
  word-break: break-all;
  text-align: center;
}
.preview-name {
  font-size: 26rpx;
  color: $tm-text-secondary;
  margin: 8rpx 0 20rpx;
  text-align: center;
}
.preview-row {
  width: 100%;
  display: flex;
  font-size: 24rpx;
  color: $tm-text;
  padding: 10rpx 0;
  border-top: 1rpx solid $tm-border-light;
  word-break: break-all;
}
.pk {
  width: 140rpx;
  flex-shrink: 0;
  color: $tm-text-muted;
}

.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 16rpx;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: #fff;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}
.ab-btn {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.ab-btn::after {
  border: none;
}
.ab-clear {
  width: 200rpx;
  background: #fff;
  color: $tm-text-secondary;
  border: 1rpx solid $tm-border;
}
.ab-print {
  flex: 1;
  background: $tm-primary;
  color: #fff;
}
.ab-print[disabled] {
  background: #c8d6e8;
}
/* 添加设备搜索面板 */
.mk-hint {
  font-size: 22rpx;
  color: #8a8f99;
  padding: 8rpx 4rpx 0;
}
.mk-badge {
  display: inline-block;
  font-size: 20rpx;
  color: #1677ff;
  padding: 1rpx 8rpx;
  border: 1rpx solid #1677ff;
  border-radius: 6rpx;
}
.mk-more {
  color: #1677ff;
}
.mk-raw {
  color: #d48806;
}
</style>