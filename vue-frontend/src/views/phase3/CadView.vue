<script setup lang="ts">
/**
 * CAD 图纸（/cad）—— React 版 CADPage 等价迁移
 * =====================================================================
 * 上传 DXF → 解析分析（基本信息/实体类型/图层/文字）→ 导出 JSON / 删除。
 * 请求细节全部收敛到 src/api/misc.ts；契约以 backend/cad_routes.py 为准
 * （parse 平铺返回，React 版误取 data 字段的缺陷已纠正）。
 */
import { onMounted, ref } from 'vue'
import { Delete, Download, Upload, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHead from '@/components/common/PageHead.vue'
import CadAnalysisPanel from '@/components/cad/CadAnalysisPanel.vue'
import {
  cadTexts, deleteCadFile, exportCadJson, listCadFiles, parseCadFile, uploadCadFile,
  type CadAnalysis, type CadFile, type CadTextItem,
} from '@/api/misc'
import { fmtBeijingUtc, fmtInt } from '@/lib/format'

const files = ref<CadFile[]>([])
const filesLoading = ref(false)
const uploading = ref(false)
const analysis = ref<CadAnalysis | null>(null)
const texts = ref<CadTextItem[]>([])
const analyzing = ref(false)

async function loadFiles(): Promise<void> {
  filesLoading.value = true
  try {
    files.value = await listCadFiles()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '获取文件列表失败')
  } finally {
    filesLoading.value = false
  }
}

onMounted(loadFiles)

async function analyzeFile(fileId: string): Promise<void> {
  analyzing.value = true
  try {
    const [analysisRes, textRes] = await Promise.all([parseCadFile(fileId), cadTexts(fileId)])
    analysis.value = analysisRes
    texts.value = textRes.texts ?? []
  } catch (e) {
    analysis.value = null
    texts.value = []
    ElMessage.error(e instanceof Error ? e.message : '分析失败')
  } finally {
    analyzing.value = false
  }
}

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.dxf')) {
    ElMessage.error('仅支持 DXF 格式文件')
    return
  }
  uploading.value = true
  try {
    const res = await uploadCadFile(file)
    ElMessage.success(res.message || '文件上传成功')
    await loadFiles()
    if (res.file_id) await analyzeFile(res.file_id) // 上传成功自动分析（与 React 版一致）
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

async function handleDelete(file: CadFile): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除文件「${file.filename}」吗？该文件的解析结果与导出数据将一并不可用。`,
      '删除 CAD 文件',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteCadFile(file.file_id)
    ElMessage.success('文件已删除')
    if (analysis.value?.filename === file.file_id) {
      analysis.value = null
      texts.value = []
    }
    await loadFiles()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function handleExport(file: CadFile): Promise<void> {
  try {
    await exportCadJson(file.file_id)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  }
}
</script>

<template>
  <div class="cad">
    <PageHead title="CAD 文件处理" desc="上传、解析和提取 DXF 文件数据" />

    <div class="panel cad__upload no-print">
      <div class="cad__drop">
        <el-icon :size="40" class="cad__drop-icon"><UploadFilled /></el-icon>
        <h2 class="cad__drop-title">上传 CAD 文件</h2>
        <p class="cad__drop-hint">支持 DXF 格式，上传成功后自动解析</p>
        <input
          type="file"
          accept=".dxf"
          class="cad__file-input"
          :disabled="uploading"
          @change="onPickFile"
        />
        <el-button type="primary" :loading="uploading" @click="(e: MouseEvent) => ((e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement)?.click()">
          <el-icon v-if="!uploading" :size="16"><Upload /></el-icon>
          <span>{{ uploading ? '上传中…' : '选择文件' }}</span>
        </el-button>
      </div>
    </div>

    <div class="grid-2col cad__cols min-w-0">
      <section class="panel cad__files min-w-0">
        <div class="cad__files-head">
          <el-icon :size="20" class="cad__files-icon"><Upload /></el-icon>
          <h2 class="cad__files-title">已上传文件（{{ fmtInt(files.length) }}）</h2>
        </div>
        <p v-if="!filesLoading && files.length === 0" class="cad__empty">
          暂无文件，上传第一个 DXF 图纸后这里会列出全部历史文件
        </p>
        <div v-else class="cad__file-list" v-loading="filesLoading">
          <div v-for="f in files" :key="f.file_id" class="cad__file min-w-0">
            <div class="cad__file-info min-w-0">
              <p class="cad__file-name ellipsis">{{ f.filename }}</p>
              <p class="cad__file-meta tnum">
                {{ (f.size / 1024).toFixed(1) }} KB · {{ fmtBeijingUtc(new Date(f.upload_time * 1000).toISOString()) }}
              </p>
            </div>
            <div class="cad__file-ops">
              <el-button size="small" text type="primary" :disabled="analyzing" @click="analyzeFile(f.file_id)">
                分析
              </el-button>
              <el-button size="small" text @click="handleExport(f)">
                <el-icon :size="16"><Download /></el-icon>
              </el-button>
              <el-button size="small" text type="danger" @click="handleDelete(f)">
                <el-icon :size="16"><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </section>

      <CadAnalysisPanel :analysis="analysis" :texts="texts" :analyzing="analyzing" />
    </div>
  </div>
</template>

<style scoped>
.cad { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }

.cad__drop {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  transition: border-color var(--motion-fast) var(--ease-standard);
  position: relative;
  cursor: pointer;
}
.cad__drop:hover { border-color: var(--accent); }
.cad__drop-icon { color: var(--muted); }
.cad__drop-title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }
.cad__drop-hint { margin: 0 0 var(--space-2); font-size: var(--text-sm); color: var(--muted); }
.cad__file-input { display: none; }

.cad__cols { align-items: stretch; }
.cad__files { display: flex; flex-direction: column; }
.cad__files-head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.cad__files-icon { color: var(--accent); }
.cad__files-title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }

.cad__empty { margin: 0; padding: var(--space-8) 0; text-align: center; font-size: var(--text-sm); color: var(--muted); }
.cad__file-list { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.cad__file {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  transition: background-color var(--motion-fast) var(--ease-standard);
}
.cad__file:hover { background: var(--surface-3); }
.cad__file-info { min-width: 0; }
.cad__file-name { margin: 0; font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--fg); }
.cad__file-meta { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.cad__file-ops { flex: 0 0 auto; display: flex; align-items: center; }
</style>
