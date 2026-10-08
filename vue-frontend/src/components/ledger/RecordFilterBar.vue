<script setup lang="ts">
/**
 * 记录条件筛选条（数据表管理 · 单表视图）
 * =====================================================================
 * 用户需求：每张表都能「按字段设置查询条件」做精确/模糊匹配，
 * 且条件**可组合、可清空、结果实时刷新**。
 *
 * 设计要点：
 *  - 条件是**数据**（`RecordFilter[]`），不是一堆散落的输入框 → 天然支持组合与增删；
 *  - 「实时刷新」= 改条件后由父级防抖 400ms 调 `runFilteredSearch`，
 *    本组件**自己不发请求**（避免与 composable 的世代号竞态保护打架）；
 *  - 「为空/不为空」时**隐藏值输入框**（而不是留一个填不了也不该填的框）；
 *  - 未填完整的条件以**弱化样式**呈现，明确告诉用户「这条还没生效」——
 *    否则会出现「界面显示 3 条条件、实际只筛了 1 条」的错位。
 *
 * 红线：只用 @element-plus/icons-vue 图标、无 emoji、无渐变、颜色全走 token。
 */
import { computed } from 'vue'
import { Delete, Filter, Plus, RefreshLeft } from '@element-plus/icons-vue'
import {
  DEVICE_CODE_FIELD, FILTER_OPS, VALUELESS_OPS,
  isFilterActive, type FilterLogic, type RecordFilter,
} from '@/types/assetFilter'
import type { FieldDef } from '@/types/asset'

