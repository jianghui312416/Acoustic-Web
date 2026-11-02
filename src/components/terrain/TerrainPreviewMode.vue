<template>
  <section class="terrain-preview-mode" aria-label="区域海底地形">
    <canvas ref="canvasEl" class="terrain-canvas" style="position:absolute;inset:0 0 25px;width:100%;height:calc(100% - 25px);display:block"
      aria-label="区域海底地形，左键拖动平移，右键拖动旋转，滚轮缩放，悬停查看深度"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
      @pointercancel="onPointerUp" @pointerleave="onPointerLeave" @wheel.prevent="onWheel"
      @contextmenu.prevent></canvas>
    <canvas ref="rayCanvasEl" class="ray-canvas" aria-hidden="true"></canvas>
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
      <button class="compass" title="恢复正北视角（R）" aria-label="恢复正北视角（R）" @click="resetCamera">
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
    <slot :anchor="anchor" />
    <TerrainPreviewDock v-model:bounds="bounds" :collapsed="thumbnailCollapsed" :loading="status === 'loading'"
      @update:collapsed="$emit('update:thumbnailCollapsed', $event)" @load="loadTerrainFromDock" @locate="locateSource" />
    <footer class="terrain-status">
      <i></i>
      <span v-if="hover">经度 {{ hover.lon.toFixed(4) }}°　纬度 {{ hover.lat.toFixed(4) }}°　{{ hover.elevation < 0 ? '水深' : '高程' }} {{ Math.abs(hover.elevation).toFixed(0) }} m</span>
      <span v-else-if="error" class="terrain-warn">{{ error }}</span>
      <span v-else>{{ status === 'loading' ? '正在加载地形' : grid ? '地形已就绪' : '等待加载地形' }}</span>
      <a href="https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid" target="_blank" rel="noreferrer">GEBCO 2026 海底高程</a>
    </footer>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { normalizeTerrainBounds } from '@/utils/terrainPreview.js'
import { loadBathymetry, acousticTerrainBounds } from '@/utils/bathymetry.js'
import { drawTerrainScene, terrainMetersPerPixel } from '@/utils/terrainScene.js'
import TerrainPreviewDock from './TerrainPreviewDock.vue'
import TerrainStationCard from './TerrainStationCard.vue'
import { pickTerrainPoint } from '@/utils/terrainPicking.js'
import { activeVolumeColorStops, volumeRenderingControls } from '@/modules/acoustic/volumeRenderingControls.js'
import { parseAnalyse2DRtrd } from '@/sdk'
import { resolveRayFlow, sampleRayMotion } from '@/utils/rayFlow.js'
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
  /** 全球视图红框选中的区域；token 变化时才重新加载，避免覆盖运行后的声源取景。 */
  initialBounds: { type: Object, default: null },
  initialBoundsToken: { type: Number, default: 0 },
  thumbnailCollapsed: { type: Boolean, default: false },
  /** 参数卡片打开期间暂时隐藏站点卡片，关闭后恢复。 */
  stationParametersOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['anchor', 'layer-anchors', 'bounds-change', 'load-terrain', 'request-globe', 'station-run', 'station-parameters', 'station-pick', 'noise', 'update:thumbnailCollapsed'])
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

const canvasEl = ref(null)
const rayCanvasEl = ref(null)
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
const MAX_CAMERA_ZOOM = 40
const MIN_CAMERA_PITCH = 0.05
const MAX_CAMERA_PITCH = 1.5
const EXAGGERATION_HANDLE_OFFSET = 64
const leavingForGlobe = ref(false)
const terrainRayFlow = shallowRef(null)
const overlayClockStart = performance.now()
const weatherOverlayOn = computed(() => weatherOverlayActive(weatherNoiseState))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 首次加载地形时固定使用 100 km × 100 km，避免直接运行时被传播距离提前改写。 */
const DEFAULT_TERRAIN_SPAN_KM = 100

