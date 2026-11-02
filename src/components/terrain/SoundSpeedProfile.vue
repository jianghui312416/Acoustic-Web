<template>
  <div ref="containerEl" class="ssp-chart" :class="{ 'is-zoomed': zoomed }">
    <svg v-if="points.length" ref="svgEl" viewBox="0 0 300 350" role="img"
      aria-label="声速随深度变化剖面，横轴声速米每秒，纵轴深度米"
      @wheel.prevent="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove"
      @pointerup="onPointerUp" @pointercancel="onPointerCancel" @pointerleave="onPointerLeave"
      @dblclick.prevent="resetZoom">
      <defs>
        <clipPath :id="clipId">
          <rect :x="PLOT_LEFT" :y="PLOT_TOP" :width="PLOT_WIDTH" :height="PLOT_HEIGHT" />
        </clipPath>
      </defs>
      <text x="155" y="15" text-anchor="middle">声速 (m/s)</text>
      <template v-for="tick in speedTicks" :key="`x-${tick.value}`">
        <line :x1="tick.x" :x2="tick.x" y1="38" y2="318" />
        <text :x="tick.x" y="30" text-anchor="middle">{{ tick.label }}</text>
      </template>
      <template v-for="tick in depthTicks" :key="`y-${tick.value}`">
        <line x1="44" x2="280" :y1="tick.y" :y2="tick.y" />
        <text x="36" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
      </template>
      <text transform="translate(11,190) rotate(-90)" text-anchor="middle">深度 (m)</text>
      <g :clip-path="`url(#${clipId})`">
        <polyline :points="polyline" fill="none" stroke="#00e2cf" stroke-width="2" />
      </g>
      <circle v-if="hoverPoint" :cx="hoverPoint.x" :cy="hoverPoint.y" r="4"
        fill="#f8fafc" stroke="#00e2cf" stroke-width="2" />
      <text v-if="hasCoords" x="280" y="333" text-anchor="end">位置 {{ coordText }}</text>
      <text x="280" y="345" text-anchor="end">当前计算环境 · {{ points.length }} 个采样点</text>
    </svg>
    <div v-else class="ssp-empty">当前结果未包含声速剖面数据</div>
    <button v-if="zoomed" type="button" class="ssp-zoom-reset" title="复位缩放" aria-label="复位缩放"
      @click.stop="resetZoom">
      <i aria-hidden="true">↻</i>{{ zoomFactor.toFixed(1) }}X
    </button>
    <div v-if="hoverPoint" class="ssp-tooltip" :style="{ left: `${hoverPoint.tipLeft}px`, top: `${hoverPoint.tipTop}px` }">
      <div>声速 {{ hoverPoint.speed.toFixed(1) }} m/s</div>
      <div>深度 {{ hoverPoint.depth.toFixed(1) }} m</div>
      <div v-if="hasCoords">纬度 {{ latText }}</div>
      <div v-if="hasCoords">经度 {{ lonText }}</div>
    </div>
    <div v-else-if="points.length" class="ssp-hint">滚轮缩放 · 拖拽平移 · 双击复位</div>
  </div>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { formatCoordinate, formatCoordPair } from '@/utils/coordinateFormat.js'

const props = defineProps({
  profile: { type: Object, default: null },
  readoutEnabled: { type: Boolean, default: false },
  sourceLon: { type: Number, default: NaN },
  sourceLat: { type: Number, default: NaN },
  coordinateFormat: { type: String, default: 'DD' },
})

const PLOT_LEFT = 44
const PLOT_TOP = 38
const PLOT_WIDTH = 236
const PLOT_HEIGHT = 280
const PLOT_RIGHT = PLOT_LEFT + PLOT_WIDTH
const PLOT_BOTTOM = PLOT_TOP + PLOT_HEIGHT
const TICK_COUNT = 5

let uidSeed = 0
const clipId = `ssp-clip-${++uidSeed}-${Math.random().toString(36).slice(2, 7)}`

const containerEl = ref(null)
const svgEl = ref(null)
const hoverPoint = ref(null)

const points = computed(() => (props.profile?.depth || [])
  .map((depth, i) => ({ depth, speed: props.profile.speed[i] }))
  .filter((p) => Number.isFinite(p.depth) && Number.isFinite(p.speed) && p.speed > 0)
  .sort((a, b) => a.depth - b.depth))

const fullDomain = computed(() => {
  const list = points.value
  if (!list.length) return { speedMin: 0, speedMax: 10, depthMin: 0, depthMax: 1 }
  const minSpeed = Math.floor(Math.min(...list.map((p) => p.speed)) / 10) * 10
  const maxSpeed = Math.max(minSpeed + 10, Math.ceil(Math.max(...list.map((p) => p.speed)) / 10) * 10)
  const maxDepth = Math.max(1, ...list.map((p) => p.depth))
  return { speedMin: minSpeed, speedMax: maxSpeed, depthMin: 0, depthMax: maxDepth }
})

const view = reactive({ ...fullDomain.value })

