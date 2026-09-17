<script setup lang="ts">
/**
 * 设备关系图（径向布局）
 * =====================================================================
 * 【红线验收件】它是「防压扁」的重点检查对象（任务书硬规则 ①）。
 * 起因：React 版在 1920×1080 + 系统缩放 125%/150%（CSS 视口 1536×864 / 1280×720）下
 * 图谱被横向拉扁 —— 根因是根元素同时写死了 width / height 像素属性。
 *
 * 纪律（本文件逐条落实）：
 *  1. 根 `<svg>` **只留 viewBox**，宽高交给 CSS：`width:100%; height:auto`
 *     —— 长宽比由 viewBox 推导，容器多宽图就多宽，绝不写死像素宽高；
 *  2. **禁止**把长宽比显式设成非等比（那正是压扁元凶）；留缺省值即等比缩放；
 *  3. **禁止**对图元做整体缩放变换，**禁止**改 `html` 根字号（红线 ①）；
 *  4. 节点 / 连线 / 文字颜色一律走设计令牌，**零字面色值**（红线 ⑥）；
 *  5. 无 emoji，本组件纯矢量绘制，无需图标（红线 ⑤）。
 *
 * 布局与 React 版 `DeviceRelationGraph.tsx` **逐行等价**：按 `depth` 分层，
 * depth=0 居中，其余节点均分整圆（起点 -90° 即正上方），半径随层数线性外扩。
 */
import { computed } from 'vue'
import type { SearchEdge, SearchNode } from '@/types/asset'

const props = defineProps<{
  nodes: SearchNode[]
  edges: SearchEdge[]
}>()

/** 画布逻辑尺寸（仅用于 viewBox 坐标系，不是渲染像素） */
const W = 680
const H = 460

interface Point {
  x: number
  y: number
}

const viewBox = computed(() => `0 0 ${W} ${H}`)

/** 各节点坐标：depth=0 圆心；depth>0 按同层节点数均分整圆 */
const positions = computed<Record<string, Point>>(() => {
  const cx = W / 2
  const cy = H / 2
  const maxDepth = Math.max(1, ...props.nodes.map((n) => n.depth))
  const radius = (d: number) => (d / maxDepth) * (Math.min(W, H) / 2 - 70)

  const byDepth: Record<number, SearchNode[]> = {}
  for (const node of props.nodes) {
    ;(byDepth[node.depth] ||= []).push(node)
  }

  const pos: Record<string, Point> = {}
  for (const [depthKey, list] of Object.entries(byDepth)) {
    const depth = Number(depthKey)
    const r = radius(depth)
    const n = list.length
    list.forEach((node, i) => {
      if (depth === 0) {
        pos[node.device_code] = { x: cx, y: cy }
        return
      }
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2
      pos[node.device_code] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
    })
  }
  return pos
})

interface EdgePath {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
  mx: number
  my: number
  type: string
}

/** 只保留两端坐标都存在的边（缺坐标 = 该端点不在本次结果里，跳过而非画到原点） */
const edgePaths = computed<EdgePath[]>(() => {
  const pos = positions.value
  const list: EdgePath[] = []
  props.edges.forEach((edge, index) => {
    const a = pos[edge.from]
    const b = pos[edge.to]
    if (!a || !b) return
    list.push({
      key: `e-${index}`,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      type: edge.type ?? '',
    })
  })
  return list
})
</script>

<template>
  <div class="chart-box rg-box">
    <!-- viewBox 单独存在；宽高由 CSS 决定（不写 width/height/enable-background） -->
    <svg :viewBox="viewBox" class="rg" role="img" aria-label="设备关系图">
      <defs>
        <marker
          id="ledger-rel-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,3 L0,6 Z" class="rg__marker" />
        </marker>
      </defs>

      <g>
        <line
          v-for="edge in edgePaths"
          :key="edge.key"
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          class="rg__edge"
          marker-end="url(#ledger-rel-arrow)"
        />
        <text
          v-for="edge in edgePaths"
          v-show="!!edge.type"
          :key="`t-${edge.key}`"
          :x="edge.mx"
          :y="edge.my - 4"
          class="rg__edge-label"
          text-anchor="middle"
        >
          {{ edge.type }}
        </text>
      </g>

      <g v-for="node in nodes" :key="node.device_code">
        <template v-if="positions[node.device_code]">
          <circle
            :cx="positions[node.device_code]!.x"
            :cy="positions[node.device_code]!.y"
            :r="node.depth === 0 ? 26 : 20"
            :class="node.depth === 0 ? 'rg__node rg__node--center' : 'rg__node rg__node--outer'"
          />
          <text
            :x="positions[node.device_code]!.x"
            :y="positions[node.device_code]!.y - 32"
            class="rg__code"
            text-anchor="middle"
          >
            {{ node.device_code }}
          </text>
          <text
            v-if="node.depth !== 0"
            :x="positions[node.device_code]!.x"
            :y="positions[node.device_code]!.y + 4"
            class="rg__depth"
            text-anchor="middle"
          >
            {{ node.depth }}
          </text>
          <text
            v-else
            :x="positions[node.device_code]!.x"
            :y="positions[node.device_code]!.y + 4"
            class="rg__center-label"
            text-anchor="middle"
          >
            {{ node.name?.slice(0, 4) }}
          </text>
        </template>
      </g>
    </svg>

    <p class="rg__legend">
      中心为本设备，外圈按关联跳数（数字）分层；连线标注关系类型，箭头指向下游。
    </p>
  </div>
</template>

<style scoped>
.rg-box {
  min-width: 0;
}

/* 关键：宽 100%、高 auto —— 长宽比由 viewBox 推导，杜绝写死像素导致压扁 */
.rg {
  display: block;
  width: 100%;
  height: auto;
  background: var(--graph-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.rg__marker {
  fill: var(--graph-line);
}

.rg__edge {
  stroke: var(--graph-line-dash);
  stroke-width: 1.5;
  fill: none;
}

.rg__edge-label {
  fill: var(--muted);
  font-size: 11px;
  font-family: var(--font-body);
}

.rg__node {
  stroke-width: 2;
}

.rg__node--center {
  fill: var(--accent);
  stroke: var(--accent-active);
}

.rg__node--outer {
  fill: var(--surface);
  stroke: var(--graph-line);
}

.rg__code {
  fill: var(--fg-2);
  font-size: 11px;
  font-family: var(--font-mono);
}

.rg__depth {
  fill: var(--fg-2);
  font-size: 10px;
  font-family: var(--font-body);
}

.rg__center-label {
  fill: var(--accent-on);
  font-size: 10px;
  font-family: var(--font-body);
}

.rg__legend {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
