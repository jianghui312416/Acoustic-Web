<template>
  <section class="station-position-card" :style="position" aria-label="声场位置参数">
    <header>
      <i :class="{ busy, run: hasRun }"></i>
      <span>{{ busy ? '计算中…' : '声场' }}<template v-if="time"> {{ time }}</template></span>
      <div class="header-actions">
        <button type="button" title="参数设置" aria-label="参数设置" @click="$emit('settings')">⚙</button>
        <button type="button" title="关闭" aria-label="关闭" @click="$emit('close')">×</button>
      </div>
    </header>

    <p class="coords">{{ latText }}°　{{ lonText }}°</p>
    <small class="volume"><i></i>三维声场</small>

    <div class="divider"></div>
    <p class="section-title"><span aria-hidden="true">◆</span> POSITION</p>

    <div class="rows">
      <span>Lat:</span><b>{{ latText }}°</b>
      <span>Lon:</span><b>{{ lonText }}°</b>
      <span>Bathy:</span><b>{{ bathyText }}</b>
      <span>Src Depth:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.srcDepth"
          type="number"
          min="0"
          :max="maxDepthM"
          step="1"
          aria-label="声源深度"
          @change="normalize"
        />
        <em>m</em>
        <small>(0–{{ maxDepthM }})</small>
      </label>
      <span>运行频率:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.frequency"
          type="number"
          min="1"
          step="1"
          aria-label="运行频率"
          @change="normalize"
        />
        <em>Hz</em>
      </label>
    </div>

    <nav>
      <button type="button" class="run-action" :disabled="busy" @click="$emit('run')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" fill="currentColor" /></svg>
        <span>运行</span>
      </button>
    </nav>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { clampSimulationControls, simulationControls } from '@/modules/acoustic/simulationControls.js'

const props = defineProps({
  point: { type: Object, default: null },
  time: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  hasRun: { type: Boolean, default: false },
})
defineEmits(['run', 'close', 'settings'])

const simulation = simulationControls
const lonText = computed(() => Number(props.point?.lon || 0).toFixed(5))
const latText = computed(() => Number(props.point?.lat || 0).toFixed(5))
const depthM = computed(() => Math.max(0, -Number(props.point?.elevation || 0)))
const maxDepthM = computed(() => Math.max(1, Math.round(depthM.value)))
const bathyText = computed(() => (Number.isFinite(depthM.value) ? `${maxDepthM.value} m` : '—'))
const position = computed(() => {
  const x = Number(props.point?.x) || 0
  const y = Number(props.point?.y) || 0
  return {
    left: `clamp(8px, ${x + 18}px, calc(100% - 306px))`,
    top: `clamp(70px, ${y - 40}px, calc(100% - 360px))`,
  }
})

function normalize() {
  clampSimulationControls(simulation)
}
</script>

<style scoped>
.station-position-card {
  position: absolute;
  z-index: 19;
  width: 298px;
  max-width: calc(100% - 16px);
  max-height: calc(100% - 42px);
  overflow: auto;
  padding: 10px 11px 11px;
  border: 1px solid #00e6a5;
  border-radius: 9px;
  color: #b9d0e4;
  background: #0c1c2ef5;
  box-shadow: 0 8px 25px #001c3360, 0 0 16px #00eba518;
  font: 10px/1.35 'Microsoft YaHei', sans-serif;
}
.station-position-card,
.station-position-card * { box-sizing: border-box; }
header { display: flex; align-items: center; gap: 6px; }
header > i { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #f1c75b; box-shadow: 0 0 8px #f1c75b88; }
header > i.run { background: #00efa5; box-shadow: 0 0 8px #00efa588; }
header > i.busy { animation: pulse 1s infinite alternate; }
header > span { flex: 1; color: #d3eaf4; font-size: 11px; }
.header-actions { display: flex; align-items: center; gap: 2px; }
.header-actions button { width: 22px; height: 22px; padding: 0; color: #8194b7; border: 0; background: transparent; cursor: pointer; font-size: 15px; line-height: 1; }
.header-actions button:last-child { color: #dc7181; }
.coords { margin: 9px 0 6px; color: #8eb5d0; font: 10px ui-monospace, monospace; }
.volume { display: inline-flex; align-items: center; gap: 5px; color: #00e9ad; font-size: 10px; }
.volume i { width: 6px; height: 6px; border-radius: 50%; background: #00efa5; }
.divider { height: 1px; margin: 9px 0 7px; background: #21445a; }
.section-title { display: flex; align-items: center; gap: 5px; margin: 0 0 6px; color: #7897ad; font-size: 9px; letter-spacing: 1px; }
.section-title span { color: #d77a8f; font-size: 8px; }
.rows { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 5px 6px; }
.rows > span { color: #8da9bc; }
.rows > b { color: #d9edf6; font-weight: 500; font-family: ui-monospace, monospace; }
.inline-field { display: flex; align-items: center; gap: 4px; min-width: 0; }
.inline-field input { width: 68px; height: 24px; padding: 0 6px; color: #d9edf6; border: 1px solid #2b5570; border-radius: 4px; background: #102b3d; outline: none; font: 10px ui-monospace, monospace; }
.inline-field input:focus { border-color: #3fa5c3; }
.inline-field em { color: #7d9bae; font-style: normal; }
.inline-field small { color: #5f8095; font-size: 8px; white-space: nowrap; }
nav { display: flex; margin-top: 10px; }
.run-action { width: 100%; height: 29px; display: flex; align-items: center; justify-content: center; gap: 6px; color: #00e9aa; border: 1px solid #00a987; border-radius: 5px; background: #10433d; cursor: pointer; font-size: 10px; }
.run-action svg { width: 14px; height: 14px; }
.run-action:disabled { opacity: 0.45; cursor: default; }
.run-action:not(:disabled):hover { border-color: #00e6a5; background: #145a50; }
@keyframes pulse { to { opacity: 0.3; } }
</style>
