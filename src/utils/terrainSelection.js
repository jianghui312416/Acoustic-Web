/**
 * 全球视图地形选框（屏幕坐标）的纯计算工具。
 *
 * 选框以屏幕像素为基准：拖动只平移、不改变大小；缩放只改变被拖拽的边 / 角。
 * 这样在倾斜的全球视角下也不会出现“拖动时选框越拖越大”的透视误差。
 * 点击「加载」时才把选框覆盖的地球表面采样点换算成经纬度边界。
 */

import { normalizeTerrainBounds } from './terrainPreview.js'

/** 相机高度低于该值（米）时显示区域选框，对应“全球视图放大之后”。 */
export const GLOBE_SELECTION_ZOOM_HEIGHT = 4_000_000
/** 选框与容器边缘保持的最小像素间距。 */
export const GLOBE_SELECTION_MARGIN_PX = 8

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function sizeLimits(width, height) {
  return {
    minWidth: Math.min(120, Math.max(60, width * 0.14)),
    minHeight: Math.min(90, Math.max(50, height * 0.12)),
  }
}

/** 初始选框：位于视图中央，只占约 15% × 20%，与缩略图的小选框比例一致。 */
export function createGlobeSelectionRect(width, height) {
  const safeWidth = Math.max(0, Number(width) || 0)
  const safeHeight = Math.max(0, Number(height) || 0)
  const w = clamp(safeWidth * 0.15, 120, Math.max(120, safeWidth - GLOBE_SELECTION_MARGIN_PX * 2))
  const h = clamp(safeHeight * 0.2, 90, Math.max(90, safeHeight - GLOBE_SELECTION_MARGIN_PX * 2))
  return {
    left: (safeWidth - w) / 2,
    top: (safeHeight - h) / 2,
    width: w,
    height: h,
  }
}

/** 把选框约束在容器内，并保证最小尺寸；用于窗口尺寸变化后的收拢。 */
export function fitGlobeSelectionRect(rect, width, height, margin = GLOBE_SELECTION_MARGIN_PX) {
  const safeWidth = Math.max(0, Number(width) || 0)
  const safeHeight = Math.max(0, Number(height) || 0)
  const { minWidth, minHeight } = sizeLimits(safeWidth, safeHeight)
  const maxWidth = Math.max(minWidth, safeWidth - margin * 2)
  const maxHeight = Math.max(minHeight, safeHeight - margin * 2)
  const w = clamp(Number(rect?.width) || minWidth, minWidth, maxWidth)
  const h = clamp(Number(rect?.height) || minHeight, minHeight, maxHeight)
  return {
    left: clamp(Number(rect?.left) || 0, margin, Math.max(margin, safeWidth - margin - w)),
    top: clamp(Number(rect?.top) || 0, margin, Math.max(margin, safeHeight - margin - h)),
    width: w,
    height: h,
  }
}

/** 平移选框：尺寸保持不变，只在容器内移动。 */
export function moveGlobeSelectionRect(rect, dx, dy, width, height, margin = GLOBE_SELECTION_MARGIN_PX) {
  return fitGlobeSelectionRect(
    { ...rect, left: rect.left + (Number(dx) || 0), top: rect.top + (Number(dy) || 0) },
    width,
    height,
    margin
  )
}

/** 拖拽角点 / 边手柄缩放选框：只改动被拖拽的方向。 */
export function resizeGlobeSelectionRect(
  rect,
  handle,
  dx,
  dy,
  width,
  height,
  margin = GLOBE_SELECTION_MARGIN_PX
) {
  const key = String(handle || '').toLowerCase()
  const safeWidth = Math.max(0, Number(width) || 0)
  const safeHeight = Math.max(0, Number(height) || 0)
  const { minWidth, minHeight } = sizeLimits(safeWidth, safeHeight)

  let west = rect.left
  let east = rect.left + rect.width
  let north = rect.top
  let south = rect.top + rect.height

  if (key.includes('w')) west = clamp(west + (Number(dx) || 0), margin, east - minWidth)
  if (key.includes('e')) east = clamp(east + (Number(dx) || 0), west + minWidth, safeWidth - margin)
  if (key.includes('n')) north = clamp(north + (Number(dy) || 0), margin, south - minHeight)
  if (key.includes('s')) south = clamp(south + (Number(dy) || 0), north + minHeight, safeHeight - margin)

  return {
    left: west,
    top: north,
    width: Math.max(minWidth, east - west),
    height: Math.max(minHeight, south - north),
  }
}

/**
 * 由选框采样到的经纬度点求外包经纬度。
 * 选框跨过 180° 经线时无法用单一矩形表达，返回 null（界面提示用户移开）。
 */
export function lonLatPointsToBounds(points) {
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  let count = 0

  for (const point of Array.isArray(points) ? points : []) {
    const lon = Number(point?.lon)
    const lat = Number(point?.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
    count += 1
  }

  if (!count) return null
  if (east - west > 180) return null
  return normalizeTerrainBounds({ west, south, east, north })
}
