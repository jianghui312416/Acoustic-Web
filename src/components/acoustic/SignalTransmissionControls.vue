<template>
  <div class="signal-transmission-controls">
    <label class="st-select">
      <span>船舶选择</span>
      <select v-model="aisMonitorState.selectedMmsi" aria-label="船舶选择" @change="applySelectedVessel">
        <option :value="null">不选择船舶</option>
        <option v-for="vessel in vessels" :key="vessel.mmsi" :value="vessel.mmsi">
          {{ vesselLabel(vessel) }}
        </option>
      </select>
    </label>

    <label class="st-select">
      <span>船舶航速</span>
      <span class="st-number">
        <input
          v-if="selectedVessel"
          :value="selectedVesselSpeed"
          type="number"
          aria-label="AIS 船舶航速"
          readonly
          :placeholder="selectedVesselSpeed === '' ? 'AIS 缺失' : ''"
        />
        <input
          v-else
          v-model.number="state.vesselSpeedKn"
          type="number"
          min="0.1"
          max="60"
          step="0.1"
          aria-label="手动船舶航速"
          @change="normalize"
        />
        <em>{{ selectedVessel ? 'kn · AIS' : 'kn' }}</em>
      </span>
    </label>

    <label class="st-select">
      <span>发射声源级</span>
      <span class="st-number">
        <input
          v-if="selectedVessel"
          :value="selectedVesselSourceLevel"
          type="number"
          aria-label="AIS 船舶声源级"
          readonly
        />
        <input v-else v-model.number="state.sourceLevelDb" type="number" step="1" aria-label="发射声源级" @change="normalize" />
        <em>{{ selectedVessel ? 'dB · AIS' : 'dB' }}</em>
      </span>
    </label>

    <label class="st-select">
      <span>频率设置</span>
      <span class="st-number">
        <input
          v-model="state.frequencyHzText"
          type="text"
          placeholder="84, 126"
          title="可设置多个频率，用逗号或空格分隔"
          aria-label="频率设置"
          :disabled="Boolean(selectedVessel)"
          @change="normalize"
        />
        <em>Hz</em>
      </span>
    </label>
    <div class="st-waveform-preview" aria-label="发射信号时域图预览">
      <header>
        <span>发射信号时域预览</span>
        <b>{{ selectedVessel ? 'AIS 船舶谱合成' : '手动频率合成' }}</b>
      </header>
      <svg viewBox="0 0 250 104" role="img" aria-label="时间与归一化声压波形">
        <g class="st-waveform-grid">
          <line v-for="tick in waveformChart.yTicks" :key="`y-${tick.value}`" x1="34" x2="242" :y1="tick.y" :y2="tick.y" />
          <line v-for="tick in waveformChart.xTicks" :key="`x-${tick.value}`" :x1="tick.x" :x2="tick.x" y1="9" y2="80" />
        </g>
        <path v-if="waveformChart.path" class="st-waveform-area" :d="waveformChart.areaPath" />
        <path v-if="waveformChart.path" class="st-waveform-line" :d="waveformChart.path" />
        <text v-for="tick in waveformChart.yTicks" :key="`yl-${tick.value}`" x="30" :y="tick.y + 3" text-anchor="end">{{ tick.label }}</text>
        <text v-for="tick in waveformChart.xTicks" :key="`xl-${tick.value}`" :x="tick.x" y="94" text-anchor="middle">{{ tick.label }}</text>
        <text x="138" y="103" text-anchor="middle">时间 / ms</text>
      </svg>
      <footer><span>归一化声压 −1～+1</span><b>{{ waveformChart.summary }}</b></footer>
    </div>
    <p v-if="selectedVessel" class="st-track-help">
      已使用该船舶的 20 Hz–20 kHz 声源谱；频率设置在选船模式下不起作用。
    </p>

    <label class="st-select">
      <span>航行深度</span>
      <span class="st-number">
        <input v-model.number="state.navigationDepthM" type="number" min="0" step="1" aria-label="航行深度" @change="normalize" />
        <em>m</em>
      </span>
    </label>

    <label class="st-select">
      <span>水听器深度</span>
      <span class="st-number">
        <input v-model.number="state.receiverDepthM" type="number" min="0.01" step="1" aria-label="水听器深度" @change="normalize" />
        <em>m</em>
      </span>
    </label>

    <details class="st-advanced">
      <summary>传播与多途</summary>
      <div class="st-advanced-body">
        <div class="st-fixed-model">
          <span>到达结构</span>
          <b>Bellhop arrivals</b>
        </div>
        <p class="st-track-help">每个分钟站位重新计算；三维声场使用“仿真配置”选择的模型。</p>
        <label class="st-select">
          <span>到达波束数</span>
          <span class="st-number">
            <input v-model.number="state.arrivalBeamCount" type="number" min="1" max="100001" step="100" aria-label="Bellhop 到达波束数" @change="normalize" />
          </span>
        </label>
      </div>
    </details>

    <details class="st-advanced">
      <summary>接收机与数字化</summary>
      <div class="st-advanced-body">
        <label class="st-select">
          <span>水听器</span>
          <select v-model="state.hydrophone" aria-label="水听器型号" @change="applyHydrophoneChange">
            <option value="BK-8103">B&amp;K 8103</option>
            <option value="BK-8106">B&amp;K 8106（内置前放）</option>
            <option value="RESON-TC4013">Reson TC4013</option>
          </select>
        </label>
        <label class="st-select">
          <span>采样率</span>
          <select v-model.number="state.sampleRate" aria-label="采样率" @change="normalize">
            <option v-for="rate in [8000, 16000, 24000, 48000, 96000]" :key="rate" :value="rate">{{ rate / 1000 }} kHz</option>
          </select>
        </label>
        <label class="st-select">
          <span>{{ preampGainLabel }}</span>
          <span class="st-number"><input v-model.number="state.preampGainDb" type="number" step="1" :aria-label="preampGainLabel" @change="normalize" /><em>dB</em></span>
        </label>
        <p v-if="state.hydrophone === 'BK-8106'" class="st-track-help">
          8106 灵敏度曲线已包含内置前放；此处仅填写额外外置前放，未连接时保持 0 dB。
        </p>
        <label class="st-select">
          <span>ADC 位数</span>
          <select v-model.number="state.adcBits" aria-label="ADC 位数" @change="normalize">
            <option v-for="bits in [16, 24, 32]" :key="bits" :value="bits">{{ bits }} bit</option>
          </select>
        </label>
        <label class="st-select">
          <span>ADC 满量程</span>
          <span class="st-number"><input v-model.number="state.adcFullScaleV" type="number" min="0.000001" step="0.1" aria-label="ADC 满量程" @change="normalize" /><em>±V</em></span>
        </label>
      </div>
    </details>

    <label class="st-switch">
      <input v-model="state.showReceiver" type="checkbox" />
      <span class="st-track"><i></i></span>
      <span class="st-label">接收位置</span>
    </label>

    <label class="st-switch">
      <input v-model="state.selectTrackPoints" type="checkbox" :disabled="Boolean(selectedVessel)" />
      <span class="st-track"><i></i></span>
      <span class="st-label">航迹点选择</span>
    </label>
    <p v-if="selectedVessel" class="st-track-help">
      航迹从 AIS 当前位置出发，按原航向和原航速前进，最大航程 1 海里。
    </p>
    <p v-if="state.selectTrackPoints" class="st-track-help">
      在地形区域单击添加发射点，右键撤销最后一点，双击仅结束选择且不计入航迹；相邻点间常驻标注距离，一个点表示固定发射位置。
    </p>

    <p class="st-section-title">显示</p>

    <label class="st-switch">
      <input v-model="state.showSourceTimeFrequency" type="checkbox" :disabled="!trackSelectionReady" />
      <span class="st-track"><i></i></span>
      <span class="st-label">声源处时频图</span>
    </label>

    <label class="st-switch">
      <input v-model="state.showSourceWaveform" type="checkbox" :disabled="!trackSelectionReady" />
      <span class="st-track"><i></i></span>
      <span class="st-label">声源处时域图</span>
    </label>

    <p v-if="!trackSelectionReady" class="st-receiver-required">请先完成航迹点选择，再打开声源处时频图或时域图</p>

    <label class="st-switch">
      <input v-model="state.showTimeFrequency" type="checkbox" :disabled="!state.receiverReady" />
      <span class="st-track"><i></i></span>
      <span class="st-label">接收处时频图</span>
    </label>

    <label class="st-switch">
      <input v-model="state.showWaveform" type="checkbox" :disabled="!state.receiverReady" />
      <span class="st-track"><i></i></span>
      <span class="st-label">接收处时域图</span>
    </label>

    <div class="st-display-mode" aria-label="声源与接收处时频图频率刻度">
      <span>时频图 <em>→</em></span>
      <div class="st-display-mode-buttons">
        <button
          type="button"
          :class="{ active: state.spectrogramFrequencyScale === 'log' }"
          :aria-pressed="state.spectrogramFrequencyScale === 'log'"
          @click="state.spectrogramFrequencyScale = 'log'"
        >对数</button>
        <button
          type="button"
          :class="{ active: state.spectrogramFrequencyScale === 'linear' }"
          :aria-pressed="state.spectrogramFrequencyScale === 'linear'"
          @click="state.spectrogramFrequencyScale = 'linear'"
        >线性</button>
      </div>
    </div>

    <label class="st-switch">
      <input
        :checked="spectrogramReadout.enabled"
        type="checkbox"
        @change="setSpectrogramReadoutEnabled($event.target.checked)"
      />
      <span class="st-track"><i></i></span>
      <span class="st-label st-readout-label"><span aria-hidden="true">🔎</span><span>光标读取</span></span>
    </label>

    <label class="st-switch" :title="staticChannelReady ? '在垂直切面点击修改水听器位置和深度' : '仅完成单个航迹点选择后可用'">
      <input
        v-model="state.sliceReceiverPlacement"
        type="checkbox"
        :disabled="!staticChannelReady"
      />
      <span class="st-track"><i></i></span>
      <span class="st-label st-readout-label"><span aria-hidden="true">⌖</span><span>切面接收位置</span></span>
    </label>

    <p v-if="!state.receiverReady" class="st-receiver-required">请先选择接收位置，再打开时频图或时域图</p>

    <label class="st-select">
      <span>时频/时域展示窗长</span>
      <span class="st-number">
        <input v-model.number="state.simulationDurationS" type="number" min="0.1" :max="maximumDuration" step="1" aria-label="时频和时域窗长" @change="normalize" />
        <em>s</em>
      </span>
    </label>

    <div v-if="!selectedVessel && trackPoints.length" class="st-track-list" aria-label="航迹点列表">
      <header class="st-track-list-head">
        <span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18 9 8l6 7 4-10M5 18h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          航迹点
        </span>
        <b>{{ trackPoints.length }} 个</b>
      </header>
      <ol>
        <li v-for="(point, index) in trackPoints" :key="index">
          <span class="st-point-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="st-point-coordinate"><small>经度</small><b>{{ formatCoordinate(point.lon) }}°</b></span>
          <span class="st-point-coordinate"><small>纬度</small><b>{{ formatCoordinate(point.lat) }}°</b></span>
        </li>
      </ol>
    </div>

    <button
      v-if="state.selectTrackPoints && trackPoints.length >= 1"
      type="button"
      class="st-finish-track"
      @click="finishTrackSelection"
    >✓ 完成航迹（{{ trackPoints.length }} 点）</button>

    <p v-if="session.state !== 'idle'" class="st-session-status" :class="session.state">
      <span>{{ session.error || session.message }}</span><b v-if="session.state === 'running' || session.state === 'finalizing'">{{ session.percent }}%</b>
    </p>

    <button
      type="button"
      class="st-run"
      :class="{ 'is-running': taskRunning }"
      :disabled="!taskRunning && !state.receiverReady"
      @click="onRunButton"
    >
      <svg v-if="!taskRunning" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" fill="currentColor" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /></svg>
      <span>{{ taskRunning ? '停止运行' : '运行完整传输链路' }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import {
  applyHydrophonePreampDefaults,
  combinedTonePreviewDurationS,
  normalizeSignalTransmissionControls,
  signalTransmissionControls,
} from '@/modules/acoustic/signalTransmissionControls.js'
import {
  setSpectrogramReadoutEnabled,
  spectrogramReadout,
} from '@/modules/acoustic/spectrogramReadout.js'
import { signalTransmissionSession } from '@/modules/acoustic/signalTransmissionSession.js'
import {
  aisMonitorState,
  clearSelectedAisVessel,
  rememberSelectedAisVessel,
  selectedAisVessel,
} from '@/modules/ais/aisMonitorStore.js'
import { simulationControls } from '@/modules/acoustic/simulationControls.js'
import { trackPointState } from '@/modules/acoustic/trackPointState.js'
import { finishTrackPoints } from '@/modules/acoustic/trackPointState.js'
import { estimateJomopansEchoSpectrum } from '@/utils/jomopansEcho.js'

const emit = defineEmits(['run', 'stop'])

const state = signalTransmissionControls
const session = signalTransmissionSession
let previousHydrophone = state.hydrophone
let savedExternalPreampGainDb = Number(state.preampGainDb) || 6
const sessionRunning = computed(() => ['connecting', 'running', 'finalizing'].includes(session.state))
const taskRunning = computed(() => sessionRunning.value || session.playbackActive)
function onRunButton() {
  emit(taskRunning.value ? 'stop' : 'run')
}
const maximumDuration = computed(() => 300)
const preampGainLabel = computed(() => (
  state.hydrophone === 'BK-8106' ? '附加外部前放增益' : '前放增益'
))
const vessels = computed(() => {
  const items = [...aisMonitorState.vessels]
  const selected = selectedAisVessel.value
  if (selected && !items.some(item => item.mmsi === selected.mmsi)) items.unshift(selected)
  return items
})
const trackPoints = computed(() => trackPointState.points)
const trackSelectionReady = computed(() => Boolean(
  selectedVessel.value || (trackPointState.points.length > 0 && trackPointState.finished),
))
const staticChannelReady = computed(() => Boolean(
  !selectedVessel.value && trackPointState.finished && trackPointState.points.length === 1,
))
const selectedVessel = computed(() => selectedAisVessel.value)
const selectedVesselSpeed = computed(() => {
  const speed = Number(selectedVessel.value?.sog_kn)
  return Number.isFinite(speed) ? speed.toFixed(1) : ''
})
const selectedVesselSourceLevel = computed(() => {
  const level = Number(selectedVessel.value?.source_level_db)
  return Number.isFinite(level) ? level.toFixed(1) : ''
})
const sourceWaveformComponents = computed(() => {
  if (selectedVessel.value) {
    const spectrum = estimateJomopansEchoSpectrum(selectedVessel.value)
    return spectrum.frequenciesHz.map((frequency, index) => ({
      frequency: Number(frequency),
      level: Number(spectrum.bandLevelsDb[index]),
    }))
  }
  const frequencies = Array.from(state.frequenciesHz || [], Number)
    .filter(frequency => Number.isFinite(frequency) && frequency > 0)
    .sort((a, b) => a - b)
  const sourceLevel = Number(state.sourceLevelDb) || 0
  const bandLevel = sourceLevel - 10 * Math.log10(Math.max(1, frequencies.length))
  return frequencies.map(frequency => ({ frequency, level: bandLevel }))
})
const waveformChart = computed(() => {
  const components = sourceWaveformComponents.value
  if (!components.length) return { path: '', areaPath: '', xTicks: [], yTicks: [], summary: '—' }
  const frequencies = components.map(point => point.frequency)
  const minimumFrequency = Math.min(...frequencies)
  const maximumFrequency = Math.max(...frequencies)
  const durationS = selectedVessel.value
    ? 2 / Math.max(1, minimumFrequency)
    : combinedTonePreviewDurationS(frequencies, 2)
  const sampleCount = Math.min(2401, Math.max(401, Math.ceil(durationS * maximumFrequency * 3) + 1))
  const maximumLevel = Math.max(...components.map(point => point.level))
  const amplitudes = components.map(point => 10 ** ((point.level - maximumLevel) / 20))
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const timeS = durationS * index / (sampleCount - 1)
    return components.reduce((sum, point, componentIndex) => (
      sum + amplitudes[componentIndex] * Math.sin(
        2 * Math.PI * point.frequency * timeS
          + (selectedVessel.value ? componentIndex * 0.37 : 0),
      )
    ), 0)
  })
  const peak = Math.max(1e-12, ...samples.map(value => Math.abs(value)))
  const left = 34
  const right = 242
  const top = 9
  const bottom = 80
  const middle = (top + bottom) / 2
  const xFor = index => left + index / (sampleCount - 1) * (right - left)
  const yFor = value => middle - value / peak * (bottom - top) * 0.46
  const points = samples.map((value, index) => ({ x: xFor(index), y: yFor(value) }))
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  const areaPath = `${path} L ${points.at(-1).x.toFixed(2)} ${middle} L ${points[0].x.toFixed(2)} ${middle} Z`
  const xTicks = [0, 0.5, 1].map(ratio => ({
    value: ratio,
    x: left + ratio * (right - left),
    label: String(Number((durationS * 1000 * ratio).toFixed(1))),
  }))
  const yTicks = [1, 0, -1].map(value => ({ value, y: yFor(value * peak), label: value > 0 ? '+1' : String(value) }))
  const manualFrequencyLabel = frequencies.length === 2
    ? `${frequencies.map(value => `${Math.round(value)} Hz`).join(' + ')} 双频`
    : frequencies.length <= 3
      ? frequencies.map(value => `${Math.round(value)} Hz`).join(' + ')
    : `${Math.round(minimumFrequency)}–${Math.round(maximumFrequency)} Hz`
  return {
    path, areaPath, xTicks, yTicks,
    summary: selectedVessel.value
      ? '20 Hz–20 kHz · 2个低频周期'
      : `${manualFrequencyLabel} · 2个重复周期`,
  }
})

