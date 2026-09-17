<script setup lang="ts">
/**
 * 现场照片面板：调用系统相机/相册上传（multipart 直传），多图展示，可删除。
 */
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Camera, Delete, Loading } from '@element-plus/icons-vue'
import { scanDeletePhoto, scanListPhotos, scanUploadPhoto } from '@/api/scan'
import type { DevicePhotoItem } from '@/types/scan'

const props = defineProps<{ deviceId: number }>()

const photos = ref<DevicePhotoItem[]>([])
const loading = ref(true)
const uploading = ref(false)
const note = ref('')
const fileRef = ref<HTMLInputElement | null>(null)

async function reload() {
  loading.value = true
  try {
    photos.value = await scanListPhotos(props.deviceId)
  } catch (e) {
    ElMessage({ type: 'error', message: `照片加载失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  } finally {
    loading.value = false
  }
}

onMounted(() => { void reload() })

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    await scanUploadPhoto(props.deviceId, file, note.value.trim())
    note.value = ''
    ElMessage({ type: 'success', message: '照片已上传' })
    await reload()
  } catch (err) {
    ElMessage({ type: 'error', message: `上传失败：${err instanceof Error ? err.message : ''}`, duration: 4000 })
  } finally {
    uploading.value = false
  }
}

async function remove(p: DevicePhotoItem) {
  try {
    await ElMessageBox.confirm('删除这张现场照片？删除后不可恢复。', '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await scanDeletePhoto(p.id)
    ElMessage({ type: 'success', message: '已删除' })
    await reload()
  } catch (err) {
    ElMessage({ type: 'error', message: `删除失败：${err instanceof Error ? err.message : ''}`, duration: 4000 })
  }
}

function pick() {
  fileRef.value?.click()
}
</script>

<template>
  <div class="photo-panel">
    <div class="photo-panel__bar">
      <el-input
        v-model="note"
        placeholder="拍摄说明（可选，如：柜内铭牌 / 背面接线）"
        aria-label="拍摄说明"
        class="photo-panel__note"
      />
      <input
        ref="fileRef"
        type="file"
        accept="image/*"
        class="photo-panel__file"
        aria-label="选择照片"
        @change="onPick"
      />
      <el-button type="primary" :loading="uploading" class="photo-panel__upload" @click="pick">
        <el-icon v-if="!uploading" :size="16"><Camera /></el-icon>
        <el-icon v-else :size="16" class="is-loading"><Loading /></el-icon>
        <span>拍摄/上传</span>
      </el-button>
    </div>

    <p v-if="loading" class="photo-panel__meta">加载照片中…</p>
    <p v-else-if="photos.length === 0" class="photo-panel__meta">暂无现场照片，拍一张铭牌或安装位置。</p>

    <div v-else class="photo-panel__grid">
      <figure v-for="p in photos" :key="p.id" class="photo-panel__item">
        <img :src="p.url" :alt="p.note || '现场照片'" class="photo-panel__img" loading="lazy" />
        <figcaption v-if="p.note" class="photo-panel__cap ellipsis">{{ p.note }}</figcaption>
        <button type="button" class="photo-panel__del" aria-label="删除照片" @click="remove(p)">
          <el-icon :size="14"><Delete /></el-icon>
        </button>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.photo-panel { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.photo-panel__bar { display: flex; gap: var(--space-2); min-width: 0; }
.photo-panel__note { flex: 1 1 auto; min-width: 0; }
.photo-panel__upload { flex: 0 0 auto; }
.photo-panel__file { display: none; }
.photo-panel__meta { margin: 0; font-size: var(--text-sm); color: var(--muted); }
.photo-panel__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.photo-panel__item { position: relative; margin: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); }
/* 防压扁：缩略图用 aspect-ratio + object-fit，绝不写死宽高像素（AS-6） */
.photo-panel__img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.photo-panel__cap { margin: 0; padding: var(--space-1) var(--space-1); font-size: var(--text-xs); color: var(--fg-2); }
.photo-panel__del {
  position: absolute; top: var(--space-1); right: var(--space-1);
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; border: none; border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.55); color: #fff; cursor: pointer;
}
</style>
