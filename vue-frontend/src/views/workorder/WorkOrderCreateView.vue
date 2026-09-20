<script setup lang="ts">
/**
 * 新建工单（/workorder/new）—— 创建 + 派单
 * =====================================================================
 * 硬点：**创建工单必须命中 ledger 的 asset_device_code**（C1 / AC-02）——
 *   不存在则该字段 inline 报错且**不允许提交**（前端先校验，后端 422 亦兜底）。
 * 状态（UIUX 页面 3）：
 *   WOC-1 提交中 → 按钮 loading + 表单整体 disabled（防重复提交），不做全页遮罩；
 *   WOC-2 字段级错误 inline + 顶部汇总 role="alert" + 聚焦第一个错误字段；
 *   WOC-3 设备编号不存在 → inline「台账中不存在该设备编号，无法创建工单」；
 *   WOC-4 网络错误 → **保留全部已填内容** + 顶部错误条 + 重试，绝不丢表单；
 *   WOC-6 成功 → toast 带单号（便于口头交接）+ 自动跳详情。
 * 来源 source 自动为 web（不显示为可填字段）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import PageHead from '@/components/common/PageHead.vue'
import AssignDialog from '@/components/workorder/AssignDialog.vue'
import { getAssetLedgerDetail, resolveAssetLedgerCode } from '@/api/assetLedger'
import { listSubsystems } from '@/api/dict'
import { createWorkOrder, dispatchWorkOrder } from '@/api/workOrderApi'
import { classifyWoError } from '@/lib/woOffline'
import { WO_PRIORITY_LABELS, WO_TYPE_LABELS } from '@/types/workOrderMeta'
import type { WorkOrderPriority, WorkOrderType } from '@/types/workOrder'

const router = useRouter()
const formRef = ref<FormInstance>()

interface FormModel {
  title: string
  type: WorkOrderType
  priority: WorkOrderPriority
  failure_flag: boolean
  asset_device_code: string
  room_code: string
  subsystem_code: string
  due_at: string
  description: string
}

const form = ref<FormModel>({
  title: '',
  type: 'corrective',
  priority: 'medium',
  failure_flag: false,
  asset_device_code: '',
  room_code: '',
  subsystem_code: '',
  due_at: '',
  description: '',
})

const deviceOptions = ref<{ value: string; label: string }[]>([])
const deviceSearching = ref(false)
const submitting = ref(false)
const topError = ref('')
const assignOpen = ref(false)
/** 待执行的创建去向：'plain' = 仅创建；'dispatch' = 创建并派单 */
const createMode = ref<'plain' | 'dispatch'>('plain')

const subsystems = ref<{ value: string; label: string }[]>([])
const typeOptions = computed(() => Object.entries(WO_TYPE_LABELS).map(([value, label]) => ({ value, label })))
const priorityOptions = computed(() => Object.entries(WO_PRIORITY_LABELS).map(([value, label]) => ({ value, label })))

/** 设备编号存在性校验（走台账详情，唯一权威）；不存在 → 拒绝提交 */
async function deviceExists(code: string): Promise<boolean> {
  try {
    const d = await getAssetLedgerDetail(code)
    return !!d?.found
  } catch {
    // 台账接口异常时不误判为「不存在」，交由后端 422 兜底
    return true
  }
}

async function searchDevices(query: string) {
  const q = query.trim()
  if (q.length < 2) { deviceOptions.value = []; return }
  deviceSearching.value = true
  try {
    const res = await resolveAssetLedgerCode(q, 8)
    deviceOptions.value = (res.candidates ?? []).map((c) => ({
      value: c.device_code,
      label: `${c.device_code} · ${c.asset_name || c.name || '未命名'}`,
    }))
  } catch {
    deviceOptions.value = []
  } finally {
    deviceSearching.value = false
  }
}

