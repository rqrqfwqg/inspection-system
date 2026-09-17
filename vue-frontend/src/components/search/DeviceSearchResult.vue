<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Box, InfoFilled } from '@element-plus/icons-vue'
import type { LedgerResolveCandidate, SearchBundle } from '@/types/search'

const props = defineProps<{
  /** 一次检索的三域结果（设备域渲染本组件，资料域交给 DocSearchResult） */
  bundle: SearchBundle | null
}>()

const emit = defineEmits<{
  /** 以该编号重检索（站内，不刷新页面） */
  pick: [code: string]
  /** 跳到设备台账页并把编号带上（详情抽屉深链由台账页实现） */
  'open-ledger': [code: string]
}>()

interface FieldRow {
  label: string
  text: string
  code?: boolean
}

interface RelatedRow {
  code: string
  type: string
}

const keyword = computed(() => props.bundle?.keyword ?? '')
const candidates = computed(() => props.bundle?.resolve?.candidates ?? [])
const target = computed(() => props.bundle?.result?.target ?? null)

/** 命中设备域：反查候选或 /assets/search 的 found 任一成立即算命中 */
const hit = computed(() => candidates.value.length > 0 || (props.bundle?.result?.found ?? false))

/** 跳转首选编号：设备主表编号优先，其次取反查第一条候选 */
const primaryCode = computed(
  () => target.value?.device_code || candidates.value[0]?.device_code || keyword.value,
)

function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  return ''
}

function activeText(v: boolean | null | undefined): string {
  if (v === true) return '在用'
  if (v === false) return '停用'
  return ''
}

const fields = computed<FieldRow[]>(() => {
  const t = target.value
  if (!t) return []
  const rows: FieldRow[] = [
    { label: '设备编号', text: text(t.device_code), code: true },
    { label: '设备名称', text: text(t.name) },
    { label: '所属子系统', text: text(t.subsystem_name) },
    { label: '楼栋 / 楼层', text: [text(t.building), text(t.floor)].filter(Boolean).join(' / ') },
    { label: '位置描述', text: text(t.location_desc) },
    { label: '状态', text: activeText(t.is_active) },
  ]
  return rows.filter((r) => r.text !== '')
})

function same(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase()
}

