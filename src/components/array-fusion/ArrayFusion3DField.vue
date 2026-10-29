<template>
  <div class="fusion-volume-shell">
    <div ref="containerEl" class="fusion-volume-canvas"></div>
    <div ref="targetLabelEl" class="scene-label target-label">目标</div>
    <div ref="platformLabelEl" class="scene-label platform-label">拖曳平台</div>
    <div ref="arrayLabelEl" class="scene-label array-label">线阵</div>
    <div v-if="errorText" class="fusion-volume-error">{{ errorText }}</div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cesium, createCesiumViewer } from '@/utils/cesium.js'
import { SoundField, decodeTlrdPolarVolume, parseAnalyse3DTlrd } from '@/sdk'

const props = defineProps({
  payload: { type: Object, default: null },
  sourceLon: { type: Number, required: true },
  sourceLat: { type: Number, required: true },
  sceneState: { type: Object, default: null },
  platformRoute: { type: Array, default: () => [] },
  targetRoute: { type: Array, default: () => [] },
})

const emit = defineEmits(['ready', 'error'])
const containerEl = ref(null)
const targetLabelEl = ref(null)
const platformLabelEl = ref(null)
const arrayLabelEl = ref(null)
const errorText = ref('')
let viewer = null
let soundField = null
let resizeObserver = null
let baseTextureLocation = null
let depthExaggeration = 1
let routeFeatures = []
let dynamicFeatures = []
let removePostRender = null

function recommendedDepthExaggeration(texture) {
  const radiusM = Math.max(1, Number(texture?.wedgeMeta?.pathMaxM) || 1)
  const depthSpanM = Math.max(1, Math.abs(Number(texture?.depthMax) - Number(texture?.depthMin)))
  return Math.max(1, Math.min(80, Math.round((radiusM * 0.18) / depthSpanM)))
}

async function renderVolume() {
  if (!viewer || !props.payload) return
  errorText.value = ''
  try {
    const parsed = parseAnalyse3DTlrd(props.payload)
    const texture = decodeTlrdPolarVolume(parsed, {
      sourceLon: Number(props.sourceLon),
      sourceLat: Number(props.sourceLat),
      angleInterp: 8,
    })
    baseTextureLocation = {
      sourceLon: Number(props.sourceLon),
      sourceLat: Number(props.sourceLat),
      lonMin: Number(texture.lonMin),
      lonMax: Number(texture.lonMax),
      latMin: Number(texture.latMin),
      latMax: Number(texture.latMax),
      wedgeMeta: { ...(texture.wedgeMeta ?? {}) },
      visibleGeoBounds: texture.visibleGeoBounds ? { ...texture.visibleGeoBounds } : null,
    }
    depthExaggeration = recommendedDepthExaggeration(texture)
    soundField?.destroy()
    soundField = new SoundField(viewer, {
      depthExaggeration,
      displayAboveWater: false,
    })
    soundField.setVolume(texture, (raw) => raw)
    soundField.setDisplay({
      valueRange: { min: 40, max: 120 },
      colorRange: { min: 40, max: 120 },
      colorGamma: 0.82,
      alphaScale: 0.78,
      valueAlphaRange: [0.92, 0.08],
      rayLines: { visible: false },
    })
    soundField.flyToOverview(0)
    soundField.requestRender()
    renderRoutes()
    updateSceneState()
    emit('ready', {
      sectorCount: Number(parsed?.grid?.sector) || 0,
      rangeCount: Number(texture?.width) || 0,
      depthCount: Number(texture?.depth) || 0,
    })
  } catch (error) {
    errorText.value = error?.message || String(error)
    emit('error', errorText.value)
  }
}

function addFeature(feature, target) {
  if (!feature || !viewer?.features) return
  try { target.push(feature.addTo(viewer.features) || feature) } catch {}
}

function clearFeatures(items) {
  if (!viewer?.features) return
  for (const feature of items) {
    try { viewer.features.remove(feature) } catch {}
  }
  items.length = 0
}

function routeLine(route, color) {
  if (!Array.isArray(route) || route.length < 2) return
  addFeature(new Cesium.Polyline(route.map((point) => [Number(point.lon), Number(point.lat), 850]), {
    colors: [color.withAlpha(0.48)],
    width: 2,
  }), routeFeatures)
}

function renderRoutes() {
  if (!viewer?.features) return
  clearFeatures(routeFeatures)
  routeLine(props.platformRoute, Cesium.Color.fromCssColorString('#39d9ff'))
  routeLine(props.targetRoute, Cesium.Color.fromCssColorString('#ffc65c'))
}

