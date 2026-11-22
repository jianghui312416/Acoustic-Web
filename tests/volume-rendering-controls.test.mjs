import test from 'node:test'
import assert from 'node:assert/strict'

const {
  VOLUME_COLORMAPS,
  activeVolumeColorStops,
  clampVolumeRenderingControls,
  opacityControlToAlphaScale,
  volumeRenderingControls,
} = await import('../src/modules/acoustic/volumeRenderingControls.js')

test('volume sampling is fixed to nearest-neighbour display mode', () => {
  assert.equal(volumeRenderingControls.strictNearest, true)
})

test('volume menu exposes translated color maps and returns isolated SDK stops', () => {
  assert.deepEqual(VOLUME_COLORMAPS.map((item) => item.label), [
    'custom', 'Viridis', 'Plasma', 'Magma', 'Inferno', 'Turbo', 'Cool', 'Warm', 'Jet', 'Jet（reversed）',
  ])
  const first = activeVolumeColorStops('viridis')
  first[0][1][0] = 255
  assert.notEqual(activeVolumeColorStops('viridis')[0][1][0], 255)
})

test('volume menu values are clamped to safe rendering ranges', () => {
  const controls = {
    terrainExaggeration: 80,
    terrainBrightness: 10,
    opacity: -1,
    sampling: 2,
    alphaPower: 0,
    dbMin: 199,
    dbMax: 20,
    rotationX: 500,
    rotationY: -10,
    rotationZ: 5,
    moveX: 200000,
    moveY: -200000,
    moveZ: 10,
  }
  clampVolumeRenderingControls(controls)
  assert.equal(controls.terrainExaggeration, 50)
  assert.equal(controls.terrainBrightness, 4)
  assert.equal(controls.opacity, 0)
  assert.equal(controls.sampling, 0.03)
  assert.equal(controls.alphaPower, 0.35)
  assert.equal(controls.dbMin, 199)
  assert.equal(controls.dbMax, 200)
  assert.equal(controls.rotationX, 359)
  assert.equal(controls.rotationY, 0)
  assert.equal(controls.moveX, 100000)
  assert.equal(controls.moveY, -100000)
  assert.equal(controls.strictNearest, true)
})

test('opacity control has exact zero-to-one semantics', () => {
  assert.equal(opacityControlToAlphaScale(-1), 0)
  assert.equal(opacityControlToAlphaScale(0), 0)
  assert.equal(opacityControlToAlphaScale(0.45), 0.45)
  assert.equal(opacityControlToAlphaScale(1), 1)
  assert.equal(opacityControlToAlphaScale(5), 1)
})
