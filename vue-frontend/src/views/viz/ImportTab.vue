<script setup lang="ts">
/**
 * 导入 Tab（/asset-viz?tab=import）
 * 上传 Excel 即自动识别模板并写入系统（固定资产清单 / 设备档案明细 / BA 系统设备 / 机房信息汇总）。
 * 重复导入按设备编号幂等更新；建议先「校验（不落库）」再「确认导入」。
 * 用原生 input + 拖放收集文件，再逐个走 FormData 直传（与 React 版同模式）。
 */
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Files, Loading, Upload, UploadFilled, View } from '@element-plus/icons-vue'
import ImportBatchTable from '@/components/viz/ImportBatchTable.vue'
import ImportResultsList from '@/components/viz/ImportResultsList.vue'
import ImportTemplateList from '@/components/viz/ImportTemplateList.vue'
import type { FileResult, PendingFile } from '@/components/viz/importShared'
import { getImportBatches, getImportTemplates, uploadImport } from '@/api/assetViz'
import type { ImportBatch, ImportTemplate } from '@/types/assetViz'

const SOURCE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'fixed_assets', label: '固定资产清单' },
  { value: 'device_archive', label: '设备档案明细' },
  { value: 'ba_system', label: 'BA 系统设备' },
  { value: 'rooms', label: '机房信息汇总' },
]

const batches = ref<ImportBatch[]>([])
const templates = ref<ImportTemplate[]>([])
const pending = ref<PendingFile[]>([])
const results = ref<FileResult[]>([])
const loading = ref(true)
const busy = ref(false)
const dragActive = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

async function refresh() {
  batches.value = await getImportBatches()
}

onMounted(async () => {
  try {
    const [b, t] = await Promise.all([getImportBatches(), getImportTemplates()])
    batches.value = b
    templates.value = t
  } finally {
    loading.value = false
  }
})

function addFiles(list: FileList | null) {
  if (!list) return
  const next: PendingFile[] = []
  for (const f of Array.from(list)) {
    const n = f.name.toLowerCase()
    if (!n.endsWith('.xlsx') && !n.endsWith('.xls')) {
      ElMessage({ type: 'error', message: `仅支持 Excel 文件：${f.name}` })
      continue
    }
    next.push({ id: `${Date.now()}-${f.name}-${Math.random()}`, file: f, sourceType: 'auto' })
  }
  pending.value = [...pending.value, ...next]
  results.value = []
}

function onPick(e: Event) {
  const el = e.target as HTMLInputElement
  addFiles(el.files)
  el.value = ''
}

function onDrop(e: DragEvent) {
  dragActive.value = false
  addFiles(e.dataTransfer?.files ?? null)
}

function openPicker() {
  fileInput.value?.click()
}

function removeFile(id: string) {
  pending.value = pending.value.filter((x) => x.id !== id)
}

function clearAll() {
  pending.value = []
  results.value = []
}

async function runImport(dryRun: boolean) {
  if (pending.value.length === 0) {
    ElMessage({ type: 'error', message: '请先选择文件' })
    return
  }
  busy.value = true
  const out: FileResult[] = []
  try {
    for (const p of pending.value) {
      try {
        const res = await uploadImport(p.file, {
          sourceType: p.sourceType === 'auto' ? undefined : p.sourceType,
          dryRun,
        })
        out.push({ ...res, id: p.id, filename: p.file.name, ok: true })
      } catch (err) {
        out.push({
          id: p.id, filename: p.file.name, ok: false,
          error: err instanceof Error ? err.message : '未知错误',
        })
      }
    }
    results.value = out
    const failed = out.filter((r) => !r.ok).length
    if (dryRun) {
      ElMessage({
        type: failed ? 'error' : 'success',
        message: `校验${failed ? '完成（有失败）' : '通过'}：共 ${out.length} 个文件，${failed} 个失败`,
      })
    } else {
      await refresh()
      ElMessage({
        type: failed ? 'error' : 'success',
        message: `导入${failed ? '完成（有失败）' : '成功'}：共 ${out.length} 个文件，${failed} 个失败`,
      })
    }
  } finally {
    busy.value = false
  }
}

