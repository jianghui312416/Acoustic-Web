<template>
  <div class="auth-page">
    <AuthBackdrop />

    <main class="auth-main">
      <form v-if="!successMessage" class="auth-card" @submit.prevent="submit">
        <span class="card-edge" aria-hidden="true"></span>

        <header class="auth-brand">
          <div class="brand-logo">
            <AcousticLogo />
          </div>
          <div class="brand-copy">
            <h1>注册账号</h1>
            <p>提交后需管理员审核通过才能登录</p>
          </div>
        </header>

        <div class="auth-fields">
          <label class="auth-field">
            <span class="field-label">用户名</span>
            <div class="input-shell">
              <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7" />
                <path d="M4.8 20c.9-4 3.7-6 7.2-6s6.3 2 7.2 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              </svg>
              <input v-model.trim="form.username" autocomplete="username" minlength="3" maxlength="32" spellcheck="false" required />
            </div>
            <small class="field-hint">3-32 位字母、数字、点、下划线或短横线</small>
          </label>

          <label class="auth-field">
            <span class="field-label">邮箱（选填）</span>
            <div class="input-shell">
              <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7" />
                <path d="m5 7.5 7 5 7-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <input v-model.trim="form.email" type="email" maxlength="255" autocomplete="email" spellcheck="false" />
            </div>
          </label>

          <label class="auth-field">
            <span class="field-label">显示名称（选填）</span>
            <div class="input-shell">
              <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="5" width="16" height="14" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.7" />
                <path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              </svg>
              <input v-model.trim="form.display_name" maxlength="64" />
            </div>
          </label>

          <label class="auth-field">
            <span class="field-label">密码</span>
            <div class="input-shell">
              <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                <circle cx="12" cy="15.2" r="1.35" fill="currentColor" />
              </svg>
              <input v-model="form.password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
            </div>
          </label>

          <label class="auth-field">
            <span class="field-label">确认密码</span>
            <div class="input-shell">
              <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7" />
                <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                <path d="m9.5 15.2 1.8 1.8 3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <input v-model="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
            </div>
          </label>
        </div>

        <p v-if="error" class="auth-error">{{ error }}</p>

        <button class="auth-submit" type="submit" :disabled="loading">
          <span class="submit-text">{{ loading ? '提交中…' : '提交注册申请' }}</span>
        </button>

        <p class="auth-links">
          已有账号？
          <router-link to="/login">返回登录</router-link>
        </p>
      </form>

      <div v-else class="auth-card auth-result">
        <span class="card-edge" aria-hidden="true"></span>
        <div class="result-logo">
          <AcousticLogo />
        </div>
        <h1>注册成功</h1>
        <p>{{ successMessage }}</p>
        <button class="auth-submit" type="button" @click="router.replace('/login')">
          <span class="submit-text">前往登录</span>
        </button>
      </div>

      <footer class="auth-footer">
        <span>v1.0.0</span>
        <span class="footer-dot">·</span>
        <span>© 2026 星图深海 海洋声场分析系统</span>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AuthBackdrop from '@/components/auth/AuthBackdrop.vue'
import AcousticLogo from '@/components/auth/AcousticLogo.vue'
import { registerRequest } from '@/api/authApi.js'
import { authErrorMessage } from '@/api/authHttp.js'

const router = useRouter()
const form = reactive({
  username: '',
  email: '',
  display_name: '',
  password: '',
})
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')
const successMessage = ref('')

async function submit() {
  if (loading.value) return
  error.value = ''
  if (form.password !== confirmPassword.value) {
    error.value = '两次输入的密码不一致。'
    return
  }
  loading.value = true
  try {
    const data = await registerRequest({
      username: form.username,
      email: form.email || null,
      display_name: form.display_name || null,
      password: form.password,
    })
    successMessage.value = data.message || '注册成功，请等待管理员审核。'
    if (data.user?.status === 'active') {
      successMessage.value = '注册成功，请使用新账号登录。'
    }
  } catch (exc) {
    error.value = authErrorMessage(exc, '注册失败，请稍后再试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  color: #e8fbff;
  background: #02111f;
}

.auth-main {
  position: relative;
  z-index: 2;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 44px 20px 86px;
  box-sizing: border-box;
}

.auth-card {
  position: relative;
  width: min(540px, 100%);
  padding: 38px 42px 32px;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid rgba(128, 242, 255, 0.42);
  border-radius: 24px;
  background:
    linear-gradient(132deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.03) 24%, transparent 44%, transparent 68%, rgba(110, 232, 255, 0.08) 100%),
    linear-gradient(158deg, rgba(10, 46, 72, 0.74) 0%, rgba(6, 32, 53, 0.64) 52%, rgba(3, 22, 38, 0.62) 100%);
  box-shadow:
    0 44px 110px rgba(0, 5, 14, 0.72),
    0 0 54px rgba(40, 200, 245, 0.3),
    0 0 0 1px rgba(80, 230, 255, 0.08),
    inset 0 1px 0 rgba(220, 254, 255, 0.36),
    inset 0 -34px 70px rgba(2, 15, 27, 0.32);
  backdrop-filter: blur(26px) saturate(160%) brightness(1.06);
  -webkit-backdrop-filter: blur(26px) saturate(160%) brightness(1.06);
  animation: fade-in 0.6s ease both;
}

.auth-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(142deg, rgba(196, 250, 255, 0.85), rgba(90, 224, 255, 0.16) 26%, rgba(70, 200, 240, 0.06) 60%, rgba(150, 244, 255, 0.55));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

.auth-card > .auth-brand,
.auth-card > .auth-fields,
.auth-card > .auth-error,
.auth-card > .auth-submit,
.auth-card > .auth-links,
.auth-card > .auth-result,
.auth-card > .result-logo,
.auth-card > .auth-result h1,
.auth-card > .auth-result p {
  position: relative;
  z-index: 1;
}

.card-edge {
  position: absolute;
  top: 0;
  right: 12%;
  left: 12%;
  z-index: 3;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(190, 252, 255, 0.95), transparent);
  box-shadow: 0 0 16px rgba(92, 232, 255, 0.75);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-bottom: 28px;
}

