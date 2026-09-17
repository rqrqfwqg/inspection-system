<script setup lang="ts">
/**
 * 自动关联（预先关联）面板 —— 联动中心第一大块。
 * 只做**确定性编号等值匹配**（不做模糊猜测）：先预览候选（dry_run），执行后按批次可整批回滚。
 * 自环剔除如实呈现，不静默丢弃；每条规则都带判定依据（可解释）。
 * 本组件为纯展示 + 事件上抛（状态与请求编排在 LinkCenterTab）。
 */
import { computed } from 'vue'
import {
  CircleCheck, MagicStick, Refresh, RefreshLeft, VideoPlay, View, WarnTriangleFilled,
} from '@element-plus/icons-vue'
import AutoPreviewList from '@/components/viz/AutoPreviewList.vue'
import { fmtInt } from '@/lib/format'
import type {
  AutoAssociatePreview, AutoAssociateResult, AutoRulesResponse, LinkRelationsBySource,
} from '@/types/assetViz'

const props = defineProps<{
  loading: boolean
  rules: AutoRulesResponse | null
  src: LinkRelationsBySource | null
  preview: AutoAssociatePreview | null
  lastBatch: AutoAssociateResult | null
  busy: string | null
}>()

const emit = defineEmits<{
  (e: 'preview'): void
  (e: 'apply', ruleIds?: string[]): void
  (e: 'rollback', opts: { batch?: string; rule?: string }): void
}>()

const ruleList = computed(() => props.rules?.rules ?? [])
const selfLoopSamples = computed(() =>
  (props.rules?.skipped_sample ?? []).slice(0, 3).map((s) => s.from_code).join('、'),
)
const batchRules = computed(() =>
  Object.entries(props.lastBatch?.by_rule ?? {}).map(([k, v]) => `${k} ${v}`).join(' · '),
)
const libRuleText = computed(() =>
  Object.entries(props.src?.auto_by_rule ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—',
)

function domainText(domain: string): string {
  return domain === 'records' ? '资料域编号' : domain
}
</script>

<template>
  <section class="aap panel">
    <header class="panel-head aap__head">
      <div class="aap__intro">
        <h3 class="panel-title aap__title">
          <el-icon :size="16" class="aap__title-icon"><MagicStick /></el-icon>
          <span>自动关联（预先关联）</span>
        </h3>
        <p class="aap__desc">
          只做<b>确定性编号等值匹配</b>，不做模糊猜测；每条候选都带判定证据，先预览再执行，
          执行结果按批次可整批回滚。
        </p>
      </div>
      <div class="aap__actions">
        <el-button size="small" :disabled="!!busy" @click="emit('preview')">
          <el-icon :size="16" :class="{ 'is-loading': busy === 'preview' }">
            <Refresh v-if="busy === 'preview'" /><View v-else />
          </el-icon>
          <span>预览候选</span>
        </el-button>
        <el-button size="small" type="primary" :disabled="!!busy || !rules?.total_pending" @click="emit('apply')">
          <el-icon :size="16"><VideoPlay /></el-icon>
          <span>执行全部（{{ fmtInt(rules?.total_pending) }}）</span>
        </el-button>
      </div>
    </header>

    <el-skeleton v-if="loading" :rows="4" animated />

    <div v-else class="aap__body">
      <div class="aap__rules">
        <div v-for="r in ruleList" :key="r.id" class="aap__rule">
          <div class="aap__rule-head">
            <span class="aap__rule-name">
              {{ r.name }}
              <el-tag size="small" type="primary" effect="light">{{ r.relation_type }}</el-tag>
            </span>
            <el-button
              size="small"
              text
              type="primary"
              :disabled="!!busy || !r.pending"
              @click="emit('apply', [r.id])"
            >
              <el-icon :size="16" :class="{ 'is-loading': busy === r.id }">
                <Refresh v-if="busy === r.id" /><VideoPlay v-else />
              </el-icon>
              <span>执行 {{ r.pending }}</span>
            </el-button>
          </div>
          <p class="aap__rule-basis">{{ r.basis }}</p>
          <div class="aap__rule-stats">
            <span>候选 <b class="tnum">{{ fmtInt(r.candidates) }}</b></span>
            <span class="aap__pending">待建 <b class="tnum">{{ fmtInt(r.pending) }}</b></span>
            <span class="aap__muted">已存在 {{ fmtInt(r.already_linked) }}</span>
            <el-tag size="small" type="info" effect="plain">{{ domainText(r.domain) }}</el-tag>
          </div>
        </div>
      </div>

      <div v-if="rules?.skipped_self_loop" class="aap__warn">
        <p class="aap__warn-head">
          <el-icon :size="16"><WarnTriangleFilled /></el-icon>
          <span>已剔除 {{ rules.skipped_self_loop }} 条「自己连自己」的候选</span>
        </p>
        <p class="aap__warn-text">
          原因：同一编号同时存在于电柜表与配电箱表，两端同号建边无意义。例：{{ selfLoopSamples }}
        </p>
      </div>

      <AutoPreviewList v-if="preview" :preview="preview" />

      <div v-if="lastBatch" class="aap__batch">
        <el-icon :size="16" class="aap__batch-icon"><CircleCheck /></el-icon>
        <span>本次批次 <b class="mono">{{ lastBatch.batch }}</b> 新建 <b class="tnum">{{ lastBatch.created }}</b> 条</span>
        <span class="aap__muted">{{ batchRules }}</span>
        <el-button
          size="small"
          class="aap__batch-undo"
          :disabled="!!busy"
          @click="emit('rollback', { batch: lastBatch.batch })"
        >
          <el-icon :size="16"><RefreshLeft /></el-icon>
          <span>撤销本批</span>
        </el-button>
      </div>

      <div v-if="src?.auto" class="aap__lib">
        <span>库内自动关联 {{ fmtInt(src.auto) }} 条</span>
        <span>按规则：{{ libRuleText }}</span>
        <el-button size="small" type="danger" text :disabled="!!busy" @click="emit('rollback', {})">
          <el-icon :size="16"><RefreshLeft /></el-icon>
          <span>全部回滚</span>
        </el-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.aap {
  min-width: 0;
}

.aap__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.aap__intro {
  min-width: 0;
}

.aap__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.aap__title-icon {
  color: var(--info);
}

.aap__desc {
  margin: var(--space-1) 0 0;
  max-width: 76ch;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.aap__actions {
  display: inline-flex;
  gap: var(--space-2);
  flex: 0 0 auto;
}

.aap__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.aap__rules {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.aap__rule {
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.aap__rule-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.aap__rule-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.aap__rule-basis {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.aap__rule-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.aap__pending {
  color: var(--info-fg);
}

.aap__muted {
  font-size: var(--text-xs);
  color: var(--muted);
}

.aap__warn {
  padding: var(--space-3);
  border: 1px solid var(--warn);
  border-radius: var(--radius-md);
  background: var(--warn-bg);
}

.aap__warn-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-emphasize);
  color: var(--warn-fg);
}

.aap__warn-text {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--warn-fg);
}

.aap__batch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
}

.aap__batch-icon {
  color: var(--success);
}

.aap__batch-undo {
  margin-left: auto;
}

.aap__lib {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

@media (max-width: 1279px) {
  .aap__rules {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
