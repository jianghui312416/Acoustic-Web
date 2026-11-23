import { terrainMetersPerPixel } from './terrainScene.js'

const MAX_LABELS = 140
const LABEL_GAP_PX = 40
const DEPTH_CELL_PX = 14
const DEPTH_SAMPLE_CAP = 24000

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function alignLonToBounds(lon, bounds) {
  const value = Number(lon)
  const west = Number(bounds?.west)
  const east = Number(bounds?.east)
  if (!Number.isFinite(value) || !Number.isFinite(west) || !Number.isFinite(east)) return value
  if (!(east > 180 || west > 180)) return value
  const center = (west + east) / 2
  let aligned = value
  while (aligned - center > 180) aligned -= 360
  while (center - aligned > 180) aligned += 360
  return aligned
}

export function sampleTerrainElevation(grid, lon, lat) {
  const bounds = grid?.bounds
  const values = grid?.values
  const width = Number(grid?.width)
  const height = Number(grid?.height)
  if (!bounds || !values || !(width > 1) || !(height > 1)) return null
  if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north) return null
  const lonSpan = Math.max(1e-9, bounds.east - bounds.west)
  const latSpan = Math.max(1e-9, bounds.north - bounds.south)
  const fx = ((lon - bounds.west) / lonSpan) * (width - 1)
  const fy = ((bounds.north - lat) / latSpan) * (height - 1)
  const x0 = clamp(Math.floor(fx), 0, width - 1)
  const y0 = clamp(Math.floor(fy), 0, height - 1)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const corners = [
    [values[y0 * width + x0], (1 - tx) * (1 - ty)],
    [values[y0 * width + x1], tx * (1 - ty)],
    [values[y1 * width + x0], (1 - tx) * ty],
    [values[y1 * width + x1], tx * ty],
  ]
  let sum = 0
  let weight = 0
  for (const [value, cornerWeight] of corners) {
    if (!Number.isFinite(value) || cornerWeight <= 0) continue
    sum += value * cornerWeight
    weight += cornerWeight
  }
  return weight > 0 ? sum / weight : null
}

function buildDepthBuffer(scene, width, height) {
  const points = scene?.points
  if (!Array.isArray(points) || !points.length) return null
  const cols = Math.ceil(width / DEPTH_CELL_PX) + 1
  const rows = Math.ceil(height / DEPTH_CELL_PX) + 1
  const depth = new Float32Array(cols * rows)
  depth.fill(-Number.MAX_VALUE)
  const stride = Math.max(1, Math.floor(points.length / DEPTH_SAMPLE_CAP))
  let minOrder = Number.MAX_VALUE
  let maxOrder = -Number.MAX_VALUE
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index]
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.order)) continue
    const col = Math.floor(point.x / DEPTH_CELL_PX)
    const row = Math.floor(point.y / DEPTH_CELL_PX)
    if (col < 0 || row < 0 || col >= cols || row >= rows) continue
    const cell = row * cols + col
    if (point.order > depth[cell]) depth[cell] = point.order
    if (point.order < minOrder) minOrder = point.order
    if (point.order > maxOrder) maxOrder = point.order
  }
  if (!(maxOrder > minOrder)) return null
  return { cols, rows, depth, tolerance: Math.max(0.02, (maxOrder - minOrder) * 0.015) }
}

function maxOrderNear(buffer, x, y) {
  if (!buffer) return -Number.MAX_VALUE
  const col = Math.floor(x / DEPTH_CELL_PX)
  const row = Math.floor(y / DEPTH_CELL_PX)
  if (col < 0 || row < 0 || col >= buffer.cols || row >= buffer.rows) return -Number.MAX_VALUE
  return buffer.depth[row * buffer.cols + col]
}

function overlapsPlaced(placed, x, y) {
  for (const point of placed) {
    const dx = point.x - x
    const dy = point.y - y
    if (dx * dx + dy * dy < LABEL_GAP_PX * LABEL_GAP_PX) return true
  }
  return false
}

