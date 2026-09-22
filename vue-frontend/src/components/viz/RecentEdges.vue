<script setup lang="ts">
/**
 * 最近关联边（来源可辨）—— 联动中心底部列表。
 * 自动关联用主色徽标、人工关联用中性徽标；仅自动边展示命中规则与判定证据。
 */
import { computed } from 'vue'
import { Delete, TopRight } from '@element-plus/icons-vue'
import type { RelationEdge } from '@/types/assetViz'

const props = defineProps<{ relations: RelationEdge[]; loading: boolean }>()
const emit = defineEmits<{ (e: 'delete', id: number): void }>()

const rows = computed(() =>
  props.relations.slice(0, 60).map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>
    const isAuto = String(meta.source ?? '').toLowerCase() === 'auto'
    return {
      id: r.id,
      from: r.from_code,
      to: r.to_code,
      type: r.relation_type ?? '关联',
      isAuto,
      rule: isAuto && meta.rule ? String(meta.rule) : '',
      evidence: isAuto && meta.evidence ? String(meta.evidence) : '',
    }
  }),
)
</script>

<template>
  <el-skeleton v-if="loading" :rows="4" animated />
  <div v-else-if="rows.length === 0" class="rec__empty">暂无关联边</div>
  <div v-else class="rec">
    <div v-for="r in rows" :key="r.id" class="rec__item">
      <el-tag size="small" :type="r.isAuto ? 'primary' : 'info'" effect="light">
        {{ r.isAuto ? '自动' : '人工' }}
      </el-tag>
      <span class="rec__code mono break-code">{{ r.from }}</span>
      <el-icon :size="16" class="rec__arrow"><TopRight /></el-icon>
      <span class="rec__code mono break-code">{{ r.to }}</span>
      <el-tag size="small" type="info" effect="plain">{{ r.type }}</el-tag>
      <span v-if="r.rule" class="rec__meta">规则 {{ r.rule }}</span>
      <span v-if="r.evidence" class="rec__meta ellipsis" :title="r.evidence">{{ r.evidence }}</span>
      <el-button
        link
        type="danger"
        :icon="Delete"
        class="rec__del"
        aria-label="删除关联"
        title="删除该关联"
        @click="emit('delete', r.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.rec {
  max-height: 20rem;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.rec__item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
}

.rec__item + .rec__item {
  border-top: 1px solid var(--border-soft);
}

.rec__del {
  margin-left: auto;
  flex: 0 0 auto;
}

.rec__code {
  color: var(--fg);
}

.rec__arrow {
  color: var(--meta);
}

.rec__meta {
  min-width: 0;
  color: var(--muted);
}

.rec__empty {
  padding: var(--space-6) 0;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--muted);
}
</style>
