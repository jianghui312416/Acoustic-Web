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
      <g v-if="bottomMaskY != null" class="ssp-bottom-mask">
        <title v-if="readoutEnabled">{{ bottomTypeText }}</title>
        <rect :x="PLOT_LEFT" :y="bottomMaskY" :width="PLOT_WIDTH" :height="bottomMaskHeight"
          :fill="sourceBottomType.color" fill-opacity="0.96" stroke="rgba(3,7,10,0.42)" stroke-width="0.7" />
        <line :x1="PLOT_LEFT" :x2="PLOT_RIGHT" :y1="bottomMaskY" :y2="bottomMaskY"
          stroke="rgba(241,245,249,0.9)" stroke-width="1.1" />
        <text :x="PLOT_RIGHT - 4" :y="bottomMaskY - 4" text-anchor="end" class="ssp-seabed-line-label">海底 {{ seabedDepthLabel }} m</text>
      </g>
      <g :clip-path="`url(#${clipId})`">
        <polyline :points="polyline" fill="none" stroke="#00e2cf" stroke-width="2" />
      </g>
      <circle v-if="hoverPoint" :cx="hoverPoint.x" :cy="hoverPoint.y" r="4"
        fill="#f8fafc" stroke="#00e2cf" stroke-width="2" />
      <text v-if="hasCoords" x="280" y="333" text-anchor="end">位置 {{ coordText }}</text>
    </svg>
    <div v-if="sourceBottomTypeInfo" class="ssp-bottom-type-overlay" :style="bottomTypeOverlayStyle">
      <span class="ssp-bottom-type-swatch" :style="{ background: sourceBottomTypeInfo.color }"></span>
      <div class="ssp-bottom-type-copy">
        <b>{{ sourceBottomTypeInfo.label }}</b>
        <span v-for="(line, index) in sourceBottomTypeInfo.lines" :key="index">{{ line }}</span>
      </div>
    </div>
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
  </div>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { formatCoordinate, formatCoordPair } from '@/utils/coordinateFormat.js'
import {
  DEFAULT_BOTTOM_ACOUSTICS,
  DEFAULT_BOTTOM_LABEL,
  bottomTypeAcousticProperties,
  bottomTypeColor,
  bottomTypeLabel,
} from '@/utils/bottomTypeModel.js'

