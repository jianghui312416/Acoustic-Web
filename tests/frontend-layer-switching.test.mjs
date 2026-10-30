import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('collapsed sidebar modules only highlight their expanded state and switches align right', async () => {
  const source = await readSource('../src/components/layout/AppSidebar.vue')
  assert.match(source, /:class="\{ active: isModuleExpanded\(moduleItem\.id\) \}"/)
  assert.match(source, /\.feature-switch \{[^}]*justify-content:\s*space-between/s)
  assert.match(source, /\.feature-switch \.switch-track \{[^}]*order:\s*2/s)
})

test('sidebar switches keep their focus box inside the visible row', async () => {
  const source = await readSource('../src/components/layout/AppSidebar.vue')
  assert.match(source, /\.feature-switch \{[^}]*position:\s*relative/s)
  assert.match(source, /\.feature-switch input \{[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%/s)
  assert.doesNotMatch(source, /\.feature-switch input \{[^}]*width:\s*1px[^}]*height:\s*1px/s)
})

test('application height chain can shrink without pushing the document', async () => {
  const shell = await readSource('../src/layouts/ApplicationShell.vue')
  const view = await readSource('../src/views/AcousticFieldView.vue')
  assert.match(shell, /\.application-shell \{[^}]*height:\s*100%[^}]*min-height:\s*0/s)
  assert.match(shell, /\.application-content \{[^}]*min-height:\s*0[^}]*height:\s*100%/s)
  assert.match(view, /\.tl-volume-root \{[^}]*height:\s*100%[^}]*min-height:\s*0/s)
  assert.doesNotMatch(view, /\.tl-volume-root \{[^}]*min-height:\s*560px/s)
})

