<template>
  <span class="station-pin" :style="{ left: `${point.x}px`, top: `${point.y}px` }" aria-label="所选站点"><svg viewBox="0 0 24 32"><ellipse cx="12" cy="28" rx="9" ry="3" fill="none" stroke="currentColor"/><path d="M12 28V13" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="8" r="5" fill="currentColor"/></svg></span>
  <section class="station-card" :style="position" aria-label="站点天气与环境噪声信息">
    <header>
      <button :aria-expanded="expanded" aria-label="展开详情" title="详情" @click="expanded = !expanded">{{ expanded ? '▾' : '▸' }}</button>
      <span>📍 {{ point.elevation < 0 ? `${Math.round(Math.abs(point.elevation))}米水深` : `${Math.round(point.elevation)}米高程` }}</span>
      <b v-if="frame">+{{ frame.index }} 小时</b>
      <button aria-label="关闭站点信息" title="关闭" @click="$emit('close')">×</button>
    </header>
    <p class="coordinates">{{ coord(point.lat, 'N', 'S') }}，{{ coord(point.lon, 'E', 'W') }}</p>
    <strong class="weather-summary" v-if="frame">≋ {{ num(weather.wind10_mps, 1) }} 米/秒 {{ directionLabel(weather.wind_direction_deg) }}　☂ {{ num(weather.precipitation_mmh, 2) }}　≈ {{ num(weather.wave_hs_m, 2) }} 米</strong>
    <strong class="weather-summary" v-else>{{ state.loading ? '正在读取 48 小时天气与噪声…' : '天气暂不可用' }}</strong>
    <nav>
      <button :disabled="running" title="点击即在光标位置运行" @click="$emit('run', point)"><svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8Z" fill="currentColor"/></svg><span>在这里运行</span></button>
      <button title="环境噪声" @click="$emit('noise', point)"><svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4ZM16 8q6 4 0 8M18 4q10 8 0 16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>噪声</span></button>
      <button :disabled="running" title="加载此位置参数" @click="$emit('parameters', point)"><svg viewBox="0 0 24 24"><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 9h6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
    </nav>

    <div v-if="expanded && frame" class="details" aria-live="polite">
      <p class="source">WeatherNext 2（Open-Meteo）· {{ formatForecastTime(frame.time) }}</p>
      <div class="weather-row"><span>≋ 风速 10 米</span><b>{{ num(weather.wind10_mps, 1) }} 米/秒　{{ directionLabel(weather.wind_direction_deg) }}</b></div>
      <div class="weather-row"><span>☂ 雨</span><b>{{ num(weather.precipitation_mmh, 2) }} 毫米/小时</b></div>
      <div class="weather-row"><span>≈ 海况</span><b>{{ num(weather.wave_hs_m, 2) }} 米 Hs　· Tp {{ num(weather.wave_period_s, 1) }} 秒</b></div>

      <article class="noise-box">
        <div><span>环境噪声（WENZ）{{ summary?.band?.label }}</span><strong>{{ num(summary?.bandLevelDb, 1) }}<em>dB re 1 μPa²</em></strong></div>
        <p>风速 {{ num(weather.wind10_mps, 1) }} m/s，雨强 {{ num(weather.precipitation_mmh, 2) }} mm/h，航运 s={{ num(activeShippingActivity, 2) }}</p>
      </article>
      <article class="score-box">
        <div><span>🚢 距离 ≤100 公里的船舶 · {{ nearbyShips }}（快速，AIS 固定）</span><b>{{ result?.fixed_ais?.modeled_vessel_count || 0 }} 艘</b></div>
        <div><span>船舶 + 环境</span><strong>{{ score }} 分贝</strong></div>
      </article>
      <p class="hint">拖动左侧“天气与环境噪声”时间滑杆，可同步查看未来 48 小时逐小时天气及各噪声分量变化。</p>
    </div>
    <div v-else-if="expanded && state.error" class="station-error">{{ state.error }}<button @click="refreshWeatherNoiseForecast">重新加载</button></div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  activeShippingActivity, currentWeatherNoiseFrame, forecastNoiseSummary, refreshWeatherNoiseForecast,
  setWeatherNoisePoint, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import { directionLabel, formatForecastTime } from '@/utils/weatherNoiseForecast.js'

