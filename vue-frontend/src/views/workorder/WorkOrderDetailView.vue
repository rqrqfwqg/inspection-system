<script setup lang="ts">
/**
 * 工单详情（/workorder/:id）—— **整页，不用抽屉**（内容量 + 动作 + 事件流 + 需可深链分享）
 * =====================================================================
 * 错误与冲突分流（硬点）：
 *   - 409 → 弹 WoConflictDialog（并列展示 client_version N vs server_version M），绝不自动覆盖 / 静默重试；
 *   - 403 → 只读降级：说明条 + 动作按钮禁用 + tooltip 原因；
 *   - 网络错误（statusCode===0）→ 入离线队列（PendingOp）+ 提示「已暂存」；
 *   - 404 / 400 → 当场提示且**不入队**（C7）。
 * 动作成功后**局部刷新**（events + 状态 + 进度条），不整页 reload。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Refresh, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import WoActionBar from '@/components/workorder/WoActionBar.vue'
import WoConflictDialog from '@/components/workorder/WoConflictDialog.vue'
import WoStatusTag from '@/components/workorder/WoStatusTag.vue'
import WorkOrderDetailBody from '@/components/workorder/WorkOrderDetailBody.vue'
import WorkOrderStateRail from '@/components/workorder/WorkOrderStateRail.vue'
import {
  cancelWorkOrder, completeWorkOrder, dispatchWorkOrder, getWorkOrder, reopenWorkOrder,
  reviewWorkOrder, startWorkOrder, submitWorkOrderReview, WoApiError,
} from '@/api/workOrderApi'
import { classifyWoError, enqueueWoOp, newWoOpId } from '@/lib/woOffline'
import type { WorkOrderActionKind, WorkOrderDetail, WoActionPayload } from '@/types/workOrder'

const route = useRoute()
const router = useRouter()

const woId = computed(() => {
  const raw = route.params.id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : 0
})

const wo = ref<WorkOrderDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
const notFound = ref(false)
const readonly = ref(false)
const busy = ref(false)
const offlineNotice = ref('')

const conflictOpen = ref(false)
const conflictMine = ref<number | null>(null)
const conflictServer = ref<number | null>(null)

let seq = 0
async function load() {
  const my = ++seq
  const id = woId.value
  if (!id) { notFound.value = true; loading.value = false; wo.value = null; return }
  loading.value = true
  loadError.value = ''
  notFound.value = false
  try {
    const d = await getWorkOrder(id, true)
    if (my !== seq) return
    wo.value = d
    readonly.value = false
  } catch (e) {
    if (my !== seq) return
    wo.value = null
    if (e instanceof WoApiError && e.isNotFound) notFound.value = true
    else if (e instanceof WoApiError && e.isForbidden) readonly.value = true
    else loadError.value = e instanceof Error ? e.message : '未知错误'
  } finally {
    if (my === seq) loading.value = false
  }
}

function goBack() { void router.push('/workorder/list') }

/* ============================ 动作 ============================ */

async function callAction(kind: WorkOrderActionKind, body: WoActionPayload): Promise<void> {
  const id = woId.value
  const map: Record<WorkOrderActionKind, () => Promise<unknown>> = {
    dispatch: () => dispatchWorkOrder(id, body),
    start: () => startWorkOrder(id, body),
    complete: () => completeWorkOrder(id, body),
    submit_review: () => submitWorkOrderReview(id, body),
    review: () => reviewWorkOrder(id, body),
    cancel: () => cancelWorkOrder(id, body),
    reopen: () => reopenWorkOrder(id, body),
  }
  await map[kind]()
}

async function onAction(payload: { kind: WorkOrderActionKind; body: WoActionPayload }) {
  if (!wo.value || busy.value || readonly.value) return
  busy.value = true
  offlineNotice.value = ''
  const mineVersion = wo.value.version
  try {
    await callAction(payload.kind, payload.body)
    const label = payload.kind === 'review' ? '验收' : '操作'
    ElMessage.success(`${label}成功，单号 ${wo.value.code}`)
    await load()
  } catch (e) {
    handleError(e, payload, mineVersion)
  } finally {
    busy.value = false
  }
}

function handleError(e: unknown, payload: { kind: WorkOrderActionKind; body: WoActionPayload }, mineVersion: number) {
  const info = classifyWoError(e)
  if (info.kind === 'conflict') {
    conflictMine.value = mineVersion
    conflictServer.value = info.serverVersion
    conflictOpen.value = true
    return
  }
  if (info.kind === 'forbidden') {
    readonly.value = true
    ElMessage.warning('当前账号无操作权限，已切换为只读。')
    return
  }
  if (info.enqueueable) {
    // 仅网络错误入队（C7）；重连后由同步入口补传
    enqueueWoOp({
      id: newWoOpId(),
      kind: 'wo_action',
      entityId: String(woId.value),
      version: mineVersion,
      action: payload.kind,
      payload: payload.body as unknown as Record<string, unknown>,
      createdAt: Date.now(),
      tries: 0,
      status: 'pending',
      lastError: info.message,
    })
    offlineNotice.value = '当前网络不可用，本次操作已暂存到本地队列，联网后会自动上传。'
    return
  }
  // 404 / 400 / 500：当场提示，不入队
  ElMessage.error(info.message)
}