const props = withDefaults(
  defineProps<{
    /** 该表的字段定义（决定可筛字段）；为空表示还没加载出来 */
    fields: FieldDef[]
    filters: RecordFilter[]
    logic: FilterLogic
    /** 已填完整、真正生效的条件数 */
    activeCount: number
    /** 命中条数（用于「条件 → 结果」的即时反馈） */
    resultCount: number
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{
  (e: 'add', field?: string): void
  (e: 'remove', index: number): void
  (e: 'update:field', payload: { index: number; field: string }): void
  (e: 'update:op', payload: { index: number; op: RecordFilter['op'] }): void
  (e: 'update:value', payload: { index: number; value: string }): void
  (e: 'update:logic', logic: FilterLogic): void
  (e: 'clear'): void
}>()

/** 可选字段：关联键 + 该表全部字段（label 优先，回落到 key） */
const fieldOptions = computed(() => {
  const opts = [{ value: DEVICE_CODE_FIELD, label: '关联键' }]
  for (const f of props.fields) {
    if (!f.key) continue
    opts.push({ value: f.key, label: f.label || f.key })
  }
  return opts
})

/** 算子下拉项（键序即显示序） */
const opOptions = computed(() =>
  (Object.keys(FILTER_OPS) as RecordFilter['op'][]).map((op) => ({
    value: op,
    label: FILTER_OPS[op],
  })),
)

function fieldLabel(key: string): string {
  return fieldOptions.value.find((o) => o.value === key)?.label ?? key
}

function opLabel(op: RecordFilter['op']): string {
  return FILTER_OPS[op] ?? op
}

function needsValue(op: RecordFilter['op']): boolean {
  return !VALUELESS_OPS.includes(op)
}

/** 未填完整的条件：不生效，用弱化样式标出来 */
function isPending(f: RecordFilter): boolean {
  return !isFilterActive(f)
}

const hasAny = computed(() => props.filters.length > 0)

const summary = computed(() => {
  const parts = props.filters.map((f) => {
    const val = needsValue(f.op) ? `「${f.value.trim() || '…'}」` : ''
    return `${fieldLabel(f.field)} ${opLabel(f.op)}${val}`
  })
  return parts.join(props.logic === 'and' ? ' 且 ' : ' 或 ')
})

/** 上限与后端一致（record_filters.MAX_CONDITIONS），超了就不再让加 */
const MAX = 20
const canAdd = computed(() => props.filters.length < MAX)
</script>

<template>
  <section class="rf panel" aria-label="记录条件筛选">
    <header class="rf__head">
      <el-icon :size="16" class="rf__icon"><Filter /></el-icon>
      <span class="rf__title">条件筛选</span>

      <!-- AND / OR 切换：仅 2 条以上条件时出现（1 条无组合可言） -->
      <el-radio-group
        v-if="filters.length >= 2"
        :model-value="logic"
        size="small"
        aria-label="条件组合方式"
        @update:model-value="(v: string) => emit('update:logic', v as FilterLogic)"
      >
        <el-radio-button value="and">全部满足</el-radio-button>
        <el-radio-button value="or">任一满足</el-radio-button>
      </el-radio-group>

      <span v-if="hasAny" class="rf__count tnum" role="status">
        <template v-if="loading">筛选中…</template>
        <template v-else>
          命中 <span class="tnum">{{ resultCount }}</span> 条<template v-if="activeCount < filters.length">
            （{{ filters.length - activeCount }} 条未填完，暂未生效）</template>
        </template>
      </span>
      <span v-else class="rf__count rf__count--muted">未设条件，显示全部</span>

      <span class="rf__spacer" />

      <el-button size="small" :disabled="!canAdd" @click="emit('add')">
        <el-icon :size="16"><Plus /></el-icon>
        <span>添加条件</span>
      </el-button>
      <el-button size="small" :disabled="!hasAny" @click="emit('clear')">
        <el-icon :size="16"><RefreshLeft /></el-icon>
        <span>清空条件</span>
      </el-button>
    </header>

    <!-- 条件列表：每行 = 字段 + 匹配方式 + 值 + 删除 -->
    <ul v-if="hasAny" class="rf__list">
      <li
        v-for="(f, i) in filters"
        :key="i"
        class="rf__row"
        :class="{ 'rf__row--pending': isPending(f) }"
      >
        <span class="rf__join" aria-hidden="true">{{ i === 0 ? '当' : (logic === 'and' ? '且' : '或') }}</span>

        <el-select
          :model-value="f.field"
          size="small"
          class="rf__field"
          aria-label="筛选字段"
          placeholder="选择字段"
          @update:model-value="(v: string) => emit('update:field', { index: i, field: v })"
        >
          <el-option v-for="o in fieldOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>

        <el-select
          :model-value="f.op"
          size="small"
          class="rf__op"
          aria-label="匹配方式"
          @update:model-value="(v: string) => emit('update:op', { index: i, op: v as RecordFilter['op'] })"
        >
          <el-option v-for="o in opOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>

        <!-- 「为空/不为空」不需要值：不渲染输入框，避免留一个填了也没用的空框 -->
        <el-input
          v-if="needsValue(f.op)"
          :model-value="f.value"
          size="small"
          class="rf__value"
          clearable
          :aria-label="`${fieldLabel(f.field)} ${opLabel(f.op)} 的值`"
          :placeholder="`填入要${opLabel(f.op)}的内容`"
          @update:model-value="(v: string) => emit('update:value', { index: i, value: v })"
        />
        <span v-else class="rf__novalue">不需要填值</span>

        <el-button
          size="small"
          link
          type="danger"
          :aria-label="`删除条件：${fieldLabel(f.field)} ${opLabel(f.op)}`"
          title="删除这条条件"
          @click="emit('remove', i)"
        >
          <el-icon :size="16"><Delete /></el-icon>
        </el-button>
      </li>
    </ul>

    <!-- 条件摘要：折叠态下一句话说清「现在按什么筛」，排查时不用逐条读 -->
    <p v-if="hasAny" class="rf__summary" role="note">
      <span class="rf__summary-label">当前条件</span>
      <span class="rf__summary-text">{{ summary || '（全部条件尚未填完）' }}</span>
    </p>

    <p v-if="!hasAny" class="rf__hint">
      点「添加条件」按字段设置查询：支持包含 / 开头是 / 结尾是 / 等于 / 不等于 / 为空 / 不为空；
      多条条件可切换「全部满足」或「任一满足」。改动后自动刷新结果。
    </p>
  </section>
</template>

<style scoped>
.rf {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  min-width: 0;
}

.rf__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.rf__icon {
  color: var(--muted);
}

.rf__title {
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
  white-space: nowrap;
}

.rf__count {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.rf__count--muted {
  color: var(--muted);
}

/* 把剩余空间推给右侧按钮组；条件多时按钮仍靠右 */
.rf__spacer {
  flex: 1 1 auto;
  min-width: 0;
}

.rf__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.rf__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

/* 未填完整的条件：整体弱化 + 虚线边，直观说明「这条还没生效」 */
.rf__row--pending {
  border-style: dashed;
  background: transparent;
}

.rf__row--pending .rf__field,
.rf__row--pending .rf__op,
.rf__row--pending .rf__value {
  opacity: 0.62;
}

.rf__join {
  flex: 0 0 auto;
  min-width: 1.4em;
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
}

.rf__field {
  flex: 0 1 190px;
  min-width: 140px;
}

.rf__op {
  flex: 0 1 132px;
  min-width: 110px;
}

.rf__value {
  flex: 1 1 220px;
  min-width: 160px;
}

.rf__novalue {
  flex: 1 1 220px;
  font-size: var(--text-xs);
  color: var(--muted);
}

.rf__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal, 1.6);
}

.rf__summary-label {
  flex: 0 0 auto;
  color: var(--muted);
}

.rf__summary-text {
  color: var(--fg-2);
  word-break: break-word;
}

.rf__hint {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal, 1.6);
  color: var(--muted);
}
</style>