const props = defineProps({ point: Object, dataset: String, time: String, running: Boolean })
defineEmits(['run', 'parameters', 'close', 'noise'])
const expanded = ref(true)
const state = weatherNoiseState
const frame = currentWeatherNoiseFrame
const summary = forecastNoiseSummary
const result = computed(() => state.result)
const weather = computed(() => frame.value?.weather || {})
const position = computed(() => ({ left: `clamp(8px, ${props.point.x + 18}px, calc(100% - 306px))`, top: `clamp(8px, ${props.point.y - 60}px, calc(100% - ${expanded.value ? 430 : 145}px))` }))
const nearbyShips = computed(() => {
  const lat = Number(props.point.lat) * Math.PI / 180
  return (state.ais?.vessels || []).filter(ship => {
    const dLat = (Number(ship.latitude) - Number(props.point.lat)) * 111
    const dLon = (Number(ship.longitude) - Number(props.point.lon)) * 111 * Math.cos(lat)
    return Number.isFinite(dLat + dLon) && Math.hypot(dLat, dLon) <= 100
  }).length
})
const score = computed(() => Number.isFinite(Number(summary.value?.bandLevelDb)) ? Math.round(summary.value.bandLevelDb) : '—')
const num = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'
const coord = (value, positive, negative) => `${Math.abs(Number(value)).toFixed(3)}°${Number(value) >= 0 ? positive : negative}`
let timer = 0
watch(() => [props.point.lon, props.point.lat], () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => setWeatherNoisePoint(props.point), 180)
}, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<style scoped>
.station-pin{position:absolute;z-index:12;transform:translate(-50%,-80%);color:#62dcf5;text-shadow:0 2px 5px #00121f;pointer-events:none}.station-pin svg{width:24px;height:32px}.station-card,.station-card *{box-sizing:border-box}.station-card{position:absolute;z-index:15;width:298px;max-width:calc(100% - 16px);max-height:calc(100% - 42px);overflow:auto;padding:8px;border:1px solid #3c819d;border-radius:8px;background:#071827f4;color:#b6cfdd;box-shadow:0 9px 24px #00132666;font:10px/1.35 'Microsoft YaHei',sans-serif}.station-card button{cursor:pointer;color:#9edbec;border:1px solid #35677f;background:#122f40;border-radius:5px}.station-card button:disabled{opacity:.45;cursor:default}header{display:flex;align-items:center;gap:5px}header span{flex:1;color:#91bbd2}header b{color:#7195ab;font-size:9px}header button{border:0;background:none;padding:0 3px;font-size:16px}.coordinates{margin:4px 0;color:#8aa9bc;font:9px ui-monospace,monospace}.weather-summary{display:block;margin:4px 0 7px;color:#d8edf6;font-size:10px}nav{display:grid;grid-template-columns:1.45fr 1.05fr 31px;gap:5px}nav button{height:27px}nav button:first-child{background:#15465a}nav button span{margin-left:5px}svg{width:14px;height:14px;vertical-align:middle}.details{margin-top:8px;border-top:1px solid #294355;padding-top:6px}.source{margin:0 0 6px;color:#698da2;font-size:9px}.weather-row{display:flex;justify-content:space-between;gap:6px;margin:4px 0}.weather-row span{color:#7f9fb1}.weather-row b{color:#d3e8f0;font-weight:600}.noise-box,.score-box{margin-top:7px;padding:6px;border:1px solid #245a72;border-radius:5px;background:#0d2638}.noise-box>div,.score-box>div{display:flex;justify-content:space-between;align-items:baseline;gap:6px}.noise-box span{color:#7797a9}.noise-box strong{color:#59dff5;font:700 18px ui-monospace,monospace}.noise-box strong em{margin-left:3px;color:#7796a7;font:7px sans-serif}.noise-box p{margin:2px 0 0;color:#7e9cac}.score-box{border-color:#28465d}.score-box div+div{margin-top:5px;padding-top:5px;border-top:1px solid #243e50}.score-box b{color:#d2e5ec}.score-box strong{color:#e5f4f8}.hint{margin:6px 1px 1px;color:#607e90;font-size:8px}.station-error{margin-top:8px;padding:7px;color:#e9ad8c;border:1px solid #61493f;border-radius:5px}.station-error button{display:block;margin-top:5px;padding:3px 7px}
</style>
