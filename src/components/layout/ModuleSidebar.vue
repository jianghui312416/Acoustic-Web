<template>
  <aside class="module-sidebar" :aria-label="`${moduleItem?.label || '模块'}子模块`">
    <header class="sidebar-titlebar">
      <span>{{ moduleItem?.label }}</span>
      <button type="button" title="关闭模块导航" @click="$emit('close')">×</button>
    </header>
    <nav class="sidebar-body">
      <button
        v-for="child in moduleItem?.children || []"
        :key="child.id"
        type="button"
        class="sidebar-item"
        :class="{ active: child.id === activeSubmoduleId && submoduleActive }"
        @click="$emit('select-submodule', child.id)"
      >
        <strong>{{ child.label }}</strong>
        <small v-if="child.description">{{ child.description }}</small>
      </button>
    </nav>
  </aside>
</template>

<script setup>
defineProps({
  moduleItem: { type: Object, default: null },
  activeSubmoduleId: { type: String, default: '' },
  submoduleActive: { type: Boolean, default: false },
})

defineEmits(['close', 'select-submodule'])
</script>

<style scoped>
.module-sidebar {
  position: absolute;
  z-index: 15;
  top: 54px;
  bottom: 0;
  left: 0;
  width: 200px;
  display: flex;
  flex-direction: column;
  color: #d9edf5;
  border-right: 1px solid rgba(66, 154, 189, 0.52);
  background: linear-gradient(180deg, rgba(9, 40, 60, 0.96), rgba(5, 24, 38, 0.94));
  box-shadow: 6px 0 24px rgba(0, 8, 20, 0.4);
}

.sidebar-titlebar {
  flex: none;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 8px 0 14px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  border-bottom: 2px solid rgba(81, 183, 220, 0.55);
  background: linear-gradient(90deg, rgba(24, 91, 121, 0.72), rgba(12, 44, 65, 0.35));
}

.sidebar-titlebar button {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  color: #e8fbff;
  font-size: 25px;
  font-weight: 200;
  line-height: 24px;
  background: transparent;
  cursor: pointer;
}

.sidebar-body {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.sidebar-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 16px;
  text-align: left;
  color: #b9d3de;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: 0.16s ease;
}

.sidebar-item + .sidebar-item {
  border-top: 1px solid rgba(67, 151, 184, 0.14);
}

.sidebar-item:hover {
  color: #eafbff;
  background: rgba(31, 100, 132, 0.28);
}

.sidebar-item.active {
  color: #eafbff;
  border-left-color: #22c3f0;
  background: linear-gradient(90deg, rgba(12, 135, 189, 0.55), rgba(12, 135, 189, 0.04));
}

.sidebar-item strong { font-size: 13px; font-weight: 600; }
.sidebar-item small { font-size: 10px; color: #7fa8bb; }
.sidebar-item.active small { color: #cdeaf5; }
</style>
