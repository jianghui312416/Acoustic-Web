<template>
  <ApplicationShell
    :modules="moduleCatalog"
    :active-module="activeModule"
    :active-module-id="activeModuleId"
    :active-submodule-id="activeSubmoduleId"
    :submodule-active="submoduleSelectionVersion > 0"
    :view-mode="viewMode"
    :sidebar-collapsed="sidebarCollapsed"
    :thumbnail-collapsed="thumbnailCollapsed"
    @select-module="selectModule"
    @select-submodule="selectSubmodule"
    @select-view-mode="selectViewMode"
    @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
    @toggle-thumbnail="toggleThumbnail"
    @run="runActiveModule"
  >
    <KeepAlive>
      <component
        :is="activeView"
        :key="activeModule.viewKey"
        :active-submodule-id="activeSubmoduleId"
        :sidebar-open="false"
        :submodule-selection-version="submoduleSelectionVersion"
        :view-mode="viewMode"
        :run-token="runToken"
        :thumbnail-collapsed="thumbnailCollapsed"
        @update:view-mode="selectViewMode"
        @update:thumbnail-collapsed="thumbnailCollapsed = $event"
      />
    </KeepAlive>
  </ApplicationShell>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import ApplicationShell from '@/layouts/ApplicationShell.vue'
import {
  DEFAULT_MODULE_ID,
  defaultSubmoduleId,
  findModule,
  moduleCatalog,
} from '@/config/moduleCatalog.js'

const viewRegistry = Object.freeze({
  // 一级业务视图按需加载，避免模块增多后首屏一次加载所有 SDK 和图表代码。
  'acoustic-field': defineAsyncComponent(() => import('@/views/AcousticFieldView.vue')),
})

const activeModuleId = ref(DEFAULT_MODULE_ID)
const activeModule = computed(() => findModule(activeModuleId.value))
const activeSubmoduleId = ref(defaultSubmoduleId(activeModule.value))
const submoduleSelectionVersion = ref(1)
const sidebarCollapsed = ref(false)
const thumbnailCollapsed = ref(false)
const viewMode = ref('globe')
const runToken = ref(0)
const activeView = computed(
  () => viewRegistry[activeModule.value.viewKey] ?? viewRegistry['acoustic-field']
)

function selectModule(moduleId) {
  if (activeModuleId.value === moduleId) return
  viewMode.value = 'globe'
  activeModuleId.value = moduleId
  activeSubmoduleId.value = defaultSubmoduleId(activeModule.value)
  submoduleSelectionVersion.value += 1
}

function selectSubmodule(submoduleId) {
  viewMode.value = 'globe'
  if (activeSubmoduleId.value === submoduleId) return
  activeSubmoduleId.value = submoduleId
  submoduleSelectionVersion.value += 1
}

function selectViewMode(mode) {
  const nextMode = mode === 'terrain' ? 'terrain' : 'globe'
  viewMode.value = nextMode
  if (nextMode !== 'terrain') return
  // 地形预览由体绘制视图承载；从其他模块进入时自动切换回该模块。
  if (activeModuleId.value !== DEFAULT_MODULE_ID) {
    activeModuleId.value = DEFAULT_MODULE_ID
    activeSubmoduleId.value = defaultSubmoduleId(activeModule.value)
    submoduleSelectionVersion.value += 1
  }
}

function runActiveModule() {
  // 运行结果直接叠加到区域地形，保留缩略图和浮窗状态。
  viewMode.value = 'terrain'
  if (activeModuleId.value !== DEFAULT_MODULE_ID) {
    activeModuleId.value = DEFAULT_MODULE_ID
  }
  if (activeSubmoduleId.value !== '3d') {
    activeSubmoduleId.value = '3d'
    submoduleSelectionVersion.value += 1
  }
  runToken.value += 1
}

function toggleThumbnail() {
  if (viewMode.value !== 'terrain') {
    thumbnailCollapsed.value = false
    selectViewMode('terrain')
    return
  }
  thumbnailCollapsed.value = !thumbnailCollapsed.value
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.repeat) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (isEditableTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'm') {
    event.preventDefault()
    selectViewMode('terrain')
  } else if (key === 'g') {
    event.preventDefault()
    selectViewMode('globe')
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
  background: #04101f;
}
</style>
