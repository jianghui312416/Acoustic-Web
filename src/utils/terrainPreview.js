/**
 * 地形预览的纯计算工具。
 *
 * 缩略图使用 Web Mercator 世界底图，只展示中低纬区域，矩形框的归一化坐标
 * 与经纬度之间通过下面的投影函数互相转换。地形格网、统计量和交互约束也都
 * 放在这里，便于在 Node 环境中直接测试。
 */

export const TERRAIN_WORLD_LIMITS = Object.freeze({
  west: -180,
  south: -85,
  east: 180,
  north: 85,
})

export const MIN_TERRAIN_SPAN_DEG = 0.5

const MAX_MERCATOR_LAT = 85.05112878

export const DEFAULT_THUMB_VIEW = Object.freeze({
  top: mercatorY(84),
  bottom: mercatorY(-84),
})

export const TERRAIN_HANDLES = Object.freeze([
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
])

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function mercatorY(latitude) {
  const lat = clamp(Number(latitude) || 0, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)
  const radians = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2
}

export function inverseMercatorY(y) {
  const value = clamp(Number(y) || 0, 0, 1)
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * value))) * 180) / Math.PI
}

function ensureSpan(center, min, max) {
  const span = Math.max(MIN_TERRAIN_SPAN_DEG, Math.min(max - min, MIN_TERRAIN_SPAN_DEG))
  const half = span / 2
  return {
    min: clamp(center - half, min, max - span),
    max: clamp(center + half, min + span, max),
  }
}

/** 把任意经度换算到 [-180, 180)。 */
export function normalizeLongitude(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return number
  return ((number + 180) % 360 + 360) % 360 - 180
}

export function normalizeTerrainBounds(bounds = {}) {
  const rawWest = Number(bounds.west)
  const rawEast = Number(bounds.east)
  const rawSouth = Number(bounds.south)
  const rawNorth = Number(bounds.north)
  const rawWidth = rawEast - rawWest
  const unwrapped = Number.isFinite(rawWidth) && rawWidth > 0 && rawWidth <= 360 && rawEast > 180

  let west
  let east
  if (unwrapped) {
    west = rawWest
    east = rawEast
    if (west > 180) {
      west -= 360
      east -= 360
    }
    if (west < -180) {
      west += 360
      east += 360
    }
    west = clamp(west, TERRAIN_WORLD_LIMITS.west, TERRAIN_WORLD_LIMITS.east)
    east = clamp(east, west + MIN_TERRAIN_SPAN_DEG, west + 360)
  } else {
    west = clamp(Math.min(rawWest, rawEast), TERRAIN_WORLD_LIMITS.west, TERRAIN_WORLD_LIMITS.east)
    east = clamp(Math.max(rawWest, rawEast), TERRAIN_WORLD_LIMITS.west, TERRAIN_WORLD_LIMITS.east)
  }
  let south = clamp(Math.min(rawSouth, rawNorth), TERRAIN_WORLD_LIMITS.south, TERRAIN_WORLD_LIMITS.north)
  let north = clamp(Math.max(rawSouth, rawNorth), TERRAIN_WORLD_LIMITS.south, TERRAIN_WORLD_LIMITS.north)

  if (!Number.isFinite(west) || !Number.isFinite(east)) {
    west = -20
    east = 20
  }
  if (!Number.isFinite(south) || !Number.isFinite(north)) {
    south = -10
    north = 10
  }

  if (east - west >= 360 - 1e-9) {
    west = TERRAIN_WORLD_LIMITS.west
    east = TERRAIN_WORLD_LIMITS.east
  } else if (east - west < MIN_TERRAIN_SPAN_DEG) {
    const eastLimit = unwrapped ? west + 360 : TERRAIN_WORLD_LIMITS.east
    west = clamp((west + east) / 2 - MIN_TERRAIN_SPAN_DEG / 2, TERRAIN_WORLD_LIMITS.west, eastLimit - MIN_TERRAIN_SPAN_DEG)
    east = west + MIN_TERRAIN_SPAN_DEG
  }
  if (north - south < MIN_TERRAIN_SPAN_DEG) {
    const range = ensureSpan((south + north) / 2, TERRAIN_WORLD_LIMITS.south, TERRAIN_WORLD_LIMITS.north)
    south = range.min
    north = range.max
  }

  return { west, south, east, north }
}

