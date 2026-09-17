<script setup lang="ts">
/**
 * 账户信息表单（系统设置）
 * =====================================================================
 * 表单状态由本组件持有；父组件通过 user 传入当前编辑对象，watch 回填。
 * 管理员的「部门」用下拉（DEPARTMENTS）；普通用户锁死为只读（由管理员设置）。
 * 姓名必填校验在本组件做（报错时机与文案对齐 React 版 SettingsPage）。
 */
import { reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { DEPARTMENTS, type User } from '@/types/user'

const props = defineProps<{
  /** 正在编辑的用户（null 时不可保存） */
  user: User | null
  isAdmin: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  (e: 'save', data: { name: string; department?: string; position?: string; phone?: string }): void
}>()

const form = reactive({ name: '', department: '', position: '', phone: '' })

watch(
  () => props.user,
  (u) => {
    if (!u) return
    form.name = u.name || ''
    form.department = u.department || ''
    form.position = u.position || ''
    form.phone = u.phone || ''
  },
  { immediate: true },
)

function submit(): void {
  if (!props.user) return
  if (!form.name.trim()) {
    ElMessage.error('姓名不能为空')
    return
  }
  emit('save', {
    name: form.name.trim(),
    department: form.department.trim() || undefined,
    position: form.position.trim() || undefined,
    phone: form.phone.trim() || undefined,
  })
}
</script>

<template>
  <section class="panel acct min-w-0">
    <h2 class="acct__title">账户信息</h2>
    <p class="acct__desc">
      {{ user ? `正在编辑：${user.name}（${user.email}）` : '更新账户信息' }}
    </p>

    <el-form label-width="72px" label-position="right" class="acct__form" @submit.prevent="submit">
      <el-form-item label="姓名" required>
        <el-input v-model="form.name" placeholder="请输入姓名" maxlength="50" />
      </el-form-item>
      <el-form-item label="部门">
        <el-select
          v-if="isAdmin"
          v-model="form.department"
          placeholder="请选择部门"
          clearable
          class="acct__select"
        >
          <el-option v-for="dept in DEPARTMENTS" :key="dept" :value="dept" :label="dept" />
        </el-select>
        <el-input v-else :model-value="form.department" disabled placeholder="由管理员设置" />
      </el-form-item>
      <el-form-item label="职位">
        <el-input v-model="form.position" placeholder="请输入职位" maxlength="50" />
      </el-form-item>
      <el-form-item label="手机号">
        <el-input v-model="form.phone" placeholder="请输入手机号" maxlength="30" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" :disabled="!user" @click="submit">
          {{ saving ? '保存中…' : '保存更改' }}
        </el-button>
      </el-form-item>
    </el-form>
  </section>
</template>

<style scoped>
.acct { display: flex; flex-direction: column; }
.acct__title { margin: 0 0 var(--space-1); font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }
.acct__desc { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--muted); }
.acct__form { max-width: 480px; }
.acct__select { width: 100%; min-width: 0; }
</style>
