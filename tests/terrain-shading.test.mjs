import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAND_COLOR_STOPS,
  WATER_COLOR_STOPS,
  pickBandStep,
  terrainColorAt,
  terrainMesh,
  terrainSeaMask,
  screenHeightGradient,
  contourLineWidth,
  terrainSegments,
  TERRAIN_MAX_MESH_SEGMENTS,
} from '../src/utils/terrainRendering.js'

const bounds = { west: 115, east: 116, south: 15, north: 16 }

function grid(values) {
  return {
    bounds,
    width: Math.sqrt(values.length),
    height: Math.sqrt(values.length),
    values: Float32Array.from(values),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

test('elevation bands snap to readable contour intervals', () => {
  assert.equal(pickBandStep(0), 0)
  assert.equal(pickBandStep(946, 12), 100)
  assert.equal(pickBandStep(8000, 12), 1000)
  assert.equal(pickBandStep(-20, 4), 5)
})

test('banded terrain color is constant inside a step and changes across it', () => {
  const low = terrainColorAt(205, 0, 1000, { landBand: 100 })
  const lowSameBand = terrainColorAt(298, 0, 1000, { landBand: 100 })
  const nextBand = terrainColorAt(305, 0, 1000, { landBand: 100 })
  assert.deepEqual(low, lowSameBand)
  assert.notDeepEqual(low, nextBand)

  const shallow = terrainColorAt(-205, -2000, 0, { waterBand: 100 })
  const shallowSameBand = terrainColorAt(-299, -2000, 0, { waterBand: 100 })
  const deeper = terrainColorAt(-305, -2000, 0, { waterBand: 100 })
  assert.deepEqual(shallow, shallowSameBand)
  assert.notDeepEqual(shallow, deeper)
})

test('continuous elevation colors still span water and land ramps', () => {
  assert.deepEqual(terrainColorAt(0, -2000, 1000), WATER_COLOR_STOPS[0][1])
  assert.deepEqual(terrainColorAt(1000, -2000, 1000), LAND_COLOR_STOPS.at(-1)[1])
  assert.deepEqual(terrainColorAt(-2000, -2000, 1000), WATER_COLOR_STOPS.at(-1)[1])
})

test('screen-space height gradient matches an analytic plane slope', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  assert.equal(screenHeightGradient(points, [100, 100, 100, 100]), 0)
  const elevations = points.map(point => point.x * 2 + point.y * 3)
  assert.ok(Math.abs(screenHeightGradient(points, elevations) - Math.sqrt(13)) < 1e-9)
})

test('contour line width shrinks as the screen gradient grows', () => {
  const flat = contourLineWidth(100, .5)
  const steep = contourLineWidth(100, 20)
  assert.ok(steep < flat)
  assert.ok(steep >= .35 && flat <= 1.9)
  assert.equal(contourLineWidth(0, 10), .9)
})

test('mesh subdivision supports an interactive lower cap', () => {
  const size = { width: 1200, height: 760 }
  assert.ok(terrainSegments(size, 14, .75, 128) <= 128)
  assert.ok(terrainSegments(size, 14) <= TERRAIN_MAX_MESH_SEGMENTS)
  assert.ok(terrainSegments(size, 14) > terrainSegments(size, 14, .75, 128))
})

test('sea mask fills from the view boundary and removes single-pixel land noise', () => {
  const size = 12
  const values = new Array(size * size).fill(-10)
  values[5 * size + 5] = 1
  for (let row = 2; row <= 4; row += 1) {
    for (let col = 2; col <= 4; col += 1) values[row * size + col] = 50
  }
  const mask = terrainSeaMask(grid(values))
  assert.equal(mask[5 * size + 5], 1)
  assert.equal(mask[2 * size + 2], 0)
  assert.equal(mask[0], 1)
})

test('terrain mesh caches cell indices alongside faces', () => {
  const size = 16
  const values = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const distance = Math.hypot(col / (size - 1) - .5, row / (size - 1) - .5)
      values.push(900 - distance * 1200)
    }
  }
  const mesh = terrainMesh(grid(values), 16)
  assert.equal(mesh.cells.length, mesh.faces.length)
  assert.ok(mesh.vertices.every(vertex => !('ao' in vertex)))
})
