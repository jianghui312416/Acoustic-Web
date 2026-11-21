<template>
  <aside class="terrain-dock" :class="{ collapsed }" aria-label="地形缩略图">
    <button class="thumb-collapse" type="button" :title="collapsed ? '展开地图缩略图' : '隐藏地图缩略图'" :aria-label="collapsed ? '展开地图缩略图' : '隐藏地图缩略图'" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? '›' : '‹' }}</button>
    <div
      v-show="!collapsed"
      ref="mapEl"
      class="thumb-map"
      @pointerdown="onMapPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
    >
      <canvas ref="mapCanvas" class="thumb-canvas" aria-hidden="true"></canvas>
      <div class="thumb-shade" aria-hidden="true"></div>
      <span
        v-for="(tick, i) in graticuleTicks.lonTicks"
        :key="`lon-${i}`"
        class="thumb-grid-label thumb-grid-lon"
        :style="tick.style"
      >{{ tick.label }}</span>
      <span
        v-for="(tick, i) in graticuleTicks.latTicks"
        :key="`lat-${i}`"
        class="thumb-grid-label thumb-grid-lat"
        :style="tick.style"
      >{{ tick.label }}</span>

      <button
        type="button"
        class="thumb-locate"
        title="定位到当前数字地球视角"
        @pointerdown.stop
        @click="$emit('locate')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          <path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>

      <div class="thumb-rect" :style="rectStyle" @pointerdown.stop.prevent="onRectPointerDown">
        <span class="thumb-resize" @pointerdown.stop.prevent="onResizePointerDown"></span>
      </div>

      <button
        v-if="armed"
        type="button"
        class="thumb-load"
        :style="loadButtonStyle"
        :disabled="loading"
        @pointerdown.stop
        @click.stop="onLoad"
      >
        <span v-if="loading" class="thumb-spinner" aria-hidden="true"></span>
        <span>{{ loading ? '加载中…' : '加载' }}</span>
      </button>

      <span v-if="!thumbnailReady" class="thumb-loading">缩略图加载中…</span>
    </div>
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  boundsToViewRect,
  createThumbView,
  mercatorY,
  moveTerrainBounds,
  panThumbView,
  resizeTerrainBounds,
  lonLatToWorldPoint,
  viewPointToLonLat,
  zoomThumbView,
} from '@/utils/terrainPreview.js'
import { inverseMercatorY } from '@/utils/terrainPreview.js'
import { loadBathymetry } from '@/utils/bathymetry.js'
import { bathymetryColor } from '@/utils/terrainScene.js'
import { aisMonitorState } from '@/modules/ais/aisMonitorStore.js'
import { bathymetrySourceState } from '@/modules/terrain/bathymetrySource.js'
import { baseMapUrlTemplate, buildTileUrl } from '@/config/baseMap.js'

const props = defineProps({
  bounds: { type: Object, required: true },
  loading: { type: Boolean, default: false },
})
const collapsed = defineModel('collapsed', { type: Boolean, default: false })

const emit = defineEmits(['update:bounds', 'load', 'locate'])

const mapEl = ref(null)
const mapCanvas = ref(null)
const worldCanvas = shallowRef(null)
const thumbnailReady = ref(false)
const armed = ref(false)
const thumbView = ref(createThumbView())
let dragState = null
let disposed = false
let bathyTimer = 0
let bathyToken = 0
let bathyImage = null
let bathyViewKey = ''
const viewKey = () => Object.values(thumbView.value).map(v => v.toFixed(7)).join(',')

