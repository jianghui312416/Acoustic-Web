import test from 'node:test'
import assert from 'node:assert/strict'

const {
  GLOBE_SELECTION_ZOOM_HEIGHT,
  createGlobeSelectionRect,
  fitGlobeSelectionRect,
  lonLatPointsToBounds,
  moveGlobeSelectionRect,
  resizeGlobeSelectionRect,
} = await import('../src/utils/terrainSelection.js')

test('globe selection starts centered and keeps room around it', () => {
  const rect = createGlobeSelectionRect(1200, 800)
  assert.ok(rect.width > 0 && rect.width < 1200)
  assert.ok(rect.height > 0 && rect.height < 800)
  assert.ok(Math.abs(rect.left + rect.width / 2 - 600) < 1e-9)
  assert.ok(Math.abs(rect.top + rect.height / 2 - 400) < 1e-9)
  assert.ok(GLOBE_SELECTION_ZOOM_HEIGHT > 0)
})

test('moving the globe selection never changes its size and stays inside the view', () => {
  const start = { left: 200, top: 150, width: 400, height: 300 }
  const moved = moveGlobeSelectionRect(start, 120, -40, 1200, 800)
  assert.equal(moved.width, start.width)
  assert.equal(moved.height, start.height)
  assert.equal(moved.left, 320)
  assert.equal(moved.top, 110)

  const clamped = moveGlobeSelectionRect(start, 5000, 5000, 1200, 800)
  assert.equal(clamped.width, start.width)
  assert.equal(clamped.height, start.height)
  assert.ok(clamped.left + clamped.width <= 1200 - 8)
  assert.ok(clamped.top + clamped.height <= 800 - 8)
})

test('resizing the globe selection only changes the dragged edges', () => {
  const start = { left: 200, top: 150, width: 400, height: 300 }
  const grown = resizeGlobeSelectionRect(start, 'se', 80, 60, 1200, 800)
  assert.equal(grown.left, start.left)
  assert.equal(grown.top, start.top)
  assert.equal(grown.width, start.width + 80)
  assert.equal(grown.height, start.height + 60)

  const fromWest = resizeGlobeSelectionRect(start, 'w', -50, 100, 1200, 800)
  assert.equal(fromWest.width, start.width + 50)
  assert.equal(fromWest.height, start.height)
  assert.equal(fromWest.left, start.left - 50)
  assert.equal(fromWest.top, start.top)

  const tiny = resizeGlobeSelectionRect(start, 'se', -10000, -10000, 1200, 800)
  assert.ok(tiny.width > 0)
  assert.ok(tiny.height > 0)
})

test('selection fitting keeps a hidden rect usable after a container resize', () => {
  const fitted = fitGlobeSelectionRect({ left: 900, top: 700, width: 400, height: 300 }, 800, 600)
  assert.ok(fitted.left >= 8)
  assert.ok(fitted.top >= 8)
  assert.ok(fitted.left + fitted.width <= 800 - 8 + 1e-9)
  assert.ok(fitted.top + fitted.height <= 600 - 8 + 1e-9)
})

test('sampled lon/lat points become a normalized terrain bounds', () => {
  const bounds = lonLatPointsToBounds([
    { lon: 110.5, lat: 12.25 },
    { lon: 118.5, lat: 18.75 },
    { lon: 114.0, lat: 15.0 },
  ])
  assert.deepEqual(bounds, { west: 110.5, south: 12.25, east: 118.5, north: 18.75 })
  assert.equal(lonLatPointsToBounds([]), null)
  assert.equal(lonLatPointsToBounds([{ lon: NaN, lat: 10 }]), null)
})

test('a selection crossing the antimeridian is rejected instead of becoming a world-sized box', () => {
  assert.equal(
    lonLatPointsToBounds([
      { lon: 179.5, lat: 10 },
      { lon: -179.5, lat: 10.5 },
    ]),
    null
  )
})
