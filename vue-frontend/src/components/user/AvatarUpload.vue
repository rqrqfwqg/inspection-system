<script setup lang="ts">
/**
 * 用户头像上传（用户管理 / 新建用户对话框共用）
 * =====================================================================
 * 交互对齐 React 版 AvatarUpload：选图 → 前端校验类型与 5MB 上限 → 本地预览 +
 * POST /upload/avatar（multipart 直传）→ 回填 avatar_url；可移除。
 * React 版头像底色是「蓝→紫渐变」，违反本项目紫色禁令，统一改为 --accent-soft 纯色。
 */
import { ref } from 'vue'
import { Delete, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { API_BASE } from '@/config'

const props = defineProps<{
  value?: string
  name?: string
}>()
const emit = defineEmits<{ (e: 'change', url: string): void }>()

const uploading = ref(false)
const preview = ref<string | null>(props.value ?? null)
const fileInput = ref<HTMLInputElement | null>(null)

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024

async function uploadToServer(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const headers: Record<string, string> = {}
  const token = localStorage.getItem('token')
  if (token) headers.Authorization = `Bearer ${token}`
  const resp = await fetch(`${API_BASE}/upload/avatar`, { method: 'POST', headers, body: formData })
  const data = (await resp.json().catch(() => ({}))) as { avatar_url?: string; detail?: string }
  if (!resp.ok) throw new Error(data.detail || `上传失败 (${resp.status})`)
  if (!data.avatar_url) throw new Error('上传响应缺少 avatar_url')
  return data.avatar_url
}

async function onFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!ALLOWED_TYPES.includes(file.type)) {
    ElMessage.error('只支持 JPG, PNG, GIF, WEBP 格式的图片')
    input.value = ''
    return
  }
  if (file.size > MAX_SIZE) {
    ElMessage.error('图片大小不能超过 5MB')
    input.value = ''
    return
  }
  // 本地预览先行（与 React 版一致：预览不等待上传结果）
  const reader = new FileReader()
  reader.onload = () => { preview.value = String(reader.result ?? '') }
  reader.readAsDataURL(file)

  uploading.value = true
  try {
    const url = await uploadToServer(file)
    preview.value = url
    emit('change', url)
    ElMessage.success('头像已上传')
  } catch (err) {
    preview.value = props.value ?? null
    ElMessage.error(err instanceof Error ? err.message : '上传头像失败')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function pick(): void {
  fileInput.value?.click()
}

function remove(): void {
  preview.value = null
  emit('change', '')
}
</script>

<template>
  <div class="avatar-up">
    <div class="avatar-up__box" :class="{ 'avatar-up__box--empty': !preview }">
      <img v-if="preview" :src="preview" alt="头像预览" class="avatar-up__img" />
      <span v-else class="avatar-up__letter">{{ name?.charAt(0) || '?' }}</span>
    </div>

    <div class="avatar-up__ops min-w-0">
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        class="avatar-up__input"
        @change="onFileChange"
      />
      <div class="avatar-up__btns">
        <el-button size="small" :loading="uploading" @click="pick()">
          <el-icon v-if="!uploading" :size="16"><Upload /></el-icon>
          <span>{{ uploading ? '上传中…' : '上传头像' }}</span>
        </el-button>
        <el-button v-if="preview" size="small" text type="danger" @click="remove()">
          <el-icon :size="16"><Delete /></el-icon><span>移除</span>
        </el-button>
      </div>
      <p class="avatar-up__hint">支持 JPG, PNG, GIF, WEBP，最大 5MB</p>
    </div>
  </div>
</template>

<style scoped>
.avatar-up { display: flex; align-items: center; gap: var(--space-4); }
.avatar-up__box {
  width: 64px; height: 64px; border-radius: var(--radius-pill);
  overflow: hidden; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-soft);
}
.avatar-up__img { width: 100%; height: 100%; object-fit: cover; display: block; }
.avatar-up__letter { font-size: var(--text-xl); font-weight: var(--weight-emphasize); color: var(--accent); }
.avatar-up__ops { display: flex; flex-direction: column; gap: var(--space-1); }
.avatar-up__input { display: none; }
.avatar-up__btns { display: flex; align-items: center; gap: var(--space-2); }
.avatar-up__hint { margin: 0; font-size: var(--text-xs); color: var(--muted); }
</style>
