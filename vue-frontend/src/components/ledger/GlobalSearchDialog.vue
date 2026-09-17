<script setup lang="ts">
/**
 * 全局资料表搜索弹窗
 * =====================================================================
 * 对每一张启用资料表都搜一遍（GET /assets/link/global-search，**参数名是 q**），
 * 列出「命中哪些表 · 各命中几条 · 命中记录样例」，点「进入并筛选」跳到该表并预填行内搜索框。
 *
 * 纪律：打开时清空上一次结果（否则会把旧结果当成新查询的输出）；空结果给引导文案而非空白（AC-11）。
 */
import { nextTick, ref, watch } from 'vue'
import { Aim, ArrowRight, Grid, Search } from '@element-plus/icons-vue'
import { globalSearch } from '@/api/search'
import type { GlobalSearchResponse } from '@/types/search'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    initialQuery?: string
  }>(),
  { initialQuery: '' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'jump', tableId: number, value: string): void
}>()

const input = ref('')
const data = ref<GlobalSearchResponse | null>(null)
const loading = ref(false)
const searched = ref(false)
const inputRef = ref<{ focus: () => void } | null>(null)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    input.value = props.initialQuery
    data.value = null
    searched.value = false
    await nextTick()
    inputRef.value?.focus()
  },
)

async function run(term: string) {
  const keyword = term.trim()
  if (!keyword) return
  loading.value = true
  data.value = null
  try {
    data.value = await globalSearch(keyword)
  } catch {
    data.value = null
  } finally {
    loading.value = false
    searched.value = true
  }
}

function jump(tableId: number) {
  const keyword = data.value?.query ?? input.value.trim()
  emit('update:modelValue', false)
  emit('jump', tableId, keyword)
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="全局资料表搜索"
    width="clamp(520px, 52vw, 780px)"
    top="8vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="gsd__desc">
      对每一张启用资料表都搜一遍：输入任意编号 / 关键词，立刻看到它散落在哪些表、各命中几条。
    </p>

    <div class="gsd__bar">
      <el-input
        ref="inputRef"
        v-model="input"
        clearable
        class="gsd__q"
        aria-label="全局资料表检索关键词"
        placeholder="输入编号 / 关键词，例如 WP-B2D4ATx4、5SN9-7…"
        @keydown.enter="run(input)"
      >
        <template #prefix><el-icon :size="16"><Search /></el-icon></template>
      </el-input>
      <el-button type="primary" :loading="loading" :disabled="!input.trim()" @click="run(input)">
        全部搜索
      </el-button>
    </div>

    <div class="gsd__body">
      <p v-if="loading" class="gsd__hint" role="status">
        <el-icon :size="16" class="gsd__spin"><Aim /></el-icon>
        正在逐张资料表搜索…
      </p>

      <p v-else-if="!searched" class="gsd__hint">
        输入一个编号或关键词，点「全部搜索」即可跨所有资料表检索。
      </p>

      <template v-else-if="data">
        <p class="gsd__meta">
          <el-tag size="small" type="info" effect="light" class="tnum">{{ data.tables_hit }} 张表命中</el-tag>
          <el-tag size="small" type="info" effect="plain" class="tnum">{{ data.total_hits }} 条记录</el-tag>
          <span>关键词「{{ data.query }}」</span>
        </p>

        <p v-if="data.tables_hit === 0" class="gsd__hint">
          已搜索全部启用资料表，没有任何记录命中 —— 请更换关键词，或确认该编号是否已录入。
        </p>

        <ul v-else class="gsd__list">
          <li v-for="table in data.results" :key="table.table_id" class="gsd__item">
            <div class="gsd__item-head">
              <el-icon :size="16" class="gsd__icon"><Grid /></el-icon>
              <span class="gsd__name ellipsis" :title="table.name">{{ table.name }}</span>
              <el-tag v-if="table.subsystem_name" size="small" effect="plain">{{ table.subsystem_name }}</el-tag>
              <el-tag size="small" type="info" effect="light" class="tnum">{{ table.hit_count }} 条命中</el-tag>
            </div>

            <ul class="gsd__samples">
              <li v-for="sample in table.samples" :key="sample.id" class="gsd__sample">
                <span class="gsd__sid mono">#{{ sample.id }}</span>
                <span v-for="(field, index) in sample.fields" :key="index" class="gsd__field">
                  <span class="gsd__flabel">{{ field.label }}</span>
                  <span class="gsd__fvalue mono break-code">{{ field.value }}</span>
                </span>
              </li>
            </ul>

            <div class="gsd__item-foot">
              <el-button size="small" @click="jump(table.table_id)">
                <span>进入并筛选 {{ table.hit_count }} 条</span>
                <el-icon :size="16"><ArrowRight /></el-icon>
              </el-button>
            </div>
          </li>
        </ul>
      </template>

      <p v-else class="gsd__hint">搜索失败：请检查网络后重试，或缩小关键词范围。</p>
    </div>
  </el-dialog>
</template>

<style scoped>
.gsd__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.gsd__bar {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
}

.gsd__q {
  flex: 1 1 auto;
  min-width: 0;
}

.gsd__body {
  margin-top: var(--space-3);
  max-height: 52vh;
  overflow: auto;
  min-width: 0;
}

.gsd__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.gsd__hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.gsd__spin {
  color: var(--accent);
}

.gsd__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.gsd__item {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  min-width: 0;
}

.gsd__item-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.gsd__icon {
  color: var(--accent);
}

.gsd__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.gsd__samples {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.gsd__sample {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-xs);
}

.gsd__sid {
  flex: 0 0 auto;
  color: var(--muted);
}

.gsd__field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  padding: 2px var(--space-1);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.gsd__flabel {
  flex: 0 0 auto;
  color: var(--muted);
}

.gsd__fvalue {
  color: var(--fg-2);
}

.gsd__item-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}
</style>
