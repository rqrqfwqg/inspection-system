<script setup lang="ts">
/**
 * 设备详情抽屉（右滑 el-drawer，宽度 min(92vw,480px) —— 百分比/函数式，不写死 px，AS-8）
 * - 打开状态由 URL ?code= 驱动（AC-09 深链直达），本组件只反映 props
 * - 明细按「固定资产 / 设备主表 / 设备档案 / 跨表台账记录 / 关联设备」分组
 * - 台账记录的表单字段中文名由本地字典映射（只用 SPEC §5.1 的 4 个端点，不额外请求字段定义）
 * - 长编号走 .break-code（禁止省略号），金额与表格同口径（fmtMoney）
 */
import { computed, ref, watch } from 'vue'
import { ArrowDown, ArrowRight, Refresh, WarningFilled } from '@element-plus/icons-vue'
import {
  LEDGER_SOURCE_LABELS, fmtInt, fmtMoney, fmtValue, hasDisplayValue, isCodeLike, ledgerFieldLabel,
  type AssetLedgerDetail, type AssetLedgerRecordItem,
} from '@/types/assetLedger'

interface Props {
  modelValue: boolean
  code: string
  detail: AssetLedgerDetail | null
  loading: boolean
  error: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'open-code', code: string): void
  (e: 'retry'): void
}>()

interface Entry { key: string; label: string; value: string; code: boolean }
interface Section { title: string; entries: Entry[] }
interface RecordGroup { tableId: number; tableName: string; subsystem: string; items: AssetLedgerRecordItem[] }

/** 金额类字段统一走 fmtMoney，避免同一含税价在表格与抽屉里两种写法 */
const MONEY_KEY = /price|value|amount|tax|fee/i

function entryValue(key: string, v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v) && MONEY_KEY.test(key)) return fmtMoney(v)
  return fmtValue(v)
}

function entriesOf(dict: Record<string, unknown> | null | undefined): Entry[] {
  if (!dict) return []
  return Object.entries(dict)
    .filter(([, v]) => hasDisplayValue(v))
    .map(([k, v]) => ({ key: k, label: ledgerFieldLabel(k), value: entryValue(k, v), code: isCodeLike(k) }))
}

const title = computed(() => {
  const d = props.detail
  const fa = d?.fixed_asset
  const assetName = fa ? String(fa.asset_name ?? '').trim() : ''
  return assetName || d?.device?.name || props.code || '资产详情'
})

const sections = computed<Section[]>(() => {
  const d = props.detail
  if (!d) return []
  const dev = d.device as unknown as Record<string, unknown> | null
  const groups: [string, Record<string, unknown> | null][] = [
    ['固定资产', d.fixed_asset],
    ['设备主表', dev],
    ['设备档案', d.archive],
  ]
  return groups.map(([t, dict]) => ({ title: t, entries: entriesOf(dict) })).filter((s) => s.entries.length > 0)
})

const groups = computed<RecordGroup[]>(() => {
  const map = new Map<number, RecordGroup>()
  for (const r of props.detail?.records ?? []) {
    const g = map.get(r.table_id) ?? {
      tableId: r.table_id,
      tableName: r.table_name || `资料表 #${r.table_id}`,
      subsystem: r.subsystem_name || '',
      items: [],
    }
    g.items.push(r)
    map.set(r.table_id, g)
  }
  return [...map.values()]
})

const meta = computed(() => {
  const d = props.detail
  if (!d) return []
  return [
    { label: '子系统', value: d.device?.subsystem_name || '未登记设备主表' },
    { label: '区域', value: d.area || '未标注' },
    { label: '台账记录', value: `${fmtInt(d.record_count)} 条` },
    { label: '关联设备', value: `${fmtInt(d.relations.length)} 条` },
    { label: '数据来源', value: LEDGER_SOURCE_LABELS[d.source ?? ''] ?? '现场台账' },
  ]
})

/** 记录分组默认展开，点击收起（避免长抽屉里翻找） */
const collapsed = ref<Record<string, boolean>>({})
const isOpen = (key: string) => collapsed.value[key] !== true
function toggle(key: string) { collapsed.value = { ...collapsed.value, [key]: isOpen(key) } }

watch(() => props.code, () => { collapsed.value = {} })