function scheduleBathyMap() {
  clearTimeout(bathyTimer)
  const request = ++bathyToken
  bathyTimer = setTimeout(async () => {
    const view = { ...thumbView.value }
    const key = viewKey()
    try {
      const grid = await loadBathymetry({ west: view.x0 * 360 - 180, east: view.x1 * 360 - 180,
        north: inverseMercatorY(view.y0), south: inverseMercatorY(view.y1) }, 160,
      { source: bathymetrySourceState.source })
      if (disposed || request !== bathyToken) return
      const image = document.createElement('canvas'); image.width = image.height = 160
      const ctx = image.getContext('2d')
      const data = ctx.createImageData(160, 160)
      for (let row = 0; row < 160; row++) {
        const lat = inverseMercatorY(view.y0 + row / 159 * (view.y1 - view.y0))
        const gridRow = Math.max(0, Math.min(grid.height - 1, Math.round((grid.bounds.north - lat) / (grid.bounds.north - grid.bounds.south) * (grid.height - 1))))
        for (let col = 0; col < 160; col++) {
          const gridCol = Math.max(0, Math.min(grid.width - 1, Math.round(col / 159 * (grid.width - 1))))
          const value = grid.values[gridRow * grid.width + gridCol]
          const slope = value - grid.values[gridRow * grid.width + Math.min(grid.width - 1, gridCol + 1)]
          const shade = Math.max(.55, Math.min(1.4, .9 + slope / 200))
          const rgb = bathymetryColor(value, grid.min, grid.max).map(c => Math.min(255, c * shade))
          data.data.set([...rgb,255], (row * 160 + col) * 4)
        }
      }
      ctx.putImageData(data,0,0); bathyImage = image; bathyViewKey = key
      renderMap(); thumbnailReady.value = true
    } catch { /* Keep the available basemap if the elevation service is offline. */ }
  }, 250)
}

// Start with the selected region in view, leaving room to move the red bounds.
watch(() => props.bounds, (bounds) => {
  if (dragState) return
  const cx = ((bounds.west + bounds.east) / 2 + 180) / 360
  const cy = mercatorY((bounds.north + bounds.south) / 2)
  const w = Math.min(1, Math.max(.002, (bounds.east - bounds.west) / 360 * 5))
  const h = Math.min(1, Math.max(.001, Math.abs(mercatorY(bounds.north) - mercatorY(bounds.south)) * 3))
  const x0 = Math.max(0, Math.min(1 - w, cx - w / 2))
  const y0 = Math.max(0, Math.min(1 - h, cy - h / 2))
  thumbView.value = { x0, x1: x0 + w, y0, y1: y0 + h }
  renderMap()
  scheduleBathyMap()
}, { immediate: true })

watch(() => bathymetrySourceState.source, () => {
  bathyImage = null
  bathyViewKey = ''
  scheduleBathyMap()
})

const rectStyle = computed(() => {
  const rect = boundsToViewRect(props.bounds, thumbView.value)
  return {
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  }
})

const loadButtonStyle = computed(() => {
  const rect = boundsToViewRect(props.bounds, thumbView.value)
  const left = Math.min(0.9, Math.max(0.1, rect.left + rect.width / 2))
  const top = Math.min(0.82, Math.max(0.02, rect.top + rect.height + 0.015))
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
  }
})

function tickLabel(value, decimals, isLon) {
  const absolute = Math.abs(value)
  const threshold = 0.5 / Math.pow(10, decimals)
  if (absolute < threshold) return '0°'
  if (isLon && Math.abs(absolute - 180) < threshold) return '180°'
  return `${absolute.toFixed(decimals)}°${isLon ? (value >= 0 ? 'E' : 'W') : (value >= 0 ? 'N' : 'S')}`
}

const graticuleTicks = computed(() => {
  const view = thumbView.value
  const west = view.x0 * 360 - 180
  const east = view.x1 * 360 - 180
  const north = inverseMercatorY(view.y0)
  const south = inverseMercatorY(view.y1)
  const lonSpan = east - west
  const latSpan = north - south
  const lonDecimals = lonSpan >= 10 ? 0 : lonSpan >= 1 ? 1 : 2
  const latDecimals = latSpan >= 10 ? 0 : latSpan >= 1 ? 1 : 2

  const lonTicks = []
  for (let i = 0; i < 5; i += 1) {
    const f = i / 4
    const lon = west + lonSpan * f
    const transform = i === 0 ? 'translateX(4px)' : i === 4 ? 'translateX(calc(-100% - 4px))' : 'translateX(-50%)'
    lonTicks.push({ style: { left: `${f * 100}%`, transform }, label: tickLabel(lon, lonDecimals, true) })
  }

  const latTicks = []
  for (let i = 0; i < 4; i += 1) {
    const f = i / 3
    const lat = inverseMercatorY(view.y0 + (view.y1 - view.y0) * f)
    // 左下角的经度标签占据底边，南端纬度标签上移避开，避免两者重合。
    const transform = i === 0 ? 'translateY(4px)' : i === 3 ? 'translateY(calc(-100% - 16px))' : 'translateY(-50%)'
    latTicks.push({ style: { top: `${f * 100}%`, transform }, label: tickLabel(lat, latDecimals, false) })
  }

  return { lonTicks, latTicks }
})

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function pointerPoint(event) {
  const rect = mapEl.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
  return {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  }
}