function sourceBounds() {
  const center = props.source || props.initialCenter || { lon: 116, lat: 16 }
  const radiusKm = grid.value ? props.radiusKm : DEFAULT_TERRAIN_SPAN_KM / 6
  return acousticTerrainBounds(center, radiusKm)
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
  lastScene = drawTerrainScene(canvasEl.value, grid.value, {
    field: props.field,
    fields: props.fields,
    source: props.source,
    receiver: props.receiver,
    camera: camera.value,
    controls: sceneControls(),
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
  drawRays()
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
function terrainAnimating() {
  return raysAnimating() || weatherDynamic()
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
    if (!rayOn && !weatherOn) {
      stopRayAnimation()
      return
    }
    if (!rayAnimationLastAt || now - rayAnimationLastAt >= 16) {
      rayAnimationLastAt = now
      if (rayOn) drawRays()
      if (weatherOn) scheduleDraw()
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
  camera.value = { yaw: 0, pitch: 0.68, zoom: 1, panX: 0, panY: 0 }
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
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function onExaggerationPointerMove(event) {
  if (!exaggerationDrag || event.pointerId !== exaggerationDrag.pointerId) return
  event.preventDefault()
  const dy = event.clientY - exaggerationDrag.startY
  const next = clamp(exaggerationDrag.value * Math.exp(-dy * 0.008), 1, 30)
  visualControls.terrainExaggeration = Math.round(next * 10) / 10
}

function onExaggerationPointerUp(event) {
  if (!exaggerationDrag || event.pointerId !== exaggerationDrag.pointerId) return
  try { event.currentTarget?.releasePointerCapture?.(event.pointerId) } catch {}
  exaggerationDrag = null
  exaggerationDragging.value = false
  scheduleDraw()
}

function onPointerDown(event) {
  if (!grid.value || (event.button !== 0 && event.button !== 2)) return
  const mode = event.button === 2 ? 'rotate' : 'pan'
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
  if (dragState?.pointerId === event.pointerId) {
    const dx = event.clientX - dragState.x
    const dy = event.clientY - dragState.y
    if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true
    if (dragState.mode === 'rotate') {
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
  if (!dragState || dragState.pointerId !== event.pointerId) return
  const moved = dragState.moved
  const mode = dragState.mode
  dragState = null
  try { canvasEl.value?.releasePointerCapture?.(event.pointerId) } catch {}
  if (!moved && mode === 'pan' && event.type !== 'pointercancel') {
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
    if (picked) emit('station-pick', picked)
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
  window.addEventListener('keydown', onKeyDown)
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
watch(() => [props.rayAzimuthDeg, props.raysVisible, props.raysStatic, props.raysAnimated, props.directionLineVisible, props.directionLineLayerId], () => {
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
  window.removeEventListener('keydown', onKeyDown)
  emit('anchor', null)
  emit('layer-anchors', {})
})
</script>

<style scoped>
.terrain-preview-mode { position: absolute; inset: 0; z-index: 8; overflow: hidden; color: #b8d6ec; background: radial-gradient(ellipse at 20% 0%, #244777, transparent 80%), linear-gradient(140deg,#162a4d 15%,#4b617d 65%,#9399a3); font: 12px 'Microsoft YaHei', sans-serif; }
.terrain-canvas { position: absolute; inset: 0 0 25px; z-index: 0; width: 100%; height: calc(100% - 25px); display: block; cursor: grab; touch-action: none; }
.terrain-canvas:active { cursor: grabbing; }
.ray-canvas { position: absolute; inset: 0 0 25px; z-index: 1; width: 100%; height: calc(100% - 25px); display: block; pointer-events: none; }
.exaggeration-handle { position: absolute; z-index: 3; width: 18px; height: 96px; display: grid; place-items: center; padding: 0; color: #8fb8cc; border: 1px solid #345b72; border-radius: 9px; background: linear-gradient(#17364a, #0d2434); box-shadow: 0 2px 8px #00101d88; transform: translate(-50%, -50%); cursor: ns-resize; touch-action: none; }
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
.terrain-status { position: absolute; bottom: 0; left: 0; right: 0; z-index: 6; height: 24px; display: flex; align-items: center; gap: 8px; padding: 0 14px; box-sizing: border-box; background: #101e30; border-top: 1px solid #304256; font-size: 10px; }
.terrain-status i { width: 6px; height: 6px; border-radius: 50%; background: #00c8b0; }.terrain-status a { margin-left: auto; color: #83a9c0; text-decoration: none; }.terrain-warn { color: #f1c38c; }
@keyframes pulse { to { opacity: .3; } }
</style>
