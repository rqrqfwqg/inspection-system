<script setup lang="ts">
/**
 * 修改密码表单（系统设置）
 * =====================================================================
 * 校验在本组件内完成（三项必填 / 两次一致 / 至少 6 位），文案与时机对齐 React 版；
 * 通过校验后才向父组件发 save，由父组件调用 POST /users/change-password。
 */
import { reactive } from 'vue'
import { ElMessage } from 'element-plus'
import type { User } from '@/types/user'

const props = defineProps<{
  user: User | null
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'save', data: { currentPassword: string; newPassword: string }): void
}>()

const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

function submit(): void {
  if (!props.user) return
  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
    ElMessage.error('请填写所有密码字段')
    return
  }
  if (form.newPassword !== form.confirmPassword) {
    ElMessage.error('两次输入的新密码不一致')
    return
  }
  if (form.newPassword.length < 6) {
    ElMessage.error('新密码长度至少6位')
    return
  }
  emit('save', { currentPassword: form.currentPassword, newPassword: form.newPassword })
}

/** 成功后由父组件通知清空（避免父组件直接改子组件内部状态） */
function clear(): void {
  form.currentPassword = ''
  form.newPassword = ''
  form.confirmPassword = ''
}
defineExpose({ clear })
</script>

<template>
  <section class="panel pwd min-w-0">
    <h2 class="pwd__title">修改密码</h2>
    <p class="pwd__desc">{{ user ? `修改 ${user.name} 的登录密码` : '修改登录密码' }}</p>

    <el-form label-width="96px" label-position="right" class="pwd__form" @submit.prevent="submit">
      <el-form-item label="当前密码" required>
        <el-input v-model="form.currentPassword" type="password" placeholder="请输入当前密码" show-password />
      </el-form-item>
      <el-form-item label="新密码" required>
        <el-input v-model="form.newPassword" type="password" placeholder="至少6位" show-password />
      </el-form-item>
      <el-form-item label="确认新密码" required>
        <el-input v-model="form.confirmPassword" type="password" placeholder="再次输入新密码" show-password />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" :disabled="!user" @click="submit">
          {{ saving ? '更新中…' : '更新密码' }}
        </el-button>
      </el-form-item>
    </el-form>
  </section>
</template>

<style scoped>
.pwd { display: flex; flex-direction: column; }
.pwd__title { margin: 0 0 var(--space-1); font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }
.pwd__desc { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--muted); }
.pwd__form { max-width: 480px; }
</style>