function capturePointer(event) {
  try {
    mapEl.value?.setPointerCapture?.(event.pointerId)
  } catch {}
}

function onMapPointerDown(event) {
  if (event.button !== 0) return
  capturePointer(event)
  dragState = {
    type: 'pan',
    pointerId: event.pointerId,
    start: pointerPoint(event),
    startView: { ...thumbView.value },
  }
}

function onRectPointerDown(event) {
  if (event.button !== 0) return
  armed.value = true
  capturePointer(event)
  dragState = {
    type: 'move',
    pointerId: event.pointerId,
    start: pointerPoint(event),
    startBounds: { ...props.bounds },
  }
}

function onResizePointerDown(event) {
  if (event.button !== 0) return
  armed.value = true
  capturePointer(event)
  dragState = {
    type: 'resize',
    handle: 'se',
    pointerId: event.pointerId,
    start: pointerPoint(event),
    startBounds: { ...props.bounds },
  }
}

function onPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  const current = pointerPoint(event)

  if (dragState.type === 'pan') {
    thumbView.value = panThumbView(
      dragState.startView,
      current.x - dragState.start.x,
      current.y - dragState.start.y
    )
    renderMap()
    scheduleBathyMap()
    return
  }

  const startLonLat = viewPointToLonLat(dragState.start.x, dragState.start.y, thumbView.value)
  const currentLonLat = viewPointToLonLat(current.x, current.y, thumbView.value)
  const deltaLon = currentLonLat.lon - startLonLat.lon
  const deltaLat = currentLonLat.lat - startLonLat.lat
  const next =
    dragState.type === 'move'
      ? moveTerrainBounds(dragState.startBounds, deltaLon, deltaLat)
      : resizeTerrainBounds(dragState.startBounds, dragState.handle, deltaLon, deltaLat)

  emit('update:bounds', next)
}

function onPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  dragState = null
  try {
    mapEl.value?.releasePointerCapture?.(event.pointerId)
  } catch {}
}

function onWheel(event) {
  if (!thumbnailReady.value) return
  const point = pointerPoint(event)
  const factor = Math.exp(Math.min(300, Math.max(-300, Number(event.deltaY) || 0)) * 0.0015)
  thumbView.value = zoomThumbView(thumbView.value, point.x, point.y, factor)
  renderMap()
  scheduleBathyMap()
}

function onLoad() {
  armed.value = true
  emit('load', { ...props.bounds })
}

onMounted(() => {
  buildWorldThumbnail()
})

async function buildWorldThumbnail() {
  const zoom = 2
  const tileCount = 1 << zoom
  const tileSize = 256
  const worldSize = tileCount * tileSize
  const offscreen = document.createElement('canvas')
  offscreen.width = worldSize
  offscreen.height = worldSize
  const offCtx = offscreen.getContext('2d')
  if (!offCtx) return

  drawFallbackMap(offCtx, worldSize, worldSize)
  worldCanvas.value = offscreen
  renderMap()

  const tiles = []
  for (let x = 0; x < tileCount; x += 1) {
    for (let y = 0; y < tileCount; y += 1) {
      tiles.push({ x, y })
    }
  }

  const loaded = await Promise.all(
    tiles.map(({ x, y }) =>
      loadImage(buildTileUrl(baseMapUrlTemplate(), zoom, x, y))
        .then((image) => ({ image, x, y }))
        .catch(() => null)
    )
  )
  if (disposed) return

  let loadedCount = 0
  for (const entry of loaded) {
    if (!entry?.image) continue
    offCtx.drawImage(entry.image, entry.x * tileSize, entry.y * tileSize, tileSize, tileSize)
    loadedCount += 1
  }

  if (!loadedCount) drawFallbackMap(offCtx, worldSize, worldSize)
  worldCanvas.value = offscreen
  renderMap()
  thumbnailReady.value = true
}

