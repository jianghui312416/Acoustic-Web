<template>
  <div class="ais-map-layer" aria-live="polite">
    <div v-if="active && displayVessel && tooltipPosition" class="ais-contact-card" :style="tooltipStyle">
      <div class="ais-contact-main">
        <span class="ais-contact-mark" :style="{ background: colorFor(displayVessel) }">◆</span>
        <b>{{ displayName(displayVessel) }}</b>
        <strong>{{ speedText(displayVessel) }}</strong>
      </div>
      <div class="ais-contact-meta">最后报文 {{ ageText(displayVessel) }} · MMSI {{ displayVessel.mmsi }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cesium } from '@/utils/cesium.js'
import {
  aisMonitorState,
  ensureAisConnection,
  releaseAisConnection,
  selectAisVessel,
  selectedAisVessel,
} from '@/modules/ais/aisMonitorStore.js'

const props = defineProps({
  active: { type: Boolean, default: true },
  viewer: { type: Object, default: null },
})

const typeColors = Object.freeze({ 货船: '#52d9ff', 油轮: '#ffb34d', 客船: '#ad91ff', 渔船: '#63e6b0', 服务船: '#f27fa9', 高速船: '#f5ed68', 游艇: '#83e7ff', 其他: '#a6b3c1', 未知: '#728697' })
const hoveredVessel = ref(null)
const hoverScreen = ref(null)
const selectedScreen = ref(null)
const displayVessel = computed(() => hoveredVessel.value || selectedAisVessel.value)
const tooltipPosition = computed(() => hoveredVessel.value ? hoverScreen.value : selectedScreen.value)
const tooltipStyle = computed(() => tooltipPosition.value ? ({ left: `${tooltipPosition.value.x}px`, top: `${tooltipPosition.value.y}px` }) : {})

let billboardCollection = null
let layerViewer = null
let haloBillboard = null
let clickHandler = null
let removePostRender = null
const markerImages = new Map()
const haloImages = new Map()

function colorFor(vessel) { return typeColors[vessel?.ship_type_name || '未知'] || typeColors.其他 }
function displayName(vessel) { return vessel?.vessel_name || `MMSI ${vessel?.mmsi || '—'}` }
function speedText(vessel) { const speed = Number(vessel?.sog_kn); return Number.isFinite(speed) ? `${speed.toFixed(1)} kn` : '— kn' }
function ageText(vessel) {
  const timestamp = new Date(vessel?.data_time_utc || vessel?.last_seen_utc || 0).getTime()
  if (!Number.isFinite(timestamp) || !timestamp) return '时间未知'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  return seconds < 60 ? `${seconds}秒前` : `${Math.floor(seconds / 60)}分钟前`
}

function markerImage(color) {
  if (markerImages.has(color)) return markerImages.get(color)
  const canvas = document.createElement('canvas')
  canvas.width = 42
  canvas.height = 42
  const context = canvas.getContext('2d')
  context.translate(21, 21)
  context.shadowColor = color
  context.shadowBlur = 7
  context.fillStyle = color
  context.strokeStyle = '#03101a'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(0, -17)
  context.lineTo(8, 12)
  context.lineTo(0, 8)
  context.lineTo(-8, 12)
  context.closePath()
  context.fill()
  context.stroke()
  markerImages.set(color, canvas)
  return canvas
}