function offsetPosition(lon, lat, bearingDeg, distanceM) {
  const radius = 6371008.8
  const angle = Number(distanceM) / radius
  const bearing = Cesium.Math.toRadians(Number(bearingDeg) || 0)
  const lat1 = Cesium.Math.toRadians(Number(lat))
  const lon1 = Cesium.Math.toRadians(Number(lon))
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angle)
    + Math.cos(lat1) * Math.sin(angle) * Math.cos(bearing))
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angle) * Math.cos(lat1),
    Math.cos(angle) - Math.sin(lat1) * Math.sin(lat2),
  )
  return { lon: Cesium.Math.toDegrees(lon2), lat: Cesium.Math.toDegrees(lat2) }
}

function moveVolumeTo(lon, lat) {
  if (!soundField?.rawTexture || !baseTextureLocation) return
  const dLon = Number(lon) - baseTextureLocation.sourceLon
  const dLat = Number(lat) - baseTextureLocation.sourceLat
  const texture = soundField.rawTexture
  texture.lonMin = baseTextureLocation.lonMin + dLon
  texture.lonMax = baseTextureLocation.lonMax + dLon
  texture.latMin = baseTextureLocation.latMin + dLat
  texture.latMax = baseTextureLocation.latMax + dLat
  texture.wedgeMeta = {
    ...baseTextureLocation.wedgeMeta,
    sourceLon: Number(lon),
    sourceLat: Number(lat),
  }
  if (baseTextureLocation.visibleGeoBounds) {
    texture.visibleGeoBounds = {
      lonMin: baseTextureLocation.visibleGeoBounds.lonMin + dLon,
      lonMax: baseTextureLocation.visibleGeoBounds.lonMax + dLon,
      latMin: baseTextureLocation.visibleGeoBounds.latMin + dLat,
      latMax: baseTextureLocation.visibleGeoBounds.latMax + dLat,
    }
  }
  soundField.refinalize(depthExaggeration)
  soundField.sync()
}

function renderDynamicFeatures() {
  const state = props.sceneState
  if (!viewer?.features || !state?.target || !state?.platform) return
  clearFeatures(dynamicFeatures)
  const target = state.target
  const platform = state.platform
  const targetColor = Cesium.Color.fromCssColorString('#ffc65c')
  const platformColor = Cesium.Color.fromCssColorString('#39d9ff')
  const arrayColor = Cesium.Color.fromCssColorString('#66f0ff')
  const markerAltitude = 1250
  const lineAltitude = 900

  addFeature(new Cesium.Point([target.lon, target.lat, markerAltitude], {
    color: targetColor,
    pixelSize: 19,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 3,
  }), dynamicFeatures)
  addFeature(new Cesium.Point([platform.lon, platform.lat, markerAltitude], {
    color: platformColor,
    pixelSize: 17,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 3,
  }), dynamicFeatures)
  addFeature(new Cesium.Polyline([
    [target.lon, target.lat, lineAltitude],
    [platform.lon, platform.lat, lineAltitude],
  ], { colors: [Cesium.Color.WHITE.withAlpha(0.68)], width: 2 }), dynamicFeatures)

  const apertureM = Math.max(20, Number(state.arrayApertureM) || 95.25)
  const towLengthM = Math.max(0, Number(state.towLengthM) || 0)
  const arrayCenter = state.array ?? offsetPosition(
    platform.lon, platform.lat, state.arrayHeadingDeg, towLengthM,
  )
  const arrayPoints = []
  for (let index = 0; index < 17; index += 1) {
    const offsetM = (index / 16 - 0.5) * apertureM
    const point = offsetPosition(arrayCenter.lon, arrayCenter.lat, state.arrayHeadingDeg, offsetM)
    arrayPoints.push([point.lon, point.lat, lineAltitude])
    addFeature(new Cesium.Point([point.lon, point.lat, lineAltitude + 16], {
      color: index === 8 ? targetColor : arrayColor,
      pixelSize: index === 8 ? 8 : 5,
      outlineColor: Cesium.Color.fromCssColorString('#082b3b'),
      outlineWidth: 1,
    }), dynamicFeatures)
  }
  addFeature(new Cesium.Polyline([
    [platform.lon, platform.lat, lineAltitude],
    ...arrayPoints,
  ], { colors: [arrayColor.withAlpha(0.96)], width: 3 }), dynamicFeatures)
  viewer.scene?.requestRender?.()
}

