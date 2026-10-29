import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { GeoVis: {} }

const { parseAnalyse3DTlrd, decodeTlrdPolarVolume } = await import('../src/sdk/ncTlrdParser.js')

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