function renderMap() {
  const canvas = mapCanvas.value
  const world = worldCanvas.value
  if (!canvas || !world) return

  const width = 1024
  const height = 512
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const view = thumbView.value
  const worldWidth = world.width
  const worldHeight = world.height
  const sourceX = view.x0 * worldWidth
  const sourceY = view.y0 * worldHeight
  const sourceWidth = (view.x1 - view.x0) * worldWidth
  const sourceHeight = (view.y1 - view.y0) * worldHeight

  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(world, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
  if (bathyImage && bathyViewKey === viewKey()) ctx.drawImage(bathyImage, 0, 0, width, height)
  ctx.fillStyle = 'rgba(7, 38, 72, 0.28)'
  ctx.fillRect(0, 0, width, height)
  drawGraticule(ctx, width, height, view)
  drawAisPresence(ctx, width, height, view)
}

function drawAisPresence(ctx, width, height, view) {
  if (!aisMonitorState.displayEnabled) return
  const viewWidth = Math.max(1e-9, view.x1 - view.x0)
  const viewHeight = Math.max(1e-9, view.y1 - view.y0)
  const occupied = new Set()
  const dots = []
  let selectedDot = null
  const maxDots = 4000

  for (const vessel of aisMonitorState.vessels) {
    const world = lonLatToWorldPoint(vessel.longitude, vessel.latitude)
    if (world.x < view.x0 || world.x > view.x1 || world.y < view.y0 || world.y > view.y1) continue
    const x = (world.x - view.x0) / viewWidth * width
    const y = (world.y - view.y0) / viewHeight * height
    if (vessel.mmsi === aisMonitorState.selectedMmsi) {
      selectedDot = { x, y }
      continue
    }
    if (dots.length >= maxDots) continue
    const key = `${Math.round(x / 3)}:${Math.round(y / 3)}`
    if (occupied.has(key)) continue
    occupied.add(key)
    dots.push({ x, y })
  }

  ctx.save()
  ctx.beginPath()
  for (const dot of dots) {
    ctx.moveTo(dot.x + 1.6, dot.y)
    ctx.arc(dot.x, dot.y, 1.6, 0, Math.PI * 2)
  }
  ctx.fillStyle = '#f4fbff'
  ctx.shadowColor = '#75dcff'
  ctx.shadowBlur = 2
  ctx.globalAlpha = 0.86
  ctx.fill()
  if (selectedDot) {
    ctx.beginPath()
    ctx.arc(selectedDot.x, selectedDot.y, 3.6, 0, Math.PI * 2)
    ctx.fillStyle = '#ffd04c'
    ctx.shadowColor = '#ffbd32'
    ctx.shadowBlur = 8
    ctx.globalAlpha = 1
    ctx.fill()
  }
  ctx.restore()
}

function drawGraticule(ctx, width, height, view) {
  ctx.save()
  ctx.strokeStyle = 'rgba(105, 196, 230, 0.18)'
  ctx.lineWidth = 1
  for (let i = 0; i < 5; i += 1) {
    const x = (i / 4) * width
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let i = 0; i < 4; i += 1) {
    const y = (i / 3) * height
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawFallbackMap(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, '#0b3153')
  gradient.addColorStop(0.55, '#0a2b4a')
  gradient.addColorStop(1, '#071a2c')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = 'rgba(58, 108, 132, 0.28)'
  ctx.beginPath()
  ctx.ellipse(width * 0.2, height * 0.34, width * 0.12, height * 0.18, -0.2, 0, Math.PI * 2)
  ctx.ellipse(width * 0.52, height * 0.32, width * 0.16, height * 0.14, 0.12, 0, Math.PI * 2)
  ctx.ellipse(width * 0.78, height * 0.44, width * 0.1, height * 0.16, -0.16, 0, Math.PI * 2)
  ctx.fill()
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`无法加载 ${src}`))
    image.src = src
  })
}

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(bathyTimer)
  bathyToken++
})

