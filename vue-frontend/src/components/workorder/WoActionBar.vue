<script setup lang="ts">
/**
 * 工单动作条（状态机 × 权限位 → 可用动作）
 * =====================================================================
 * 硬点遵循：
 *   - 不可用动作**不隐藏**：以禁用按钮 / 下拉内禁用项呈现，并用 tooltip 说明具体原因（WOD-7）；
 *   - **每次动作提交带 `version`**（乐观锁，由父级透传到 API）；
 *   - 取消 / 打回 / 关闭**不做红色实心**（避免与状态色抢注意力），用 plain + --danger-fg 文字；
 *   - 产生副作用（照片）的动作，成功后由父级回写详情页可见区域，禁止只在 toast 里说一句；
 *   - 403 时整条动作条只读降级（父级透传 readonly）。
 * 权限位不足时前端只做「提前禁用 + 说明」；真实校验在后端，403 仍由父级兜底。
 */
import { computed, ref } from 'vue'
import { MoreFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AssignDialog from '@/components/workorder/AssignDialog.vue'
import { useCurrentUser } from '@/composables/useCurrentUser'
import { useWoPermissions } from '@/composables/useWoPermissions'
import { uploadAttachment } from '@/api/workOrderApi'
import { woStatusLabel } from '@/types/workOrderMeta'
import type { WorkOrder, WoActionPayload, WorkOrderActionKind } from '@/types/workOrder'

const props = defineProps<{
  wo: WorkOrder
  /** 403 只读降级：所有动作禁用并说明「无操作权限」 */
  readonly?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'action', payload: { kind: WorkOrderActionKind; body: WoActionPayload }): void
}>()

const { currentUser } = useCurrentUser()
const perms = useWoPermissions()

const ACTIVE_STATUSES = ['pending_dispatch', 'assigned', 'in_progress', 'completed', 'pending_review']

interface ActionDef {
  kind: WorkOrderActionKind
  label: string
  /** 无权限/状态不符时的原因；null = 可用 */
  reason: string | null
  /** 危险动作（取消 / 打回 / 重开）用 plain + danger 文字 */
  danger: boolean
}

const currentLabel = computed(() => woStatusLabel(props.wo.status))
const isAssignee = computed(
  () => currentUser.value !== null && props.wo.assignee_id !== null && props.wo.assignee_id === currentUser.value.id,
)

function stateReason(expected: string): string {
  return `当前状态（${currentLabel.value}）不可执行该动作，需处于「${expected}」`
}

const actions = computed<ActionDef[]>(() => {
  const s = props.wo.status
  const ro = !!props.readonly
  const roReason = '当前账号无操作权限，仅可查看'
  const defs: ActionDef[] = [
    {
      kind: 'dispatch',
      label: '派单',
      danger: false,
      reason: ro ? roReason : !perms.has('wo.dispatch') ? '需要 wo.dispatch 权限' : s !== 'pending_dispatch' ? stateReason('待派单') : null,
    },
    {
      kind: 'start',
      label: '开始处理',
      danger: false,
      reason: ro
        ? roReason
        : !perms.has('wo.execute')
          ? '需要 wo.execute 权限'
          : s !== 'assigned'
            ? stateReason('已派单')
            : !isAssignee.value
              ? '仅执行人本人可开始处理'
              : null,
    },
    {
      kind: 'complete',
      label: '执行完成',
      danger: false,
      reason: ro
        ? roReason
        : !perms.has('wo.execute')
          ? '需要 wo.execute 权限'
          : s !== 'in_progress'
            ? stateReason('处理中')
            : !isAssignee.value
              ? '仅执行人本人可标记完成'
              : null,
    },
    {
      kind: 'submit_review',
      label: '提交验收',
      danger: false,
      reason: ro ? roReason : !perms.has('wo.execute') ? '需要 wo.execute 权限' : s !== 'completed' ? stateReason('已完成') : null,
    },
    {
      kind: 'review',
      label: '验收',
      danger: false,
      reason: ro ? roReason : !perms.has('wo.review') ? '需要 wo.review 权限' : s !== 'pending_review' ? stateReason('待验收') : null,
    },
    {
      kind: 'cancel',
      label: '取消工单',
      danger: true,
      reason: ro
        ? roReason
        : !perms.has('wo.cancel')
          ? '需要 wo.cancel 权限'
          : !ACTIVE_STATUSES.includes(s)
            ? `当前状态（${currentLabel.value}）不可取消`
            : null,
    },
    {
      kind: 'reopen',
      label: '重新打开',
      danger: true,
      reason: ro
        ? roReason
        : !perms.has('wo.review')
          ? '需要 wo.review 权限'
          : s !== 'cancelled' && s !== 'closed'
            ? `当前状态（${currentLabel.value}）不可重新打开`
            : null,
    },
  ]
  return defs
})