const props = defineProps({
  profile: { type: Object, default: null },
  readoutEnabled: { type: Boolean, default: false },
  sourceLon: { type: Number, default: NaN },
  sourceLat: { type: Number, default: NaN },
  seabedDepth: { type: Number, default: NaN },
  coordinateFormat: { type: String, default: 'DD' },
  bottomTypeSegments: { type: Array, default: () => [] },
  bottomTypeState: { type: String, default: 'idle' },
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

const allPoints = computed(() => (props.profile?.depth || [])
  .map((depth, i) => ({ depth, speed: props.profile.speed[i] }))
  .filter((p) => Number.isFinite(p.depth) && Number.isFinite(p.speed) && p.speed > 0)
  .sort((a, b) => a.depth - b.depth))

const rawSeabedDepth = computed(() => {
  const value = Number(props.seabedDepth)
  if (Number.isFinite(value) && value > 0) return value
  const list = allPoints.value
  return list.length ? Math.max(...list.map((point) => point.depth)) : NaN
})

const points = computed(() => {
  const list = allPoints.value
  const seabed = Number(rawSeabedDepth.value)
  if (!list.length || !Number.isFinite(seabed) || seabed <= 0) return list
  if (list[list.length - 1].depth <= seabed + 1e-9) return list
  const above = list.filter((point) => point.depth <= seabed)
  const below = list.find((point) => point.depth > seabed)
  if (!above.length) return []
  if (!below) return above
  const last = above[above.length - 1]
  const ratio = (seabed - last.depth) / (below.depth - last.depth)
  return [
    ...above,
    { depth: seabed, speed: last.speed + (below.speed - last.speed) * ratio },
  ]
})

const fullDomain = computed(() => {
  const list = points.value
  if (!list.length) return { speedMin: 0, speedMax: 10, depthMin: 0, depthMax: 1 }
  const minSpeed = Math.floor(Math.min(...list.map((p) => p.speed)) / 10) * 10
  const maxSpeed = Math.max(minSpeed + 10, Math.ceil(Math.max(...list.map((p) => p.speed)) / 10) * 10)
  const profileMaxDepth = Math.max(1, ...list.map((p) => p.depth))
  const seabedDepth = Number(rawSeabedDepth.value)
  const maxDepth = Number.isFinite(seabedDepth) && seabedDepth > 0
    ? Math.max(profileMaxDepth, seabedDepth / 0.8)
    : profileMaxDepth
  return { speedMin: minSpeed, speedMax: maxSpeed, depthMin: 0, depthMax: maxDepth }
})

const view = reactive({ ...fullDomain.value })

watch([points, rawSeabedDepth], () => {
  Object.assign(view, fullDomain.value)
  hoverPoint.value = null
}, { immediate: true })

watch(() => props.readoutEnabled, (enabled) => {
  if (!enabled) hoverPoint.value = null
})

const speedSpan = computed(() => Math.max(1e-9, view.speedMax - view.speedMin))
const depthSpan = computed(() => Math.max(1e-9, view.depthMax - view.depthMin))
const bottomMaskY = computed(() => {
  const depth = Number(rawSeabedDepth.value)
  if (!Number.isFinite(depth) || depth <= 0) return null
  const y = PLOT_TOP + ((depth - view.depthMin) / depthSpan.value) * PLOT_HEIGHT
  return Math.min(PLOT_BOTTOM, Math.max(PLOT_TOP, y))
})
const bottomMaskHeight = computed(() => (
  bottomMaskY.value == null ? 0 : Math.max(0, PLOT_BOTTOM - bottomMaskY.value)
))
const seabedDepthLabel = computed(() => (
  Number.isFinite(Number(rawSeabedDepth.value)) ? Math.round(Number(rawSeabedDepth.value)) : 0
))
const bottomTypeOverlayStyle = computed(() => {
  const y = bottomMaskY.value
  if (y == null) return {}
  const centerY = (y + PLOT_BOTTOM) / 2
  const top = Math.min(PLOT_BOTTOM - 36, Math.max(PLOT_TOP + 4, centerY - 15))
  return { top: `${(top / 350) * 100}%` }
})

const hasCoords = computed(() => Number.isFinite(Number(props.sourceLon)) && Number.isFinite(Number(props.sourceLat)))
const latText = computed(() => formatCoordinate(props.sourceLat, props.coordinateFormat, true))
const lonText = computed(() => formatCoordinate(props.sourceLon, props.coordinateFormat, false))
const coordText = computed(() => formatCoordPair(props.sourceLat, props.sourceLon, props.coordinateFormat))

const sourceBottomType = computed(() => {
  const segments = Array.isArray(props.bottomTypeSegments) ? props.bottomTypeSegments : []
  const first = segments.find((segment) => Number(segment?.startM) <= 0.001) || segments[0] || null
  const id = Number(first?.id)
  const isDefault = !first || !(id > 0)
  const properties = isDefault
    ? {
        ...DEFAULT_BOTTOM_ACOUSTICS,
        ...Object.fromEntries(
          Object.entries(bottomTypeAcousticProperties(first)).filter(([, value]) => value != null)
        ),
      }
    : bottomTypeAcousticProperties(first)
  return {
    label: isDefault ? DEFAULT_BOTTOM_LABEL : (first?.label || bottomTypeLabel(id)),
    color: bottomTypeColor(first?.id ?? 0),
    properties,
    isDefault,
  }
})

const bottomTypeText = computed(() => {
  if (props.bottomTypeState === 'loading') return '正在读取底质…'
  if (props.bottomTypeState === 'error') return '底质接口失败 · 使用默认底质'
  const properties = sourceBottomType.value.properties || {}
  const cp = Number(properties.cp)
  const alpha = Number(properties.alphaP)
  const density = Number(properties.density)
  const cpText = Number.isFinite(cp) ? `${Math.round(cp)} m/s` : '—'
  const alphaText = Number.isFinite(alpha) ? `${alpha.toFixed(3)} dB/λ` : '—'
  const densityText = Number.isFinite(density) ? `${Math.round(density)} kg/m³` : '—'
  return `Cp ${cpText} · αp ${alphaText} · ρ ${densityText}`
})

function fmtBottomValue(value, digits = 2) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number(number.toFixed(digits)).toString()
}

const sourceBottomTypeInfo = computed(() => {
  const base = sourceBottomType.value
  if (props.bottomTypeState === 'loading') {
    return { label: base.label, color: base.color, lines: ['正在读取底质…'] }
  }
  if (props.bottomTypeState === 'error') {
    return { label: base.label, color: base.color, lines: ['底质接口失败 · 使用默认底质'] }
  }
  const properties = base.properties || {}
  const porosity = Number(properties.porosity)
  const porosityPct = Number.isFinite(porosity)
    ? (Math.abs(porosity) <= 1.5 ? porosity * 100 : porosity)
    : null
  return {
    label: base.label,
    color: base.color,
    lines: [
      `Cp=${fmtBottomValue(properties.cp, 0)} m/s · αp=${fmtBottomValue(properties.alphaP, 3)} dB/λ`,
      `ρ=${fmtBottomValue(properties.density, 1)} kg/m³ · 孔隙率=${fmtBottomValue(porosityPct, 1)}% · 厚度=${fmtBottomValue(properties.thickness, 1)} m`,
    ],
  }
})

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
.ssp-bottom-type-overlay {
  position: absolute;
  left: 54%;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  background: rgba(2, 6, 23, 0.8);
  color: #f8fafc;
  font: 8px ui-monospace, SFMono-Regular, Consolas, monospace;
  pointer-events: none;
  transform: translateX(-50%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
.ssp-bottom-type-swatch {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 1px;
  border-radius: 2px;
}
.ssp-bottom-type-copy {
  display: grid;
  gap: 1px;
}
.ssp-bottom-type-copy b {
  color: #ffffff;
  font-size: 9px;
}
.ssp-bottom-type-copy span {
  color: #e2f1f8;
  white-space: nowrap;
}
.ssp-chart .ssp-seabed-line-label { fill: #ffffff; font: 600 8px ui-monospace, monospace; paint-order: stroke; stroke: rgba(0, 0, 0, 0.65); stroke-width: 2px; }
</style>
