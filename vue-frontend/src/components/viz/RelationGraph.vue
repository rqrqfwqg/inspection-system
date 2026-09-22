<script setup lang="ts">
/**
 * 关联图谱 —— 自左向右的树状图（替代原力导向星型图）
 * =====================================================================
 * 【防压扁】（本轮立项要根治的缺陷，AS-1 / AS-3）
 *    React 版 `RelationGraph.tsx:134-140` 写的是
 *    `<svg viewBox=... width={W} height={H} style={{ maxWidth: '100%' }}>`：
 *    宽高都是**像素属性**、只约束宽度 → 容器变窄时宽被压而高不变 → 宽高比失真。
 *    本版只保留 `viewBox` + `preserveAspectRatio="xMidYMid meet"`，尺寸全部由 CSS
 *    （`width: calc(100% * var(--rg-zoom))` / `height: auto`）决定，**不写任何
 *    width/height 属性**，从根上不可能失真。
 *
 * 视图工具条（UIUX §7.1「任何图谱页必须有 适应窗口 / 放大 / 缩小」）：
 *    缩放通过 CSS 宽度倍率实现，**不用 `transform: scale()`**（AS-9：字会糊、热区错位）；
 *    放大后由画布容器内部横向滚动承接，页面级不出现横滚。
 *
 * 语义配色（线条形态 + 颜色 + 文字三重编码，不靠颜色单独区分，WCAG 1.4.1）：
 *    自动关联 = 主色系虚线 / 人工关联 = 中性实线 / BA 问题 = 告警色实线。
 */
