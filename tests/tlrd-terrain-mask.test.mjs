import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { GeoVis: {} }

const {
  parseAnalyse3DTlrd,
  decodeTlrdPolarVolume,
  interpolateTlIntensityDb,
  isTlrdValidValue,
} = await import('../src/sdk/ncTlrdParser.js')

function fixture() {
  return {
    Data: {
      Units: [{
        Plugin: 'Analyse3DTLRD',
        Response: {
          altitudeList: {
            pairedDataVS: [
              { x: [0, 100], y: [-20, -20] },
              { x: [0, 100], y: [12, 15] },
            ],
          },
          loadingTlv: {
            row: 2,
            col: 2,
            sector: 2,
            profile: {
              x: [0, 100],
              z: [0, 50],
              data: [
                [70, 72],
                [80, 82],
                [90, 92],
                [100, 102],
              ],
            },
          },
        },
      }],
    },
  }
}

function currentPortalFixture() {
  const json = fixture()
  const tlv = json.Data.Units[0].Response.loadingTlv
  tlv.data = tlv.profile.data
  delete tlv.profile.data
  return json
}

test('parses the current api_endpoints loadingTlv.data response layout', () => {
  const parsed = parseAnalyse3DTlrd(currentPortalFixture())
  assert.equal(parsed.grid.sector, 2)
  assert.equal(parsed.grid.row, 2)
  assert.equal(parsed.grid.col, 2)
  assert.equal(parsed.at(0, 0, 0), 70)
})

test('masks land and below-seabed TL before volume interpolation', () => {
  const parsed = parseAnalyse3DTlrd(fixture())
  assert.equal(parsed.at(0, 0, 0), 70)
  assert.ok(Number.isNaN(parsed.at(0, 1, 0)), 'depth below the 20 m seabed must be hidden')
  assert.ok(Number.isNaN(parsed.at(1, 0, 0)), 'positive terrain altitude is land, including depth 0')
  assert.equal(parsed.seabedDepthAt(0, 0), 20)
  assert.equal(parsed.seabedDepthAt(1, 0), 0)
  assert.equal(parsed.stats.invalidSubstrateCount, 6)
})

test('strict nearest mode retains finite 200 values at the texture upper end', () => {
  const json = fixture()
  json.Data.Units[0].Response.loadingTlv.profile.data[0][0] = 200
  const parsed = parseAnalyse3DTlrd(json)
  const texture = decodeTlrdPolarVolume(parsed, {
    sourceLon: 116,
    sourceLat: 16,
    angleInterp: 1,
    strictNearest: true,
  })
  assert.equal(texture.height, 2, 'one texture row per original sector, no angle interpolation')
  assert.equal(texture.textureFilter, 'nearest')
  assert.equal(texture.strictNearest, true)
  const voxel = (z, y, x) => {
    const o = (((z * texture.height + y) * texture.width + x) * 4)
    return texture.data.slice(o, o + 4)
  }
  assert.equal(voxel(0, 0, 0)[0], 255, '200 is clamped to the texture upper end')
  assert.equal(voxel(0, 0, 0)[3], 255, '200 remains visible in reference mode')
  assert.equal(voxel(0, 0, 1)[3], 255, 'valid water node stays visible')
  assert.equal(voxel(0, 1, 0)[3], 0, 'land sector stays transparent')
  // G 通道存该列海底深度：depthMin=0 / depthMax=50，20 m → round(20/50*255)=102
  assert.equal(voxel(0, 0, 1)[1], 102, 'bottom depth is packed for near-bottom feathering')
})

test('keeps land-sector alpha zero and only feathers the water boundary', () => {
  const parsed = parseAnalyse3DTlrd(fixture())
  const texture = decodeTlrdPolarVolume(parsed, {
    sourceLon: 116,
    sourceLat: 16,
    angleInterp: 2,
  })
  assert.equal(texture.textureFilter, 'linear', 'TLRD volume must request trilinear GPU sampling')
  assert.equal(texture.height, 5, 'closed theta texture includes a duplicate first-sector row')
  const alpha = (z, y, x) => texture.data[(((z * texture.height + y) * texture.width + x) * 4) + 3]
  assert.equal(alpha(0, 0, 0), 255, 'water-sector center remains fully visible')
  assert.ok(alpha(0, 1, 0) >= 127 && alpha(0, 1, 0) <= 128, 'coast boundary is feathered')
  assert.equal(alpha(0, 2, 0), 0, 'land-sector center remains fully hidden')
  assert.equal(alpha(0, 4, 0), 255, '0°/360° seam closes on the first water sector')
})

test('continuous bearing rows interpolate TL in intensity space and retain finite upper values', () => {
  const json = fixture()
  json.Data.Units[0].Response.altitudeList.pairedDataVS[1].y = [-50, -50]
  const parsed = parseAnalyse3DTlrd(json)
  const texture = decodeTlrdPolarVolume(parsed, {
    sourceLon: 116,
    sourceLat: 16,
    angleInterp: 2,
  })
  const offset = (((0 * texture.height + 1) * texture.width + 0) * 4)
  const expectedTl = interpolateTlIntensityDb(70, 90, 0.5)
  const decodedTl = texture.valueMin + (texture.data[offset] / 255) * (texture.valueMax - texture.valueMin)
  assert.ok(Math.abs(decodedTl - expectedTl) < 0.2, 'middle bearing uses intensity-domain interpolation')
  assert.equal(texture.hasBottomDepth, true)

  const noDataJson = fixture()
  noDataJson.Data.Units[0].Response.altitudeList.pairedDataVS[1].y = [-50, -50]
  noDataJson.Data.Units[0].Response.loadingTlv.profile.data[0][0] = 200
  const withNoData = decodeTlrdPolarVolume(parseAnalyse3DTlrd(noDataJson), {
    sourceLon: 116,
    sourceLat: 16,
    angleInterp: 2,
  })
  assert.equal(withNoData.data[0], 255, '200 is clamped to the texture upper end')
  assert.equal(withNoData.data[3], 255, '200 remains visible in continuous mode')
})

test('display validity excludes only non-finite values and the 9999 substrate sentinel', () => {
  assert.equal(isTlrdValidValue(200), true)
  assert.equal(isTlrdValidValue(9999), false)
  assert.equal(isTlrdValidValue(Number.NaN), false)
})

