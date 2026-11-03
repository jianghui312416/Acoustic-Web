import test from 'node:test'
import assert from 'node:assert/strict'
import { acousticTerrainBounds, buildLocalGebcoUrl, loadBathymetry } from '../src/utils/bathymetry.js'
import { bathymetryColor, createTerrainProjection } from '../src/utils/terrainScene.js'

test('local GEBCO request carries normalized bounds and a bounded resolution', () => {
  const request = buildLocalGebcoUrl({ west: 117, east: 115, south: 17, north: 15 }, 900)
  const url = new URL(request.url, 'http://localhost')
  assert.equal(url.pathname, '/api/gebco')
  assert.equal(url.searchParams.get('west'), '115')
  assert.equal(url.searchParams.get('east'), '117')
  assert.equal(url.searchParams.get('south'), '15')
  assert.equal(url.searchParams.get('north'), '17')
  assert.equal(url.searchParams.get('resolution'), '512')
})

test('local GEBCO values remain signed metre elevations and rows stay north to south', async () => {
  const payload = {
    width: 3, height: 2,
    values: [-3200, -3100, -3000, -4200, -4100, -4000],
    bounds: { west: 115, east: 116, south: 15, north: 16 },
    source: 'GEBCO_2026_sub_ice',
  }
  const grid = await loadBathymetry(payload.bounds, 3, { baseUrl: '/test-gebco', fetchJson: async () => payload })
  assert.deepEqual([...grid.values], payload.values)
  assert.equal(grid.min, -4200)
  assert.equal(grid.max, -3000)
  assert.equal(grid.count, 6)
  assert.equal(grid.source, 'GEBCO_2026_sub_ice')
})

test('local GEBCO reader retries transient errors and rejects invalid grids', async () => {
  let attempts = 0
  const bounds = { west: -61, east: -59, south: 70, north: 71 }
  const payload = { width: 2, height: 2, values: [-100, -200, -300, -400], bounds }
  const grid = await loadBathymetry(bounds, 8, { baseUrl: '/retry-gebco', fetchJson: async () => {
    attempts++
    if (attempts === 1) throw new Error('temporary')
    return payload
  } })
  assert.equal(attempts, 2)
  assert.equal(grid.min, -400)
  await assert.rejects(loadBathymetry(bounds, 9, {
    baseUrl: '/invalid-gebco', fetchJson: async () => ({ width: 2, height: 2, values: [0] }),
  }), /本地 GEBCO_2026_sub_ice/)
})

test('terrain and acoustic source share a geographic projection with depth below sea level', () => {
  const project = createTerrainProjection({ west: 115, east: 117, south: 15, north: 17 }, {width:1000,height:800}, -5000)
  const surface = project(116,16,0)
  const source = project(116,16,-150)
  const bottom = project(116,16,-5000)
  assert.equal(surface.x,500)
  assert.equal(source.x,bottom.x)
  assert.ok(surface.y < source.y && source.y < bottom.y)
  assert.ok(project(116,17,0).y < project(116,15,0).y)
  assert.ok(project(117,16,0).x > project(115,16,0).x)
})

test('shallow and deep seabed remain ocean blue instead of mapping the shallowest ocean point to land', () => {
  for (const elevation of [-5000,-3000,-100]) {
    const [r,g,b] = bathymetryColor(elevation,-5000,-100)
    assert.ok(b > g && g > r)
  }
})

test('workspace terrain uses a 100 km square centered on the sound field source', () => {
  const source = { lon: 153.85975, lat: 34.2657 }
  const bounds = acousticTerrainBounds(source, 100 / 6)
  const widthKm = (bounds.east - bounds.west) * 110.574 * Math.cos(source.lat * Math.PI / 180)
  const heightKm = (bounds.north - bounds.south) * 110.574
  assert.ok(Math.abs(widthKm - 100) < 0.2)
  assert.ok(Math.abs(heightKm - 100) < 0.2)
  assert.ok(Math.abs((bounds.west + bounds.east) / 2 - source.lon) < 1e-9)
  assert.ok(Math.abs((bounds.south + bounds.north) / 2 - source.lat) < 1e-9)
})

test('default terrain leaves room around the full acoustic radius at Arctic latitudes', () => {
  const radius = 39.6 * 1.852
  const bounds = acousticTerrainBounds({ lon: -60, lat: 70.8 }, radius)
  const widthKm = (bounds.east - bounds.west) * 110.574 * Math.cos(70.8 * Math.PI / 180)
  const heightKm = (bounds.north - bounds.south) * 110.574
  assert.ok(Math.abs(2 * radius / widthKm - 1/3) < .001)
  assert.ok(Math.abs(2 * radius / heightKm - 1/3) < .001)
})
