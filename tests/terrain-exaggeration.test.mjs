import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TERRAIN_MAX_MESH_SEGMENTS,
  terrainMesh,
  terrainSegments,
  hillshade,
  terrainLighting,
} from '../src/utils/terrainRendering.js'
import { drawTerrainScene, createTerrainProjection } from '../src/utils/terrainScene.js'
import { pickTerrainPoint } from '../src/utils/terrainPicking.js'
import { readFileSync } from 'node:fs'

const bounds = { west: 115, east: 116, south: 15, north: 16 }
function grid(size = 8) {
  return { bounds, width: size, height: size, min: -2000, max: -1000,
    values: Float32Array.from({ length: size * size }, (_, i) => -2000 + i * 2) }
}
function canvas() {
  const ctx = new Proxy({}, { get: (obj, key) => obj[key] ?? (key === 'createLinearGradient'
    ? () => ({ addColorStop() {} }) : () => {}) })
  return { width: 0, height: 0, getBoundingClientRect: () => ({ width: 900, height: 600 }), getContext: () => ctx }
}

test('scale changes reuse terrain geometry and preserve all physical depth values', () => {
  const g = grid(), before = [...g.values], c = canvas()
  const source = { lon: 115.5, lat: 15.5, depth: 500 }
  const results = [1, 3, 10, 1].map(terrainExaggeration => drawTerrainScene(c, g, {
    source, receiver: { lon: 115.6, lat: 15.5, depthM: 500 }, controls: { terrainExaggeration },
  }))
  for (const [i, scene] of results.entries()) {
    assert.equal(scene.mesh, results[0].mesh)
    assert.equal(scene.lighting.zFactor, [1, 3, 10, 1][i])
    assert.deepEqual(scene.anchor, scene.project(source.lon, source.lat, -500))
  }
  assert.deepEqual([...g.values], before)
  assert.deepEqual(results[0].points, results[3].points)
  const sea = results[0].project(source.lon, source.lat, 0)
  assert.ok(Math.abs((results[2].anchor.y - sea.y) / (results[0].anchor.y - sea.y) - 10) < 1e-10)
})

test('zoom refines cached meshes within source resolution and fixed face budget', () => {
  const g = grid(256), size = { width: 900, height: 600 }
  const far = terrainMesh(g, terrainSegments(size, .55))
  const near = terrainMesh(g, terrainSegments(size, 14))
  assert.ok(near.faces.length > far.faces.length)
  assert.ok(near.faces.length <= TERRAIN_MAX_MESH_SEGMENTS ** 2)
  assert.equal(terrainMesh(g, terrainSegments(size, .55)), far)
  g.values[0] = NaN
  const hole = grid(2); hole.values[0] = NaN
  assert.equal(terrainMesh(hole, 192).faces.length, 0)
})

test('Hillshade follows physical slope and zFactor without altering flat seabed', () => {
  const light = { ...terrainLighting, zFactor: 1 }
  const exaggerated = { ...light, zFactor: 10 }
  assert.equal(hillshade(0, 0, light), hillshade(0, 0, exaggerated))
  assert.notEqual(hillshade(.5, .3, light), hillshade(.5, .3, exaggerated))
  assert.notEqual(hillshade(.5, .3, light), hillshade(-.5, -.3, light))
})

test('picking compensates perspective and exaggeration to recover real coordinates', () => {
  for (const scale of [1, 3, 10]) {
    const project = createTerrainProjection(bounds, { width: 900, height: 600 }, -2000, { verticalExaggeration: scale })
    const coords = [[115, 15, -1000], [116, 15, -2000], [116, 16, -1500], [115, 16, -500]]
    const p = coords.map(([lon, lat, elevation]) => ({ lon, lat, elevation, ...project(lon, lat, elevation) }))
    const physical = coords.slice(0, 3).reduce((sum, v) => sum.map((n, i) => n + v[i] / 3), [0, 0, 0])
    const screen = project(...physical)
    const picked = pickTerrainPoint({ faces: [{ p }] }, screen.x, screen.y)
    for (const [i, key] of ['lon', 'lat', 'elevation'].entries()) assert.ok(Math.abs(picked[key] - physical[i]) < 1e-8)
  }
})

test('regional exaggeration bypasses globe reconstruction and only schedules display', () => {
  const view = readFileSync(new URL('../src/views/AcousticFieldView.vue', import.meta.url), 'utf8')
  const handler = view.match(/function onDepthExagChange\(\) \{[\s\S]*?\n\}/)[0]
  assert.ok(handler.indexOf("if (props.viewMode === 'terrain') return") < handler.indexOf('requestAnimationFrame'))
  assert.doesNotMatch(handler, /loadBathymetry|submitCalculation|fetch\(/)
  const component = readFileSync(new URL('../src/components/terrain/TerrainPreviewMode.vue', import.meta.url), 'utf8')
  assert.match(component, /watch\(visualControls, \(\) => scheduleDraw\(\)/)
})