const enabled = computed(() => actions.value.filter((a) => a.reason === null))
const disabled = computed(() => actions.value.filter((a) => a.reason !== null))
const primaryKind = computed<WorkOrderActionKind | null>(() => enabled.value[0]?.kind ?? null)

/* ============================ 对话框状态 ============================ */

const assignOpen = ref(false)
const noteOpen = ref(false)
const noteKind = ref<WorkOrderActionKind>('complete')
const noteText = ref('')
const noteError = ref('')
const photos = ref<string[]>([])
const uploading = ref(false)

const reviewOpen = ref(false)
const reviewApproved = ref(true)
const reviewNote = ref('')
const reviewError = ref('')

const reopenOpen = ref(false)
const reopenTarget = ref<'assigned' | 'in_progress'>('assigned')

const cancelOpen = ref(false)
const cancelReason = ref('')
const cancelError = ref('')

const noteTitle = computed(() => {
  if (noteKind.value === 'complete') return '标记执行完成'
  if (noteKind.value === 'submit_review') return '提交验收'
  return '提交'
})

function openAction(kind: WorkOrderActionKind) {
  if (props.busy) return
  if (kind === 'start') {
    emit('action', { kind, body: { version: props.wo.version } })
    return
  }
  if (kind === 'dispatch') {
    assignOpen.value = true
    return
  }
  if (kind === 'review') {
    reviewApproved.value = true
    reviewNote.value = ''
    reviewError.value = ''
    reviewOpen.value = true
    return
  }
  if (kind === 'reopen') {
    reopenTarget.value = 'assigned'
    reopenOpen.value = true
    return
  }
  if (kind === 'cancel') {
    cancelReason.value = ''
    cancelError.value = ''
    cancelOpen.value = true
    return
  }
  // complete / submit_review
  noteKind.value = kind
  noteText.value = ''
  noteError.value = ''
  photos.value = []
  noteOpen.value = true
}

function submitNote() {
  if (props.busy) return
  const body: WoActionPayload = { version: props.wo.version }
  if (noteText.value.trim()) body.note = noteText.value.trim()
  if (noteKind.value === 'complete' && photos.value.length) body.photo_urls = [...photos.value]
  emit('action', { kind: noteKind.value, body })
  noteOpen.value = false
}

async function onPickPhoto(files: FileList | null) {
  if (!files || !files.length) return
  uploading.value = true
  try {
    for (const f of Array.from(files)) {
      const res = await uploadAttachment(f)
      if (res?.url) photos.value.push(res.url)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '照片上传失败，请重试')
  } finally {
    uploading.value = false
  }
}

function submitReview() {
  if (props.busy) return
  if (!reviewApproved.value && !reviewNote.value.trim()) {
    reviewError.value = '打回必须填写原因，便于执行人整改'
    return
  }
  reviewError.value = ''
  const body: WoActionPayload = { version: props.wo.version, approved: reviewApproved.value }
  if (reviewNote.value.trim()) body.note = reviewNote.value.trim()
  emit('action', { kind: 'review', body })
  reviewOpen.value = false
}

function submitReopen() {
  if (props.busy) return
  emit('action', { kind: 'reopen', body: { version: props.wo.version, target_status: reopenTarget.value } })
  reopenOpen.value = false
}

function submitCancel() {
  if (props.busy) return
  if (!cancelReason.value.trim()) {
    cancelError.value = '请填写取消原因'
    return
  }
  cancelError.value = ''
  emit('action', { kind: 'cancel', body: { version: props.wo.version, reason: cancelReason.value.trim() } })
  cancelOpen.value = false
}

function onAssignSubmit(payload: { assignee_id: number; due_at?: string; note?: string }) {
  emit('action', {
    kind: 'dispatch',
    body: { version: props.wo.version, assignee_id: payload.assignee_id, due_at: payload.due_at, note: payload.note },
  })
  assignOpen.value = false
}
</script>

