<template>
  <section class="terrain-preview-mode" aria-label="区域海底地形">
    <canvas ref="terrainGlCanvasEl" class="terrain-gl-canvas" aria-hidden="true"></canvas>
    <canvas ref="canvasEl" class="terrain-canvas" style="position:absolute;inset:0 0 25px;width:100%;height:calc(100% - 25px);display:block"
      aria-label="区域海底地形，左键拖动平移，右键拖动旋转，滚轮缩放，悬停查看深度"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointercancel="onPointerUp" @pointerleave="onPointerLeave" @wheel.prevent="onWheel"
      @dblclick="onTrackDoubleClick" @contextmenu.prevent></canvas>
    <canvas ref="rayCanvasEl" class="ray-canvas" aria-hidden="true"></canvas>
    <canvas ref="aisCanvasEl" class="ais-canvas" aria-label="地形模式 AIS 船舶位置图层"></canvas>
    <canvas ref="aisDynamicCanvasEl" class="ais-dynamic-canvas" aria-hidden="true"></canvas>
    <canvas ref="trackCanvasEl" class="track-canvas" aria-hidden="true"></canvas>
    <button
      v-if="exaggerationHandle && !leavingForGlobe"
      type="button"
      class="exaggeration-handle"
      :class="{ active: exaggerationDragging }"
      :style="{ left: `${exaggerationHandle.x}px`, top: `${exaggerationHandle.y}px` }"
      :title="`垂直夸张 ${Number(visualControls.terrainExaggeration).toFixed(1)}×（上下拖动调整）`"
      aria-label="垂直夸张控制柄"
      @pointerdown="startExaggerationDrag"
      @pointermove="onExaggerationPointerMove"
      @pointerup="onExaggerationPointerUp"
      @pointercancel="onExaggerationPointerUp"
    ><span aria-hidden="true">⋮</span></button>
    <div class="compass-stack">
      <button class="compass" title="切换俯视视角（R）" aria-label="切换俯视视角（R）" @click="resetCamera">
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
      @close="station = null" @run="runStation" @parameters="openStationParameters" @noise="$emit('noise', $event)" />
    <div v-if="terrainLegend" class="terrain-legend" aria-label="高程色带图例">
      <span class="terrain-legend-title">{{ terrainLegend.title }}</span>
      <div class="terrain-legend-bar" :style="{ background: terrainLegend.gradient }"></div>
      <div class="terrain-legend-ticks">
        <span>{{ terrainLegend.min }}</span><span>{{ terrainLegend.mid }}</span><span>{{ terrainLegend.max }}</span>
      </div>
    </div>
    <slot :anchor="anchor" />
    <TerrainPreviewDock v-model:bounds="bounds" :collapsed="thumbnailCollapsed" :loading="status === 'loading'"
      @update:collapsed="$emit('update:thumbnailCollapsed', $event)" @load="loadTerrainFromDock" @locate="locateSource" />
    <footer class="terrain-status">
      <i></i>
      <span v-if="hover">经度 {{ hover.lon.toFixed(4) }}°　纬度 {{ hover.lat.toFixed(4) }}°　{{ hover.elevation < 0 ? '水深' : '高程' }} {{ Math.abs(hover.elevation).toFixed(0) }} m</span>
      <span v-else-if="error" class="terrain-warn">{{ error }}</span>
      <span v-else>{{ status === 'loading' ? '正在加载地形' : grid ? '地形已就绪' : '等待加载地形' }}</span>
      <div class="terrain-source" role="group" aria-label="海底高程数据源">
        <button v-for="option in BATHYMETRY_SOURCE_OPTIONS" :key="option.value" type="button"
          :class="{ active: bathymetrySourceState.source === option.value }" :title="option.title"
          :aria-pressed="bathymetrySourceState.source === option.value"
          @click="switchBathymetrySource(option.value)">{{ option.label }}</button>
      </div>
      <a :href="sourceAttribution.href" target="_blank" rel="noreferrer">{{ sourceAttribution.label }}</a>
    </footer>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { normalizeTerrainBounds } from '@/utils/terrainPreview.js'
