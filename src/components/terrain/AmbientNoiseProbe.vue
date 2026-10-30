<template>
  <section class="ambient-probe" :class="{ picking }" :style="position" aria-label="环境噪声探针">
    <header>
      <svg class="probe-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <b title="Ambient only · no AIS targets">环境噪声</b>
      <button type="button" aria-label="关闭" title="关闭" @click="$emit('close')">×</button>
    </header>

    <template v-if="picking">
      <p class="pick-hint">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" fill="currentColor"/></svg>
        Click a point on the map…
      </p>
    </template>
    <template v-else>
      <p class="probe-loc">探头位置 · {{ coord(state.point.lon) }}°, {{ coord(state.point.lat) }}°</p>
      <div class="probe-reading">
        <div class="total"><span>total noise</span><strong>{{ totalDb }}<em>dB</em></strong></div>
        <p class="ctx">wind {{ num(weather.wind10_mps, 1) }} m/s · rain {{ num(weather.precipitation_mmh, 2) }} mm/h</p>
      </div>
    </template>

    <div class="probe-actions">
      <button type="button" @click="centerToScene">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <span>场景中心</span>
      </button>
      <button type="button" @click="pickOnMap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" fill="currentColor"/></svg>
        <span>在地图上选择</span>
      </button>
    </div>
    <p class="probe-help">Scene centre 对齐地形中心 · Pick on map 点击地形选点后自动更新预报。</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import {
  centerWeatherNoiseToScene, currentWeatherNoiseFrame, forecastNoiseSummary,
  noiseProbeState, setNoiseProbePicking, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'

const props = defineProps({ point: { type: Object, default: null } })
defineEmits(['close'])

const state = weatherNoiseState
const frame = currentWeatherNoiseFrame
const summary = forecastNoiseSummary
const picking = computed(() => noiseProbeState.picking)
const weather = computed(() => frame.value?.weather || {})
const totalDb = computed(() => Number.isFinite(Number(summary.value?.bandLevelDb)) ? Math.round(summary.value.bandLevelDb) : '—')

const position = computed(() => {
  const x = Number(props.point?.x)
  const y = Number(props.point?.y)
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { left: `clamp(8px, ${x + 18}px, calc(100% - 256px))`, top: `clamp(8px, ${y - 60}px, calc(100% - 236px))` }
  }
  return { left: '50%', top: '14px', transform: 'translateX(-50%)' }
})

const coord = value => Number(value).toFixed(4)
const num = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'

function centerToScene() { centerWeatherNoiseToScene() }
function pickOnMap() { setNoiseProbePicking(true) }
</script>

<style scoped>
.ambient-probe,.ambient-probe *{box-sizing:border-box}.ambient-probe{position:absolute;z-index:16;width:248px;max-width:calc(100% - 16px);padding:9px;border:1px solid #3c819d;border-radius:8px;background:#081827f7;color:#a9c8d6;box-shadow:0 9px 24px #00132677;font:10px/1.35 'Microsoft YaHei',sans-serif}
.ambient-probe.picking{border-color:#6f5a2e}button{cursor:pointer;color:#9edbec;border:1px solid #35677f;background:#122f40;border-radius:5px}
header{display:flex;align-items:center;gap:6px}header .probe-icon{width:15px;height:15px;color:#62dcf5}header b{flex:1;color:#dceff8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}header button{border:0;background:none;padding:0 3px;font-size:16px;color:#87aabb}
.probe-loc{margin:8px 0 2px;color:#8aa9bc;font:9px ui-monospace,monospace}.pick-hint{display:flex;align-items:center;gap:6px;margin:10px 2px;padding:9px 8px;border:1px dashed #8a7a2f;border-radius:6px;color:#f2cf6a;font-weight:600}.pick-hint svg{width:15px;height:15px;color:#f2cf6a;flex:0 0 auto}.probe-reading{margin:4px 0 7px;padding:7px;border:1px solid #28617b;border-radius:6px;background:#0c2537}.probe-reading .total{display:flex;align-items:baseline;justify-content:space-between}.probe-reading .total span{color:#7797a9}.probe-reading .total strong{color:#5ce4f8;font:700 26px ui-monospace,monospace}.probe-reading .total strong em{margin-left:3px;color:#7796a7;font:8px sans-serif}.probe-reading .ctx{margin:5px 0 0;padding-top:5px;border-top:1px solid #243e50;color:#7e9cac}
.probe-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.probe-actions button{display:flex;align-items:center;justify-content:center;gap:5px;height:28px;font-size:10px}.probe-actions svg{width:14px;height:14px}.probe-help{margin:7px 1px 1px;color:#607e90;font-size:8px}
</style>
