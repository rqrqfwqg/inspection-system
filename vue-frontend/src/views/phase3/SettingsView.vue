<script setup lang="ts">
/**
 * 系统设置（/settings）—— React 版 SettingsPage 等价迁移
 * =====================================================================
 * 行为对齐：
 *  - 管理员：加载全部用户 → 点选要编辑的账户（默认选中当前登录用户）；可改任意用户的
 *    资料（姓名/部门/职位/手机号）与密码
 *  - 普通用户：只能编辑自己的资料；部门为只读（由管理员设置）
 *  - 修改的是当前登录用户时，保存后刷新全局当前用户（React 版 refreshUser 等价）
 *  - 密码修改成功后清空三个密码框
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AccountForm from '@/components/system/AccountForm.vue'
import PasswordForm from '@/components/system/PasswordForm.vue'
import PageHead from '@/components/common/PageHead.vue'
import { changePassword, getUsers, updateUser } from '@/api/users'
import { useCurrentUser } from '@/composables/useCurrentUser'
import type { User } from '@/types/user'

const { currentUser, reload: reloadCurrentUser } = useCurrentUser()

const isAdmin = computed(() => currentUser.value?.role === 'admin')

const users = ref<User[]>([])
const usersError = ref('')
const selectedUserId = ref<number | null>(null)
const savingInfo = ref(false)
const changingPwd = ref(false)

const passwordFormRef = ref<InstanceType<typeof PasswordForm> | null>(null)

const selectedUser = computed<User | null>(() => {
  if (isAdmin.value) return users.value.find((u) => u.id === selectedUserId.value) ?? null
  return currentUser.value
})

onMounted(async () => {
  if (!isAdmin.value) {
    if (currentUser.value) selectedUserId.value = currentUser.value.id
    return
  }
  try {
    const list = await getUsers()
    users.value = list
    const me = list.find((u) => u.id === currentUser.value?.id) ?? list[0]
    if (me) selectedUserId.value = me.id
  } catch (e) {
    usersError.value = e instanceof Error ? e.message : '无法加载用户列表'
    ElMessage.error(usersError.value)
  }
})

function pickUser(u: User): void {
  selectedUserId.value = u.id
}

async function handleSaveInfo(data: {
  name: string
  department?: string
  position?: string
  phone?: string
}): Promise<void> {
  if (!selectedUserId.value) return
  savingInfo.value = true
  try {
    await updateUser(selectedUserId.value, data)
    if (selectedUserId.value === currentUser.value?.id) await reloadCurrentUser()
    if (isAdmin.value) {
      users.value = users.value.map((u) =>
        u.id === selectedUserId.value
          ? { ...u, name: data.name, department: data.department ?? null, position: data.position ?? null, phone: data.phone ?? null }
          : u,
      )
    }
    ElMessage.success('账户信息已更新')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '更新失败')
  } finally {
    savingInfo.value = false
  }
}

async function handleChangePassword(data: { currentPassword: string; newPassword: string }): Promise<void> {
  if (!selectedUserId.value) return
  changingPwd.value = true
  try {
    await changePassword(selectedUserId.value, data.currentPassword, data.newPassword)
    passwordFormRef.value?.clear()
    ElMessage.success('密码已更新，新密码已生效')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '密码修改失败')
  } finally {
    changingPwd.value = false
  }
}
</script>

<template>
  <div class="settings">
    <PageHead
      title="系统设置"
      :desc="isAdmin ? '管理员可编辑所有用户账户信息' : '管理您的个人账户信息和密码'"
    />

    <div v-if="isAdmin && users.length" class="panel settings__picker min-w-0">
      <h2 class="settings__picker-title">选择用户</h2>
      <p class="settings__picker-desc">选择要修改设置的用户账户</p>
      <div class="settings__chips">
        <button
          v-for="u in users"
          :key="u.id"
          type="button"
          class="settings__chip"
          :class="{ 'settings__chip--on': u.id === selectedUserId }"
          @click="pickUser(u)"
        >
          {{ u.name }}
          <span v-if="u.role === 'admin'" class="settings__chip-role">(管理员)</span>
          <span v-if="u.department" class="settings__chip-dept">· {{ u.department }}</span>
        </button>
      </div>
    </div>

    <el-alert
      v-if="isAdmin && usersError"
      type="warning"
      :closable="false"
      :title="`用户列表加载失败：${usersError}`"
      description="选择用户不可用；若您是普通用户身份请直接在下方编辑自己的账户信息。"
      show-icon
    />

    <template v-if="selectedUser">
      <AccountForm
        :user="selectedUser"
        :is-admin="isAdmin"
        :saving="savingInfo"
        @save="handleSaveInfo"
      />
      <PasswordForm
        ref="passwordFormRef"
        :user="selectedUser"
        :saving="changingPwd"
        @save="handleChangePassword"
      />
    </template>
    <el-empty
      v-else-if="!currentUser"
      description="尚未取到当前登录用户信息（/users/me 不可达且本地无缓存），无法编辑账户设置，请刷新页面重试"
      :image-size="88"
    />
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: var(--space-4); max-width: var(--form-max); min-width: 0; }

.settings__picker { display: flex; flex-direction: column; }
.settings__picker-title { margin: 0 0 var(--space-1); font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }
.settings__picker-desc { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--muted); }
.settings__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.settings__chip {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--fg-2);
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}
.settings__chip:hover { border-color: var(--accent-hover); }
.settings__chip--on { background: var(--accent); border-color: var(--accent); color: var(--accent-on); }
.settings__chip-role { font-size: var(--text-xs); opacity: 0.75; }
.settings__chip-dept { font-size: var(--text-xs); opacity: 0.6; font-weight: var(--weight-read); }
</style>