function haloImage(color) {
  if (haloImages.has(color)) return haloImages.get(color)
  const canvas = document.createElement('canvas')
  canvas.width = 72
  canvas.height = 72
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(36, 36, 8, 36, 36, 34)
  gradient.addColorStop(0, 'rgba(255,188,48,0.08)')
  gradient.addColorStop(0.5, 'rgba(255,188,48,0.16)')
  gradient.addColorStop(0.72, 'rgba(255,188,48,0.48)')
  gradient.addColorStop(1, 'rgba(255,188,48,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 72, 72)
  context.strokeStyle = '#ffbd38'
  context.lineWidth = 4
  context.beginPath()
  context.arc(36, 36, 23, 0, Math.PI * 2)
  context.stroke()
  context.strokeStyle = 'rgba(255,221,111,.85)'
  context.lineWidth = 2
  context.beginPath()
  context.arc(36, 36, 30, 0, Math.PI * 2)
  context.stroke()
  haloImages.set(color, canvas)
  return canvas
}

function vesselPosition(vessel) {
  return vessel ? Cesium.Cartesian3.fromDegrees(vessel.longitude, vessel.latitude, 120) : null
}

function clampTooltip(position) {
  const canvas = props.viewer?.canvas || props.viewer?.scene?.canvas
  const width = Number(canvas?.clientWidth) || 1000
  const height = Number(canvas?.clientHeight) || 700
  return {
    x: Math.max(12, Math.min(width - 226, Number(position?.x) + 28)),
    y: Math.max(12, Math.min(height - 68, Number(position?.y) - 22)),
  }
}

function syncHalo() {
  if (!haloBillboard) return
  const vessel = hoveredVessel.value || selectedAisVessel.value
  haloBillboard.show = Boolean(props.active && vessel)
  if (!vessel) return
  haloBillboard.position = vesselPosition(vessel)
  haloBillboard.image = haloImage(colorFor(vessel))
  haloBillboard.id = { __aisVessel: true, vessel }
}

function updateSelectedScreen() {
  const viewer = props.viewer
  const vessel = selectedAisVessel.value
  if (!props.active || !viewer || viewer.isDestroyed?.() || !vessel) {
    if (selectedScreen.value) selectedScreen.value = null
    return
  }
  const transforms = Cesium.SceneTransforms
  const cartesian = vesselPosition(vessel)
  const screen = typeof transforms?.worldToWindowCoordinates === 'function'
    ? transforms.worldToWindowCoordinates(viewer.scene, cartesian)
    : transforms?.wgs84ToWindowCoordinates?.(viewer.scene, cartesian)
  const next = screen ? clampTooltip(screen) : null
  const current = selectedScreen.value
  if (next && current && Math.abs(next.x - current.x) < 0.5 && Math.abs(next.y - current.y) < 0.5) return
  selectedScreen.value = next
}

function pickVessel(position) {
  const record = props.viewer?.scene?.pick?.(position)?.id
  return record?.__aisVessel ? record.vessel : null
}

function ensureLayer() {
  const viewer = props.viewer
  if (!viewer || viewer.isDestroyed?.() || billboardCollection) return
  billboardCollection = new Cesium.BillboardCollection({ scene: viewer.scene })
  viewer.scene.primitives.add(billboardCollection)
  layerViewer = viewer
  billboardCollection.show = props.active
  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas || viewer.scene.canvas)
  clickHandler.setInputAction((movement) => {
    if (!props.active) return
    const vessel = pickVessel(movement?.endPosition)
    hoveredVessel.value = vessel
    hoverScreen.value = vessel ? clampTooltip(movement.endPosition) : null
    syncHalo()
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  clickHandler.setInputAction((movement) => {
    if (!props.active) return
    const vessel = pickVessel(movement?.position)
    if (!vessel) return
    selectedScreen.value = clampTooltip(movement.position)
    selectAisVessel(vessel, 'globe')
    syncHalo()
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  viewer.scene?.postRender?.addEventListener?.(updateSelectedScreen)
  removePostRender = () => viewer.scene?.postRender?.removeEventListener?.(updateSelectedScreen)
}

function renderVessels() {
  ensureLayer()
  if (!billboardCollection) return
  billboardCollection.removeAll()
  haloBillboard = null
  for (const vessel of aisMonitorState.vessels) {
    const heading = vessel.heading_deg ?? vessel.cog_deg ?? 0
    billboardCollection.add({
      position: vesselPosition(vessel),
      image: markerImage(colorFor(vessel)),
      width: 23,
      height: 23,
      rotation: -Cesium.Math.toRadians(heading),
      scaleByDistance: new Cesium.NearFarScalar(1000, 1.25, 25000000, 0.5),
      translucencyByDistance: new Cesium.NearFarScalar(1000, 1, 30000000, 0.72),
      disableDepthTestDistance: 5000000,
      id: { __aisVessel: true, vessel },
    })
  }
  haloBillboard = billboardCollection.add({
    position: Cesium.Cartesian3.ZERO,
    image: haloImage('#ffbd38'),
    width: 58,
    height: 58,
    show: false,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  })
  billboardCollection.show = props.active
  hoveredVessel.value = null
  hoverScreen.value = null
  syncHalo()
  updateSelectedScreen()
  props.viewer?.scene?.requestRender?.()
}

function focusRequestedVessel() {
  const request = aisMonitorState.focusRequest
  if (!props.active || request?.viewMode !== 'globe') return
  props.viewer?.camera?.flyTo?.({
    destination: Cesium.Cartesian3.fromDegrees(request.longitude, request.latitude, 350000),
    duration: 1.05,
  })
}

function destroyLayer() {
  const viewer = layerViewer
  try { clickHandler?.destroy?.() } catch {}
  clickHandler = null
  try { removePostRender?.() } catch {}
  removePostRender = null
  if (billboardCollection && viewer && !viewer.isDestroyed?.()) {
    try { viewer.scene.primitives.remove(billboardCollection) } catch {}
    viewer.scene?.requestRender?.()
  }
  billboardCollection = null
  layerViewer = null
  haloBillboard = null
  hoveredVessel.value = null
  hoverScreen.value = null
  selectedScreen.value = null
}

watch(() => aisMonitorState.vessels, () => {
  if (props.active) renderVessels()
})
watch(() => aisMonitorState.selectedMmsi, () => { syncHalo(); updateSelectedScreen() })
watch(() => aisMonitorState.focusToken, focusRequestedVessel)
watch(() => props.active, (active) => {
  if (active) renderVessels()
  if (billboardCollection) billboardCollection.show = active
  if (active) { focusRequestedVessel(); updateSelectedScreen() }
  else { hoveredVessel.value = null; hoverScreen.value = null }
  syncHalo()
  props.viewer?.scene?.requestRender?.()
})
watch(() => props.viewer, () => { destroyLayer(); if (props.active) renderVessels() })

onMounted(() => {
  ensureAisConnection()
  if (props.active) renderVessels()
})
onBeforeUnmount(() => {
  releaseAisConnection()
  destroyLayer()
})
</script>

<style scoped>
.ais-map-layer { position: absolute; inset: 0; z-index: 18; overflow: hidden; pointer-events: none; }
.ais-contact-card { position: absolute; width: 208px; color: #f3f7f9; border: 1px solid rgba(10,25,30,.58); border-left: 6px solid #32c58b; background: rgba(45,55,58,.9); box-shadow: 0 5px 16px rgba(0,0,0,.36); backdrop-filter: blur(5px); transform: translateY(-50%); }
.ais-contact-main { height: 31px; display: flex; align-items: center; gap: 7px; padding: 0 8px; }.ais-contact-mark { width: 15px; height: 12px; display: grid; place-items: center; color: #061b18; font-size: 7px; clip-path: polygon(50% 0,100% 100%,0 100%); }.ais-contact-main b { min-width: 0; flex: 1; overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.ais-contact-main strong { color: #dce6e8; font: 700 11px ui-monospace, monospace; white-space: nowrap; }
.ais-contact-meta { padding: 0 8px 7px 30px; color: #aebbbf; font: 8px ui-monospace, monospace; white-space: nowrap; }
</style>
