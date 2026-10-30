import { computed, reactive } from 'vue'
import { analyseForecastEnvironmentNoise, getRealtimeAis } from '@/api/soundFieldApi.js'
import {
  bandNoiseMetricsDb,
  clampFrameIndex, clampShippingActivity, coatesStojanovicShippingCurve,
  powerSumCurvesDb, spectrumValueAt,
} from '@/utils/weatherNoiseForecast.js'

export const DEFAULT_NOISE_BANDS = Object.freeze([
  Object.freeze({ id: '100hz-10khz', label: '100 Hz–10 kHz', low_hz: 100, high_hz: 10000 }),
  Object.freeze({ id: '1khz-10khz', label: '1–10 kHz', low_hz: 1000, high_hz: 10000 }),
  Object.freeze({ id: '10hz-100hz', label: '10–100 Hz', low_hz: 10, high_hz: 100 }),
  Object.freeze({ id: '50hz-1khz', label: '50 Hz–1 kHz', low_hz: 50, high_hz: 1000 }),
])

export const weatherNoiseState = reactive({
  point: { lon: 116, lat: 16, elevation: null },
  frameIndex: 0,
  result: null,
  ais: null,
  loading: false,
  error: '',
  hoverSampling: true,
  terrainOverlay: false,
  overlayField: 'wind',
  selectedBandId: DEFAULT_NOISE_BANDS[0].id,
  shippingActivity: 0.5,
  loadedPointKey: '',
  terrainCenter: { lon: 116, lat: 16 },
})

/** 环境噪声探针小窗：open 是否显示，picking 是否处于「在地图上选择」选点模式。 */
export const noiseProbeState = reactive({
  open: false,
  picking: false,
})

let requestGeneration = 0
let activePromise = null

export const currentWeatherNoiseFrame = computed(() => {
  const frames = weatherNoiseState.result?.frames || []
  return frames[clampFrameIndex(weatherNoiseState.frameIndex, frames.length)] || null
})

export const activeShippingActivity = computed(() =>
  clampShippingActivity(weatherNoiseState.shippingActivity)
)

export const weatherNoiseBands = computed(() => {
  const responseBands = weatherNoiseState.result?.spectrum?.band_presets
  return Array.isArray(responseBands) && responseBands.length ? responseBands : DEFAULT_NOISE_BANDS
})

export const activeWeatherNoiseBand = computed(() => {
  const bands = weatherNoiseBands.value
  return bands.find(band => band.id === weatherNoiseState.selectedBandId) || bands[0] || DEFAULT_NOISE_BANDS[0]
})

export const currentWeatherNoiseCurves = computed(() => {
  const result = weatherNoiseState.result
  const frame = currentWeatherNoiseFrame.value
  if (!result || !frame) return { shipping: [], total: [] }
  const fixed = result.fixed_components_db || {}
  const varying = frame.varying_components_db || {}
  const shipping = coatesStojanovicShippingCurve(
    result.frequency_hz,
    activeShippingActivity.value
  )
  return {
    shipping,
    wind: varying.wind || [],
    rain: varying.rain || [],
    turbulence: fixed.turbulence || [],
    thermal: fixed.thermal || [],
    total: powerSumCurvesDb([
      fixed.turbulence, shipping, fixed.thermal, varying.wind, varying.rain,
    ]),
  }
})

/** 所选频带在全部预报帧上的总噪声级，用于时间滑杆下方的 AN 趋势图。 */
export const weatherNoiseBandTrend = computed(() => {
  const result = weatherNoiseState.result
  const frames = result?.frames || []
  const frequency = result?.frequency_hz || []
  if (!frames.length || !frequency.length) return []
  const fixed = result.fixed_components_db || {}
  const shipping = coatesStojanovicShippingCurve(frequency, activeShippingActivity.value)
  const band = activeWeatherNoiseBand.value
  return frames.map(frame => {
    const varying = frame?.varying_components_db || {}
    const total = powerSumCurvesDb([
      fixed.turbulence, shipping, fixed.thermal, varying.wind, varying.rain,
    ])
    return bandNoiseMetricsDb(frequency, total, band.low_hz, band.high_hz).bandLevelDb
  })
})

