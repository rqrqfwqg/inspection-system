<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Document, Files, InfoFilled } from '@element-plus/icons-vue'
import type { GlobalSearchTable, SearchGroup, SearchBundle, SearchTableGroup } from '@/types/search'

const props = defineProps<{
  /** 一次检索的三域结果（资料域渲染本组件，设备域交给 DeviceSearchResult） */
  bundle: SearchBundle | null
}>()

const emit = defineEmits<{
  /** 以该编号重检索（资料记录里出现的编号同样能当检索起点） */
  pick: [code: string]
  /** 跳到某张资料表并带上关键词做行内筛选（该路由二期实现筛选，一期只保证带参可达） */
  'open-table': [tableId: number, keyword: string]
}>()

/** 模板里一律使用非空值，避免在模板中做可空链式访问 */
const tables = computed<GlobalSearchTable[]>(() => props.bundle?.global?.results ?? [])
const hitTables = computed(() => props.bundle?.global?.tables_hit ?? 0)
const hitRecords = computed(() => props.bundle?.global?.total_hits ?? 0)
const query = computed(() => props.bundle?.global?.query || props.bundle?.keyword || '')
const groups = computed<SearchGroup[]>(() => props.bundle?.result?.groups ?? [])
const totalRecords = computed(() => props.bundle?.result?.total_records ?? 0)
const keyword = computed(() => props.bundle?.keyword ?? '')

/** 命中资料域：全局搜索有表命中，或设备聚合返回了跨子系统资料明细 */
const hit = computed(() => hitTables.value > 0 || groups.value.length > 0)

/** 每张表最多展示 3 条样例，避免长列表把页面拉成瀑布 */
function samplesOf(t: GlobalSearchTable) {
  return (t.samples ?? []).slice(0, 3).map((s) => ({
    id: s.id,
    code: s.device_code ?? '',
    fields: s.fields ?? [],
  }))
}

function recordCount(t: SearchTableGroup): number {
  return Array.isArray(t.records) ? t.records.length : 0
}

function subLabel(g: SearchGroup): string {
  return g.subsystem_name || g.subsystem_code || '未归子系统'
}
</script>

<template>
  <section class="doc panel">
    <header class="panel-head">
      <h2 class="panel-title doc__title">
        <el-icon :size="16"><Document /></el-icon>
        资料域
        <el-tag v-if="hit" size="small" type="success" effect="light">已命中</el-tag>
        <el-tag v-else size="small" type="info" effect="light">未命中</el-tag>
      </h2>
      <p class="doc__summary">
        <span class="tnum">{{ hitTables }} 张表</span>
        <span class="doc__dot">·</span>
        <span class="tnum">{{ hitRecords }} 条记录</span>
      </p>
    </header>

    <div v-if="tables.length" class="doc__block">
      <p class="doc__block-title">命中资料表</p>
      <ul class="doc__list">
        <li v-for="t in tables" :key="t.table_id" class="doc__table">
          <div class="doc__table-head">
            <el-icon :size="16" class="doc__table-icon"><Files /></el-icon>
            <span class="doc__table-name">{{ t.name }}</span>
            <el-tag v-if="t.subsystem_name" size="small" type="info" effect="plain">
              {{ t.subsystem_name }}
            </el-tag>
            <span class="doc__hits tnum">{{ t.hit_count }} 条命中</span>
          </div>

          <div v-for="s in samplesOf(t)" :key="s.id" class="doc__sample">
            <span class="doc__sample-id mono">#{{ s.id }}</span>
            <button
              v-if="s.code"
              type="button"
              class="doc__code mono break-code"
              @click="emit('pick', s.code)"
            >
              {{ s.code }}
            </button>
            <span v-for="(f, fi) in s.fields" :key="`${s.id}-${fi}`" class="doc__chip">
              <span class="doc__chip-label">{{ f.label }}</span>
              <span class="doc__chip-value break-code">{{ f.value }}</span>
            </span>
          </div>

          <div class="doc__table-foot">
            <el-button size="small" @click="emit('open-table', t.table_id, query)">
              进入并筛选 {{ t.hit_count }} 条
              <el-icon :size="16"><ArrowRight /></el-icon>
            </el-button>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="groups.length" class="doc__block">
      <p class="doc__block-title">
        跨子系统资料明细：共 {{ totalRecords }} 条记录，涉及 {{ groups.length }} 个子系统
      </p>
      <div v-for="g in groups" :key="g.subsystem_code || 'none'" class="doc__group">
        <p class="doc__group-title">{{ subLabel(g) }}</p>
        <ul class="doc__list">
          <li v-for="t in g.tables" :key="t.table_id" class="doc__group-row">
            <span class="doc__table-name">{{ t.table_name }}</span>
            <span class="doc__hits tnum">{{ recordCount(t) }} 条</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="!hit" class="doc__empty">
      <p class="doc__empty-title">
        <el-icon :size="16"><InfoFilled /></el-icon>
        资料域未命中「{{ keyword }}」
      </p>
      <p class="doc__empty-hint">
        已对全部启用资料表做过模糊匹配，并按台账反查过资料域编号。
        若确知它属于某张资料表，可在数据表管理里按该表筛选查看，或改用更短的编号片段重试。
      </p>
    </div>
  </section>
</template>

<style scoped>
.doc {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.doc__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-lg);
}

.doc__summary {
  flex: 0 0 auto;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.doc__dot {
  padding: 0 var(--space-1);
}

.doc__block {
  min-width: 0;
}

.doc__block-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--muted);
}

.doc__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.doc__table {
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border-soft);
}

.doc__list > :first-child {
  border-top: 0;
}

/* 行内混排：编号 / 表名承载长文本，必须 min-width:0（AC-15） */
.doc__table-head,
.doc__sample,
.doc__group-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.doc__table-head {
  margin-bottom: var(--space-2);
}

.doc__table-icon {
  color: var(--muted);
}

.doc__table-name {
  flex: 1 1 160px;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
  word-break: break-word;
}

.doc__hits {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.doc__sample {
  align-items: flex-start;
  padding: var(--space-1) 0;
}

.doc__sample-id {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--meta);
}

/* 长编号强制断行，禁止省略（编号少一位就查不到） */
.doc__code {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0;
  background: none;
  border: 0;
  text-align: left;
  font-size: var(--text-xs);
  color: var(--fg);
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color var(--motion-fast) var(--ease-standard);
}

.doc__code:hover,
.doc__code:focus-visible {
  color: var(--accent);
  text-decoration-color: currentColor;
}

.doc__chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
  max-width: 100%;
  min-width: 0;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.doc__chip-label {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.doc__chip-value {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.doc__table-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.doc__group {
  margin-top: var(--space-2);
}

.doc__group-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-emphasize);
  color: var(--fg-2);
}

.doc__group-row {
  padding: var(--space-1) 0;
}

.doc__empty {
  padding: var(--space-4);
  background: var(--surface-2);
  border-radius: var(--radius-md);
}

.doc__empty-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg-2);
}

.doc__empty .doc__empty-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: var(--leading-body);
}
</style>