const keepOpen = (v: boolean) => { emit('update:modelValue', v) }
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    direction="rtl"
    size="min(92vw, 480px)"
    append-to-body
    :title="title"
    @close="keepOpen(false)"
  >
    <template #header>
      <div class="dhead">
        <span class="dhead__title" role="heading" aria-level="2">{{ loading ? '正在读取设备档案…' : title }}</span>
        <span v-if="code" class="dhead__code mono break-code">{{ code }}</span>
        <span v-if="detail?.source === 'ledger_only'" class="dhead__tags">
          <el-tag size="small" type="warning" effect="light">仅台账 · 未登记</el-tag>
        </span>
        <span v-if="detail?.area" class="dhead__tags">
          <el-tag size="small" type="info" effect="plain">{{ detail.area }}</el-tag>
        </span>
      </div>
    </template>

    <div class="dbody">
      <el-skeleton v-if="loading" :rows="8" animated />

      <div v-else-if="error" class="dstate" role="alert">
        <el-icon :size="24" class="dstate__icon dstate__icon--error"><WarningFilled /></el-icon>
        <p class="dstate__title">详情加载失败</p>
        <p class="dstate__desc">{{ error }}</p>
        <el-button type="primary" plain @click="emit('retry')">
          <el-icon :size="16"><Refresh /></el-icon><span>重试</span>
        </el-button>
      </div>

      <el-empty v-else-if="!detail || !detail.found" :image-size="80">
        <template #description>
          <p class="dstate__title">未找到编号 {{ code }} 的资产信息</p>
          <p class="dstate__desc">
            该编号既未登记进设备主表，也不在任何现场台账表中。若这是实物机身编码，请到「资料检索」用机身编码反查。
          </p>
        </template>
      </el-empty>

      <div v-else class="dcontent">
        <el-descriptions :column="1" size="small" border :label-width="96">
          <el-descriptions-item v-for="m in meta" :key="m.label" :label="m.label">{{ m.value }}</el-descriptions-item>
        </el-descriptions>

        <section v-for="s in sections" :key="s.title" class="dsec">
          <h4 class="dsec__title">{{ s.title }}</h4>
          <el-descriptions :column="1" size="small" border :label-width="96">
            <el-descriptions-item v-for="e in s.entries" :key="e.key" :label="e.label">
              <span :class="e.code ? 'mono break-code' : ''">{{ e.value }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </section>

        <section v-if="groups.length" class="dsec">
          <h4 class="dsec__title">台账记录（{{ detail.record_count }} 条 · 跨 {{ groups.length }} 张资料表）</h4>
          <div v-for="g in groups" :key="g.tableId" class="dgrp">
            <button type="button" class="dgrp__head" :aria-expanded="isOpen(String(g.tableId))" @click="toggle(String(g.tableId))">
              <el-icon :size="16" class="dgrp__caret">
                <ArrowDown v-if="isOpen(String(g.tableId))" />
                <ArrowRight v-else />
              </el-icon>
              <span class="dgrp__name ellipsis">{{ g.tableName }}</span>
              <span class="dgrp__meta tnum">{{ g.subsystem ? g.subsystem + ' · ' : '' }}{{ g.items.length }} 条</span>
            </button>
            <div v-show="isOpen(String(g.tableId))" class="dgrp__body">
              <el-descriptions v-for="item in g.items" :key="item.record_id" :column="1" size="small" border :label-width="96" class="dgrp__item">
                <el-descriptions-item v-for="e in entriesOf(item.data)" :key="e.key" :label="e.label">
                  <span :class="e.code ? 'mono break-code' : ''">{{ e.value }}</span>
                </el-descriptions-item>
              </el-descriptions>
            </div>
          </div>
        </section>

        <section v-if="detail.relations.length" class="dsec">
          <h4 class="dsec__title">关联设备（{{ detail.relations.length }} 条）</h4>
          <ul class="drel">
            <li v-for="r in detail.relations" :key="r.relation_id" class="drel__item">
              <el-tag size="small" effect="light" :type="r.direction === 'out' ? 'primary' : 'info'">
                {{ r.direction === 'out' ? '下游' : '上游' }}
              </el-tag>
              <span class="drel__type">{{ r.relation_type || '关联' }}</span>
              <button type="button" class="link-btn mono break-code" @click="emit('open-code', r.other_code)">{{ r.other_code }}</button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.dhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); min-width: 0; }
.dhead__title { font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }
.dhead__code { font-size: var(--text-sm); color: var(--fg-2); }
.dhead__tags { display: inline-flex; flex: 0 0 auto; }

.dbody { min-width: 0; }
.dcontent { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.dsec { min-width: 0; }
.dsec__title { margin: 0 0 var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }

/* 抽屉内一律单列描述列表；长值 word-break 由 break-code 承担 */
.dbody :deep(.el-descriptions__label) { font-size: var(--text-xs); color: var(--fg-2); }
.dbody :deep(.el-descriptions__content) { font-size: var(--text-sm); word-break: break-word; }

.dgrp { border: 1px solid var(--border-soft); border-radius: var(--radius-md); margin-bottom: var(--space-2); overflow: hidden; }
.dgrp__head { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2) var(--space-3); border: none; background: var(--surface-2); cursor: pointer; text-align: left; min-width: 0; }
.dgrp__head:hover { background: var(--surface-3); }
.dgrp__head:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.dgrp__caret { color: var(--fg-2); }
.dgrp__name { flex: 1 1 auto; font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }
.dgrp__meta { flex: 0 0 auto; font-size: var(--text-xs); color: var(--muted); }
.dgrp__body { padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.dgrp__item { border-radius: var(--radius-sm); }

.drel { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.drel__item { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-2); border: 1px solid var(--border-soft); border-radius: var(--radius-sm); }
.drel__type { flex: 0 0 auto; font-size: var(--text-xs); color: var(--fg-2); }
.link-btn { flex: 1 1 auto; min-width: 0; padding: 0; border: none; background: none; color: var(--accent); font-size: var(--text-xs); cursor: pointer; text-align: left; }
.link-btn:hover { text-decoration: underline; }
.link-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }

.dstate { display: flex; flex-direction: column; align-items: center; text-align: center; padding: var(--space-5) var(--space-3); }
.dstate__icon { color: var(--muted); }
.dstate__icon--error { color: var(--danger); }
.dstate__title { margin: var(--space-2) 0 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.dstate__desc { margin: var(--space-1) auto var(--space-3); max-width: 56ch; font-size: var(--text-sm); line-height: var(--leading-body); color: var(--fg-2); }
</style>