function sizeKb(f: File): string {
  return `${(f.size / 1024).toFixed(0)} KB`
}
</script>

<template>
  <div class="imp">
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title imp__title">
          <el-icon :size="16"><Upload /></el-icon>
          <span>数据导入中心</span>
        </h3>
      </header>
      <p class="imp__desc">
        上传 Excel 即自动识别模板并写入系统（支持固定资产清单 / 设备档案明细 / BA 系统设备 / 机房信息汇总）。
        重复导入按设备编号幂等更新，不会重复建记录。建议先「校验」再「确认导入」。
      </p>

      <div
        class="imp__drop"
        :class="{ 'imp__drop--on': dragActive }"
        role="button"
        tabindex="0"
        @dragover.prevent="dragActive = true"
        @dragleave="dragActive = false"
        @drop.prevent="onDrop"
        @click="openPicker"
        @keydown.enter="openPicker"
      >
        <el-icon :size="28" class="imp__drop-icon"><UploadFilled /></el-icon>
        <p class="imp__drop-text">点击或拖拽 Excel 文件到此处（可多选）</p>
        <p class="imp__drop-hint">.xlsx / .xls，单文件 ≤ 50MB</p>
        <input
          ref="fileInput"
          class="imp__input"
          type="file"
          accept=".xlsx,.xls"
          multiple
          @change="onPick"
        />
      </div>

      <div v-if="pending.length > 0" class="imp__pending">
        <div v-for="p in pending" :key="p.id" class="imp__file">
          <el-icon :size="16" class="imp__file-icon"><Files /></el-icon>
          <span class="imp__file-name ellipsis" :title="p.file.name">{{ p.file.name }}</span>
          <span class="imp__file-size">{{ sizeKb(p.file) }}</span>
          <el-select v-model="p.sourceType" size="small" class="imp__source">
            <el-option v-for="o in SOURCE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <el-button size="small" text :aria-label="`移除 ${p.file.name}`" @click="removeFile(p.id)">
            <el-icon :size="16"><Delete /></el-icon>
          </el-button>
        </div>
        <div class="imp__pending-actions">
          <el-button :disabled="busy" @click="runImport(true)">
            <el-icon :size="16" :class="{ 'is-loading': busy }">
              <Loading v-if="busy" /><View v-else />
            </el-icon>
            <span>校验（不落库）</span>
          </el-button>
          <el-button type="primary" :disabled="busy" @click="runImport(false)">
            <el-icon :size="16" :class="{ 'is-loading': busy }">
              <Loading v-if="busy" /><Upload v-else />
            </el-icon>
            <span>确认导入</span>
          </el-button>
          <el-button text :disabled="busy" @click="clearAll">清空</el-button>
        </div>
      </div>

      <ImportResultsList v-if="results.length > 0" :results="results" />
    </section>

    <ImportTemplateList v-if="templates.length > 0" :templates="templates" />

    <ImportBatchTable :batches="batches" :loading="loading" @refresh="refresh" />
  </div>
</template>

<style scoped>
.imp {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.imp__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.imp__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.imp__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-6);
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  text-align: center;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-standard), background-color var(--motion-fast) var(--ease-standard);
}

.imp__drop:hover,
.imp__drop:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  outline: none;
}

.imp__drop--on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.imp__drop-icon {
  color: var(--meta);
}

.imp__drop-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.imp__drop-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.imp__input {
  display: none;
}

.imp__pending {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.imp__file {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.imp__file-icon {
  color: var(--accent);
}

.imp__file-name {
  flex: 1 1 180px;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.imp__file-size {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.imp__source {
  flex: 0 0 auto;
  width: 150px;
}

.imp__pending-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-1);
}
</style>