import { computed, ref } from 'vue'
import { ScaleToOriginal, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import RelationGraphLegend from '@/components/viz/RelationGraphLegend.vue'

/** 关联边的最小形状：/link/device 的 DeviceLinkEdge 与 /search 的 edges 归一后都可传入 */
interface GraphEdge {
  from_code?: string
  to_code?: string
  /** DeviceLinkEdge 另有 other_code，优先用它定位对端 */
  other_code?: string
  relation_type?: string
  source?: string
  other_kind?: string
}

type RawProblem = Record<string, unknown>

const props = withDefaults(
  defineProps<{
    /** 中心对象编号（树根） */
    centerCode: string
    edges: GraphEdge[]
    /** 该对象的 BA 问题（来自 /ba/problems） */
    problems?: RawProblem[]
  }>(),
  { problems: () => [] },
)

const emit = defineEmits<{ (e: 'select-node', code: string): void }>()

interface GraphNode {
  key: string
  code: string
  label: string
  kind: 'device' | 'problem'
  source: 'auto' | 'manual'
  otherKind: string
}

/** 对端类别 → 中文短标（让「自动关联出来的到底是什么」一眼可见） */
const KIND_LABEL: Record<string, string> = { device: '设备', room: '机房', record: '资料域' }

const ROOT_X = 168
const LEAF_X = 548
const VIEW_W = 724
const PAD_TOP = 40
const PAD_BOT = 24
const ROW_H = 46
const NODE_R = 13
const CODE_MAX = 22

const zoomIndex = ref(2)
const ZOOM_STEPS = [0.5, 0.8, 1, 1.25, 1.5, 2]
const zoomClass = computed(() => `rg--z${zoomIndex.value}`)

function zoomIn() {
  zoomIndex.value = Math.min(ZOOM_STEPS.length - 1, zoomIndex.value + 1)
}
function zoomOut() {
  zoomIndex.value = Math.max(0, zoomIndex.value - 1)
}
function zoomFit() {
  zoomIndex.value = 2
}

/**
 * 自动关联过滤（用户反馈：自动关联在图谱里偏「垃圾」，默认隐藏）。
 * 仅在该开关打开时跳过 source==='auto' 的边；人工关联与 BA 问题始终保留。
 * 内部开关即可覆盖全部消费方（DeviceDetailDrawer / DeviceAttrPanel），无需各自改。
 */
const autoHidden = ref(true)
const autoEdgeCount = computed(
  () => props.edges.filter((e) => (e.source ?? 'manual') === 'auto').length,
)

/** 边 → 节点：同一对端多条边时保留「自动」来源并合并关系类型（与 React 版同口径） */
const nodes = computed<GraphNode[]>(() => {
  const center = props.centerCode
  const map = new Map<string, GraphNode>()
  for (const e of props.edges) {
    const f = String(e.from_code ?? '')
    const t = String(e.to_code ?? '')
    if (!f || !t) continue
    // 【防垃圾】开启「隐藏自动关联」时，跳过自动边（人工/问题边不受影响）
    if (autoHidden.value && (e.source ?? 'manual') === 'auto') continue
    const other = e.other_code != null ? String(e.other_code) : f === center ? t : f === t ? '' : f
    if (!other || other === center) continue
    const type = String(e.relation_type ?? '')
    const source: 'auto' | 'manual' = (e.source ?? 'manual') === 'auto' ? 'auto' : 'manual'
    const prev = map.get(other)
    if (prev) {
      if (source === 'auto' && prev.source !== 'auto') prev.source = 'auto'
      if (type && prev.label !== type) prev.label = `${prev.label}・${type}`
      continue
    }
    map.set(other, {
      key: `d:${other}`,
      code: other,
      label: type || '关联',
      kind: 'device',
      source,
      otherKind: String(e.other_kind ?? 'unknown'),
    })
  }
  const devices = [...map.values()].sort((a, b) => a.code.localeCompare(b.code))
  const problems: GraphNode[] = props.problems.map((p, i) => ({
    key: `p:${i}`,
    code: p.device_code != null ? String(p.device_code) : `问题${i + 1}`,
    label: String(p.problem_type ?? '') || String(p.status ?? '') || 'BA 问题',
    kind: 'problem',
    source: 'manual',
    otherKind: 'unknown',
  }))
  return [...devices, ...problems]
})

const hasContent = computed(() => nodes.value.length > 0)
const viewH = computed(() => Math.max(260, PAD_TOP + nodes.value.length * ROW_H + PAD_BOT))
const viewBox = computed(() => `0 0 ${VIEW_W} ${viewH.value}`)
const rootY = computed(() => viewH.value / 2)

function yOf(i: number): number {
  return PAD_TOP + ROW_H * (i + 0.5)
}

function pathOf(y: number): string {
  const midX = (ROOT_X + LEAF_X) / 2
  return `M ${ROOT_X} ${rootY.value} C ${midX} ${rootY.value}, ${midX} ${y}, ${LEAF_X} ${y}`
}

function clip(text: string): string {
  return text.length > CODE_MAX ? `${text.slice(0, CODE_MAX)}…` : text
}

function chipWidth(label: string): number {
  return Math.min(150, label.length * 12 + 10)
}

function edgeTone(n: GraphNode): string {
  if (n.kind === 'problem') return 'rg__edge--problem'
  return n.source === 'auto' ? 'rg__edge--auto' : 'rg__edge--manual'
}

function labelTone(n: GraphNode): string {
  if (n.kind === 'problem') return 'rg__label--problem'
  return n.source === 'auto' ? 'rg__label--auto' : 'rg__label--manual'
}

function nodeTone(n: GraphNode): string {
  if (n.kind === 'problem') return 'rg__node--problem'
  return n.source === 'auto' ? 'rg__node--auto' : 'rg__node--manual'
}

function subText(n: GraphNode): string {
  const kind = KIND_LABEL[n.otherKind]
  return (n.source === 'auto' ? '自动关联' : '人工关联') + (kind ? ` · ${kind}` : '')
}

const deviceCount = computed(() => nodes.value.filter((n) => n.kind === 'device').length)
const problemCount = computed(() => nodes.value.filter((n) => n.kind === 'problem').length)
</script>

<template>
  <div class="rg" :class="zoomClass">
    <div class="rg__bar">
      <el-button-group>
        <el-button size="small" aria-label="缩小图谱" @click="zoomOut">
          <el-icon :size="16"><ZoomOut /></el-icon>
        </el-button>
        <el-button size="small" aria-label="适应窗口" @click="zoomFit">
          <el-icon :size="16"><ScaleToOriginal /></el-icon>
        </el-button>
        <el-button size="small" aria-label="放大图谱" @click="zoomIn">
          <el-icon :size="16"><ZoomIn /></el-icon>
        </el-button>
      </el-button-group>
      <el-checkbox v-model="autoHidden" size="small" class="rg__hide-auto" title="自动关联多为系统推断，默认隐藏以减少干扰">
        <span>隐藏自动关联</span>
      </el-checkbox>
      <span v-if="autoHidden && autoEdgeCount > 0" class="rg__bar-hint">已隐藏 {{ autoEdgeCount }} 条自动关联</span>
      <span class="rg__bar-hint">放大后可在画布内横向滚动（不改变宽高比）</span>
    </div>

    <p v-if="!hasContent" class="rg__empty">
      {{ autoHidden && autoEdgeCount > 0
        ? `已隐藏 ${autoEdgeCount} 条自动关联；该对象暂无人工关联与 BA 问题。`
        : '该对象暂无可展示的关联与 BA 问题。' }}
    </p>

    <div v-else class="rg__canvas">
      <!-- 【防压扁】只给 viewBox，绝不写 width / height 像素属性；等比由 preserveAspectRatio 保证 -->
      <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" class="rg__svg" role="img"
        :aria-label="`以 ${centerCode} 为中心的关联图谱，共 ${nodes.length} 个关联对象`">
        <g v-for="(n, i) in nodes" :key="`e-${n.key}`">
          <path :d="pathOf(yOf(i))" class="rg__edge" :class="edgeTone(n)" />
          <g :transform="`translate(${ROOT_X + 88}, ${yOf(i) - 9})`">
            <rect class="rg__chip" x="-4" y="-11" :width="chipWidth(n.label)" height="18" rx="5" />
            <text class="rg__text rg__label" :class="labelTone(n)" x="1" y="3">{{ clip(n.label) }}</text>
          </g>
        </g>

        <g>
          <circle :cx="ROOT_X" :cy="rootY" :r="NODE_R + 4" class="rg__node rg__node--root" />
          <text :x="ROOT_X" :y="rootY + 4" text-anchor="middle" class="rg__text rg__mark-root">本</text>
          <text :x="ROOT_X - 14" :y="rootY - NODE_R - 8" text-anchor="end" class="rg__text rg__root-code">
            {{ clip(centerCode) }}
          </text>
          <text :x="ROOT_X - 14" :y="rootY - NODE_R + 6" text-anchor="end" class="rg__text rg__root-sub">
            当前对象
          </text>
        </g>

        <g
          v-for="(n, i) in nodes"
          :key="n.key"
          class="rg__leaf"
          :class="{ 'rg__leaf--link': n.kind === 'device' }"
          :tabindex="n.kind === 'device' ? 0 : undefined"
          :role="n.kind === 'device' ? 'button' : undefined"
          :aria-label="n.kind === 'device' ? `查看关联对象 ${n.code}` : undefined"
          @click="n.kind === 'device' && emit('select-node', n.code)"
          @keydown.enter="n.kind === 'device' && emit('select-node', n.code)"
        >
          <circle :cx="LEAF_X" :cy="yOf(i)" :r="NODE_R" class="rg__node" :class="nodeTone(n)" />
          <text :x="LEAF_X" :y="yOf(i) + 4" text-anchor="middle" class="rg__text rg__mark"
            :class="n.kind === 'problem' ? 'rg__mark--problem' : n.source === 'auto' ? 'rg__mark--auto' : 'rg__mark--manual'">
            {{ n.kind === 'problem' ? '!' : n.source === 'auto' ? 'A' : 'M' }}
          </text>
          <text :x="LEAF_X + NODE_R + 6" :y="yOf(i) + 4" class="rg__text rg__leaf-code">{{ clip(n.code) }}</text>
          <text v-if="n.kind === 'device'" :x="LEAF_X + NODE_R + 6" :y="yOf(i) + 18"
            class="rg__text rg__leaf-sub" :class="n.source === 'auto' ? 'rg__leaf-sub--auto' : ''">
            {{ subText(n) }}
          </text>
        </g>
      </svg>
    </div>

    <RelationGraphLegend :device-count="deviceCount" :problem-count="problemCount" />
  </div>
</template>

<style scoped>
/* 缩放宽高比只由 viewBox 决定：width 走倍率、height 恒为 auto（AS-1 / AS-3） */
.rg {
  --rg-zoom: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.rg--z0 { --rg-zoom: 0.5; }
.rg--z1 { --rg-zoom: 0.8; }
.rg--z3 { --rg-zoom: 1.25; }
.rg--z4 { --rg-zoom: 1.5; }
.rg--z5 { --rg-zoom: 2; }

.rg__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.rg__bar-hint {
  font-size: var(--text-xs);
  color: var(--muted);
}

.rg__hide-auto {
  margin-right: var(--space-1);
}
.rg__hide-auto :deep(.el-checkbox__label) {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

/* 画布：定高 + 自身横/纵滚动，页面级绝不出现横滚（§4.6） */
.rg__canvas {
  overflow: auto;
  max-height: 52vh;
  min-height: 200px;
  padding: var(--space-3);
  background: var(--graph-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

/* min-width 只为窄容器（抽屉 480px）里的最小可读字号，`height: auto` 保证等比 —— 不违反 AS-1 */
.rg__svg {
  display: block;
  margin: 0 auto;
  width: calc(100% * var(--rg-zoom));
  min-width: calc(620px * var(--rg-zoom));
  height: auto;
}

.rg__edge {
  fill: none;
  stroke-width: 1.8;
}

.rg__edge--auto { stroke: var(--info); stroke-dasharray: 6 4; }
.rg__edge--manual { stroke: var(--muted); }
.rg__edge--problem { stroke: var(--danger); }

.rg__chip {
  fill: var(--graph-bg);
  stroke: var(--graph-line-dash);
  stroke-width: 0.8;
}

.rg__text {
  font-family: var(--font-body);
  pointer-events: none;
  user-select: none;
}

.rg__label { font-size: 11px; }
.rg__label--auto { fill: var(--info-fg); }
.rg__label--manual { fill: var(--fg-2); }
.rg__label--problem { fill: var(--danger-fg); }

.rg__node--root { fill: var(--accent); stroke: var(--accent-active); stroke-width: 1.5; }
.rg__node--auto { fill: var(--surface-3); stroke: var(--info); stroke-width: 1.6; }
.rg__node--manual { fill: var(--surface-3); stroke: var(--muted); stroke-width: 1.6; }
.rg__node--problem { fill: var(--danger-bg); stroke: var(--danger); stroke-width: 1.6; }

.rg__mark-root { font-size: 12px; fill: #fff; }
.rg__mark { font-size: 11px; font-weight: 600; }
.rg__mark--auto { fill: var(--info-fg); }
.rg__mark--manual { fill: var(--fg-2); }
.rg__mark--problem { fill: var(--danger-fg); }

.rg__root-code { font-size: 12px; font-weight: 600; fill: var(--accent-active); }
.rg__root-sub { font-size: 10px; fill: var(--muted); }
.rg__leaf-code { font-size: 11px; fill: var(--fg); }
.rg__leaf-sub { font-size: 9.5px; fill: var(--meta); }
.rg__leaf-sub--auto { fill: var(--info-fg); }

.rg__leaf--link { cursor: pointer; }
.rg__leaf--link:hover .rg__leaf-code,
.rg__leaf--link:focus-visible .rg__leaf-code { fill: var(--accent); text-decoration: underline; }
.rg__leaf--link:focus-visible { outline: none; }
.rg__leaf--link:focus-visible circle { stroke: var(--accent); stroke-width: 3; }

.rg__empty {
  margin: 0;
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--fg-2);
}
</style>
