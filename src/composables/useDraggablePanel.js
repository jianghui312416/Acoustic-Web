import { computed, onBeforeUnmount, reactive, ref } from 'vue'

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

/**
 * 为浮动参数面板提供受边界约束的标题栏拖动。
 * 面板保持原有布局位置，仅通过 transform 移动，因此不会改变表单内部滚动。
 */
export function useDraggablePanel({ margin = 8 } = {}) {
  const panelRef = ref(null)
  const dragging = ref(false)
  const offset = reactive({ x: 0, y: 0 })
  let pointerId = null
  let startPoint = null
  let startOffset = null
  let panelBounds = null
  let boundaryBounds = null

  const dragStyle = computed(() => ({
    transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
  }))

  function stopDragging() {
    dragging.value = false
    pointerId = null
    startPoint = null
    startOffset = null
    panelBounds = null
    boundaryBounds = null
    window.removeEventListener('pointermove', movePanel)
    window.removeEventListener('pointerup', stopDragging)
    window.removeEventListener('pointercancel', stopDragging)
  }

  function movePanel(event) {
    if (!dragging.value || event.pointerId !== pointerId || !startPoint || !panelBounds || !boundaryBounds) return
    const deltaX = event.clientX - startPoint.x
    const deltaY = event.clientY - startPoint.y
    const minX = startOffset.x + boundaryBounds.left + margin - panelBounds.left
    const maxX = startOffset.x + boundaryBounds.right - margin - panelBounds.right
    const minY = startOffset.y + boundaryBounds.top + margin - panelBounds.top
    const maxY = startOffset.y + boundaryBounds.bottom - margin - panelBounds.bottom
    offset.x = clamp(startOffset.x + deltaX, Math.min(minX, maxX), Math.max(minX, maxX))
    offset.y = clamp(startOffset.y + deltaY, Math.min(minY, maxY), Math.max(minY, maxY))
  }

  function startDragging(event) {
    if (event.button !== 0 || event.target.closest('button, input, select, textarea, a, label')) return
    const panel = panelRef.value
    if (!panel) return
    const boundary = panel.offsetParent || panel.parentElement || document.documentElement
    pointerId = event.pointerId
    startPoint = { x: event.clientX, y: event.clientY }
    startOffset = { x: offset.x, y: offset.y }
    panelBounds = panel.getBoundingClientRect()
    boundaryBounds = boundary.getBoundingClientRect()
    dragging.value = true
    event.preventDefault()
    window.addEventListener('pointermove', movePanel)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
  }

  function resetPanelPosition() {
    stopDragging()
    offset.x = 0
    offset.y = 0
  }

  onBeforeUnmount(stopDragging)

  return {
    panelRef,
    dragging,
    dragStyle,
    startDragging,
    resetPanelPosition,
  }
}
