<script setup lang="ts">
/**
 * 派单弹窗（列表页与详情页共用 —— UIUX 页面 3）
 * =====================================================================
 * 字段：执行人 assignee_id（必填，可搜索）/ 截止时间 due_at（必填，默认 = 现在 + 4 小时）/ 派单备注。
 * 校验：空执行人 → inline「请选择执行人」；due_at 早于当前 → inline「截止时间不能早于当前时间」。
 * 提交中按钮 loading（父级 busy 透传）；成功后父级关闭本弹窗并就地更新行状态。
 * 宽度：≥1024 480px；<768 由 tokens.css 的 `.el-drawer/.el-dialog` 规则兜底（不覆盖）。
 */
import { computed, ref, watch } from 'vue'
import { getUsers } from '@/api/users'
import { fmtBeijingUtc } from '@/lib/format'
import type { User } from '@/types/user'
import type { WorkOrder } from '@/types/workOrder'

const props = defineProps<{
  modelValue: boolean
  wo?: WorkOrder | null
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'submit', payload: { assignee_id: number; due_at?: string; note?: string }): void
}>()

const users = ref<User[]>([])
const usersLoading = ref(false)
const assigneeId = ref<number | null>(null)
const dueAt = ref<string>('')
const note = ref('')
const error = ref('')

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function pad(n: number): string { return String(n).padStart(2, '0') }

/** 现在 + 4 小时（本地时间），格式与 el-date-picker 的 value-format 对齐 */
function defaultDueAt(hoursAhead = 4): string {
  const d = new Date(Date.now() + hoursAhead * 3600 * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

const dueAtHint = computed(() => (dueAt.value ? `北京时间 ${fmtBeijingUtc(dueAt.value)}` : ''))

async function loadUsers() {
  if (users.value.length || usersLoading.value) return
  usersLoading.value = true
  try {
    users.value = await getUsers()
  } catch {
    users.value = []
  } finally {
    usersLoading.value = false
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    error.value = ''
    assigneeId.value = props.wo?.assignee_id ?? null
    note.value = ''
    dueAt.value = props.wo?.due_at ? props.wo.due_at.slice(0, 19) : defaultDueAt()
    void loadUsers()
  },
)

function submit() {
  if (props.busy) return
  if (assigneeId.value === null) {
    error.value = '请选择执行人'
    return
  }
  if (!dueAt.value) {
    error.value = '请选择截止时间'
    return
  }
  if (Date.parse(dueAt.value) < Date.now()) {
    error.value = '截止时间不能早于当前时间'
    return
  }
  error.value = ''
  emit('submit', {
    assignee_id: assigneeId.value,
    due_at: dueAt.value,
    note: note.value.trim() || undefined,
  })
}
</script>

<template>
  <el-dialog v-model="open" title="派单" width="480px" append-to-body>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="执行人" required>
        <el-select
          v-model="assigneeId"
          class="ad__field"
          filterable
          clearable
          :loading="usersLoading"
          placeholder="按姓名搜索并选择执行人"
          :aria-label="'执行人'"
        >
          <el-option
            v-for="u in users"
            :key="u.id"
            :label="`${u.name}${u.department ? ' · ' + u.department : ''}`"
            :value="u.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="截止时间" required>
        <el-date-picker
          v-model="dueAt"
          class="ad__field"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          format="YYYY-MM-DD HH:mm"
          placeholder="选择截止时间"
          :aria-label="'截止时间'"
        />
        <p v-if="dueAtHint" class="ad__hint">{{ dueAtHint }}</p>
      </el-form-item>

      <el-form-item label="派单备注（可选）">
        <el-input v-model="note" type="textarea" :rows="2" maxlength="200" show-word-limit
          placeholder="如：到场前先联系值班室、需带万用表。" />
      </el-form-item>

      <p v-if="error" class="ad__error" role="alert">{{ error }}</p>
    </el-form>

    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :loading="!!busy" @click="submit">确认派单</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ad__field { width: 100%; }
.ad__hint { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.ad__error { margin: 0; font-size: var(--text-xs); color: var(--danger-fg); }
</style>
