<script setup lang="ts">
/**
 * 记录跨表转移（按字段映射）
 * =====================================================================
 * 场景：早期分类把部分设备放进了错误的子系统 / 资料表，需要成批挪到正确的表。
 * 两表字段定义不一致时先给自动映射建议（同名 / 名称归一 / 关联键 / 包含 / 同类型），
 * 允许人工逐字段改；未映射字段可选「丢弃 / 合并到备注 / 保留为扩展信息」；
 * 执行前一律先 dry-run 预览将新建 / 更新 / 跳过各多少条。
 *
 * 纪律：
 *  - 预览 300ms 防抖，参数一变就重算（React 版同口径）；干跑失败只清预览，不阻塞执行；
 *  - 移动是不可逆操作，执行前 `ElMessageBox` 二次确认并说明影响面（UIUX §6.6）；
 *  - 映射表与预览拆为子组件，本文件只留参数与编排。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, Switch } from '@element-plus/icons-vue'
import assetApi from '@/api/assetApi'
import TransferMappingList from './TransferMappingList.vue'
import TransferParamSelects from './TransferParamSelects.vue'
import TransferPreviewPanel from './TransferPreviewPanel.vue'
import type { DataTable, TransferMapping, TransferResult } from '@/types/asset'

const props = defineProps<{
  modelValue: boolean
  sourceTable: DataTable | null
  recordIds: number[]
  tables: DataTable[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'done', result: TransferResult): void
}>()

const targetId = ref('')
const mapping = ref<Record<string, string | null>>({})
const policy = ref<'drop' | 'remark' | 'extra'>('extra')
const remarkKey = ref('')
const mode = ref<'move' | 'copy'>('move')
const conflict = ref<'skip' | 'update' | 'duplicate'>('skip')

const suggestion = ref<TransferMapping | null>(null)
const preview = ref<TransferResult | null>(null)
const loadingMapping = ref(false)
const previewing = ref(false)
const running = ref(false)

const candidates = computed(() => props.tables.filter((t) => t.id !== props.sourceTable?.id))

const requiredGaps = computed(
  () => (suggestion.value?.unfilled_targets ?? []).filter((t) => t.required).map((t) => t.label),
)

const canRun = computed(
  () => !!targetId.value && !loadingMapping.value && !running.value && props.recordIds.length > 0,
)

function reset() {
  targetId.value = ''
  mapping.value = {}
  policy.value = 'extra'
  remarkKey.value = ''
  mode.value = 'move'
  conflict.value = 'skip'
  suggestion.value = null
  preview.value = null
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
    else preview.value = null
  },
)

/** 选目标表 → 拉映射建议并初始化映射 */
watch(targetId, async (value) => {
  const source = props.sourceTable
  if (!value || !source) {
    suggestion.value = null
    return
  }
  loadingMapping.value = true
  try {
    const result = await assetApi.getTransferMapping(source.id, Number(value))
    suggestion.value = result
    const init: Record<string, string | null> = {}
    for (const match of result.matches) init[match.source_key] = match.target_key
    mapping.value = init
    remarkKey.value = result.remark_candidates[0]?.key ?? ''
  } catch (e) {
    suggestion.value = null
    ElMessage.error(e instanceof Error ? e.message : '获取字段映射失败')
  } finally {
    loadingMapping.value = false
  }
})

/** 参与者任一变化 → 300ms 防抖干跑 */
const paramKey = computed(() =>
  JSON.stringify([
    props.modelValue, targetId.value, mapping.value, policy.value,
    remarkKey.value, mode.value, conflict.value, props.recordIds,
  ]),
)

let timer: number | undefined

function stopTimer() {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
}

async function runPreview() {
  const source = props.sourceTable
  if (!source || !targetId.value || props.recordIds.length === 0) return
  previewing.value = true
  try {
    preview.value = await assetApi.transferRecords(source.id, {
      target_table_id: Number(targetId.value),
      record_ids: props.recordIds,
      mapping: mapping.value,
      unmapped_policy: policy.value,
      remark_target_key: policy.value === 'remark' ? remarkKey.value : null,
      mode: mode.value,
      on_conflict: conflict.value,
      dry_run: true,
    })
  } catch {
    preview.value = null
  } finally {
    previewing.value = false
  }
}