export function moveTerrainBounds(bounds, deltaLon, deltaLat) {
  const next = normalizeTerrainBounds(bounds)
  const width = next.east - next.west
  const height = next.north - next.south
  const unwrapped = next.east > TERRAIN_WORLD_LIMITS.east
  const eastLimit = unwrapped ? next.west + 360 : TERRAIN_WORLD_LIMITS.east
  const west = clamp(
    next.west + (Number(deltaLon) || 0),
    TERRAIN_WORLD_LIMITS.west,
    eastLimit - width
  )
  const south = clamp(
    next.south + (Number(deltaLat) || 0),
    TERRAIN_WORLD_LIMITS.south,
    TERRAIN_WORLD_LIMITS.north - height
  )
  return normalizeTerrainBounds({ west, south, east: west + width, north: south + height })
}

export function resizeTerrainBounds(bounds, handle, deltaLon, deltaLat) {
  const next = normalizeTerrainBounds(bounds)
  const dLon = Number(deltaLon) || 0
  const dLat = Number(deltaLat) || 0
  const key = String(handle || '').toLowerCase()
  const unwrapped = next.east > TERRAIN_WORLD_LIMITS.east
  const eastLimit = unwrapped ? next.west + 360 : TERRAIN_WORLD_LIMITS.east
  let { west, south, east, north } = next

  if (key.includes('w')) {
    west = clamp(west + dLon, TERRAIN_WORLD_LIMITS.west, east - MIN_TERRAIN_SPAN_DEG)
  }
  if (key.includes('e')) {
    east = clamp(east + dLon, west + MIN_TERRAIN_SPAN_DEG, eastLimit)
  }
  if (key.includes('n')) {
    north = clamp(north + dLat, south + MIN_TERRAIN_SPAN_DEG, TERRAIN_WORLD_LIMITS.north)
  }
  if (key.includes('s')) {
    south = clamp(south + dLat, TERRAIN_WORLD_LIMITS.south, north - MIN_TERRAIN_SPAN_DEG)
  }

  return normalizeTerrainBounds({ west, south, east, north })
}

export function createThumbView() {
  return {
    x0: 0,
    x1: 1,
    y0: DEFAULT_THUMB_VIEW.top,
    y1: DEFAULT_THUMB_VIEW.bottom,
  }
}

export function lonLatToWorldPoint(longitude, latitude) {
  return {
    x: clamp(((Number(longitude) || 0) + 180) / 360, 0, 1),
    y: mercatorY(latitude),
  }
}

export function worldPointToLonLat(x, y) {
  const nx = clamp(Number(x) || 0, 0, 1)
  const ny = clamp(Number(y) || 0, 0, 1)
  return {
    lon: nx * 360 - 180,
    lat: inverseMercatorY(ny),
  }
}

export function lonLatToViewPoint(longitude, latitude, view = createThumbView()) {
  const world = lonLatToWorldPoint(longitude, latitude)
  const width = Math.max(1e-9, view.x1 - view.x0)
  const height = Math.max(1e-9, view.y1 - view.y0)
  return {
    x: clamp((world.x - view.x0) / width, 0, 1),
    y: clamp((world.y - view.y0) / height, 0, 1),
  }
}

export function viewPointToLonLat(x, y, view = createThumbView()) {
  const width = view.x1 - view.x0
  const height = view.y1 - view.y0
  const worldX = view.x0 + clamp(Number(x) || 0, 0, 1) * width
  const worldY = view.y0 + clamp(Number(y) || 0, 0, 1) * height
  return worldPointToLonLat(worldX, worldY)
}

export function boundsToViewRect(bounds, view = createThumbView()) {
  const next = normalizeTerrainBounds(bounds)
  const topLeft = lonLatToViewPoint(next.west, next.north, view)
  const bottomRight = lonLatToViewPoint(next.east, next.south, view)
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
    width: Math.max(0, bottomRight.x - topLeft.x),
    height: Math.max(0, bottomRight.y - topLeft.y),
  }
}

export function zoomThumbView(view, anchorX, anchorY, factor, minSpan = 0.012) {
  const base = {
    x0: clamp(view.x0, 0, 1),
    x1: clamp(view.x1, 0, 1),
    y0: clamp(view.y0, DEFAULT_THUMB_VIEW.top, DEFAULT_THUMB_VIEW.bottom),
    y1: clamp(view.y1, DEFAULT_THUMB_VIEW.top, DEFAULT_THUMB_VIEW.bottom),
  }
  if (base.x1 <= base.x0) base.x1 = Math.min(1, base.x0 + minSpan)
  if (base.y1 <= base.y0) base.y1 = Math.min(DEFAULT_THUMB_VIEW.bottom, base.y0 + minSpan)

  const width = base.x1 - base.x0
  const height = base.y1 - base.y0
  const aspect = height / Math.max(1e-9, width)
  const ax = clamp(Number(anchorX) || 0, 0, 1)
  const ay = clamp(Number(anchorY) || 0, 0, 1)
  const ratio = clamp(Number(factor) || 1, 0.05, 20)
  let nextWidth = clamp(width * ratio, minSpan, 1)
  let nextHeight = nextWidth * aspect
  const maxHeight = DEFAULT_THUMB_VIEW.bottom - DEFAULT_THUMB_VIEW.top
  if (nextHeight > maxHeight) {
    nextHeight = maxHeight
    nextWidth = nextHeight / Math.max(1e-9, aspect)
  }

  const anchorWorldX = base.x0 + ax * width
  const anchorWorldY = base.y0 + ay * height
  let x0 = anchorWorldX - ax * nextWidth
  let y0 = anchorWorldY - ay * nextHeight
  x0 = clamp(x0, 0, 1 - nextWidth)
  y0 = clamp(y0, DEFAULT_THUMB_VIEW.top, DEFAULT_THUMB_VIEW.bottom - nextHeight)

  return {
    x0,
    x1: x0 + nextWidth,
    y0,
    y1: y0 + nextHeight,
  }
}

