import test from 'node:test'
import assert from 'node:assert/strict'

class EllipsoidTerrainProvider {}

globalThis.window = {
  GeoVis: {
    EllipsoidTerrainProvider,
    sampleTerrainMostDetailed: async () => [],
  },
}

const { canSampleTerrain } = await import('../src/sdk/terrainVolumeMask.js')

test('rejects the ellipsoid provider by identity, independent of its class name', () => {
  // GeoVis 打包后类名会被压缩，instanceof 才能稳定识别椭球地形。
  const provider = new EllipsoidTerrainProvider()
  provider.availability = { fake: true }
  assert.equal(canSampleTerrain(provider), false)
})

test('rejects providers without tile availability', () => {
  assert.equal(canSampleTerrain({ availability: undefined }), false)
  assert.equal(canSampleTerrain({}), false)
  assert.equal(canSampleTerrain(null), false)
})

test('accepts a terrain provider that exposes availability', () => {
  assert.equal(canSampleTerrain({ availability: { fake: true } }), true)
})