function placeLabel(element, point, text) {
  if (!element || !viewer?.scene || !point) return
  element.textContent = text
  const world = Cesium.Cartesian3.fromDegrees(Number(point.lon), Number(point.lat), Number(point.altitude ?? 1400))
  const screen = Cesium.SceneTransforms?.wgs84ToWindowCoordinates?.(viewer.scene, world)
  if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
    element.style.display = 'none'
    return
  }
  element.style.display = 'block'
  element.style.transform = `translate(${screen.x + 10}px, ${screen.y - 14}px)`
}

function updateLabels() {
  const state = props.sceneState
  if (!state?.target || !state?.platform) return
  placeLabel(targetLabelEl.value, state.target, `目标 · ${Number(state.targetDepthM).toFixed(0)} m · ${Number(state.timeS).toFixed(1)} s`)
  placeLabel(platformLabelEl.value, state.platform, `拖曳平台 · ${Number(state.platformHeadingDeg).toFixed(1)}°`)
  const arrayEnd = offsetPosition(
    state.array?.lon ?? state.platform.lon,
    state.array?.lat ?? state.platform.lat,
    state.arrayHeadingDeg,
    Number(state.arrayApertureM) / 2,
  )
  placeLabel(arrayLabelEl.value, { ...arrayEnd, altitude: 980 }, `线阵 · ${state.arrayElementCount} 阵元`)
}

function updateSceneState() {
  const state = props.sceneState
  if (!state?.target || !state?.platform) return
  moveVolumeTo(state.target.lon, state.target.lat)
  renderDynamicFeatures()
  updateLabels()
}

function resetView() {
  soundField?.flyToOverview(0.45)
  soundField?.requestRender()
}

function topView() {
  soundField?.flyToTop(0.45)
  soundField?.requestRender()
}

defineExpose({ resetView, topView })

onMounted(async () => {
  await nextTick()
  try {
    viewer = createCesiumViewer(containerEl.value)
    viewer.scene.globe.depthTestAgainstTerrain = false
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#020d18')
    resizeObserver = new ResizeObserver(() => {
      viewer?.resize?.()
      viewer?.scene?.requestRender?.()
    })
    resizeObserver.observe(containerEl.value)
    const postRender = () => updateLabels()
    viewer.scene?.postRender?.addEventListener?.(postRender)
    removePostRender = () => viewer?.scene?.postRender?.removeEventListener?.(postRender)
    await renderVolume()
  } catch (error) {
    errorText.value = error?.message || String(error)
    emit('error', errorText.value)
  }
})

watch(() => props.payload, () => void renderVolume())
watch(() => [props.sourceLon, props.sourceLat], () => void renderVolume())
watch(() => props.sceneState, () => updateSceneState(), { deep: true })
watch(() => [props.platformRoute, props.targetRoute], () => renderRoutes(), { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  removePostRender?.()
  clearFeatures(dynamicFeatures)
  clearFeatures(routeFeatures)
  soundField?.destroy()
  if (viewer && !viewer.isDestroyed?.()) viewer.destroy?.()
  soundField = null
  viewer = null
})
</script>

<style scoped>
.fusion-volume-shell,
.fusion-volume-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #020d18;
}

.fusion-volume-canvas {
  position: absolute !important;
}

.fusion-volume-canvas :deep(canvas),
.fusion-volume-canvas :deep(.cesium-widget),
.fusion-volume-canvas :deep(.cesium-widget canvas) {
  width: 100% !important;
  height: 100% !important;
}

.fusion-volume-canvas :deep(.cesium-widget-credits),
.fusion-volume-canvas :deep(.cesium-credit-logoContainer),
.fusion-volume-canvas :deep(.cesium-credit-textContainer) {
  display: none !important;
}

.fusion-volume-error {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 4;
  max-width: 80%;
  transform: translate(-50%, -50%);
  padding: 10px 14px;
  border: 1px solid rgba(255, 102, 95, .55);
  color: #ffd0cd;
  font-size: 12px;
  text-align: center;
  background: rgba(37, 8, 14, .9);
}

.scene-label {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 5;
  display: none;
  pointer-events: none;
  padding: 3px 7px;
  border: 1px solid currentColor;
  font: 10px/1.2 Consolas, "Microsoft YaHei", sans-serif;
  white-space: nowrap;
  text-shadow: 0 1px 3px #000;
  background: rgba(2, 15, 27, .78);
}

.target-label { color: #ffd071; }
.platform-label { color: #67e8ff; }
.array-label { color: #7ef3ff; }
</style>