function normalize() {
  normalizeSignalTransmissionControls(state)
}

function applyHydrophoneChange() {
  savedExternalPreampGainDb = applyHydrophonePreampDefaults(
    state,
    previousHydrophone,
    savedExternalPreampGainDb,
  )
  previousHydrophone = state.hydrophone
}

function vesselLabel(vessel) {
  const name = vessel.vessel_name || `MMSI ${vessel.mmsi}`
  return vessel.source_level_db == null ? name : `${name} · ${vessel.source_level_db} dB`
}

function formatCoordinate(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(4) : '—'
}

function applySelectedVessel() {
  const vessel = vessels.value.find((item) => item.mmsi === aisMonitorState.selectedMmsi)
  if (!vessel) {
    clearSelectedAisVessel()
    state.selectTrackPoints = false
    normalizeSignalTransmissionControls(state)
    return
  }
  rememberSelectedAisVessel(vessel)
  const lon = Number(vessel.longitude)
  const lat = Number(vessel.latitude)
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    simulationControls.coordX = Number(lon.toFixed(6))
    simulationControls.coordY = Number(lat.toFixed(6))
  }
  state.selectTrackPoints = false
  normalizeSignalTransmissionControls(state)
}

function finishTrackSelection() {
  if (!finishTrackPoints()) return
  state.selectTrackPoints = false
}
</script>

