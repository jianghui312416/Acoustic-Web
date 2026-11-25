<template>
  <div class="se-panel" @click.stop>
    <div class="se-body">
      <label class="se-switch">
        <span>信号余量渲染</span>
        <input v-model="state.enabled" type="checkbox" />
        <i></i>
      </label>

      <!-- <p class="se-label">接球手（跑动标记）</p>
      <select v-model="state.receiver" class="se-select">
        <option v-for="option in receiverOptions" :key="option" :value="option">{{ option }}</option>
      </select> -->

      <p class="se-label">目标</p>
      <div class="se-targets">
        <button v-for="target in targetPresets" :key="target.label" type="button"
          :class="{ active: state.sourceLevel === target.level }" @click="selectTarget(target)">{{ target.label }}</button>
      </div>

      <div class="se-row"><span>目标源级别</span><b>{{ state.sourceLevel }} 分贝</b></div>
      <input v-model.number="state.sourceLevel" class="se-range" type="range" min="60" max="200" step="1" />

      <div class="se-depth">
        <div class="se-depth-controls">
          <div class="se-row"><span>目标最小深度</span><b>{{ state.fullDepth ? '全深度' : `${state.minDepth} 米` }}</b></div>
          <input v-model.number="state.minDepth" class="se-range" type="range" min="0" :max="state.maxDepth" step="1" :disabled="state.fullDepth" />

          <div class="se-row"><span>目标最大深度</span><b>{{ state.fullDepth ? '全深度' : `${state.maxDepth} 米` }}</b></div>
          <input v-model.number="state.maxDepth" class="se-range" type="range" :min="state.minDepth" max="500" step="1" :disabled="state.fullDepth" />
        </div>
        <button type="button" class="se-full-depth" :class="{ active: state.fullDepth }"
          :aria-pressed="state.fullDepth" @click="state.fullDepth = !state.fullDepth">全深度模拟</button>
      </div>

      <!-- <div class="se-band">
        <span>乐队 <em>→</em></span>
        <div class="se-band-buttons">
          <button v-for="band in bandOptions" :key="band" type="button"
            :class="{ active: state.band === band }" @click="state.band = band">{{ band }}</button>
        </div>
      </div> -->

      <p class="se-label">{{ rangeLabel }}</p>
      <div class="se-db-grid">
        <div class="se-db-cell"><span>Min</span><input v-model.number="rangeMin" type="number" :min="isPdMode ? 0 : undefined" :max="isPdMode ? 99 : undefined" step="1" @blur="normalizeDisplayRange" /><em>{{ unitLabel }}</em></div>
        <div class="se-db-cell"><span>Max</span><input v-model.number="rangeMax" type="number" :min="isPdMode ? 1 : undefined" :max="isPdMode ? 100 : undefined" step="1" @blur="normalizeDisplayRange" /><em>{{ unitLabel }}</em></div>
      </div>
      <div class="se-colorbar" :style="{ background: seGradient }"></div>

      <p class="se-section">检测</p>

      <div class="se-row"><span>检测阈值（PD 50%）</span><b>{{ state.detectionThreshold }} 分贝</b></div>
      <input v-model.number="state.detectionThreshold" class="se-range" type="range" min="0" max="40" step="1" />

      <div class="se-row"><span>阵列增益</span><b>{{ state.arrayGain }} 分贝</b></div>
      <input v-model.number="state.arrayGain" class="se-range" type="range" min="0" max="30" step="1" />


      <div v-if="hasForecast" class="se-forecast">
        <div class="se-row"><span>预报时间（NL）</span><b>{{ forecastTimeText }} · +{{ frameIndex }} 小时</b></div>
        <input class="se-range" type="range" min="0" :max="maxFrameIndex" step="1" :value="frameIndex" aria-label="环境噪声预报小时" @input="onForecastInput" />
      </div>

      <div class="se-band">
        <span>展示 <em>→</em></span>
        <div class="se-band-buttons">
          <button type="button" :class="{ active: state.displayMode === 'margin' }" @click="state.displayMode = 'margin'">Margin（dB）</button>
          <button type="button" :class="{ active: state.displayMode === 'pd' }" @click="state.displayMode = 'pd'">Pd（%）</button>
        </div>
      </div>
      <div class="se-band se-three-color-row">
        <span>三色 <em>→</em></span>
        <button type="button" class="se-three-color" :class="{ active: state.threeColor }" :aria-pressed="state.threeColor" @click="state.threeColor = !state.threeColor">
          {{ state.threeColor ? '已开启' : '已关闭' }}
        </button>
      </div>
      <p v-if="state.threeColor" class="se-tricolor-note"><i class="hidden"></i>&lt;25% 不显示　<i class="black"></i>25–50%　<i class="yellow"></i>50–75%　<i class="red"></i>&gt;75%</p>

      <p class="se-note">SE = SL − TL − NL − DT + AG · NL {{ noiseLevelText }} dB</p>
      <p class="se-formula">Pd = Φ(SE / σ)，σ = {{ state.sigma }} dB</p>
      <p v-if="!hasNoiseLevel" class="se-hint">需先在「天气与环境噪声」加载预报以获取 NL。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { signalExcessState as state } from '@/modules/acoustic/signalExcessState.js'
