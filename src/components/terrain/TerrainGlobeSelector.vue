<template>
  <div
    v-show="active"
    ref="rootEl"
    class="globe-selector"
    aria-label="地形区域选框"
  >
    <div v-if="!zoomedIn && !returnActive" class="globe-selector-hint">
      <span class="globe-hint-mark" aria-hidden="true"></span>
      <span>放大地图，框选局部地形区域</span>
    </div>

    <div v-else-if="returnActive" class="globe-selector-hint globe-return-hint">
      <span class="globe-hint-mark" aria-hidden="true"></span>
      <span>点击红框或「加载」返回刚才的地形 · 转动地球可重新框选</span>
    </div>

    <div v-else-if="!armed" class="globe-selector-hint">
      <span class="globe-hint-mark" aria-hidden="true"></span>
      <span>拖动红框移动 · 拖拽角点缩放 · 点击红框加载</span>
    </div>

    <div
      v-if="showRegionRect"
      class="globe-region-frame"
      :style="regionStyle"
      aria-hidden="true"
    ></div>

    <div
      v-if="showRect"
      class="globe-rect"
      :class="{ armed, dragging }"
      :style="rectStyle"
      title="拖动移动选框，拖拽角点缩放；点击后在下方点击“加载”"
      @pointerdown.stop.prevent="startMove"
      @wheel.prevent.stop="onWheel"
    >
      <span
        v-for="handle in visibleHandles"
        :key="handle.key"
        class="globe-handle"
        :class="`handle-${handle.key}`"
        :title="handle.label"
        :aria-label="handle.label"
        @pointerdown.stop.prevent="startResize(handle.key, $event)"
      ></span>
      <span v-if="coordLabels" class="globe-coord globe-coord-n">{{ coordLabels.north }}</span>
      <span v-if="coordLabels" class="globe-coord globe-coord-s">{{ coordLabels.south }}</span>
      <span v-if="coordLabels" class="globe-coord globe-coord-w">{{ coordLabels.west }}</span>
      <span v-if="coordLabels" class="globe-coord globe-coord-e">{{ coordLabels.east }}</span>
      <span v-if="sizeLabels" class="globe-size globe-size-w">{{ sizeLabels.width }}</span>
      <span v-if="sizeLabels" class="globe-size globe-size-h">{{ sizeLabels.height }}</span>
    </div>

    <button
      v-if="showRect && armed"
      type="button"
      class="globe-load"
      :style="loadStyle"
      :disabled="loading"
      @pointerdown.stop
      @click.stop="onLoad"
    >
      <span class="globe-load-mark" aria-hidden="true"></span>
      <span>{{ loading ? '加载中…' : '加载' }}</span>
    </button>

    <div v-if="showRect && armed && invalidHint" class="globe-invalid" :style="invalidStyle">
      {{ invalidHint }}
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Cesium } from '@/utils/cesium.js'
import {
  GLOBE_SELECTION_MARGIN_PX,
  GLOBE_SELECTION_ZOOM_HEIGHT,
  createGlobeSelectionRect,
  fitGlobeSelectionRect,
  lonLatPointsToBounds,
  moveGlobeSelectionRect,
  resizeGlobeSelectionRect,
} from '@/utils/terrainSelection.js'
import {
  formatDistanceKm,
  formatTerrainBoundsEdges,
  terrainBoundsKm,
} from '@/utils/terrainPreview.js'

const props = defineProps({
  viewer: { type: Object, default: null },
  active: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  zoomHeight: { type: Number, default: GLOBE_SELECTION_ZOOM_HEIGHT },
  /** 当前选区经纬度；全球视图中的红框会跟随该区域的位置与大小。 */
  selectionBounds: { type: Object, default: null },
  /** 缩回全球后，红框用来返回刚才的地形。 */
  returnActive: { type: Boolean, default: false },
})

const emit = defineEmits(['load', 'return', 'select'])

