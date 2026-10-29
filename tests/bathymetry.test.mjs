import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeTerrarium, terrainTilePoint, acousticTerrainBounds, loadBathymetry } from '../src/utils/bathymetry.js'
import { bathymetryColor, createTerrainProjection } from '../src/utils/terrainScene.js'

test('Terrarium decoding preserves negative seafloor elevations and fractional metres', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0)
  assert.equal(decodeTerrarium(108, 120, 0), -5000)
  assert.equal(decodeTerrarium(128, 100, 128), 100.5)
  assert.equal(decodeTerrarium(127, 255, 128), -.5)
})

test('geographic tile coordinates cover poles and antimeridian without requesting an invalid tile', () => {
  assert.deepEqual(terrainTilePoint(0, 0, 1), { x: 1, y: 1, px: 0, py: 0 })
  for (const [lon, lat] of [[180,85],[-180,-85],[116,16]]) {
    const p = terrainTilePoint(lon, lat, 8)
    assert.ok(p.x >= 0 && p.x < 256 && p.y >= 0 && p.y < 256)
    assert.ok(p.px >= 0 && p.px < 256 && p.py >= 0 && p.py < 256)
  }
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

test('default terrain leaves room around the full acoustic radius at Arctic latitudes', () => {
  const radius = 39.6 * 1.852
  const bounds = acousticTerrainBounds({ lon: -60, lat: 70.8 }, radius)
  const widthKm = (bounds.east - bounds.west) * 110.574 * Math.cos(70.8 * Math.PI / 180)
  const heightKm = (bounds.north - bounds.south) * 110.574
  assert.ok(Math.abs(2 * radius / widthKm - 1/3) < .001)
  assert.ok(Math.abs(2 * radius / heightKm - 1/3) < .001)
})

function oceanPixels() {
  const pixels = new Uint8ClampedArray(256 * 256 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([108,120,0,255],i)
  return pixels
}

test('a failed Arctic tile falls back to a coarser level with the same bounds and real negative elevation', async () => {
  const bounds = acousticTerrainBounds({ lon: -60, lat: 70.8 }, 73.34)
  const attempted = []
  let firstZoom
  const pixels = oceanPixels()
  const grid = await loadBathymetry(bounds, 8, { readTile: async z => {
    attempted.push(z)
    firstZoom ??= z
    if (z === firstZoom) throw new Error('TLS disconnected')
    return pixels
  } })
  assert.equal(grid.reducedResolution, true)
  assert.equal(grid.zoom, firstZoom - 1)
  assert.deepEqual(grid.bounds, bounds)
  assert.equal(grid.min, -5000)
  assert.equal(grid.count, 64)
  assert.ok(attempted.includes(firstZoom - 1))
})

test('persistent tile failures are bounded and never produce fake or zero depth', async () => {
  const levels = new Set()
  await assert.rejects(loadBathymetry({west:-61,east:-59,south:70,north:71},4,{readTile: async z => {
    levels.add(z)
    throw new Error('offline')
  }}), /重试及较低分辨率/)
  assert.equal(levels.size,3)
})