test('volume visibility bypasses renderer display reconfiguration', async () => {
  const source = await readSource('../src/views/AcousticFieldView.vue')
  const toggle = source.match(/function toggleVolumeVisible\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(toggle, /applyVolumeVisible\(volumeVisible\.value\)/)
  assert.doesNotMatch(toggle, /syncSoundField/)
  assert.match(source, /watch\(\s*\(\) => volumeRenderingControls\.volumeVisible,[\s\S]*?applyVolumeVisible\(volumeVisible\.value\)/)
})

test('vertical loss layers stay mounted and use visibility switching', async () => {
  const source = await readSource('../src/views/AcousticFieldView.vue')
  assert.match(source, /<section v-show="viewMode === 'terrain' && terrainSliceOpen && !terrainSliceMinimized"/)
  assert.match(source, /watch\(\(\) => verticalSliceControls\.showSlice,[\s\S]*?applySliceCurtainVisibility\(\)/)
  assert.match(source, /function applySliceCurtainVisibility\(\)[\s\S]*?primitive\.show = visible/)
  assert.match(source, /primitive\.show = verticalSliceControls\.showSlice/)
  assert.doesNotMatch(source.match(/function applySliceCurtainVisibility\(\)[\s\S]*?\n\}/)?.[0] ?? '', /remove|destroy|startSliceRayAnimation|stopSliceRayAnimation/)
  assert.match(source, /textureFilter:\s*'linear'/)
})

test('disabled seabed mask replaces the lower region with the maximum dB color', async () => {
  const source = await readSource('../src/components/TransmissionLossProfileChart.vue')
  assert.match(source, /!props\.showSeabed \|\| !props\.showSeabedMask \? createSeabedFillSeries\(p\)/)
})

test('uncovered water below the TL grid is diagnosed and filled only in the display layer', async () => {
  const source = await readSource('../src/components/TransmissionLossProfileChart.vue')
  assert.match(source, /const hasUncoveredWater = Number\.isFinite\(seabedMax\) && seabedMax > tlDepthMax/)
  assert.match(source, /function createUncoveredWaterSeries\(profileData\)/)
  assert.match(source, /name: 'TL 未覆盖水层'/)
  assert.match(source, /原始 TL 数据未修改/)
})

test('TL pseudo-color uses a borderless bilinear display texture without changing source values', async () => {
  const source = await readSource('../src/components/TransmissionLossProfileChart.vue')
  assert.match(source, /imageSmoothingEnabled\s*=\s*true/)
  assert.match(source, /imageSmoothingQuality\s*=\s*'high'/)
  assert.match(source, /itemStyle:\s*\{ opacity: 0, borderWidth: 0, borderColor: 'transparent' \}/)
  assert.match(source, /sampleDisplayTlColor\(\(value - min\) \/ \(max - min\)/)
})

test('terrain volume uses connected top wall and seabed surfaces instead of horizontal slice stacking', async () => {
  const source = await readSource('../src/utils/terrainScene.js')
  assert.match(source, /const horizontalSpanM = Math\.max\(1, span \* 110574\)/)
  assert.match(source, /const z = elevation \/ horizontalSpanM \* verticalExaggeration/)
  assert.doesNotMatch(source, /projectVolume/)
  assert.match(source, /顶面：只绘制一个由共享顶点连接的 TL 表面/)
  assert.match(source, /外侧壁：相邻深度节点直接连接/)
  assert.match(source, /底面随每个角度\/距离列的最深有效 TL 层变化/)
  assert.match(source, /gradientPolygon\(ctx, face\.p, face\.colors, face\.alpha\)/)
  assert.doesNotMatch(source, /for \(let z = 0; z < row; z \+= depthStep\)/)
  assert.doesNotMatch(source, /tl < dbMin \|\| tl > dbMax/)
})

test('one exaggeration control drives terrain and sound-field depth without automatic overrides', async () => {
  const controls = await readSource('../src/modules/acoustic/volumeRenderingControls.js')
  const sidebar = await readSource('../src/components/layout/AppSidebar.vue')
  const view = await readSource('../src/views/AcousticFieldView.vue')
  assert.doesNotMatch(controls, /volumeVerticalExaggeration/)
  assert.match(sidebar, /visualControls\.terrainExaggeration/)
  assert.match(view, /volumeRenderingControls\.terrainExaggeration/)
  assert.doesNotMatch(view, /recommendedDepthExaggeration/)
})

test('terrain preview supports close-up zoom without rebuilding the scene', async () => {
  const source = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  assert.match(source, /const MAX_CAMERA_ZOOM = 14/)
  const wheel = source.match(/function onWheel\(event\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(wheel, /zoom: clamp\(nextZoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM\)/)
  assert.doesNotMatch(wheel, /loadTerrain|drawTerrainScene/)
})

test('a new 3d calculation archives the previous sound field as an independent layer', async () => {
  const source = await readSource('../src/views/AcousticFieldView.vue')
  assert.match(source, /function archiveCurrent3dRun\(\)/)
  assert.match(source, /renderer: soundField/)
  assert.match(source, /soundField = viewer \? new SoundField/)
  assert.match(source, /if \(analysisMode\.value === '3d'\) archiveCurrent3dRun\(\)/)
  assert.match(source, /\[\.\.\.runHistoryLayers\.value, \.\.\.jobLayers\.value\]/)
  assert.match(source, /function syncHistoricalSoundFields\(\)/)
})

test('drawing additional sound fields never auto-expands an already loaded terrain range', async () => {
  const view = await readSource('../src/views/AcousticFieldView.vue')
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  const submit = view.match(/function submitCalculation\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const openJob = view.match(/async function openWorkspaceJob\(jobId\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(view, /function fitVisibleSoundFields\(/)
  assert.doesNotMatch(submit, /fitVisibleSoundFields\(\)/)
  assert.doesNotMatch(openJob, /fitVisibleSoundFields\(\)/)
  assert.match(terrain, /if \(inside \|\| grid\.value\) scheduleDraw\(\)/)
})

test('bathymetry reads bounded subsets from the configured local GEBCO NetCDF', async () => {
  const config = await readSource('../vite.config.js')
  const bathymetry = await readSource('../src/utils/bathymetry.js')
  assert.match(config, /GEBCO_NC_PATH/)
  assert.match(config, /gebco_subset_server\.py/)
  assert.match(bathymetry, /\/api\/gebco/)
  assert.doesNotMatch(config, /elevation-tiles-prod|terrarium/i)
  assert.doesNotMatch(bathymetry, /elevation-tiles-prod|terrarium/i)
})
