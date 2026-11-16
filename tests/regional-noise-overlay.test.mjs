import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  drawWeatherOverlay, oceanCurrentRegional, OCEAN_CURRENT_OVERLAY_FIELD,
  WEATHER_OVERLAY_FIELDS,
} from '../src/utils/weatherOverlay.js'

const readSource = path => readFile(new URL(path, import.meta.url), 'utf8')

test('regional forecast noise follows the selected band and forecast frame', async () => {
  const api = await readSource('../src/api/soundFieldApi.js')
  const store = await readSource('../src/modules/weather/weatherNoiseStore.js')
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  const sidebar = await readSource('../src/components/weather/WeatherNoiseSidebar.vue')
  const overlay = await readSource('../src/utils/weatherOverlay.js')

  assert.match(api, /directEndpoint\('AnalyseRegionalForecastEnvironmentNoise'\)/)
  assert.match(store, /forecastTime,\s*minFreq: band\.low_hz,\s*maxFreq: band\.high_hz/s)
  assert.match(terrain, /weatherNoiseState\.frameIndex,\s*weatherNoiseState\.selectedBandId/s)
  assert.match(terrain, /drawRegionalNoiseOverlay\(canvasEl\.value, lastScene, grid\.value/)
  assert.match(terrain, /queueRegionalWeatherLoad\(\)/)
  assert.match(terrain, /queueRegionalNoiseLoad\(\)/)
  assert.match(terrain, /setTimeout\(\(\) => \{[\s\S]*?loadRegionalWeatherForecast\(\)/)
  assert.match(terrain, /setTimeout\(\(\) => \{[\s\S]*?loadRegionalNoiseForecast\(\)/)
  assert.match(overlay, /function nearestAxisIndex\(axis, target\)/)
  assert.match(overlay, /function axisCellEdges\(axis\)/)
  assert.match(overlay, /每个0\.25°原生网格单元使用一个固定值和固定颜色，不做插值/)
  assert.doesNotMatch(overlay, /function gridIndices\(/)
  assert.doesNotMatch(overlay, /双向线性插值标量场/)
  assert.match(sidebar, /<span>区域预报噪声<\/span>/)
  assert.ok(
    sidebar.indexOf('<span>区域预报噪声</span>') < sidebar.indexOf('<span>风\/雨\/海况覆盖层</span>'),
    '区域预报噪声开关应位于风/雨/海况覆盖层上方'
  )
})

test('weather overlay paints one constant block per native grid cell without interpolation', () => {
  const fills = []
  let strokes = 0
  let path = []
  const context = {
    setTransform() {},
    beginPath() { path = [] },
    moveTo(x, y) { path.push([x, y]) },
    lineTo(x, y) { path.push([x, y]) },
    closePath() {},
    fill() { fills.push({ path: [...path], color: this.fillStyle }) },
    stroke() { strokes += 1 },
  }
  const canvas = {
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 100, height: 100 }),
  }
  const scene = { project: (lon, lat) => ({ x: lon * 100, y: lat * 100 }) }
  const grid = { bounds: { west: -0.125, east: 0.375, south: -0.125, north: 0.375 } }
  const regional = {
    grid: { longitudes: [0, 0.25], latitudes: [0.25, 0] },
    data: {
      wind_speed_mps: [[1, 2], [3, 4]],
      wind_direction_deg: [[0, 90], [180, 270]],
    },
  }

  drawWeatherOverlay(canvas, scene, grid, WEATHER_OVERLAY_FIELDS.wind, regional, false, 0)

  assert.equal(fills.length, 4)
  assert.equal(strokes, 0)
  assert.equal(new Set(fills.map(fill => fill.color)).size, 4)
  assert.ok(fills.every(fill => fill.path.length === 4))
})

test('HYCOM current supports all-depth vector mean and an individual depth layer', () => {
  const current = {
    grid: { longitudes: [115, 115.08], latitudes: [16.08, 16] },
    depths_m: [0, 10],
    data: {
      u_mps: [[[1, 0], [0, -1]], [[0, 1], [-1, 0]]],
      v_mps: [[[0, 1], [-1, 0]], [[1, 0], [0, -1]]],
      depth_mean_u_mps: [[0.5, 0.5], [-0.5, -0.5]],
      depth_mean_v_mps: [[0.5, 0.5], [-0.5, -0.5]],
    },
  }
  const all = oceanCurrentRegional(current, 'all')
  const depth10 = oceanCurrentRegional(current, '10')
  assert.equal(all.data.current_speed_mps[0][0], Math.hypot(0.5, 0.5))
  assert.equal(all.data.current_direction_deg[0][0], 45)
  assert.equal(depth10.data.current_speed_mps[0][0], 1)
  assert.equal(depth10.data.current_direction_deg[0][0], 0)
  assert.equal(OCEAN_CURRENT_OVERLAY_FIELD.regionValue, 'current_speed_mps')
})

test('HYCOM current switch, depth menu and forecast-frame refresh are wired above weather overlay', async () => {
  const sidebar = await readSource('../src/components/weather/WeatherNoiseSidebar.vue')
  const store = await readSource('../src/modules/weather/weatherNoiseStore.js')
  const terrain = await readSource('../src/components/terrain/TerrainPreviewMode.vue')
  const api = await readSource('../src/api/soundFieldApi.js')
  const overlay = await readSource('../src/utils/weatherOverlay.js')
  assert.match(api, /directEndpoint\('GetRegionalOceanCurrent'\)/)
  assert.match(sidebar, /<span>海流<\/span>/)
  assert.match(sidebar, /<option value="all">全深度<\/option>/)
  assert.match(sidebar, /v-model="state\.oceanCurrentDynamic"/)
  assert.ok(
    sidebar.indexOf('<span>海流</span>') < sidebar.indexOf('<span>风\/雨\/海况覆盖层</span>')
  )
  assert.match(store, /forecastTime,\s*\}\)/)
  assert.match(terrain, /weatherNoiseState\.oceanCurrentOverlay,\s*weatherNoiseState\.frameIndex/s)
  assert.match(terrain, /OCEAN_CURRENT_OVERLAY_FIELD[\s\S]*?weatherNoiseState\.oceanCurrentDynamic/)
  assert.match(terrain, /oceanCurrentDynamic\(\)[\s\S]*?terrainAnimating\(\)/)
  assert.match(overlay, /OCEAN_CURRENT_TIME_WARP = 60000/)
  assert.match(overlay, /field\.key === 'ocean-current' \? OCEAN_CURRENT_TIME_WARP/)
})

