<script setup lang="ts">
/**
 * 盘点房间选择面板：楼栋/楼层筛选 + 房间搜索 + 按已绑定设备数倒序的候选列表。
 * 列表与筛选逻辑由父视图（InventoryView）计算，这里只负责展示与选中事件。
 */
import { MapLocation } from '@element-plus/icons-vue'
import type { RoomInventoryRow } from '@/types/scan'

defineProps<{
  /** 已按「已绑定设备数倒序 → 编号升序」排好序、并截断到展示上限的房间行 */
  rooms: RoomInventoryRow[]
  /** 命中筛选的房间总数（可能大于 rooms.length，用于提示截断） */
  matchedTotal: number
  loading: boolean
  maxRows: number
}>()

const emit = defineEmits<{ (e: 'pick', room: RoomInventoryRow): void }>()

function countOf(r: RoomInventoryRow): number {
  return r.device_count ?? 0
}
</script>

<template>
  <section class="panel room-picker">
    <header class="room-picker__head">
      <h3 class="room-picker__title">
        <el-icon :size="16" class="room-picker__pin"><MapLocation /></el-icon>
        <span>选择要盘点的房间</span>
      </h3>
      <span class="room-picker__sub">共 {{ matchedTotal }} 间，按已绑定设备数排序</span>
    </header>

    <el-skeleton v-if="loading" :rows="3" animated />

    <template v-else>
      <div v-if="rooms.length === 0" class="room-picker__empty">
        无匹配房间，请调整楼栋 / 楼层 / 搜索条件。
      </div>
      <div v-else class="room-picker__list" role="listbox" aria-label="房间候选列表">
        <button
          v-for="r in rooms"
          :key="r.id"
          type="button"
          class="room-picker__row"
          role="option"
          @click="emit('pick', r)"
        >
          <span class="room-picker__code mono ellipsis">{{ r.code }}</span>
          <span class="room-picker__name ellipsis">{{ r.name }}</span>
          <span class="room-picker__loc ellipsis">{{ r.building }} {{ r.floor }}</span>
          <span class="room-picker__count tnum" :class="{ 'room-picker__count--zero': countOf(r) === 0 }">
            {{ countOf(r) }} 台
          </span>
        </button>
        <p v-if="matchedTotal > rooms.length" class="room-picker__more">
          仅显示前 {{ maxRows }} 间，请用搜索或筛选缩小范围（共 {{ matchedTotal }} 间）
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.room-picker { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.room-picker__head { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; }
.room-picker__title { display: flex; align-items: center; gap: var(--space-1); margin: 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.room-picker__pin { color: var(--accent); }
.room-picker__sub { font-size: var(--text-xs); color: var(--muted); }
.room-picker__empty { margin: 0; padding: var(--space-3); font-size: var(--text-sm); color: var(--muted); }
.room-picker__list { display: flex; flex-direction: column; max-height: 52vh; overflow-y: auto; border: 1px solid var(--border-soft); border-radius: var(--radius-md); }
.room-picker__row {
  display: flex; align-items: center; gap: var(--space-3); min-width: 0;
  width: 100%; padding: var(--space-2) var(--space-3);
  border: none; border-bottom: 1px solid var(--border-soft); background: var(--surface);
  font: inherit; text-align: left; cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}
.room-picker__row:last-of-type { border-bottom: none; }
.room-picker__row:hover, .room-picker__row:focus-visible { background: var(--accent-soft); }
.room-picker__code { flex: 0 0 176px; width: 176px; font-size: var(--text-sm); color: var(--fg); }
.room-picker__name { flex: 1 1 auto; min-width: 0; font-size: var(--text-sm); color: var(--fg-2); }
.room-picker__loc { flex: 0 0 auto; max-width: 200px; font-size: var(--text-xs); color: var(--muted); }
.room-picker__count { flex: 0 0 auto; min-width: 44px; padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-pill); font-size: var(--text-xs); color: var(--fg-2); text-align: center; }
.room-picker__count--zero { color: var(--meta); }
.room-picker__more { margin: 0; padding: var(--space-2); font-size: var(--text-xs); color: var(--muted); text-align: center; }
@media (max-width: 1279px) {
  .room-picker__code { flex: 0 1 auto; width: auto; }
  .room-picker__loc { display: none; }
}
</style>
