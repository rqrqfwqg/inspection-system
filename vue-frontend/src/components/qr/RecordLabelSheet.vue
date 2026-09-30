<script setup lang="ts">
/**
 * 资料表批量标签打印浮层（/asset/ledger/:tableId · 勾选记录 → 打印标签）
 * =====================================================================
 * 需求（2026-09-30）：数据表管理里选表 → 勾选设备 → 批量打印标签。
 * 与 `QrLabelSheet`（按设备台账筛选打印）的区别：
 *  - 数据源是**资料表记录**（`RecordItem`），列由该表的 `FieldDef` 决定，
 *    不同表字段不同 → 本组件按字段定义动态取「编号 / 名称 / 位置」三行。
 *  - 二维码内容与扫码直达页口径**完全一致**：<origin>/ops/qr/<编号>，
 *    故打印出的标签与台账页、小程序扫的是同一个落地页（不另造 URL 体系）。
 *
 * 防压扁纪律（同 QrLabelSheet）：SVG 只写 viewBox + preserveAspectRatio="xMidYMid meet"；
 * 打印态用物理 mm 定尺寸（UIUX §6.5 标签打印豁免响应式）。
 * 打印隔离：挂载挂 `qr-print-mode`，打印媒体下隐藏 #app 外壳，卸载移除。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { Close, Printer } from '@element-plus/icons-vue'
import { create as qrCreate } from 'qrcode'
import { APP_BASE } from '@/config'
import type { RecordItem, FieldDef } from '@/types/asset-core'

const props = defineProps<{
  records: RecordItem[]
  fields: FieldDef[]
  /** 表名，仅用于浮层标题，不参与标签内容 */
  tableName?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 二维码内容 = <origin>/ops/qr/<encodeURIComponent(编号)>（与 QrLabelSheet 同源同口径） */
function qrUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${APP_BASE}/qr/${encodeURIComponent(code)}`
}

/**
 * 按字段语义挑出标签要用的三个 key（不同表字段名不同，故按 key/label 双向匹配）。
 * 找不到就退化为空串 —— 标签宁可少一行，也不编造字段。
 */
function pickKey(patterns: RegExp[]): string | null {
  const hit = props.fields.find(
    (f) => patterns.some((p) => p.test(f.key)) || patterns.some((p) => p.test(f.label)),
  )
  return hit ? hit.key : null
}

const KEY_CODE = computed(() => pickKey([/code$/i, /编号/, /编码/, /^asset_no/i]))
const KEY_NAME = computed(() => pickKey([/name$/i, /名称/]))
const KEY_LOC = computed(() => pickKey([/location/i, /位置/, /room/i, /机房/]))

/** 取值：优先 data[key]，再退回到记录顶层字段 */
function valueOf(row: RecordItem, key: string | null): string {
  if (!key) return ''
  const raw = (row.data && (row.data as Record<string, unknown>)[key]) ?? ''
  return raw === null || raw === undefined ? '' : String(raw).trim()
}

/** 编号：优先关联键字段，其次记录自身的 device_code（后者一定存在） */
function codeOf(row: RecordItem): string {
  return valueOf(row, KEY_CODE.value) || String(row.device_code || '')
}

function nameOf(row: RecordItem): string {
  return valueOf(row, KEY_NAME.value) || String(row.device_name || '').trim()
}

function locOf(row: RecordItem): string {
  return valueOf(row, KEY_LOC.value)
}

interface LabelItem {
  row: RecordItem
  code: string
  name: string
  loc: string
  /** viewBox 尺寸（模块数，含四周 1 模块留白） */
  dim: number
  /** 深色模块 path（一个 path 画完整码，DOM 最少） */
  path: string
}

const items = computed<LabelItem[]>(() =>
  props.records.map((row) => {
    const code = codeOf(row)
    // 留白由 path 坐标偏移 +1 模块实现（对齐 QrLabelSheet 的 marginSize=1）
    const qr = qrCreate(qrUrl(code), { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) d += `M${c + 1} ${r + 1}h1v1h-1z`
      }
    }
    return { row, code, name: nameOf(row), loc: locOf(row), dim: n + 2, path: d }
  }),
)

/** 模板作用域取不到 window，包一层 */
function print(): void {
  window.print()
}

onMounted(() => document.body.classList.add('qr-print-mode'))
onUnmounted(() => document.body.classList.remove('qr-print-mode'))
</script>

<template>
  <Teleport to="body">
    <div class="qr-sheet">
      <div class="qr-sheet__bar no-print">
        <span class="qr-sheet__bar-text">
          标签预览（{{ items.length }} 张<template v-if="props.tableName"> · {{ props.tableName }}</template>
          · 打印纸选 A4 横向）
        </span>
        <div class="qr-sheet__bar-actions">
          <el-button size="small" @click="emit('close')">
            <el-icon :size="16"><Close /></el-icon><span>关闭</span>
          </el-button>
          <el-button size="small" type="primary" @click="print()">
            <el-icon :size="16"><Printer /></el-icon><span>打印</span>
          </el-button>
        </div>
      </div>

      <div class="qr-sheet__grid">
        <div v-for="item in items" :key="item.row.id" class="qr-cell">
          <svg
            class="qr-cell__svg"
            :viewBox="`0 0 ${item.dim} ${item.dim}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="`${item.code} 扫码直达二维码`"
          >
            <path :d="item.path" fill="#000" />
          </svg>
          <div class="qr-cell__text min-w-0">
            <p class="qr-cell__code mono">{{ item.code }}</p>
            <p v-if="item.name" class="qr-cell__name">{{ item.name }}</p>
            <p v-if="item.loc" class="qr-cell__pos ellipsis">{{ item.loc }}</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* 非 scoped：Teleport 到 body，打印隔离需作用到 #app（类名 qr- 前缀防外泄）。
   样式与 QrLabelSheet 保持同一套类名，两个浮层视觉一致、可同时复用打印规则。 */
