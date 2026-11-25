<template>
  <div class="auth-page">
    <AuthBackdrop />

    <main class="auth-main">
      <div class="auth-card-wrap">
        <div class="card-aura" aria-hidden="true"></div>
        <form class="auth-card" @submit.prevent="submit">
          <span class="card-edge" aria-hidden="true"></span>

          <header class="auth-brand">
          <div class="brand-logo">
            <AcousticLogo />
          </div>
          <div class="brand-copy">
            <h1>海洋声场分析</h1>
            <p>登录后使用声场计算与可视化服务</p>
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
              <input
                ref="usernameInput"
                v-model.trim="username"
                autocomplete="username"
                maxlength="64"
                spellcheck="false"
                required
              />
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
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                maxlength="128"
                required
              />
              <button type="button" class="field-toggle" @click="showPassword = !showPassword">
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </div>
          </label>
        </div>

        <p v-if="error" class="auth-error">{{ error }}</p>

        <button class="auth-submit" type="submit" :disabled="loading">
          <span class="submit-text">{{ loading ? '登录中…' : '登录' }}</span>
        </button>

        <p class="auth-links">
          还没有账号？
          <router-link to="/register">申请注册</router-link>
        </p>
        </form>
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
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthBackdrop from '@/components/auth/AuthBackdrop.vue'
import AcousticLogo from '@/components/auth/AcousticLogo.vue'
import { login } from '@/modules/auth/authStore.js'
import { authErrorMessage } from '@/api/authHttp.js'

const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const usernameInput = ref(null)

function redirectTarget() {
  const value = String(route.query.redirect || '/')
  return value.startsWith('/') ? value : '/'
}

async function submit() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    await login(username.value, password.value)
    await router.replace(redirectTarget())
  } catch (exc) {
    error.value = authErrorMessage(exc, '登录失败，请稍后再试')
  } finally {
    loading.value = false
  }
}

onMounted(() => usernameInput.value?.focus())
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
  padding: 48px 20px 86px;
  box-sizing: border-box;
}

.auth-card-wrap {
  position: relative;
  width: min(540px, 100%);
}

.card-aura {
  position: absolute;
  inset: -64px -54px;
  z-index: -1;
  border-radius: 48px;
  background:
    radial-gradient(ellipse at 50% 24%, rgba(90, 235, 255, 0.34), transparent 62%),
    radial-gradient(ellipse at 50% 100%, rgba(20, 140, 190, 0.26), transparent 70%);
  filter: blur(30px);
  pointer-events: none;
}

.auth-card {
  position: relative;
  width: 100%;
  padding: 40px 42px 34px;
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
.auth-card > .auth-links {
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
  gap: 24px;
  margin-bottom: 40px;
}

.brand-logo {
  flex: 0 0 78px;
  width: 78px;
  height: 78px;
}

.brand-copy {
  min-width: 0;
  padding-left: 24px;
  border-left: 1px solid rgba(120, 208, 234, 0.28);
}

.brand-copy h1 {
  margin: 0;
  font-size: 29px;
  font-weight: 700;
  letter-spacing: 3.5px;
  white-space: nowrap;
  text-shadow: 0 0 24px rgba(90, 230, 255, 0.32);
}

.brand-copy p {
  margin: 10px 0 0;
  color: #9fc2d2;
  font-size: 14px;
  letter-spacing: 0.8px;
}

.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 23px;
}

.auth-field {
  display: block;
}

.field-label {
  display: block;
  margin-bottom: 10px;
  color: #d5edf5;
  font-size: 15px;
  letter-spacing: 1.2px;
}

.input-shell {
  position: relative;
  display: flex;
  align-items: center;
  height: 54px;
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
  flex: 0 0 19px;
  width: 19px;
  height: 19px;
  margin-left: 18px;
  color: #63cfe8;
  opacity: 0.85;
}

.input-shell input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 16px;
  border: 0;
  outline: 0;
  color: #eaf9ff;
  font-size: 16.5px;
  letter-spacing: 0.5px;
  background: transparent;
  caret-color: #6fe9ff;
}

.input-shell input::placeholder {
  color: #547a8c;
}

.field-toggle {
  position: absolute;
  right: 9px;
  padding: 6px 10px;
  border: 1px solid rgba(95, 200, 230, 0.28);
  border-radius: 6px;
  color: #8fe6ff;
  font-size: 12px;
  background: rgba(16, 70, 95, 0.45);
  cursor: pointer;
  transition: 0.18s ease;
}

.field-toggle:hover {
  border-color: rgba(120, 230, 255, 0.7);
  background: rgba(28, 108, 138, 0.55);
}

.auth-error {
  margin: 16px 0 0;
  padding: 10px 12px;
  color: #ffb3b3;
  font-size: 13px;
  border: 1px solid rgba(255, 99, 99, 0.38);
  border-radius: 8px;
  background: rgba(255, 70, 70, 0.1);
}

.auth-submit {
  position: relative;
  width: 100%;
  height: 56px;
  margin-top: 30px;
  overflow: hidden;
  border: 0;
  border-radius: 11px;
  color: #032430;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 9px;
  text-indent: 9px;
  background: linear-gradient(100deg, #bdfcff 0%, #46e4ff 30%, #22ccf3 64%, #0aa6d8 100%);
  box-shadow:
    0 16px 38px rgba(18, 170, 215, 0.38),
    0 0 24px rgba(70, 220, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
}

.auth-submit::after {
  content: '';
  position: absolute;
  top: 0;
  left: -40%;
  width: 30%;
  height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transform: skewX(-22deg);
  animation: button-shine 4.6s ease-in-out infinite;
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
  margin: 26px 0 0;
  color: #9dc1cf;
  font-size: 15px;
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

@keyframes button-shine {
  0%, 62% { left: -40%; }
  100% { left: 130%; }
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.auth-card {
  animation: fade-in 0.6s ease both;
}

@media (max-width: 520px) {
  .auth-card {
    padding: 26px 20px 22px;
    border-radius: 18px;
  }



  .auth-brand {
    gap: 14px;
    margin-bottom: 26px;
  }

  .brand-logo {
    flex-basis: 54px;
    width: 54px;
    height: 54px;
  }

  .brand-copy {
    padding-left: 14px;
  }

  .brand-copy h1 {
    font-size: 21px;
    letter-spacing: 2px;
  }

  .brand-copy p {
    font-size: 12px;
  }

  .auth-footer {
    font-size: 11px;
    flex-wrap: wrap;
    padding: 0 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-card,
  .auth-submit::after {
    animation: none;
  }
}
</style>