async function onViewLatest() {
  await load()
  ElMessage.info('已拉取服务端最新数据（只读），请核对后再重新提交。')
}

watch(woId, () => { void load() }, { immediate: true })
</script>

<template>
  <div class="wo-detail">
    <!-- 页头：返回 + 单号 + 状态标签 + 动作条（WOD-1：页头立即渲染） -->
    <header class="wo-detail__head">
      <div class="wo-detail__titles min-w-0">
        <div class="wo-detail__line">
          <el-button link :aria-label="'返回工单列表'" @click="goBack">
            <el-icon :size="20"><ArrowLeft /></el-icon><span>返回</span>
          </el-button>
          <span class="wo-detail__code mono">{{ wo ? wo.code : '…' }}</span>
          <WoStatusTag v-if="wo" :status="wo.status" />
        </div>
        <p class="wo-detail__title">{{ wo?.title || '正在加载工单…' }}</p>
      </div>
      <div class="wo-detail__actions">
        <WoActionBar v-if="wo" :wo="wo" :readonly="readonly" :busy="busy" @action="onAction" />
        <el-button :loading="loading" @click="load">
          <el-icon v-if="!loading" :size="16"><Refresh /></el-icon><span>刷新</span>
        </el-button>
      </div>
    </header>

    <p v-if="readonly" class="wo-detail__note" role="status">
      当前账号无操作权限，仅可查看。需要 wo.dispatch / wo.execute / wo.review / wo.cancel 中的相应权限才能执行动作。
    </p>
    <p v-if="offlineNotice" class="wo-detail__note wo-detail__note--warn" role="status">{{ offlineNotice }}</p>

    <!-- 状态机进度条（立即渲染） -->
    <WorkOrderStateRail :status="wo?.status ?? null" />

    <!-- 404 -->
    <div v-if="notFound" class="wo-detail__state panel">
      <el-icon :size="24" class="wo-detail__state-icon"><WarningFilled /></el-icon>
      <p class="wo-detail__state-title">工单不存在或已删除</p>
      <p class="wo-detail__state-desc">单号可能被清理，或链接已过期。</p>
      <el-button type="primary" @click="goBack">返回列表</el-button>
    </div>

    <!-- 其他错误 -->
    <div v-else-if="loadError" class="wo-detail__state panel" role="alert">
      <el-icon :size="24" class="wo-detail__state-icon wo-detail__state-icon--error"><WarningFilled /></el-icon>
      <p class="wo-detail__state-title">工单详情加载失败</p>
      <p class="wo-detail__state-desc">{{ loadError }}</p>
      <el-button type="primary" plain @click="load">重试</el-button>
    </div>

    <!-- 加载骨架（行内，不用整页 spinner） -->
    <div v-else-if="!wo" class="panel"><el-skeleton :rows="6" animated /></div>

    <WorkOrderDetailBody
      v-else
      :wo="wo"
      :readonly="readonly"
      @open-device="(code: string) => router.push({ path: '/asset/devices', query: { code } })"
    />

    <WoConflictDialog
      v-model="conflictOpen"
      :mine-version="conflictMine"
      :server-version="conflictServer"
      @view-latest="onViewLatest"
    />
  </div>
</template>

<style scoped>
.wo-detail { display: flex; flex-direction: column; gap: var(--space-4); height: 100%; min-height: 0; min-width: 0; }
.wo-detail__head { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-3); min-width: 0; }
.wo-detail__titles { flex: 1 1 auto; }
.wo-detail__line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
.wo-detail__code { font-size: var(--text-lg); font-weight: var(--weight-announce); color: var(--fg); word-break: break-all; }
.wo-detail__title { margin: var(--space-1) 0 0; font-size: var(--text-sm); color: var(--fg-2); word-break: break-word; }
.wo-detail__actions { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.wo-detail__note {
  margin: 0; padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--warn-bg); color: var(--warn-fg); font-size: var(--text-sm);
}
.wo-detail__note--warn { background: var(--info-bg); color: var(--info-fg); border-color: var(--info-bg); }
.wo-detail__state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8) var(--space-4); text-align: center; }
.wo-detail__state-icon { color: var(--muted); }
.wo-detail__state-icon--error { color: var(--danger); }
.wo-detail__state-title { margin: 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.wo-detail__state-desc { margin: 0; max-width: 56ch; font-size: var(--text-sm); color: var(--fg-2); }
</style>
