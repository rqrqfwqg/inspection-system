<template>
  <view class="tree">
    <view v-for="n in nodes" :key="n.key" class="node">
      <view
        class="node-row"
        :class="{ active: n.type === 'room' && activeKey === n.key }"
        :style="{ paddingLeft: depth * 28 + 16 + 'rpx' }"
        @tap="onTap(n)"
      >
        <text v-if="n.has_children" class="caret">{{ n.expanded ? '▾' : '▸' }}</text>
        <text v-else class="caret placeholder">{{ n.type === 'room' ? '·' : '' }}</text>
        <text class="node-label">{{ n.label }}</text>
        <text v-if="n.count > 0" class="node-count">{{ n.count }}</text>
      </view>

      <!-- 展开子层 -->
      <view v-if="n.expanded && n.children && n.children.length" class="node-children">
        <AreaTree
          :nodes="n.children"
          :depth="depth + 1"
          :active-key="activeKey"
          @pick="onChildPick"
        />
      </view>

      <!-- 展开中：骨架占位（节点多的楼栋避免大片空白） -->
      <view
        v-else-if="n.expanded && n.loading"
        class="node-loading"
        :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
      >
        <text class="sk sk1"></text>
        <text class="sk sk2"></text>
        <text class="sk sk3"></text>
      </view>

      <!-- 🔴 加载失败：与「无下级」区分开，可点击重试 -->
      <view
        v-else-if="n.expanded && n.loadError"
        class="node-error"
        :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
        @tap="reload(n)"
      >
        加载失败，点击重试
      </view>

      <!-- 已展开但确实是空的 -->
      <view
        v-else-if="n.expanded && n.children && !n.children.length"
        class="node-empty"
        :style="{ paddingLeft: (depth + 1) * 28 + 40 + 'rpx' }"
      >
        无下级
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { assetAreaTree } from '@/api/asset'
import type { AssetAreaNode } from '@/types/asset'

defineOptions({ name: 'AreaTree' })

type TreeRow = AssetAreaNode & {
  expanded?: boolean
  loading?: boolean
  loadError?: string
  children?: AssetAreaNode[]
}

withDefaults(
  defineProps<{
    nodes: TreeRow[]
    depth?: number
    /** 当前选中的机房节点 key（高亮联动） */
    activeKey?: string
  }>(),
  { depth: 0, activeKey: '' },
)

const emit = defineEmits<{ (e: 'pick', room: AssetAreaNode): void }>()

function onChildPick(room: AssetAreaNode) {
  emit('pick', room)
}

async function loadChildren(n: TreeRow) {
  n.loading = true
  n.loadError = ''
  try {
    const rows = await assetAreaTree({ parent: n.key })
    n.children = rows || []
  } catch (e: any) {
    n.children = []
    n.loadError = (e?.message || '').trim() || '加载失败'
  } finally {
    n.loading = false
  }
}

async function onTap(n: TreeRow) {
  // 机房节点：直接抛出，由上层决定「去盘点」
  if (n.type === 'room') {
    emit('pick', n)
    return
  }
  if (!n.has_children) return
  // 懒加载：逐层展开（区域树接口不支持一次拿全树）
  const willExpand = !n.expanded
  n.expanded = willExpand
  if (willExpand && !n.children) {
    await loadChildren(n)
  }
}

async function reload(n: TreeRow) {
  n.children = undefined
  n.expanded = true
  await loadChildren(n)
}
</script>

<style scoped lang="scss">
.node-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 20rpx 16rpx;
  border-bottom: 1rpx solid $tm-border-light;
}
/* 选中态：机房节点被选中后高亮，与上层 activeKey 联动 */
.node-row.active {
  background: $tm-primary-bg;
}
.node-row.active .node-label {
  color: $tm-primary;
  font-weight: 600;
}
.caret {
  width: 28rpx;
  color: $tm-text-secondary;
  font-size: 24rpx;
}
.caret.placeholder {
  color: $tm-text-muted;
}
.node-label {
  flex: 1;
  font-size: 28rpx;
  color: $tm-text;
}
.node-count {
  font-size: 22rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  padding: 2rpx 12rpx;
  border-radius: 8rpx;
}
.node-loading {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 20rpx 0;
}
.sk {
  height: 22rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f2f4f7, #e9ecf1, #f2f4f7);
}
.sk1 { width: 60%; }
.sk2 { width: 80%; }
.sk3 { width: 45%; }
.node-error {
  padding: 20rpx 0;
  font-size: 24rpx;
  color: $tm-danger;
}
.node-empty {
  padding: 18rpx 0;
  font-size: 22rpx;
  color: $tm-text-muted;
}
</style>