/** 关联边 → 「对方编号 + 关系类型」，按 类型|编号 去重（后端可能给双向重复边） */
const related = computed<RelatedRow[]>(() => {
  const edges = props.bundle?.result?.edges ?? []
  const base = primaryCode.value
  const seen = new Set<string>()
  const rows: RelatedRow[] = []
  for (const e of edges) {
    const other = same(e.from, base) ? e.to : e.from
    if (!other) continue
    const type = e.type || '关联'
    const key = `${type}|${other}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ code: other, type })
  }
  return rows
})

/** 已登记 / 仅资料：现场台账设备占多数，必须让用户看得见 */
function sourceText(c: LedgerResolveCandidate): string {
  return c.in_devices ? '已登记' : '仅资料'
}

function sourceType(c: LedgerResolveCandidate): 'success' | 'warning' {
  return c.in_devices ? 'success' : 'warning'
}

/** 命中依据：字段 + 匹配方式（原样透出，便于运维复核为何命中） */
function basis(c: LedgerResolveCandidate): string {
  return [c.match_field, c.match_type].filter(Boolean).join(' · ')
}

function metaText(c: LedgerResolveCandidate): string {
  return [c.name || c.asset_name, c.location || c.area].filter(Boolean).join(' · ')
}
</script>

<template>
  <section class="device panel">
    <header class="panel-head">
      <h2 class="panel-title device__title">
        <el-icon :size="16"><Box /></el-icon>
        设备域
        <el-tag v-if="hit" size="small" type="success" effect="light">已命中</el-tag>
        <el-tag v-else size="small" type="info" effect="light">未命中</el-tag>
      </h2>
      <el-tooltip
        :disabled="!!primaryCode"
        content="当前没有可跳转的编号"
        placement="top"
        :show-after="300"
        append-to-body
      >
        <span class="device__action">
          <el-button size="small" :disabled="!primaryCode" @click="emit('open-ledger', primaryCode)">
            查看台账详情
            <el-icon :size="16"><ArrowRight /></el-icon>
          </el-button>
        </span>
      </el-tooltip>
    </header>

    <div v-if="candidates.length" class="device__block">
      <p class="device__block-title">台账反查候选（{{ candidates.length }}）</p>
      <ul class="device__list">
        <li v-for="c in candidates" :key="`${c.device_code}-${c.match_type}`" class="device__row">
          <button type="button" class="device__code mono break-code" @click="emit('pick', c.device_code)">
            {{ c.device_code }}
          </button>
          <el-tag size="small" effect="light" :type="sourceType(c)">{{ sourceText(c) }}</el-tag>
          <span v-if="basis(c)" class="device__basis">{{ basis(c) }}</span>
          <span class="device__conf tnum">置信度 {{ c.confidence }}</span>
          <span v-if="metaText(c)" class="device__meta">{{ metaText(c) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="fields.length" class="device__block">
      <p class="device__block-title">设备基础信息</p>
      <dl class="device__fields">
        <div v-for="f in fields" :key="f.label" class="device__field">
          <dt>{{ f.label }}</dt>
          <dd :class="{ 'mono break-code': f.code }">{{ f.text }}</dd>
        </div>
      </dl>
    </div>

    <div v-if="related.length" class="device__block">
      <p class="device__block-title">关联设备（{{ related.length }}）：点编号即以它为起点重检索</p>
      <ul class="device__list">
        <li v-for="r in related" :key="`${r.type}-${r.code}`" class="device__row">
          <el-tag size="small" type="info" effect="plain">{{ r.type }}</el-tag>
          <button type="button" class="device__code mono break-code" @click="emit('pick', r.code)">
            {{ r.code }}
          </button>
        </li>
      </ul>
    </div>

    <div v-if="!hit && !fields.length" class="device__empty">
      <p class="device__empty-title">
        <el-icon :size="16"><InfoFilled /></el-icon>
        本轮检索未在设备域命中「{{ keyword }}」
      </p>
      <p class="device__empty-hint">
        台账反查走权威匹配内核：会从品牌型号里反解机身号，因此设备编号与它的上级电柜编号都能搜到。
        两侧都查不到时，说明该编号尚未登记，可先在数据表管理里补录后重试。
      </p>
    </div>
  </section>
</template>

<style scoped>
.device {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.device__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-lg);
}

/* tooltip 需要一个可聚焦的包裹层（禁用态按钮自身不派发指针事件） */
.device__action {
  display: inline-flex;
  flex: 0 0 auto;
}

.device__block {
  min-width: 0;
}

.device__block-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--muted);
}

.device__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 行内混排：承载长编号的子项 min-width:0，图标 / Tag 不被压缩（AC-15 / AS-10） */
.device__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border-soft);
}

.device__list > :first-child {
  border-top: 0;
}

/* 长编号强制断行而非省略（编号少一位就查不到） */
.device__code {
  flex: 1 1 200px;
  min-width: 0;
  padding: 0;
  background: none;
  border: 0;
  text-align: left;
  font-size: var(--text-sm);
  color: var(--fg);
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
  cursor: pointer;
  transition: color var(--motion-fast) var(--ease-standard);
}

.device__code:hover,
.device__code:focus-visible {
  color: var(--accent);
  text-decoration-color: currentColor;
}

.device__basis,
.device__conf,
.device__meta {
  font-size: var(--text-xs);
  color: var(--muted);
}

.device__conf {
  flex: 0 0 auto;
}

.device__meta {
  flex: 1 1 100%;
  min-width: 0;
  color: var(--fg-2);
}

.device__fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: var(--space-2) var(--space-4);
  margin: 0;
}

.device__field {
  min-width: 0;
}

.device__field dt {
  font-size: var(--text-xs);
  color: var(--muted);
}

.device__field dd {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.device__empty {
  padding: var(--space-4);
  background: var(--surface-2);
  border-radius: var(--radius-md);
}

.device__empty-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg-2);
}

.device__empty .device__empty-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: var(--leading-body);
}
</style>
