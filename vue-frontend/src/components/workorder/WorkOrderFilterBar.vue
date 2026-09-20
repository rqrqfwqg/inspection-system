<script setup lang="ts">
/**
 * 工单筛选条（UIUX 页面 1）
 * =====================================================================
 * 布局：panel + role="search"；flex-wrap 自适应折行（不写死宽度）。
 * 关键字 250ms 防抖；回车 / 清空立即提交（清空后不提交会让输入框与列表不一致）。
 * 任一筛选变更由父级把 page 归 1 并重新请求（父级不持有本组件的页码）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshLeft, Search } from '@element-plus/icons-vue'
import { getUsers } from '@/api/users'
import {
  WO_PRIORITY_LABELS, WO_STATUS_FILTERS, WO_TYPE_LABELS, woStatusLabel,
} from '@/types/workOrderMeta'
import type { User } from '@/types/user'
import type { WorkOrderFilters, WorkOrderPriority, WorkOrderStatus, WorkOrderType } from '@/types/workOrder'

const props = defineProps<{
  filters: WorkOrderFilters
  loading: boolean
  hasFilters: boolean
}>()

const emit = defineEmits<{
  (e: 'patch', patch: Partial<WorkOrderFilters>): void
  (e: 'reset'): void
}>()

const q = ref(props.filters.q)
let timer: number | undefined

watch(
  () => props.filters.q,
  (v) => { if (v !== q.value) q.value = v },
)

function stopTimer() {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
}
function pushQ() {
  stopTimer()
  timer = window.setTimeout(() => emit('patch', { q: q.value.trim() }), 250)
}
function flushQ() {
  stopTimer()
  emit('patch', { q: q.value.trim() })
}
onUnmounted(stopTimer)

const statusValue = computed<string>({
  get: () => props.filters.status ?? '',
  set: (raw) => emit('patch', { status: (raw ?? '') as WorkOrderStatus | '' }),
})

const typeValue = computed<string>({
  get: () => props.filters.type ?? '',
  set: (raw) => emit('patch', { type: (raw ?? '') as WorkOrderType | '' }),
})

const priorityValue = computed<string>({
  get: () => props.filters.priority ?? '',
  set: (raw) => emit('patch', { priority: (raw ?? '') as WorkOrderPriority | '' }),
})

const assigneeValue = computed<string>({
  get: () => (props.filters.assignee_id === null ? '' : String(props.filters.assignee_id)),
  set: (raw) => {
    const v = raw ?? ''
    emit('patch', { assignee_id: v === '' || Number.isNaN(Number(v)) ? null : Number(v) })
  },
})

const roomCode = computed<string>({
  get: () => props.filters.room_code ?? '',
  set: (raw) => emit('patch', { room_code: raw ?? '' }),
})

const deviceCode = computed<string>({
  get: () => props.filters.asset_device_code ?? '',
  set: (raw) => emit('patch', { asset_device_code: raw ?? '' }),
})

const dueRange = computed<[string, string] | null>({
  get: (): [string, string] | null => {
    const { due_from: f, due_to: t } = props.filters
    return f && t ? [f, t] : null
  },
  set: (v: [string, string] | null) => emit('patch', { due_from: v?.[0] ?? '', due_to: v?.[1] ?? '' }),
})

const statusOptions = computed(() => WO_STATUS_FILTERS.map((s) => ({ value: s, label: woStatusLabel(s) })))
const typeOptions = computed(() => Object.entries(WO_TYPE_LABELS).map(([value, label]) => ({ value, label })))
const priorityOptions = computed(() => Object.entries(WO_PRIORITY_LABELS).map(([value, label]) => ({ value, label })))

const users = ref<User[]>([])
async function loadUsers() {
  try {
    users.value = await getUsers()
  } catch {
    users.value = []
  }
}
onMounted(() => { void loadUsers() })
</script>

<template>
  <section class="wf panel" role="search" aria-label="工单筛选">
    <div class="wf__row">
      <el-input
        v-model="q"
        class="wf__q"
        clearable
        aria-label="关键字"
        placeholder="搜索 单号 / 标题 / 描述 / 设备编号 / 房间编号"
        @input="pushQ"
        @clear="flushQ"
        @keydown.enter="flushQ"
      >
        <template #prefix><el-icon :size="16"><Search /></el-icon></template>
      </el-input>

      <el-select
        v-model="statusValue"
        class="wf__sel"
        clearable
        aria-label="工单状态"
        placeholder="全部状态"
        :value-on-clear="''"
      >
        <el-option label="全部状态" value="" />
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>

      <el-select v-model="typeValue" class="wf__sel" clearable aria-label="工单类型" placeholder="全部类型" :value-on-clear="''">
        <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>

      <el-select v-model="priorityValue" class="wf__sel" clearable aria-label="优先级" placeholder="全部优先级" :value-on-clear="''">
        <el-option v-for="o in priorityOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>

      <el-select
        v-model="assigneeValue"
        class="wf__sel"
        filterable
        clearable
        aria-label="执行人"
        placeholder="全部执行人"
        :value-on-clear="''"
      >
        <el-option label="全部执行人" value="" />
        <el-option v-for="u in users" :key="u.id" :label="u.name" :value="String(u.id)" />
      </el-select>

      <el-input v-model="roomCode" class="wf__code" clearable aria-label="房间编号" placeholder="房间编号" />

      <el-input v-model="deviceCode" class="wf__code" clearable aria-label="设备编号" placeholder="设备编号" />

      <el-date-picker
        v-model="dueRange"
        class="wf__range"
        type="daterange"
        value-format="YYYY-MM-DD"
        format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="截止起"
        end-placeholder="截止止"
        unlink-panels
        aria-label="截止时间区间"
      />

      <div class="wf__right">
        <el-button :disabled="!hasFilters" @click="emit('reset')">
          <el-icon :size="16"><RefreshLeft /></el-icon><span>重置</span>
        </el-button>
      </div>
    </div>

    <p v-if="loading" class="wf__loading" role="status">正在加载工单…</p>
  </section>
</template>

<style scoped>
.wf { flex: 0 0 auto; min-width: 0; padding: var(--space-3) var(--space-4); }
.wf__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
.wf__q { flex: 1 1 280px; min-width: 200px; }
.wf__sel { flex: 0 1 168px; min-width: 140px; }
.wf__code { flex: 0 1 148px; min-width: 120px; }
.wf__range { flex: 0 1 260px; min-width: 220px; }
.wf__right { flex: 0 0 auto; margin-left: auto; }
.wf__loading { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--accent); }

@media (max-width: 1023px) {
  .wf__sel, .wf__code, .wf__range { flex: 1 1 160px; }
  .wf__right { margin-left: 0; }
}
</style>
