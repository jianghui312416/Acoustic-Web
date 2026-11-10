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

    <div class="coords-line">
      <template v-if="!coordEditing">
        <button type="button" class="coords-trigger" title="点击编辑经纬度" @click="beginCoordEdit">{{ coordText }}</button>
        <button type="button" class="coord-format" title="切换经纬度格式" @click.stop="cycleCoordFormat">{{ simulation.coordFormat }}</button>
      </template>
      <template v-else>
        <input
          ref="coordInputEl"
          v-model="coordDraft"
          class="coord-input"
          type="text"
          aria-label="纬度, 经度"
          @keydown.enter.prevent="applyCoordEdit"
          @keydown.esc.prevent="cancelCoordEdit"
        />
        <button type="button" class="coord-go" title="运行此位置" aria-label="运行此位置" @click="applyCoordEdit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" fill="currentColor" /></svg>
        </button>
        <button type="button" class="coord-cancel" title="取消" aria-label="取消" @click="cancelCoordEdit">×</button>
      </template>
    </div>
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
          :title="`0–${maxDepthM} m`"
          @change="normalize"
        />
        <em>m</em>
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
      <span>距离:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.range"
          type="number"
          min="0.1"
          step="0.1"
          aria-label="距离"
          @change="normalize"
        />
        <em>nmi</em>
      </label>
      <span>俯角:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.grazingAngleMin"
          type="number"
          min="-90"
          max="90"
          step="1"
          aria-label="俯角"
          @change="normalize"
        />
        <em>°</em>
      </label>
      <span>仰角:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.grazingAngleMax"
          type="number"
          min="-90"
          max="90"
          step="1"
          aria-label="仰角"
          @change="normalize"
        />
        <em>°</em>
      </label>
      <span>声线数:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.lineCount"
          type="number"
          min="0"
          step="1"
          aria-label="声线条数"
          @change="normalize"
        />
      </label>
      <span>方位数:</span>
      <label class="inline-field">
        <input
          v-model.number="simulation.sector"
          type="number"
          min="1"
          max="360"
          step="1"
          aria-label="方位数"
          @change="normalize"
        />
      </label>
    </div>

    <div class="signal-transmission-box">
      <p class="signal-transmission-title">信号传输</p>
      <SignalTransmissionControls @run="$emit('signal-run')" />
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
import { computed, nextTick, ref, watch } from 'vue'
import { clampSimulationControls, simulationControls } from '@/modules/acoustic/simulationControls.js'
import SignalTransmissionControls from '@/components/acoustic/SignalTransmissionControls.vue'
import { formatCoordPair, nextCoordFormat, parseCoordPair } from '@/utils/coordinateFormat.js'

const props = defineProps({
  point: { type: Object, default: null },
  time: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  hasRun: { type: Boolean, default: false },
})
const emit = defineEmits(['run', 'signal-run', 'close', 'settings'])

