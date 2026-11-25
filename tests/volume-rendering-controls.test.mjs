import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const {
  VOLUME_COLORMAPS,
  activeVolumeColorStops,
  clampVolumeRenderingControls,
  contrastedVolumeColorStops,
  opacityControlToAlphaScale,
  volumeRenderingControls,
} = await import('../src/modules/acoustic/volumeRenderingControls.js')
const {
  buildDetectionClassGradient,
  detectionClassColor,
} = await import('../src/utils/signalExcess.js')

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

test('contrast-adjusted legend uses the same normalized mapping as the volume shader', () => {
  const stops = [[0, [0, 0, 0]], [0.5, [100, 100, 100]], [1, [200, 200, 200]]]
  assert.deepEqual(contrastedVolumeColorStops(stops, 2), [
    [0, [0, 0, 0]],
    [0.25, [0, 0, 0]],
    [0.5, [100, 100, 100]],
    [0.75, [200, 200, 200]],
    [1, [200, 200, 200]],
  ])
  assert.deepEqual(contrastedVolumeColorStops(stops, 0.5), [
    [0, [50, 50, 50]],
    [0.5, [100, 100, 100]],
    [1, [150, 150, 150]],
  ])
})

test('three-color detection boundaries use exact Pd classes', () => {
  assert.equal(detectionClassColor(24.999), null)
  assert.deepEqual(detectionClassColor(25), [0, 0, 0])
  assert.deepEqual(detectionClassColor(49.999), [0, 0, 0])
  assert.deepEqual(detectionClassColor(50), [255, 255, 0])
  assert.deepEqual(detectionClassColor(75), [255, 255, 0])
  assert.deepEqual(detectionClassColor(75.001), [255, 0, 0])
  assert.match(buildDetectionClassGradient(0, 100, 'pd', 6), /transparent 25\.000%.*#000 50\.000%.*#ffff00 75\.000%.*#ff0000/)
})

test('volume menu values are clamped to safe rendering ranges', () => {
  const controls = {
    terrainExaggeration: 80,
    terrainBrightness: 10,
    opacity: -1,
    density: 20,
    contrast: 0,
    edgeSharpness: 20,
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
  assert.equal(controls.density, 8)
  assert.equal(controls.contrast, 0.5)
  assert.equal(controls.edgeSharpness, 4)
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

test('volume defaults use the clearer display preset', () => {
  assert.equal(volumeRenderingControls.density, 3)
  assert.equal(volumeRenderingControls.contrast, 2)
  assert.equal(volumeRenderingControls.dbMin, 60)
  assert.equal(volumeRenderingControls.dbMax, 120)
})

test('volume menu replaces ineffective sampling controls with density and contrast', async () => {
  const sidebar = await readFile(new URL('../src/components/layout/AppSidebar.vue', import.meta.url), 'utf8')
  assert.match(sidebar, /体密度/)
  assert.match(sidebar, /visualControls\.density/)
  assert.match(sidebar, /visualControls\.density[^\n]*max="8"/)
  assert.match(sidebar, /细节对比度/)
  assert.match(sidebar, /visualControls\.contrast/)
  assert.match(sidebar, /contrastedVolumeColorStops/)
  assert.match(sidebar, /边缘锐度/)
  assert.match(sidebar, /visualControls\.edgeSharpness/)
  assert.doesNotMatch(sidebar, /最大采样步长|透明度指数/)
})

test('signal excess and Pd legends follow the shared detail contrast', async () => {
  const [panel, profile, view] = await Promise.all([
    readFile(new URL('../src/components/acoustic/SignalExcessPanel.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/TransmissionLossProfileChart.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/AcousticFieldView.vue', import.meta.url), 'utf8'),
  ])
  assert.match(panel, /contrastedVolumeColorStops\(SIGNAL_EXCESS_COLOR_STOPS, volumeRenderingControls\.contrast\)/)
  assert.match(profile, /const seColorStops = computed\(\(\) => contrastedVolumeColorStops/)
  assert.match(profile, /return seActive\.value \? seColorStops\.value : tlColorStops\.value/)
  assert.match(view, /contrastedVolumeColorStops\(SIGNAL_EXCESS_COLOR_STOPS, volumeRenderingControls\.contrast\)/)
  assert.match(view, /displayMode === 'pd' \? '%' : 'dB'/)
})

test('Pd range is editable and three-color detection classes reach volume and profile', async () => {
  const [panel, state, terrain, profile] = await Promise.all([
    readFile(new URL('../src/components/acoustic/SignalExcessPanel.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/acoustic/signalExcessState.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/terrain/TerrainPreviewMode.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/TransmissionLossProfileChart.vue', import.meta.url), 'utf8'),
  ])
  assert.match(state, /pdMin: 0/)
  assert.match(state, /pdMax: 100/)
  assert.match(state, /threeColor: false/)
  assert.match(panel, /v-model\.number="rangeMin"/)
  assert.match(panel, /v-model\.number="rangeMax"/)
  assert.match(panel, /state\.threeColor = !state\.threeColor/)
  assert.match(terrain, /threeColor: signalExcessState\.threeColor === true/)
  assert.match(profile, /detectionClassColor\(probability\)/)
  assert.match(profile, /imageSmoothingEnabled = !threeColor/)
})