import { loadBathymetry, acousticTerrainBounds } from '@/utils/bathymetry.js'
import { BATHYMETRY_SOURCE_OPTIONS, bathymetrySourceState, setBathymetrySource } from '@/modules/terrain/bathymetrySource.js'
import { drawTerrainScene, terrainMetersPerPixel } from '@/utils/terrainScene.js'
import { createTerrainWebGLRenderer } from '@/utils/terrainWebGL.js'
import { moonLightDirection } from '@/utils/moonLight.js'
import { TERRAIN_MAX_MESH_SEGMENTS, terrainColorAt } from '@/utils/terrainRendering.js'
import TerrainPreviewDock from './TerrainPreviewDock.vue'
import TerrainStationCard from './TerrainStationCard.vue'
import { pickTerrainPoint } from '@/utils/terrainPicking.js'
import { activeVolumeColorStops, volumeRenderingControls } from '@/modules/acoustic/volumeRenderingControls.js'
import { parseAnalyse2DRtrd } from '@/sdk'
import { resolveRayFlow, sampleRayMotion } from '@/utils/rayFlow.js'
import { rayFlowClockElapsedMs } from '@/utils/rayFlowClock.js'
import {
  loadRegionalNoiseForecast, loadRegionalOceanCurrent, loadRegionalWeatherForecast,
  noiseProbeState, setNoiseProbePicking,
  setTerrainBounds, setTerrainCenter, setWeatherNoisePoint, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import {
  currentOverlayField, drawRegionalNoiseOverlay, drawWeatherOverlay,
  oceanCurrentOverlayActive, oceanCurrentRegional, OCEAN_CURRENT_OVERLAY_FIELD,
  regionalNoiseOverlayActive, weatherOverlayActive,
} from '@/utils/weatherOverlay.js'
import { SIGNAL_EXCESS_COLOR_STOPS } from '@/utils/signalExcess.js'
import { signalExcessState } from '@/modules/acoustic/signalExcessState.js'
import {
  addTrackPoint,
  finishTrackPointsFromDoubleClick,
  trackPointDrawing,
  trackPointState,
} from '@/modules/acoustic/trackPointState.js'
import { signalTransmissionControls } from '@/modules/acoustic/signalTransmissionControls.js'
import {
  aisMonitorState,
  selectAisVessel,
  selectedAisMotionPosition,
  selectedAisTrackOpacity,
  selectedAisTrackState,
  selectedAisVessel,
  setAisTrackRequestsEnabled,
  startSelectedAisTracking,
  stopSelectedAisTracking,
} from '@/modules/ais/aisMonitorStore.js'
import { aisHeadingDegrees, screenHeadingAngle } from '@/utils/aisTrackMotion.js'

const props = defineProps({
  active: Boolean,
  dataset: { type: String, default: 'HYCOM' },
  time: { type: String, default: '' },
  running: Boolean,
  viewer: Object,
  initialCenter: Object,
  field: Object,
  fields: { type: Array, default: () => [] },
  texture: { type: Object, default: null },
  source: Object,
  receiver: Object,
  receiverPlaced: { type: Boolean, default: false },
  radiusKm: { type: Number, default: 100 / 6 },
  rayData: { type: Object, default: null },
  /** 动态声线对应的声源；为空时沿用主声场的声源。 */
  raySource: { type: Object, default: null },
  rayAzimuthDeg: { type: Number, default: 0 },
  raysVisible: { type: Boolean, default: true },
  /** 静态声线：绘制完整声线路径（可与动态动画同时显示） */
  raysStatic: { type: Boolean, default: false },
  /** 动态声线：沿路径播放行进动画 */
  raysAnimated: { type: Boolean, default: true },
  directionLineVisible: { type: Boolean, default: false },
  /** 方向方位线所属声场体 id；为空时画在首个（当前）声场体上。 */
  directionLineLayerId: { type: String, default: '' },
  /** 裁剪体：隐藏方位方向线箭头所指方向的半个体，露出切面。 */
  clipBody: { type: Boolean, default: false },
  /** 全球视图红框选中的区域；token 变化时才重新加载，避免覆盖运行后的声源取景。 */
  initialBounds: { type: Object, default: null },
  initialBoundsToken: { type: Number, default: 0 },
  thumbnailCollapsed: { type: Boolean, default: false },
  /** 参数卡片打开期间暂时隐藏站点卡片，关闭后恢复。 */
  stationParametersOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['anchor', 'layer-anchors', 'bounds-change', 'load-terrain', 'request-globe', 'station-run', 'station-parameters', 'station-pick', 'noise', 'receiver-pick', 'update:thumbnailCollapsed', 'arrow-azimuth'])
const station = ref(null)
let suspendedStation = null
function runStation(point) { emit('station-run', point) }
function openStationParameters(point) {
  suspendedStation = station.value ? { ...station.value } : { ...point }
  emit('station-parameters', point)
  station.value = null
}
watch(() => props.stationParametersOpen, (open, previous) => {
  if (open || !previous || !suspendedStation) return
  if (!station.value) station.value = suspendedStation
  suspendedStation = null
})

const terrainGlCanvasEl = ref(null)
const canvasEl = ref(null)
const rayCanvasEl = ref(null)
const aisCanvasEl = ref(null)
const aisDynamicCanvasEl = ref(null)
const trackCanvasEl = ref(null)
const bounds = ref(normalizeTerrainBounds({ west: 115.4, east: 116.6, south: 15.4, north: 16.6 }))
const loadedBounds = ref(null)
const grid = shallowRef(null)
const status = ref('idle')
const error = ref('')
const hover = ref(null)
const anchor = ref(null)
const camera = ref({ yaw: 0, pitch: 0.68, zoom: 1, panX: 0, panY: 0 })
const exaggerationHandle = ref(null)
const exaggerationDragging = ref(false)
let exaggerationDrag = null
const visualControls = volumeRenderingControls
const terrainReceiver = computed(() => (
  signalTransmissionControls.showReceiver && props.receiverPlaced ? null : props.receiver
))

const headingDeg = computed(() => ((camera.value.yaw * 180 / Math.PI) % 360 + 360) % 360)
const headingLabel = computed(() => `${Math.round(headingDeg.value).toString().padStart(3, '0')}°`)
const sourceAttribution = computed(() => (
  BATHYMETRY_SOURCE_OPTIONS.find(option => option.value === bathymetrySourceState.source)
  || BATHYMETRY_SOURCE_OPTIONS[0]
).attribution)

/** 与地形着色共用同一套色带，生成左下角之外的高程/水深图例。 */
const terrainLegend = computed(() => {
  const current = grid.value
  if (!current) return null
  const low = Math.min(0, Number(current.min) || 0)
  const high = Math.max(0, Number(current.max) || 0)
  // 纯水深区域按浅→深排列，混合区域按深水→低地→山峰排列。
  const allSea = high <= 0
  const start = allSea ? high : low
  const end = allSea ? low : high
  const span = Math.max(1, end - start)
  const steps = 24
  const stops = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const [r, g, b] = terrainColorAt(start + t * span, current.min, current.max)
    stops.push(`rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(1)}%`)
  }
  const format = (value) => value < 0 ? `${Math.round(-value)}` : `${Math.round(value)}`
  return {
    title: low < 0 && high > 0 ? '水深 / 高程 (m)' : low < 0 ? '水深 (m)' : '高程 (m)',
    gradient: `linear-gradient(90deg, ${stops.join(', ')})`,
    min: format(start),
    mid: format(start + span / 2),
    max: format(end),
  }
})

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
let interactionActive = false
let interactionTimer = 0
let rayAnimationRaf = 0
let aisMotionRaf = 0
let rayAnimationLastAt = 0
let hoverRaf = 0
let token = 0
let disposed = false
let dragState = null
let lastScene = null
let terrainGl = null
let aisMarkerHits = []
let aisSelectedMarkerHit = null
let aisStaticCache = null
let aisTrackProjectionCache = { project: null, points: null, projected: [] }
let aisMotionLastAt = 0
/** AIS 选船动画只需 30 fps；静态船位缓存在离屏画布，避免每帧重绘全部船舶。 */
const AIS_MOTION_FRAME_MS = 33
/** 方位方向线箭头拖拽状态 */
let arrowDrag = null
let arrowEmitRaf = 0
let pendingArrowDeg = null
const ARROW_HIT_RADIUS = 18
let globeTransitionRaf = 0
let savedTerrainCamera = null
const MIN_CAMERA_ZOOM = 0.1
// 允许贴近声场体与海底表面观察细节；仅改变投影视图比例，不重载地形或声场。
// 上限受 DEM/网格分辨率约束，继续放大会只放大插值块，而不是增加细节。
const MAX_CAMERA_ZOOM = 14
/** 拖动/缩放期间先降细分保证跟手，停手后再补一帧高精度地形。 */
const INTERACTIVE_MESH_SEGMENTS = 128
const MIN_CAMERA_PITCH = 0.05
/** 俯视时 pitch = 90°，高程不再影响屏幕位置，避免点选标记与地形落点产生视角偏移。 */
const TOP_DOWN_PITCH = Math.PI / 2
const MAX_CAMERA_PITCH = TOP_DOWN_PITCH
const EXAGGERATION_HANDLE_OFFSET = 64
/** AIS 船位始终贴在海面基准，不跟随海底地形、吃水或船体高度。 */
const AIS_SEA_SURFACE_ELEVATION_M = 0
const leavingForGlobe = ref(false)
const terrainRayFlow = shallowRef(null)
const overlayClockStart = performance.now()
const weatherOverlayOn = computed(() => weatherOverlayActive(weatherNoiseState))
const regionalNoiseOverlayOn = computed(() => regionalNoiseOverlayActive(weatherNoiseState))
const oceanCurrentOverlayOn = computed(() => oceanCurrentOverlayActive(weatherNoiseState))
const oceanCurrentLayer = computed(() => oceanCurrentRegional(
  weatherNoiseState.regionalOceanCurrent, weatherNoiseState.oceanCurrentDepth
))
/** 地形方向光跟随仿真时刻与声源位置处的月球方位。 */
const moonLight = computed(() => {
  const center = props.source || props.initialCenter || { lon: 116, lat: 16 }
  return moonLightDirection(props.time, Number(center.lat), Number(center.lon))
})
let regionalWeatherLoadTimer = 0
let regionalNoiseLoadTimer = 0
let oceanCurrentLoadTimer = 0

function queueRegionalWeatherLoad() {
  if (regionalWeatherLoadTimer) clearTimeout(regionalWeatherLoadTimer)
  regionalWeatherLoadTimer = 0
  if (!weatherNoiseState.terrainOverlay) return
  regionalWeatherLoadTimer = window.setTimeout(() => {
    regionalWeatherLoadTimer = 0
    loadRegionalWeatherForecast().then(() => scheduleDraw())
  }, 120)
}

function queueRegionalNoiseLoad() {
  if (regionalNoiseLoadTimer) clearTimeout(regionalNoiseLoadTimer)
  regionalNoiseLoadTimer = 0
  if (!weatherNoiseState.regionalNoiseOverlay) return
  regionalNoiseLoadTimer = window.setTimeout(() => {
    regionalNoiseLoadTimer = 0
    ;(async () => {
      // 两层同时开启时先完成区域天气；噪声接口随后可直接复用后端的同网格缓存。
      if (weatherNoiseState.terrainOverlay) await loadRegionalWeatherForecast()
      await loadRegionalNoiseForecast()
      scheduleDraw()
    })()
  }, 120)
}

function queueOceanCurrentLoad() {
  if (oceanCurrentLoadTimer) clearTimeout(oceanCurrentLoadTimer)
  oceanCurrentLoadTimer = 0
  if (!weatherNoiseState.oceanCurrentOverlay) return
  oceanCurrentLoadTimer = window.setTimeout(() => {
    oceanCurrentLoadTimer = 0
    loadRegionalOceanCurrent().then(() => scheduleDraw())
  // HYCOM 全深度原生网格体积较大；等滑杆停稳后再请求，避免拖动时堆积多个时次。
  }, 600)
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 首次加载地形时固定使用 100 km × 100 km，避免直接运行时被传播距离提前改写。 */
const DEFAULT_TERRAIN_SPAN_KM = 100
/** 地形高程采样分辨率；提高后可减轻放大时的块状插值，但会增加加载与缓存开销。 */
const TERRAIN_GRID_RESOLUTION = 512

function sourceBounds() {
  const center = props.source || props.initialCenter || { lon: 116, lat: 16 }
  const radiusKm = grid.value ? props.radiusKm : DEFAULT_TERRAIN_SPAN_KM / 6
  return acousticTerrainBounds(center, radiusKm)
}

function sceneControls() {
  const controls = {
    ...visualControls,
    colorStops: activeVolumeColorStops(visualControls.colormap),
    clipBody: props.clipBody === true,
    lightAzimuthDeg: moonLight.value.azimuthDeg,
    lightAltitudeDeg: moonLight.value.altitudeDeg,
  }
  const seActive = Boolean(props.field?.signalExcess)
    || (props.fields || []).some(layer => layer?.field?.signalExcess)
  if (seActive) {
    const pdMode = signalExcessState.displayMode === 'pd'
    const dbMin = pdMode ? 0 : Number(signalExcessState.dbMin)
    const dbMax = pdMode ? 100 : Number(signalExcessState.dbMax)
    if (Number.isFinite(dbMin) && Number.isFinite(dbMax) && dbMax > dbMin) {
      controls.dbMin = dbMin
      controls.dbMax = dbMax
    }
    controls.colorStops = SIGNAL_EXCESS_COLOR_STOPS
  }
  return controls
}

function updateExaggerationHandle() {
  if (exaggerationDragging.value) return
  const b = grid.value?.bounds
  const depthMin = Number(grid.value?.min)
  if (!b || !lastScene?.project || !(depthMin < 0)) {
    exaggerationHandle.value = null
    return
  }
  // 锚点只跟随海面原点，不使用随垂直夸张变化的深度投影，
  // 这样调整倍率时拉杆不会在 Z 轴上滑动，拖动过程中始终固定。
  const origin = lastScene.project(b.west, b.south, 0)
  if (![origin?.x, origin?.y].every(Number.isFinite)) {
    exaggerationHandle.value = null
    return
  }
  exaggerationHandle.value = {
    x: origin.x,
    y: origin.y + EXAGGERATION_HANDLE_OFFSET,
  }
}

function draw() {
  drawRaf = 0
  if (!props.active || !canvasEl.value || !grid.value) return
  const controls = sceneControls()
  let paintTerrain = true
  if (terrainGl) {
    try {
      paintTerrain = !terrainGl.render(grid.value, camera.value, controls)
    } catch (error) {
      console.warn('[terrain] WebGL 地形渲染失败，回退到 Canvas 渲染：', error)
      terrainGl.dispose()
      terrainGl = null
    }
  }
  lastScene = drawTerrainScene(canvasEl.value, grid.value, {
    field: props.field,
    fields: props.fields,
    source: props.source,
    receiver: terrainReceiver.value,
    camera: camera.value,
    controls,
    paintTerrain,
    meshMax: interactionActive ? INTERACTIVE_MESH_SEGMENTS : TERRAIN_MAX_MESH_SEGMENTS,
    rayScene: null,
    raySource: props.raySource,
    directionLine: {
      visible: props.directionLineVisible,
      azimuthDeg: props.rayAzimuthDeg,
      layerId: props.directionLineLayerId,
    },
  })
  updateExaggerationHandle()
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
  if (oceanCurrentOverlayOn.value && lastScene?.project && oceanCurrentLayer.value) {
    drawWeatherOverlay(
      canvasEl.value, lastScene, grid.value, OCEAN_CURRENT_OVERLAY_FIELD,
      oceanCurrentLayer.value, weatherNoiseState.oceanCurrentDynamic,
      performance.now() - overlayClockStart,
    )
  }
  if (regionalNoiseOverlayOn.value && lastScene?.project && weatherNoiseState.regionalNoise) {
    drawRegionalNoiseOverlay(canvasEl.value, lastScene, grid.value, weatherNoiseState.regionalNoise)
  }
  drawAisVessels()
  drawRays()
  drawTrack()
}

function drawTrack() {
  if (!trackCanvasEl.value || !props.active) return
  const canvas = trackCanvasEl.value
  const rect = canvas.getBoundingClientRect()
  const width = rect.width
  const height = rect.height
  if (!width || !height) return
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr)
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const project = lastScene?.project
  const points = trackPointState.points
  if (typeof project !== 'function' || !points.length) return
  // 航迹点位于海面，统一投影到 0 m 高程。
  const projected = points
    .map(point => project(point.lon, point.lat, 0))
    .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!projected.length) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (projected.length >= 2) {
    ctx.beginPath()
    projected.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)))
    ctx.strokeStyle = 'rgba(56, 214, 255, 0.28)'
    ctx.lineWidth = 7
    ctx.stroke()
    ctx.strokeStyle = 'rgba(56, 214, 255, 0.94)'
    ctx.lineWidth = 2.4
    ctx.stroke()
  }
  projected.forEach((point, index) => {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = index === 0 ? '#7ef7ff' : '#38d6ff'
    ctx.fill()
    ctx.lineWidth = 1.6
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  })
  ctx.restore()
}

