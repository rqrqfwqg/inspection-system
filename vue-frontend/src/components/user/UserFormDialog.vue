<script setup lang="ts">
/**
 * 新建 / 编辑用户对话框（用户管理）
 * =====================================================================
 * 交互对齐 React 版 UserFormDialog：
 *  - 编辑态：邮箱锁定不可改；只回传有值的 department/position/phone（avatar/name 恒传）
 *  - 新建态：邮箱/姓名/密码必填校验在父组件 handleSave 内做（与 React 版一致）；
 *    密码留空则用默认密码 123456890
 * 校验提示统一走 ElMessage，不用 el-form rules —— 与 React 版的报错时机保持等价。
 */
import { reactive, watch } from 'vue'
import { DEPARTMENTS, type User } from '@/types/user'
import AvatarUpload from './AvatarUpload.vue'

const props = defineProps<{
  /** true=编辑已有用户；false=新建 */
  user: User | null
}>()

const visible = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  (e: 'save', data: Partial<User> & { password?: string }): void
}>()

const form = reactive({
  name: '',
  email: '',
  password: '123456890',
  department: '',
  position: '',
  phone: '',
  avatar: '',
})

watch(
  () => [props.user, visible.value] as const,
  ([user, open]) => {
    if (!open) return
    if (user) {
      form.name = user.name
      form.email = user.email
      form.password = ''
      form.department = user.department || ''
      form.position = user.position || ''
      form.phone = user.phone || ''
      form.avatar = user.avatar || ''
    } else {
      form.name = ''
      form.email = ''
      form.password = '123456890'
      form.department = ''
      form.position = ''
      form.phone = ''
      form.avatar = ''
    }
  },
  { immediate: true },
)

function submit(): void {
  if (props.user) {
    // 编辑模式：只传有值的可选字段（对齐 React 版）
    const payload: Partial<User> = { name: form.name, avatar: form.avatar }
    if (form.department) payload.department = form.department
    if (form.position) payload.position = form.position
    if (form.phone) payload.phone = form.phone
    emit('save', payload)
  } else {
    emit('save', {
      name: form.name,
      email: form.email,
      password: form.password,
      department: form.department || undefined,
      position: form.position || undefined,
      phone: form.phone || undefined,
      avatar: form.avatar || undefined,
    })
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="user ? '编辑用户' : '添加用户'"
    width="min(520px, 92vw)"
    append-to-body
    :close-on-click-modal="false"
  >
    <p class="udialog__desc">{{ user ? '修改用户信息' : '创建新的用户账号' }}</p>

    <el-form class="udialog__form" label-width="72px" label-position="right" @submit.prevent="submit">
      <el-form-item label="头像">
        <AvatarUpload :value="form.avatar" :name="form.name" @change="(url: string) => (form.avatar = url)" />
      </el-form-item>
      <el-form-item label="姓名" required>
        <el-input v-model="form.name" placeholder="请输入姓名" maxlength="50" />
      </el-form-item>
      <el-form-item label="邮箱" :required="!user">
        <el-input v-model="form.email" type="email" placeholder="请输入邮箱" :disabled="!!user" />
        <span v-if="user" class="udialog__hint">邮箱不可修改</span>
      </el-form-item>
      <el-form-item v-if="!user" label="密码">
        <el-input v-model="form.password" type="password" placeholder="默认密码：123456890" show-password />
        <span class="udialog__hint">不填则使用默认密码 123456890</span>
      </el-form-item>
      <el-form-item label="部门">
        <el-select v-model="form.department" placeholder="请选择部门" clearable class="udialog__select">
          <el-option v-for="dept in DEPARTMENTS" :key="dept" :value="dept" :label="dept" />
        </el-select>
      </el-form-item>
      <el-form-item label="职位">
        <el-input v-model="form.position" placeholder="请输入职位" maxlength="50" />
      </el-form-item>
      <el-form-item label="电话">
        <el-input v-model="form.phone" placeholder="请输入电话" maxlength="30" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="submit">{{ user ? '保存' : '创建' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.udialog__desc { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--muted); }
.udialog__form { padding-right: var(--space-2); }
.udialog__hint { display: block; width: 100%; font-size: var(--text-xs); color: var(--muted); line-height: var(--leading-snug); }
.udialog__select { width: 100%; min-width: 0; }
</style>
