<template>
  <div
    v-show="active"
    ref="rootEl"
    class="globe-selector"
    aria-label="地形区域选框"
  >
    <div v-if="!zoomedIn" class="globe-selector-hint">
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
      v-if="showRect"
      class="globe-rect"
      :class="{ armed, dragging }"
      :style="rectStyle"
      title="拖动移动选框，拖拽角点缩放；点击后在下方点击“加载”"
      @pointerdown.stop.prevent="startMove"
      @wheel.prevent.stop="onWheel"
    >
      <span
        v-for="handle in handles"
        :key="handle.key"
        class="globe-handle"
        :class="`handle-${handle.key}`"
        :title="handle.label"
        :aria-label="handle.label"
        @pointerdown.stop.prevent="startResize(handle.key, $event)"
      ></span>
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

const props = defineProps({
  viewer: { type: Object, default: null },
  active: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  zoomHeight: { type: Number, default: GLOBE_SELECTION_ZOOM_HEIGHT },
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
const size = ref({ width: 0, height: 0 })
const zoomedIn = ref(false)
const armed = ref(false)
const dragging = ref(false)
const invalidHint = ref('')

let dragState = null
let resizeObserver = null
let disposed = false

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

/** 与初始全球视图一致：只有放大到阈值以内才出现红框。 */
const showRect = computed(() => !!(rect.value && zoomedIn.value))

function clampHeightOk(height) {
  return Number.isFinite(height) && height <= Number(props.zoomHeight || GLOBE_SELECTION_ZOOM_HEIGHT)
}

function updateZoomState() {
  if (!props.active || !props.viewer || disposed) return
  const height = Number(props.viewer.camera?.positionCartographic?.height)
  zoomedIn.value = clampHeightOk(height)
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

function onPostRender() {
  if (!props.active || disposed) return
  updateZoomState()
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
  const { bounds, reason } = collectBounds()
  if (!bounds) {
    invalidHint.value = reason === 'wrap'
      ? '选区跨过 180° 经线或位于极区，无法作为单个地形区域；请转动地球到目标海域后再选'
      : '未读到有效区域，请把红框移到地球表面'
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

/** 缩回全球后把红框放回视图中心，并直接显示「加载」。 */
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

.globe-rect.armed {
  border-color: #ff7d74;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 0 16px rgba(255, 90, 82, 0.22),
    inset 0 0 18px rgba(255, 90, 82, 0.2);
}

.globe-rect.dragging {
  cursor: grabbing;
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