export function buildSeafloorLabels({
  features,
  grid,
  scene,
  camera,
  canvasSize,
  categories,
  density = 1,
  occlusion = true,
  selectedId = '',
}) {
  const width = Number(canvasSize?.width)
  const height = Number(canvasSize?.height)
  const bounds = grid?.bounds
  if (!Array.isArray(features) || !features.length) return []
  if (!bounds || typeof scene?.project !== 'function' || !(width > 0) || !(height > 0)) return []

  const safeDensity = clamp(Number(density) || 1, 0.4, 2.5)
  const metersPerPixel = terrainMetersPerPixel(bounds, { width, height }, camera || {})
  const minExtentM = Number.isFinite(metersPerPixel) && metersPerPixel > 0
    ? Math.max(120, metersPerPixel * 16 / safeDensity)
    : 0
  const depthBuffer = occlusion ? buildDepthBuffer(scene, width, height) : null
  const project = scene.project
  const placed = []
  const labels = []

  const selected = selectedId
    ? features.find(feature => feature.id === selectedId)
    : null
  const ordered = selected
    ? [selected, ...features.filter(feature => feature !== selected)]
    : features

  for (const feature of ordered) {
    const isSelected = feature.id === selectedId
    if (!isSelected) {
      if (categories && categories[feature.category] === false) continue
      if (Number(feature.extent_m) < minExtentM) continue
    }
    const lon = alignLonToBounds(feature.longitude, bounds)
    const lat = Number(feature.latitude)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const elevation = sampleTerrainElevation(grid, lon, lat)
    if (!Number.isFinite(elevation)) continue
    if (elevation > 5) continue
    const projected = project(lon, lat, elevation)
    if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue
    if (projected.x < 10 || projected.x > width - 10 ||
        projected.y < 22 || projected.y > height - 6) continue
    if (!isSelected && overlapsPlaced(placed, projected.x, projected.y)) continue
    if (!isSelected && depthBuffer && Number.isFinite(projected.order)) {
      const occluderOrder = maxOrderNear(depthBuffer, projected.x, projected.y)
      if (occluderOrder > projected.order + depthBuffer.tolerance) continue
    }
    placed.push(projected)
    labels.push({
      ...feature,
      x: projected.x,
      y: projected.y,
      elevation,
      selected: isSelected,
    })
    if (labels.length >= MAX_LABELS) break
  }
  return labels
}

function featureMinExtentM(grid, camera, canvasSize, density) {
  const metersPerPixel = terrainMetersPerPixel(
    grid.bounds, canvasSize, camera || {},
  )
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return 0
  return Math.max(120, metersPerPixel * 16 / clamp(Number(density) || 1, 0.4, 2.5))
}

const MAX_BOUNDARY_FEATURES = 300
const BOUNDARY_MARGIN_PX = 220

function intersectLongitude(a, b, lon) {
  const delta = b.lon - a.lon
  const ratio = Math.abs(delta) < 1e-12 ? 0 : (lon - a.lon) / delta
  return { lon, lat: a.lat + (b.lat - a.lat) * ratio }
}

function intersectLatitude(a, b, lat) {
  const delta = b.lat - a.lat
  const ratio = Math.abs(delta) < 1e-12 ? 0 : (lat - a.lat) / delta
  return { lon: a.lon + (b.lon - a.lon) * ratio, lat }
}

function clipPolygonRing(points, west, south, east, north) {
  let output = points
  const edges = [
    { inside: point => point.lon >= west, intersect: (a, b) => intersectLongitude(a, b, west) },
    { inside: point => point.lon <= east, intersect: (a, b) => intersectLongitude(a, b, east) },
    { inside: point => point.lat >= south, intersect: (a, b) => intersectLatitude(a, b, south) },
    { inside: point => point.lat <= north, intersect: (a, b) => intersectLatitude(a, b, north) },
  ]
  for (const edge of edges) {
    if (!output.length) break
    const input = output
    output = []
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index]
      const previous = input[(index + input.length - 1) % input.length]
      const currentInside = edge.inside(current)
      const previousInside = edge.inside(previous)
      if (currentInside) {
        if (!previousInside) output.push(edge.intersect(previous, current))
        output.push(current)
      } else if (previousInside) {
        output.push(edge.intersect(previous, current))
      }
    }
  }
  return output
}

function clipLineSegment(a, b, west, south, east, north) {
  let start = 0
  let end = 1
  const dx = b.lon - a.lon
  const dy = b.lat - a.lat
  const p = [-dx, dx, -dy, dy]
  const q = [a.lon - west, east - a.lon, a.lat - south, north - a.lat]
  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 1e-12) {
      if (q[index] < 0) return null
      continue
    }
    const ratio = q[index] / p[index]
    if (p[index] < 0) {
      if (ratio > end) return null
      if (ratio > start) start = ratio
    } else {
      if (ratio < start) return null
      if (ratio < end) end = ratio
    }
  }
  if (start > end) return null
  return [
    { lon: a.lon + dx * start, lat: a.lat + dy * start },
    { lon: a.lon + dx * end, lat: a.lat + dy * end },
  ]
}

