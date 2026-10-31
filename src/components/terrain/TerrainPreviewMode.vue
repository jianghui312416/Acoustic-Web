<template>
  <section class="terrain-preview-mode" aria-label="区域海底地形">
    <canvas ref="canvasEl" class="terrain-canvas" style="position:absolute;inset:0 0 25px;width:100%;height:calc(100% - 25px);display:block"
      aria-label="区域海底地形，拖动旋转，滚轮缩放，悬停查看深度"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointercancel="onPointerUp" @pointerleave="onPointerLeave" @wheel.prevent="onWheel"></canvas>
    <header class="terrain-caption">
      <span>{{ formatTerrainBounds(loadedBounds || bounds) }}</span>
      <small>{{ status === 'loading' ? '正在读取海底高程…' : grid ? '区域海底地形 · 本地区域格网' : '等待加载区域海底地形' }}</small>
    </header>
    <div class="compass-stack">
      <button class="compass" title="恢复正北视角" aria-label="恢复正北视角" @click="resetCamera">
        <svg class="compass-dial" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" fill="#0b1d30" stroke="#2f5a78" stroke-width="2" />
          <circle cx="60" cy="60" r="47" fill="none" stroke="#1f4663" stroke-width="1" />
          <g>
            <line v-for="(tick, index) in compassTicks" :key="index"
              :x1="tick.x1" :y1="tick.y1" :x2="tick.x2" :y2="tick.y2"
              :stroke="tick.major ? '#cfe6f5' : tick.mid ? '#7fa9c4' : '#456b86'"
              :stroke-width="tick.major ? 1.8 : tick.mid ? 1.1 : 0.7" />
          </g>
          <g :transform="`rotate(${-headingDeg} 60 60)`">
            <polygon :points="compassRoseLong" fill="#4a7ba6" />
            <polygon :points="compassRoseShort" fill="#2c5474" />
            <polygon points="60,58 55,68 60,101 65,68" fill="#e0897a" />
            <text x="60" y="19" text-anchor="middle" font-size="10" font-weight="700" fill="#f19e9e">N</text>
          </g>
        </svg>
      </button>
      <div class="compass-heading">{{ headingLabel }}</div>
      <div v-if="scaleBar" class="scale-bar" :style="{ width: `${Math.round(scaleBar.widthPx)}px` }">
        <span>{{ scaleBar.label }}</span>
      </div>
    </div>
    <div v-if="error && !grid" class="terrain-error" role="alert">
      {{ error }}<button @click="loadTerrain(bounds)">重试</button>
    </div>
    <div v-else-if="status === 'loading' && !grid" class="terrain-loading"><i></i>正在加载区域海底地形</div>
    <div v-if="hover" class="depth-tooltip" :style="{ left: `${hover.x + 14}px`, top: `${hover.y - 42}px` }">
      {{ hover.lon.toFixed(4) }}° / {{ hover.lat.toFixed(4) }}°<br />
      <b>{{ hover.elevation < 0 ? '水深' : '高程' }} {{ Math.abs(hover.elevation).toFixed(0) }} m</b>
    </div>
    <TerrainStationCard v-if="station" :point="station" :dataset="dataset" :time="time" :running="running"
      @close="station = null" @run="runStation" @parameters="$emit('station-parameters', $event)" @noise="$emit('noise', $event)" />
    <slot :anchor="anchor" />
    <TerrainPreviewDock v-model:bounds="bounds" :collapsed="thumbnailCollapsed" :loading="status === 'loading'"
      @update:collapsed="$emit('update:thumbnailCollapsed', $event)" @load="loadTerrain" @locate="locateSource" />
    <footer class="terrain-status">
      <i></i>
      <span v-if="hover">经度 {{ hover.lon.toFixed(4) }}°　纬度 {{ hover.lat.toFixed(4) }}°　{{ hover.elevation < 0 ? '水深' : '高程' }} {{ Math.abs(hover.elevation).toFixed(0) }} m</span>
      <span v-else-if="error" class="terrain-warn">{{ error }}</span>
      <span v-else>{{ status === 'loading' ? '正在加载地形' : grid ? '地形已就绪 · 本地区域格网' : '等待加载地形' }}</span>
      <a href="https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid" target="_blank" rel="noreferrer">GEBCO 2026 海底高程</a>
    </footer>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { formatTerrainBounds, normalizeTerrainBounds } from '@/utils/terrainPreview.js'
