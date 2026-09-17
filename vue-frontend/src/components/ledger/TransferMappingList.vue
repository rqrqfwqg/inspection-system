<script setup lang="ts">
/**
 * 字段映射行列表（转移弹窗的映射表部分）
 * =====================================================================
 * 每行：源字段（label + key）→ 目标字段下拉 → 置信度标记 → 判定依据。
 * 拆出独立文件的原因：映射表是弹窗里唯一有真实复杂度的区块（下拉候选需去重合并
 * 「未填目标字段」与「已被占用的目标字段」），与弹窗的参数/预览/执行逻辑分开放。
 *
 * 纪律：目标候选按 key 去重后渲染 —— React 版直接 concat 会造出重复的 option key。
 */
import { computed } from 'vue'
import { Switch } from '@element-plus/icons-vue'
import { transferConfidence } from '@/lib/ledgerLabels'
import type { TransferMapping } from '@/types/asset'

/** 「不转移」哨兵值：null 在 option 里无法表达，故单独占位 */
const NONE = '__none__'

const props = defineProps<{
  suggestion: TransferMapping
  mapping: Record<string, string | null>
}>()

const emit = defineEmits<{
  (e: 'change', sourceKey: string, targetKey: string | null): void
}>()

/** 目标字段候选：未填目标（可能必填）优先，再补上已被占用的目标字段，按 key 去重 */
const targetOptions = computed(() => {
  const merged = new Map<string, { key: string; label: string; required: boolean }>()
  for (const target of props.suggestion.unfilled_targets) {
    merged.set(target.key, { key: target.key, label: target.label, required: !!target.required })
  }
  for (const match of props.suggestion.matches) {
    if (!match.target_key || merged.has(match.target_key)) continue
    merged.set(match.target_key, {
      key: match.target_key,
      label: match.target_label || match.target_key,
      required: false,
    })
  }
  return [...merged.values()]
})

const mappedCount = computed(
  () => Object.values(props.mapping).filter((value) => value && value !== NONE).length,
)

function valueOf(sourceKey: string): string {
  return props.mapping[sourceKey] ?? NONE
}

function onPick(sourceKey: string, picked: string) {
  emit('change', sourceKey, picked === NONE ? null : picked)
}
</script>

<template>
  <div class="tmap">
    <header class="tmap__head">
      <span>字段映射（可手工调整）</span>
      <span class="tnum">已映射 {{ mappedCount }} / {{ suggestion.matches.length }} 个源字段</span>
    </header>

    <div class="tmap__rows">
      <div v-for="match in suggestion.matches" :key="match.source_key" class="tmap__row">
        <span class="tmap__src">
          <span class="tmap__label ellipsis" :title="match.source_label">{{ match.source_label }}</span>
          <span class="tmap__key mono ellipsis" :title="match.source_key">{{ match.source_key }}</span>
        </span>

        <el-icon :size="16" class="tmap__arrow"><Switch /></el-icon>

        <el-select
          class="tmap__select"
          size="small"
          :model-value="valueOf(match.source_key)"
          aria-label="目标字段"
          @update:model-value="onPick(match.source_key, $event)"
        >
          <el-option :label="'不转移'" :value="NONE" />
          <el-option
            v-for="option in targetOptions"
            :key="option.key"
            :label="option.required ? `${option.label}（必填）` : option.label"
            :value="option.key"
          />
        </el-select>

        <el-tag size="small" effect="plain" :type="transferConfidence(match.confidence).tone">
          {{ transferConfidence(match.confidence).text }}
        </el-tag>

        <span class="tmap__reason ellipsis" :title="match.reason">{{ match.reason }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tmap {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
  min-width: 0;
}

.tmap__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-soft);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.tmap__rows {
  min-width: 0;
}

.tmap__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}

.tmap__row:last-child {
  border-bottom: none;
}

.tmap__src {
  flex: 0 0 168px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.tmap__label {
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.tmap__key {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.tmap__arrow {
  flex: 0 0 auto;
  color: var(--meta);
}

.tmap__select {
  flex: 0 1 200px;
  min-width: 140px;
}

.tmap__reason {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

@media (max-width: 1279px) {
  .tmap__row {
    flex-wrap: wrap;
  }

  .tmap__src {
    flex: 1 1 100%;
  }

  .tmap__reason {
    flex: 1 1 100%;
  }
}
</style>