export function panThumbView(view, deltaX, deltaY) {
  const width = view.x1 - view.x0
  const height = view.y1 - view.y0
  const x0 = clamp(view.x0 - (Number(deltaX) || 0) * width, 0, 1 - width)
  const y0 = clamp(
    view.y0 - (Number(deltaY) || 0) * height,
    DEFAULT_THUMB_VIEW.top,
    DEFAULT_THUMB_VIEW.bottom - height
  )
  return { x0, x1: x0 + width, y0, y1: y0 + height }
}

export function lonLatToThumbPoint(longitude, latitude, view = DEFAULT_THUMB_VIEW) {
  const span = view.bottom - view.top
  return {
    x: clamp(((Number(longitude) || 0) + 180) / 360, 0, 1),
    y: clamp((mercatorY(latitude) - view.top) / span, 0, 1),
  }
}

export function thumbPointToLonLat(x, y, view = DEFAULT_THUMB_VIEW) {
  const nx = clamp(Number(x) || 0, 0, 1)
  const ny = clamp(Number(y) || 0, 0, 1)
  const mercator = view.top + ny * (view.bottom - view.top)
  return {
    lon: nx * 360 - 180,
    lat: inverseMercatorY(mercator),
  }
}

export function boundsToThumbRect(bounds, view = DEFAULT_THUMB_VIEW) {
  const next = normalizeTerrainBounds(bounds)
  const topLeft = lonLatToThumbPoint(next.west, next.north, view)
  const bottomRight = lonLatToThumbPoint(next.east, next.south, view)
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
    width: Math.max(0, bottomRight.x - topLeft.x),
    height: Math.max(0, bottomRight.y - topLeft.y),
  }
}

export function computeTerrainStats(values) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  for (const value of values ?? []) {
    const number = Number(value)
    if (!Number.isFinite(number)) continue
    if (number < min) min = number
    if (number > max) max = number
    sum += number
    count += 1
  }
  if (!count) return { min: 0, max: 0, mean: 0, range: 0, count: 0 }
  return {
    min,
    max,
    mean: sum / count,
    range: max - min,
    count,
  }
}

export function buildTerrainGrid(bounds, resolution, heightAt) {
  const size = Math.max(2, Math.round(Number(resolution) || 2))
  const next = normalizeTerrainBounds(bounds)
  const values = new Float32Array(size * size)
  let index = 0

  for (let row = 0; row < size; row += 1) {
    const v = row / (size - 1)
    const latitude = next.south + (next.north - next.south) * v
    for (let col = 0; col < size; col += 1) {
      const u = col / (size - 1)
      const longitude = next.west + (next.east - next.west) * u
      const raw = Number(heightAt(longitude, latitude, row, col, u, v))
      values[index] = Number.isFinite(raw) ? raw : 0
      index += 1
    }
  }

  return {
    width: size,
    height: size,
    values,
    bounds: next,
    ...computeTerrainStats(values),
  }
}

/**
 * 地形服务不可达时使用的确定性模拟高程，便于离线/内网环境下演示地形分布。
 * 同一区域每次生成的结果一致，并会通过界面上的“演示高程”标签明确说明来源。
 */
export function buildDemoTerrainGrid(bounds, resolution = 56) {
  const next = normalizeTerrainBounds(bounds)
  const seed = Math.abs(
    Math.round(next.west * 13.37 + next.north * 7.11 + next.east * 3.73 + next.south * 5.19)
  )
  const phase = ((seed % 360) * Math.PI) / 180

  return buildTerrainGrid(next, resolution, (lon, lat, row, col, u, v) => {
    const x = u * 2 - 1
    const y = v * 2 - 1
    const ridge = Math.sin(x * 3.6 + phase) * Math.cos(y * 2.9 - phase * 0.7)
    const detail =
      Math.sin((x + y) * 8.2 + phase) * 0.32 +
      Math.cos((x - y) * 11.4 - phase * 0.4) * 0.16 +
      Math.sin(x * 17.3 - y * 13.7) * 0.08
    const basin = -0.52 * Math.exp(-(x * x + y * y) * 1.7)
    const island = Math.max(0, 1500 - Math.hypot(x - 0.24, y + 0.18) * 2600)
    const depthTrend = (y + 1) * 220
    return clamp((ridge * 0.72 + detail + basin) * 2300 + island + depthTrend, -6200, 3200)
  })
}

