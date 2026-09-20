<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User } from '@element-plus/icons-vue'
import { fastLogin } from '@/api/users'
import { formatApiError } from '@/api/http'
import { APP_BASE } from '@/config'

/**
 * 登录页（2026-09-20 用户决策：取消账号密码，改手机号免密直登——工器通同款）。
 * 契约：POST /auth/fast-login {phone} → {access_token, token_type, user}（user 含 permissions）。
 * 后端仅在 FAST_LOGIN=true 时启用；手机号未注册/禁用 → 401，由本页提示。
 * 成功后整页跳转（location.href）：刷新 useCurrentUser 等模块级单例缓存，
 * 避免登录前触发的「未取到当前用户」状态残留。
 */
const route = useRoute()
const phone = ref('')
const loading = ref(false)

const canSubmit = computed(() => phone.value.trim().length > 0)

async function submit() {
  if (!canSubmit.value || loading.value) return
  loading.value = true
  try {
    const res = await fastLogin(phone.value.trim())
    localStorage.setItem('token', res.access_token)
    localStorage.setItem('user', JSON.stringify(res.user))
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    // 只接受站内相对路径，防开放重定向
    const target =
      redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : APP_BASE
    window.location.href = target
  } catch (e) {
    ElMessage.error(formatApiError(e))
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-logo">运</div>
        <h1 class="login-title">运维管理系统</h1>
        <p class="login-sub">GTC 设备资产 · 工单 · 盘点</p>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="手机号">
          <el-input
            v-model="phone"
            placeholder="请输入手机号，免密直接登录"
            :prefix-icon="User"
            size="large"
            inputmode="numeric"
            autocomplete="username"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="login-btn"
          :loading="loading"
          :disabled="!canSubmit"
          native-type="submit"
        >
          直接登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: var(--space-5);
}

.login-card {
  width: 380px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg, 12px);
  padding: var(--space-7, 32px) var(--space-6, 24px);
  box-shadow: var(--shadow-sm, 0 1px 3px rgb(0 0 0 / 8%));
}

.login-brand {
  text-align: center;
  margin-bottom: var(--space-6, 24px);
}

.login-logo {
  width: 48px;
  height: 48px;
  margin: 0 auto var(--space-3, 12px);
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 22px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-title {
  margin: 0;
  font-size: var(--text-lg, 18px);
  color: var(--fg);
}

.login-sub {
  margin: var(--space-2, 8px) 0 0;
  font-size: var(--text-sm, 13px);
  color: var(--fg-2);
}

.login-btn {
  width: 100%;
  margin-top: var(--space-2, 8px);
}
</style>
