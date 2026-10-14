<script setup lang="ts">
/**
 * 同房间设备合并弹窗（减少台账同类项）
 * =====================================================================
 * 用户场景：现场盘点发现同一间房里两台设备其实是同一台，只是有两个编号
 * （移交编号 / 新编号 / 标签号各一个），台账因此多出一条同类项。
 *
 * 交互约定：
 *  - 打开即调`dry_run` 预演，把「将要发生什么」摊给用户看，用户核对无误再确认；
 *    预演与执行是**后端同一个函数**，所以弹窗里的数字 = 点确认后的实际结果
 *    （这是本组件存在的意义：合并是不可逆操作，必须让人看清代价）。
 *  - 两台设备的信息**并排展示**，其中「被合并」的一侧标红，方向不会搞反——
 *    合并方向搞反会把主设备变成旧编号，这是最难挽回的一类错误。
 *  - 跨房间合并后端返回 409，原样透出提示（提示用户先把设备改挂到同一房间）。
 *  - 幂等：已经合并过会返回 already_merged，如实告知「此前已合并」而不是报错。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue'
import { scanMergeRoomDevices } from '@/api/scan'
import type {
  InventoryDeviceRow, RoomBrief, RoomDeviceMergeDryRun, RoomDeviceMergePlan,
} from '@/types/scan'

const props = defineProps<{
  modelValue: boolean
  room: RoomBrief
  /** 保留的主设备 */
  keep: InventoryDeviceRow | null
  /** 被并入的旧设备 */
  merge: InventoryDeviceRow | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'done'): void
}>()