<template>
  <div class="actbar">
    <el-button
      v-for="a in enabled"
      :key="a.kind"
      :type="a.kind === primaryKind ? 'primary' : 'default'"
      :plain="a.danger"
      :class="{ 'actbar__danger': a.danger }"
      :loading="!!busy && a.kind === primaryKind"
      :disabled="!!busy"
      @click="openAction(a.kind)"
    >
      {{ a.label }}
    </el-button>

    <span v-if="!enabled.length" class="actbar__none">当前状态无可执行动作</span>

    <el-dropdown v-if="disabled.length" trigger="click">
      <el-button :disabled="!!busy">
        <span>其他动作</span><el-icon :size="16"><MoreFilled /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="a in disabled" :key="a.kind" disabled>
            <span class="actbar__item">{{ a.label }}</span>
            <span class="actbar__item-reason">{{ a.reason }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>

  <!-- 派单（共用 AssignDialog） -->
  <AssignDialog v-model="assignOpen" :wo="wo" @submit="onAssignSubmit" />

  <!-- 完成 / 提交验收（备注可选；完成可附现场照片） -->
  <el-dialog v-model="noteOpen" :title="noteTitle" width="480px" append-to-body>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="备注（可选）">
        <el-input v-model="noteText" type="textarea" :rows="3" maxlength="500" show-word-limit
          placeholder="写清处理结果、遗留问题或验收要点，将写入不可变审计日志。" />
      </el-form-item>
      <el-form-item v-if="noteKind === 'complete'" label="现场照片（可选，先上传再提交）">
        <div class="actbar__upload">
          <input type="file" accept="image/*" multiple :disabled="uploading" @change="onPickPhoto(($event.target as HTMLInputElement).files)" />
          <span v-if="uploading" role="status">正在上传…</span>
          <ul v-else-if="photos.length" class="actbar__photos">
            <li v-for="(u, i) in photos" :key="u" class="mono break-code">照片 {{ i + 1 }}：{{ u }}</li>
          </ul>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="noteOpen = false">取消</el-button>
      <el-button type="primary" :loading="!!busy || uploading" @click="submitNote">提交</el-button>
    </template>
  </el-dialog>

  <!-- 验收（通过→已关闭 / 打回→处理中，打回原因必填） -->
  <el-dialog v-model="reviewOpen" title="验收" width="480px" append-to-body>
    <el-radio-group v-model="reviewApproved" class="actbar__radios">
      <el-radio :value="true">通过并关闭工单</el-radio>
      <el-radio :value="false">打回，退回处理中</el-radio>
    </el-radio-group>
    <el-form label-position="top" @submit.prevent>
      <el-form-item :label="reviewApproved ? '验收备注（可选）' : '打回原因（必填）'" :error="reviewError">
        <el-input v-model="reviewNote" type="textarea" :rows="3" maxlength="500" show-word-limit
          :placeholder="reviewApproved ? '可记录验收结论。' : '说明不合格项，执行人将据此整改。'" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="reviewOpen = false">取消</el-button>
      <el-button type="primary" :loading="!!busy" @click="submitReview">确认验收</el-button>
    </template>
  </el-dialog>

  <!-- 重新打开（生成新单 / 指向原单 parent_id） -->
  <el-dialog v-model="reopenOpen" title="重新打开工单" width="480px" append-to-body>
    <p class="actbar__tip">重开将生成新单并指向原单（parent_id），原单事件日志保留不变。</p>
    <el-radio-group v-model="reopenTarget" class="actbar__radios">
      <el-radio value="assigned">重开后已派单</el-radio>
      <el-radio value="in_progress">重开后处理中</el-radio>
    </el-radio-group>
    <template #footer>
      <el-button @click="reopenOpen = false">取消</el-button>
      <el-button type="primary" :loading="!!busy" @click="submitReopen">确认重开</el-button>
    </template>
  </el-dialog>

  <!-- 取消（原因必填） -->
  <el-dialog v-model="cancelOpen" title="取消工单" width="480px" append-to-body>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="取消原因（必填）" :error="cancelError">
        <el-input v-model="cancelReason" type="textarea" :rows="3" maxlength="300" show-word-limit
          placeholder="如：报修重复、现场无故障、计划调整。" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="cancelOpen = false">返回</el-button>
      <el-button plain class="actbar__danger" :loading="!!busy" @click="submitCancel">确认取消</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.actbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
.actbar__none { font-size: var(--text-xs); color: var(--muted); }
.actbar__danger { color: var(--danger-fg); border-color: var(--danger-fg); }
.actbar__item { display: block; color: var(--fg); }
.actbar__item-reason { display: block; font-size: var(--text-xs); color: var(--muted); }
.actbar__radios { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-3); }
.actbar__tip { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--fg-2); }
.actbar__upload { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--fg-2); }
.actbar__photos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--text-xs); color: var(--fg-2); }
</style>