export function formatTerrainBounds(bounds) {
  const next = normalizeTerrainBounds(bounds)
  const format = (value) => `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(2)}°`
  return `${format(next.west)} ~ ${format(next.east)}  ·  ${format(next.south)} ~ ${format(next.north)}`
}

/** 把经度格式化为带东西经的单值标签。 */
export function formatLongitudeValue(value, decimals = 2) {
  const threshold = 0.5 / 10 ** decimals
  const raw = Number(value)
  const absolute = Math.abs(raw)
  if (absolute < threshold) return '0°'
  if (Math.abs(absolute - 180) < threshold) return '180°'
  const number = normalizeLongitude(raw)
  const abs = Math.abs(number)
  if (abs < threshold) return '0°'
  if (Math.abs(abs - 180) < threshold) return '180°'
  return `${abs.toFixed(decimals)}°${number >= 0 ? 'E' : 'W'}`
}

/** 把纬度格式化为带南北纬的单值标签。 */
export function formatLatitudeValue(value, decimals = 2) {
  const threshold = 0.5 / 10 ** decimals
  const number = Number(value)
  const absolute = Math.abs(number)
  if (absolute < threshold) return '0°'
  return `${absolute.toFixed(decimals)}°${number >= 0 ? 'N' : 'S'}`
}

/** 选框四条边上的经纬度标签：上北、下南、左西、右东。 */
export function formatTerrainBoundsEdges(bounds) {
  const next = normalizeTerrainBounds(bounds)
  return {
    north: formatLatitudeValue(next.north),
    south: formatLatitudeValue(next.south),
    west: formatLongitudeValue(next.west),
    east: formatLongitudeValue(next.east),
  }
}

const EARTH_RADIUS_KM = 6371.0088

/** 两点间的大圆距离（km），用于把选框的经纬度跨度换算成实际尺寸。 */
export function greatCircleDistanceKm(lon1, lat1, lon2, lat2) {
  const toRad = Math.PI / 180
  const startLat = Number(lat1) * toRad
  const endLat = Number(lat2) * toRad
  const deltaLat = (Number(lat2) - Number(lat1)) * toRad
  const deltaLon = (Number(lon2) - Number(lon1)) * toRad
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))))
}

/** 选框的宽/高（km）：宽取中心纬度的东西向距离，高取中心经度的南北向距离。 */
export function terrainBoundsKm(bounds) {
  const next = normalizeTerrainBounds(bounds)
  const centerLat = (next.south + next.north) / 2
  const centerLon = (next.west + next.east) / 2
  return {
    widthKm: greatCircleDistanceKm(next.west, centerLat, next.east, centerLat),
    heightKm: greatCircleDistanceKm(centerLon, next.south, centerLon, next.north),
  }
}

/** 把 km 数值格式化为选框尺寸标签。 */
export function formatDistanceKm(km) {
  const value = Number(km)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value >= 100) return `${Math.round(value)} km`
  if (value >= 10) return `${value.toFixed(1)} km`
  return `${value.toFixed(2)} km`
}

/**
 * GEBCO 海底地形 WMS 请求地址。
 * WMS 1.3.0 + EPSG:4326 的 BBOX 顺序是 lat_min, lon_min, lat_max, lon_max。
 */
export function buildGebcoWmsUrl(bounds, options = {}) {
  const next = normalizeTerrainBounds(bounds)
  const baseUrl = String(options.baseUrl || 'https://wms.gebco.net/mapserv?')
  const version = options.version || '1.3.0'
  const layer = options.layer || 'gebco_latest'
  const width = Math.max(64, Math.round(Number(options.width) || 1200))
  const height = Math.max(64, Math.round(Number(options.height) || 900))
  const params = new URLSearchParams({
    request: 'getmap',
    service: 'wms',
    version,
    layers: layer,
    styles: '',
    format: options.format || 'image/jpeg',
    crs: 'EPSG:4326',
    width: String(width),
    height: String(height),
    BBOX: `${next.south},${next.west},${next.north},${next.east}`,
  })
  const separator = baseUrl.includes('?') ? (baseUrl.endsWith('?') || baseUrl.endsWith('&') ? '' : '&') : '?'
  return `${baseUrl}${separator}${params.toString()}`
}
