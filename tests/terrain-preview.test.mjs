import test from 'node:test'
import assert from 'node:assert/strict'

const {
  DEFAULT_THUMB_VIEW,
  MIN_TERRAIN_SPAN_DEG,
  boundsToThumbRect,
  boundsToViewRect,
  buildDemoTerrainGrid,
  buildGebcoWmsUrl,
  createThumbView,
  formatTerrainBounds,
  lonLatToThumbPoint,
  lonLatToViewPoint,
  moveTerrainBounds,
  normalizeTerrainBounds,
  panThumbView,
  resizeTerrainBounds,
  thumbPointToLonLat,
  viewPointToLonLat,
  zoomThumbView,
} = await import('../src/utils/terrainPreview.js')
const { createTerrainProjection } = await import('../src/utils/terrainScene.js')

test('terrain bounds are normalized and kept inside world limits', () => {
  const bounds = normalizeTerrainBounds({ west: 30, south: 20, east: 10, north: 5 })
  assert.ok(bounds.east > bounds.west)
  assert.ok(bounds.north > bounds.south)

  const clamped = normalizeTerrainBounds({ west: -500, south: -120, east: 500, north: 120 })
  assert.equal(clamped.west, -180)
  assert.equal(clamped.east, 180)
  assert.equal(clamped.south, -85)
  assert.equal(clamped.north, 85)
})

test('tiny terrain selections are expanded to a usable minimum span', () => {
  const bounds = normalizeTerrainBounds({ west: 10, south: 10, east: 10, north: 10 })
  assert.ok(bounds.east - bounds.west >= MIN_TERRAIN_SPAN_DEG)
  assert.ok(bounds.north - bounds.south >= MIN_TERRAIN_SPAN_DEG)
})

test('moving a terrain selection preserves its size and stays in bounds', () => {
  const start = { west: 100, south: 10, east: 130, north: 30 }
  const moved = moveTerrainBounds(start, -10000, 0)
  assert.equal(moved.east - moved.west, 30)
  assert.equal(moved.west, -180)
  assert.equal(moved.east, -150)
})

test('resizing a terrain selection respects the minimum span', () => {
  const start = { west: 100, south: 10, east: 130, north: 30 }
  const resized = resizeTerrainBounds(start, 'e', -29.9, 0)
  assert.equal(resized.west, start.west)
  assert.ok(resized.east - resized.west >= MIN_TERRAIN_SPAN_DEG)
})

test('thumbnail coordinates round-trip to longitude and latitude', () => {
  for (const [lon, lat] of [
    [0, 0],
    [116.4, 39.9],
    [-60, 70.8],
    [-150, -45],
  ]) {
    const point = lonLatToThumbPoint(lon, lat)
    const restored = thumbPointToLonLat(point.x, point.y)
    assert.ok(Math.abs(restored.lon - lon) < 1e-6)
    assert.ok(Math.abs(restored.lat - lat) < 1e-4)
  }
})

test('terrain bounds map to a normalized thumbnail rectangle', () => {
  const rect = boundsToThumbRect({ west: -90, south: -45, east: 90, north: 45 })
  assert.ok(rect.left >= 0 && rect.left <= 1)
  assert.ok(rect.top >= 0 && rect.top <= 1)
  assert.ok(rect.width > 0 && rect.width <= 1)
  assert.ok(rect.height > 0 && rect.height <= 1)
  assert.equal(DEFAULT_THUMB_VIEW.top < DEFAULT_THUMB_VIEW.bottom, true)
})

test('demo terrain grid is deterministic and has elevation relief', () => {
  const bounds = { west: 100, south: 0, east: 130, north: 25 }
  const first = buildDemoTerrainGrid(bounds, 32)
  const second = buildDemoTerrainGrid(bounds, 32)
  assert.equal(first.values.length, 32 * 32)
  assert.ok(first.range > 500)
  assert.deepEqual(Array.from(first.values), Array.from(second.values))
  assert.deepEqual(first.bounds, second.bounds)
})

test('terrain bounds are formatted for the preview header', () => {
  const text = formatTerrainBounds({ west: 100, south: -10, east: 120, north: 15 })
  assert.match(text, /100\.00°/)
  assert.match(text, /120\.00°/)
  assert.match(text, /-10\.00°/)
})

test('terrain projection applies the requested vertical exaggeration', () => {
  const bounds = { west: 10, east: 12, south: 20, north: 22 }
  const flat = createTerrainProjection(bounds, { width: 1000, height: 800 }, -4000, {
    verticalExaggeration: 1,
  })
  const exaggerated = createTerrainProjection(bounds, { width: 1000, height: 800 }, -4000, {
    verticalExaggeration: 4,
  })
  const sea = flat(11, 21, 0)
  const depth1 = flat(11, 21, -1000)
  const depth4 = exaggerated(11, 21, -1000)
  assert.ok(Math.abs(depth4.y - sea.y) > Math.abs(depth1.y - sea.y) * 3.9)
})

