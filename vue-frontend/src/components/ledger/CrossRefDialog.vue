<script setup lang="ts">
/**
 * 跨表字段关联弹窗
 * =====================================================================
 * 拿当前记录的编号值（关联键 / *_code 字段）到其他启用资料表搜索命中，
 * 展示「哪张表 · 哪个字段 · 几条 · 具体编号」，点编号直达目标表并按其过滤。
 *
 * 纪律：失败不给白屏——区分「加载中 / 加载失败 / 扫了但没命中」三态（UIUX §7.2）。
 */
import { ref, watch } from 'vue'
import { ArrowRight, Connection, Grid, Loading } from '@element-plus/icons-vue'
import { getCrossRefs } from '@/api/assetViz'
import type { RecordItem } from '@/types/asset'
import type { CrossRefResponse } from '@/types/assetViz'

const props = defineProps<{
  modelValue: boolean
  tableId: number
  record: RecordItem | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'jump', tableId: number, value: string): void
}>()

const data = ref<CrossRefResponse | null>(null)
const loading = ref(false)

let seq = 0

watch(
  () => [props.modelValue, props.record?.id, props.tableId] as const,
  async () => {
    if (!props.modelValue || !props.record) {
      seq += 1
      data.value = null
      loading.value = false
      return
    }
    const mine = ++seq
    loading.value = true
    data.value = null
    try {
      const result = await getCrossRefs(props.tableId, props.record.id)
      if (mine === seq) data.value = result
    } catch {
      if (mine === seq) data.value = null
    } finally {
      if (mine === seq) loading.value = false
    }
  },
)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="clamp(520px, 52vw, 780px)"
    top="8vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <span class="cfd__title">
        <el-icon :size="16" class="cfd__title-icon"><Connection /></el-icon>
        <span>跨表关联</span>
        <span v-if="data" class="cfd__title-sub">{{ data.record.table_name }} · 记录 #{{ data.record.id }}</span>
      </span>
    </template>

    <p class="cfd__desc">
      拿本条记录的编号字段值，自动到其他资料表里搜索命中；点具体编号可跳到那张表查看。
    </p>

    <div class="cfd__body">
      <p v-if="loading" class="cfd__hint" role="status">
        <el-icon :size="16" class="cfd__spin"><Loading /></el-icon>
        正在逐张资料表搜索…
      </p>

      <p v-else-if="!data" class="cfd__hint">跨表搜索失败：请关闭后重试，或确认该记录仍存在。</p>

      <template v-else>
        <div v-if="data.keys.length" class="cfd__keys">
          <el-tag v-for="key in data.keys" :key="`${key.value}-${key.key}`" size="small" effect="plain" class="cfd__key">
            <span class="mono">{{ key.label }}：{{ key.value }}</span>
          </el-tag>
        </div>

        <p v-if="data.targets.length === 0" class="cfd__hint">
          已扫描 {{ data.scanned }} 张资料表，没有命中 —— 这条记录的编号在库内没有跨表关联。
        </p>

        <ul v-else class="cfd__list">
          <li v-for="target in data.targets" :key="target.table_id" class="cfd__item">
            <div class="cfd__item-head">
              <el-icon :size="16" class="cfd__icon"><Grid /></el-icon>
              <span class="cfd__name ellipsis" :title="target.name">{{ target.name }}</span>
              <el-tag size="small" type="info" effect="light" class="tnum">{{ target.total }} 条命中</el-tag>
            </div>

            <div class="cfd__matches">
              <div v-for="match in target.matches" :key="match.field" class="cfd__match">
                <span class="cfd__mlabel">{{ match.label }} × {{ match.count }}</span>
                <button
                  v-for="value in match.values"
                  :key="value"
                  type="button"
                  class="cfd__value mono break-code"
                  :title="`拿 ${value} 到「${target.name}」查看`"
                  @click="emit('jump', target.table_id, value)"
                >
                  <span>{{ value }}</span>
                  <el-icon :size="16"><ArrowRight /></el-icon>
                </button>
              </div>
            </div>
          </li>
        </ul>

        <p class="cfd__foot">共扫描 {{ data.scanned }} 张启用资料表 · 命中 {{ data.targets.length }} 张</p>
      </template>
    </div>

    <template #footer>
      <el-button size="small" @click="emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cfd__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.cfd__title-icon {
  color: var(--accent);
}

.cfd__title-sub {
  font-size: var(--text-xs);
  font-weight: var(--weight-read);
  color: var(--muted);
}

.cfd__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.cfd__body {
  max-height: 54vh;
  overflow: auto;
  min-width: 0;
}

.cfd__hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.cfd__spin {
  color: var(--accent);
}

.cfd__keys {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-bottom: var(--space-3);
}

.cfd__key {
  max-width: 100%;
}

.cfd__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cfd__item {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  min-width: 0;
}

.cfd__item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.cfd__icon {
  color: var(--accent);
}

.cfd__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.cfd__matches {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.cfd__match {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.cfd__mlabel {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.cfd__value {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 2px var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.cfd__value:hover {
  background: var(--surface-3);
}

.cfd__foot {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--meta);
}
</style>
