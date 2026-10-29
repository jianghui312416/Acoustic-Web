<template>
  <span class="station-pin" :style="{ left: `${point.x}px`, top: `${point.y}px` }" aria-label="所选站点"><svg viewBox="0 0 24 32"><ellipse cx="12" cy="28" rx="9" ry="3" fill="none" stroke="currentColor"/><path d="M12 28V13" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="8" r="5" fill="currentColor"/></svg></span>
  <section class="station-card" :style="position" aria-label="站点环境信息">
    <header>
      <button :aria-expanded="expanded" aria-label="展开风雨详情" title="风雨详情" @click="expanded = !expanded">{{ expanded ? '▾' : '▸' }}</button>
      <span>📍 {{ point.elevation < 0 ? '水深' : '高程' }} {{ Math.round(Math.abs(point.elevation)) }} 米</span>
      <button aria-label="关闭站点信息" title="关闭" @click="$emit('close')">×</button>
    </header>
    <p class="coordinates">{{ Math.abs(point.lat).toFixed(5) }}° {{ point.lat >= 0 ? 'N' : 'S' }}，{{ Math.abs(point.lon).toFixed(5) }}° {{ point.lon >= 0 ? 'E' : 'W' }}</p>
    <strong class="weather-summary">≋ {{ weather.wind ? `${Math.round(weather.wind.speed)} 米/秒 ${weather.wind.label}` : busy ? '读取风速…' : '风速不可用' }}</strong>
    <nav>
      <button :disabled="running" title="在这里运行模拟" aria-label="在这里运行模拟" @click="$emit('run', point)"><svg viewBox="0 0 24 24"><path d="m8 4 12 8-12 8Z" fill="currentColor"/></svg></button>
      <button disabled title="噪声（暂未开放）" aria-label="噪声（暂未开放）"><svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4ZM16 8q6 4 0 8M18 4q10 8 0 16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
      <button :disabled="running" title="加载此位置参数" aria-label="加载此位置参数" @click="$emit('parameters', point)"><svg viewBox="0 0 24 24"><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 9h6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
    </nav>
    <div v-if="expanded" class="weather-details" aria-live="polite">
      <p>{{ dataset }} · {{ time.replace('T', ' ') }}</p>
      <div><span>≋ 10 米风速</span><b>{{ weather.wind ? `${weather.wind.speed.toFixed(2)} 米/秒` : '—' }}</b></div>
      <div><span>风向</span><b>{{ weather.wind ? `${weather.wind.label} · ${weather.wind.direction.toFixed(1)}°` : '—' }}</b></div>
      <div><span>☂ 降雨</span><b>{{ weather.rain ? `${weather.rain.value.toFixed(2)} ${weather.rain.unit}` : '—' }}</b></div>
      <p v-for="message in weather.errors" :key="message" class="weather-error">{{ message }}</p>
      <button v-if="weather.errors.length" :disabled="busy" @click="loadWeather">{{ busy ? '读取中…' : '重新读取风雨数据' }}</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getEnvDataStation, getDataTypeMetaInfo } from '@/api/soundFieldApi.js'
import { WEATHER_TYPES, stationSurfaceValue, windFromComponents, rainMeasurement } from '@/utils/stationWeather.js'
const props = defineProps({ point: Object, dataset: String, time: String, running: Boolean })
defineEmits(['run', 'parameters', 'close'])
const expanded = ref(false)
const busy = ref(false)
const weather = ref({ wind: null, rain: null, errors: [] })
const position = computed(() => ({ left: `clamp(8px, ${props.point.x + 18}px, calc(100% - 278px))`, top: `clamp(8px, ${props.point.y - 60}px, calc(100% - ${expanded.value ? 340 : 155}px))` }))
let generation = 0
let timer
async function loadWeather() {
  const request = ++generation
  busy.value = true
  weather.value = { wind: null, rain: null, errors: [] }
  const time = props.time.replace('T', ' ')
  const params = { coordX: props.point.lon, coordY: props.point.lat, dataSource: props.dataset,
    time, timeRes: 0, isReconstruct: false, rdataSource: 'EnvReanalysis', rtime: time, rtimeRes: 0 }
  const results = await Promise.allSettled([
    ...WEATHER_TYPES.map(dataType => getEnvDataStation({ ...params, dataType })), getDataTypeMetaInfo(),
  ])
  if (request !== generation) return
  const values = results.slice(0, 3).map(r => r.status === 'fulfilled' ? stationSurfaceValue(r.value) : null)
  const wind = windFromComponents(values[0], values[1])
  const meta = results[3].status === 'fulfilled' ? results[3].value?.Data?.Units?.[0]?.Response : []
  const rain = rainMeasurement(values[2], meta?.find?.(item => item.id === WEATHER_TYPES[2])?.unit)
  const errors = []
  if (!wind) errors.push('风速暂不可用，请检查所选时次的站点数据。')
  if (!rain) errors.push(results[2].status === 'rejected' ? `降雨不可用：${(results[2].reason?.message || '站点请求失败').replace(/^声场计算失败[：:]?/, '')}` : '降雨数据缺测或单位未正确配置。')
  weather.value = { wind, rain, errors }
  busy.value = false
}
watch(() => [props.point.lon, props.point.lat, props.dataset, props.time], () => {
  generation++
  clearTimeout(timer)
  busy.value = true
  weather.value = { wind: null, rain: null, errors: [] }
  timer = setTimeout(loadWeather, 200)
}, { immediate: true })
onBeforeUnmount(() => { generation++; clearTimeout(timer) })
</script>

<style scoped>
.station-pin { position:absolute; z-index:12; transform:translate(-50%,-80%); color:#62dcf5; font-size:30px; text-shadow:0 2px 5px #00121f; pointer-events:none; }
.station-pin svg { width:24px; height:32px; }
.station-card { position:absolute; z-index:15; box-sizing:border-box; width:270px; max-width:calc(100% - 16px); max-height:calc(100% - 45px); overflow:auto; padding:9px 10px; border:1px solid #458099; border-radius:10px; background:#071b2bf5; color:#bad4e6; box-shadow:0 9px 24px #00132666; font:11px 'Microsoft YaHei',sans-serif; }
header { display:flex; align-items:center; gap:6px; }header span { flex:1; color:#8caec7; }button { cursor:pointer; color:#9cdbed; border:1px solid #35677f; background:#122f40; border-radius:4px; }header button { border:0; background:none; padding:0 3px; font-size:16px; }
.coordinates { margin:6px 0; font:10px monospace; }.weather-summary { display:block; margin:5px 0 7px; color:#cae9fa; }
nav { display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:5px; }nav button { height:27px; }nav button:first-child { background:#15465a; }svg { width:15px;height:15px;vertical-align:middle; }button:disabled { opacity:.45;cursor:default; }button:hover:not(:disabled) { background:#21516a; }
.weather-details { margin-top:9px; border-top:1px solid #294355; padding-top:7px; }.weather-details p { margin:4px 0 8px; color:#789bb5; font-size:10px; }.weather-details div { display:flex; justify-content:space-between; gap:8px; margin:6px 0; }.weather-details .weather-error { color:#e3b385; overflow-wrap:anywhere; line-height:1.6; }.weather-details button { padding:5px 8px; }
</style>