const handles = Object.freeze([
  { key: 'nw', label: '左上角缩放' },
  { key: 'n', label: '上边缩放' },
  { key: 'ne', label: '右上角缩放' },
  { key: 'e', label: '右边缩放' },
  { key: 'se', label: '右下角缩放' },
  { key: 's', label: '下边缩放' },
  { key: 'sw', label: '左下角缩放' },
  { key: 'w', label: '左边缩放' },
])

const rootEl = ref(null)
const rect = ref(null)
/** 仅用于全球视图展示“当前区域”的只读框，不参与拖动/缩放/加载。 */
const regionRect = ref(null)
const size = ref({ width: 0, height: 0 })
const zoomedIn = ref(false)
const armed = ref(false)
const dragging = ref(false)
const invalidHint = ref('')
/** 红框当前覆盖区域的经纬度边界，用于实时显示宽高尺寸。 */
const liveBounds = ref(null)

let dragState = null
let resizeObserver = null
let disposed = false
let lastSizeLabelAt = 0

const rectStyle = computed(() => {
  const value = rect.value
  if (!value) return { display: 'none' }
  return {
    left: `${value.left}px`,
    top: `${value.top}px`,
    width: `${value.width}px`,
    height: `${value.height}px`,
  }
})

const regionStyle = computed(() => {
  const value = regionRect.value
  if (!value) return { display: 'none' }
  return {
    left: `${value.left}px`,
    top: `${value.top}px`,
    width: `${value.width}px`,
    height: `${value.height}px`,
  }
})

const loadStyle = computed(() => {
  const value = rect.value
  const { width, height } = size.value
  if (!value || !width || !height) return { display: 'none' }
  const left = Math.min(width - 44, Math.max(44, value.left + value.width / 2))
  let top = value.top + value.height + 10
  if (top + 30 > height - 8) top = Math.max(8, value.top - 36)
  return { left: `${left}px`, top: `${top}px` }
})

const invalidStyle = computed(() => {
  const style = loadStyle.value
  const { width, height } = size.value
  if (!width || !height || !style.left) return { display: 'none' }
  const top = Math.min(height - 28, parseFloat(style.top) + 32)
  return { left: style.left, top: `${top}px` }
})

const sizeLabels = computed(() => {
  if (!liveBounds.value) return null
  const { widthKm, heightKm } = terrainBoundsKm(liveBounds.value)
  return {
    width: formatDistanceKm(widthKm),
    height: formatDistanceKm(heightKm),
  }
})

const coordLabels = computed(() => (
  liveBounds.value ? formatTerrainBoundsEdges(liveBounds.value) : null
))

/** 交互选框只在放大到阈值以内或返回地形时显示。 */
const showRect = computed(() => !!(rect.value && (zoomedIn.value || props.returnActive)))
/** 全球视图下显示当前已加载区域的只读框。 */
const showRegionRect = computed(() => !!(
  regionRect.value && !zoomedIn.value && !props.returnActive
))
/** 区域很小时不显示 8 个缩放手柄，避免手柄互相重叠。 */
const showHandles = computed(() => {
  const value = rect.value
  if (!value || !zoomedIn.value) return false
  return value.width >= 56 && value.height >= 44
})
const visibleHandles = computed(() => showHandles.value ? handles : [])

function clampHeightOk(height) {
  return Number.isFinite(height) && height <= Number(props.zoomHeight || GLOBE_SELECTION_ZOOM_HEIGHT)
}

function updateZoomState() {
  if (!props.active || !props.viewer || disposed) return
  const height = Number(props.viewer.camera?.positionCartographic?.height)
  zoomedIn.value = clampHeightOk(height)
}

