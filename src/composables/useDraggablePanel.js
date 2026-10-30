import { computed, onBeforeUnmount, reactive, ref } from 'vue'

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

/**
 * 为浮动参数面板提供受边界约束的标题栏拖动。
 * 面板保持原有布局位置，仅通过 transform 移动，因此不会改变表单内部滚动。
 *
 * @param {object} [options]
 * @param {number} [options.margin=8] 面板与容器边界、障碍物之间的最小间距。
 * @param {() => Array<{left:number,top:number,right:number,bottom:number}>} [options.avoid]
 *   返回视口坐标下的障碍物矩形；拖动时自动避让，使面板不与这些矩形重叠。
 */
export function useDraggablePanel({ margin = 8, avoid = null } = {}) {
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

  function resolveObstacles() {
    if (!avoid) return []
    try {
      const list = avoid()
      return Array.isArray(list) ? list.filter((item) => item && Number.isFinite(item.left)) : []
    } catch {
      return []
    }
  }

  function pushOutOfObstacles(rect, obstacles) {
    let pushedX = 0
    let pushedY = 0
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      for (const obs of obstacles) {
        const left = Math.max(rect.left + pushedX, obs.left - margin)
        const right = Math.min(rect.right + pushedX, obs.right + margin)
        const top = Math.max(rect.top + pushedY, obs.top - margin)
        const bottom = Math.min(rect.bottom + pushedY, obs.bottom + margin)
        const overlapX = right - left
        const overlapY = bottom - top
        if (overlapX <= 0 || overlapY <= 0) continue
        if (overlapX <= overlapY) {
          const pushLeft = (rect.right + pushedX) - (obs.left - margin)
          const pushRight = (obs.right + margin) - (rect.left + pushedX)
          if (pushLeft <= pushRight) pushedX -= overlapX
          else pushedX += overlapX
        } else {
          const pushTop = (rect.bottom + pushedY) - (obs.top - margin)
          const pushBottom = (obs.bottom + margin) - (rect.top + pushedY)
          if (pushTop <= pushBottom) pushedY -= overlapY
          else pushedY += overlapY
        }
        moved = true
      }
      if (!moved) break
    }
    return { x: pushedX, y: pushedY }
  }

  function movePanel(event) {
    if (!dragging.value || event.pointerId !== pointerId || !startPoint || !panelBounds || !boundaryBounds) return
    const deltaX = event.clientX - startPoint.x
    const deltaY = event.clientY - startPoint.y
    const minX = startOffset.x + boundaryBounds.left + margin - panelBounds.left
    const maxX = startOffset.x + boundaryBounds.right - margin - panelBounds.right
    const minY = startOffset.y + boundaryBounds.top + margin - panelBounds.top
    const maxY = startOffset.y + boundaryBounds.bottom - margin - panelBounds.bottom
    let nextX = clamp(startOffset.x + deltaX, Math.min(minX, maxX), Math.max(minX, maxX))
    let nextY = clamp(startOffset.y + deltaY, Math.min(minY, maxY), Math.max(minY, maxY))

    const obstacles = resolveObstacles()
    if (obstacles.length) {
      const untransformedLeft = panelBounds.left - startOffset.x
      const untransformedTop = panelBounds.top - startOffset.y
      const width = panelBounds.right - panelBounds.left
      const height = panelBounds.bottom - panelBounds.top
      const rect = {
        left: untransformedLeft + nextX,
        top: untransformedTop + nextY,
        right: untransformedLeft + width + nextX,
        bottom: untransformedTop + height + nextY,
      }
      const pushed = pushOutOfObstacles(rect, obstacles)
      nextX = clamp(nextX + pushed.x, Math.min(minX, maxX), Math.max(minX, maxX))
      nextY = clamp(nextY + pushed.y, Math.min(minY, maxY), Math.max(minY, maxY))
    }

    offset.x = nextX
    offset.y = nextY
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