const rules: FormRules<FormModel> = {
  title: [
    { required: true, message: '请填写工单标题', trigger: 'blur' },
    { min: 2, max: 60, message: '标题需 2–60 个字', trigger: 'blur' },
  ],
  type: [{ required: true, message: '请选择工单类型', trigger: 'change' }],
  asset_device_code: [
    { required: true, message: '请填写设备编号（必须命中资产总台账）', trigger: 'blur' },
    {
      // 存在性校验：不存在即拒绝提交（AC-02 / C1）
      validator: (_rule, value: string, callback: (error?: string | Error) => void) => {
        const code = (value ?? '').trim()
        if (!code) { callback(); return }
        deviceExists(code)
          .then((ok) => {
            if (ok) callback()
            else callback(new Error('台账中不存在该设备编号，无法创建工单'))
          })
          .catch(() => callback())
      },
      trigger: 'blur',
    },
  ],
}

async function loadSubsystems() {
  try {
    const list = await listSubsystems()
    subsystems.value = list.map((s) => ({ value: s.code, label: s.name }))
  } catch {
    subsystems.value = []
  }
}
void loadSubsystems()

function buildPayload(dueAt?: string) {
  const f = form.value
  return {
    title: f.title.trim(),
    type: f.type,
    priority: f.priority,
    failure_flag: f.failure_flag,
    asset_device_code: f.asset_device_code.trim(),
    room_code: f.room_code.trim() || undefined,
    subsystem_code: f.subsystem_code || undefined,
    due_at: (dueAt || f.due_at) || undefined,
    description: f.description.trim() || undefined,
    source: 'web' as const,
  }
}

/** 仅创建（落 pending_dispatch） */
async function submitPlain() {
  await runCreate('plain')
}

/** 创建并派单：先补派单信息，再创建 + 派单 */
function startCreateWithDispatch() {
  topError.value = ''
  void formRef.value?.validate().then((ok) => {
    if (ok) { createMode.value = 'dispatch'; assignOpen.value = true }
  }).catch(() => { focusFirstError() })
}

async function runCreate(mode: 'plain' | 'dispatch', dueAt?: string, assigneeId?: number, note?: string) {
  if (submitting.value) return
  submitting.value = true
  topError.value = ''
  try {
    const created = await createWorkOrder(buildPayload(dueAt))
    if (mode === 'dispatch' && assigneeId !== undefined) {
      await dispatchWorkOrder(created.id, { version: created.version, assignee_id: assigneeId, due_at: dueAt, note })
    }
    ElMessage.success(
      mode === 'dispatch' ? `已创建并派单，单号 ${created.code}` : `已创建工单 ${created.code}`,
    )
    void router.push(`/workorder/${created.id}`)
  } catch (e) {
    const info = classifyWoError(e)
    topError.value = `创建失败：${info.message}`
    // WOC-4：网络错误保留全部已填内容（form 不动），仅给出顶部错误条 + 可重试
    ElMessage.error('创建失败，已保留已填内容，可修改后重试。')
  } finally {
    submitting.value = false
  }
}

function onAssignSubmit(payload: { assignee_id: number; due_at?: string; note?: string }) {
  assignOpen.value = false
  void runCreate('dispatch', payload.due_at, payload.assignee_id, payload.note)
}

function focusFirstError() {
  const order: (keyof FormModel)[] = ['title', 'type', 'asset_device_code']
  for (const prop of order) {
    if (!form.value[prop]) { formRef.value?.scrollToField(prop); return }
  }
  formRef.value?.scrollToField('asset_device_code')
}

async function onSubmit() {
  topError.value = ''
  try {
    await formRef.value?.validate()
  } catch {
    topError.value = '表单还有未填或不符合要求的字段，请按字段下方提示修正。'
    focusFirstError()
    return
  }
  await runCreate('plain')
}

function onCancel() { void router.push('/workorder/list') }

const titleLen = computed(() => form.value.title.length)
</script>

