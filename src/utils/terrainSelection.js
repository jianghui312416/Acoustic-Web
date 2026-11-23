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
 * 经度按圆周处理：取点集的最小覆盖弧，跨过 180° 时用东经大于 180°
 * 的展开形式表示（如 170°E → 190°E），供后续地形底图按经度环绕读取。
 * 极区选框会自然展开为接近整圈的经度范围。
 */
export function lonLatPointsToBounds(points) {
  const longitudes = []
  const latitudes = []
  let count = 0

  for (const point of Array.isArray(points) ? points : []) {
    const lon = Number(point?.lon)
    const lat = Number(point?.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    longitudes.push(((lon % 360) + 360) % 360)
    latitudes.push(lat)
    count += 1
  }

  if (!count) return null

  const south = Math.min(...latitudes)
  const north = Math.max(...latitudes)
  longitudes.sort((a, b) => a - b)

  let west = 0
  let width = 0
  const uniqueLongitudes = new Set(longitudes.map(value => value.toFixed(9)))
  if (uniqueLongitudes.size > 1) {
    let gapIndex = 0
    let maxGap = -1
    for (let index = 0; index < longitudes.length; index += 1) {
      const next = longitudes[(index + 1) % longitudes.length]
      const gap = (next - longitudes[index] + 360) % 360
      if (gap > maxGap) {
        maxGap = gap
        gapIndex = index
      }
    }
    const west360 = longitudes[(gapIndex + 1) % longitudes.length]
    west = west360 > 180 ? west360 - 360 : west360
    width = 360 - maxGap
  } else {
    const lon = longitudes[0] % 360
    west = lon > 180 ? lon - 360 : lon
  }
  if (!Number.isFinite(width) || width <= 0) width = 0
  if (north >= 89.5 || south <= -89.5) {
    west = -180
    width = 360
  } else if (width >= 360 - 1e-7) {
    west = -180
    width = 360
  }
  return normalizeTerrainBounds({ west, south, east: west + width, north })
}