function aisSourceColor(level) {
  return level >= 185 ? '#ff4e55' : level >= 175 ? '#ffb72e' : level >= 160 ? '#f3da25' : '#24d99b'
}

function drawSelectedAisTrack(ctx, project, currentPosition, opacity = 1) {
  if (opacity <= 0) return
  if (selectedAisTrackState.mmsi !== aisMonitorState.selectedMmsi) return
  const points = selectedAisTrackState.points
  let measured
  if (aisTrackProjectionCache.project === project && aisTrackProjectionCache.points === points) {
    measured = aisTrackProjectionCache.projected
  } else {
    measured = points
      .map(point => project(point.longitude, point.latitude, AIS_SEA_SURFACE_ELEVATION_M))
      .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    aisTrackProjectionCache = { project, points, projected: measured }
  }
  if (!measured.length) return
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (measured.length > 1) {
    ctx.beginPath()
    measured.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
    ctx.strokeStyle = 'rgba(70, 229, 255, .92)'
    ctx.lineWidth = 2.2
    ctx.shadowColor = '#20bdda'
    ctx.shadowBlur = 5
    ctx.stroke()
  }
  const latestMeasured = measured.at(-1)
  const projected = currentPosition
    ? project(currentPosition.longitude, currentPosition.latitude, AIS_SEA_SURFACE_ELEVATION_M)
    : null
  if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
    ctx.beginPath()
    ctx.moveTo(latestMeasured.x, latestMeasured.y)
    ctx.lineTo(projected.x, projected.y)
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(255, 255, 255, .72)'
    ctx.lineWidth = 1.4
    ctx.shadowBlur = 0
    ctx.stroke()
  }
  ctx.restore()
}