watch(points, () => {
  Object.assign(view, fullDomain.value)
  hoverPoint.value = null
}, { immediate: true })

watch(() => props.readoutEnabled, (enabled) => {
  if (!enabled) hoverPoint.value = null
})

const speedSpan = computed(() => Math.max(1e-9, view.speedMax - view.speedMin))
const depthSpan = computed(() => Math.max(1e-9, view.depthMax - view.depthMin))

const hasCoords = computed(() => Number.isFinite(Number(props.sourceLon)) && Number.isFinite(Number(props.sourceLat)))
const latText = computed(() => formatCoordinate(props.sourceLat, props.coordinateFormat, true))
const lonText = computed(() => formatCoordinate(props.sourceLon, props.coordinateFormat, false))
const coordText = computed(() => formatCoordPair(props.sourceLat, props.sourceLon, props.coordinateFormat))

const zoomed = computed(() => {
  const f = fullDomain.value
  return view.speedMin > f.speedMin + 1e-6 || view.speedMax < f.speedMax - 1e-6
    || view.depthMin > f.depthMin + 1e-6 || view.depthMax < f.depthMax - 1e-6
})

const zoomFactor = computed(() => {
  const f = fullDomain.value
  const speedFactor = (f.speedMax - f.speedMin) / speedSpan.value
  const depthFactor = (f.depthMax - f.depthMin) / depthSpan.value
  return Math.max(1, speedFactor, depthFactor)
})

function tickDigits(step) {
  if (step >= 10) return 0
  if (step >= 1) return 1
  return 2
}

function axisValueLabel(value, step) {
  const digits = tickDigits(step)
  return Number(Number(value).toFixed(digits)).toString()
}

const speedTicks = computed(() => {
  const step = speedSpan.value / (TICK_COUNT - 1)
  return Array.from({ length: TICK_COUNT }, (_, i) => {
    const value = view.speedMin + step * i
    return { value, x: PLOT_LEFT + (PLOT_WIDTH * i) / (TICK_COUNT - 1), label: axisValueLabel(value, step) }
  })
})

const depthTicks = computed(() => {
  const step = depthSpan.value / (TICK_COUNT - 1)
  return Array.from({ length: TICK_COUNT }, (_, i) => {
    const value = view.depthMin + step * i
    return { value, y: PLOT_TOP + (PLOT_HEIGHT * i) / (TICK_COUNT - 1), label: axisValueLabel(value, step) }
  })
})

function pointCoord(point) {
  return {
    x: PLOT_LEFT + ((point.speed - view.speedMin) / speedSpan.value) * PLOT_WIDTH,
    y: PLOT_TOP + ((point.depth - view.depthMin) / depthSpan.value) * PLOT_HEIGHT,
  }
}

const polyline = computed(() => points.value.map((point) => {
  const coord = pointCoord(point)
  return `${coord.x},${coord.y}`
}).join(' '))

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function inPlot(loc) {
  return loc && loc.x >= PLOT_LEFT && loc.x <= PLOT_RIGHT && loc.y >= PLOT_TOP && loc.y <= PLOT_BOTTOM
}

function eventToSvg(event) {
  const svg = svgEl.value
  if (!svg || typeof svg.createSVGPoint !== 'function') return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const local = point.matrixTransform(ctm.inverse())
  return { x: local.x, y: local.y }
}

function svgToClient(coord) {
  const svg = svgEl.value
  if (!svg || typeof svg.createSVGPoint !== 'function') return null
  const point = svg.createSVGPoint()
  point.x = coord.x
  point.y = coord.y
  const screen = point.matrixTransform(svg.getScreenCTM())
  return { x: screen.x, y: screen.y }
}

function applyZoom(factor, anchorX, anchorY) {
  const full = fullDomain.value
  const currentSpeedSpan = speedSpan.value
  const currentDepthSpan = depthSpan.value
  const fullSpeedSpan = full.speedMax - full.speedMin
  const fullDepthSpan = full.depthMax - full.depthMin
  const nextSpeedSpan = clamp(currentSpeedSpan * factor, fullSpeedSpan / 40, fullSpeedSpan)
  const nextDepthSpan = clamp(currentDepthSpan * factor, fullDepthSpan / 40, fullDepthSpan)
  const anchorSpeed = view.speedMin + currentSpeedSpan * anchorX
  const anchorDepth = view.depthMin + currentDepthSpan * anchorY

  let speedMin = anchorSpeed - nextSpeedSpan * anchorX
  speedMin = clamp(speedMin, full.speedMin, full.speedMax - nextSpeedSpan)
  let depthMin = anchorDepth - nextDepthSpan * anchorY
  depthMin = clamp(depthMin, full.depthMin, full.depthMax - nextDepthSpan)

  view.speedMin = speedMin
  view.speedMax = speedMin + nextSpeedSpan
  view.depthMin = depthMin
  view.depthMax = depthMin + nextDepthSpan
}

