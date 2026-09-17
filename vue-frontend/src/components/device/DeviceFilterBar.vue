<script setup lang="ts">
/**
 * 台账筛选条（工具条 40px / 紧凑 32px，见 UIUX §6.2）
 * - 关键字 250ms 防抖；回车 / 清空按钮立即提交（清空后不提交会让输入框与列表不一致）
 * - 任一筛选变更由父级回到第 1 页并重新请求（AC-07），本组件不持有页码
 * - 自适应靠 flex-wrap（不写死宽度），窄档自然折行
 * - 所有 select 显式 value-on-clear=""；setter 另做空值兜底（EP 清空默认可能给 undefined）
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { RefreshLeft, Search } from '@element-plus/icons-vue'
import {
  LEDGER_PAGE_SIZES,
  LEDGER_STATE_OPTIONS,
  type AssetLedgerFacets,
  type AssetLedgerFilters,
  type AssetLedgerState,
} from '@/types/assetLedger'

interface Props {
  filters: AssetLedgerFilters
  facets: AssetLedgerFacets
  pageSize: number
  page: number
  pages: number
  total: number
  hasFilters: boolean
  loading: boolean
  /** 后端汇总里的保修预警天数（默认 90），用于「保修 N 天内到期」选项文案 */
  warrantySoonDays: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'patch', patch: Partial<AssetLedgerFilters>): void
  (e: 'reset'): void
  (e: 'page-size', size: number): void
}>()

const q = ref(props.filters.q)
let timer: number | undefined

watch(
  () => props.filters.q,
  (v) => {
    if (v !== q.value) q.value = v
  }
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

const subsystemId = computed<string>({
  get: () => (props.filters.subsystem_id === null ? '' : String(props.filters.subsystem_id)),
  set: (raw) => {
    const v = raw ?? ''
    emit('patch', { subsystem_id: v === '' || Number.isNaN(Number(v)) ? null : Number(v) })
  },
})

const area = computed<string>({
  get: () => props.filters.area ?? '',
  set: (raw) => emit('patch', { area: raw ?? '' }),
})

const useDept = computed<string>({
  get: () => props.filters.use_dept ?? '',
  set: (raw) => emit('patch', { use_dept: raw ?? '' }),
})

const stateValue = computed<AssetLedgerState | ''>({
  get: () => props.filters.state ?? '',
  set: (raw) => emit('patch', { state: raw ?? '' }),
})

const pageSizeValue = computed<number>({
  get: () => props.pageSize,
  set: (v) => emit('page-size', v),
})

const stateOptions = computed(() =>
  LEDGER_STATE_OPTIONS.map((o) =>
    o.value === 'warranty_soon' ? { value: o.value, label: `保修 ${props.warrantySoonDays} 天内到期` } : o
  )
)

const rangeText = computed(() => {
  if (props.total === 0) return '命中 0 条'
  const start = (props.page - 1) * props.pageSize + 1
  const end = Math.min(props.page * props.pageSize, props.total)
  return `命中 ${props.total.toLocaleString('zh-CN')} 条 · 当前第 ${start}-${end} 条`
})

const resetTip = computed(() =>
  props.hasFilters ? '清除全部筛选条件并回到第 1 页' : '当前没有生效的筛选条件'
)
</script>

<template>
  <section class="fbar panel" role="search" aria-label="台账筛选">
    <div class="fbar__row">
      <el-input
        v-model="q"
        class="fbar__q"
        clearable
        aria-label="关键字"
        placeholder="搜索 编号 / 名称 / 品牌型号 / 位置 / 资产代码 / 合同号 / 使用单位"
        @input="pushQ"
        @clear="flushQ"
        @keydown.enter="flushQ"
      >
        <template #prefix>
          <el-icon :size="16"><Search /></el-icon>
        </template>
      </el-input>

      <el-select
        v-model="subsystemId"
        class="fbar__sel"
        clearable
        aria-label="子系统"
        placeholder="全部子系统"
        :value-on-clear="''"
      >
        <el-option label="全部子系统" value="" />
        <el-option v-for="s in facets.subsystems" :key="s.id" :label="s.name" :value="String(s.id)" />
      </el-select>

      <el-select
        v-model="area"
        class="fbar__sel"
        clearable
        aria-label="区域"
        placeholder="全部区域"
        :value-on-clear="''"
      >
        <el-option label="全部区域" value="" />
        <el-option v-for="a in facets.areas" :key="a" :label="a" :value="a" />
      </el-select>

      <el-select
        v-model="useDept"
        class="fbar__sel"
        clearable
        aria-label="使用单位"
        placeholder="全部使用单位"
        :value-on-clear="''"
      >
        <el-option label="全部使用单位" value="" />
        <el-option v-for="d in facets.use_depts" :key="d" :label="d" :value="d" />
      </el-select>

      <el-select
        v-model="stateValue"
        class="fbar__sel"
        aria-label="资产状态"
        placeholder="全部状态"
        :value-on-clear="''"
      >
        <el-option v-for="o in stateOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>

      <div class="fbar__right">
        <el-select v-model="pageSizeValue" class="fbar__size" aria-label="每页条数">
          <el-option v-for="n in LEDGER_PAGE_SIZES" :key="n" :label="`每页 ${n} 条`" :value="n" />
        </el-select>
        <el-tooltip :content="resetTip" placement="top" :show-after="300" append-to-body>
          <span class="fbar__reset-wrap">
            <el-button :disabled="!hasFilters" @click="emit('reset')">
              <el-icon :size="16"><RefreshLeft /></el-icon>
              <span>重置</span>
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <p class="fbar__meta">
      <span class="tnum">{{ rangeText }}</span>
      <span v-if="pages > 0" class="tnum">共 {{ pages }} 页</span>
      <span v-if="loading" class="fbar__loading" role="status">正在加载台账…</span>
    </p>
  </section>
</template>

<style scoped>
.fbar {
  flex: 0 0 auto;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
}

.fbar__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

/* 关键字占满剩余，其余按内容伸缩；一律允许收缩（min-width:0）防止撑破容器 */
.fbar__q {
  flex: 1 1 300px;
  min-width: 200px;
}
.fbar__sel {
  flex: 0 1 176px;
  min-width: 148px;
}
.fbar__right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.fbar__size {
  width: 122px;
}
.fbar__reset-wrap {
  display: inline-flex;
}

.fbar__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
  min-height: 18px;
}
.fbar__loading {
  color: var(--accent);
}

@media (max-width: 1023px) {
  .fbar__sel {
    flex: 1 1 148px;
  }
  .fbar__right {
    margin-left: 0;
  }
}
</style>