.brand-logo {
  flex: 0 0 68px;
  width: 68px;
  height: 68px;
}

.brand-copy {
  min-width: 0;
  padding-left: 20px;
  border-left: 1px solid rgba(120, 208, 234, 0.28);
}

.brand-copy h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2.4px;
  white-space: nowrap;
  text-shadow: 0 0 24px rgba(90, 230, 255, 0.32);
}

.brand-copy p {
  margin: 8px 0 0;
  color: #8fb6c6;
  font-size: 12.5px;
  letter-spacing: 0.5px;
}

.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 17px;
}

.auth-field {
  display: block;
}

.field-label {
  display: block;
  margin-bottom: 9px;
  color: #d5edf5;
  font-size: 14.5px;
  letter-spacing: 1.1px;
}

.field-hint {
  display: block;
  margin-top: 6px;
  color: #6f93a3;
  font-size: 11px;
}

.input-shell {
  position: relative;
  display: flex;
  align-items: center;
  height: 50px;
  border: 1px solid rgba(100, 198, 228, 0.3);
  border-radius: 11px;
  background: rgba(2, 18, 32, 0.68);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.input-shell:focus-within {
  border-color: rgba(110, 240, 255, 0.9);
  background: rgba(3, 25, 42, 0.88);
  box-shadow:
    0 0 0 1px rgba(80, 220, 255, 0.5),
    0 0 22px rgba(40, 200, 240, 0.26);
}

.field-icon {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin-left: 16px;
  color: #63cfe8;
  opacity: 0.85;
}

.input-shell input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 14px;
  border: 0;
  outline: 0;
  color: #eaf9ff;
  font-size: 16px;
  letter-spacing: 0.4px;
  background: transparent;
  caret-color: #6fe9ff;
}

.auth-error {
  margin: 15px 0 0;
  padding: 9px 12px;
  color: #ffb3b3;
  font-size: 13px;
  border: 1px solid rgba(255, 99, 99, 0.38);
  border-radius: 8px;
  background: rgba(255, 70, 70, 0.1);
}

.auth-submit {
  position: relative;
  width: 100%;
  height: 54px;
  margin-top: 24px;
  overflow: hidden;
  border: 0;
  border-radius: 11px;
  color: #032430;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 6px;
  text-indent: 6px;
  background: linear-gradient(100deg, #bdfcff 0%, #46e4ff 30%, #22ccf3 64%, #0aa6d8 100%);
  box-shadow:
    0 16px 38px rgba(18, 170, 215, 0.38),
    0 0 24px rgba(70, 220, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
}

.auth-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.05);
  box-shadow:
    0 18px 40px rgba(24, 190, 235, 0.42),
    0 0 26px rgba(80, 230, 255, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.auth-submit:disabled {
  opacity: 0.66;
  cursor: default;
}

.submit-text {
  position: relative;
  z-index: 1;
}

.auth-links {
  margin: 18px 0 0;
  color: #93b8c7;
  font-size: 13.5px;
  text-align: center;
}

.auth-links a {
  margin-left: 6px;
  color: #52e2ff;
  text-decoration: none;
  text-shadow: 0 0 12px rgba(70, 225, 255, 0.35);
}

.auth-links a:hover {
  text-decoration: underline;
}

.auth-result {
  padding: 40px 36px 34px;
  text-align: center;
}

.result-logo {
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
}

.auth-result h1 {
  margin: 0 0 10px;
  font-size: 24px;
  letter-spacing: 2px;
}

.auth-result p {
  margin: 0 0 4px;
  color: #9fc2d2;
  font-size: 14px;
  line-height: 1.7;
}

.auth-footer {
  position: absolute;
  right: 0;
  bottom: 20px;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(150, 200, 220, 0.55);
  font-size: 12px;
  letter-spacing: 1px;
}

.footer-dot {
  opacity: 0.6;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 520px) {
  .auth-card {
    padding: 26px 20px 22px;
    border-radius: 18px;
  }

  .auth-brand {
    gap: 13px;
    margin-bottom: 20px;
  }

  .brand-logo {
    flex-basis: 50px;
    width: 50px;
    height: 50px;
  }

  .brand-copy {
    padding-left: 13px;
  }

  .brand-copy h1 {
    font-size: 20px;
    letter-spacing: 1.5px;
  }

  .auth-footer {
    font-size: 11px;
    flex-wrap: wrap;
    padding: 0 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-card {
    animation: none;
  }
}
</style>