/** 把选区经纬度四角投影到屏幕，得到红框的位置和大小。 */
function projectBoundsRect(bounds) {
  const viewer = props.viewer
  const root = rootEl.value
  const canvas = viewer?.canvas
  const scene = viewer?.scene
  const transforms = Cesium?.SceneTransforms
  if (
    !bounds ||
    !viewer ||
    !root ||
    !canvas ||
    !scene ||
    typeof transforms?.wgs84ToWindowCoordinates !== 'function'
  ) return null

  const rootBox = root.getBoundingClientRect()
  const canvasBox = canvas.getBoundingClientRect()
  if (!(rootBox.width > 0 && rootBox.height > 0)) return null
  const offsetX = canvasBox.left - rootBox.left
  const offsetY = canvasBox.top - rootBox.top
  const corners = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
  ]
  const points = []
  for (const [lon, lat] of corners) {
    if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) continue
    const cartesian = Cesium.Cartesian3.fromDegrees(Number(lon), Number(lat), 0)
    let window = null
    try {
      window = transforms.wgs84ToWindowCoordinates(scene, cartesian)
    } catch {
      continue
    }
    if (!window || !Number.isFinite(window.x) || !Number.isFinite(window.y)) continue
    points.push({ x: window.x + offsetX, y: window.y + offsetY })
  }
  if (points.length < 2) return null

  const margin = GLOBE_SELECTION_MARGIN_PX
  const maxWidth = Math.max(8, size.value.width - margin * 2)
  const maxHeight = Math.max(8, size.value.height - margin * 2)
  let left = Math.min(...points.map(point => point.x))
  let right = Math.max(...points.map(point => point.x))
  let top = Math.min(...points.map(point => point.y))
  let bottom = Math.max(...points.map(point => point.y))
  left = Math.max(margin, Math.min(left, margin + maxWidth - 8))
  top = Math.max(margin, Math.min(top, margin + maxHeight - 8))
  right = Math.min(margin + maxWidth, Math.max(right, left + 8))
  bottom = Math.min(margin + maxHeight, Math.max(bottom, top + 8))
  return {
    left,
    top,
    width: Math.max(8, right - left),
    height: Math.max(8, bottom - top),
  }
}

/** 全球视图的只读区域框跟随当前加载区域。 */
function syncRegionRect() {
  if (!props.selectionBounds) {
    regionRect.value = null
    return false
  }
  if (!(size.value.width > 0 && size.value.height > 0)) return false
  const next = projectBoundsRect(props.selectionBounds)
  if (!next) return false
  const current = regionRect.value
  const changed = !current
    || Math.abs(current.left - next.left) > 0.5
    || Math.abs(current.top - next.top) > 0.5
    || Math.abs(current.width - next.width) > 0.5
    || Math.abs(current.height - next.height) > 0.5
  if (changed) regionRect.value = next
  return true
}

function measure() {
  const element = rootEl.value
  if (!element) return
  const box = element.getBoundingClientRect()
  const width = Math.round(box.width)
  const height = Math.round(box.height)
  if (width <= 0 || height <= 0) return

  const previous = size.value
  size.value = { width, height }
  syncRegionRect()

  if (!rect.value) {
    rect.value = createGlobeSelectionRect(width, height)
    return
  }
  if (!previous.width || !previous.height || (previous.width === width && previous.height === height)) return

  // 窗口尺寸变化时让选框跟随容器等比缩放，仍保持完整可见。
  rect.value = fitGlobeSelectionRect(
    {
      left: (rect.value.left / previous.width) * width,
      top: (rect.value.top / previous.height) * height,
      width: (rect.value.width / previous.width) * width,
      height: (rect.value.height / previous.height) * height,
    },
    width,
    height
  )
}

/** 实时估算红框覆盖区域的宽高尺寸（km），帧间节流避免拖动时反复采样。 */
function refreshSize(force = false) {
  if (!props.active || disposed) {
    liveBounds.value = null
    return
  }
  if (!(zoomedIn.value || props.returnActive) || !rect.value) {
    liveBounds.value = null
    return
  }
  const now = Date.now()
  if (!force && now - lastSizeLabelAt < 100) return
  lastSizeLabelAt = now
  const { bounds } = collectBounds()
  liveBounds.value = bounds
}

