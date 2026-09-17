<script setup lang="ts">
/**
 * 用户管理（/users）—— React 版 UsersPage 等价迁移
 * =====================================================================
 * 行为对齐：
 *  - 列表一次拉全量（GET /users），搜索为前端 name/email 过滤（与 React 版一致，无分页）
 *  - 新建：email/name/password 三项必填（缺失给明确报错）；编辑：只更新有值字段
 *  - 删除：二次确认后 DELETE /users/{id}，成功后本地移除并提示
 *  - 创建/更新成功后重拉列表
 * 与 React 版的差异（如实登记，见交付报告）：
 *  - React 版下拉里的「查看详情」没有任何处理函数（点击无效果），属死入口，未迁移
 *  - window.confirm 换成 ElMessageBox.confirm；toast 换成 ElMessage
 */
import { computed, onMounted, ref } from 'vue'
import { Delete, Plus, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHead from '@/components/common/PageHead.vue'
import UserFormDialog from '@/components/user/UserFormDialog.vue'
import { createUser, deleteUser, getUsers, updateUser } from '@/api/users'
import { fmtBeijingUtc } from '@/lib/format'
import type { User } from '@/types/user'

const ROLE_LABELS: Record<string, string> = { admin: '管理员', moderator: '版主', user: '用户' }

const users = ref<User[]>([])
const loading = ref(true)
const searchQuery = ref('')
const dialogOpen = ref(false)
const editingUser = ref<User | null>(null)
const saving = ref(false)

const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter(
    (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
  )
})

async function loadUsers(): Promise<void> {
  loading.value = true
  try {
    users.value = await getUsers()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '无法加载用户列表')
  } finally {
    loading.value = false
  }
}

onMounted(loadUsers)

function handleAddUser(): void {
  editingUser.value = null
  dialogOpen.value = true
}

function handleEditUser(user: User): void {
  editingUser.value = user
  dialogOpen.value = true
}

async function handleDeleteUser(user: User): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户「${user.name}」（${user.email}）吗？删除后该账号将无法登录。`,
      '删除用户',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteUser(user.id)
    users.value = users.value.filter((u) => u.id !== user.id)
    ElMessage.success('用户已成功删除')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除用户失败')
  }
}

async function handleSaveUser(data: Partial<User> & { password?: string }): Promise<void> {
  saving.value = true
  try {
    if (editingUser.value) {
      const payload: { name?: string; department?: string; position?: string; phone?: string; avatar?: string } = {}
      if (data.name) payload.name = data.name
      if (data.department) payload.department = data.department
      if (data.position) payload.position = data.position
      if (data.phone) payload.phone = data.phone
      payload.avatar = data.avatar ?? ''
      await updateUser(editingUser.value.id, payload)
      ElMessage.success('用户信息已更新')
    } else {
      if (!data.email) {
        ElMessage.error('请输入邮箱')
        return
      }
      if (!data.name) {
        ElMessage.error('请输入姓名')
        return
      }
      if (!data.password) {
        ElMessage.error('请输入密码')
        return
      }
      await createUser({
        email: data.email,
        password: data.password,
        name: data.name,
        department: data.department || undefined,
        position: data.position || undefined,
        phone: data.phone || undefined,
        avatar: data.avatar || undefined,
      })
      ElMessage.success('新用户已添加')
    }
    dialogOpen.value = false
    await loadUsers()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存用户失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="users">
    <PageHead title="用户管理" desc="项目管理部运维系统中的所有用户">
      <template #actions>
        <el-button type="primary" @click="handleAddUser">
          <el-icon :size="16"><Plus /></el-icon><span>添加用户</span>
        </el-button>
      </template>
    </PageHead>

    <div class="panel users__card min-w-0">
      <div class="users__toolbar">
        <p class="users__title">用户列表</p>
        <el-input
          v-model="searchQuery"
          class="users__search"
          placeholder="搜索姓名或邮箱…"
          clearable
          :prefix-icon="Search"
        />
      </div>

      <div class="data-table-wrap users__table min-w-0" v-loading="loading">
        <el-table :data="filteredUsers" style="width: 100%" row-key="id">
          <el-table-column label="用户" min-width="180" fixed="left" show-overflow-tooltip>
            <template #default="{ row }">
              <div class="users__who">
                <span class="users__avatar">
                  <img v-if="row.avatar" :src="row.avatar" :alt="row.name" class="users__avatar-img" />
                  <span v-else class="users__avatar-letter">{{ row.name.charAt(0).toUpperCase() }}</span>
                </span>
                <span class="users__name ellipsis">{{ row.name }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="email" label="邮箱" min-width="200" show-overflow-tooltip />
          <el-table-column label="部门" min-width="100" show-overflow-tooltip>
            <template #default="{ row }">{{ row.department || '—' }}</template>
          </el-table-column>
          <el-table-column label="职位" min-width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ row.position || '—' }}</template>
          </el-table-column>
          <el-table-column label="角色" min-width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.role === 'admin' ? 'primary' : 'info'">
                {{ ROLE_LABELS[row.role] ?? row.role }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.is_active ? 'success' : 'info'">
                {{ row.is_active ? '活跃' : '未激活' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="注册时间" min-width="150">
            <template #default="{ row }">
              <span class="tnum">{{ fmtBeijingUtc(row.created_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="88" fixed="right" align="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="handleEditUser(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="handleDeleteUser(row)">
                <el-icon :size="14"><Delete /></el-icon><span>删除</span>
              </el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty
              :description="searchQuery ? `没有姓名或邮箱包含「${searchQuery}」的用户` : '系统中还没有用户，点右上角「添加用户」创建第一个账号'"
              :image-size="72"
            />
          </template>
        </el-table>
      </div>

      <p class="users__meta tnum">显示 {{ filteredUsers.length }} 条，共 {{ users.length }} 条</p>
    </div>

    <UserFormDialog v-model="dialogOpen" :user="editingUser" @save="handleSaveUser" />
  </div>
</template>

<style scoped>
.users { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.users__card { display: flex; flex-direction: column; gap: var(--space-3); }
.users__toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); flex-wrap: wrap;
}
.users__title { margin: 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.users__search { width: min(280px, 100%); }

.users__who { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.users__avatar {
  width: 28px; height: 28px; border-radius: var(--radius-pill); flex: 0 0 auto;
  overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: var(--accent-soft);
}
.users__avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.users__avatar-letter { font-size: var(--text-sm); font-weight: var(--weight-emphasize); color: var(--accent); }
.users__name { font-weight: var(--weight-emphasize); color: var(--fg); }

.users__meta { margin: 0; font-size: var(--text-sm); color: var(--muted); }
</style>