export const forecastNoiseSummary = computed(() => {
  const result = weatherNoiseState.result
  const frame = currentWeatherNoiseFrame.value
  if (!result || !frame) return null
  const curves = currentWeatherNoiseCurves.value
  const total = curves.total
  const frequency = result.frequency_hz || []
  const band = activeWeatherNoiseBand.value
  const metrics = bandNoiseMetricsDb(frequency, total, band.low_hz, band.high_hz)
  const componentBandDb = Object.fromEntries(
    ['wind', 'rain', 'shipping', 'turbulence', 'thermal'].map(name => [
      name,
      bandNoiseMetricsDb(frequency, curves[name], band.low_hz, band.high_hz).bandLevelDb,
    ])
  )
  return {
    band,
    ...metrics,
    componentBandDb,
    // 兼容仍在读取旧字段的外部组件；新界面使用 bandLevelDb。
    meanBandDb: metrics.meanPsdDb,
    total1kDb: spectrumValueAt(frequency, total, 1000),
    wind1kDb: spectrumValueAt(frequency, curves.wind, 1000),
    rain1kDb: spectrumValueAt(frequency, curves.rain, 1000),
    shipping1kDb: spectrumValueAt(frequency, curves.shipping, 1000),
    turbulence1kDb: spectrumValueAt(frequency, result.fixed_components_db?.turbulence, 1000),
    thermal1kDb: spectrumValueAt(frequency, result.fixed_components_db?.thermal, 1000),
  }
})

export function selectWeatherNoiseBand(id) {
  if (weatherNoiseBands.value.some(band => band.id === id)) weatherNoiseState.selectedBandId = id
}

function pointKey(point) {
  return `${Number(point.lon).toFixed(4)},${Number(point.lat).toFixed(4)}`
}

export function setWeatherNoiseFrame(index) {
  weatherNoiseState.frameIndex = clampFrameIndex(index, weatherNoiseState.result?.frames?.length || 48)
}

export function setTerrainCenter(center) {
  const lon = Number(center?.lon)
  const lat = Number(center?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  weatherNoiseState.terrainCenter = { lon, lat }
}

export function centerWeatherNoiseToScene() {
  const center = weatherNoiseState.terrainCenter
  if (!center || !Number.isFinite(center.lon) || !Number.isFinite(center.lat)) return
  setWeatherNoisePoint({ lon: center.lon, lat: center.lat })
}

export function openNoiseProbe(options = {}) {
  noiseProbeState.open = true
  noiseProbeState.picking = Boolean(options.picking)
}

export function closeNoiseProbe() {
  noiseProbeState.open = false
  noiseProbeState.picking = false
}

export function setNoiseProbePicking(picking) {
  noiseProbeState.picking = Boolean(picking)
}

export function setWeatherNoisePoint(point, options = {}) {
  const lon = Number(point?.lon ?? point?.longitude)
  const lat = Number(point?.lat ?? point?.latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return Promise.resolve(null)
  const next = { lon, lat, elevation: Number.isFinite(Number(point?.elevation)) ? Number(point.elevation) : null }
  const changed = pointKey(next) !== pointKey(weatherNoiseState.point)
  weatherNoiseState.point = next
  if (!changed && weatherNoiseState.result && !options.force) return Promise.resolve(weatherNoiseState.result)
  return options.load === false ? Promise.resolve(null) : loadWeatherNoiseForecast({ force: changed || options.force })
}

export async function loadWeatherNoiseForecast(options = {}) {
  const key = pointKey(weatherNoiseState.point)
  if (!options.force && weatherNoiseState.result && weatherNoiseState.loadedPointKey === key) return weatherNoiseState.result
  if (!options.force && activePromise) return activePromise
  const generation = ++requestGeneration
  weatherNoiseState.loading = true
  weatherNoiseState.error = ''
  activePromise = (async () => {
    try {
      // 前端直接 GET 全球 AIS；快照在当前会话中固定，拖动 48 小时滑杆不会重复采集。
      const ais = weatherNoiseState.ais || await getRealtimeAis({ durationSeconds: 5, maxVessels: 5000 })
      if (generation !== requestGeneration) return null
      weatherNoiseState.ais = ais
      const result = await analyseForecastEnvironmentNoise({
        coordX: weatherNoiseState.point.lon,
        coordY: weatherNoiseState.point.lat,
        forecastHours: 48,
        minFreq: 10,
        maxFreq: 100000,
        numPoints: 512,
        ais,
      })
      if (generation !== requestGeneration) return null
      weatherNoiseState.result = result
      weatherNoiseState.shippingActivity = clampShippingActivity(
        result.fixed_ais?.shipping_activity
      )
      weatherNoiseState.loadedPointKey = key
      setWeatherNoiseFrame(weatherNoiseState.frameIndex)
      return result
    } catch (error) {
      if (generation === requestGeneration) weatherNoiseState.error = error?.message || String(error)
      return null
    } finally {
      if (generation === requestGeneration) weatherNoiseState.loading = false
      activePromise = null
    }
  })()
  return activePromise
}

export function refreshWeatherNoiseForecast() {
  weatherNoiseState.ais = null
  return loadWeatherNoiseForecast({ force: true })
}