import { loadBathymetry, acousticTerrainBounds } from '@/utils/bathymetry.js'
import { drawTerrainScene, terrainMetersPerPixel } from '@/utils/terrainScene.js'
import TerrainPreviewDock from './TerrainPreviewDock.vue'
import TerrainStationCard from './TerrainStationCard.vue'
import { pickTerrainPoint } from '@/utils/terrainPicking.js'
import { activeVolumeColorStops, volumeRenderingControls } from '@/modules/acoustic/volumeRenderingControls.js'
import { parseAnalyse2DRtrd } from '@/sdk'
import { resolveRayFlow, sampleRayFlow } from '@/utils/rayFlow.js'
import { rayFlowClockElapsedMs } from '@/utils/rayFlowClock.js'
import {
  loadRegionalWeatherForecast, noiseProbeState, setNoiseProbePicking,
  setTerrainBounds, setTerrainCenter, setWeatherNoisePoint, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import { currentOverlayField, drawWeatherOverlay, weatherOverlayActive } from '@/utils/weatherOverlay.js'
import { SIGNAL_EXCESS_COLOR_STOPS } from '@/utils/signalExcess.js'
import { signalExcessState } from '@/modules/acoustic/signalExcessState.js'

const props = defineProps({
  active: Boolean,
  dataset: { type: String, default: 'EnvReanalysis' },
  time: { type: String, default: '' },
  running: Boolean,
  viewer: Object,
  initialCenter: Object,
  field: Object,
  fields: { type: Array, default: () => [] },
  texture: { type: Object, default: null },
  source: Object,
  receiver: Object,
  radiusKm: { type: Number, default: 20 },
  rayData: { type: Object, default: null },
  rayAzimuthDeg: { type: Number, default: 0 },
  raysVisible: { type: Boolean, default: true },
  directionLineVisible: { type: Boolean, default: false },
  /** 全球视图红框选中的区域；token 变化时才重新加载，避免覆盖运行后的声源取景。 */
  initialBounds: { type: Object, default: null },
  initialBoundsToken: { type: Number, default: 0 },
  thumbnailCollapsed: { type: Boolean, default: false },
})
const emit = defineEmits(['anchor', 'layer-anchors', 'bounds-change', 'request-globe', 'station-run', 'station-parameters', 'noise', 'update:thumbnailCollapsed'])
const station = ref(null)
function runStation(point) { emit('station-run', point); station.value = null }

const canvasEl = ref(null)
const bounds = ref(normalizeTerrainBounds({ west: 115.4, east: 116.6, south: 15.4, north: 16.6 }))
const loadedBounds = ref(null)
const grid = shallowRef(null)
const status = ref('idle')
const error = ref('')
const hover = ref(null)
const anchor = ref(null)
const camera = ref({ yaw: 0, pitch: 0.68, zoom: 1 })
const visualControls = volumeRenderingControls

const headingDeg = computed(() => ((camera.value.yaw * 180 / Math.PI) % 360 + 360) % 360)
const headingLabel = computed(() => `${Math.round(headingDeg.value).toString().padStart(3, '0')}°`)

const canvasSize = ref({ width: 0, height: 0 })

const SCALE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]
function formatScaleDistance(meters) {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`
}
const scaleBar = computed(() => {
  const bounds = grid.value?.bounds
  const { width, height } = canvasSize.value
  if (!bounds || !width || !height) return null
  const metersPerPixel = terrainMetersPerPixel(bounds, { width, height }, camera.value)
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null
  const targetMeters = metersPerPixel * 90
  let meters = SCALE_STEPS[SCALE_STEPS.length - 1]
  for (const step of SCALE_STEPS) {
    meters = step
    if (step >= targetMeters) break
  }
  return { widthPx: meters / metersPerPixel, label: formatScaleDistance(meters) }
})

function sparklePoints(cx, cy, outer, inner, offsetDeg) {
  const points = []
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 + offsetDeg) * Math.PI / 180
    const radius = i % 2 === 0 ? outer : inner
    points.push(`${(cx + Math.sin(angle) * radius).toFixed(2)},${(cy - Math.cos(angle) * radius).toFixed(2)}`)
  }
  return points.join(' ')
}
const compassRoseLong = sparklePoints(60, 60, 40, 6, 0)
const compassRoseShort = sparklePoints(60, 60, 26, 6, 45)
const compassTicks = computed(() => {
  const ticks = []
  for (let i = 0; i < 72; i++) {
    const angle = i * 5 * Math.PI / 180
    const major = i % 18 === 0
    const mid = i % 9 === 0
    const outer = 54
    const inner = major ? 45 : mid ? 48 : 51
    ticks.push({
      x1: +(60 + Math.sin(angle) * outer).toFixed(2),
      y1: +(60 - Math.cos(angle) * outer).toFixed(2),
      x2: +(60 + Math.sin(angle) * inner).toFixed(2),
      y2: +(60 - Math.cos(angle) * inner).toFixed(2),
      major,
      mid,
    })
  }
  return ticks
})

let resizeObserver = null
let drawRaf = 0
let rayAnimationRaf = 0
let rayAnimationLastAt = 0
let hoverRaf = 0
let token = 0
let disposed = false
let dragState = null
let lastScene = null
let globeTransitionRaf = 0
let savedTerrainCamera = null
const MIN_CAMERA_ZOOM = 0.55
// 允许贴近声场体与海底表面观察细节；仅改变投影视图比例，不重载地形或声场。
const MAX_CAMERA_ZOOM = 14
const leavingForGlobe = ref(false)
const terrainRayFlow = shallowRef(null)
const overlayClockStart = performance.now()
const weatherOverlayOn = computed(() => weatherOverlayActive(weatherNoiseState))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function sourceBounds() {
  const center = props.source || props.initialCenter || { lon: 116, lat: 16 }
  return acousticTerrainBounds(center, props.radiusKm)
}

function sceneControls() {
  const controls = { ...visualControls, colorStops: activeVolumeColorStops(visualControls.colormap) }
  const seActive = Boolean(props.field?.signalExcess)
    || (props.fields || []).some(layer => layer?.field?.signalExcess)
  if (seActive) {
    const dbMin = Number(signalExcessState.dbMin)
    const dbMax = Number(signalExcessState.dbMax)
    if (Number.isFinite(dbMin) && Number.isFinite(dbMax) && dbMax > dbMin) {
      controls.dbMin = dbMin
      controls.dbMax = dbMax
    }
    controls.colorStops = SIGNAL_EXCESS_COLOR_STOPS
  }
  return controls
}

function draw() {
  drawRaf = 0
  if (!props.active || !canvasEl.value || !grid.value) return
  lastScene = drawTerrainScene(canvasEl.value, grid.value, {
    field: props.field,
    fields: props.fields,
    source: props.source,
    receiver: props.receiver,
    camera: camera.value,
    controls: sceneControls(),
    rayScene: props.raysVisible && terrainRayFlow.value
      ? {
          azimuthDeg: props.rayAzimuthDeg,
          trails: sampleRayFlow(terrainRayFlow.value, rayFlowClockElapsedMs()),
        }
      : null,
    directionLine: {
      visible: props.directionLineVisible,
      azimuthDeg: props.rayAzimuthDeg,
    },
  })
  const nextAnchor = lastScene?.anchor ? { x: lastScene.anchor.x, y: lastScene.anchor.y } : null
  emit('layer-anchors', lastScene?.anchors || {})
  if (station.value && lastScene?.project) {
    const p = station.value
    station.value = { ...p, ...lastScene.project(p.lon, p.lat, p.elevation) }
  }
  if ((!anchor.value && nextAnchor) || (anchor.value && !nextAnchor) ||
      (anchor.value && nextAnchor && (Math.abs(anchor.value.x - nextAnchor.x) > 1 || Math.abs(anchor.value.y - nextAnchor.y) > 1))) {
    anchor.value = nextAnchor
    emit('anchor', nextAnchor)
  }
  if (weatherOverlayOn.value && lastScene?.project) {
    const field = currentOverlayField(weatherNoiseState)
    if (field && weatherNoiseState.regionalWeather) {
      drawWeatherOverlay(
        canvasEl.value, lastScene, grid.value, field,
        weatherNoiseState.regionalWeather, weatherNoiseState.overlayDynamic,
        performance.now() - overlayClockStart,
      )
    }
  }
}

function scheduleDraw() {
  if (drawRaf || !props.active) return
  drawRaf = requestAnimationFrame(draw)
}

function stopRayAnimation() {
  if (rayAnimationRaf) cancelAnimationFrame(rayAnimationRaf)
  rayAnimationRaf = 0
  rayAnimationLastAt = 0
}

function terrainAnimating() {
  return (props.raysVisible && !!terrainRayFlow.value) ||
    (weatherOverlayOn.value && weatherNoiseState.overlayDynamic)
}

function syncRayAnimation() {
  stopRayAnimation()
  if (!props.active || !terrainAnimating() || document.hidden) {
    scheduleDraw()
    return
  }
  const tick = (now) => {
    if (!props.active || !terrainAnimating() || disposed) {
      stopRayAnimation()
      return
    }
    if (!rayAnimationLastAt || now - rayAnimationLastAt >= 32) {
      rayAnimationLastAt = now
      scheduleDraw()
    }
    rayAnimationRaf = requestAnimationFrame(tick)
  }
  rayAnimationRaf = requestAnimationFrame(tick)
}

function rebuildRayFlow() {
  const parsed = props.rayData ? parseAnalyse2DRtrd(props.rayData) : null
  terrainRayFlow.value = props.rayData
    ? resolveRayFlow(props.rayData, parsed?.rays ?? [])
    : null
  syncRayAnimation()
}

function resetCamera() {
  camera.value = { yaw: 0, pitch: 0.68, zoom: 1 }
  scheduleDraw()
}

function locateSource() {
  bounds.value = sourceBounds()
  loadTerrain(bounds.value)
}

/** 全球视图点“加载”后带入的选区；每次 token 变化只应用一次。 */
let appliedInitialBoundsToken = 0
function applyInitialBounds() {
  const requestToken = Number(props.initialBoundsToken) || 0
  if (!props.initialBounds || requestToken <= appliedInitialBoundsToken) return false
  appliedInitialBoundsToken = requestToken
  const target = normalizeTerrainBounds(props.initialBounds)
  bounds.value = target
  loadTerrain(target)
  return true
}

async function loadTerrain(next) {
  station.value = null
  const request = ++token
  const target = normalizeTerrainBounds(next || bounds.value)
  bounds.value = target
  status.value = 'loading'
  error.value = ''
  hover.value = null
  try {
    // Read a finer grid from the same cached tiles once; camera/scale never fetch data.
    const data = await loadBathymetry(target, 192)
    if (request !== token || disposed) return
    grid.value = data
    loadedBounds.value = target
    status.value = 'ready'
    await nextTick()
    scheduleDraw()
  } catch (err) {
    if (request !== token || disposed) return
    status.value = 'error'
    error.value = `${err?.message ?? err}${grid.value ? '。保留上次加载区域。' : ''}`
    scheduleDraw()
  }
}

function onPointerDown(event) {
  if (!grid.value || event.button !== 0) return
  canvasEl.value?.setPointerCapture?.(event.pointerId)
  dragState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    yaw: camera.value.yaw, pitch: camera.value.pitch, moved: false }
}

function pickHover(event) {
  if (!lastScene?.points?.length || !canvasEl.value) { hover.value = null; return }
  const rect = canvasEl.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const nearest = pickTerrainPoint(lastScene, x, y)
  hover.value = nearest
    ? { lon: nearest.lon, lat: nearest.lat, elevation: nearest.elevation,
        x: Math.min(x, rect.width - 190), y }
    : null
}

function onPointerMove(event) {
  if (dragState?.pointerId === event.pointerId) {
    const dx = event.clientX - dragState.x
    const dy = event.clientY - dragState.y
    if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true
    camera.value = { ...camera.value, yaw: dragState.yaw + dx * 0.006,
      pitch: clamp(dragState.pitch + dy * 0.004, 0.26, 1.18) }
    hover.value = null
    scheduleDraw()
    return
  }
  if (hoverRaf) return
  hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; pickHover(event) })
}

function onPointerUp(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return
  const moved = dragState.moved
  dragState = null
  try { canvasEl.value?.releasePointerCapture?.(event.pointerId) } catch {}
  if (!moved && event.type !== 'pointercancel') {
    const rect = canvasEl.value.getBoundingClientRect()
    const picked = pickTerrainPoint(lastScene, event.clientX - rect.left, event.clientY - rect.top)
    if (noiseProbeState.picking) {
      if (picked) {
        setWeatherNoisePoint(picked)
        setNoiseProbePicking(false)
      }
      hover.value = null
      return
    }
    station.value = picked
    hover.value = null
  }
}

function onPointerLeave() { if (!dragState) hover.value = null }

function startGlobeTransition() {
  if (leavingForGlobe.value || disposed) return
  leavingForGlobe.value = true
  // 记住缩回前的视角，点击红框返回时恢复到“刚才的地形视图”。
  savedTerrainCamera = { ...camera.value }
  const target = normalizeTerrainBounds(loadedBounds.value || bounds.value)
  emit('request-globe', {
    bounds: { ...target },
    yaw: camera.value.yaw,
    pitch: camera.value.pitch,
  })

  const startZoom = camera.value.zoom
  const startedAt = performance.now()
  const duration = 320
  const tick = (now) => {
    const t = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    camera.value = { ...camera.value, zoom: startZoom + (0.3 - startZoom) * eased }
    scheduleDraw()
    if (t < 1 && !disposed) {
      globeTransitionRaf = requestAnimationFrame(tick)
    } else {
      globeTransitionRaf = 0
    }
  }
  globeTransitionRaf = requestAnimationFrame(tick)
}

function onWheel(event) {
  if (leavingForGlobe.value) return
  const deltaY = Number(event.deltaY) || 0
  const nextZoom = camera.value.zoom * Math.exp(-deltaY * 0.0012)
  // 缩放到最小时继续向外滚：进入“区域地形 → 全球视图”的连续缩放过渡。
  if (deltaY > 0 && nextZoom < MIN_CAMERA_ZOOM) {
    startGlobeTransition()
    return
  }
  camera.value = {
    ...camera.value,
    zoom: clamp(nextZoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM),
  }
  scheduleDraw()
}

onMounted(() => {
  const updateCanvasSize = () => {
    const rect = canvasEl.value?.getBoundingClientRect()
    if (rect) canvasSize.value = { width: rect.width, height: rect.height }
  }
  resizeObserver = new ResizeObserver(() => { updateCanvasSize(); scheduleDraw() })
  if (canvasEl.value) { updateCanvasSize(); resizeObserver.observe(canvasEl.value) }
  if (props.active && !applyInitialBounds()) locateSource()
  document.addEventListener('visibilitychange', syncRayAnimation)
  rebuildRayFlow()
})

watch(() => props.active, (active) => {
  if (!active) {
    hover.value = null
    if (globeTransitionRaf) cancelAnimationFrame(globeTransitionRaf)
    globeTransitionRaf = 0
    if (leavingForGlobe.value) {
      leavingForGlobe.value = false
      camera.value = savedTerrainCamera ? { ...savedTerrainCamera } : { ...camera.value, zoom: 1 }
    }
    stopRayAnimation()
    return
  }
  savedTerrainCamera = null
  nextTick(() => {
    if (applyInitialBounds()) return
    if (status.value === 'idle') locateSource()
    else scheduleDraw()
    syncRayAnimation()
  })
})
watch(() => props.initialBoundsToken, () => {
  if (!props.active) return
  applyInitialBounds()
})
watch(bounds, (value) => {
  const next = { ...value }
  setTerrainCenter({ lon: (next.west + next.east) / 2, lat: (next.south + next.north) / 2 })
  setTerrainBounds(next)
  if (weatherNoiseState.terrainOverlay) loadRegionalWeatherForecast().then(() => scheduleDraw())
  emit('bounds-change', next)
}, { immediate: true })
watch(() => props.field, () => scheduleDraw())
watch(() => props.receiver, () => scheduleDraw(), { deep: true })
watch(() => props.fields, () => scheduleDraw(), { deep: true })
watch(() => props.rayData, rebuildRayFlow)
watch(() => [props.rayAzimuthDeg, props.raysVisible, props.directionLineVisible], () => {
  scheduleDraw()
  syncRayAnimation()
})
watch(() => [props.source?.lon, props.source?.lat, props.source?.depth, props.radiusKm], (next, previous) => {
  if (!props.active) return
  const locationChanged = !previous || next[0] !== previous[0] || next[1] !== previous[1] || next[3] !== previous[3]
  if (!locationChanged || !props.source) { scheduleDraw(); return }
  // 地形一旦加载即锁定范围。后续绘制多个声场时只重绘图层，不因声源位置或传播半径
  // 主动扩大、平移或重新加载地形；范围只由用户重新框选/定位等明确操作改变。
  const viewBounds = normalizeTerrainBounds(loadedBounds.value || bounds.value)
  const lon = Number(props.source.lon)
  const lat = Number(props.source.lat)
  const inside = Number.isFinite(lon) && Number.isFinite(lat) &&
    lon >= Number(viewBounds.west) && lon <= Number(viewBounds.east) &&
    lat >= Number(viewBounds.south) && lat <= Number(viewBounds.north)
  if (inside || grid.value) scheduleDraw()
  else locateSource()
})
watch(visualControls, () => scheduleDraw(), { deep: true })
watch(() => [
  weatherNoiseState.terrainOverlay,
  weatherNoiseState.overlayField,
  weatherNoiseState.overlayDynamic,
  weatherNoiseState.frameIndex,
], () => {
  if (weatherNoiseState.terrainOverlay) {
    loadRegionalWeatherForecast().then(() => scheduleDraw())
  }
  scheduleDraw()
  syncRayAnimation()
})

onBeforeUnmount(() => {
  disposed = true
  token += 1
  if (drawRaf) cancelAnimationFrame(drawRaf)
  stopRayAnimation()
  if (hoverRaf) cancelAnimationFrame(hoverRaf)
  if (globeTransitionRaf) cancelAnimationFrame(globeTransitionRaf)
  globeTransitionRaf = 0
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', syncRayAnimation)
  emit('anchor', null)
  emit('layer-anchors', {})
})
</script>

<style scoped>
.terrain-preview-mode { position: absolute; inset: 0; z-index: 8; overflow: hidden; color: #b8d6ec; background: radial-gradient(ellipse at 20% 0%, #244777, transparent 80%), linear-gradient(140deg,#162a4d 15%,#4b617d 65%,#9399a3); font: 12px 'Microsoft YaHei', sans-serif; }
.terrain-canvas { position: absolute; inset: 0 0 25px; z-index: 0; width: 100%; height: calc(100% - 25px); display: block; cursor: grab; touch-action: none; }
.terrain-canvas:active { cursor: grabbing; }
.terrain-caption { position: absolute; top: 18px; left: 22px; z-index: 6; display: grid; gap: 6px; pointer-events: none; font: 11px monospace; text-shadow: 0 1px 4px #00101d; }
.terrain-caption small { color: #87aac8; font: 10px 'Microsoft YaHei',sans-serif; }
.compass-stack { position: absolute; right: 22px; top: 14px; z-index: 6; display: flex; flex-direction: column; align-items: center; pointer-events: none; }
.compass { width: 84px; height: 84px; padding: 0; border: 0; background: none; cursor: pointer; pointer-events: auto; }
.compass-dial { display: block; width: 100%; height: 100%; filter: drop-shadow(0 3px 7px #00101d99); }
.compass-heading { margin-top: -3px; padding: 2px 9px; border-radius: 5px; background: #102435dd; color: #d6ecf8; font: 600 11px ui-monospace, monospace; letter-spacing: .5px; }
.scale-bar { margin-top: 12px; height: 7px; border-left: 1px solid #4f95d6; border-right: 1px solid #4f95d6; border-bottom: 1px solid #4f95d6; position: relative; pointer-events: none; }
.scale-bar span { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); color: #8fbfe0; font: 9px ui-monospace, monospace; text-shadow: 0 1px 3px #00101d; white-space: nowrap; }
.terrain-loading,.terrain-error { position: absolute; top: 40%; left: 50%; z-index: 7; transform: translate(-50%,-50%); padding: 18px; background: #0c1b2ceb; border: 1px solid #42627e; border-radius: 8px; }
.terrain-loading i { display: inline-block; width: 8px; height: 8px; margin-right: 8px; border-radius: 50%; background: #00d5bd; animation: pulse .8s infinite alternate; }
.terrain-error { color: #f1c38c; max-width: 400px; line-height: 1.8; }.terrain-error button { margin-left: 10px; background: #22435b; border: 1px solid #5c90b3; color: #dff6ff; cursor: pointer; }
.depth-tooltip { position: absolute; z-index: 7; pointer-events: none; background: #071b2ee8; border: 1px solid #42748e; border-radius: 4px; padding: 7px 10px; font: 11px/1.7 monospace; }.depth-tooltip b { color: #66ebda; }
.terrain-status { position: absolute; bottom: 0; left: 0; right: 0; z-index: 6; height: 24px; display: flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box; background: #101e30; border-top: 1px solid #304256; font-size: 10px; }
.terrain-status i { width: 6px; height: 6px; border-radius: 50%; background: #00c8b0; }.terrain-status a { margin-left: auto; color: #83a9c0; text-decoration: none; }.terrain-warn { color: #f1c38c; }
@keyframes pulse { to { opacity: .3; } }
@media(max-width: 900px) { .terrain-caption { max-width: 60%; } }
</style>