function onPostRender() {
  if (!props.active || disposed) return
  updateZoomState()
  syncRegionRect()
  refreshSize()
  if (zoomedIn.value && !rect.value) measure()
}

function bindViewer(viewer) {
  viewer?.scene?.postRender?.addEventListener?.(onPostRender)
}

function unbindViewer(viewer) {
  viewer?.scene?.postRender?.removeEventListener?.(onPostRender)
}

function pointerIdMatches(event) {
  return !dragState || event?.pointerId === dragState.pointerId
}

function clearDragListeners() {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
}

function beginDrag(nextState) {
  clearDragListeners()
  dragState = nextState
  dragging.value = true
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
}

function arm() {
  armed.value = true
  invalidHint.value = ''
}

function startMove(event) {
  if (event.button !== 0 || !rect.value) return
  arm()
  beginDrag({
    type: 'move',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...rect.value },
    moved: false,
    notified: false,
  })
}

function startResize(handle, event) {
  if (event.button !== 0 || !rect.value) return
  if (props.returnActive) emit('select')
  arm()
  beginDrag({
    type: 'resize',
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startRect: { ...rect.value },
  })
}

function onWindowPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  const { width, height } = size.value
  if (!width || !height) return
  const dx = event.clientX - dragState.startX
  const dy = event.clientY - dragState.startY
  if (dragState.type === 'move') {
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      dragState.moved = true
      if (props.returnActive && !dragState.notified) {
        dragState.notified = true
        emit('select')
      }
    }
    rect.value = moveGlobeSelectionRect(
      dragState.startRect,
      dx,
      dy,
      width,
      height,
      GLOBE_SELECTION_MARGIN_PX
    )
    refreshSize()
    return
  }
  rect.value = resizeGlobeSelectionRect(
    dragState.startRect,
    dragState.handle,
    dx,
    dy,
    width,
    height,
    GLOBE_SELECTION_MARGIN_PX
  )
  refreshSize()
}

function onWindowPointerUp(event) {
  if (!pointerIdMatches(event)) return
  const state = dragState
  endDrag()
  // 缩回全球后，未拖动红框的单击直接返回刚才的地形。
  if (state?.type === 'move' && !state.moved && props.returnActive) emit('return')
}

function endDrag() {
  clearDragListeners()
  dragState = null
  dragging.value = false
  refreshSize(true)
}

function onWheel(event) {
  if (!props.active) return
  const viewer = props.viewer
  const canvas = viewer?.canvas
  if (!canvas) return

  // 选框覆盖地图中央，滚轮落在选框上时把事件转交给 Cesium 画布，
  // 继续使用数字地球自己的缩放/碰撞处理；否则用户把指针放在红框里就无法缩放地图。
  const forward = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  })
  canvas.dispatchEvent(forward)
  viewer.scene?.requestRender?.()
}

/** 从选框覆盖的地球表面采样 5×5 个点，求外包经纬度。 */
function collectBounds() {
  const viewer = props.viewer
  const camera = viewer?.camera
  const canvas = viewer?.canvas
  const value = rect.value
  const root = rootEl.value
  if (!camera || !canvas || !value || !root) return { bounds: null, reason: 'surface' }

  const rootBox = root.getBoundingClientRect()
  const canvasBox = canvas.getBoundingClientRect()
  if (!rootBox.width || !rootBox.height) return { bounds: null, reason: 'surface' }
  const offsetX = canvasBox.left - rootBox.left
  const offsetY = canvasBox.top - rootBox.top
  const ellipsoid = viewer.scene?.globe?.ellipsoid || Cesium.Ellipsoid?.WGS84
  const scratch = new Cesium.Cartesian2()
  const samples = 4
  const points = []

  for (let row = 0; row <= samples; row += 1) {
    for (let col = 0; col <= samples; col += 1) {
      scratch.x = value.left + (value.width * col) / samples + offsetX
      scratch.y = value.top + (value.height * row) / samples + offsetY
      const cartesian = camera.pickEllipsoid(scratch, ellipsoid)
      if (!cartesian) continue
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      if (!cartographic) continue
      points.push({
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        lat: Cesium.Math.toDegrees(cartographic.latitude),
      })
    }
  }

  if (!points.length) return { bounds: null, reason: 'surface' }
  const bounds = lonLatPointsToBounds(points)
  return bounds ? { bounds, reason: '' } : { bounds: null, reason: 'wrap' }
}