<style scoped>
.signal-transmission-controls {
  display: grid;
  gap: 8px;
  min-width: 0;
  color: #a9c1cf;
  font-size: 11px;
}

.st-select {
  display: grid;
  grid-template-columns: 1fr minmax(0, 104px);
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.st-fixed-model {
  display: grid;
  grid-template-columns: 1fr minmax(0, 104px);
  align-items: center;
  gap: 8px;
  color: #b5cfdb;
}

.st-fixed-model b {
  color: #65e6d1;
  font: 10px ui-monospace, monospace;
  text-align: right;
}

.st-select > span {
  min-width: 0;
  overflow: hidden;
  color: #b5cfdb;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-select select {
  width: 100%;
  min-width: 0;
  height: 27px;
  padding: 0 8px;
  color: #dceff6;
  border: 1px solid rgba(95, 158, 184, 0.4);
  border-radius: 4px;
  outline: none;
  background: rgba(24, 58, 79, 0.92);
  font: inherit;
  cursor: pointer;
}

.st-select select:focus {
  border-color: #2fc4f1;
  box-shadow: 0 0 0 2px rgba(47, 196, 241, 0.12);
}

.st-select select option {
  color: #dceff6;
  background: #0f172a;
}

.st-display-mode { display:flex; align-items:center; gap:8px; margin:0 1px 2px; color:#9db8c7; }
.st-display-mode > span { flex:none; white-space:nowrap; }.st-display-mode em { color:#59dff5; font-style:normal; }
.st-display-mode-buttons { display:flex; flex:1; gap:4px; }
.st-display-mode-buttons button { flex:1; height:25px; padding:0 8px; color:#a9cad9; border:1px solid #2e6078; border-radius:5px; background:#132c40; cursor:pointer; font:10px 'Microsoft YaHei',sans-serif; }
.st-display-mode-buttons button.active { color:#eafaff; border-color:#5fb6dd; background:#1b587a; }

.st-number {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: visible;
}

.st-number input {
  width: 100%;
  min-width: 0;
  height: 27px;
  padding: 0 7px;
  color: #dceff6;
  border: 1px solid rgba(95, 158, 184, 0.4);
  border-radius: 4px;
  outline: none;
  background: rgba(24, 58, 79, 0.92);
  font: inherit;
  appearance: textfield;
}

.st-number input::-webkit-inner-spin-button {
  appearance: none;
}

.st-number input:focus {
  border-color: #2fc4f1;
  box-shadow: 0 0 0 2px rgba(47, 196, 241, 0.12);
}

.st-number input[readonly] {
  color: #8fd8ef;
  border-color: rgba(72, 174, 206, 0.46);
  background: rgba(18, 65, 84, 0.78);
  cursor: default;
}

.st-number input:disabled {
  color: #688797;
  border-color: rgba(82, 118, 132, 0.34);
  background: rgba(17, 43, 56, 0.7);
  cursor: not-allowed;
}

.st-number em {
  flex: none;
  color: #7d9bae;
  font-style: normal;
  font-size: 9px;
}

.st-track-list {
  overflow: hidden;
  border: 1px solid rgba(95, 158, 184, 0.32);
  border-radius: 7px;
  background: linear-gradient(180deg, rgba(15, 42, 61, 0.9), rgba(9, 29, 45, 0.84));
}

.st-track-help {
  margin: -3px 2px 4px;
  color: rgba(179, 215, 228, 0.78);
  font-size: 10px;
  line-height: 1.55;
}

.st-waveform-preview {
  overflow: hidden;
  border: 1px solid rgba(72, 158, 188, 0.34);
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(8, 34, 50, 0.9), rgba(5, 24, 38, 0.82));
}

.st-waveform-preview header,
.st-waveform-preview footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  color: #8eb7c8;
  font-size: 9px;
}

.st-waveform-preview header { border-bottom: 1px solid rgba(72, 158, 188, 0.18); }
.st-waveform-preview footer { border-top: 1px solid rgba(72, 158, 188, 0.16); }
.st-waveform-preview header b { color: #5ce1c6; font-weight: 500; }
.st-waveform-preview footer b { color: #76cfe6; font: 500 8px ui-monospace, monospace; }
.st-waveform-preview svg { width: 100%; height: 104px; display: block; }
.st-waveform-preview svg text { fill: #65899b; font: 7px ui-monospace, monospace; }
.st-waveform-grid line { stroke: rgba(75, 136, 159, 0.2); stroke-width: 0.7; }
.st-waveform-area { fill: rgba(52, 202, 224, 0.1); }
.st-waveform-line { fill: none; stroke: #45d9f2; stroke-width: 1.15; stroke-linejoin: round; stroke-linecap: round; filter: drop-shadow(0 0 2px rgba(69, 217, 242, 0.45)); }

.st-advanced {
  overflow: hidden;
  border: 1px solid rgba(95, 158, 184, 0.3);
  border-radius: 6px;
  background: rgba(7, 31, 46, 0.55);
}

.st-advanced summary {
  padding: 7px 8px;
  color: #79b8cc;
  background: rgba(18, 57, 77, 0.55);
  cursor: pointer;
  user-select: none;
}

.st-advanced-body {
  display: grid;
  gap: 7px;
  padding: 8px;
}

.st-track-list-head {
  height: 29px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  color: #8ccce1;
  border-bottom: 1px solid rgba(95, 158, 184, 0.22);
  background: rgba(17, 53, 73, 0.68);
}

.st-track-list-head span {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
}

.st-track-list-head svg {
  width: 14px;
  height: 14px;
  color: #55dcf4;
}

.st-track-list-head b {
  color: #6de5c4;
  font: 500 9px ui-monospace, monospace;
}

.st-track-list ol {
  max-height: 146px;
  margin: 0;
  padding: 5px;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: rgba(95, 158, 184, 0.55) transparent;
}

.st-track-list li {
  min-height: 36px;
  display: grid;
  grid-template-columns: 25px 1fr 1fr;
  align-items: center;
  gap: 7px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 5px;
}

.st-track-list li + li {
  margin-top: 3px;
}

.st-track-list li:hover {
  border-color: rgba(69, 183, 219, 0.32);
  background: rgba(30, 82, 104, 0.38);
}

.st-point-index {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  color: #62e3f4;
  border: 1px solid rgba(74, 190, 220, 0.5);
  border-radius: 50%;
  background: rgba(13, 72, 93, 0.72);
  font: 600 8px ui-monospace, monospace;
}

.st-point-coordinate {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.st-point-coordinate small {
  color: #668ea1;
  font-size: 8px;
}

.st-point-coordinate b {
  overflow: hidden;
  color: #d5eaf2;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 9px ui-monospace, monospace;
}

.st-track-list ol::-webkit-scrollbar {
  width: 5px;
}

.st-track-list ol::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(95, 158, 184, 0.55);
}

.st-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 10px 0 7px;
  color: #5f849c;
  font-size: 10px;
  letter-spacing: 0.5px;
}

.st-section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #274257;
}

.st-readout-label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.st-readout-label > span:first-child {
  flex: none;
  font-size: 11px;
}

.st-switch {
  position: relative;
  width: 100%;
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #a9c1cf;
  cursor: pointer;
}

.st-switch input {
  position: absolute;
  z-index: 2;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.st-switch:has(input:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

.st-switch input:disabled {
  cursor: not-allowed;
}

.st-receiver-required {
  margin: -3px 0 1px;
  color: #d5a26d;
  font-size: 9px;
  line-height: 1.35;
}

.st-label {
  order: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-track {
  position: relative;
  order: 2;
  flex: 0 0 auto;
  width: 38px;
  height: 20px;
  box-sizing: border-box;
  border-radius: 999px;
  border: 1px solid #365875;
  background: #223a55;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.st-track i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #819fbe;
  box-shadow: 0 1px 3px rgba(0, 7, 17, 0.48);
  transition: transform 0.18s ease, background 0.18s ease;
}

.st-switch input:focus-visible + .st-track {
  outline: 2px solid rgba(83, 207, 242, 0.72);
  outline-offset: 2px;
}

.st-switch input:checked + .st-track {
  border-color: #3f9fe2;
  background: #12649a;
  box-shadow: inset 0 0 8px rgba(59, 174, 255, 0.2);
}

.st-switch input:checked + .st-track i {
  transform: translateX(18px);
  background: #55b5ff;
}

.st-run {
  width: 100%;
  height: 29px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 2px;
  color: #00e9aa;
  border: 1px solid #00a987;
  border-radius: 5px;
  background: #10433d;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.st-finish-track {
  width: 100%;
  height: 27px;
  color: #77def5;
  border: 1px solid rgba(63, 174, 211, 0.62);
  border-radius: 5px;
  background: rgba(11, 64, 83, 0.74);
  cursor: pointer;
  font: inherit;
}

.st-finish-track:hover {
  border-color: #65d8f5;
  background: rgba(16, 83, 105, 0.88);
}

.st-run svg {
  width: 14px;
  height: 14px;
}

.st-run:hover {
  border-color: #00e6a5;
  background: #145a50;
}

.st-run.is-running {
  color: #ff9daa;
  border-color: #b8566a;
  background: #4e1f2b;
}

.st-run.is-running:hover {
  border-color: #ff8ba0;
  background: #652838;
}

.st-run:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.st-session-status {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin: 0;
  padding: 6px 7px;
  color: #7edcf1;
  border: 1px solid rgba(53, 159, 188, 0.42);
  border-radius: 5px;
  background: rgba(10, 57, 74, 0.54);
  line-height: 1.35;
}

.st-session-status span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.st-session-status b { flex: none; font: 500 9px ui-monospace, monospace; }
.st-session-status.complete { color: #6ce3bd; border-color: rgba(48, 151, 119, .5); }
.st-session-status.error { color: #ff9daa; border-color: rgba(174, 69, 87, .55); background: rgba(67, 24, 34, .65); }
</style>