watch(paramKey, () => {
  stopTimer()
  if (!props.modelValue || !props.sourceTable || !targetId.value || props.recordIds.length === 0) {
    preview.value = null
    return
  }
  timer = window.setTimeout(() => void runPreview(), 300)
})

onUnmounted(stopTimer)

function onMappingChange(sourceKey: string, targetKey: string | null) {
  mapping.value = { ...mapping.value, [sourceKey]: targetKey }
}

async function run() {
  const source = props.sourceTable
  if (!source || !targetId.value) return
  if (mode.value === 'move') {
    try {
      await ElMessageBox.confirm(
        `将移动 ${props.recordIds.length} 条记录到「${candidates.value.find((t) => String(t.id) === targetId.value)?.name ?? targetId.value}」，`
        + '移动后**源表不再保留**这些记录（资料本身不会丢失）。',
        '确认移动',
        { type: 'warning', confirmButtonText: '确认移动', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  running.value = true
  try {
    const result = await assetApi.transferRecords(source.id, {
      target_table_id: Number(targetId.value),
      record_ids: props.recordIds,
      mapping: mapping.value,
      unmapped_policy: policy.value,
      remark_target_key: policy.value === 'remark' ? remarkKey.value : null,
      mode: mode.value,
      on_conflict: conflict.value,
      dry_run: false,
    })
    emit('update:modelValue', false)
    emit('done', result)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '转移失败')
  } finally {
    running.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="clamp(560px, 62vw, 1000px)"
    top="8vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <span class="trd__title">
        <el-icon :size="16" class="trd__title-icon"><Switch /></el-icon>
        <span>数据转移（按字段映射）</span>
      </span>
    </template>

    <div class="trd__body">
      <TransferParamSelects
        :target-id="targetId"
        :mode="mode"
        :conflict="conflict"
        :candidates="candidates"
        @update:target-id="targetId = $event"
        @update:mode="mode = $event"
        @update:conflict="conflict = $event"
      />

      <p class="trd__scope">
        已选 <span class="trd__strong tnum">{{ recordIds.length }}</span> 条记录，从
        <span class="trd__strong">{{ sourceTable?.name }}</span> 转移。
      </p>

      <p v-if="!targetId" class="trd__hint">请先选择目标资料表，系统会自动给出字段映射建议。</p>

      <p v-else-if="loadingMapping" class="trd__hint" role="status">
        <el-icon :size="16" class="trd__spin"><Loading /></el-icon>
        正在计算字段映射…
      </p>

      <template v-else-if="suggestion">
        <TransferMappingList
          :suggestion="suggestion"
          :mapping="mapping"
          @change="onMappingChange"
        />

        <div class="trd__params">
          <label class="trd__param">
            <span class="trd__plabel">未被映射的源字段</span>
            <el-select v-model="policy" class="trd__ctl">
              <el-option label="保留为扩展信息（推荐，不丢失）" value="extra" />
              <el-option label="合并写入文本字段" value="remark" />
              <el-option label="丢弃" value="drop" />
            </el-select>
          </label>

          <label v-if="policy === 'remark'" class="trd__param">
            <span class="trd__plabel">合并到目标字段</span>
            <el-select v-model="remarkKey" class="trd__ctl" placeholder="选择文本字段">
              <el-option
                v-for="candidate in suggestion.remark_candidates"
                :key="candidate.key"
                :label="candidate.label"
                :value="candidate.key"
              />
            </el-select>
          </label>
        </div>

        <TransferPreviewPanel
          :previewing="previewing"
          :preview="preview"
          :required-gaps="requiredGaps"
        />
      </template>

      <p v-else class="trd__hint">
        未能获取该目标表的字段映射：请换一张目标表重试，或确认两张表的字段定义是否完整。
      </p>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="running" :disabled="!canRun" @click="run">
        {{ mode === 'move' ? '移动' : '复制' }} {{ recordIds.length }} 条
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.trd__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.trd__title-icon {
  color: var(--accent);
}

.trd__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: 62vh;
  overflow: auto;
  min-width: 0;
}

.trd__params {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  min-width: 0;
}

/* 三列参数：窄档自然折行，不写死宽度（AS-8：宽度用 % / clamp，不用 px） */
.trd__param {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1 1 220px;
  min-width: 0;
}

.trd__plabel {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.trd__ctl {
  width: 100%;
}

.trd__scope {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.trd__strong {
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.trd__hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-2) 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.trd__spin {
  color: var(--accent);
}
</style>
