import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/views/AcousticFieldView.vue', import.meta.url), 'utf8')
const runPanel = await readFile(new URL('../src/components/terrain/AcousticRunPanel.vue', import.meta.url), 'utf8')

test('terrain slice and SSP windows expose minimize controls and an ordered restore dock', () => {
  assert.match(source, /垂直切面 · \{\{ terrainSliceAngleLabel \}\}/)
  assert.match(source, /minimizeTerrainWindow\('slice'\)/)
  assert.match(source, /minimizeTerrainWindow\('profile'\)/)
  assert.match(source, /v-for="windowId in minimizedTerrainWindows"/)
  assert.match(source, /terrainWindowDockOrder\.value = \[\.\.\.terrainWindowDockOrder\.value\.filter\(\(item\) => item !== id\), id\]/)
})

test('restoring removes a window from the dock and keeps the chart mounted', () => {
  assert.match(source, /removeTerrainWindowFromDock\(id\)/)
  assert.match(source, /terrainLossChartRef\.value\?\.refreshLayout\?\.\(\)/)
  assert.match(source, /v-show="viewMode === 'terrain' && terrainSliceOpen && !terrainSliceMinimized"/)
  assert.match(source, /v-show="viewMode === 'terrain' && terrainProfileOpen && !terrainProfileMinimized"/)
})

test('terrain sound field panel closes its own 3D and 2D result without hiding archived fields', () => {
  assert.match(runPanel, /关闭二维和三维声场/)
  assert.match(runPanel, /\['run','slice','settings','minimize','restore','close'\]/)
  assert.match(source, /@close="closeTerrainRun"/)
  const handler = source.match(/function closeTerrainRun\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(handler, /terrainRunVisible\.value = false/)
  assert.match(handler, /terrainSliceOpen\.value = false/)
  assert.match(handler, /omni2dVisible\.value = false/)
  assert.match(handler, /volumeData\.value = null/)
  assert.match(handler, /raySourceData\.value = null/)
  assert.match(handler, /soundField\?\.destroy/)
  assert.doesNotMatch(handler, /applyVolumeVisible\(false\)/)
})

test('each archived sound field keeps an independent status panel until that panel is closed', () => {
  assert.match(source, /v-for="layer in visibleRunHistoryPanels"/)
  assert.match(source, /panelVisible: true/)
  assert.match(source, /panelMinimized: terrainRunMinimized\.value/)
  assert.match(source, /time: terrainRunTime\.value/)
  assert.match(source, /@close="closeRunHistoryLayer\(layer\.id\)"/)
  assert.doesNotMatch(source, /while \(next\.length > 8\)/)
  const closeHistory = source.match(/function closeRunHistoryLayer\(id\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(closeHistory, /runHistoryLayers\.value = runHistoryLayers\.value\.filter/)
  assert.match(closeHistory, /layer\.renderer\?\.destroy/)
})

test('multiple minimized sound field panels keep their minimize order in the top dock', () => {
  assert.match(source, /const runPanelDockOrder = ref\(\[\]\)/)
  assert.match(source, /appendRunPanelToDock\(CURRENT_RUN_PANEL_ID\)/)
  assert.match(source, /runPanelDockOrder\.value\.map\(item => item === CURRENT_RUN_PANEL_ID \? id : item\)/)
  assert.match(runPanel, /dockIndex/)
  assert.match(runPanel, /dockCount/)
})
