<script setup lang="ts">
/**
 * 待人工关联（无法自动关联）面板 —— 联动中心的兜底操作台。
 * 内聚表单状态与候选点击；请求编排（建边 / 刷新）仍由 LinkCenterTab 负责。
 */
import { ref } from 'vue'
import { Refresh, User } from '@element-plus/icons-vue'
import ManualAssociateForm from '@/components/viz/ManualAssociateForm.vue'
import { fmtInt } from '@/lib/format'
import type { ManualQueueResponse } from '@/types/assetViz'

const props = defineProps<{
  queue: ManualQueueResponse | null
  loading: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', p: { from: string; to: string; relationType: string; note: string }): void
  (e: 'refresh'): void
}>()

const formFrom = ref('')
const formTo = ref('')

function pickSuggestion(code: string, target: string) {
  formFrom.value = code
  formTo.value = target
}

function sampleText(s: Record<string, unknown> | null): string {
  if (!s) return ''
  return Object.entries(s).slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join('；')
}
</script>

<template>
  <section class="mqp panel">
    <header class="panel-head">
      <h3 class="panel-title mqp__title">
        <el-icon :size="16"><User /></el-icon>
        <span>待人工关联（无法自动关联）</span>
      </h3>
      <el-button size="small" :loading="props.loading" @click="emit('refresh')">
        <el-icon v-if="!props.loading" :size="16"><Refresh /></el-icon>
        <span>刷新</span>
      </el-button>
    </header>
    <p class="mqp__desc">
      这些编号在设备台账与机房表中都找不到对应。桌面可在此建边；现场可用小程序「扫码关联」直接扫两端编号建边，
      写入结果与这里完全一致（均标记为人工关联）。
    </p>

    <ManualAssociateForm
      v-model:from="formFrom"
      v-model:to="formTo"
      :busy="props.busy"
      @submit="emit('submit', $event)"
    />

    <el-skeleton v-if="props.loading" :rows="4" animated />
    <div v-else class="mqp__queue">
      <div class="mqp__head">
        <span>未解析编号 TOP（共 {{ fmtInt(queue?.total_unresolved_codes) }} 个）</span>
        <span>{{ queue?.items.length || 0 }} 条待处理</span>
      </div>
      <div class="mqp__body">
        <div v-for="it in queue?.items ?? []" :key="it.code" class="mqp__item">
          <div class="mqp__row">
            <span class="mono mqp__code">{{ it.code }}</span>
            <el-tag size="small" type="info" effect="light" class="tnum">{{ it.records }} 条记录</el-tag>
            <el-tag v-for="t in it.tables.slice(0, 3)" :key="t.table_id" size="small" type="info" effect="plain">
              {{ t.name }}
            </el-tag>
            <span v-if="it.tables.length > 3" class="mqp__muted">+{{ it.tables.length - 3 }}</span>
          </div>
          <p v-if="sampleText(it.sample)" class="mqp__sample ellipsis" :title="sampleText(it.sample)">
            {{ sampleText(it.sample) }}
          </p>
          <div class="mqp__row">
            <span class="mqp__muted">候选：</span>
            <span v-if="it.suggestions.length === 0" class="mqp__muted">无相近编号，需现场确认</span>
            <el-button
              v-for="s in it.suggestions"
              :key="s.code"
              size="small"
              :disabled="props.busy"
              :title="`${s.reason}（${s.kind === 'device' ? '设备' : '机房'}）`"
              @click="pickSuggestion(s.code, it.code)"
            >
              {{ s.code }}
              <span class="mqp__muted">{{ s.kind === 'device' ? '设备' : '机房' }}</span>
            </el-button>
          </div>
        </div>
        <div v-if="(queue?.items ?? []).length === 0" class="mqp__muted mqp__empty">
          暂无待人工关联的编号
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mqp__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.mqp__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.mqp__muted {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.mqp__queue {
  margin-top: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.mqp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.mqp__body {
  max-height: 24rem;
  overflow-y: auto;
}

.mqp__item {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.mqp__item + .mqp__item {
  border-top: 1px solid var(--border-soft);
}

.mqp__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.mqp__code {
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.mqp__sample {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.mqp__empty {
  padding: var(--space-6) 0;
  text-align: center;
}
</style>