import {
  currentWeatherNoiseFrame, forecastNoiseSummary, setWeatherNoiseFrame, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import { formatForecastTime } from '@/utils/weatherNoiseForecast.js'
import { buildDetectionClassGradient, SIGNAL_EXCESS_COLOR_STOPS } from '@/utils/signalExcess.js'
import {
  contrastedVolumeColorStops,
  volumeRenderingControls,
} from '@/modules/acoustic/volumeRenderingControls.js'

const receiverOptions = [
  '自动 — 已选择/最新，音量为 TL',
  '当前声源接收阵',
  '最新工作声场接收阵',
]

const targetPresets = [
  { label: '非常安静 120', level: 120 },
  { label: '安静 140', level: 140 },
  { label: '渔船 160', level: 160 },
  { label: '大型船 180', level: 180 },
]

const bandOptions = ['最大', '均值', '最小']
const defaultDbRange = { dbMin: -60, dbMax: 60, pdMin: 0, pdMax: 100 }

const rangeMin = computed({
  get: () => isPdMode.value ? state.pdMin : state.dbMin,
  set: (value) => { state[isPdMode.value ? 'pdMin' : 'dbMin'] = value },
})
const rangeMax = computed({
  get: () => isPdMode.value ? state.pdMax : state.dbMax,
  set: (value) => { state[isPdMode.value ? 'pdMax' : 'dbMax'] = value },
})

const seGradient = computed(() => {
  if (state.threeColor) {
    return buildDetectionClassGradient(rangeMin.value, rangeMax.value, state.displayMode, state.sigma)
  }
  const stops = contrastedVolumeColorStops(SIGNAL_EXCESS_COLOR_STOPS, volumeRenderingControls.contrast)
  return `linear-gradient(90deg, ${stops
    .map(([t, rgb]) => `rgb(${rgb.join(',')}) ${(t * 100).toFixed(1)}%`)
    .join(', ')})`
})

const noiseLevelText = computed(() => {
  const level = Number(forecastNoiseSummary.value?.bandLevelDb)
  return Number.isFinite(level) ? level.toFixed(1) : '—'
})
const hasNoiseLevel = computed(() => Number.isFinite(Number(forecastNoiseSummary.value?.bandLevelDb)))

const isPdMode = computed(() => state.displayMode === 'pd')
const rangeLabel = computed(() => (isPdMode.value ? 'Pd 范围' : 'dB 范围'))
const unitLabel = computed(() => (isPdMode.value ? '%' : 'dB'))

// 预报时间滑杆：与「天气与环境噪声」共享同一 frameIndex，同步改变 NL。
const frameCount = computed(() => weatherNoiseState.result?.frames?.length || 0)
const hasForecast = computed(() => frameCount.value > 0)
const maxFrameIndex = computed(() => Math.max(0, frameCount.value - 1))
const frameIndex = computed(() => weatherNoiseState.frameIndex)
const forecastTimeText = computed(() => formatForecastTime(currentWeatherNoiseFrame.value?.time))

function onForecastInput(event) {
  setWeatherNoiseFrame(Number(event.target.value))
}

function restoreDbRangeValue(key) {
  const value = state[key]
  if (value === '' || value == null || !Number.isFinite(Number(value))) {
    state[key] = defaultDbRange[key]
  }
}

function normalizeDisplayRange() {
  const minKey = isPdMode.value ? 'pdMin' : 'dbMin'
  const maxKey = isPdMode.value ? 'pdMax' : 'dbMax'
  restoreDbRangeValue(minKey)
  restoreDbRangeValue(maxKey)
  let min = Number(state[minKey])
  let max = Number(state[maxKey])
  if (isPdMode.value) {
    min = Math.min(99, Math.max(0, min))
    max = Math.min(100, Math.max(1, max))
  }
  if (!(max > min)) max = isPdMode.value ? Math.min(100, min + 1) : min + 1
  if (!(max > min)) min = max - 1
  state[minKey] = min
  state[maxKey] = max
}

onMounted(() => {
  restoreDbRangeValue('dbMin')
  restoreDbRangeValue('dbMax')
  restoreDbRangeValue('pdMin')
  restoreDbRangeValue('pdMax')
  normalizeDisplayRange()
})

function selectTarget(target) {
  state.sourceLevel = target.level
}
</script>

<style scoped>
.se-panel { margin:5px 0 3px; border:1px solid #244057; border-radius:7px; background:#0d1c2d; color:#91adbe; font:10px/1.35 'Microsoft YaHei',sans-serif; overflow:hidden; }
.se-panel * { box-sizing:border-box; }
.se-head { display:flex; align-items:center; gap:6px; padding:7px 8px; background:#0a1725; border-bottom:1px solid #1c3448; }
.se-head-icon { display:flex; width:16px; height:16px; color:#5ad7ea; }
.se-head-icon svg { width:100%; height:100%; }
.se-head-title { flex:1; color:#d7e8ef; font-size:11px; font-weight:600; }
.se-head-chevron { color:#5e8499; font-size:10px; }
.se-body { display:flex; flex-direction:column; padding:8px 8px 10px; }
.se-switch { position:relative; display:flex; align-items:center; justify-content:space-between; margin:2px 1px 8px; color:#d7e8ef; font-size:11px; }
.se-switch input { position:absolute; right:0; z-index:2; width:38px; height:19px; opacity:0; cursor:pointer; }
.se-switch i { position:relative; width:38px; height:19px; border:1px solid #37617d; border-radius:11px; background:#20384f; }
.se-switch i:after { content:''; display:block; width:15px; height:15px; margin:1px; border-radius:50%; background:#6b8aaa; transition:.15s; }
.se-switch input:checked + i { background:#0d5e90; border-color:#42a7e4; }
.se-switch input:checked + i:after { transform:translateX(18px); background:#62bcff; }
.se-label { margin:6px 1px 4px; color:#9db8c7; }
.se-select { width:100%; height:26px; padding:0 7px; color:#cfe6f5; background:#102b3f; border:1px solid #2e6078; border-radius:5px; font:10px 'Microsoft YaHei',sans-serif; }
.se-targets { display:flex; flex-wrap:wrap; gap:4px; }
.se-targets button, .se-band-buttons button { padding:4px 7px; color:#a9cad9; background:#132c40; border:1px solid #2e6078; border-radius:5px; font:10px 'Microsoft YaHei',sans-serif; white-space:nowrap; cursor:pointer; }
.se-targets button.active, .se-band-buttons button.active { color:#eafaff; background:#1b587a; border-color:#5fb6dd; }
.se-row { display:flex; align-items:baseline; justify-content:space-between; margin:9px 1px 2px; color:#9db8c7; }
.se-row b { color:#59dff5; font-family:ui-monospace,monospace; font-size:10px; }
.se-range { width:100%; height:3px; margin:2px 0 4px; accent-color:#35d5e7; cursor:pointer; }
.se-range:disabled { opacity:.4; cursor:not-allowed; }
.se-depth { display:flex; align-items:stretch; gap:8px; }
.se-depth-controls { flex:1; min-width:0; }
.se-full-depth { flex:0 0 54px; align-self:center; padding:6px 4px; color:#a9cad9; background:#132c40; border:1px solid #2e6078; border-radius:5px; font:10px/1.35 'Microsoft YaHei',sans-serif; cursor:pointer; }
.se-full-depth.active { color:#eafaff; background:#1b587a; border-color:#5fb6dd; }
.se-band { display:flex; align-items:center; gap:8px; margin:10px 1px 2px; color:#9db8c7; }
.se-band em { color:#59dff5; font-style:normal; }
.se-band-buttons { display:flex; flex:1; gap:4px; }
.se-band-buttons button { flex:1; }
.se-three-color-row { margin-top:6px; }
.se-three-color { flex:1; height:25px; color:#a9cad9; background:#132c40; border:1px solid #2e6078; border-radius:5px; font:10px 'Microsoft YaHei',sans-serif; cursor:pointer; }
.se-three-color.active { color:#07121a; background:linear-gradient(90deg,#111 0 33%,#ffff00 33% 66%,#ff0000 66%); border-color:#f3c94f; font-weight:700; text-shadow:0 1px rgba(255,255,255,.45); }
.se-tricolor-note { margin:5px 1px 2px; color:#7899aa; font-size:8px; line-height:1.6; }
.se-tricolor-note i { display:inline-block; width:8px; height:8px; margin-right:2px; border:1px solid #496275; vertical-align:-1px; }
.se-tricolor-note i.hidden { background:transparent; }
.se-tricolor-note i.black { background:#000; }
.se-tricolor-note i.yellow { background:#ffff00; }
.se-tricolor-note i.red { background:#ff0000; }
.se-section { margin:11px 1px 2px; padding-top:8px; color:#5e8499; font-size:10px; border-top:1px solid #1c3448; }
.se-db-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 6px; }
.se-db-cell { display:flex; align-items:center; gap:4px; color:#7f9eaf; }
.se-db-cell span { width:20px; }
.se-db-cell input { width:100%; min-width:0; height:22px; padding:0 4px; color:#d3e8f0; background:#102b3f; border:1px solid #2e6078; border-radius:4px; font:10px ui-monospace,monospace; }
.se-db-cell em { color:#5e8499; font-size:8px; font-style:normal; }
.se-colorbar { height:7px; margin:6px 1px 2px; border-radius:3px; border:1px solid #274257; }
.se-note { margin:10px 1px 0; padding-top:7px; border-top:1px solid #1c3448; color:#6b8ba0; font:9px ui-monospace,monospace; }
.se-formula { margin:4px 1px 0; color:#6b8ba0; font:9px ui-monospace,monospace; }
.se-hint { margin:5px 1px 0; color:#eabf61; font-size:9px; line-height:1.4; }
.se-forecast { margin:9px 1px 2px; padding-top:7px; border-top:1px solid #1c3448; }
.se-db-cell b.se-fixed { color:#59dff5; font-family:ui-monospace,monospace; font-size:10px; font-weight:400; }
</style>