const plan = ref<RoomDeviceMergePlan | null>(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const remark = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

function reset() {
  plan.value = null
  loading.value = false
  submitting.value = false
  error.value = ''
  remark.value = ''
}

/** 打开时预演；换一对设备就重新预演，绝不复用上一次的数字 */
watch(
  () => [props.modelValue, props.keep?.device_code, props.merge?.device_code] as const,
  async ([open, keepCode, mergeCode]) => {
    reset()
    if (!open || !keepCode || !mergeCode || !props.room?.code) return
    loading.value = true
    try {
      const res = await scanMergeRoomDevices(props.room.code, {
        keep_code: keepCode,
        merge_code: mergeCode,
        dry_run: true,
      })
      plan.value = (res as RoomDeviceMergeDryRun).plan ?? null
    } catch (e) {
      error.value = e instanceof Error ? e.message : '预演失败'
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

async function confirm() {
  if (!props.keep || !props.merge) return
  submitting.value = true
  error.value = ''
  try {
    const res = await scanMergeRoomDevices(props.room.code, {
      keep_code: props.keep.device_code,
      merge_code: props.merge.device_code,
      remark: remark.value,
    })
    const r = res as { already_merged?: boolean; merged_code?: string }
    if (r.already_merged) {
      ElMessage({ type: 'info', message: `此前已合并过（${r.merged_code}），本次无需操作` })
    } else {
      ElMessage({ type: 'success', message: `已合并：${r.merged_code} → ${props.keep.device_code}` })
    }
    visible.value = false
    emit('done')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '合并失败'
  } finally {
    submitting.value = false
  }
}

/** 设备摘要行：编号 + 名称 + 子系统/位置，够用户肉眼判断是不是同一台 */
function facts(d: InventoryDeviceRow | null): string[] {
  if (!d) return []
  return [d.name, d.subsystem_name, d.location_desc].filter(Boolean) as string[]
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="合并同类设备"
    width="620px"
    :close-on-click-modal="false"
    append-to-body
  >
    <p class="mgd__lead">
      确认下面两台<strong>是同一台设备</strong>后合并：保留
      <b class="mono">{{ keep?.device_code }}</b>，
      <b class="mgd__old mono">{{ merge?.device_code }}</b> 将并入它。
    </p>

    <div class="mgd__pair">
      <section class="mgd__side mgd__side--keep">
        <h4 class="mgd__side-title">
          <el-icon :size="14"><CircleCheckFilled /></el-icon> 保留（主设备）
        </h4>
        <p class="mgd__code mono break-code">{{ keep?.device_code }}</p>
        <p v-for="(f, i) in facts(keep)" :key="i" class="mgd__fact">{{ f }}</p>
      </section>

      <div class="mgd__arrow" aria-hidden="true">← 并入</div>

      <section class="mgd__side mgd__side--merge">
        <h4 class="mgd__side-title">
          <el-icon :size="14"><WarningFilled /></el-icon> 被合并（旧编号）
        </h4>
        <p class="mgd__code mono break-code">{{ merge?.device_code }}</p>
        <p v-for="(f, i) in facts(merge)" :key="i" class="mgd__fact">{{ f }}</p>
      </section>
    </div>

    <p v-if="loading" class="mgd__hint">正在核算影响范围…</p>

    <div v-else-if="plan" class="mgd__plan">
      <p class="mgd__plan-title">合并后将发生：</p>
      <ul class="mgd__plan-list">
        <li>本房间设备数 <b class="tnum">{{ (plan.keep ? 1 : 0) }}</b> 台（旧编号不再单独计数）</li>
        <li v-if="plan.records_to_rewrite > 0">
          <b class="tnum">{{ plan.records_to_rewrite }}</b> 条资料记录改挂到主设备
          <span class="mgd__dim">（含关联键「{{ plan.relation_key }}」，防止旧编号复活）</span>
        </li>
        <li v-if="plan.relations_to_move > 0">
          <b class="tnum">{{ plan.relations_to_move }}</b> 条设备关系边改指向主设备
        </li>
        <li>旧编号 <b class="mono">{{ merge?.device_code }}</b> 保留为别名，现场仍可用它扫码查到主设备</li>
      </ul>
      <p v-if="plan.already_merged" class="mgd__warn">
        该旧编号已有别名映射{{ plan.already_merged ? '（且已指向主设备）' : '' }}，本次合并会覆盖原映射。
      </p>
    </div>

    <el-alert v-if="error" type="error" :closable="false" class="mgd__err" show-icon>
      {{ error }}
    </el-alert>

    <el-form label-width="72px" class="mgd__remark">
      <el-form-item label="备注">
        <el-input
          v-model="remark"
          placeholder="为什么把这两台认成同一台（选填，便于回溯）"
          maxlength="200"
          show-word-limit
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="danger" :loading="submitting" :disabled="loading || !plan" @click="confirm">
        确认合并
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mgd__lead { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--fg-2); line-height: 1.7; }
.mgd__old { color: var(--danger-fg); }
/* 三列必须给两侧同样宽度（1fr），否则「并入」箭头会把保留侧挤扁成一条 */
.mgd__pair { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: var(--space-2); align-items: start; }
.mgd__side { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); min-width: 0; }
.mgd__side--merge { border-color: color-mix(in srgb, var(--danger) 40%, #fff); background: var(--danger-bg); }
.mgd__side-title { display: flex; align-items: center; gap: var(--space-1); margin: 0 0 var(--space-1); font-size: var(--text-xs); font-weight: var(--weight-emphasize); color: var(--fg-2); }
/* 图标必须锁死尺寸：SVG 默认会撑满容器，曾把整张卡片撑成一个大色块 */
.mgd__side-title .el-icon { flex: 0 0 auto; width: 14px; height: 14px; font-size: 14px; }
.mgd__side--merge .mgd__side-title { color: var(--danger-fg); }
.mgd__code { margin: 0; font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }
.mgd__fact { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.mgd__arrow { align-self: center; padding-top: 22px; font-size: var(--text-xs); color: var(--muted); white-space: nowrap; }
.mgd__hint { margin: var(--space-3) 0 0; font-size: var(--text-xs); color: var(--muted); }
.mgd__plan { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-soft); border-radius: var(--radius-md); background: var(--surface-2); }
.mgd__plan-title { margin: 0 0 var(--space-1); font-size: var(--text-xs); font-weight: var(--weight-emphasize); color: var(--fg-2); }
.mgd__plan-list { margin: 0; padding-left: var(--space-4); font-size: var(--text-xs); color: var(--fg-2); line-height: 1.9; }
.mgd__dim { color: var(--muted); }
.mgd__warn { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--warn-fg); }
.mgd__err { margin-top: var(--space-3); }
.mgd__remark { margin-top: var(--space-3); }
@media (max-width: 720px) {
  .mgd__pair { grid-template-columns: minmax(0, 1fr); }
  .mgd__arrow { display: none; }
}
</style>
