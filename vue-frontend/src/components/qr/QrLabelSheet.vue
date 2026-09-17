<script setup lang="ts">
/**
 * 二维码标签打印浮层（/asset/qr-labels）
 * =====================================================================
 * 交互对齐 React 版 QrLabelPage 的打印预览：Teleport 到 body 的全屏预览 +
 * window.print() 打印，打印纸选 A4 横向。
 *
 * 防压扁纪律（UIUX §6.4）：
 *  - 二维码 SVG 只写 viewBox，禁止 width/height 属性；屏幕上 `width:100%;height:auto`
 *    由 aspect-ratio 保证 1:1（AS-6），打印态用物理 mm 定尺寸（§6.5 标签打印豁免响应式）。
 *  - preserveAspectRatio 显式 "xMidYMid meet"，禁 "none"（AS-2）。
 *
 * 打印隔离：挂载时给 body 挂 `qr-print-mode` 类，打印媒体下隐藏 #app 外壳，
 * 只保留本浮层；卸载时移除，不影响其它页面打印。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { Close, Printer } from '@element-plus/icons-vue'
import { create as qrCreate } from 'qrcode'
import { APP_BASE } from '@/config'
import type { QrDeviceRow } from '@/types/scan'

const props = defineProps<{ labels: QrDeviceRow[] }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** 二维码内容 = <origin>/ops/qr/<encodeURIComponent(编号)>，与扫码直达页约定一致 */
function qrUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${APP_BASE}/qr/${encodeURIComponent(code)}`
}

interface LabelItem {
  row: QrDeviceRow
  /** viewBox 尺寸（模块数，含四周留白） */
  dim: number
  /** 深色模块的 path 数据（一个 path 画完整个码，DOM 数量最少） */
  path: string
}

/** 预览打开期间标签集不变，矩阵只算一次（300 张也在毫秒级） */
const items = computed<LabelItem[]>(() =>
  props.labels.map((row) => {
    // 留白（quiet zone）由下方 path 坐标偏移 +1 模块实现（对齐 React 版 marginSize=1）；
    // @types/qrcode 的 QRCodeOptions 不含 margin，它只是渲染器选项
    const qr = qrCreate(qrUrl(row.device_code), { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) d += `M${c + 1} ${r + 1}h1v1h-1z`
      }
    }
    return { row, dim: n + 2, path: d }
  }),
)

function posText(row: QrDeviceRow): string {
  return [row.building, row.floor, row.location_desc].filter(Boolean).join(' ')
}

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
        <span class="qr-sheet__bar-text">标签预览（{{ items.length }} 张 · 打印纸选 A4 横向）</span>
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
            :aria-label="`${item.row.device_code} 扫码直达二维码`"
          >
            <path :d="item.path" fill="#000" />
          </svg>
          <div class="qr-cell__text min-w-0">
            <p class="qr-cell__code mono">{{ item.row.device_code }}</p>
            <p class="qr-cell__name">{{ item.row.name }}</p>
            <p class="qr-cell__pos ellipsis">{{ posText(item.row) }}</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* 非 scoped：浮层 Teleport 到 body，且打印隔离需要作用到 #app（类名已 qr- 前缀，不外泄） */
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

/* 屏幕预览即打印版式（A4 横向 297×210mm，@page margin 8mm）。
   物理单位 mm 仅用于标签打印区 —— UIUX §6.5 明文豁免，不随视口变化 */
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
