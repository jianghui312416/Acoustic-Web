<template>
  <header class="app-header">
    <div class="brand-block">
      <span class="brand-mark" aria-hidden="true">◈</span>
      <strong>{{ title }}</strong>
    </div>

    <nav class="module-tabs" aria-label="业务模块">
      <button
        v-for="moduleItem in modules"
        :key="moduleItem.id"
        type="button"
        :class="{ active: moduleItem.id === activeModuleId && sidebarOpen }"
        @click="$emit('select-module', moduleItem.id)"
      >
        {{ moduleItem.label }}
      </button>
    </nav>

    <div class="header-actions">
      <span class="header-clock">
        <span class="header-clock-icon" aria-hidden="true">◷</span>{{ clockText }}
      </span>
      <span class="header-user">
        <span class="header-avatar" aria-hidden="true">{{ userName.slice(0, 1) }}</span>
        {{ userName }}
      </span>
    </div>
  </header>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  title: { type: String, default: '海洋声场分析' },
  userName: { type: String, default: '管理员' },
  modules: { type: Array, default: () => [] },
  activeModuleId: { type: String, default: '' },
  sidebarOpen: { type: Boolean, default: false },
})

defineEmits(['select-module'])

const clockText = ref('')
let clockTimer = 0

function formatClock(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

onMounted(() => {
  clockText.value = formatClock()
  clockTimer = window.setInterval(() => {
    clockText.value = formatClock()
  }, 1000)
})

onBeforeUnmount(() => window.clearInterval(clockTimer))
</script>

<style scoped>
.app-header {
  position: absolute;
  inset: 0 0 auto;
  z-index: 20;
  height: 54px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 18px;
  box-sizing: border-box;
  color: #e8fbff;
  border-bottom: 1px solid rgba(91, 194, 232, 0.35);
  background: linear-gradient(180deg, rgba(4, 26, 45, 0.97), rgba(5, 25, 43, 0.84));
  box-shadow: 0 8px 30px rgba(0, 7, 18, 0.34);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.brand-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  color: #4bd5ff;
  border: 1px solid rgba(75, 213, 255, 0.55);
  transform: rotate(45deg);
  box-shadow: inset 0 0 16px rgba(20, 166, 211, 0.22), 0 0 14px rgba(20, 166, 211, 0.14);
}

.brand-block strong {
  overflow: hidden;
  font-size: 18px;
  letter-spacing: 2px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-tabs {
  display: flex;
  align-items: stretch;
  height: 54px;
  gap: 6px;
}

.module-tabs button {
  position: relative;
  min-width: 120px;
  padding: 0 22px;
  border: 0;
  color: #9fb6c4;
  font-size: 18px;
  letter-spacing: 1px;
  background: transparent;
  cursor: pointer;
  transition: 0.18s ease;
}

.module-tabs button:hover,
.module-tabs button.active {
  color: #4bd5ff;
}

.module-tabs button.active {
  font-weight: 700;
}

.module-tabs button.active::after {
  content: '';
  position: absolute;
  right: 12px;
  bottom: 0;
  left: 12px;
  height: 3px;
  border-radius: 2px;
  background: #29c3f0;
  box-shadow: 0 0 10px rgba(41, 195, 240, 0.75);
}

.header-actions,
.header-clock,
.header-user {
  display: flex;
  align-items: center;
}

.header-actions {
  justify-content: flex-end;
  gap: 16px;
}

.header-clock,
.header-user {
  gap: 6px;
  color: #bfe3f0;
  font-size: 18px;
  white-space: nowrap;
}

.header-clock {
  font-variant-numeric: tabular-nums;
}

.header-clock-icon {
  color: #67bddb;
  font-size: 13px;
}

.header-avatar {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #d9f5ff;
  font-size: 12px;
  border: 1px solid rgba(75, 213, 255, 0.55);
  border-radius: 50%;
  background: rgba(10, 92, 128, 0.35);
}

@media (max-width: 1050px) {
  .app-header { grid-template-columns: 1fr auto; }
  .module-tabs { position: absolute; top: 62px; left: 50%; transform: translateX(-50%); }
  .header-clock { display: none; }
}

@media (max-width: 760px) {
  .app-header { padding: 0 10px; }
  .header-user { font-size: 0; }
}
</style>