watch(() => aisMonitorState.vessels, renderMap)
watch(() => aisMonitorState.selectedMmsi, renderMap)
watch(() => aisMonitorState.displayEnabled, renderMap)
</script>

<style scoped>
.terrain-dock {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 4;
  width: min(650px, 51%);
  overflow: visible;
  border: 1px solid rgba(63, 153, 190, 0.48);
  border-radius: 8px;
  background: #06192a;
  box-shadow: 0 16px 40px rgba(0, 6, 16, 0.48);
}

.thumb-map {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 1;
  overflow: hidden;
  background: #06192a;
  cursor: grab;
  touch-action: none;
  user-select: none;
  border-radius: 8px;
}

.terrain-dock { bottom: 38px; left: 12px; }
.terrain-dock.collapsed { width: 0; border: 0; }
.thumb-collapse { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); width: 20px; height: 46px; padding: 0; background: #10293fe8; color: #b4e6ff; border: 1px solid #4b7a96; border-radius: 0 6px 6px 0; cursor: pointer; font-size: 20px; }
.terrain-dock.collapsed .thumb-collapse { top: -100px; }

.thumb-map:active {
  cursor: grabbing;
}

.thumb-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  filter: saturate(0.72) brightness(0.74) hue-rotate(6deg);
}

.thumb-shade {
  position: absolute;
  inset: 0;
  z-index: 1;
  background:
    radial-gradient(90% 80% at 50% 40%, rgba(20, 92, 143, 0.08), rgba(2, 12, 24, 0.46)),
    linear-gradient(180deg, rgba(5, 24, 42, 0.16), rgba(3, 14, 26, 0.32));
  pointer-events: none;
}

.thumb-grid-label {
  position: absolute;
  z-index: 2;
  color: rgba(205, 235, 250, 0.9);
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.3px;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0, 10, 20, 0.9);
}

.thumb-grid-lon { bottom: 4px; }
.thumb-grid-lat { left: 6px; }

.thumb-locate {
  position: absolute;
  top: 7px;
  right: 7px;
  z-index: 6;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  color: #a9eaff;
  border: 1px solid rgba(92, 198, 228, 0.45);
  border-radius: 5px;
  background: rgba(4, 30, 46, 0.72);
  cursor: pointer;
}

.thumb-locate:hover {
  color: #ffffff;
  border-color: rgba(98, 224, 255, 0.85);
  background: rgba(10, 67, 90, 0.86);
}

.thumb-locate svg {
  width: 15px;
  height: 15px;
}

.thumb-rect {
  position: absolute;
  z-index: 3;
  border: 1.5px solid #ff5a52;
  background: rgba(255, 90, 82, 0.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 0 18px rgba(255, 90, 82, 0.14);
  cursor: move;
}

.thumb-resize {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 13px;
  height: 13px;
  border: 1px solid rgba(255, 90, 82, 0.7);
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.45);
  cursor: nwse-resize;
}

.thumb-load {
  position: absolute;
  z-index: 7;
  height: 26px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #e8fcff;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 1px;
  border: 1px solid rgba(80, 211, 242, 0.68);
  border-radius: 4px;
  background: rgba(7, 66, 88, 0.92);
  box-shadow: 0 6px 18px rgba(0, 8, 18, 0.45);
  transform: translateX(-50%);
  cursor: pointer;
}

.thumb-load:hover:not(:disabled) {
  border-color: rgba(119, 235, 255, 0.95);
  background: rgba(10, 100, 126, 0.96);
}

.thumb-load:disabled {
  cursor: wait;
  opacity: 0.75;
}

.thumb-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(191, 244, 255, 0.25);
  border-top-color: #9beeff;
  border-radius: 50%;
  animation: thumb-spin 0.75s linear infinite;
}

.thumb-loading {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  color: #8db5c7;
  font-size: 11px;
  background: rgba(3, 15, 26, 0.62);
  pointer-events: none;
}

@keyframes thumb-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .terrain-dock {
    width: min(360px, 48%);
  }
  .terrain-dock.collapsed { width: 0; }
}
</style>
