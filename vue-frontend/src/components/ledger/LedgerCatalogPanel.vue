<script setup lang="ts">
/**
 * 数据表管理 · 概览面板（/asset/ledger 无 tableId 时）
 * =====================================================================
 * 所有动态资料表以卡片平铺（名称/子系统/记录数/字段数/关联覆盖率/关键键入口），
 * 支持表名搜索 + 子系统筛选 + 全表搜索；点卡片进入单表维护。
 *
 * 从 `LedgerView` 抽出以控制单文件行数（ARCHITECTURE §7 规则 2）。本组件只持有
 * 「筛选与弹窗」这类纯 UI 状态；数据由父级（`useLedgerCatalog`）传入。
 */
import { computed, ref } from 'vue'
import { Aim, Search } from '@element-plus/icons-vue'
import GlobalSearchDialog from './GlobalSearchDialog.vue'
import LedgerTableCard from './LedgerTableCard.vue'
import type { DataTable } from '@/types/asset'
import type { Subsystem } from '@/api/dict'
import type { LinkTableStat } from '@/types/assetViz'

const props = defineProps<{
  tables: DataTable[]
  subsystems: Subsystem[]
  loading: boolean
  error: string
  statMap: Map<number, LinkTableStat>
}>()

const emit = defineEmits<{
  (e: 'open', id: number): void
  (e: 'set-key', table: DataTable): void
  (e: 'jump', tableId: number, value: string): void
  (e: 'retry'): void
}>()

const q = ref('')
const subFilter = ref('all')
const gSearchOpen = ref(false)

const filteredTables = computed(() => {
  let list = props.tables
  if (subFilter.value !== 'all') list = list.filter((t) => String(t.subsystem_id) === subFilter.value)
  const kw = q.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(
    (t) =>
      t.name.toLowerCase().includes(kw) ||
      (t.code || '').toLowerCase().includes(kw) ||
      (t.subsystem_name || '').toLowerCase().includes(kw),
  )
})
</script>

<template>
  <header class="lcp__head">
    <h1 class="lcp__title">数据表管理</h1>
    <p class="lcp__sub">
      共 <span class="tnum">{{ props.tables.length }}</span> 张动态资料表 · 每张表均可直接维护行数据
      （新增 / 编辑 / 删除 / Excel 导入导出）。系统主表（设备 / 机房 / 固定资产）在各自专属页面管理。
    </p>
  </header>

  <div class="lcp__bar">
    <el-input
      v-model="q"
      class="lcp__search"
      clearable
      aria-label="搜索资料表（表名 / 代码 / 子系统）"
      placeholder="搜表名 / 代码 / 子系统…"
    >
      <template #prefix><el-icon :size="16"><Search /></el-icon></template>
    </el-input>

    <el-select v-model="subFilter" class="lcp__filter" aria-label="按子系统筛选">
      <el-option label="全部子系统" value="all" />
      <el-option
        v-for="subsystem in props.subsystems"
        :key="subsystem.id"
        :label="subsystem.name"
        :value="String(subsystem.id)"
      />
    </el-select>

    <el-button @click="gSearchOpen = true">
      <el-icon :size="16"><Aim /></el-icon>
      <span>全表搜索</span>
    </el-button>
    <span class="lcp__count">命中 <span class="tnum">{{ filteredTables.length }}</span> 张表</span>
  </div>

  <p v-if="props.error" class="lcp__warn" role="alert">
    <span>资料表加载失败：{{ props.error }}</span>
    <el-button link @click="emit('retry')">重试</el-button>
  </p>

  <p v-if="props.loading" class="lcp__hint panel">正在加载资料表目录…</p>

  <p v-else-if="filteredTables.length === 0" class="lcp__hint panel">
    <el-icon :size="24" class="lcp__hint-icon"><Search /></el-icon>
    <span>没有匹配的资料表：换个关键词，或把子系统筛选改回「全部子系统」。</span>
  </p>

  <div v-else class="lcp__grid">
    <LedgerTableCard
      v-for="item in filteredTables"
      :key="item.id"
      :table="item"
      :stat="props.statMap.get(item.id) ?? null"
      @open="emit('open', item.id)"
      @set-key="emit('set-key', item)"
    />
  </div>

  <GlobalSearchDialog v-model="gSearchOpen" @jump="(tid: number, value: string) => emit('jump', tid, value)" />
</template>

<style scoped>
.lcp__head {
  min-width: 0;
}

.lcp__title {
  margin: 0;
  font-size: var(--text-2xl);
  line-height: var(--leading-tight);
  font-weight: var(--weight-announce);
  letter-spacing: var(--tracking-display);
  color: var(--fg);
}

.lcp__sub {
  margin: var(--space-1) 0 0;
  max-width: 80ch;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.lcp__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.lcp__search {
  flex: 1 1 240px;
  max-width: 420px;
}

.lcp__filter {
  flex: 0 0 clamp(160px, 18vw, 220px);
}

.lcp__count {
  font-size: var(--text-xs);
  color: var(--muted);
}

.lcp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
  min-width: 0;
}

.lcp__hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-12) var(--space-4);
  font-size: var(--text-sm);
  color: var(--muted);
  text-align: center;
}

.lcp__hint-icon {
  color: var(--border);
}

.lcp__warn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--warn);
  border-radius: var(--radius-md);
  background: var(--warn-bg);
  color: var(--warn-fg);
  font-size: var(--text-sm);
}

@media (max-width: 1279px) {
  .lcp__title {
    font-size: var(--text-xl);
  }
}
</style>
