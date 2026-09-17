<script setup lang="ts">
/**
 * 字段定义新增 / 编辑弹窗
 * =====================================================================
 * 字段 key 是系统标识（建表后不建议改，编辑态禁改）；label 是展示名称。
 * 两个布尔语义要分清：`is_relation_key` 决定记录挂到哪个设备（全表唯一）；
 * `is_search_key` 只表示该字段取值可到其他表检索（可多选，不影响挂载与统计）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import assetApi from '@/api/assetApi'
import { FIELD_TYPE_LABELS, FIELD_TYPE_OPTIONS } from '@/lib/ledgerLabels'
import type { FieldDef, FieldPayload, FieldType } from '@/types/asset'

const props = defineProps<{
  modelValue: boolean
  tableId: number
  editing: FieldDef | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const form = ref({
  key: '',
  label: '',
  type: 'text' as FieldType,
  options: '',
  is_required: false,
  is_relation_key: false,
  is_search_key: false,
})

const saving = ref(false)

const isEditing = computed(() => !!props.editing)

function reset() {
  const source = props.editing
  form.value = {
    key: source?.key ?? '',
    label: source?.label ?? '',
    type: source?.type ?? 'text',
    options: (source?.options ?? []).join(','),
    is_required: source?.is_required ?? false,
    is_relation_key: source?.is_relation_key ?? false,
    is_search_key: !!source?.is_search_key,
  }
}

watch(() => [props.modelValue, props.editing] as const, () => {
  if (props.modelValue) reset()
}, { immediate: true })

async function save() {
  const key = form.value.key.trim()
  const label = form.value.label.trim()
  if (!key || !label) {
    ElMessage.warning('请填写字段 key 与展示名称')
    return
  }
  saving.value = true
  try {
    const payload: FieldPayload = {
      table_id: props.tableId,
      key,
      label,
      type: form.value.type,
      options:
        form.value.type === 'select'
          ? form.value.options.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
      is_required: form.value.is_required,
      is_relation_key: form.value.is_relation_key,
      is_search_key: form.value.is_search_key,
    }
    if (props.editing) await assetApi.updateField(props.tableId, props.editing.id, payload)
    else await assetApi.createField(props.tableId, payload)
    ElMessage.success('字段已保存')
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEditing ? '编辑字段' : '新增字段'"
    width="clamp(440px, 42vw, 620px)"
    top="8vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form label-position="top">
      <div class="ffd__grid">
        <el-form-item label="字段 key（系统标识）">
          <el-input v-model="form.key" :disabled="isEditing" placeholder="如 rated_power" />
        </el-form-item>
        <el-form-item label="展示名称">
          <el-input v-model="form.label" placeholder="如 额定功率" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" class="ffd__ctl">
            <el-option
              v-for="type in FIELD_TYPE_OPTIONS"
              :key="type"
              :label="FIELD_TYPE_LABELS[type]"
              :value="type"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="选项（单选，逗号分隔）">
          <el-input
            v-model="form.options"
            :disabled="form.type !== 'select'"
            placeholder="LED,荧光"
          />
        </el-form-item>
      </div>

      <div class="ffd__flags">
        <label class="ffd__flag">
          <input v-model="form.is_required" type="checkbox" class="ffd__cb" />
          <span>必填</span>
        </label>
        <label class="ffd__flag" title="该字段值写入 records.device_code，决定记录挂到哪台设备（全表唯一）">
          <input v-model="form.is_relation_key" type="checkbox" class="ffd__cb" />
          <span>作为关联键（设备编号）</span>
        </label>
        <label class="ffd__flag" title="标记后该字段取值会作为钥匙到其他表检索，不影响记录挂载与台账统计">
          <input v-model="form.is_search_key" type="checkbox" class="ffd__cb" />
          <span>作为跨表检索钥匙</span>
        </label>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ffd__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--space-3);
  min-width: 0;
}

.ffd__ctl {
  width: 100%;
}

.ffd__flags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  min-width: 0;
}

.ffd__flag {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--fg);
  cursor: pointer;
}

.ffd__cb {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

@media (max-width: 767px) {
  .ffd__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
