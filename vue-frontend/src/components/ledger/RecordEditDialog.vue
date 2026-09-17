<script setup lang="ts">
/**
 * 记录新增 / 编辑弹窗
 * =====================================================================
 * 字段由 `field_defs` 动态生成：text/number/date → el-input，select → el-select，device_ref 同文本。
 *
 * 行为要点（与 React 版逐条等价）：
 *  - 「序号(seq)」新增时不手填（隐藏输入框，非关联键，留空不影响跨表联动）；编辑时保留，便于修正导入数据；
 *  - 设备编号（关联键）可单独填写；留空则取关联键字段的值；
 *  - 表单在每次打开时按 `initial` 重建，避免上一次的残留值被误提交。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import assetApi from '@/api/assetApi'
import type { FieldDef, RecordItem } from '@/types/asset'

const props = defineProps<{
  modelValue: boolean
  tableId: number
  fields: FieldDef[]
  initial: RecordItem | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const form = ref<Record<string, string>>({})
const deviceCode = ref('')
const saving = ref(false)

const relationField = computed(
  () =>
    props.fields.find((f) => f.is_relation_key) ??
    props.fields.find((f) => f.type === 'device_ref') ??
    null,
)

const visibleFields = computed(() =>
  props.initial ? props.fields : props.fields.filter((f) => f.key !== 'seq'),
)

watch(
  () => [props.modelValue, props.initial, props.fields] as const,
  () => {
    if (!props.modelValue) return
    const next: Record<string, string> = {}
    for (const field of props.fields) {
      const value = props.initial?.data?.[field.key]
      next[field.key] = value === null || value === undefined ? '' : String(value)
    }
    form.value = next
    deviceCode.value = props.initial?.device_code ?? ''
  },
  { immediate: true },
)

function inputType(field: FieldDef): string {
  if (field.type === 'number') return 'number'
  if (field.type === 'date') return 'date'
  return 'text'
}

async function save() {
  saving.value = true
  try {
    const payload: { data: Record<string, unknown>; device_code?: string } = {
      data: { ...form.value },
    }
    const explicit = deviceCode.value.trim()
    if (explicit) payload.device_code = explicit
    else if (relationField.value) payload.device_code = form.value[relationField.value.key] || undefined

    if (props.initial) await assetApi.updateRecord(props.tableId, props.initial.id, payload)
    else await assetApi.createRecord(props.tableId, payload)

    ElMessage.success(props.initial ? '记录已更新' : '记录已新增')
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
    :title="initial ? '编辑记录' : '新增记录'"
    width="clamp(480px, 46vw, 700px)"
    top="8vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="red__desc">
      关联键字段（设备编号）决定这条资料挂到哪台设备 / 机房；留空则自动取关联键字段的值。
    </p>

    <el-form class="red__form" label-position="top">
      <el-form-item v-if="relationField" :label="`${relationField.label}（关联键 / 设备编号）`">
        <el-input v-model="deviceCode" clearable placeholder="可留空，将取关联键字段的值" />
      </el-form-item>

      <el-form-item
        v-for="field in visibleFields"
        :key="field.id"
        :label="field.is_required ? `${field.label} *` : field.label"
      >
        <el-select
          v-if="field.type === 'select'"
          v-model="form[field.key]"
          class="red__ctl"
          clearable
          placeholder="请选择"
        >
          <el-option v-for="option in field.options" :key="option" :label="option" :value="option" />
        </el-select>
        <el-input
          v-else
          v-model="form[field.key]"
          class="red__ctl"
          clearable
          :type="inputType(field)"
        />
      </el-form-item>
    </el-form>

    <p v-if="fields.length === 0" class="red__empty">
      该表还没有字段定义：请先到「资料配置」为这张表新增字段，否则记录无法填写。
    </p>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.red__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.red__form {
  max-height: 54vh;
  overflow: auto;
  padding-right: var(--space-1);
}

.red__ctl {
  width: 100%;
}

.red__empty {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}
</style>
