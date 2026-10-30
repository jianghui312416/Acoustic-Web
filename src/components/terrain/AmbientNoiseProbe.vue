<template>
  <section ref="panelRef" class="ambient-probe" :class="{ picking, dragging }" :style="dragStyle" aria-label="环境噪声探针">
    <header @pointerdown="startDragging">
      <svg class="probe-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <b>环境噪声</b>
      <span class="probe-titlebar-actions" @pointerdown.stop>
        <button type="button" aria-label="最小化环境噪声" title="最小化环境噪声" @click="$emit('minimize')">−</button>
        <button type="button" aria-label="关闭环境噪声" title="关闭环境噪声" @click="$emit('close')">×</button>
      </span>
    </header>

    <template v-if="picking">
      <p class="pick-hint">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" fill="currentColor"/></svg>
        请在地图上点击一个位置…
      </p>
    </template>
    <template v-else>
      <p class="probe-loc">探头位置 · {{ coord(state.point.lon) }}°, {{ coord(state.point.lat) }}°</p>
      <div class="probe-reading">
        <div class="total"><span>总噪声</span><strong>{{ totalDb }}<em>dB</em></strong></div>
        <p class="ctx">风速 {{ num(weather.wind10_mps, 1) }} 米/秒 · 降雨 {{ num(weather.precipitation_mmh, 2) }} 毫米/小时</p>
      </div>
    </template>

    <div class="probe-actions">
      <button type="button" @click="centerToScene">
        <span aria-hidden="true">◉</span>
        <span>场景中心</span>
      </button>
      <button type="button" @click="pickOnMap">
        <span aria-hidden="true">📍</span>
        <span>在地图上选择</span>
      </button>
    </div>
    <p class="probe-help">场景中心对齐地形中心 · 在地图上选择后点击地形更新预报。</p>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useDraggablePanel } from '@/composables/useDraggablePanel.js'
import {
  centerWeatherNoiseToScene, currentWeatherNoiseFrame, forecastNoiseSummary,
  noiseProbeState, setNoiseProbePicking, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'

defineEmits(['close', 'minimize'])

const { panelRef, dragging, dragStyle, startDragging } = useDraggablePanel({
  avoid: () => {
    const el = document.querySelector('.station-card')
    if (!el) return []
    return [el.getBoundingClientRect()]
  },
})

const state = weatherNoiseState
const frame = currentWeatherNoiseFrame
const summary = forecastNoiseSummary
const picking = computed(() => noiseProbeState.picking)
const weather = computed(() => frame.value?.weather || {})
const totalDb = computed(() => Number.isFinite(Number(summary.value?.bandLevelDb)) ? Math.round(summary.value.bandLevelDb) : '—')

const coord = value => Number(value).toFixed(4)
const num = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'

function centerToScene() { centerWeatherNoiseToScene() }
function pickOnMap() { setNoiseProbePicking(true) }
</script>

<style scoped>
.ambient-probe,.ambient-probe *{box-sizing:border-box}.ambient-probe{position:absolute;top:120px;left:22px;z-index:15;width:250px;max-width:calc(100% - 32px);padding:9px;border:1px solid #3c819d;border-radius:8px;background:#081827f7;color:#a9c8d6;box-shadow:0 9px 24px #00132677;font:10px/1.35 'Microsoft YaHei',sans-serif}
.ambient-probe.picking{border-color:#6f5a2e}.ambient-probe.dragging{user-select:none}button{cursor:pointer;color:#9edbec;border:1px solid #35677f;background:#122f40;border-radius:5px}
header{display:flex;align-items:center;gap:6px;cursor:move;touch-action:none;border-radius:6px 6px 0 0}header .probe-icon{width:15px;height:15px;color:#62dcf5}header b{flex:1;color:#dceff8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.probe-titlebar-actions{display:inline-flex;align-items:center;gap:2px}header button{border:0;background:none;padding:0 3px;font-size:16px;color:#87aabb;width:22px;line-height:1}
header button:hover{color:#55e7dc}
.probe-loc{margin:8px 0 2px;color:#8aa9bc;font:9px ui-monospace,monospace}.pick-hint{display:flex;align-items:center;gap:6px;margin:10px 2px;padding:9px 8px;border:1px dashed #8a7a2f;border-radius:6px;color:#f2cf6a;font-weight:600}.pick-hint svg{width:15px;height:15px;color:#f2cf6a;flex:0 0 auto}.probe-reading{margin:4px 0 7px;padding:7px;border:1px solid #28617b;border-radius:6px;background:#0c2537}.probe-reading .total{display:flex;align-items:baseline;justify-content:space-between}.probe-reading .total span{color:#7797a9}.probe-reading .total strong{color:#5ce4f8;font:700 26px ui-monospace,monospace}.probe-reading .total strong em{margin-left:3px;color:#7796a7;font:8px sans-serif}.probe-reading .ctx{margin:5px 0 0;padding-top:5px;border-top:1px solid #243e50;color:#7e9cac}
.probe-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.probe-actions button{display:flex;align-items:center;justify-content:center;gap:5px;height:28px;font-size:10px}.probe-actions svg{width:14px;height:14px}.probe-help{margin:7px 1px 1px;color:#607e90;font-size:8px}
</style>