function onLoad() {
  if (props.loading) return
  if (props.returnActive) {
    emit('return')
    return
  }
  if (!zoomedIn.value) {
    invalidHint.value = '请先放大地图，再加载新的地形区域'
    return
  }
  const { bounds } = collectBounds()
  if (!bounds) {
    invalidHint.value = '未读到有效区域，请把红框移到地球表面'
    return
  }
  invalidHint.value = ''
  armed.value = false
  emit('load', bounds)
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    armed.value = false
    invalidHint.value = ''
    endDrag()
  }
}

/** 缩回全球后让红框跟随刚才的区域，并直接显示「加载」。 */
async function prepareReturnBox() {
  await nextTick()
  measure()
  if (!size.value.width || !size.value.height) return
  rect.value = createGlobeSelectionRect(size.value.width, size.value.height)
  armed.value = true
  invalidHint.value = ''
}

watch(() => props.returnActive, (active) => {
  if (active) prepareReturnBox()
})

watch(() => props.selectionBounds, () => syncRegionRect(), { deep: true })

watch(
  () => props.viewer,
  (viewer, previous) => {
    unbindViewer(previous)
    bindViewer(viewer)
    updateZoomState()
  }
)

watch(
  () => props.active,
  async (active) => {
    if (!active) {
      armed.value = false
      invalidHint.value = ''
      endDrag()
      return
    }
    await nextTick()
    measure()
    if (props.returnActive) {
      rect.value = createGlobeSelectionRect(size.value.width, size.value.height)
      armed.value = true
      invalidHint.value = ''
    }
    updateZoomState()
    props.viewer?.scene?.requestRender?.()
  }
)

onMounted(() => {
  measure()
  bindViewer(props.viewer)
  updateZoomState()
  window.addEventListener('keydown', onKeyDown)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measure())
    if (rootEl.value) resizeObserver.observe(rootEl.value)
  }
})