function drawAisMarker(ctx, project, point, vessel, color, selected, movingPosition, opacity = 1) {
  if (opacity <= 0) return null
  const displayVessel = selected && movingPosition ? { ...vessel, ...movingPosition } : vessel
  const heading = screenHeadingAngle(
    project,
    Number(displayVessel.longitude),
    Number(displayVessel.latitude),
    aisHeadingDegrees(displayVessel),
    AIS_SEA_SURFACE_ELEVATION_M
  )
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(point.x, point.y)
  ctx.rotate(heading)
  if (!selected) {
    // 非选中船舶用半透明外圈代替 shadowBlur，绘制量小很多。
    ctx.beginPath()
    ctx.arc(0, 0, 9, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.globalAlpha = opacity * 0.18
    ctx.fill()
    ctx.globalAlpha = opacity
  }
  ctx.shadowColor = color
  ctx.shadowBlur = selected ? 12 : 0
  ctx.fillStyle = color
  ctx.strokeStyle = selected ? '#ffffff' : '#062033'
  ctx.lineWidth = selected ? 2 : 1.2
  ctx.beginPath()
  ctx.moveTo(0, -10)
  ctx.lineTo(6, 7)
  ctx.lineTo(0, 4)
  ctx.lineTo(-6, 7)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  if (selected) {
    ctx.save()
    ctx.globalAlpha = opacity
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(point.x, point.y, 15, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#e9f8ff'
    ctx.font = "600 9px 'Microsoft YaHei', sans-serif"
    ctx.fillText(displayVessel.vessel_name || `MMSI ${displayVessel.mmsi}`, point.x + 18, point.y - 7)
    ctx.restore()
  }
  return displayVessel
}

function rebuildAisStaticVessels(ctx, project, activeBounds, width, height, dpr) {
  ctx.clearRect(0, 0, width, height)
  const hits = []
  for (const vessel of aisMonitorState.vessels) {
    if (vessel.mmsi === aisMonitorState.selectedMmsi) continue
    const lon = Number(vessel.longitude)
    const lat = Number(vessel.latitude)
    if (lon < activeBounds.west || lon > activeBounds.east || lat < activeBounds.south || lat > activeBounds.north) continue
    const point = project(lon, lat, AIS_SEA_SURFACE_ELEVATION_M)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    if (point.x < -18 || point.x > width + 18 || point.y < -18 || point.y > height + 18) continue
    drawAisMarker(ctx, project, point, vessel, aisSourceColor(vessel.source_level_db), false, null)
    hits.push({ x: point.x, y: point.y, vessel })
  }
  aisStaticCache = {
    grid: grid.value,
    vessels: aisMonitorState.vessels,
    selectedMmsi: aisMonitorState.selectedMmsi,
    camera: camera.value,
    exaggeration: visualControls.terrainExaggeration,
    width,
    height,
    dpr,
    hits,
  }
  return hits
}

function drawAisVessels() {
  if (!aisCanvasEl.value || !aisDynamicCanvasEl.value || !props.active) return
  const staticCanvas = aisCanvasEl.value
  const dynamicCanvas = aisDynamicCanvasEl.value
  const rect = staticCanvas.getBoundingClientRect()
  const width = rect.width
  const height = rect.height
  if (!width || !height) return
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (staticCanvas.width !== pixelWidth) staticCanvas.width = pixelWidth
  if (staticCanvas.height !== pixelHeight) staticCanvas.height = pixelHeight
  if (dynamicCanvas.width !== pixelWidth) dynamicCanvas.width = pixelWidth
  if (dynamicCanvas.height !== pixelHeight) dynamicCanvas.height = pixelHeight
  const staticCtx = staticCanvas.getContext('2d')
  const dynamicCtx = dynamicCanvas.getContext('2d')
  staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  dynamicCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  dynamicCtx.clearRect(0, 0, width, height)
  aisMarkerHits = []
  aisSelectedMarkerHit = null
  if (!aisMonitorState.displayEnabled) return
  const project = lastScene?.project
  const activeBounds = grid.value?.bounds || loadedBounds.value || bounds.value
  if (typeof project !== 'function' || !activeBounds) return

  const cache = aisStaticCache
  const reuseStatic = cache
    && cache.grid === grid.value
    && cache.vessels === aisMonitorState.vessels
    && cache.selectedMmsi === aisMonitorState.selectedMmsi
    && cache.camera === camera.value
    && cache.exaggeration === visualControls.terrainExaggeration
    && cache.width === width
    && cache.height === height
    && cache.dpr === dpr
  if (!reuseStatic) {
    rebuildAisStaticVessels(staticCtx, project, activeBounds, width, height, dpr)
  }
  aisMarkerHits = aisStaticCache?.hits || []

  const movingPosition = selectedAisMotionPosition()
  const opacity = selectedAisTrackOpacity()
  drawSelectedAisTrack(dynamicCtx, project, movingPosition, opacity)

  const selected = selectedAisVessel.value
  if (opacity > 0 && selected && selected.mmsi === aisMonitorState.selectedMmsi) {
    const displayVessel = movingPosition ? { ...selected, ...movingPosition } : selected
    const lon = Number(displayVessel.longitude)
    const lat = Number(displayVessel.latitude)
    if (lon >= activeBounds.west && lon <= activeBounds.east &&
        lat >= activeBounds.south && lat <= activeBounds.north) {
      const point = project(lon, lat, AIS_SEA_SURFACE_ELEVATION_M)
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
          point.x >= -18 && point.x <= width + 18 &&
          point.y >= -18 && point.y <= height + 18) {
        const color = aisSourceColor(selected.source_level_db)
        const rendered = drawAisMarker(dynamicCtx, project, point, selected, color, true, movingPosition, opacity)
        if (rendered) aisSelectedMarkerHit = { x: point.x, y: point.y, vessel: rendered }
      }
    }
  }
}

function stopAisMotionAnimation() {
  if (aisMotionRaf) cancelAnimationFrame(aisMotionRaf)
  aisMotionRaf = 0
}

function syncAisMotionAnimation() {
  stopAisMotionAnimation()
  aisMotionLastAt = 0
  if (!props.active || !selectedAisTrackState.mmsi || document.hidden) return
  const tick = (now) => {
    if (!props.active || !selectedAisTrackState.mmsi || disposed) {
      aisMotionRaf = 0
      return
    }
    if (!aisMotionLastAt || now - aisMotionLastAt >= AIS_MOTION_FRAME_MS) {
      aisMotionLastAt = now
      drawAisVessels()
    }
    aisMotionRaf = requestAnimationFrame(tick)
  }
  aisMotionRaf = requestAnimationFrame(tick)
}

function drawRays() {
  if (!rayCanvasEl.value || !props.active) return
  const canvas = rayCanvasEl.value
  const rect = canvas.getBoundingClientRect()
  const width = rect.width
  const height = rect.height
  if (!width || !height) return
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr)
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const projector = lastScene?.projectPolar
  if (!props.raysVisible || !terrainRayFlow.value || typeof projector !== 'function') return

  const rayAngle = (Number(props.rayAzimuthDeg) || 0) * Math.PI / 180

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const project = (point) => {
    const p = projector(rayAngle, Number(point?.[0]) || 0, Number(point?.[1]) || 0)
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
  }
  const projectList = (points) => points.map(project).filter(Boolean)
  const stroke = (pts) => {
    ctx.beginPath()
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    ctx.stroke()
  }

  // 先绘制完整静态声线（动态开启时作为底图一起显示）。
  if (props.raysStatic) {
    const alpha = props.raysAnimated ? 0.42 : 0.72
    for (const track of terrainRayFlow.value.tracks ?? []) {
      const pts = projectList(track.points)
      if (pts.length < 2) continue
      ctx.strokeStyle = `rgba(235,248,255,${alpha})`
      ctx.lineWidth = props.raysAnimated ? 1.1 : 1.3
      stroke(pts)
    }
    if (!props.raysAnimated) {
      ctx.restore()
      return
    }
  }

  const motions = sampleRayMotion(terrainRayFlow.value, rayFlowClockElapsedMs())
  if (!motions.length) {
    ctx.restore()
    return
  }

  for (const motion of motions) {
    // 1) 淡显完整已走路径（保留已走过的声线）。
    if (Array.isArray(motion.path) && motion.path.length > 1) {
      const pts = projectList(motion.path)
      if (pts.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.lineWidth = 1.2
        stroke(pts)
      }
    }
    // 2) 头部多层拖尾（无发光，仅分层，与「拖尾发光 0%」一致）。
    const tail = motion.tail
    if (Array.isArray(tail) && tail.length > 1) {
      const tailPoints = tail.map(n => n.point)
      const layers = [
        { width: 2, alpha: 0.12, frac: 1.0 },
        { width: 1, alpha: 0.42, frac: 0.55 },
        { width: 1.65, alpha: 0.96, frac: 0.23 },
      ]
      for (const layer of layers) {
        const startIdx = Math.max(0, tailPoints.length - 1 - Math.round((tailPoints.length - 1) * layer.frac))
        const sub = tailPoints.slice(startIdx)
        if (sub.length < 2) continue
        const pts = projectList(sub)
        if (pts.length < 2) continue
        const tailP = pts[0]
        const headP = pts[pts.length - 1]
        const gradient = ctx.createLinearGradient(tailP.x, tailP.y, headP.x, headP.y)
        gradient.addColorStop(0, 'rgba(255,255,255,0)')
        gradient.addColorStop(1, `rgba(255,255,255,${layer.alpha.toFixed(3)})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = layer.width
        stroke(pts)
      }
    }
    // 3) 传播前沿头点。
    const head = motion.head
    if (head) {
      const hp = project(head)
      if (hp) {
        const radius = 3
        const radial = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, radius * 5)
        radial.addColorStop(0, 'rgba(255,255,255,0.9)')
        radial.addColorStop(0.28, 'rgba(200,240,255,0.5)')
        radial.addColorStop(1, 'rgba(200,240,255,0)')
        ctx.fillStyle = radial
        ctx.beginPath()
        ctx.arc(hp.x, hp.y, radius * 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.96)'
        ctx.beginPath()
        ctx.arc(hp.x, hp.y, Math.max(1.3, radius * 0.4), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

function scheduleDraw() {
  if (drawRaf || !props.active) return
  drawRaf = requestAnimationFrame(draw)
}

function beginInteraction() {
  interactionActive = true
  if (interactionTimer) {
    clearTimeout(interactionTimer)
    interactionTimer = 0
  }
}

function settleInteraction() {
  if (interactionTimer) clearTimeout(interactionTimer)
  interactionTimer = window.setTimeout(() => {
    interactionTimer = 0
    if (!interactionActive) return
    interactionActive = false
    scheduleDraw()
  }, 180)
}

function stopRayAnimation() {
  if (rayAnimationRaf) cancelAnimationFrame(rayAnimationRaf)
  rayAnimationRaf = 0
  rayAnimationLastAt = 0
}

function raysAnimating() {
  return props.raysVisible && !!terrainRayFlow.value && props.raysAnimated
}
function weatherDynamic() {
  return weatherOverlayOn.value && weatherNoiseState.overlayDynamic
}
function oceanCurrentDynamic() {
  return oceanCurrentOverlayOn.value && weatherNoiseState.oceanCurrentDynamic
}
function receiverAnimating() {
  return !!terrainReceiver.value
}
function terrainAnimating() {
  return raysAnimating() || weatherDynamic() || oceanCurrentDynamic() || receiverAnimating()
}

function syncRayAnimation() {
  stopRayAnimation()
  if (!props.active || !terrainAnimating() || document.hidden) {
    scheduleDraw()
    return
  }
  const tick = (now) => {
    if (!props.active || disposed) {
      stopRayAnimation()
      return
    }
    const rayOn = raysAnimating()
    const weatherOn = weatherDynamic()
    const currentOn = oceanCurrentDynamic()
    const receiverOn = receiverAnimating()
    if (!rayOn && !weatherOn && !currentOn && !receiverOn) {
      stopRayAnimation()
      return
    }
    if (!rayAnimationLastAt || now - rayAnimationLastAt >= 16) {
      rayAnimationLastAt = now
      if (rayOn) drawRays()
      if (weatherOn || currentOn || receiverOn) scheduleDraw()
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
  const { width, height } = canvasSize.value
  const b = grid.value?.bounds || bounds.value
  if (!b || !(width > 0) || !(height > 0)) {
    camera.value = { yaw: 0, pitch: TOP_DOWN_PITCH, zoom: 0.7, panX: 0, panY: 0 }
    scheduleDraw()
    return
  }
  // 俯视时让整块地形完整落在画布内：按南北边缘的透视缩放分别计算宽高上限，
  // 再同时确定缩放与垂直平移，避免只改 pitch 后地形被上下裁掉。
  const cosLat = Math.max(.1, Math.cos((Number(b.north) + Number(b.south)) / 2 * Math.PI / 180))
  const spanX = Math.max(1e-9, (Number(b.east) - Number(b.west)) * cosLat)
  const spanY = Math.max(1e-9, Number(b.north) - Number(b.south))
  const span = Math.max(spanX, spanY)
  const fullX = spanX / span
  const fullY = spanY / span
  const baseScale = Math.min(width * .72, height * 1.2)
  const southPerspective = 1 / (1 - fullY / 2 * .35)
  const northPerspective = 1 / (1 + fullY / 2 * .35)
  const usableWidth = Math.max(1, width * .84)
  const usableHeight = Math.max(1, height * .82)
  const maxWidth = fullX * Math.max(southPerspective, northPerspective) * baseScale
  const maxHeight = fullY / 2 * (southPerspective + northPerspective) * baseScale
  const zoom = Math.min(1, usableWidth / Math.max(1e-9, maxWidth), usableHeight / Math.max(1e-9, maxHeight))
  const centerOffset = fullY / 2 * (southPerspective - northPerspective) / 2 * baseScale * zoom
  const targetY = height * .06 + usableHeight / 2
  camera.value = {
    yaw: 0,
    pitch: TOP_DOWN_PITCH,
    zoom,
    panX: 0,
    panY: targetY - height * .40 - centerOffset,
  }
  scheduleDraw()
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function onKeyDown(event) {
  if (!props.active || event.defaultPrevented || event.repeat) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (isEditableTarget(event.target)) return
  if (event.key.toLowerCase() !== 'r') return
  event.preventDefault()
  resetCamera()
}

function locateSource() {
  bounds.value = sourceBounds()
  loadTerrain(bounds.value)
}

function sameTerrainBounds(a, b) {
  if (!a || !b) return false
  return Math.abs(Number(a.west) - Number(b.west)) < 1e-7
    && Math.abs(Number(a.east) - Number(b.east)) < 1e-7
    && Math.abs(Number(a.south) - Number(b.south)) < 1e-7
    && Math.abs(Number(a.north) - Number(b.north)) < 1e-7
}

/** 全球视图点“加载”后带入的选区；每次 token 变化只应用一次。 */
let appliedInitialBoundsToken = 0
function applyInitialBounds() {
  const requestToken = Number(props.initialBoundsToken) || 0
  if (!props.initialBounds || requestToken <= appliedInitialBoundsToken) return false
  appliedInitialBoundsToken = requestToken
  const target = normalizeTerrainBounds(props.initialBounds)
  if (sameTerrainBounds(target, bounds.value) && status.value !== 'idle') return false
  bounds.value = target
  // 每次切换到新的目标区域都从默认视角开始，保证声源位于地形视图中心。
  camera.value = { yaw: 0, pitch: 0.68, zoom: 1, panX: 0, panY: 0 }
  loadTerrain(target)
  return true
}

/** 直接加载指定区域；供工作区记录定位使用，绕开视图切换时的 token 时序。 */
function focusBounds(next) {
  appliedInitialBoundsToken = Math.max(
    appliedInitialBoundsToken,
    Number(props.initialBoundsToken) || 0
  )
  const target = normalizeTerrainBounds(next)
  bounds.value = target
  camera.value = { yaw: 0, pitch: 0.68, zoom: 1, panX: 0, panY: 0 }
  loadTerrain(target)
}
defineExpose({ focusBounds })

function syncSelectedAisTracking() {
  if (!props.active) return
  const mmsi = aisMonitorState.selectedMmsi
  if (!mmsi) {
    stopSelectedAisTracking()
    return
  }
  if (selectedAisTrackState.mmsi === mmsi) return
  const vessel = aisMonitorState.vessels.find(item => item.mmsi === mmsi)
    || aisMonitorState.selectedVesselSnapshot
  if (vessel?.mmsi !== mmsi) return
  startSelectedAisTracking(vessel)
  syncAisMotionAnimation()
}

function focusAisRequest() {
  const request = aisMonitorState.focusRequest
  if (!props.active || request?.viewMode !== 'terrain') return
  const lat = Number(request.latitude)
  const lon = Number(request.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
  syncSelectedAisTracking()
  const latSpan = 0.6
  const lonSpan = Math.min(2.4, latSpan / Math.max(0.25, Math.cos(lat * Math.PI / 180)))
  focusBounds({ west: lon - lonSpan / 2, east: lon + lonSpan / 2, south: lat - latSpan / 2, north: lat + latSpan / 2 })
}

function loadTerrainFromDock(next) {
  const target = normalizeTerrainBounds(next)
  emit('load-terrain', target)
  loadTerrain(target)
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
    const data = await loadBathymetry(target, TERRAIN_GRID_RESOLUTION, { source: bathymetrySourceState.source })
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

function switchBathymetrySource(source) {
  if (bathymetrySourceState.source === source) return
  setBathymetrySource(source)
  grid.value = null
  loadedBounds.value = null
  loadTerrain(bounds.value)
}

function startExaggerationDrag(event) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  exaggerationDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    value: Number(visualControls.terrainExaggeration) || 1,
  }
  exaggerationDragging.value = true
  beginInteraction()
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function onExaggerationPointerMove(event) {
  if (!exaggerationDrag || event.pointerId !== exaggerationDrag.pointerId) return
  event.preventDefault()
  const dy = event.clientY - exaggerationDrag.startY
  const next = clamp(exaggerationDrag.value * Math.exp(-dy * 0.008), 0.5, 50)
  visualControls.terrainExaggeration = Math.round(next * 10) / 10
}

function onExaggerationPointerUp(event) {
  if (!exaggerationDrag || event.pointerId !== exaggerationDrag.pointerId) return
  try { event.currentTarget?.releasePointerCapture?.(event.pointerId) } catch {}
  exaggerationDrag = null
  exaggerationDragging.value = false
  scheduleDraw()
  settleInteraction()
}

/** 方向方位线所属声场体（与 terrainScene 的 layerId 规则一致）。 */
function directionField() {
  const id = props.directionLineLayerId
  if (id && id !== 'current') {
    const layer = (props.fields || []).find(item => item?.id === id)
    if (layer?.field) return layer.field
  }
  return props.field
}

function directionMaxRadius() {
  const distances = directionField()?.grid?.distance
  if (!Array.isArray(distances) || !distances.length) return 0
  let max = 0
  for (const value of distances) {
    const n = Number(value)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

function canvasPoint(event) {
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!rect) return null
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function arrowTipPoint(azimuthDeg) {
  // 优先使用绘制时记录的箭头端点，保证命中判定与画面上看到的箭头一致。
  if (lastScene?.directionArrow?.tip) return lastScene.directionArrow.tip
  const projector = lastScene?.directionProjector || lastScene?.projectPolar
  const maxRadius = lastScene?.directionArrow?.maxRadius || directionMaxRadius()
  if (typeof projector !== 'function' || !(maxRadius > 0)) return null
  const point = projector(((Number(azimuthDeg) || 0) * Math.PI) / 180, maxRadius, 0)
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null
}

function isNearArrow(event) {
  if (!props.directionLineVisible) return false
  const point = canvasPoint(event)
  if (!point) return false
  const arrow = lastScene?.directionArrow
  const tip = arrow?.tip || arrowTipPoint(props.rayAzimuthDeg)
  if (!tip) return false
  if (Math.hypot(point.x - tip.x, point.y - tip.y) <= ARROW_HIT_RADIUS) return true
  // 箭头端未命中时，允许抓住方向线本身拖动。
  const start = arrow?.start
  if (!start) return false
  const dx = tip.x - start.x
  const dy = tip.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-6) return false
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1)
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t)) <= ARROW_HIT_RADIUS
}

function emitArrowAzimuth(deg) {
  pendingArrowDeg = ((Number(deg) % 360) + 360) % 360
  if (arrowEmitRaf) return
  arrowEmitRaf = requestAnimationFrame(() => {
    arrowEmitRaf = 0
    const value = pendingArrowDeg
    pendingArrowDeg = null
    if (value != null) emit('arrow-azimuth', value)
  })
}

function updateArrowFromPointer(event) {
  const projector = lastScene?.directionProjector || lastScene?.projectPolar
  const maxRadius = lastScene?.directionArrow?.maxRadius || directionMaxRadius()
  const point = canvasPoint(event)
  if (typeof projector !== 'function' || !(maxRadius > 0) || !point) return
  let bestDeg = (((Number(props.rayAzimuthDeg) || 0) % 360) + 360) % 360
  let bestDistance = Infinity
  // 数值反解：沿箭头圆周采样投影点，取离鼠标最近的角度（透视/旋转下仍准确）。
  for (let deg = 0; deg < 360; deg += 1) {
    const p = projector((deg * Math.PI) / 180, maxRadius, 0)
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const distance = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      bestDeg = deg
    }
  }
  emitArrowAzimuth(bestDeg)
}

function pickAisMarker(event) {
  const point = canvasPoint(event)
  if (!point) return null
  let nearest = null
  let bestDistance = 14 ** 2
  const consider = (marker) => {
    const distance = (marker.x - point.x) ** 2 + (marker.y - point.y) ** 2
    if (distance > bestDistance) return
    nearest = marker.vessel
    bestDistance = distance
  }
  for (const marker of aisMarkerHits) consider(marker)
  if (aisSelectedMarkerHit) consider(aisSelectedMarkerHit)
  return nearest
}

function onPointerDown(event) {
  if (!grid.value || (event.button !== 0 && event.button !== 2)) return
  const aisVessel = event.button === 0 ? pickAisMarker(event) : null
  if (aisVessel) {
    event.preventDefault()
    canvasEl.value?.setPointerCapture?.(event.pointerId)
    dragState = { pointerId: event.pointerId, mode: 'ais', vessel: aisVessel, x: event.clientX, y: event.clientY, moved: false }
    return
  }
  // 命中方向方位线箭头时优先进入旋转，而不是平移/旋转相机。
  if (event.button === 0 && isNearArrow(event)) {
    event.preventDefault()
    canvasEl.value?.setPointerCapture?.(event.pointerId)
    arrowDrag = { pointerId: event.pointerId }
    if (canvasEl.value) canvasEl.value.style.cursor = 'grabbing'
    return
  }
  const mode = event.button === 2 ? 'rotate' : 'pan'
  beginInteraction()
  canvasEl.value?.setPointerCapture?.(event.pointerId)
  dragState = {
    pointerId: event.pointerId,
    mode,
    x: event.clientX,
    y: event.clientY,
    yaw: camera.value.yaw,
    pitch: camera.value.pitch,
    panX: camera.value.panX,
    panY: camera.value.panY,
    moved: false,
  }
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
  if (arrowDrag?.pointerId === event.pointerId) {
    event.preventDefault()
    updateArrowFromPointer(event)
    return
  }
  if (dragState?.pointerId === event.pointerId) {
    const dx = event.clientX - dragState.x
    const dy = event.clientY - dragState.y
    if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true
    if (dragState.mode === 'ais') {
      hover.value = null
      return
    } else if (dragState.mode === 'rotate') {
      camera.value = {
        ...camera.value,
        yaw: dragState.yaw + dx * 0.009,
        pitch: clamp(dragState.pitch + dy * 0.006, MIN_CAMERA_PITCH, MAX_CAMERA_PITCH),
      }
    } else {
      camera.value = {
        ...camera.value,
        panX: dragState.panX + dx,
        panY: dragState.panY + dy,
      }
    }
    hover.value = null
    scheduleDraw()
    return
  }
  if (hoverRaf) return
  hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; pickHover(event) })
}

function onPointerUp(event) {
  if (arrowDrag?.pointerId === event.pointerId) {
    arrowDrag = null
    try { canvasEl.value?.releasePointerCapture?.(event.pointerId) } catch {}
    if (canvasEl.value) canvasEl.value.style.cursor = ''
    return
  }
  if (!dragState || dragState.pointerId !== event.pointerId) return
  const moved = dragState.moved
  const mode = dragState.mode
  const aisVessel = dragState.vessel
  dragState = null
  settleInteraction()
  try { canvasEl.value?.releasePointerCapture?.(event.pointerId) } catch {}
  if (!moved && mode === 'ais' && event.type !== 'pointercancel') {
    selectAisVessel(aisVessel, '')
    startSelectedAisTracking(aisVessel)
    syncAisMotionAnimation()
    return
  }
  if (!moved && mode === 'pan' && event.type !== 'pointercancel') {
    const rect = canvasEl.value.getBoundingClientRect()
    const picked = pickTerrainPoint(lastScene, event.clientX - rect.left, event.clientY - rect.top)
    if (trackPointDrawing.value) {
      if (picked && picked.elevation < 0 && addTrackPoint(picked)) scheduleDraw()
      hover.value = null
      return
    }
    if (signalTransmissionControls.showReceiver) {
      if (picked && picked.elevation < 0) emit('receiver-pick', picked)
      hover.value = null
      return
    }
    if (noiseProbeState.picking) {
      if (picked) {
        setWeatherNoisePoint(picked)
        setNoiseProbePicking(false)
      }
      hover.value = null
      return
    }
    // 「点选位置采样」关闭时，普通点击不弹出站点信息窗，也不会触发天气/噪声请求。
    if (!weatherNoiseState.hoverSampling) {
      hover.value = null
      return
    }
    station.value = picked
    if (picked) emit('station-pick', picked)
    hover.value = null
  }
}

function onPointerLeave() { if (!dragState) hover.value = null }

function onTrackDoubleClick(event) {
  if (!trackPointDrawing.value) return
  event.preventDefault?.()
  if (finishTrackPointsFromDoubleClick()) {
    signalTransmissionControls.selectTrackPoints = false
  }
  scheduleDraw()
}

function startGlobeTransition() {
  if (leavingForGlobe.value || disposed) return
  leavingForGlobe.value = true
  // 缩出动画期间改用较低网格精度，避免与全球视图初始化同时占用 CPU。
  if (interactionTimer) {
    clearTimeout(interactionTimer)
    interactionTimer = 0
  }
  interactionActive = true
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
  beginInteraction()
  camera.value = {
    ...camera.value,
    zoom: clamp(nextZoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM),
  }
  scheduleDraw()
  settleInteraction()
}

onMounted(() => {
  if (terrainGlCanvasEl.value) {
    terrainGl = createTerrainWebGLRenderer(terrainGlCanvasEl.value)
  }
  const updateCanvasSize = () => {
    const rect = canvasEl.value?.getBoundingClientRect()
    if (rect) canvasSize.value = { width: rect.width, height: rect.height }
  }
  resizeObserver = new ResizeObserver(() => { updateCanvasSize(); scheduleDraw() })
  if (canvasEl.value) { updateCanvasSize(); resizeObserver.observe(canvasEl.value) }
  setAisTrackRequestsEnabled(props.active)
  if (props.active && !applyInitialBounds()) locateSource()
  if (props.active) {
    nextTick(() => {
      syncSelectedAisTracking()
      syncAisMotionAnimation()
    })
  }
  document.addEventListener('visibilitychange', syncRayAnimation)
  document.addEventListener('visibilitychange', syncAisMotionAnimation)
  window.addEventListener('keydown', onKeyDown)
  rebuildRayFlow()
})

watch(() => props.active, (active) => {
  if (!active) {
    hover.value = null
    if (globeTransitionRaf) cancelAnimationFrame(globeTransitionRaf)
    globeTransitionRaf = 0
    if (interactionTimer) {
      clearTimeout(interactionTimer)
      interactionTimer = 0
    }
    interactionActive = false
    if (leavingForGlobe.value) {
      leavingForGlobe.value = false
      camera.value = savedTerrainCamera ? { ...savedTerrainCamera } : { ...camera.value, zoom: 1 }
    }
    stopRayAnimation()
    stopAisMotionAnimation()
    setAisTrackRequestsEnabled(false)
    stopSelectedAisTracking()
    return
  }
  savedTerrainCamera = null
  setAisTrackRequestsEnabled(true)
  nextTick(() => {
    if (aisMonitorState.focusRequest?.viewMode === 'terrain') {
      focusAisRequest()
      syncRayAnimation()
      return
    }
    if (applyInitialBounds()) return
    if (status.value === 'idle') locateSource()
    else scheduleDraw()
    const selected = aisMonitorState.vessels.find(item => item.mmsi === aisMonitorState.selectedMmsi)
      || aisMonitorState.selectedVesselSnapshot
    if (selected) startSelectedAisTracking(selected)
    syncAisMotionAnimation()
    syncRayAnimation()
  })
})
watch(() => aisMonitorState.focusToken, focusAisRequest)
watch(() => aisMonitorState.vessels, () => scheduleDraw())
watch(() => aisMonitorState.selectedMmsi, () => {
  syncSelectedAisTracking()
  scheduleDraw()
})
watch(() => selectedAisTrackState.points, () => drawAisVessels())
watch(() => aisMonitorState.displayEnabled, (enabled) => {
  aisStaticCache = null
  if (!enabled) {
    for (const canvas of [aisCanvasEl.value, aisDynamicCanvasEl.value]) {
      if (!canvas) continue
      const ctx = canvas.getContext('2d')
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }
  scheduleDraw()
})
watch(() => trackPointState.revision, () => scheduleDraw())
watch(() => signalTransmissionControls.showReceiver, () => scheduleDraw())
watch(() => props.initialBoundsToken, () => {
  if (!props.active) return
  applyInitialBounds()
})
// token 之外再监听选区值：任何入口（包括工作区定位）只要写入新的 initialBounds
// 都会立即加载，避免视图切换时 token 监听被跳过。
watch(() => props.initialBounds, (next) => {
  if (!next) return
  const target = normalizeTerrainBounds(next)
  if (sameTerrainBounds(target, bounds.value) && status.value !== 'idle') return
  focusBounds(target)
})
watch(bounds, (value) => {
  const next = { ...value }
  setTerrainCenter({ lon: (next.west + next.east) / 2, lat: (next.south + next.north) / 2 })
  setTerrainBounds(next)
  queueRegionalWeatherLoad()
  queueRegionalNoiseLoad()
  queueOceanCurrentLoad()
  emit('bounds-change', next)
}, { immediate: true })
watch(() => props.field, () => scheduleDraw())
watch(terrainReceiver, () => {
  scheduleDraw()
  syncRayAnimation()
}, { deep: true })
watch(() => props.fields, () => scheduleDraw(), { deep: true })
watch(() => props.rayData, rebuildRayFlow)
watch(
  () => [props.time, props.initialCenter?.lon, props.initialCenter?.lat, props.source?.lon, props.source?.lat],
  () => scheduleDraw()
)
watch(() => [props.rayAzimuthDeg, props.raysVisible, props.raysStatic, props.raysAnimated, props.directionLineVisible, props.directionLineLayerId, props.clipBody], () => {
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
  weatherNoiseState.frameIndex,
], () => {
  queueRegionalWeatherLoad()
  scheduleDraw()
  syncRayAnimation()
})
watch(() => [weatherNoiseState.overlayField, weatherNoiseState.overlayDynamic], () => {
  scheduleDraw()
  syncRayAnimation()
})
watch(() => [
  weatherNoiseState.regionalNoiseOverlay,
  weatherNoiseState.frameIndex,
  weatherNoiseState.selectedBandId,
], () => {
  queueRegionalNoiseLoad()
  scheduleDraw()
})
watch(() => [
  weatherNoiseState.oceanCurrentOverlay,
  weatherNoiseState.frameIndex,
], () => {
  queueOceanCurrentLoad()
  scheduleDraw()
  syncRayAnimation()
})
watch(() => [weatherNoiseState.oceanCurrentDepth, weatherNoiseState.oceanCurrentDynamic], () => {
  scheduleDraw()
  syncRayAnimation()
})

onBeforeUnmount(() => {
  disposed = true
  token += 1
  if (drawRaf) cancelAnimationFrame(drawRaf)
  stopRayAnimation()
  stopAisMotionAnimation()
  setAisTrackRequestsEnabled(false)
  stopSelectedAisTracking()
  if (hoverRaf) cancelAnimationFrame(hoverRaf)
  if (globeTransitionRaf) cancelAnimationFrame(globeTransitionRaf)
  if (regionalWeatherLoadTimer) clearTimeout(regionalWeatherLoadTimer)
  if (regionalNoiseLoadTimer) clearTimeout(regionalNoiseLoadTimer)
  if (oceanCurrentLoadTimer) clearTimeout(oceanCurrentLoadTimer)
  globeTransitionRaf = 0
  terrainGl?.dispose()
  terrainGl = null
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', syncRayAnimation)
  document.removeEventListener('visibilitychange', syncAisMotionAnimation)
  window.removeEventListener('keydown', onKeyDown)
  emit('anchor', null)
  emit('layer-anchors', {})
})
</script>

<style scoped>
.terrain-preview-mode { position: absolute; inset: 0; z-index: 8; overflow: hidden; color: #b8d6ec; background: radial-gradient(ellipse at 50% -8%, #123553 0%, #081a2b 46%, #03080f 100%); font: 12px 'Microsoft YaHei', sans-serif; }
.terrain-gl-canvas { position: absolute; inset: 0 0 25px; z-index: 0; width: 100%; height: calc(100% - 25px); display: block; pointer-events: none; }
.terrain-canvas { position: absolute; inset: 0 0 25px; z-index: 1; width: 100%; height: calc(100% - 25px); display: block; cursor: grab; touch-action: none; }
.terrain-canvas:active { cursor: grabbing; }
.ray-canvas { position: absolute; inset: 0 0 25px; z-index: 2; width: 100%; height: calc(100% - 25px); display: block; pointer-events: none; }
.ais-canvas { position: absolute; inset: 0 0 25px; z-index: 3; width: 100%; height: calc(100% - 25px); display: block; pointer-events: none; }
.ais-dynamic-canvas { position: absolute; inset: 0 0 25px; z-index: 3; width: 100%; height: calc(100% - 25px); display: block; pointer-events: none; }
.track-canvas { position: absolute; inset: 0 0 25px; z-index: 4; width: 100%; height: calc(100% - 25px); display: block; pointer-events: none; }
.exaggeration-handle { position: absolute; z-index: 5; width: 18px; height: 96px; display: grid; place-items: center; padding: 0; color: #8fb8cc; border: 1px solid #345b72; border-radius: 9px; background: linear-gradient(#17364a, #0d2434); box-shadow: 0 2px 8px #00101d88; transform: translate(-50%, -50%); cursor: ns-resize; touch-action: none; }
.exaggeration-handle span { font-size: 15px; line-height: 1; text-shadow: 0 1px 2px #00101d; }
.exaggeration-handle:hover, .exaggeration-handle.active { color: #eaffff; border-color: #38c8f0; background: linear-gradient(#1d4c63, #123244); box-shadow: 0 0 10px #38c8f088, 0 2px 8px #00101d88; }
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
.terrain-legend { position: absolute; right: 16px; bottom: 34px; z-index: 6; width: 196px; padding: 7px 9px 6px; box-sizing: border-box; border: 1px solid #274255; border-radius: 5px; background: #061522d9; pointer-events: none; }
.terrain-legend-title { display: block; margin-bottom: 4px; color: #cfe9f6; font-size: 10px; }
.terrain-legend-bar { height: 7px; border: 1px solid #2c4c62; border-radius: 2px; }
.terrain-legend-ticks { display: flex; justify-content: space-between; margin-top: 3px; color: #8fb8cc; font: 9px ui-monospace, monospace; }
.terrain-status { position: absolute; bottom: 0; left: 0; right: 0; z-index: 6; height: 24px; display: flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box; background: #101e30; border-top: 1px solid #304256; font-size: 10px; }
.terrain-status i { width: 6px; height: 6px; border-radius: 50%; background: #00c8b0; }.terrain-status a { margin-left: 8px; color: #83a9c0; text-decoration: none; }.terrain-warn { color: #f1c38c; }
.terrain-source { display: flex; gap: 2px; margin-left: auto; }
.terrain-source button { padding: 1px 7px; border: 1px solid #35516a; border-radius: 3px; background: #14283c; color: #9bbdd3; font: inherit; font-size: 10px; line-height: 16px; cursor: pointer; }
.terrain-source button:hover { border-color: #5c90b3; color: #dff6ff; }
.terrain-source button.active { border-color: #00b7a4; background: #0d3a3c; color: #66ebda; }
@keyframes pulse { to { opacity: .3; } }
</style>
