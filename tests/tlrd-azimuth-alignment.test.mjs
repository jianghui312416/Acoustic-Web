import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { GeoVis: {} }

const {
  buildProfileModel,
  nearestAzimuthRow,
  tlrdSectorAzimuths,
  internalAzimuthToCompassBearing,
  profileAxisGeometry,
  seabedDepthAtDistance,
  clipRayPathsByProfile,
} = await import('../src/sdk/ncFieldModel.js')

function fourBearingFixture() {
  return {
    Data: {
      Units: [{
        Plugin: 'Analyse3DTLRD',
        Response: {
          altitudeList: {
            pairedDataVS: Array.from({ length: 4 }, () => ({ x: [0], y: [-100] })),
          },
          loadingTlv: {
            row: 1,
            col: 1,
            sector: 4,
            profile: {
              x: [0],
              z: [10],
              // 行序与门户/Bellhop theta_deg 一致：北、东、南、西。
              data: [[61], [71], [81], [91]],
            },
          },
        },
      }],
    },
  }
}

test('maps TLRD rows to the portal calculated bearings without a half-sector offset', () => {
  // 界面坐标为东 0°、北 90°，所以门户的北/东/南/西映射为 90/0/270/180。
  assert.deepEqual(tlrdSectorAzimuths(4), [90, 0, 270, 180])

  const model = buildProfileModel(fourBearingFixture(), 'tlrd')
  const expected = new Map([[90, 61], [0, 71], [270, 81], [180, 91]])
  for (const [azimuth, value] of expected) {
    const row = nearestAzimuthRow(model, azimuth)
    assert.equal(model.tlAt(row, 0, 0), value, `方位 ${azimuth}° 应命中对应的 TL 数据行`)
    assert.equal(internalAzimuthToCompassBearing(azimuth), model.grid?.compassBearings?.[row] ?? [0, 90, 180, 270][row])
  }
})

test('uses declared portal compass bearings in their original row order', () => {
  assert.deepEqual(tlrdSectorAzimuths(4, [45, 135, 225, 315]), [45, 315, 225, 135])
})

test('shares TL profile bounds and clips rays at seabed or land columns', () => {
  const model = {
    depths: [0, 50, 100],
    cols: 4,
    colDistFor: () => [0, 100, 200, 300],
    seabedFor: () => [80, 40, 60, 0],
  }
  const geometry = profileAxisGeometry(model, 0, 300)
  assert.equal(geometry.maxDistanceM, 300)
  assert.equal(geometry.maxDepthM, 100)
  assert.equal(seabedDepthAtDistance(geometry.seabedSamples, 50), 60)
  assert.ok(Number.isNaN(seabedDepthAtDistance(geometry.seabedSamples, 250)), '陆地相邻区不能插值成海域')

  const clipped = clipRayPathsByProfile(
    [[[0, 20], [100, 30], [200, 70], [300, 20]]],
    geometry
  )
  assert.equal(clipped.length, 1)
  assert.ok(clipped[0].at(-1)[0] > 100 && clipped[0].at(-1)[0] < 200)
  for (const [distance, depth] of clipped[0]) {
    assert.ok(depth <= seabedDepthAtDistance(geometry.seabedSamples, distance) + 0.02)
  }
})
