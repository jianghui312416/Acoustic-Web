<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>个人中心</h1>
        <p>查看账号信息并修改登录密码</p>
      </div>
      <div class="head-actions">
        <button type="button" class="ghost" @click="router.push('/')">返回主界面</button>
        <button v-if="isAdmin" type="button" class="ghost" @click="router.push('/admin/users')">
          用户审核
        </button>
      </div>
    </header>

    <div class="grid">
      <section class="card">
        <h2>账号信息</h2>
        <dl>
          <div><dt>用户名</dt><dd>{{ user?.username }}</dd></div>
          <div><dt>显示名称</dt><dd>{{ user?.display_name || '—' }}</dd></div>
          <div><dt>邮箱</dt><dd>{{ user?.email || '—' }}</dd></div>
          <div><dt>角色</dt><dd>{{ isAdmin ? '管理员' : '普通用户' }}</dd></div>
          <div><dt>注册时间</dt><dd>{{ formatTime(user?.created_at) }}</dd></div>
          <div><dt>最近登录</dt><dd>{{ formatTime(user?.last_login_at) }}</dd></div>
        </dl>
      </section>

      <section class="card">
        <h2>修改密码</h2>
        <form @submit.prevent="submitPassword">
          <label>
            <span>当前密码</span>
            <input v-model="currentPassword" type="password" autocomplete="current-password" required />
          </label>
          <label>
            <span>新密码</span>
            <input v-model="newPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
          </label>
          <label>
            <span>确认新密码</span>
            <input v-model="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
          </label>
          <p v-if="error" class="msg error">{{ error }}</p>
          <p v-if="success" class="msg success">{{ success }}</p>
          <button type="submit" class="primary" :disabled="saving">
            {{ saving ? '保存中…' : '更新密码' }}
          </button>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authState, isAdmin, refreshUser } from '@/modules/auth/authStore.js'
import { changePasswordRequest } from '@/api/authApi.js'
import { authErrorMessage } from '@/api/authHttp.js'

const router = useRouter()
const user = computed(() => authState.user)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const saving = ref(false)
const error = ref('')
const success = ref('')

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

async function submitPassword() {
  if (saving.value) return
  error.value = ''
  success.value = ''
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致。'
    return
  }
  saving.value = true
  try {
    await changePasswordRequest(currentPassword.value, newPassword.value)
    success.value = '密码已更新。'
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    await refreshUser().catch(() => {})
  } catch (exc) {
    error.value = authErrorMessage(exc, '修改密码失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28px clamp(16px, 4vw, 48px) 48px;
  box-sizing: border-box;
  color: #e8fbff;
  background: radial-gradient(circle at 15% 0%, #0a3149 0%, #04101f 45%, #02080f 100%);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.page-head h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 2px;
}

.page-head p {
  margin: 6px 0 0;
  color: #8fb6c6;
  font-size: 14px;
}

.head-actions {
  display: flex;
  gap: 10px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 18px;
  max-width: 1100px;
}

.card {
  padding: 22px 24px;
  border: 1px solid rgba(75, 213, 255, 0.22);
  border-radius: 14px;
  background: rgba(5, 26, 43, 0.82);
}

.card h2 {
  margin: 0 0 16px;
  font-size: 17px;
  color: #bfe9f7;
}

dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(75, 213, 255, 0.1);
}

dl div:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

dt {
  color: #7fa7b8;
  font-size: 13px;
}

dd {
  margin: 0;
  font-size: 14px;
  text-align: right;
  word-break: break-all;
}

form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #9fc2d2;
}

input {
  height: 40px;
  padding: 0 12px;
  box-sizing: border-box;
  color: #eaf9ff;
  font-size: 15px;
  border: 1px solid rgba(75, 213, 255, 0.28);
  border-radius: 8px;
  background: rgba(2, 16, 28, 0.85);
  outline: none;
}

input:focus {
  border-color: rgba(82, 216, 250, 0.85);
  box-shadow: 0 0 0 3px rgba(41, 195, 240, 0.16);
}

.primary,
.ghost {
  height: 38px;
  padding: 0 18px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

.primary {
  margin-top: 4px;
  border: 0;
  color: #041820;
  font-weight: 700;
  background: linear-gradient(135deg, #6fe6ff, #29c3f0);
}

.ghost {
  border: 1px solid rgba(75, 213, 255, 0.4);
  color: #bfe9f7;
  background: rgba(5, 33, 51, 0.7);
}

.ghost:hover {
  border-color: rgba(82, 216, 250, 0.85);
}

.msg {
  margin: 0;
  padding: 8px 11px;
  font-size: 13px;
  border-radius: 8px;
}

.msg.error {
  color: #ffb0b0;
  background: rgba(255, 70, 70, 0.1);
}

.msg.success {
  color: #9ff5c4;
  background: rgba(50, 210, 130, 0.12);
}
</style>
