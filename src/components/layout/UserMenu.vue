<template>
  <div ref="root" class="user-menu" :class="{ 'is-inline': inline }" @keydown.esc="open = false">
    <span class="user-fps">帧率 <b>{{ fps }}</b></span>
    <button
      type="button"
      class="user-menu-trigger"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
    >
      <span class="user-avatar" aria-hidden="true">{{ initial }}</span>
      <span class="user-name">{{ displayName }}</span>
      <span class="user-caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="user-menu-panel" role="menu">
      <div class="user-menu-head">
        <strong>{{ displayName }}</strong>
        <span>{{ authState.user?.username }}</span>
        <span class="user-role" :class="{ admin: isAdmin }">
          {{ isAdmin ? '管理员' : '普通用户' }}
        </span>
      </div>
      <button type="button" role="menuitem" @click="go('/profile')">个人中心</button>
      <button v-if="isAdmin" type="button" role="menuitem" @click="go('/admin/users')">
        用户审核
      </button>
      <button type="button" role="menuitem" class="danger" :disabled="loggingOut" @click="doLogout">
        {{ loggingOut ? '退出中…' : '退出登录' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useFrameRate } from '@/composables/useFrameRate.js'
import { authState, isAdmin, logout } from '@/modules/auth/authStore.js'

defineProps({
  inline: { type: Boolean, default: false },
})

const router = useRouter()
const root = ref(null)
const open = ref(false)
const loggingOut = ref(false)
const { fps } = useFrameRate()

const displayName = computed(
  () => authState.user?.display_name || authState.user?.username || '未登录'
)
const initial = computed(() => displayName.value.slice(0, 1).toUpperCase())

function go(path) {
  open.value = false
  router.push(path)
}

async function doLogout() {
  loggingOut.value = true
  try {
    await logout()
    open.value = false
    await router.replace('/login')
  } finally {
    loggingOut.value = false
  }
}

function onDocumentClick(event) {
  if (!open.value || !root.value) return
  if (!root.value.contains(event.target)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentClick))
</script>

<style scoped>
.user-menu {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #e8fbff;
  font-size: 14px;
}

.user-fps {
  color: rgba(143, 216, 255, 0.92);
  font-size: 12px;
  letter-spacing: 0.4px;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 8, 16, 0.75);
}

.user-fps b {
  color: #c9f2ff;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.user-menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px 0 6px;
  border: 1px solid rgba(75, 213, 255, 0.4);
  border-radius: 20px;
  color: inherit;
  background: rgba(5, 33, 51, 0.86);
  box-shadow: 0 8px 22px rgba(0, 7, 18, 0.35);
  cursor: pointer;
  transition: 0.18s ease;
}

.user-menu-trigger:hover {
  border-color: rgba(82, 216, 250, 0.8);
  background: rgba(10, 63, 84, 0.95);
}

.user-avatar {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #041820;
  font-weight: 700;
  background: linear-gradient(135deg, #67e2ff, #29c3f0);
}

.user-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-caret {
  color: #7fcbe4;
  font-size: 11px;
}

.user-menu.is-inline {
  position: relative;
  right: auto;
  bottom: auto;
  z-index: auto;
  gap: 12px;
  pointer-events: auto;
}

.user-menu.is-inline .user-menu-trigger {
  height: 24px;
  padding: 0 9px 0 3px;
  border-radius: 12px;
  background: rgba(5, 33, 51, 0.72);
  box-shadow: none;
}

.user-menu.is-inline .user-avatar {
  width: 18px;
  height: 18px;
  font-size: 10px;
}

.user-menu.is-inline .user-name {
  max-width: 90px;
  font-size: 12px;
}

.user-menu.is-inline .user-caret {
  font-size: 10px;
}

.user-menu.is-inline .user-fps {
  font-size: 11px;
}

.user-menu.is-inline .user-menu-panel {
  bottom: calc(100% + 8px);
}

.user-menu-panel {
  position: absolute;
  right: 0;
  bottom: 46px;
  width: 210px;
  padding: 8px;
  border: 1px solid rgba(75, 213, 255, 0.32);
  border-radius: 10px;
  background: rgba(4, 24, 41, 0.98);
  box-shadow: 0 16px 36px rgba(0, 5, 15, 0.5);
}

.user-menu-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px 10px;
  border-bottom: 1px solid rgba(75, 213, 255, 0.16);
  margin-bottom: 6px;
}

.user-menu-head strong {
  font-size: 14px;
}

.user-menu-head span {
  color: #8fb6c6;
  font-size: 12px;
}

.user-role {
  align-self: flex-start;
  margin-top: 2px;
  padding: 1px 8px;
  border-radius: 10px;
  color: #7fe3ff !important;
  background: rgba(41, 195, 240, 0.14);
}

.user-role.admin {
  color: #ffd479 !important;
  background: rgba(255, 196, 64, 0.14);
}

.user-menu-panel button {
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 6px;
  color: #d8eef7;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.user-menu-panel button:hover {
  background: rgba(41, 195, 240, 0.14);
}

.user-menu-panel button.danger {
  color: #ff9c9c;
}

.user-menu-panel button:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
