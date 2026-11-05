<template>
  <view class="rp">
    <view class="rp-bar">
      <text class="rp-ico">搜索</text>
      <input
        class="rp-inp"
        :placeholder="placeholder"
        placeholder-class="ph"
        v-model="kw"
        @input="onInput"
      />
      <text v-if="kw" class="rp-clear" @tap="clear">✕</text>
    </view>

    <view v-if="loading" class="rp-hint">搜索中…</view>
    <template v-else-if="kw.trim()">
      <view v-if="filtered.length" class="rp-hint">点击添加（已加入的不再显示）</view>
      <view
        v-for="r in filtered"
        :key="r.room_code"
        class="rp-row"
        @tap="pick(r)"
      >
        <view class="rp-main">
          <text class="rp-name">{{ r.snapshot_name || r.room_code }}</text>
          <text class="rp-sub">
            {{ r.room_code }}<template v-if="r.building || r.floor"> · {{ r.building || '' }}<template v-if="r.building && r.floor"> / </template>{{ r.floor || '' }}</template>
          </text>
        </view>
        <text class="rp-add">＋</text>
      </view>
      <view v-if="!filtered.length" class="rp-hint">无匹配房间，换个关键词试试</view>
    </template>
    <view v-else class="rp-hint">{{ idleHint }}</view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { availableNodes } from '@/api/patrol'

/**
 * RoomPicker —— 可复用「从房间搜索并选择」组件。
 *
 * 解决巡查线路两个页面（RouteEdit / RouteDetail）原先的痛点：
 * 旧逻辑 `availableNodes('room')` 拉全量后只 `slice(0,6)` 用 actionSheet 弹出前 6 个，
 * 房间一多根本找不到目标。这里改为：搜索框输入关键词 → 调 `availableNodes('room', q)`
 * （后端 `WHERE name/code LIKE` 过滤，SQLite LIKE 对 ASCII 本就大小写不敏感）→ 结果列表点击即选。
 *
 * Props：
 * - exclude：已加入的 room_code 列表，从结果里剔除（避免重复添加）。
 * Events：
 * - select(room)：选中某房间，由父页面决定如何加入线路。
 */
const props = withDefaults(
  defineProps<{
    placeholder?: string
    idleHint?: string
    exclude?: string[]
  }>(),
  {
    placeholder: '搜索房间名 / 编号',
    idleHint: '输入房间名或编号后，点击下方结果即可添加',
    exclude: () => [],
  },
)

const emit = defineEmits<{ (e: 'select', room: any): void }>()

const kw = ref('')
const loading = ref(false)
const list = ref<any[]>([])
let timer: ReturnType<typeof setTimeout> | null = null

/** 用 exclude 剔除已加入的房间（父页面传来的 room_code 数组） */
const filtered = computed(() => {
  const ex = new Set(props.exclude || [])
  return list.value.filter((r) => !ex.has(r.room_code))
})

/** 输入即搜（300ms 防抖，避免每个字符都打接口） */
function onInput() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(doSearch, 300)
}

function clear() {
  kw.value = ''
  list.value = []
  if (timer) clearTimeout(timer)
}

async function doSearch() {
  const q = kw.value.trim()
  if (!q) {
    list.value = []
    return
  }
  loading.value = true
  try {
    const res = await availableNodes('room', q)
    list.value = res || []
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

function pick(r: any) {
  emit('select', r)
}
</script>

<style scoped lang="scss">
.rp {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid $tm-border-light;
}
.rp-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 16rpx;
  background: $tm-bg;
  border-radius: 12rpx;
}
.rp-ico {
  flex-shrink: 0;
  font-size: 22rpx;
  color: $tm-text-muted;
  background: $tm-card-bg;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
}
.rp-inp {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: $tm-text;
}
.ph {
  color: $tm-text-muted;
}
.rp-clear {
  flex-shrink: 0;
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  font-size: 26rpx;
  color: $tm-text-muted;
}
.rp-hint {
  padding: 16rpx 8rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
  line-height: 1.6;
}
.rp-row {
  display: flex;
  align-items: center;
  padding: 20rpx 8rpx;
  border-top: 1rpx solid $tm-border-light;
}
.rp-row:active {
  background: $tm-primary-bg;
}
.rp-main {
  flex: 1;
  min-width: 0;
}
.rp-name {
  font-size: 28rpx;
  color: $tm-text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-sub {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.rp-add {
  flex-shrink: 0;
  width: 60rpx;
  height: 60rpx;
  line-height: 56rpx;
  text-align: center;
  font-size: 40rpx;
  color: $tm-primary;
}
</style>