<template>
  <div class="wo-new">
    <PageHead
      title="新建工单"
      desc="填完后可直接派给执行人，也可先存成待派单。"
    />

    <p v-if="topError" class="wo-new__alert" role="alert">{{ topError }}</p>

    <el-form
      ref="formRef"
      class="wo-new__form panel"
      :model="form"
      :rules="rules"
      label-position="top"
      :disabled="submitting"
      @submit.prevent="onSubmit"
    >
      <fieldset class="wo-new__group" :disabled="submitting">
        <legend class="wo-new__legend">工单内容</legend>
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="60" show-word-limit placeholder="一句话说清报修对象与现象" />
        </el-form-item>
        <div class="wo-new__row">
          <el-form-item label="类型" prop="type">
            <el-select v-model="form.type" class="wo-new__field" placeholder="选择类型">
              <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="优先级" prop="priority">
            <el-select v-model="form.priority" class="wo-new__field" placeholder="选择优先级">
              <el-option v-for="o in priorityOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="是否故障">
          <el-switch v-model="form.failure_flag" />
          <span class="wo-new__helper">故障类工单用于计算 MTBF（平均无故障时间）。</span>
        </el-form-item>
      </fieldset>

      <fieldset class="wo-new__group" :disabled="submitting">
        <legend class="wo-new__legend">位置与设备</legend>
        <el-form-item label="设备编号" prop="asset_device_code">
          <el-select
            v-model="form.asset_device_code"
            class="wo-new__field"
            filterable
            remote
            clearable
            allow-create
            default-first-option
            :remote-method="searchDevices"
            :loading="deviceSearching"
            placeholder="输入设备编号或关键字检索资产总台账"
          >
            <el-option v-for="o in deviceOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <span class="wo-new__helper">编号必须在资产总台账中存在；若为新增设备，请先完成资产登记。</span>
        </el-form-item>
        <div class="wo-new__row">
          <el-form-item label="房间编号" prop="room_code">
            <el-input v-model="form.room_code" class="wo-new__field" placeholder="机房 / 房间编号（可选）" />
          </el-form-item>
          <el-form-item label="子系统" prop="subsystem_code">
            <el-select v-model="form.subsystem_code" class="wo-new__field" clearable placeholder="选择子系统（可选）">
              <el-option v-for="s in subsystems" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="截止时间" prop="due_at">
          <el-date-picker
            v-model="form.due_at"
            class="wo-new__field"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            placeholder="选择截止时间（可选）"
          />
        </el-form-item>
      </fieldset>

      <fieldset class="wo-new__group" :disabled="submitting">
        <legend class="wo-new__legend">描述与现场</legend>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
            maxlength="1000"
            show-word-limit
            placeholder="写清现象与影响范围，执行人据此准备工具与备件。"
          />
        </el-form-item>
        <p class="wo-new__meta">来源将自动记录为「网页端」（source=web），无需填写。标题 {{ titleLen }}/60 字。</p>
      </fieldset>
    </el-form>

    <div class="bottom-bar wo-new__bar">
      <el-button @click="onCancel">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="startCreateWithDispatch">创建并派单</el-button>
      <el-button :loading="submitting" @click="submitPlain">仅创建（待派单）</el-button>
    </div>

    <AssignDialog v-model="assignOpen" :busy="submitting" @submit="onAssignSubmit" />
  </div>
</template>

<style scoped>
.wo-new { display: flex; flex-direction: column; gap: var(--space-4); min-height: 0; padding-bottom: var(--space-16); }
.wo-new__alert {
  margin: 0; padding: var(--space-3);
  border: 1px solid var(--danger-bg); border-radius: var(--radius-md);
  background: var(--danger-bg); color: var(--danger-fg); font-size: var(--text-sm);
}
.wo-new__form { max-width: var(--form-max); }
.wo-new__group { border: none; margin: 0 0 var(--space-4); padding: 0; min-width: 0; }
.wo-new__legend { padding: 0; margin-bottom: var(--space-3); font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.wo-new__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--space-4); }
.wo-new__field { width: 100%; }
.wo-new__helper { display: block; margin-top: var(--space-1); font-size: var(--text-xs); color: var(--muted); line-height: var(--leading-body); }
.wo-new__meta { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.wo-new__bar { position: sticky; bottom: 0; z-index: var(--z-sticky); }

@media (max-width: 1023px) {
  .wo-new__row { grid-template-columns: minmax(0, 1fr); }
}
</style>
