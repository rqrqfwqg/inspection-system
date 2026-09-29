<script setup lang="ts">
/**
 * 管理员逃生舱 · 覆盖对话框（SPEC §4 / §6.2，架构 §11）
 * - 仅 admin 可打开（可见性由父页 isAdmin 控制；真实校验在后端 require_admin，非 admin → 403）
 * - 单选 已盘点 / 未盘点 + 必填「原因」（API 层强制非空，前端 min_length:1 兜底 + 错误提示）
 * - 提交 → PUT /assets/asset-ledger/{device_code}/inventory-status（覆盖写，upsert + 缓存失效）
 * - 成功 → emit('submitted')，父页刷新列表（60s 缓存失效后即时反映）
 * 颜色全走 token，动效仅 --ease-standard；无 emoji、无紫粉渐变。
 */
import { computed, ref, watch } from 'vue'
import { Stamp, WarningFilled } from '@element-plus/icons-vue'
import { putInventoryStatus } from '@/api/inventoryStatusApi'
import type { InventoryStatus } from '@/types/assetLedger'

interface Props {
  modelValue: boolean
  deviceCode: string
  /** 当前盘点状态（用于预选单选） */
  currentStatus: InventoryStatus
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'submitted'): void
}>()

const status = ref<InventoryStatus>(props.currentStatus)
const reason = ref('')
const reasonError = ref('')
const submitting = ref(false)
const error = ref('')

/** 每次打开重置为当前状态、清空原因与错误 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      status.value = props.currentStatus
      reason.value = ''
      reasonError.value = ''
      error.value = ''
      submitting.value = false
    }
  },
  { immediate: true }
)

const canSubmit = computed(() => status.value && reason.value.trim().length >= 1 && !submitting.value)

function close() {
  emit('update:modelValue', false)
}

async function submit() {
  reasonError.value = ''
  error.value = ''
  if (!reason.value.trim()) {
    reasonError.value = '请填写覆盖原因（审计必填，说明为什么手动改状态）'
    return
  }
  if (!props.deviceCode) return
  submitting.value = true
  try {
    await putInventoryStatus(props.deviceCode, status.value, reason.value.trim())
    emit('submitted')
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '覆盖失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="修改盘点状态（管理员）"
    width="min(92vw, 460px)"
    append-to-body
    :close-on-click-modal="!submitting"
    @close="close"
  >
    <div class="ovd">
      <p v-if="deviceCode" class="ovd__code">
        设备编号：<span class="mono break-code">{{ deviceCode }}</span>
      </p>

      <div class="ovd__field">
        <span class="ovd__label">盘点状态</span>
        <el-radio-group v-model="status" :disabled="submitting">
          <el-radio value="confirmed">已盘点</el-radio>
          <el-radio value="unconfirmed">未盘点</el-radio>
        </el-radio-group>
      </div>

      <div class="ovd__field">
        <label class="ovd__label" for="ovd-reason">覆盖原因（必填）</label>
        <el-input
          id="ovd-reason"
          v-model="reason"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          :disabled="submitting"
          :aria-invalid="!!reasonError"
          placeholder="说明为什么手动覆盖房间盘点推导结果（例如：该设备实际已现场确认，但房间盘点流程未跑）"
          @input="reasonError = ''"
        />
        <p v-if="reasonError" class="ovd__err" role="alert">
          <el-icon :size="16"><WarningFilled /></el-icon><span>{{ reasonError }}</span>
        </p>
      </div>

      <p v-if="error" class="ovd__err ovd__err--api" role="alert">
        <el-icon :size="16"><Stamp /></el-icon><span>{{ error }}</span>
      </p>
    </div>

    <template #footer>
      <el-button :disabled="submitting" @click="close">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">
        确认覆盖
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ovd { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.ovd__code { margin: 0; font-size: var(--text-sm); color: var(--fg-2); }
.ovd__field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.ovd__label { font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }
.ovd__err { display: flex; align-items: center; gap: var(--space-1); margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--danger-fg); }
.ovd__err--api { padding: var(--space-2) var(--space-3); border: 1px solid var(--danger); border-radius: var(--radius-md); background: var(--danger-bg); }
</style>
