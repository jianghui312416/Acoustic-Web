import assert from 'node:assert/strict'
import test from 'node:test'

class EllipsoidTerrainProvider {}

globalThis.window = {
  GeoVis: {
    Math: {
      toRadians: value => (Number(value) * Math.PI) / 180,
      toDegrees: value => (Number(value) * 180) / Math.PI,
    },
    EllipsoidTerrainProvider,
    Cartographic: {
      fromDegrees: (longitude, latitude) => ({ longitude, latitude }),
    },
    sampleTerrainMostDetailed: async (_provider, positions) =>
      positions.map((position, index) => ({ ...position, height: -50 - index })),
  },
}

const { sampleTerrainProfile } = await import('../src/sdk/terrainVolumeMask.js')

test('samples a finite terrain profile from source to arrow range', async () => {
  const profile = await sampleTerrainProfile(
    { availability: {} },
    {
      sourceLon: 116,
      sourceLat: 16,
      bearingDeg: 90,
      rangeM: 1852,
      spacingM: 500,
      minSamples: 8,
      maxSamples: 32,
    }
  )

  assert.equal(profile.distanceM.length, 8)
  assert.equal(profile.distanceM[0], 0)
  assert.equal(profile.distanceM.at(-1), 1852)
  assert.deepEqual(profile.elevationM, [-50, -51, -52, -53, -54, -55, -56, -57])
  assert.equal(profile.source, 'GeoVis.sampleTerrainMostDetailed')
})

test('does not sample an ellipsoid-only terrain provider', async () => {
  const profile = await sampleTerrainProfile(
    new EllipsoidTerrainProvider(),
    { sourceLon: 116, sourceLat: 16, bearingDeg: 90, rangeM: 1852 }
  )
  assert.equal(profile, null)
})
