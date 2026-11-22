import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const acousticView = await readFile(new URL('../src/views/AcousticFieldView.vue', import.meta.url), 'utf8')
const terrainView = await readFile(new URL('../src/components/terrain/TerrainPreviewMode.vue', import.meta.url), 'utf8')
const profileChart = await readFile(new URL('../src/components/TransmissionLossProfileChart.vue', import.meta.url), 'utf8')

test('main color controls write the shared volume rendering range', () => {
  const handler = acousticView.slice(
    acousticView.indexOf('function onColorRangeChange()'),
    acousticView.indexOf('function onDepthExagChange()'),
  )
  assert.match(handler, /volumeRenderingControls\.dbMin = lo/)
  assert.match(handler, /volumeRenderingControls\.dbMax = hi/)
})

test('terrain volume redraws whenever shared visual controls change', () => {
  assert.match(terrainView, /watch\(visualControls, \(\) => scheduleDraw\(\), \{ deep: true \}\)/)
  assert.match(terrainView, /\.\.\.visualControls/)
})

test('vertical profile shares and reacts to the volume color range', () => {
  assert.match(acousticView, /:db-min="profileDbRange\.min"\s+:db-max="profileDbRange\.max"/)
  assert.match(acousticView, /return \{ min: Number\(volumeRenderingControls\.dbMin\), max: Number\(volumeRenderingControls\.dbMax\) \}/)
  assert.match(profileChart, /const rangeKey = `\$\{modeKey\}:\$\{schemeKey\}:\$\{props\.dbMin\}:\$\{props\.dbMax\}`/)
  assert.match(profileChart, /props\.dbMin,[\s\S]*props\.dbMax,[\s\S]*\(\) => renderChart\(\)/)
  assert.match(profileChart, /sampleDisplayTlColor\(\(value - min\) \/ \(max - min\)\)/)
})