function onWheel(event) {
  const loc = eventToSvg(event)
  if (!inPlot(loc)) return
  const anchorX = clamp((loc.x - PLOT_LEFT) / PLOT_WIDTH, 0, 1)
  const anchorY = clamp((loc.y - PLOT_TOP) / PLOT_HEIGHT, 0, 1)
  const factor = event.deltaY < 0 ? 0.82 : 1.22
  applyZoom(factor, anchorX, anchorY)
  updateHover(loc)
}

let dragState = null

function onPointerDown(event) {
  if (event.button !== 0) return
  const loc = eventToSvg(event)
  if (!inPlot(loc)) return
  dragState = {
    x: loc.x,
    y: loc.y,
    speedMin: view.speedMin,
    speedMax: view.speedMax,
    depthMin: view.depthMin,
    depthMax: view.depthMax,
  }
  svgEl.value?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
}

function onPointerMove(event) {
  const loc = eventToSvg(event)
  if (!loc) return
  if (dragState) {
    const full = fullDomain.value
    const speedRange = dragState.speedMax - dragState.speedMin
    const depthRange = dragState.depthMax - dragState.depthMin
    const speedMin = clamp(
      dragState.speedMin - ((loc.x - dragState.x) / PLOT_WIDTH) * speedRange,
      full.speedMin,
      full.speedMax - speedRange,
    )
    const depthMin = clamp(
      dragState.depthMin - ((loc.y - dragState.y) / PLOT_HEIGHT) * depthRange,
      full.depthMin,
      full.depthMax - depthRange,
    )
    view.speedMin = speedMin
    view.speedMax = speedMin + speedRange
    view.depthMin = depthMin
    view.depthMax = depthMin + depthRange
    hoverPoint.value = null
    return
  }
  updateHover(loc)
}

function updateHover(loc) {
  if (!props.readoutEnabled || !points.value.length || !inPlot(loc)) {
    hoverPoint.value = null
    return
  }
  let best = null
  let bestDistance = Infinity
  for (const point of points.value) {
    const coord = pointCoord(point)
    const dx = coord.x - loc.x
    const dy = coord.y - loc.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = { point, coord }
    }
  }
  const threshold = 18
  if (!best || bestDistance > threshold * threshold) {
    hoverPoint.value = null
    return
  }
  const client = svgToClient(best.coord)
  const container = containerEl.value
  let tipLeft = 0
  let tipTop = 0
  if (client && container) {
    const rect = container.getBoundingClientRect()
    const width = container.clientWidth
    const height = container.clientHeight
    tipLeft = client.x - rect.left + 14
    if (tipLeft + 132 > width) tipLeft = client.x - rect.left - 14
    tipLeft = clamp(tipLeft, 4, Math.max(4, width - 132))
    tipTop = clamp(client.y - rect.top - 10, 4, Math.max(4, height - 92))
  }
  hoverPoint.value = {
    x: best.coord.x,
    y: best.coord.y,
    speed: best.point.speed,
    depth: best.point.depth,
    tipLeft,
    tipTop,
  }
}

function onPointerUp(event) {
  if (!dragState) return
  dragState = null
  svgEl.value?.releasePointerCapture?.(event.pointerId)
  const loc = eventToSvg(event)
  if (loc) updateHover(loc)
}

function onPointerCancel() {
  dragState = null
}

function onPointerLeave() {
  hoverPoint.value = null
}

function resetZoom() {
  Object.assign(view, fullDomain.value)
  hoverPoint.value = null
}
</script>
<style scoped>
.ssp-chart { position: relative; background: #041321; padding: 8px; }
.ssp-chart svg { width: 100%; display: block; max-height: 46vh; cursor: crosshair; touch-action: none; }
.ssp-chart.is-zoomed svg { cursor: grab; }
.ssp-chart.is-zoomed svg:active { cursor: grabbing; }
.ssp-chart text { fill: #9dc9dc; font: 9px monospace; }
.ssp-chart line { stroke: #1b3445; stroke-width: 1; }
.ssp-empty { min-height: 180px; display: grid; place-items: center; color: #85a6bb; font-size: 12px; }
.ssp-zoom-reset { position: absolute; top: 24px; right: 10px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; border: 1px solid rgba(0, 226, 207, 0.55); border-radius: 4px; background: rgba(4, 19, 33, 0.86); color: #7be9df; font: 9px ui-monospace, monospace; cursor: pointer; }
.ssp-zoom-reset:hover { border-color: #00e2cf; color: #d7fffb; }
.ssp-zoom-reset i { font-style: normal; font-size: 10px; }
.ssp-tooltip { position: absolute; z-index: 3; min-width: 108px; padding: 5px 7px; border: 1px solid rgba(0, 226, 207, 0.45); border-radius: 5px; background: rgba(2, 6, 23, 0.94); color: #d9fbff; font: 10px ui-monospace, monospace; line-height: 1.55; pointer-events: none; box-shadow: 0 6px 18px rgba(0, 12, 24, 0.55); }
.ssp-hint { position: absolute; left: 12px; bottom: 10px; color: #577a90; font: 8px ui-monospace, monospace; pointer-events: none; }
</style>
