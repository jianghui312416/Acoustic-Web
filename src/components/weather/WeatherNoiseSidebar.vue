<template>
  <div class="wn-panel" @click.stop>
    <div class="provider-row">
      <!-- <span class="provider">WeatherNext 2（Open-Meteo）</span>
      <span>{{ result?.forecast?.ensemble_members ?? '—' }} 名成员</span> -->
      <button type="button" :disabled="state.loading" title="重新采集 AIS 与天气" @click="refresh">
        <svg v-if="state.loading" class="wait-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v2.1c0 2.7-1.6 3.9-5 5.9-3.4-2-5-3.2-5-5.9V4Z" fill="#e0b96b"/><path d="M7 20h10v-2.1c0-2.7-1.6-3.9-5-5.9-3.4 2-5 3.2-5 5.9V20Z" fill="#7fa9c4"/><path d="M7 4h10M7 20h10" fill="none" stroke="#5b8fa8" stroke-width="1.2" stroke-linecap="round"/></svg>
        <svg v-else class="refresh-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 6.34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <p class="grid-point">网格 {{ coord(result?.forecast?.grid_lat ?? state.point.lat) }}°，{{ coord(result?.forecast?.grid_lon ?? state.point.lon) }}°</p>

    <p class="section-label">预报位置</p>
    <p class="selected-point"><b>{{ coord(state.point.lat) }}°，{{ coord(state.point.lon) }}°</b><span>{{ state.point.elevation == null ? '地图选点' : state.point.elevation < 0 ? '海床' : '陆地' }}</span></p>
    <div class="point-actions">
      <button type="button" @click="centerToScene">◉ 场景中心</button>
      <button type="button" @click="pickOnMap">📍 在地图上选择</button>
    </div>
    <label class="toggle-row"><span>点选位置采样</span><input v-model="state.hoverSampling" type="checkbox"><i></i></label>

    <div v-if="state.error" class="error-message">{{ state.error }}<button type="button" @click="refresh">重试</button></div>

    <template v-if="frame">
      <div class="forecast-head"><span>预报时间</span><b>{{ formatForecastTime(frame.time) }} · +{{ frame.index }} 小时</b></div>
      <input class="time-slider" type="range" min="0" :max="Math.max(0, (result?.frames?.length || 1) - 1)" step="1" :value="state.frameIndex" aria-label="天气预报小时" @input="setWeatherNoiseFrame($event.target.value)">
      <svg class="weather-spark" viewBox="0 0 248 43" :aria-label="`${summary?.band?.label || ''} 48小时环境噪声趋势`">
        <path d="M0 40H248" />
        <polyline class="trend-context" :points="noiseTrendPoints" />
        <polyline class="trend-active" :points="activeNoiseTrendPoints" />
        <line class="trend-level" x1="0" :y1="cursorY" x2="248" :y2="cursorY" />
        <line :x1="cursorX" y1="1" :x2="cursorX" y2="42" />
        <circle :cx="cursorX" :cy="cursorY" r="3" />
      </svg>
      <div class="forecast-range"><span>AN {{ num(noiseTrendMin, 1) }}–{{ num(noiseTrendMax, 1) }} dB · 48小时预报</span><span>当前 {{ num(noiseTrendCurrent, 1) }} dB</span></div>

      <div class="weather-grid">
        <article><small>风速 10 米</small><strong>{{ num(weather.wind10_mps, 1) }}<em>m/s</em></strong><p>{{ directionLabel(weather.wind_direction_deg) }} · {{ num(weather.wind_direction_deg, 0) }}° </p></article>
        <article><small>降雨量</small><strong>{{ num(weather.precipitation_mmh, 2) }}<em>mm/h</em></strong><p>连续雨强直接驱动雨噪声曲线</p></article>
        <article><small>海况</small><strong>{{ num(weather.wave_hs_m, 2) }}<em>m Hs</em></strong><p>周期 {{ num(weather.wave_period_s, 1) }} s · 浪向 {{ num(weather.wave_direction_deg, 0) }}°</p></article>
        <article><small>海表</small><strong>{{ num(weather.mslp_hpa, 0) }}<em>hPa</em></strong><p>SST {{ num(weather.sst_c, 1) }} ℃ · 涌浪 {{ num(weather.swell_hs_m, 2) }} m</p></article>
      </div>

      <div class="noise-title"><span>环境噪声（WENZ）</span><b>{{ summary?.band?.label }}</b></div>
      <article class="noise-summary">
        <div><strong>{{ num(summary?.bandLevelDb, 1) }}</strong><span>dB re 1 μPa² · 频带噪声级</span></div>
        <small>= 平均 {{ num(summary?.meanPsdDb, 1) }} dB/Hz（图中点线）+ {{ num(summary?.bandwidthCorrectionDb, 1) }} dB（{{ formatHz(summary?.bandwidthHz) }} 带宽）</small>
        <div class="component-values" aria-label="当前频带各噪声分量">
          <span class="wind">风噪声 {{ num(summary?.componentBandDb?.wind, 0) }}</span>
          <span class="rain">降雨噪声 {{ num(summary?.componentBandDb?.rain, 0) }}</span>
          <span class="shipping">船舶噪声 {{ num(summary?.componentBandDb?.shipping, 0) }}</span>
          <span class="turbulence">湍流噪声 {{ num(summary?.componentBandDb?.turbulence, 0) }}</span>
          <span class="thermal">热噪声 {{ num(summary?.componentBandDb?.thermal, 0) }}</span>
        </div>
      </article>
      <div class="noise-band-switch" aria-label="环境噪声频带">
        <button v-for="band in bands" :key="band.id" type="button"
          :class="{ active: band.id === state.selectedBandId }"
          :aria-pressed="band.id === state.selectedBandId"
          @click="selectWeatherNoiseBand(band.id)">{{ band.label }}</button>
      </div>
      <NoiseSpectrumMiniChart />
      <p class="chart-note">{{ shippingText }}；切换频带会同步更新数值、选区和均值点线。</p>
      <label class="shipping-level"><span>远距离航运活动度 s · AIS 初值 {{ formatActivity(result?.fixed_ais?.shipping_activity) }}</span><b>{{ formatActivity(activeShippingActivity) }}</b><input v-model.number="state.shippingActivity" type="range" min="0" max="1" step="0.01" aria-label="远距离航运活动度"><i class="shipping-scale"><span>0 低活动</span><span>1 高活动</span></i></label>
      <div v-if="shippingCountCurve.observedCount" class="shipping-count-curve">
        <div class="shipping-curve-title"><span>船舶数量 → s（当前 AIS 平均权重）</span><b>{{ shippingCountCurve.observedCount }}艘 → {{ formatActivity(shippingCountCurve.observedActivity) }}</b></div>
        <svg viewBox="0 0 248 36" :aria-label="`${shippingCountCurve.observedCount}艘船对应航运活动度 ${formatActivity(shippingCountCurve.observedActivity)}`">
          <path d="M0 35.5H248" />
          <polyline :points="shippingCountCurvePoints" />
          <line :x1="shippingObservedX" y1="0" :x2="shippingObservedX" y2="36" />
          <circle :cx="shippingObservedX" :cy="shippingObservedY" r="2.6" />
        </svg>
        <div class="shipping-curve-range"><span>0艘 · s=0</span><span>{{ shippingCountCurve.maxCount }}艘 · s={{ formatActivity(shippingCountCurve.maxActivity) }}</span></div>
        <small>数量相同也会因距离、航速和船长不同而得到不同的 s。</small>
      </div>
      <label class="toggle-row bottom"><span>区域预报噪声</span><input v-model="state.regionalNoiseOverlay" type="checkbox"><i></i></label>
      <div v-if="state.regionalNoiseOverlay" class="overlay-control noise-overlay-control">
        <div class="overlay-legend">
          <div class="overlay-legend-title"><span>{{ regionalNoiseField.legendLabel }} · {{ summary?.band?.label }}</span><b>{{ num(regionalNoiseCenterValue, 1) }} {{ regionalNoiseField.unit }}</b></div>
          <div class="overlay-gradient" :style="{ background: overlayGradient(regionalNoiseField) }"></div>
          <div class="overlay-ticks"><span v-for="t in regionalNoiseTicks" :key="t">{{ tickLabel(t) }}</span></div>
        </div>
        <p v-if="state.regionalNoiseLoading" class="overlay-loading">正在加载区域环境噪声网格…</p>
        <p v-else-if="state.regionalNoiseError" class="overlay-error">{{ state.regionalNoiseError }}</p>
      </div>
      <label class="toggle-row bottom"><span>海流</span><input v-model="state.oceanCurrentOverlay" type="checkbox"><i></i></label>
      <div v-if="state.oceanCurrentOverlay" class="overlay-control current-overlay-control">
        <label class="current-depth-row"><span>深度</span><select v-model="state.oceanCurrentDepth" aria-label="HYCOM海流深度">
          <option v-for="depth in oceanCurrentDepths" :key="depth" :value="String(depth)">{{ num(depth, depth < 10 ? 1 : 0) }} m</option>
        </select></label>
        <div v-if="oceanCurrentLayer" class="overlay-legend">
          <div class="overlay-legend-title"><span>{{ oceanCurrentField.legendLabel }}</span><b>{{ num(oceanCurrentCenterValue, 2) }} {{ oceanCurrentField.unit }}</b></div>
          <div class="overlay-gradient" :style="{ background: overlayGradient(oceanCurrentField) }"></div>
          <div class="overlay-ticks"><span v-for="t in oceanCurrentTicks" :key="t">{{ tickLabel(t) }}</span></div>
        </div>
        <label class="toggle-row overlay-dynamic"><span>动态显示</span><input v-model="state.oceanCurrentDynamic" type="checkbox"><i></i></label>
        <small class="current-note">海流伪彩图绘制在所选水下深度层</small>
        <p v-if="state.regionalOceanCurrentLoading" class="overlay-loading">正在加载HYCOM区域海流…</p>
        <p v-else-if="state.regionalOceanCurrentError" class="overlay-error">{{ state.regionalOceanCurrentError }}</p>
      </div>
      <label class="toggle-row bottom"><span>风/雨/海况覆盖层</span><input v-model="state.terrainOverlay" type="checkbox"><i></i></label>
      <div v-if="state.terrainOverlay" class="overlay-control">
        <div class="overlay-field-switch">
          <button v-for="opt in overlayFieldOptions" :key="opt.value" type="button"
            :class="{ active: state.overlayField === opt.value }" @click="state.overlayField = opt.value">{{ opt.label }}</button>
        </div>
        <div v-if="overlayField" class="overlay-legend">
          <div class="overlay-legend-title"><span>{{ overlayField.legendLabel }}</span><b>{{ num(overlayValue, 1) }} {{ overlayField.unit }}</b></div>
          <div class="overlay-gradient" :style="{ background: overlayGradient(overlayField) }"></div>
          <div class="overlay-ticks"><span v-for="t in overlayTicks" :key="t">{{ tickLabel(t) }}</span></div>
        </div>
        <label class="toggle-row overlay-dynamic"><span>动态显示</span><input v-model="state.overlayDynamic" type="checkbox"><i></i></label>
        <p v-if="state.regionalWeatherLoading" class="overlay-loading">正在加载区域天气网格…</p>
        <p v-else-if="state.regionalWeatherError" class="overlay-error">{{ state.regionalWeatherError }}</p>
      </div>
    </template>
    <div v-else-if="!state.loading && !state.error" class="status-message">请选择地图点以加载天气和噪声。</div>
    <label
      class="toggle-row bottom"
      :class="{ disabled: Boolean(selectedAisVessel) }"
      :title="selectedAisVessel ? '已选择 AIS 船舶，航迹由船舶位置接管' : '在地形中点击依次添加航迹点，右键撤销最后一点，双击结束'"
    >
      <span>航迹点选择</span>
      <input
        v-model="signalTransmissionControls.selectTrackPoints"
        type="checkbox"
        :disabled="Boolean(selectedAisVessel)"
      />
      <i></i>
    </label>
    <p v-if="signalTransmissionControls.selectTrackPoints" class="track-point-help">
      在地形中点击依次添加航迹点，右键撤销最后一点，双击或点击下方按钮结束；相邻点间常驻标注距离。
    </p>
    <button
      v-if="signalTransmissionControls.selectTrackPoints && trackPointState.points.length"
      type="button"
      class="track-point-finish"
      @click="finishTrackPointSelection"
    >
      完成航迹点选择（{{ trackPointState.points.length }} 点）
    </button>
    <div v-if="trackPointState.finished && trackPointState.points.length" class="track-point-table">
      <div class="track-point-table-head">
        <span>已选航迹点</span>
        <b>{{ trackPointState.points.length }} 个</b>
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>经度</th><th>纬度</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="(point, index) in trackPointState.points"
            :key="index"
            :class="{ selected: trackPointState.selectedIndex === index }"
            @click="selectTrackPoint(index)"
          >
            <td>{{ index + 1 }}</td>
            <td>{{ formatTrackLon(point.lon) }}</td>
            <td>{{ formatTrackLat(point.lat) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <button
      type="button"
      class="track-field-run"
      :disabled="trackFieldRunState.running || !trackPointState.points.length"
      @click="runTrackField"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" /></svg>
      <span v-if="trackFieldRunState.running" class="track-field-spinner" aria-hidden="true"></span>
      {{ trackFieldRunState.running ? '正在计算航线声场…' : '航线声场计算' }}
    </button>
    <p v-if="trackFieldRunState.error" class="track-field-status error">{{ trackFieldRunState.error }}</p>
    <p v-else-if="trackFieldRunState.message" class="track-field-status">{{ trackFieldRunState.message }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import NoiseSpectrumMiniChart from './NoiseSpectrumMiniChart.vue'
import {
  activeShippingActivity, centerWeatherNoiseToScene, currentWeatherNoiseFrame, forecastNoiseSummary,
  loadWeatherNoiseForecast, openNoiseProbe, refreshWeatherNoiseForecast, selectWeatherNoiseBand,
  setWeatherNoiseFrame, setWeatherNoisePoint, weatherNoiseBands, weatherNoiseBandTrend, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import { chartPoints, directionLabel, formatForecastTime, shippingActivityCountCurve } from '@/utils/weatherNoiseForecast.js'
import {
  currentOverlayField, oceanCurrentRegional, overlayFieldDataRange, overlayGradient,
  OCEAN_CURRENT_OVERLAY_FIELD, REGIONAL_NOISE_OVERLAY_FIELD,
} from '@/utils/weatherOverlay.js'
import { signalTransmissionControls } from '@/modules/acoustic/signalTransmissionControls.js'
import { selectedAisVessel } from '@/modules/ais/aisMonitorStore.js'
import {
  finishTrackPoints,
  requestTrackFieldRun,
  selectTrackPoint,
  trackFieldRunState,
  trackPointState,
} from '@/modules/acoustic/trackPointState.js'

const emit = defineEmits(['pick-on-map'])

const overlayFieldOptions = [
  { value: 'wind', label: '风' },
  { value: 'rain', label: '雨' },
  { value: 'sea', label: '海况' },
]

function formatTrackLon(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${Math.abs(number).toFixed(4)}°${number >= 0 ? 'E' : 'W'}`
}

function formatTrackLat(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${Math.abs(number).toFixed(4)}°${number >= 0 ? 'N' : 'S'}`
}

function finishTrackPointSelection() {
  if (!trackPointState.points.length) return
  if (!trackPointState.finished) finishTrackPoints()
  if (signalTransmissionControls.selectTrackPoints) signalTransmissionControls.selectTrackPoints = false
}

function runTrackField() {
  finishTrackPointSelection()
  requestTrackFieldRun()
}

const state = weatherNoiseState
const result = computed(() => state.result)
const frame = currentWeatherNoiseFrame
const summary = forecastNoiseSummary
const bands = weatherNoiseBands
const weather = computed(() => frame.value?.weather || {})
const noiseTrend = weatherNoiseBandTrend
const finiteNoiseTrend = computed(() => noiseTrend.value.map(Number).filter(Number.isFinite))
const noiseTrendMin = computed(() => finiteNoiseTrend.value.length ? Math.min(...finiteNoiseTrend.value) : null)
const noiseTrendMax = computed(() => finiteNoiseTrend.value.length ? Math.max(...finiteNoiseTrend.value) : null)
const noiseTrendCurrent = computed(() => noiseTrend.value[state.frameIndex] ?? null)
const noiseTrendPoints = computed(() => chartPoints(noiseTrend.value, 248, 38, noiseTrendMin.value, noiseTrendMax.value))
const activeNoiseTrendPoints = computed(() => noiseTrendPoints.value.split(' ').slice(0, state.frameIndex + 1).join(' '))
const cursorX = computed(() => result.value?.frames?.length > 1 ? state.frameIndex * 248 / (result.value.frames.length - 1) : 0)
const cursorY = computed(() => {
  const values = noiseTrend.value
  if (!values.length) return 38
  const min = noiseTrendMin.value; const max = noiseTrendMax.value; const span = Math.max(.001, max - min)
  return 38 - ((values[state.frameIndex] ?? min) - min) * 38 / span
})
const shippingCountCurve = computed(() => shippingActivityCountCurve(result.value?.fixed_ais))
const shippingCountCurveMaxY = computed(() => Math.max(.01, shippingCountCurve.value.maxActivity || 0))
const shippingCountCurvePoints = computed(() => chartPoints(
  shippingCountCurve.value.points.map(point => point.shippingActivity),
  248, 34, 0, shippingCountCurveMaxY.value
))
const shippingObservedX = computed(() => shippingCountCurve.value.maxCount
  ? shippingCountCurve.value.observedCount * 248 / shippingCountCurve.value.maxCount : 0)
const shippingObservedY = computed(() => 34 - Math.min(
  1, shippingCountCurve.value.observedActivity / shippingCountCurveMaxY.value
) * 34)
const shippingText = computed(() => `s=${formatActivity(activeShippingActivity.value)} · ${result.value?.fixed_ais?.modeled_vessel_count || 0}艘`)
const overlayField = computed(() => currentOverlayField(state))
const overlayValue = computed(() => overlayField.value ? overlayField.value.valueOf(frame.value?.weather) || 0 : 0)
const overlayRange = computed(() => overlayFieldDataRange(overlayField.value, state.regionalWeather))
const overlayTicks = computed(() => {
  const range = overlayRange.value
  if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max >= range.min) {
    if (range.max - range.min < 1e-9) return [range.min]
    return [range.min, (range.min + range.max) / 2, range.max]
  }
  return overlayField.value?.ticks || []
})
const regionalNoiseField = REGIONAL_NOISE_OVERLAY_FIELD
const regionalNoiseRange = computed(() => overlayFieldDataRange(regionalNoiseField, state.regionalNoise))
const regionalNoiseTicks = computed(() => {
  const range = regionalNoiseRange.value
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return regionalNoiseField.ticks
  if (range.max - range.min < 1e-9) return [range.min]
  return [range.min, (range.min + range.max) / 2, range.max]
})
const regionalNoiseCenterValue = computed(() => {
  const values = state.regionalNoise?.data?.noise_level_db
  if (!Array.isArray(values) || !values.length) return null
  const row = values[Math.floor(values.length / 2)]
  return Array.isArray(row) ? row[Math.floor(row.length / 2)] : null
})
const oceanCurrentField = OCEAN_CURRENT_OVERLAY_FIELD
const oceanCurrentDepths = computed(() => state.regionalOceanCurrent?.depths_m || [])
const oceanCurrentLayer = computed(() => oceanCurrentRegional(
  state.regionalOceanCurrent, state.oceanCurrentDepth
))
const oceanCurrentRange = computed(() => overlayFieldDataRange(oceanCurrentField, oceanCurrentLayer.value))
const oceanCurrentTicks = computed(() => {
  const range = oceanCurrentRange.value
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return oceanCurrentField.ticks
  if (range.max - range.min < 1e-9) return [range.min]
  return [range.min, (range.min + range.max) / 2, range.max]
})
const oceanCurrentCenterValue = computed(() => {
  const values = oceanCurrentLayer.value?.data?.current_speed_mps
  if (!Array.isArray(values) || !values.length) return null
  const row = values[Math.floor(values.length / 2)]
  return Array.isArray(row) ? row[Math.floor(row.length / 2)] : null
})
const tickLabel = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  if (number === 0) return '0'
  const abs = Math.abs(number)
  if (Number.isInteger(number)) return number.toString()
  return number.toFixed(abs >= 10 ? 1 : 2)
}

const coord = value => Number(value).toFixed(3)
const num = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'
const formatActivity = value => {
  const activity = Number(value)
  if (!Number.isFinite(activity)) return '—'
  if (activity === 0) return '0'
  return Math.abs(activity) < .0001 ? activity.toExponential(2) : activity.toFixed(activity < .01 ? 4 : 2)
}
const formatHz = value => {
  const hz = Number(value)
  if (!Number.isFinite(hz)) return '—'
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 ? 1 : 0)} kHz` : `${hz.toFixed(0)} Hz`
}
function refresh() { refreshWeatherNoiseForecast() }
function centerToScene() { centerWeatherNoiseToScene() }
function pickOnMap() { openNoiseProbe({ picking: true }); emit('pick-on-map') }
onMounted(async () => {
  if (!state.result) await setWeatherNoisePoint(state.terrainCenter, { load: false })
  loadWeatherNoiseForecast()
})
</script>

<style scoped>
.wn-panel,.wn-panel * { box-sizing:border-box; }.wn-panel { margin:5px 0 3px; padding:9px 7px 11px; color:#91adbe; border:1px solid #244057; border-radius:7px; background:#0d1c2d; font:10px/1.35 'Microsoft YaHei',sans-serif; }
button { color:#9fd9e9; border:1px solid #2e6078; border-radius:5px; background:#102b40; cursor:pointer; }button:disabled { opacity:.5;cursor:default; }
.provider-row { display:flex; align-items:center; gap:5px; }.provider-row>span:nth-child(2){flex:1;color:#587e94;font-size:9px}.provider { padding:3px 6px;color:#f3bd5f;border:1px solid #85652d;border-radius:12px;font-size:9px;white-space:nowrap}.provider-row button{display:flex;align-items:center;justify-content:center;width:24px;height:22px}.provider-row button svg{width:14px;height:14px;display:block}.grid-point{margin:6px 1px;color:#64869a;font-family:ui-monospace,monospace}.section-label{margin:8px 0 3px;color:#5e8499}.selected-point{display:flex;justify-content:space-between;margin:0 0 6px}.selected-point b{color:#76c9ec;font:10px ui-monospace,monospace}.selected-point span{color:#eabf61}.point-actions{display:grid;grid-template-columns:1fr 1fr;gap:4px}.point-actions button{height:28px;font-size:10px}.toggle-row{position:relative;display:flex;align-items:center;justify-content:space-between;margin:7px 1px;color:#afc6d1}.toggle-row input{position:absolute;right:0;width:40px;height:20px;opacity:0;z-index:2;cursor:pointer}.toggle-row i{width:40px;height:20px;border:1px solid #37617d;border-radius:12px;background:#20384f}.toggle-row i:after{content:'';display:block;width:16px;height:16px;margin:1px;border-radius:50%;background:#6b8aaa;transition:.15s}.toggle-row input:checked+i{background:#0d5e90;border-color:#42a7e4}.toggle-row input:checked+i:after{transform:translateX(19px);background:#62bcff}.bottom{padding-top:7px;border-top:1px solid #20384b}
.toggle-row.disabled{opacity:.55;cursor:default}
.toggle-row.disabled input{cursor:default}
.track-point-help{margin:4px 1px 0;color:#5f8194;font-size:8px;line-height:1.5}
.track-point-table{margin:7px 1px 0;border:1px solid #26495f;border-radius:6px;background:#0b2233;overflow:hidden}
.track-point-table-head{display:flex;justify-content:space-between;align-items:center;height:25px;padding:0 7px;border-bottom:1px solid #203c50;color:#8bb7cd;font-size:9px}
.track-point-table-head b{color:#6de5c4;font:500 9px ui-monospace,monospace}
.track-point-table table{width:100%;border-collapse:collapse;table-layout:fixed}
.track-point-table th,.track-point-table td{padding:3px 4px;text-align:left;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track-point-table th{color:#5f8499;font-weight:400;border-bottom:1px solid #1d384b}
.track-point-table td{color:#a8c9d9;font-family:ui-monospace,monospace}
.track-point-table tbody tr{cursor:pointer}
.track-point-table tbody tr:hover td{background:#123247;color:#e3f7ff}
.track-point-table tbody tr.selected td{background:#174966;color:#eafaff}
.track-point-table th:first-child,.track-point-table td:first-child{width:22px;color:#6f96a9;text-align:center}
.track-point-finish{width:100%;height:26px;margin-top:6px;color:#8fe4ff;border:1px solid #2f6f8d;border-radius:5px;background:#102b40;font-size:9px;cursor:pointer}
.track-point-finish:hover{background:#154a66}
.track-field-run{width:100%;height:28px;margin-top:8px;display:inline-flex;align-items:center;justify-content:center;gap:5px;color:#00d4b5;border:1px solid rgba(53,205,163,0.55);border-radius:5px;background:#10373c;font-size:10px;cursor:pointer}
.track-field-run:hover:not(:disabled){color:#ffffff;border-color:rgba(59,229,180,0.9);background:linear-gradient(180deg,rgba(8,105,78,0.95),rgba(6,63,57,0.9));box-shadow:0 0 18px rgba(34,211,164,0.18)}
.track-field-run svg{width:12px;height:12px;display:block}
.track-field-run:disabled{opacity:.5;cursor:default}
.track-field-spinner{display:inline-block;width:10px;height:10px;margin-right:4px;vertical-align:-1px;border:1.5px solid rgba(0,212,181,.35);border-top-color:#00d4b5;border-radius:50%;animation:track-field-spin .8s linear infinite}
.track-field-status{margin:5px 1px 0;color:#6ba3c0;font-size:8px}
.track-field-status.error{color:#efb18c}
@keyframes track-field-spin{to{transform:rotate(360deg)}}
.status-message,.error-message{margin:8px 0;padding:8px;border-radius:5px;background:#12283a;line-height:1.5}.error-message{color:#efb18c;border:1px solid #674b43}.error-message button{display:block;margin-top:6px;padding:3px 9px}.forecast-head{display:flex;justify-content:space-between;gap:8px;margin-top:7px}.forecast-head b{color:#c2d9e4;font-size:9px;text-align:right}.time-slider,.shipping-level input{width:100%;height:3px;margin:9px 0 5px;accent-color:#35d5e7}.weather-spark{display:block;width:100%;height:43px}.weather-spark path{stroke:#263d50}.weather-spark polyline{fill:none}.weather-spark .trend-context{stroke:#376d82;stroke-width:1}.weather-spark .trend-active{stroke:#65def8;stroke-width:1.6}.weather-spark line{stroke:#e4c55e;stroke-width:.7}.weather-spark .trend-level{stroke:#5aa8ff;stroke-width:.65;stroke-dasharray:2 2;opacity:.75}.weather-spark circle{fill:#65def8;stroke:#dffbff;stroke-width:.7}.forecast-range{display:flex;justify-content:space-between;color:#5e7e91;font-size:8px}.weather-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:7px 0}.weather-grid article{min-width:0;padding:7px;border:1px solid #223e55;border-radius:6px;background:#102033}.weather-grid small{display:block;color:#66899d}.weather-grid strong{display:block;margin:2px 0;color:#edf8fb;font-size:17px}.weather-grid strong em{margin-left:3px;color:#a7bfcb;font-size:8px;font-style:normal}.weather-grid p{margin:0;color:#718fa1;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.noise-title{display:flex;justify-content:space-between;margin:8px 0 4px}.noise-title b{color:#d7e8ef;font-size:9px}.noise-summary{padding:7px;border:1px solid #28617b;border-radius:6px;background:#0c2537}.noise-summary div{display:flex;align-items:baseline;gap:5px}.noise-summary div strong{color:#61e4f8;font:700 21px ui-monospace,monospace}.noise-summary div span{color:#87a7b7;font-size:8px}.noise-summary small{display:block;color:#7799ab}.noise-summary p{margin:4px 0 0;color:#58cfe8}.noise-summary p b{color:#e3eef2}.component-values{display:flex;flex-wrap:wrap;gap:2px 7px;margin:5px 1px;font:8px ui-monospace,monospace}.component-values span{white-space:nowrap}.component-values .wind{color:#59dff5}.component-values .rain{color:#5aa8ff}.component-values .shipping{color:#eebc58}.component-values .turbulence{color:#8ca0b3}.component-values .thermal{color:#b993ff}.noise-band-switch{display:flex;flex-wrap:wrap;gap:4px;margin:5px 0}.noise-band-switch button{height:18px;padding:0 6px;color:#a9cad9;border-color:#35617b;background:#102b40;font-size:8px}.noise-band-switch button.active{color:#eafaff;border-color:#62ccea;background:#174966;box-shadow:inset 0 0 0 1px #2b809f}.chart-note{margin:4px 0 8px;color:#5f8194;font-size:8px}.shipping-level{display:grid;grid-template-columns:1fr auto;align-items:center;color:#7899aa}.shipping-level b{color:#59dce8}.shipping-level input{grid-column:1/-1;cursor:pointer}
.shipping-scale{grid-column:1/-1;display:flex;justify-content:space-between;color:#58798d;font-size:8px;font-style:normal}
.shipping-count-curve{margin:7px 0 9px;padding-top:6px;border-top:1px solid #20384b}.shipping-curve-title,.shipping-curve-range{display:flex;justify-content:space-between;gap:8px}.shipping-curve-title{color:#7899aa}.shipping-curve-title b{color:#eebc58;font-family:ui-monospace,monospace}.shipping-count-curve svg{display:block;width:100%;height:36px;margin-top:4px}.shipping-count-curve path{fill:none;stroke:#263d50;stroke-width:.7}.shipping-count-curve polyline{fill:none;stroke:#eebc58;stroke-width:1.4}.shipping-count-curve line{stroke:#65def8;stroke-width:.7;stroke-dasharray:2 2}.shipping-count-curve circle{fill:#65def8;stroke:#dffbff;stroke-width:.7}.shipping-curve-range{color:#58798d;font:8px ui-monospace,monospace}.shipping-count-curve small{display:block;margin-top:3px;color:#5f8194;font-size:8px}
.overlay-control{margin:2px 1px 0;padding:7px;border:1px solid #2a4b63;border-radius:6px;background:#0a2030}.noise-overlay-control{border-color:#414d78}.noise-overlay-control .overlay-legend{margin-top:0}.current-overlay-control{border-color:#27626a}.current-depth-row{display:flex;align-items:center;justify-content:space-between;color:#91b8c8}.current-depth-row select{min-width:112px;height:24px;padding:0 5px;color:#d9f4f5;border:1px solid #34717b;border-radius:4px;background:#102b40;font-size:9px}.current-note{display:block;margin-top:5px;color:#5f8194;font-size:8px}.overlay-field-switch{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.overlay-field-switch button{height:24px;padding:0;color:#9fd9e9;border:1px solid #2e6078;border-radius:5px;background:#102b40;font-size:10px;cursor:pointer}.overlay-field-switch button.active{color:#04121f;background:#45c6e8;border-color:#7eeaff;font-weight:600}.overlay-legend{margin-top:7px}.overlay-legend-title{display:flex;justify-content:space-between;gap:5px;color:#86aac2;font-size:9px}.overlay-legend-title span{min-width:0}.overlay-legend-title b{flex:none;color:#e3f4ff;font-family:ui-monospace,monospace}.overlay-gradient{height:7px;margin:5px 0 3px;border-radius:3px}.overlay-ticks{display:flex;justify-content:space-between;color:#6b8ba0;font:8px ui-monospace,monospace}.overlay-dynamic{margin:8px 0 0;padding-top:7px;border-top:1px solid #20384b}.overlay-loading{margin:7px 0 0;color:#6ba3c0;font-size:9px}.overlay-error{margin:7px 0 0;color:#efb18c;font-size:9px}
</style>
