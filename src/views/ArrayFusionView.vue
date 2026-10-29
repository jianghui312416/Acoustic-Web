<template>
  <KeepAlive>
    <component :is="activeComponent" :sidebar-open="sidebarOpen" />
  </KeepAlive>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated } from 'vue'
import CompleteCommunicationView from '@/components/array-fusion/CompleteCommunicationView.vue'
import StaticChannelView from '@/components/array-fusion/StaticChannelView.vue'
import MotionChannelView from '@/views/MotionChannelView.vue'
import {
  applyGlobeCameraTo,
  captureGlobeCameraFor,
} from '@/modules/array-fusion/globeCameraState.js'

const props = defineProps({
  activeSubmoduleId: { type: String, default: 'static-channel' },
  sidebarOpen: { type: Boolean, default: false },
  viewMode: { type: String, default: 'globe' },
  runToken: { type: Number, default: 0 },
})

defineEmits(['update:view-mode'])

const activeComponent = computed(() => ({
  'static-channel': StaticChannelView,
  'motion-channel': MotionChannelView,
  'complete-communication': CompleteCommunicationView,
}[props.activeSubmoduleId] ?? CompleteCommunicationView))

onActivated(async () => {
  await nextTick()
  applyGlobeCameraTo('communication')
})

onDeactivated(() => {
  captureGlobeCameraFor('communication')
})
</script>
