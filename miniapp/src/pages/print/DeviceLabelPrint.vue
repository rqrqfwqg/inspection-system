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
    </view>

    <!-- 导入来源 -->
    <view class="card">
      <view class="imp-bar">
        <button class="imp-btn" @tap="addManual">＋ 手动添加</button>
        <button class="imp-btn" @tap="openImport('room')">从机房导入</button>
        <button class="imp-btn" @tap="openImport('table')">从数据表导入</button>
      </view>

      <!-- 机房 / 数据表 选择 -->
      <view v-if="importPanel" class="imp-panel">
        <view class="imp-title">{{ importPanel === 'room' ? '选择机房' : '选择数据表' }}</view>
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
        </scroll-view>
        <view v-if="sourceLoading" class="imp-loading">加载来源中…</view>
        <button class="imp-cancel" @tap="importPanel = null">取消</button>
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
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { usePutyPrinter } from '@/composables/usePutyPrinter'
import { buildDualCodeLabel } from '@/utils/cpcl'
import { extractSerialNo } from '@/utils/deviceLabel'
import { assetRooms, assetRoomDevices, assetDataTables, assetTableRecords } from '@/api/asset'
import type { AssetTableRecord, RoomDevicesResult, InventoryDeviceRow } from '@/types/asset'
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

function addManual() {
  showInputModal({
    title: '添加设备',
    placeholderText: '请输入固定资产编号',
  }).then((r) => {
    if (r.confirm && r.content) {
      const code = r.content.trim()
      addItem({ code, name: '', brandModel: '', serial: '', subsystem: '', location: '', source: '手动' })
    }
  })
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
  try {
    if (kind === 'room') {
      sources.value = (await assetRooms()).map((r) => ({
        id: r.code,
        name: `${r.building || ''}${r.name || ''}`.trim() || r.name,
        code: r.code,
      }))
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
        name: d.name || '',
        brandModel: d.brand_model || '',
        serial: extractSerialNo(d.brand_model || ''),
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
  try {
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i]
      const bytes = buildDualCodeLabel({ code: it.code, serialNo: it.serial || undefined })
      await printer.printCpcl(bytes)
      showLoading(`打印中 ${i + 1}/${targets.length}`)
      await delay(350)
    }
    showToast('全部打印完成', 'success')
  } catch (e: any) {
    showToast(e?.message || '打印中断', 'none')
  } finally {
    printing.value = false
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
</style>