const simulation = simulationControls
const coordInputEl = ref(null)
const coordEditing = ref(false)
const coordDraft = ref('')
const coordLon = ref(0)
const coordLat = ref(0)
const coordText = computed(() => formatCoordPair(coordLat.value, coordLon.value, simulation.coordFormat))
const depthM = computed(() => Math.max(0, -Number(props.point?.elevation || 0)))
watch(
  () => [props.point?.lon, props.point?.lat],
  ([lon, lat]) => {
    if (coordEditing.value) return
    if (Number.isFinite(Number(lon))) coordLon.value = Number(lon)
    if (Number.isFinite(Number(lat))) coordLat.value = Number(lat)
  },
  { immediate: true }
)
function cycleCoordFormat() {
  simulation.coordFormat = nextCoordFormat(simulation.coordFormat)
}
function beginCoordEdit() {
  coordDraft.value = formatCoordPair(coordLat.value, coordLon.value, simulation.coordFormat)
  coordEditing.value = true
  nextTick(() => {
    coordInputEl.value?.focus?.()
    coordInputEl.value?.select?.()
  })
}
function cancelCoordEdit() {
  coordEditing.value = false
  coordDraft.value = ''
}
function applyCoordEdit() {
  const coords = parseCoordPair(coordDraft.value)
  if (!coords) return
  coordLat.value = coords.lat
  coordLon.value = coords.lon
  simulation.coordX = coords.lon
  simulation.coordY = coords.lat
  normalize()
  coordEditing.value = false
  coordDraft.value = ''
  // 同步写入 calcParams 后再按新位置运行。
  emit('run')
}
const maxDepthM = computed(() => Math.max(1, Math.round(depthM.value)))
const bathyText = computed(() => (Number.isFinite(depthM.value) ? `${maxDepthM.value} m` : '—'))
const position = computed(() => {
  const x = Number(props.point?.x)
  const y = Number(props.point?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { left: '50%', top: '24%', transform: 'translateX(-50%)' }
  }
  return {
    left: `clamp(8px, ${x + 18}px, calc(100% - 192px))`,
    top: `clamp(70px, ${y - 40}px, calc(100% - 460px))`,
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
  width: 220px;
  max-width: calc(100% - 16px);
  max-height: calc(100% - 42px);
  overflow: auto;
  padding: 8px 9px 9px;
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
header > span { flex: 1; color: #d3eaf4; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.header-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.header-actions button { width: 20px; height: 20px; padding: 0; color: #8194b7; border: 0; background: transparent; cursor: pointer; font-size: 14px; line-height: 1; }
.header-actions button:last-child { color: #dc7181; }
.coords-line { display: flex; align-items: center; gap: 3px; margin: 7px 0 5px; min-width: 0; }
.coords-trigger { flex: 1; min-width: 0; padding: 0; color: #8eb5d0; border: 0; background: transparent; text-align: left; cursor: text; font: 9px ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.coords-trigger:hover { color: #67dfff; }
.coord-input { flex: 1; min-width: 0; height: 22px; padding: 0 4px; color: #d9edf6; border: 1px solid #3fa5c3; border-radius: 4px; background: #071a27; outline: none; font: 9px ui-monospace, monospace; }
.coord-format { flex: none; height: 22px; padding: 0 4px; color: #7bd9f3; border: 1px solid #2b5570; border-radius: 4px; background: #0d2638; cursor: pointer; font: 8px ui-monospace, monospace; letter-spacing: 0.5px; }
.coord-format:hover { border-color: #3fa5c3; background: #14374d; }
.coord-go, .coord-cancel { flex: none; width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border-radius: 4px; cursor: pointer; }
.coord-go { color: #00e9aa; border: 1px solid #00a987; background: #10433d; }
.coord-go svg { width: 12px; height: 12px; }
.coord-cancel { color: #c98b98; border: 1px solid #5a3442; background: #2a1a23; font-size: 14px; line-height: 1; }
.coord-go:hover { border-color: #00e6a5; background: #145a50; }
.coord-cancel:hover { color: #f0b6c2; border-color: #7a4556; }
.volume { display: inline-flex; align-items: center; gap: 4px; color: #00e9ad; font-size: 9px; }
.volume i { width: 5px; height: 5px; border-radius: 50%; background: #00efa5; }
.divider { height: 1px; margin: 7px 0 6px; background: #21445a; }
.section-title { display: flex; align-items: center; gap: 4px; margin: 0 0 5px; color: #7897ad; font-size: 8px; letter-spacing: 0.8px; }
.section-title span { color: #d77a8f; font-size: 7px; }
.rows { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 4px 5px; }
.rows > span { color: #8da9bc; font-size: 9px; white-space: nowrap; }
.rows > b { color: #d9edf6; font-weight: 500; font-family: ui-monospace, monospace; font-size: 9px; }
.inline-field { display: flex; align-items: center; gap: 3px; min-width: 0; }
.inline-field input { width: 56px; height: 23px; padding: 0 5px; color: #d9edf6; border: 1px solid #2b5570; border-radius: 4px; background: #102b3d; outline: none; font: 9px ui-monospace, monospace; }
.inline-field input:focus { border-color: #3fa5c3; }
.inline-field em { color: #7d9bae; font-style: normal; font-size: 8px; }
.inline-field small { display: none; }
.signal-transmission-box { margin-top: 8px; padding: 7px; border: 1px solid #21445a; border-radius: 6px; background: #0a2334; }
.signal-transmission-title { margin: 0 0 6px; color: #7897ad; font-size: 8px; letter-spacing: 0.8px; }
.signal-transmission-box :deep(.signal-transmission-controls) { gap: 6px; font-size: 9px; }
.signal-transmission-box :deep(.st-select) { grid-template-columns: 1fr 82px; gap: 5px; }
.signal-transmission-box :deep(.st-select select) { height: 23px; padding: 0 5px; font-size: 9px; }
.signal-transmission-box :deep(.st-number) { gap: 3px; }
.signal-transmission-box :deep(.st-number input) { height: 23px; padding: 0 5px; font-size: 9px; }
.signal-transmission-box :deep(.st-number em) { font-size: 8px; }
.signal-transmission-box :deep(.st-switch) { min-height: 20px; }
.signal-transmission-box :deep(.st-run) { height: 25px; font-size: 9px; }
.signal-transmission-box :deep(.st-run svg) { width: 12px; height: 12px; }
.signal-transmission-box :deep(.st-track) { width: 32px; height: 17px; }
.signal-transmission-box :deep(.st-track i) { top: 2px; left: 2px; width: 11px; height: 11px; }
.signal-transmission-box :deep(.st-switch input:checked + .st-track i) { transform: translateX(15px); }
nav { display: flex; margin-top: 8px; }
.run-action { width: 100%; height: 27px; display: flex; align-items: center; justify-content: center; gap: 5px; color: #00e9aa; border: 1px solid #00a987; border-radius: 5px; background: #10433d; cursor: pointer; font-size: 9px; }
.run-action svg { width: 14px; height: 14px; }
.run-action:disabled { opacity: 0.45; cursor: default; }
.run-action:not(:disabled):hover { border-color: #00e6a5; background: #145a50; }
@keyframes pulse { to { opacity: 0.3; } }
</style>
