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

test('weather forecast requests are gated by terrain mode and volume tools require a loaded terrain field', async () => {
  const sidebar = await readSource('../src/components/layout/AppSidebar.vue')
  const weather = await readSource('../src/components/weather/WeatherNoiseSidebar.vue')
  const view = await readSource('../src/views/AcousticFieldView.vue')
  assert.match(sidebar, /weatherNoiseOpen && viewMode === 'terrain'/)
  assert.match(sidebar, /进入地形模式（M）加载场景的预报/)
  assert.match(sidebar, /props\.viewMode === 'terrain' && acousticSceneState\.hasTerrainVolume/)
  assert.match(weather, /onMounted\(async \(\) => \{[\s\S]*?loadWeatherNoiseForecast\(\)/)
  assert.match(view, /acousticSceneState\.hasTerrainVolume = value/)
  assert.ok(
    view.indexOf('const volumeData = ref(null)') < view.indexOf('watch(hasTerrainVolume'),
    '声场可用状态的立即监听必须在 volumeData 初始化之后启动'
  )
  assert.ok(
    view.indexOf('const raySourceData = shallowRef(null)') < view.indexOf('watch(hasTerrainVolume'),
    '声场可用状态的立即监听必须在 raySourceData 初始化之后启动'
  )
})

test('AN trend uses selected-band total noise for all 48 frames', async () => {
  const sidebar = await readSource('../src/components/weather/WeatherNoiseSidebar.vue')
  const store = await readSource('../src/modules/weather/weatherNoiseStore.js')
  assert.match(store, /export const weatherNoiseBandTrend = computed/)
  assert.match(store, /frames\.map\(frame =>/)
  assert.match(store, /bandNoiseMetricsDb\(frequency, total, band\.low_hz, band\.high_hz\)\.bandLevelDb/)
  assert.match(sidebar, /AN \{\{ num\(noiseTrendMin, 1\) \}\}–\{\{ num\(noiseTrendMax, 1\) \}\} dB · 48小时预报/)
  assert.match(sidebar, /:points="noiseTrendPoints"/)
  assert.match(sidebar, /:points="activeNoiseTrendPoints"/)
  assert.match(sidebar, /slice\(0, state\.frameIndex \+ 1\)/)
  assert.match(sidebar, /class="trend-level"[\s\S]*:y1="cursorY"[\s\S]*:y2="cursorY"/)
  assert.doesNotMatch(sidebar, /windPoints/)
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

test('terrain vertical slice enables receiver picking only for static signal placement', async () => {
  const view = await readSource('../src/views/AcousticFieldView.vue')
  const chart = await readSource('../src/components/TransmissionLossProfileChart.vue')
  assert.match(view, /:receiver-interactive="sliceReceiverPlacementActive"/)
  assert.match(view, /:receiver-placement-enabled="sliceReceiverPlacementActive"/)
  assert.match(view, /@select-receiver="onSignalSliceReceiverSelected"/)
  assert.match(view, /const sliceReceiverPlacementActive = computed\(\(\) => Boolean\([\s\S]*?staticSignalChannelReady\.value && signalTransmissionControls\.sliceReceiverPlacement/)
  assert.match(view, /watch\(sliceReceiverPlacementActive,[\s\S]*?verticalSliceControls\.showSlice = true/)
  assert.match(view, /signalTransmissionControls\.receiverDepthM = receiver\.depthM/)
  assert.match(view, /destinationLonLat\(sourceLon, sourceLat, bearingDeg, rangeM\)/)
  assert.match(view, /const receiver = receiverArrayMarker\.value[\s\S]*?receiver_lon: receiverLon[\s\S]*?receiver_depth_m: receiverDepth/)
  assert.match(chart, /class="rp-readout-marker rp-receiver-reference"/)
  assert.match(chart, /v-if="receiverHandlePos && receiverInteractive"[\s\S]*?class="rp-receiver-handle"/)
  assert.match(chart, /class="rp-readout-cross" aria-hidden="true"/)
  assert.doesNotMatch(chart, /name:\s*'接收水听器'/)
})

test('terrain receiver marker uses a slow water ripple and locator pin', async () => {
  const scene = await readSource('../src/utils/terrainScene.js')
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  assert.match(scene, /ctx\.ellipse\(p\.x, p\.y, radius, Math\.max\(2\.5, radius \* 0\.42\)/)
  assert.match(scene, /const pulse = \(nowMs % 4200\) \/ 4200/)
  assert.match(scene, /const pinCenterY = p\.y - 12/)
  assert.match(scene, /ctx\.bezierCurveTo\(p\.x - 2, p\.y - 4/)
  assert.match(terrain, /function receiverAnimating\(\)/)
  assert.match(terrain, /weatherOn \|\| receiverOn/)
})

test('disabled seabed mask replaces the lower region with the maximum dB color', async () => {
  const source = await readSource('../src/components/TransmissionLossProfileChart.vue')
  assert.match(source, /!props\.showSeabed \|\| !props\.showSeabedMask \? createSeabedFillSeries\(p\)/)
})

test('seabed profile keeps fractional physical depth and all range samples', async () => {
  const source = await readSource('../src/components/TransmissionLossProfileChart.vue')
  assert.match(source, /fractionalAxisIndex\(axisDepths, depthM\)/)
  assert.doesNotMatch(source, /nearestIndex\(axisDepths, depthM\)/)
  assert.doesNotMatch(source, /Math\.ceil\(\(end - start\) \/ (?:36|48)\)/)
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
  assert.match(source, /外侧壁：从海面一直连到该方位的真实海底深度/)
  assert.match(source, /底面：直接铺在真实海底高程上/)
  assert.match(source, /elevationAtLonLat/)
  assert.match(source, /terrainWaterDepthAt/)
  assert.match(source, /const radialStep = fullResolution \? 1 :/)
  assert.match(source, /const depthStep = fullResolution \? 1 :/)
  const preview = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  assert.match(preview, /fullResolution: true/)
  assert.match(source, /gradientPolygon\(ctx, face\.p, face\.colors, face\.alpha\)/)
  const volumePolygon = source.match(/function gradientPolygon\([\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(volumePolygon, /ctx\.strokeStyle = gradient/)
  assert.match(source, /interpolateTlDbByIntensity/)
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
  assert.match(source, /const terrainJobFields = computed\(\(\) => runHistoryLayers\.value\.map/)
  assert.match(source, /runHistoryLayers\.value = \[\.\.\.runHistoryLayers\.value, layer\]/)
  assert.match(source, /function syncHistoricalSoundFields\(\)/)
})

test('recomputation keeps the original field active and history fields GPU-rendered', async () => {
  const source = await readSource('../src/views/AcousticFieldView.vue')
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  // 归档声场保留 GPU 纹理；历史图层列表把纹理传给地形 WebGL。
  assert.match(source, /texture: currentVolumeTexture \|\| null/)
  assert.match(source, /texture: layer\.texture \|\| null/)
  // 再次计算后未选中其它声场时，活动声场保持为刚归档的原声场。
  assert.match(source, /if \(!selectedProfileLayerId\.value\) \{\s*selectedProfileLayerId\.value = id/)
  // 当前面板的二维切面按钮在查看其它声场时切到当前声场并打开。
  assert.match(source, /const alreadyCurrent = !selectedProfileLayerId\.value/)
  // 地形 GPU 渲染接收当前 + 历史多体，并跳过已由 GPU 绘制的 Canvas 面片。
  assert.match(terrain, /const gpuVolumes = \[\]/)
  assert.match(terrain, /skipLayerIds: gpuLayerIds\.filter/)
})

test('signal excess renders through the terrain GPU volume pass', async () => {
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  const view = await readSource('../src/views/AcousticFieldView.vue')
  const shader = await readSource('../src/utils/terrainWebGL.js')
  assert.match(view, /:signal-excess-params="signalExcessParams"/)
  assert.match(terrain, /signalExcessParams: \{ type: Object, default: null \}/)
  // 信号余量不再被排除在 GPU 体渲染之外。
  assert.match(terrain, /const volume = props\.field && props\.texture\?\.data \? props\.texture : null/)
  assert.doesNotMatch(terrain, /if \(layer\.field\?\.signalExcess\) continue/)
  assert.match(terrain, /controls\.signalExcess = \{/)
  // 着色器由 TL 体按 SE/Pd 变换。
  assert.match(shader, /uniform vec4 uExcess/)
  assert.match(shader, /float se = uExcess\.y - tl/)
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

test('bathymetry supports local GEBCO and switchable online tiles', async () => {
  const config = await readSource('../vite.config.js')
  const bathymetry = await readSource('../src/utils/bathymetry.js')
  const source = await readSource('../src/modules/terrain/bathymetrySource.js')
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  assert.match(config, /GEBCO_NC_PATH/)
  assert.match(config, /gebco_subset_server\.py/)
  assert.match(config, /elevation-tiles-prod\/terrarium/)
  assert.match(bathymetry, /\/api\/gebco/)
  assert.match(bathymetry, /Terrarium/)
  assert.match(bathymetry, /BATHYMETRY_SOURCES/)
  assert.match(source, /source: initialSource\(\)/)
  assert.match(terrain, /switchBathymetrySource/)
})