function clipLinePieces(points, west, south, east, north) {
  const pieces = []
  let current = []
  for (let index = 1; index < points.length; index += 1) {
    const segment = clipLineSegment(points[index - 1], points[index], west, south, east, north)
    if (!segment) {
      if (current.length > 1) pieces.push(current)
      current = []
      continue
    }
    const [start, end] = segment
    if (!current.length) {
      current = [start]
    } else {
      const last = current[current.length - 1]
      if (Math.abs(last.lon - start.lon) > 1e-9 || Math.abs(last.lat - start.lat) > 1e-9) {
        if (current.length > 1) pieces.push(current)
        current = [start]
      }
    }
    current.push(end)
  }
  if (current.length > 1) pieces.push(current)
  return pieces
}

export function buildSeafloorBoundaries({
  features,
  grid,
  scene,
  camera,
  canvasSize,
  categories,
  density = 1,
  selectedId = '',
}) {
  const width = Number(canvasSize?.width)
  const height = Number(canvasSize?.height)
  const bounds = grid?.bounds
  if (!Array.isArray(features) || !features.length) return []
  if (!bounds || typeof scene?.project !== 'function' || !(width > 0) || !(height > 0)) return []

  const minExtentM = featureMinExtentM(grid, camera, canvasSize, density)
  const project = scene.project
  const selected = selectedId
    ? features.find(feature => feature.id === selectedId)
    : null
  const ordered = selected
    ? [selected, ...features.filter(feature => feature !== selected)]
    : features
  const shapes = []

  for (const feature of ordered) {
    const isSelected = feature.id === selectedId
    if (!isSelected) {
      if (categories && categories[feature.category] === false) continue
      if (Number(feature.extent_m) < minExtentM) continue
    }
    if (!Array.isArray(feature.boundaries) || !feature.boundaries.length) continue
    if (!isSelected && shapes.length >= MAX_BOUNDARY_FEATURES) continue

    const paths = []
    const west = Number(bounds.west)
    const east = Number(bounds.east)
    const south = Number(bounds.south)
    const north = Number(bounds.north)
    let lastElevation = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const shape of feature.boundaries) {
      const rings = shape.kind === 'polygon'
        ? (Array.isArray(shape.rings) ? shape.rings : [])
        : [shape.coordinates]
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 2) continue
        const source = []
        for (const coordinate of ring) {
          if (!Array.isArray(coordinate) || coordinate.length < 2) continue
          const lon = alignLonToBounds(coordinate[0], bounds)
          const lat = Number(coordinate[1])
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
          source.push({ lon, lat })
        }
        if (source.length < 2) continue
        const pieces = shape.kind === 'polygon'
          ? [clipPolygonRing(source, west, south, east, north)]
          : clipLinePieces(source, west, south, east, north)
        for (const piece of pieces) {
          if (!Array.isArray(piece) || piece.length < 2) continue
          const points = []
          for (const point of piece) {
            const lon = Math.min(east, Math.max(west, point.lon))
            const lat = Math.min(north, Math.max(south, point.lat))
            const sampled = sampleTerrainElevation(grid, lon, lat)
            if (Number.isFinite(sampled)) lastElevation = sampled
            const projected = project(lon, lat, Number.isFinite(sampled) ? sampled : lastElevation)
            if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue
            points.push([projected.x, projected.y])
            if (projected.x < minX) minX = projected.x
            if (projected.x > maxX) maxX = projected.x
            if (projected.y < minY) minY = projected.y
            if (projected.y > maxY) maxY = projected.y
          }
          const closed = shape.kind === 'polygon' && points.length >= 3
          if (points.length >= (closed ? 3 : 2)) {
            paths.push({ closed, points })
          }
        }
      }
    }
    if (!paths.length) continue
    if (maxX < -BOUNDARY_MARGIN_PX || minX > width + BOUNDARY_MARGIN_PX ||
        maxY < -BOUNDARY_MARGIN_PX || minY > height + BOUNDARY_MARGIN_PX) continue
    shapes.push({
      featureId: feature.id,
      name: feature.name,
      category: feature.category,
      color: feature.category_color || '#9fb4c6',
      selected: isSelected,
      paths,
    })
  }

  shapes.sort((a, b) => Number(a.selected) - Number(b.selected))
  return shapes
}
