<script setup lang="ts">
/**
 * 工单流转记录（work_order_events，**只读**，不可编辑、不可删除 —— C6 不可变审计日志）
 * =====================================================================
 * 每条显示：事件中文 + `from_status → to_status` + actor + 时间 + 离线来源角标。
 * 长列表策略（WOD-8）：首屏 20 条 + [加载更早]；事件为空时显示明确说明（WOD-5 不静默）。
 */
import { computed, ref, watch } from 'vue'
import { Postcard, Refresh } from '@element-plus/icons-vue'
import { fmtBeijingUtc } from '@/lib/format'
import { woEventLabel, woStatusLabel, woToneStyle } from '@/types/workOrderMeta'
import type { WorkOrderEvent } from '@/types/workOrder'

const props = defineProps<{
  events: WorkOrderEvent[]
  loading?: boolean
}>()

const PAGE = 20
const visible = ref(PAGE)

watch(
  () => props.events,
  () => { visible.value = PAGE },
)

const sorted = computed(() => {
  // 后端按 created_at 升序返回；此处再做稳定兜底，避免乱序时时间线错位
  return [...props.events].sort((a, b) => {
    const ta = Date.parse(a.created_at)
    const tb = Date.parse(b.created_at)
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0
    return ta - tb
  })
})

const shown = computed(() => sorted.value.slice(0, visible.value))
const hasMore = computed(() => sorted.value.length > visible.value)

function actorText(actorId: number): string {
  return actorId === 0 ? '系统 / 物联自动' : `用户 #${actorId}`
}

function transitionText(ev: WorkOrderEvent): string {
  if (!ev.from_status && !ev.to_status) return ''
  const from = ev.from_status ? woStatusLabel(ev.from_status) : '—'
  const to = ev.to_status ? woStatusLabel(ev.to_status) : '—'
  return `${from} → ${to}`
}

function loadMore() {
  visible.value += PAGE
}
</script>

<template>
  <div class="tl">
    <p v-if="loading && !events.length" class="tl__hint" role="status">正在加载流转记录…</p>

    <div v-else-if="!events.length" class="tl__empty">
      <p class="tl__empty-title">还没有流转记录。</p>
      <p class="tl__empty-desc">
        正常工单在创建时就应有一条「创建工单」事件；若长期为空请联系系统管理员核查事件写入。
      </p>
    </div>

    <ol v-else class="tl__list">
      <li v-for="ev in shown" :key="ev.id" class="tl__item">
        <span class="tl__dot" :style="woToneStyle(ev.to_status || ev.from_status)" aria-hidden="true" />
        <div class="tl__body">
          <p class="tl__head">
            <span class="tl__type">{{ woEventLabel(ev.event_type) }}</span>
            <span v-if="transitionText(ev)" class="tl__trans">{{ transitionText(ev) }}</span>
            <span v-if="ev.client_op_id" class="tl__offline">
              <el-icon :size="16"><Postcard /></el-icon><span>离线提交</span>
            </span>
          </p>
          <p class="tl__meta">
            <span>{{ actorText(ev.actor_id) }}</span>
            <span class="tl__time tnum">{{ fmtBeijingUtc(ev.created_at) }}</span>
          </p>
        </div>
      </li>
    </ol>

    <div v-if="hasMore" class="tl__more">
      <el-button text @click="loadMore">
        <el-icon :size="16"><Refresh /></el-icon><span>加载更早（余 {{ sorted.length - visible }} 条）</span>
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.tl { min-width: 0; }
.tl__hint { margin: 0; font-size: var(--text-sm); color: var(--fg-2); }
.tl__empty { padding: var(--space-2) 0; }
.tl__empty-title { margin: 0; font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }
.tl__empty-desc { margin: var(--space-1) 0 0; font-size: var(--text-xs); line-height: var(--leading-body); color: var(--fg-2); }

.tl__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.tl__item { position: relative; display: flex; gap: var(--space-2); min-width: 0; padding-left: var(--space-1); }
.tl__dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: var(--radius-pill);
  background: var(--tone-fg, var(--accent-active));
}
.tl__body { min-width: 0; flex: 1 1 auto; }
.tl__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); margin: 0; min-width: 0; }
.tl__type { font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }
.tl__trans { font-size: var(--text-xs); color: var(--fg-2); }
.tl__offline {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
}
.tl__meta { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.tl__time { font-family: var(--font-mono); }
.tl__more { margin-top: var(--space-2); }
</style>