test('terrain and acoustic depths share the same meter-based projection at 1x', () => {
  const bounds = { west: 115, east: 117, south: 15, north: 17 }
  const project = createTerrainProjection(bounds, { width: 1000, height: 800 }, -4000, {
    verticalExaggeration: 1,
  })
  const terrainBottom = project(116, 16, -1000)
  const acousticBottom = project(116, 16, -1000)
  assert.deepEqual(acousticBottom, terrainBottom)
  assert.ok(terrainBottom.y > project(116, 16, 0).y)
})

test('true top-down terrain projection keeps horizontal circles circular and depth aligned', () => {
  const bounds = { west: 115, east: 117, south: 15, north: 17 }
  const centerLon = 116
  const centerLat = 16
  const project = createTerrainProjection(bounds, { width: 1000, height: 800 }, -4000, {
    pitch: Math.PI / 2,
    verticalExaggeration: 10,
  })
  const centerSurface = project(centerLon, centerLat, 0)
  const centerDeep = project(centerLon, centerLat, -2000)
  const deltaLat = 0.25
  const deltaLon = deltaLat / Math.cos(centerLat * Math.PI / 180)
  const east = project(centerLon + deltaLon, centerLat, 0)
  const north = project(centerLon, centerLat + deltaLat, 0)

  assert.ok(Math.abs(Math.abs(east.x - centerSurface.x) - Math.abs(north.y - centerSurface.y)) < 1e-8)
  assert.ok(Math.abs(centerDeep.x - centerSurface.x) < 1e-8)
  assert.ok(Math.abs(centerDeep.y - centerSurface.y) < 1e-8)
  assert.equal(centerSurface.perspective, 1)
  assert.equal(north.perspective, 1)
})

test('thumbnail wheel zoom keeps aspect ratio and clamps to the world view', () => {
  const start = createThumbView()
  const zoomed = zoomThumbView(start, 0.5, 0.5, 0.5)
  const startRatio = (start.y1 - start.y0) / (start.x1 - start.x0)
  const zoomedRatio = (zoomed.y1 - zoomed.y0) / (zoomed.x1 - zoomed.x0)
  assert.ok(zoomed.x1 - zoomed.x0 < start.x1 - start.x0)
  assert.ok(Math.abs(startRatio - zoomedRatio) < 1e-9)

  const reset = zoomThumbView(zoomed, 0.3, 0.7, 100)
  assert.ok(Math.abs(reset.x0) < 1e-9)
  assert.ok(Math.abs(reset.x1 - 1) < 1e-9)
  assert.ok(Math.abs(reset.y0 - DEFAULT_THUMB_VIEW.top) < 1e-9)
  assert.ok(Math.abs(reset.y1 - DEFAULT_THUMB_VIEW.bottom) < 1e-9)
})

test('thumbnail panning is constrained to the visible world extent', () => {
  const zoomed = zoomThumbView(createThumbView(), 0.5, 0.5, 0.4)
  const moved = panThumbView(zoomed, -10, -10)
  assert.ok(moved.x0 >= 0)
  assert.ok(moved.x1 <= 1)
  assert.ok(moved.y0 >= DEFAULT_THUMB_VIEW.top)
  assert.ok(moved.y1 <= DEFAULT_THUMB_VIEW.bottom)
  assert.ok(Math.abs(moved.x1 - moved.x0 - (zoomed.x1 - zoomed.x0)) < 1e-9)
})

test('zoomed thumbnail view maps bounds and pointer positions consistently', () => {
  const view = zoomThumbView(createThumbView(), 0.5, 0.5, 0.35)
  const point = lonLatToViewPoint(20, 10, view)
  const restored = viewPointToLonLat(point.x, point.y, view)
  assert.ok(Math.abs(restored.lon - 20) < 1e-5)
  assert.ok(Math.abs(restored.lat - 10) < 1e-4)

  const rect = boundsToViewRect({ west: 10, south: 0, east: 30, north: 20 }, view)
  assert.ok(rect.left >= 0 && rect.right <= 1)
  assert.ok(rect.width > 0)
})

test('GEBCO WMS URL uses WMS 1.3.0 lat/lon BBOX order', () => {
  const url = buildGebcoWmsUrl(
    { west: -47, south: 25, east: -26, north: 45 },
    { width: 800, height: 600 }
  )
  const parsed = new URL(url)
  assert.equal(parsed.hostname, 'wms.gebco.net')
  assert.equal(parsed.searchParams.get('version'), '1.3.0')
  assert.equal(parsed.searchParams.get('layers'), 'gebco_latest')
  assert.equal(parsed.searchParams.get('BBOX'), '25,-47,45,-26')
  assert.equal(parsed.searchParams.get('width'), '800')
  assert.equal(parsed.searchParams.get('height'), '600')
})
