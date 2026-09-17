<script setup lang="ts">
/**
 * 子系统新增 / 编辑弹窗
 * =====================================================================
 * `icon` 存的是 **lucide 名**（DB 既有数据，后端/数据红线不可改），
 * 因此这里只提供受控下拉（`SUBSYSTEM_ICON_OPTIONS`），避免自由输入造出前端无法映射的值。
 * 编码是唯一键，编辑态禁改。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import assetApi from '@/api/assetApi'
import { SUBSYSTEM_ICON_OPTIONS } from '@/lib/ledgerLabels'
import type { Subsystem } from '@/api/dict'
import type { SubsystemPayload } from '@/types/asset'

const props = defineProps<{
  modelValue: boolean
  editing: Subsystem | null
  /** 新增时的默认排序位（沿用 React 版：当前子系统数 + 1） */
  nextSortOrder: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const form = ref<SubsystemPayload>({ code: '', name: '', icon: 'Zap', sort_order: 1 })
const saving = ref(false)

const isEditing = computed(() => !!props.editing)

watch(
  () => [props.modelValue, props.editing] as const,
  () => {
    if (!props.modelValue) return
    const source = props.editing
    form.value = {
      code: source?.code ?? '',
      name: source?.name ?? '',
      icon: source?.icon ?? 'Zap',
      sort_order: source?.sort_order ?? props.nextSortOrder,
    }
  },
  { immediate: true },
)

async function save() {
  const code = (form.value.code ?? '').trim()
  const name = (form.value.name ?? '').trim()
  if (!code || !name) {
    ElMessage.warning('请填写子系统编码与名称')
    return
  }
  saving.value = true
  try {
    const payload: SubsystemPayload = { ...form.value, code, name }
    if (props.editing) await assetApi.updateSubsystem(props.editing.id, payload)
    else await assetApi.createSubsystem(payload)
    ElMessage.success('子系统已保存')
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
    :title="isEditing ? '编辑子系统' : '新增子系统'"
    width="clamp(440px, 42vw, 620px)"
    top="8vh"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form label-position="top">
      <div class="sfd__grid">
        <el-form-item label="编码（唯一）">
          <el-input v-model="form.code" :disabled="isEditing" placeholder="如 lighting" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="如 照明系统" />
        </el-form-item>
        <el-form-item label="图标">
          <el-select v-model="form.icon" class="sfd__ctl">
            <el-option v-for="icon in SUBSYSTEM_ICON_OPTIONS" :key="icon" :label="icon" :value="icon" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-input v-model.number="form.sort_order" type="number" min="0" />
        </el-form-item>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sfd__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 var(--space-3);
  min-width: 0;
}

.sfd__ctl {
  width: 100%;
}

@media (max-width: 767px) {
  .sfd__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
