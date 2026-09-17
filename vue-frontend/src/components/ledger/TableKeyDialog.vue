<script setup lang="ts">
/**
 * 关键键设置弹窗（数据表管理 / 单表页头 / 资料配置三处入口共用）
 * =====================================================================
 * 一张资料表有两个「钥匙」概念，在此一处集中修改：
 *  - 关联键（单选）：该字段值写入 `records.device_code`，决定记录挂到哪台设备 / 机房。
 *    全表唯一；换字段后后端会**自动重算已有记录的 device_code**（空值保持原样）。
 *  - 跨表检索键（多选）：该字段取值可到其他资料表做关联检索（不改挂载、不影响统计）。
 *
 * 保存策略：只提交与初始快照不同的字段（diff），并把「非关联键改动」排在关联键之前
 * —— 避免关联键改动的重算覆盖同批次的检索键标记。
 *
 * 纪律：字段列表（含勾选与警示）由 `TableKeyFieldList` 承接，本文件只做加载 / diff / 提交。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Key, Loading } from '@element-plus/icons-vue'
import assetApi from '@/api/assetApi'
import TableKeyFieldList from './TableKeyFieldList.vue'
import type { FieldDef } from '@/types/asset'

const props = defineProps<{
  modelValue: boolean
  tableId: number
  tableName?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const fields = ref<FieldDef[]>([])
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const relId = ref<number | null>(null)
const searchIds = ref<number[]>([])
const snapshotRelId = ref<number | null>(null)
const snapshotSearchIds = ref<number[]>([])

let seq = 0

watch(
  () => [props.modelValue, props.tableId] as const,
  async () => {
    if (!props.modelValue) return
    const mine = ++seq
    loading.value = true
    errorText.value = ''
    fields.value = []
    relId.value = null
    searchIds.value = []
    snapshotRelId.value = null
    snapshotSearchIds.value = []
    try {
      const list = await assetApi.listFields(props.tableId)
      if (mine !== seq) return
      fields.value = list
      relId.value = list.find((f) => f.is_relation_key)?.id ?? null
      searchIds.value = list.filter((f) => f.is_search_key).map((f) => f.id)
      snapshotRelId.value = relId.value
      snapshotSearchIds.value = [...searchIds.value]
    } catch {
      if (mine === seq) errorText.value = '字段加载失败：请关闭弹窗后重试'
    } finally {
      if (mine === seq) loading.value = false
    }
  },
)

interface FieldChange {
  fieldId: number
  payload: { is_relation_key?: boolean; is_search_key?: boolean }
}

const changed = computed<FieldChange[]>(() => {
  const list: FieldChange[] = []
  for (const field of fields.value) {
    const payload: FieldChange['payload'] = {}
    if ((snapshotRelId.value === field.id) !== (relId.value === field.id)) {
      payload.is_relation_key = relId.value === field.id
    }
    const wasSearch = snapshotSearchIds.value.includes(field.id)
    const isSearch = searchIds.value.includes(field.id)
    if (wasSearch !== isSearch) payload.is_search_key = isSearch
    if (payload.is_relation_key !== undefined || payload.is_search_key !== undefined) {
      list.push({ fieldId: field.id, payload })
    }
  }
  return list
})

const relationKeyChanged = computed(
  () => snapshotRelId.value !== relId.value && relId.value !== null,
)

function toggleRelation(fieldId: number) {
  relId.value = relId.value === fieldId ? null : fieldId
}

function toggleSearch(fieldId: number) {
  searchIds.value = searchIds.value.includes(fieldId)
    ? searchIds.value.filter((id) => id !== fieldId)
    : [...searchIds.value, fieldId]
}

async function save() {
  if (changed.value.length === 0) {
    emit('update:modelValue', false)
    return
  }
  saving.value = true
  errorText.value = ''
  try {
    // 关联键放最后：它触发后端重算 device_code，不应打断同批次的检索键标记
    const ordered = [...changed.value].sort(
      (a, b) => (a.payload.is_relation_key ? 1 : 0) - (b.payload.is_relation_key ? 1 : 0),
    )
    for (const item of ordered) {
      await assetApi.updateField(props.tableId, item.fieldId, item.payload)
    }
    ElMessage.success(`关键键已更新：共提交 ${ordered.length} 处改动`)
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : '保存失败：部分字段可能未生效，请重试'
  } finally {
    saving.value = false
  }
}
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
      <span class="tkd__title">
        <el-icon :size="16" class="tkd__title-icon"><Key /></el-icon>
        <span>关键键设置</span>
        <span v-if="tableName" class="tkd__title-sub ellipsis">{{ tableName }}</span>
      </span>
    </template>

    <p class="tkd__desc">
      关联键决定记录挂到哪台设备 / 机房（全表唯一，改后后端自动重算已有记录）；
      跨表检索键用于到其他资料表做关联检索（可多选，不影响挂载与台账统计）。
    </p>

    <div class="tkd__body">
      <p v-if="loading" class="tkd__hint" role="status">
        <el-icon :size="16" class="tkd__spin"><Loading /></el-icon>
        正在加载字段…
      </p>

      <TableKeyFieldList
        v-else-if="fields.length > 0"
        :fields="fields"
        :table-id="tableId"
        :rel-id="relId"
        :search-ids="searchIds"
        :relation-key-changed="relationKeyChanged"
        @toggle-relation="toggleRelation"
        @toggle-search="toggleSearch"
      />

      <p v-else class="tkd__hint">
        该表还没有字段定义：请先到「资料配置」为该表新增字段，再回来设置关联键。
      </p>

      <p v-if="errorText" class="tkd__error" role="alert">{{ errorText }}</p>
    </div>

    <template #footer>
      <span class="tkd__foot-tip">
        {{ changed.length > 0 ? `将提交 ${changed.length} 处改动` : '没有改动' }}
      </span>
      <el-button :disabled="saving" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.tkd__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.tkd__title-icon {
  color: var(--accent);
}

.tkd__title-sub {
  min-width: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-read);
  color: var(--muted);
}

.tkd__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.tkd__body {
  max-height: 54vh;
  overflow: auto;
  min-width: 0;
}

.tkd__hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-4) 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.tkd__spin {
  color: var(--accent);
}

.tkd__error {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--danger-fg);
}

.tkd__foot-tip {
  float: left;
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
