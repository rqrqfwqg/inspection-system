<script setup lang="ts">
/**
 * 409 版本冲突处置弹窗（**非 toast** —— AC-07 / WOD-6）
 * =====================================================================
 * 铁律：绝不自动覆盖、绝不静默重试、绝不擅自 move。
 *   - 并列展示「你提交时的 client_version N」vs「服务端 server_version M」；
 *   - 契约 409 响应体（sync_conflict）仅含 client_version / server_version，
 *     不返回字段级差异 → 本弹窗**只呈现两个版本号**，不臆造冲突字段明细；
 *   - 唯一动作按钮 = [查看最新（只读）]：只读刷新服务端数据，用户自行决定是否重填。
 */
import { computed } from 'vue'

const props = defineProps<{
  modelValue: boolean
  /** 你提交时的 version（本地快照 = client_version） */
  mineVersion: number | null
  /** 服务端当前 version（来自 409 响应 server_version） */
  serverVersion: number | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'view-latest'): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const mine = computed(() => (props.mineVersion === null ? '未知' : `version ${props.mineVersion}`))
const server = computed(() => (props.serverVersion === null ? '未知' : `version ${props.serverVersion}`))

function onViewLatest() {
  emit('view-latest')
  open.value = false
}
</script>

<template>
  <el-dialog v-model="open" title="这张工单已被他人修改" width="520px" :close-on-click-modal="false" append-to-body>
    <div class="cf">
      <p class="cf__lead">
        你提交时的版本与服务端不一致，系统**未做任何自动合并或覆盖**，你填写的内容仍保留在本地。
      </p>

      <div class="cf__compare">
        <div class="cf__side">
          <span class="cf__side-label">你提交时的版本</span>
          <span class="cf__side-ver mono">{{ mine }}</span>
        </div>
        <span class="cf__arrow" aria-hidden="true">→</span>
        <div class="cf__side cf__side--server">
          <span class="cf__side-label">服务端当前版本</span>
          <span class="cf__side-ver mono">{{ server }}</span>
        </div>
      </div>

      <p class="cf__tip">
        建议先「查看最新」只读刷新，确认服务端改动后，再手动重新填写并提交。
      </p>
    </div>

    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" @click="onViewLatest">查看最新（只读）</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cf { min-width: 0; }
.cf__lead { margin: 0 0 var(--space-3); font-size: var(--text-sm); line-height: var(--leading-body); color: var(--fg); }
.cf__compare {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}
.cf__side { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cf__side-label { font-size: var(--text-xs); color: var(--muted); }
.cf__side-ver { font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.cf__side--server .cf__side-ver { color: var(--warn-fg); }
.cf__arrow { color: var(--muted); }
.cf__tip { margin: var(--space-3) 0 0; font-size: var(--text-xs); line-height: var(--leading-body); color: var(--fg-2); }
</style>