.qr-sheet {
  position: fixed;
  inset: 0;
  z-index: var(--z-toast);
  overflow: auto;
  background: var(--bg);
}
.qr-sheet__bar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.qr-sheet__bar-text { font-size: var(--text-sm); color: var(--fg-2); }
.qr-sheet__bar-actions { display: flex; align-items: center; gap: var(--space-2); }

/* 屏幕预览即打印版式（A4 横向 297×210mm，@page margin 8mm） */
.qr-sheet__grid {
  display: grid;
  grid-template-columns: repeat(3, 84mm);
  justify-content: center;
  gap: 4mm;
  padding: var(--space-4);
}
.qr-cell {
  display: flex;
  align-items: center;
  gap: 3mm;
  padding: 2mm;
  break-inside: avoid;
  background: var(--surface);
}
.qr-cell__svg {
  display: block;
  width: 24mm;
  height: auto;
  aspect-ratio: 1;
  flex: 0 0 auto; /* AS-10：flex 混排中二维码禁止被压缩变形 */
}
.qr-cell__text { display: flex; flex-direction: column; gap: 1mm; }
.qr-cell__code { margin: 0; font-size: 3.4mm; font-weight: var(--weight-emphasize); color: var(--fg); word-break: break-all; }
.qr-cell__name {
  margin: 0; font-size: 3mm; color: var(--fg); line-height: var(--leading-snug);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.qr-cell__pos { margin: 0; font-size: 2.6mm; color: var(--fg-2); }

@media print {
  @page { size: A4 landscape; margin: 8mm; }
  body.qr-print-mode { background: #fff; }
  body.qr-print-mode #app { display: none !important; } /* 打印只出标签，不出系统外壳 */
  .qr-sheet { position: static; overflow: visible; background: #fff; }
  .qr-sheet__grid { padding: 0; }
  .qr-cell { background: #fff; }
}
</style>