onBeforeUnmount(() => {
  disposed = true
  endDrag()
  unbindViewer(props.viewer)
  window.removeEventListener('keydown', onKeyDown)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.globe-selector {
  position: absolute;
  inset: 0;
  z-index: 3;
  overflow: hidden;
  pointer-events: none;
  user-select: none;
}

.globe-selector-hint {
  position: absolute;
  top: 12px;
  left: 16px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 24px;
  padding: 0 9px;
  color: #a7c9dc;
  font: 10px 'Microsoft YaHei', sans-serif;
  letter-spacing: 0.4px;
  border: 1px solid rgba(72, 158, 194, 0.34);
  border-radius: 4px;
  background: rgba(6, 22, 38, 0.7);
  pointer-events: none;
}

.globe-return-hint {
  color: #ffd9d4;
  border-color: rgba(255, 112, 102, 0.5);
  background: rgba(38, 14, 16, 0.78);
}

.globe-hint-mark {
  width: 8px;
  height: 8px;
  flex: none;
  border: 1.5px solid #ff5a52;
  background: rgba(255, 90, 82, 0.16);
}

.globe-rect {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px solid #ff5a52;
  background: rgba(255, 90, 82, 0.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 0 18px rgba(255, 90, 82, 0.14);
  cursor: move;
  pointer-events: auto;
  touch-action: none;
}

/* 全球视图中的只读区域框：只显示位置和大小，不响应鼠标。 */
.globe-region-frame {
  position: absolute;
  box-sizing: border-box;
  border: 1.5px dashed rgba(255, 90, 82, 0.9);
  background: rgba(255, 90, 82, 0.06);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 0 16px rgba(255, 90, 82, 0.12);
  pointer-events: none;
}

.globe-rect.armed {
  border-color: #ff7d74;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 16px rgba(255, 90, 82, 0.22),
    inset 0 0 18px rgba(255, 90, 82, 0.2);
}

.globe-rect.dragging {
  cursor: grabbing;
}

.globe-size {
  position: absolute;
  z-index: 1;
  padding: 1px 4px;
  color: #ffe0dd;
  font: 9px ui-monospace, monospace;
  line-height: 1.4;
  white-space: nowrap;
  border-radius: 3px;
  background: rgba(64, 10, 10, 0.72);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.globe-size-w {
  right: 8px;
  top: 100%;
  transform: translateY(6px);
}

.globe-size-h {
  left: 100%;
  top: calc(50% - 18px);
  transform: translate(6px, -50%);
}

.globe-coord {
  position: absolute;
  z-index: 1;
  padding: 1px 4px;
  color: #cfe9ff;
  font: 9px ui-monospace, monospace;
  line-height: 1.4;
  white-space: nowrap;
  border-radius: 3px;
  background: rgba(8, 30, 52, 0.72);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.globe-coord-n {
  left: 50%;
  bottom: 100%;
  transform: translate(-50%, -6px);
}

.globe-coord-s {
  left: 8px;
  top: 100%;
  transform: translateY(6px);
}

.globe-coord-w {
  right: 100%;
  top: 50%;
  transform: translate(-6px, -50%);
}

.globe-coord-e {
  left: 100%;
  top: 50%;
  transform: translate(6px, -50%);
}

.globe-handle {
  position: absolute;
  width: 9px;
  height: 9px;
  box-sizing: border-box;
  border: 1px solid rgba(255, 90, 82, 0.85);
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.45);
  pointer-events: auto;
}

.handle-nw {
  top: 0;
  left: 0;
  transform: translate(-50%, -50%);
  cursor: nwse-resize;
}

.handle-n {
  top: 0;
  left: 50%;
  transform: translate(-50%, -50%);
  cursor: ns-resize;
}

.handle-ne {
  top: 0;
  right: 0;
  transform: translate(50%, -50%);
  cursor: nesw-resize;
}

.handle-e {
  top: 50%;
  right: 0;
  transform: translate(50%, -50%);
  cursor: ew-resize;
}

.handle-se {
  right: 0;
  bottom: 0;
  transform: translate(50%, 50%);
  cursor: nwse-resize;
}

.handle-s {
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 50%);
  cursor: ns-resize;
}

.handle-sw {
  bottom: 0;
  left: 0;
  transform: translate(-50%, 50%);
  cursor: nesw-resize;
}

.handle-w {
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
}

.globe-load {
  position: absolute;
  z-index: 2;
  height: 26px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #e8fcff;
  font: 650 11px 'Microsoft YaHei', sans-serif;
  letter-spacing: 1px;
  border: 1px solid rgba(80, 211, 242, 0.68);
  border-radius: 4px;
  background: rgba(7, 66, 88, 0.92);
  box-shadow: 0 6px 18px rgba(0, 8, 18, 0.45);
  transform: translateX(-50%);
  pointer-events: auto;
  cursor: pointer;
}

.globe-load:hover:not(:disabled) {
  border-color: rgba(119, 235, 255, 0.95);
  background: rgba(10, 100, 126, 0.96);
}

.globe-load:disabled {
  cursor: wait;
  opacity: 0.75;
}

.globe-load-mark {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: #8bf1ff;
  box-shadow: 0 0 7px rgba(139, 241, 255, 0.85);
}

.globe-invalid {
  position: absolute;
  z-index: 2;
  padding: 4px 8px;
  color: #f1c38c;
  font: 10px 'Microsoft YaHei', sans-serif;
  white-space: nowrap;
  border: 1px solid rgba(241, 195, 140, 0.45);
  border-radius: 4px;
  background: rgba(20, 18, 10, 0.9);
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
