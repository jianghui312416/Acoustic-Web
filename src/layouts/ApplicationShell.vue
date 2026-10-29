<template>
  <div class="application-shell" :class="{ 'is-collapsed': sidebarCollapsed }">
    <AppSidebar
      :collapsed="sidebarCollapsed"
      :modules="modules"
      :active-module-id="activeModuleId"
      :active-submodule-id="activeSubmoduleId"
      :submodule-active="submoduleActive"
      :view-mode="viewMode"
      :thumbnail-collapsed="thumbnailCollapsed"
      @select-module="$emit('select-module', $event)"
      @select-submodule="$emit('select-submodule', $event)"
      @select-view-mode="$emit('select-view-mode', $event)"
      @toggle-collapse="$emit('toggle-collapse')"
      @toggle-thumbnail="$emit('toggle-thumbnail')"
      @run="$emit('run')"
    />
    <main class="application-content">
      <slot />
    </main>
  </div>
</template>

<script setup>
import AppSidebar from '@/components/layout/AppSidebar.vue'

defineProps({
  modules: { type: Array, default: () => [] },
  activeModule: { type: Object, default: null },
  activeModuleId: { type: String, default: '' },
  activeSubmoduleId: { type: String, default: '' },
  submoduleActive: { type: Boolean, default: false },
  viewMode: { type: String, default: 'globe' },
  sidebarCollapsed: { type: Boolean, default: false },
  thumbnailCollapsed: { type: Boolean, default: false },
})

defineEmits([
  'select-module',
  'select-submodule',
  'select-view-mode',
  'toggle-collapse',
  'toggle-thumbnail',
  'run',
])
</script>

<style scoped>
.application-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: #020b17;
}

.application-content {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.sidebar-reveal {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 25;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  color: #c9efff;
  font-size: 16px;
  border: 1px solid rgba(75, 190, 225, 0.45);
  border-radius: 6px;
  background: rgba(5, 31, 46, 0.9);
  box-shadow: 0 6px 18px rgba(0, 6, 15, 0.4);
  cursor: pointer;
}

.sidebar-reveal:hover {
  border-color: rgba(82, 216, 250, 0.8);
  background: rgba(10, 63, 84, 0.95);
}
</style>
