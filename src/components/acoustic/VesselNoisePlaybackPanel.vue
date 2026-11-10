<template>
  <template v-if="active">
    <section ref="waveformWindowEl" v-if="showWaveform && !waveformMinimized" class="vessel-window waveform-window" :class="{ 'source-window': windowRole === 'source' }" :style="waveformWindowStyle" :aria-label="signalMode && signalChannel === 'source' ? '航迹声源时域波形' : '水听器接收时域波形'">
      <header class="window-drag-handle" title="拖动窗口；双击恢复默认位置" @pointerdown="startWindowDrag('waveform', $event)" @dblclick="resetWindowPosition('waveform')">
        <div>
          <span class="waveform-title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M2 12h3l2.2-6 3.1 12 3.2-14 2.7 12 2-7 1.8 3h2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <strong>{{ signalMode ? (signalChannel === 'source' ? '航迹声源时域波形' : '固定接收位置时域波形') : '水听器接收时域波形' }} · {{ Math.round(windowDuration) }} s 窗口</strong>
        </div>
        <span class="spectrogram-window-actions" @pointerdown.stop>
          <button type="button" title="最小化时域波形" aria-label="最小化时域波形" @click="$emit('minimize-waveform')">−</button>
          <button type="button" title="关闭时域波形窗口" aria-label="关闭时域波形窗口" @click="$emit('close-waveform')">×</button>
        </span>
      </header>
      <div class="waveform-plot">
        <canvas ref="waveformCanvasEl" class="waveform-canvas"></canvas>
        <span class="waveform-axis-title waveform-y-title">声压 / {{ pressureAxis.unit }}</span>
        <span class="waveform-level waveform-positive">+{{ pressureAxis.limitLabel }}</span>
        <span class="waveform-level waveform-zero">0</span>
        <span class="waveform-level waveform-negative">−{{ pressureAxis.limitLabel }}</span>
        <span class="waveform-time waveform-start">−{{ Math.round(windowDuration) }} s</span>
        <span class="waveform-time waveform-now">当前</span>
        <span class="waveform-axis-title waveform-x-title">时间 / s</span>
      </div>
      <footer>
        <template v-if="signalMode">
          <span><i class="weather-dot"></i>{{ signalChannel === 'source' ? '船舶发射信号＋声源位置环境噪声' : '传播信号＋固定接收点环境噪声' }}</span>
          <b>随航迹分钟站位更新</b>
        </template>
        <template v-else>
          <span><i class="weather-dot"></i>{{ vesselActive ? '环境噪声 + 船舶接收信号' : '环境噪声' }}</span>
          <b>{{ simulationActive ? `${propagationModelLabel} · ${vesselActive ? '船舶运动阶段' : '船舶运动前预播放'}` : '无船舶 · 无运动' }}</b>
        </template>
      </footer>
    </section>

    <section ref="spectrogramWindowEl" v-if="showSpectrogram && !spectrogramMinimized" class="vessel-window spectrogram-window" :class="{ 'source-window': windowRole === 'source' }" :style="spectrogramWindowStyle" :aria-label="signalMode ? '信号传输时频图' : '水听器接收时频图'">
      <header class="window-drag-handle" title="拖动窗口；双击恢复默认位置" @pointerdown="startWindowDrag('spectrogram', $event)" @dblclick="resetWindowPosition('spectrogram')">
        <div>
          <span class="spectrogram-title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 17V9m4 8V5m4 12v-7m4 7V3m4 14v-5M2 20h20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
          </span>
          <strong>{{ signalMode ? (signalChannel === 'source' ? '航迹声源时频图' : '固定接收位置时频图（ADC反标定）') : '水听器接收时频图' }} · {{ Math.round(windowDuration) }} s</strong>
        </div>
        <span class="spectrogram-window-actions" @pointerdown.stop>
          <button type="button" title="最小化时频图" aria-label="最小化时频图" @click="$emit('minimize-spectrogram')">−</button>
          <button type="button" title="关闭时频图窗口" aria-label="关闭时频图窗口" @click="$emit('close-spectrogram')">×</button>
        </span>
      </header>
      <p v-if="errorText" class="playback-error">{{ errorText }}</p>
      <p v-else-if="busy && statusText" class="playback-status">{{ statusText }}</p>
      <div class="spectrogram-plot">
        <div class="spectrogram-pixel-grid">
          <canvas
            ref="spectrogramCanvasEl"
            class="spectrogram-canvas"
            :class="{ 'readout-enabled': spectrogramReadout.enabled }"
            @click="onSpectrogramClick"
          ></canvas>
          <span
            v-for="tick in frequencyTicks"
            :key="`${spectrogramFrequencyScale}-${tick.value}`"
            class="spectrogram-frequency-tick"
            :style="{ bottom: `${tick.position}%` }"
          >{{ tick.label }}</span>
          <span
            v-for="tick in timeTicks"
            :key="tick.label"
            class="spectrogram-time-tick"
            :style="{ left: `${tick.position}%` }"
          >{{ tick.label }}</span>
          <i class="spectrogram-cursor" :style="{ left: `${spectrogramCursorPercent}%` }"></i>
          <span
            v-for="point in readoutPoints"
            :key="point.id"
            class="spectrogram-readout-marker"
            :class="{ 'flip-left': point.xPercent > 68 }"
            :style="{ left: `${point.xPercent}%`, top: `${100 - point.yPercent}%` }"
          >
            <span class="spectrogram-readout-cross" aria-hidden="true"></span>
            <span class="spectrogram-readout-card">
              <span class="spectrogram-readout-row">
                <svg class="spectrogram-readout-pin" viewBox="0 0 24 32" aria-hidden="true">
                  <path :d="READOUT_PIN_PATH" fill="currentColor" />
                </svg>
                <b>R{{ point.index }}</b>
                <strong>{{ point.timeText }}</strong>
                <strong>{{ point.frequencyText }}</strong>
              </span>
              <span class="spectrogram-readout-level">谱级 {{ point.levelText }} dB</span>
            </span>
          </span>
        </div>
        <span class="spectrogram-axis-title spectrogram-y-title">频率 / Hz</span>
        <span class="spectrogram-axis-title spectrogram-x-title">时间 / s</span>
        <div class="spectrogram-colorbar" aria-label="时频图色标范围">
          <i aria-hidden="true"></i>
          <span class="colorbar-max">{{ colorbarMaxText }}</span>
          <b>谱级<br />dB re 1 µPa²/Hz</b>
          <span class="colorbar-min">{{ colorbarMinText }}</span>
        </div>
      </div>
      <div class="spectrogram-playback" :aria-label="signalMode ? '信号音频播放控制' : '船舶噪声模拟播放控制'">
        <audio
          v-if="audioUrl"
          :key="audioUrl"
          ref="audioElement"
          controls
          preload="metadata"
          :src="audioUrl"
          @timeupdate="syncAudioTime"
          @loadedmetadata="syncAudioTime"
          @ended="syncAudioTime"
        ></audio>
        <template v-else>
          <button class="play-button" type="button" :aria-label="playing ? '暂停' : '播放'" @click="togglePlayback">
            {{ playing ? 'Ⅱ' : '▶' }}
          </button>
          <button type="button" class="reset-button" aria-label="回到起点" title="回到起点" @click="$emit('update:time', 0)">↺</button>
          <time>{{ formatTime(currentTime) }}</time>
          <div class="timeline">
            <input
              :value="currentTime"
              type="range"
              min="0"
              :max="duration"
              step="0.1"
              aria-label="船舶噪声模拟时间轴"
              @input="$emit('update:time', Number($event.target.value))"
            />
            <div class="timeline-progress" :style="{ width: `${progressPercent}%` }"></div>
          </div>
          <time>{{ formatTime(duration) }}</time>
          <select :value="rate" aria-label="播放倍速" @change="$emit('update:rate', Number($event.target.value))">
            <option :value="0.5">0.5×</option>
            <option :value="1">1×</option>
            <option :value="2">2×</option>
            <option :value="4">4×</option>
          </select>
        </template>
      </div>
      <div class="spectrogram-audio" :aria-label="signalMode ? '时频窗口音频' : '噪声窗口音频'">
        <button
          type="button"
          class="audio-generate audio-preview"
          :class="{ generating: clipBusy }"
          :disabled="clipBusy"
          :title="clipBusy ? '正在生成试听音频…' : '试听此前音频'"
          aria-label="试听此前音频"
          @click="prepareClip(true)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h2.3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Zm16 0h-2.3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1v-5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <audio v-if="clipUrl" :key="clipUrl" ref="clipAudioEl" :src="clipUrl" controls preload="auto"></audio>
        <label class="audio-volume" title="播放音量（6 级固定音量）">
          <span>音量</span>
          <input v-model.number="clipVolume" type="range" min="0" max="1" step="0.2" aria-label="播放音量" />
          <b>{{ volumePercent }}%</b>
        </label>
        <button type="button" class="audio-download" title="下载此前音频的 WAV 文件" @click="downloadClip">下载 WAV</button>
      </div>
      <footer>
        <template v-if="signalMode">
          <span><i class="model-dot"></i>{{ signalChannel === 'source' ? '后端发射声压（含声源位置环境噪声）' : 'ADC数字码反标定声压（含接收点环境噪声）' }}</span>
          <b>{{ signalChannel === 'source' ? `站位 ${Math.min(currentIndex + 1, Math.max(1, totalSamples))}/${Math.max(1, totalSamples)} · 每分钟更新` : receiverAdcStatus }}</b>
        </template>
        <template v-else>
          <span v-if="simulationActive" :class="{ inactive: !vesselActive }"><i class="model-dot"></i>{{ vesselActive ? (sourceClassLabel || '船舶噪声') : '船舶噪声尚未加入' }}</span>
          <span><i class="weather-dot"></i>天气与环境背景</span>
          <b>{{ simulationActive ? `${propagationModelLabel} ${calculatedCount}/${totalSamples} 分钟站位` : '环境接收预览' }}</b>
        </template>
      </footer>
    </section>

  </template>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { spectrogramPressureSeries } from '@/utils/vesselNoiseSimulation.js'
import { encodeWavBlob } from '@/utils/wavAudio.js'
import {
  addSpectrogramReadoutMarker,
  spectrogramReadout,
} from '@/modules/acoustic/spectrogramReadout.js'

const READOUT_PIN_PATH = 'M12 1C6.5 1 2 5.5 2 11c0 7.5 10 20 10 20s10-12.5 10-20C22 5.5 17.5 1 12 1Zm0 13.5A4.5 4.5 0 1 1 12 5.5a4.5 4.5 0 0 1 0 9Z'

const props = defineProps({
  active: Boolean,
  simulationActive: Boolean,
  signalMode: Boolean,
  signalChannel: { type: String, default: 'receiver' },
  windowRole: { type: String, default: 'receiver' },
  audioUrl: { type: String, default: '' },
  waveform: { type: Object, default: null },
  arrivals: { type: Object, default: null },
  showWaveform: { type: Boolean, default: true },
  waveformMinimized: Boolean,
  showSpectrogram: { type: Boolean, default: true },
  spectrogramMinimized: Boolean,
  spectrogram: { type: Object, default: null },
  frequencyScale: { type: String, default: 'linear' },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 30 },
  windowDuration: { type: Number, default: 30 },
  preRollDuration: { type: Number, default: 30 },
  playing: Boolean,
  rate: { type: Number, default: 1 },
  currentIndex: { type: Number, default: 0 },
  totalSamples: { type: Number, default: 0 },
  calculatedCount: { type: Number, default: 0 },
  busy: Boolean,
  statusText: { type: String, default: '' },
  errorText: { type: String, default: '' },
  receiverMetrics: { type: Object, default: null },
  vessel: { type: Object, default: null },
  sourceSpectrum: { type: Object, default: null },
  propagationModel: { type: String, default: 'bellhop' },
})

const emit = defineEmits([
  'update:time', 'update:playing', 'update:rate',
  'minimize-waveform', 'close-waveform',
  'minimize-spectrogram', 'close-spectrogram', 'close',
])

const spectrogramCanvasEl = ref(null)
const waveformCanvasEl = ref(null)
const spectrogramFrequencyScale = computed(() => (
  props.frequencyScale === 'log' ? 'log' : 'linear'
))
const spectrogramWindowEl = ref(null)
const waveformWindowEl = ref(null)
const spectrogramPosition = ref(null)
const waveformPosition = ref(null)
const activeDragWindow = ref('spectrogram')
const waveformPressureLimitPa = ref(1e-6)
const audioElement = ref(null)
const audioCurrentTime = ref(0)
const generatedAudioActive = ref(false)
const clipAudioEl = ref(null)
const clipUrl = ref('')
const clipBusy = ref(false)
const clipVolume = ref(0.8)
const CLIP_SAMPLE_RATE = 16000
const CLIP_MAX_SECONDS = 600
const volumePercent = computed(() => Math.round((Number(clipVolume.value) || 0) * 100))
let generatedAudioContext = null
let generatedMasterGain = null
let generatedAudioNodes = []

const propagationModelLabel = computed(() => ({
  bellhop: 'Bellhop',
  ram: 'RAM',
  kraken: 'KRAKEN',
})[String(props.propagationModel || '').toLowerCase()] || String(props.propagationModel || '声场模型'))
const spectrogramWindowStyle = computed(() => windowPositionStyle('spectrogram', spectrogramPosition.value))
const waveformWindowStyle = computed(() => windowPositionStyle('waveform', waveformPosition.value))

function windowPositionStyle(kind, position) {
  const style = { zIndex: activeDragWindow.value === kind ? 33 : 31 }
  if (!position) return style
  return {
    ...style,
    left: `${position.left}px`,
    top: `${position.top}px`,
    right: 'auto',
    bottom: 'auto',
  }
}

let windowDrag = null
function startWindowDrag(kind, event) {
  if (event.button !== 0) return
  const element = kind === 'waveform' ? waveformWindowEl.value : spectrogramWindowEl.value
  if (!element) return
  const parent = element.offsetParent
  const rect = element.getBoundingClientRect()
  const parentRect = parent?.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
  activeDragWindow.value = kind
  windowDrag = {
    kind,
    element,
    parentRect,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  }
  event.preventDefault()
  window.addEventListener('pointermove', moveWindowDrag)
  window.addEventListener('pointerup', stopWindowDrag, { once: true })
  window.addEventListener('pointercancel', stopWindowDrag, { once: true })
}

function moveWindowDrag(event) {
  if (!windowDrag) return
  const { kind, element, parentRect, offsetX, offsetY } = windowDrag
  const maxLeft = Math.max(8, parentRect.width - element.offsetWidth - 8)
  const maxTop = Math.max(8, parentRect.height - element.offsetHeight - 8)
  const position = {
    left: Math.max(8, Math.min(maxLeft, event.clientX - parentRect.left - offsetX)),
    top: Math.max(8, Math.min(maxTop, event.clientY - parentRect.top - offsetY)),
  }
  if (kind === 'waveform') waveformPosition.value = position
  else spectrogramPosition.value = position
}

function stopWindowDrag() {
  windowDrag = null
  window.removeEventListener('pointermove', moveWindowDrag)
  window.removeEventListener('pointerup', stopWindowDrag)
  window.removeEventListener('pointercancel', stopWindowDrag)
}

function resetWindowPosition(kind) {
  if (kind === 'waveform') waveformPosition.value = null
  else spectrogramPosition.value = null
}

const progressPercent = computed(() => Math.max(0, Math.min(100, props.currentTime / Math.max(1, props.duration) * 100)))
const sourceClassLabel = computed(() => props.sourceSpectrum?.vesselClassLabel || props.vessel?.source_model_class_label || '')
const receiverAdcStatus = computed(() => {
  const peakCode = Number(props.receiverMetrics?.adc_peak_code)
  const clippingPercent = Number(props.receiverMetrics?.adc_clipping_percent)
  if (Number.isFinite(clippingPercent) && clippingPercent > 0) {
    return `ADC削顶 ${clippingPercent.toFixed(2)}% · 请降低前放或增大满量程`
  }
  if (Number.isFinite(peakCode) && peakCode <= 2) {
    return `ADC峰值码 ${Math.round(peakCode)} · 量化不足，请提高前放或降低满量程`
  }
  if (Number.isFinite(peakCode)) return `ADC峰值码 ${Math.round(peakCode)} · 无削顶`
  return '水听器灵敏度、外部前放与满量程校准'
})
const vesselActive = computed(() => props.simulationActive && props.currentTime >= props.preRollDuration)
const receivedPressure = computed(() => spectrogramPressureSeries(props.spectrogram))
const multipathArrivals = computed(() => (
  Array.isArray(props.arrivals?.impulse_response)
    ? props.arrivals.impulse_response.map(path => ({
      delayS: Math.max(0, Number(path?.delay_s) || 0),
      amplitude: Math.max(0, Number(path?.amplitude) || Math.hypot(
        Number(path?.gain_real) || 0,
        Number(path?.gain_imag) || 0,
      )),
      phaseRad: (Number(path?.phase_deg) || 0) * Math.PI / 180,
    })).filter(path => path.amplitude > 0)
    : []
))
const pressureAxis = computed(() => {
  const limitPa = Math.max(1e-12, Number(waveformPressureLimitPa.value) || 1e-6)
  const unit = limitPa >= 1 ? 'Pa' : limitPa >= 1e-3 ? 'mPa' : 'µPa'
  const factor = unit === 'Pa' ? 1 : unit === 'mPa' ? 1e-3 : 1e-6
  const value = limitPa / factor
  return {
    unit,
    limitLabel: value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2),
  }
})
const colorbarMinText = computed(() => formatColorbarValue(props.spectrogram?.minDb))
const colorbarMaxText = computed(() => formatColorbarValue(props.spectrogram?.maxDb))
const spectrogramCursorPercent = computed(() => {
  const times = props.spectrogram?.times || []
  if (times.length < 2) return 0
  const start = Number(times[0]) || 0
  const end = Number(times[times.length - 1]) || start + 1
  const current = props.audioUrl ? audioCurrentTime.value : props.currentTime
  return Math.max(0, Math.min(100, (current - start) / Math.max(1e-9, end - start) * 100))
})

const spectrogramReadoutData = computed(() => {
  const matrix = props.spectrogram
  const times = Array.from(matrix?.times || [], Number).filter(Number.isFinite)
  const frequencies = Array.from(matrix?.frequencies || [], Number).filter(Number.isFinite)
  const levels = new Map()
  for (const entry of matrix?.data || []) {
    const timeIndex = Number(entry?.[0])
    const frequencyIndex = Number(entry?.[1])
    const level = Number(entry?.[2])
    if (Number.isFinite(timeIndex) && Number.isFinite(frequencyIndex) && Number.isFinite(level)) {
      levels.set(`${timeIndex}:${frequencyIndex}`, level)
    }
  }
  return { times, frequencies, levels }
})

function nearestReadoutIndex(values, target) {
  if (!values.length) return -1
  if (target <= values[0]) return 0
  const lastIndex = values.length - 1
  if (target >= values[lastIndex]) return lastIndex
  let lower = 0
  let upper = lastIndex
  while (upper - lower > 1) {
    const middle = (lower + upper) >> 1
    if (values[middle] <= target) lower = middle
    else upper = middle
  }
  return target - values[lower] <= values[upper] - target ? lower : upper
}

function frequencyScaleBounds(frequencies) {
  const values = Array.from(frequencies || [], Number).filter(Number.isFinite)
  if (!values.length) return { minimum: 0, maximum: 1 }
  const maximum = values[values.length - 1]
  if (spectrogramFrequencyScale.value !== 'log') {
    return { minimum: values[0], maximum }
  }
  const minimum = values.find(value => value > 0)
  return {
    minimum: Number.isFinite(minimum) ? minimum : Math.max(Number.EPSILON, maximum / 1000),
    maximum,
  }
}

function frequencyAtDisplayRatio(ratio, frequencies) {
  const value = Math.max(0, Math.min(1, Number(ratio) || 0))
  const { minimum, maximum } = frequencyScaleBounds(frequencies)
  if (!(maximum > minimum)) return minimum
  if (spectrogramFrequencyScale.value === 'log') {
    return minimum * ((maximum / minimum) ** value)
  }
  return minimum + (maximum - minimum) * value
}

function frequencyDisplayRatio(frequency, frequencies) {
  const { minimum, maximum } = frequencyScaleBounds(frequencies)
  const value = Math.max(minimum, Math.min(maximum, Number(frequency) || minimum))
  if (!(maximum > minimum)) return 0
  if (spectrogramFrequencyScale.value === 'log') {
    return Math.log(value / minimum) / Math.log(maximum / minimum)
  }
  return (value - minimum) / (maximum - minimum)
}

function formatReadoutTime(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return '—'
  return `${seconds.toFixed(seconds >= 100 ? 0 : 1)} s`
}

function formatReadoutFrequency(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number >= 1000 ? `${(number / 1000).toFixed(1)} kHz` : `${Math.round(number)} Hz`
}

const readoutPoints = computed(() => {
  if (!spectrogramReadout.enabled || !spectrogramReadout.markers.length) return []
  const { times, frequencies, levels } = spectrogramReadoutData.value
  if (!times.length || !frequencies.length) return []
  const startTimeS = times[0]
  const endTimeS = times[times.length - 1]
  const { minimum: minimumFrequencyHz, maximum: maximumFrequencyHz } = frequencyScaleBounds(frequencies)
  const timeSpan = Math.max(1e-9, endTimeS - startTimeS)
  const points = []
  spectrogramReadout.markers.forEach((marker, markerIndex) => {
    const { timeS, frequencyHz } = marker
    if (timeS < startTimeS - 1e-6 || timeS > endTimeS + 1e-6) return
    if (frequencyHz < minimumFrequencyHz - 1e-6 || frequencyHz > maximumFrequencyHz + 1e-6) return
    const timeIndex = nearestReadoutIndex(times, timeS)
    const frequencyIndex = nearestReadoutIndex(frequencies, frequencyHz)
    const level = levels.get(`${timeIndex}:${frequencyIndex}`)
    points.push({
      id: marker.id,
      index: markerIndex + 1,
      timeText: formatReadoutTime(times[timeIndex]),
      frequencyText: formatReadoutFrequency(frequencies[frequencyIndex]),
      levelText: Number.isFinite(level) ? Number(level).toFixed(1) : '—',
      xPercent: Math.max(0, Math.min(100, (times[timeIndex] - startTimeS) / timeSpan * 100)),
      yPercent: Math.max(0, Math.min(100, frequencyDisplayRatio(
        frequencies[frequencyIndex], frequencies,
      ) * 100)),
    })
  })
  return points
})

function onSpectrogramClick(event) {
  if (!spectrogramReadout.enabled) return
  const canvas = event?.currentTarget
  const rect = canvas?.getBoundingClientRect?.()
  if (!rect || !(rect.width > 0 && rect.height > 0)) return
  const { times, frequencies } = spectrogramReadoutData.value
  if (!times.length || !frequencies.length) return
  const { minimum, maximum } = frequencyScaleBounds(frequencies)
  if (!(maximum > minimum)) return
  const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const yRatio = Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height))
  const timeS = times[0] + (times[times.length - 1] - times[0]) * xRatio
  const frequencyHz = frequencyAtDisplayRatio(yRatio, frequencies)
  addSpectrogramReadoutMarker(timeS, frequencyHz)
}

function syncAudioTime() {
  audioCurrentTime.value = Number(audioElement.value?.currentTime) || 0
}

function stopGeneratedAudio(close = false) {
  generatedAudioActive.value = false
  for (const node of generatedAudioNodes) {
    try { node.stop?.() } catch {}
    try { node.disconnect?.() } catch {}
  }
  generatedAudioNodes = []
  try { generatedMasterGain?.disconnect?.() } catch {}
  generatedMasterGain = null
  if (close) {
    void generatedAudioContext?.close?.()
    generatedAudioContext = null
  } else {
    void generatedAudioContext?.suspend?.()
  }
}

async function startGeneratedAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  stopGeneratedAudio(false)
  generatedAudioContext ||= new AudioContextClass()
  await generatedAudioContext.resume()
  const context = generatedAudioContext
  const master = context.createGain()
  master.gain.value = props.signalChannel === 'source' ? 0.026 : 0.012
  master.connect(context.destination)
  generatedMasterGain = master
  const frequencies = Array.from(props.sourceSpectrum?.frequenciesHz || [], Number)
    .filter(value => Number.isFinite(value) && value >= 20 && value <= context.sampleRate / 2)
    .slice(0, 8)
  const tones = frequencies.length ? frequencies : [84, 126]
  const toneGainValue = 0.7 / Math.sqrt(tones.length)
  tones.forEach((frequencyHz, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = index % 2 ? 'sine' : 'triangle'
    oscillator.frequency.value = frequencyHz
    gain.gain.value = toneGainValue
    oscillator.connect(gain).connect(master)
    oscillator.start()
    generatedAudioNodes.push(oscillator, gain)
  })
  const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const noiseData = noiseBuffer.getChannelData(0)
  for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = Math.random() * 2 - 1
  const noise = context.createBufferSource()
  const noiseGain = context.createGain()
  noise.buffer = noiseBuffer
  noise.loop = true
  noiseGain.gain.value = 0.16
  noise.connect(noiseGain).connect(master)
  noise.start()
  generatedAudioNodes.push(noise, noiseGain)
  generatedAudioActive.value = true
}

function togglePlayback() {
  emit('update:playing', !props.playing)
}

function clipSpan() {
  const current = Math.max(0, Number(props.currentTime) || 0)
  const duration = Math.max(0, Number(props.duration) || 0)
  const complete = props.totalSamples > 0 && props.calculatedCount >= props.totalSamples
  // 计算未完成时只试听已播放到当前位置的片段；计算完成后可试听整段航迹。
  const desiredEnd = complete ? Math.max(current, duration) : current
  const endS = Math.min(CLIP_MAX_SECONDS, Math.max(1, desiredEnd))
  return { startS: 0, endS }
}

function buildClipSamples() {
  const sampleRate = CLIP_SAMPLE_RATE
  const { startS, endS } = clipSpan()
  const durationS = Math.max(1 / sampleRate, endS - startS)
  const count = Math.max(1, Math.round(durationS * sampleRate))
  const samples = new Float32Array(count)
  let peak = 0
  for (let index = 0; index < count; index += 1) {
    const value = receivedWaveformValue(startS + index / sampleRate)
    samples[index] = value
    const magnitude = Math.abs(value)
    if (magnitude > peak) peak = magnitude
  }
  const scale = peak > 1e-9 ? 0.85 / peak : 1
  if (scale !== 1) {
    for (let index = 0; index < count; index += 1) samples[index] *= scale
  }
  return { samples, sampleRate, startS, durationS }
}

function revokeClipUrl() {
  if (clipUrl.value) {
    URL.revokeObjectURL(clipUrl.value)
    clipUrl.value = ''
  }
}

async function prepareClip(play = false) {
  if (clipBusy.value) return
  // 先暂停主播放，保证“此前音频”截止到当前暂停位置。
  emit('update:playing', false)
  clipBusy.value = true
  try {
    await nextTick()
    await new Promise(resolve => window.setTimeout(resolve, 0))
    const { samples, sampleRate } = buildClipSamples()
    revokeClipUrl()
    clipUrl.value = URL.createObjectURL(encodeWavBlob(samples, sampleRate))
    await nextTick()
    const element = clipAudioEl.value
    if (!element) return
    element.volume = clipVolume.value
    if (play) Promise.resolve(element.play?.()).catch(() => {})
  } finally {
    clipBusy.value = false
  }
}

function downloadClip() {
  const { samples, sampleRate, startS, durationS } = buildClipSamples()
  const url = URL.createObjectURL(encodeWavBlob(samples, sampleRate))
  const label = props.signalChannel === 'source' ? '航迹声源' : '固定接收位置'
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${label}_${Math.round(startS)}-${Math.round(startS + durationS)}s.wav`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

watch(clipVolume, value => {
  if (clipAudioEl.value) clipAudioEl.value.volume = value
})

watch(() => [props.windowDuration, props.signalChannel, props.preRollDuration], () => revokeClipUrl())

const frequencyTicks = computed(() => {
  const frequencies = props.spectrogram?.frequencies || []
  if (frequencies.length < 2) return []
  const { minimum, maximum } = frequencyScaleBounds(frequencies)
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || !(maximum > minimum)) return []
  if (spectrogramFrequencyScale.value === 'log') {
    const candidates = []
    const minimumExponent = Math.floor(Math.log10(minimum))
    const maximumExponent = Math.ceil(Math.log10(maximum))
    for (let exponent = minimumExponent; exponent <= maximumExponent; exponent += 1) {
      for (const multiplier of [1, 2, 5]) {
        const value = multiplier * (10 ** exponent)
        if (value >= minimum && value <= maximum) candidates.push(value)
      }
    }
    const selected = candidates.length <= 6
      ? candidates
      : Array.from({ length: 6 }, (_, index) => (
        candidates[Math.round(index / 5 * (candidates.length - 1))]
      )).filter((value, index, values) => index === 0 || value !== values[index - 1])
    return selected.map(value => ({
      value,
      label: frequencyLabel(value),
      position: frequencyDisplayRatio(value, frequencies) * 100,
    }))
  }
  return [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const value = minimum + (maximum - minimum) * ratio
    return { value, label: frequencyLabel(value), position: ratio * 100 }
  })
})
const timeTicks = computed(() => {
  const times = Array.from(props.spectrogram?.times || [], Number).filter(Number.isFinite)
  if (times.length < 2) return []
  const start = times[0]
  const end = times[times.length - 1]
  return [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    label: `${Number((start + (end - start) * ratio).toFixed(1))}s`,
    position: ratio * 100,
  }))
})

function formatTime(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatColorbarValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(1) : '—'
}

function frequencyLabel(value) {
  const number = Number(value)
  return number >= 1000 ? `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k` : String(Math.round(number))
}

const JET_STOPS = [
  [0, [0, 0, 128]], [0.2, [0, 128, 255]], [0.4, [0, 255, 255]],
  [0.6, [0, 255, 0]], [0.8, [255, 255, 0]], [1, [255, 0, 0]],
]

function jetColor(ratio) {
  const value = Math.max(0, Math.min(1, ratio))
  for (let index = 0; index < JET_STOPS.length - 1; index += 1) {
    const [start, startColor] = JET_STOPS[index]
    const [end, endColor] = JET_STOPS[index + 1]
    if (value > end && index < JET_STOPS.length - 2) continue
    const mix = (value - start) / Math.max(1e-9, end - start)
    return startColor.map((channel, channelIndex) => Math.round(
      channel + (endColor[channelIndex] - channel) * Math.max(0, Math.min(1, mix)),
    ))
  }
  return JET_STOPS[JET_STOPS.length - 1][1]
}

function renderSpectrogram() {
  const canvas = spectrogramCanvasEl.value
  const matrix = props.spectrogram
  if (!canvas || !matrix?.data?.length) return
  const width = matrix.times.length
  const height = matrix.frequencies.length
  if (!(width > 0 && height > 0)) return
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return
  const pixels = context.createImageData(width, height)
  const range = Math.max(1e-9, Number(matrix.maxDb) - Number(matrix.minDb))
  const levels = Array.from({ length: width }, () => Array(height).fill(null))
  for (const [timeIndex, frequencyIndex, level] of matrix.data) {
    const x = Number(timeIndex)
    const sourceFrequencyIndex = Number(frequencyIndex)
    if (x < 0 || x >= width || sourceFrequencyIndex < 0 || sourceFrequencyIndex >= height) continue
    if (Number.isFinite(Number(level))) levels[x][sourceFrequencyIndex] = Number(level)
  }
  for (let x = 0; x < width; x += 1) {
    for (let displayFrequencyIndex = 0; displayFrequencyIndex < height; displayFrequencyIndex += 1) {
      const ratio = displayFrequencyIndex / Math.max(1, height - 1)
      const targetFrequency = frequencyAtDisplayRatio(ratio, matrix.frequencies)
      const sourceFrequencyIndex = nearestReadoutIndex(matrix.frequencies, targetFrequency)
      const level = levels[x][sourceFrequencyIndex]
      if (!Number.isFinite(level)) continue
      const y = height - 1 - displayFrequencyIndex
      const [red, green, blue] = jetColor((level - Number(matrix.minDb)) / range)
      const offset = (y * width + x) * 4
      pixels.data[offset] = red
      pixels.data[offset + 1] = green
      pixels.data[offset + 2] = blue
      pixels.data[offset + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
}

function receivedWaveformValue(timeS) {
  // 各组系数在设计时已按单位 RMS 配平；运行时不再按窗口或参考值归一化。
  const environmentalUnit = (
    1.045 * Math.sin(2 * Math.PI * 17.3 * timeS + 0.7)
    + 0.686 * Math.sin(2 * Math.PI * 31.7 * timeS + 2.1)
    + 0.490 * Math.sin(2 * Math.PI * 53.1 * timeS + 4.4)
    + 0.359 * Math.sin(2 * Math.PI * 83.9 * timeS + 1.3)
    + 0.261 * Math.sin(2 * Math.PI * 127.7 * timeS + 5.2)
  )
  if (props.signalMode) {
    const frequencies = Array.from(props.sourceSpectrum?.frequenciesHz || [], Number)
      .filter(value => Number.isFinite(value) && value > 0)
      .slice(0, 12)
    if (!frequencies.length) return environmentalUnit
    const paths = props.signalChannel === 'receiver' ? multipathArrivals.value : []
    const signalUnit = paths.length
      ? (() => {
        const raw = paths.reduce((sum, path, index) => {
          const frequencyHz = frequencies[index % frequencies.length]
          return sum + path.amplitude * Math.sin(
            2 * Math.PI * frequencyHz * (timeS - path.delayS) + path.phaseRad,
          )
        }, 0)
        const rmsScale = Math.sqrt(paths.reduce((sum, path) => sum + path.amplitude ** 2, 0) / 2)
        return raw / Math.max(1e-12, rmsScale)
      })()
      : frequencies.reduce((sum, frequencyHz, index) => (
        sum + Math.sin(2 * Math.PI * frequencyHz * timeS + index * 0.71)
      ), 0) / Math.sqrt(frequencies.length)
    return 0.82 * signalUnit + 0.18 * environmentalUnit
  }
  if (timeS < props.preRollDuration) return environmentalUnit
  const speedKn = Math.max(1, Number(props.vessel?.sog_kn) || 10)
  const bladeRateHz = 3.2 + speedKn * 0.14
  const propellerEnvelope = 0.62 + 0.38 * Math.sin(2 * Math.PI * bladeRateHz * timeS)
  const machineryUnit = (
    1.119 * Math.sin(2 * Math.PI * 23 * timeS + 0.4)
    + 0.719 * Math.sin(2 * Math.PI * 46 * timeS + 1.1)
    + 0.480 * Math.sin(2 * Math.PI * 69 * timeS + 2.6)
  )
  const cavitationUnit = propellerEnvelope * (
    1.808 * Math.sin(2 * Math.PI * 97.1 * timeS + 0.8)
    + 1.055 * Math.sin(2 * Math.PI * 151.3 * timeS + 3.7)
  )
  return 0.352 * environmentalUnit + 0.755 * machineryUnit + 0.553 * cavitationUnit
}

function pressureRmsAtTime(timeS) {
  const times = receivedPressure.value.times
  const values = receivedPressure.value.rmsPa
  if (!times.length || times.length !== values.length) return 1e-6
  if (timeS <= times[0]) return Math.max(1e-12, Number(values[0]) || 0)
  const lastIndex = times.length - 1
  if (timeS >= times[lastIndex]) return Math.max(1e-12, Number(values[lastIndex]) || 0)
  let upper = 1
  while (upper < times.length && times[upper] < timeS) upper += 1
  const lower = upper - 1
  const ratio = (timeS - times[lower]) / Math.max(1e-9, times[upper] - times[lower])
  return Math.max(1e-12, Number(values[lower]) + (Number(values[upper]) - Number(values[lower])) * ratio)
}

function nicePressureLimit(valuePa) {
  const value = Math.max(1e-12, Number(valuePa) || 0)
  const exponent = Math.floor(Math.log10(value))
  const normalized = value / (10 ** exponent)
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * (10 ** exponent)
}

function renderWaveform() {
  const canvas = waveformCanvasEl.value
  if (!canvas) return
  const width = 900
  const height = 180
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#061827'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = 'rgba(69, 133, 158, .22)'
  context.lineWidth = 1
  for (let column = 0; column <= 10; column += 1) {
    const x = Math.round(column / 10 * width) + 0.5
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }
  for (let row = 0; row <= 4; row += 1) {
    const y = Math.round(row / 4 * height) + 0.5
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }
  const signalTimes = Array.from(props.waveform?.times || [], Number)
  const rawSignalValues = Array.from(props.waveform?.values || [], Number)
  const signalSamples = []
  for (let index = 0; index < Math.min(signalTimes.length, rawSignalValues.length); index += 1) {
    if (Number.isFinite(signalTimes[index]) && Number.isFinite(rawSignalValues[index])) {
      signalSamples.push({ time: signalTimes[index], value: rawSignalValues[index] })
    }
  }
  if (props.signalMode) {
    if (signalSamples.length > 1) {
      const maximum = Math.max(1e-12, ...signalSamples.map(sample => Math.abs(sample.value)))
      waveformPressureLimitPa.value = nicePressureLimit(maximum)
      const windowStart = Number(props.waveform?.windowStartS)
      const windowEnd = Number(props.waveform?.windowEndS)
      const start = Number.isFinite(windowStart) ? windowStart : signalSamples[0].time
      const end = Number.isFinite(windowEnd) && windowEnd > start
        ? windowEnd
        : signalSamples[signalSamples.length - 1].time
      context.beginPath()
      signalSamples.forEach((sample, index) => {
        const x = Math.max(0, Math.min(width, (sample.time - start) / Math.max(1e-9, end - start) * width))
        const y = height / 2 - sample.value / waveformPressureLimitPa.value * height * 0.43
        if (index) context.lineTo(x, y)
        else context.moveTo(x, y)
      })
      context.strokeStyle = props.signalChannel === 'source' ? '#45d9ff' : '#5cf2d1'
      context.lineWidth = 1.25
      context.shadowBlur = 4
      context.shadowColor = props.signalChannel === 'source' ? 'rgba(69, 217, 255, .45)' : 'rgba(92, 242, 209, .45)'
      context.stroke()
      context.shadowBlur = 0
    }
    // 信号传输模式等待后端波形；禁止使用前端合成数据兜底。
    return
  }
  const endTime = Number(props.currentTime) || 0
  const windowSeconds = Math.max(1, Number(props.windowDuration) || 30)
  const windowStart = endTime - windowSeconds
  const secondsPerPixel = windowSeconds / width
  // 60 s / 900 px 时每像素约 27 个子样本（约 405 Hz），可覆盖当前 151 Hz 最高纹理频率。
  const samplesPerPixel = Math.max(4, Math.min(32, Math.ceil(secondsPerPixel * 405)))
  const pressureBuckets = []
  let maximumPressurePa = 1e-12
  for (let index = 0; index < width; index += 1) {
    const pixelStart = windowStart + index * secondsPerPixel
    let minimumPa = Infinity
    let maximumPa = -Infinity
    for (let sampleIndex = 0; sampleIndex < samplesPerPixel; sampleIndex += 1) {
      const ratio = (sampleIndex + 0.5) / samplesPerPixel
      const timeS = pixelStart + ratio * secondsPerPixel
      const pressurePa = receivedWaveformValue(timeS) * pressureRmsAtTime(timeS)
      minimumPa = Math.min(minimumPa, pressurePa)
      maximumPa = Math.max(maximumPa, pressurePa)
      maximumPressurePa = Math.max(maximumPressurePa, Math.abs(pressurePa))
    }
    pressureBuckets.push({ minimumPa, maximumPa })
  }
  const candidateLimitPa = nicePressureLimit(maximumPressurePa)
  const previousLimitPa = Math.max(1e-12, Number(waveformPressureLimitPa.value) || candidateLimitPa)
  const pressureLimitPa = candidateLimitPa > previousLimitPa || candidateLimitPa < previousLimitPa * 0.45
    ? candidateLimitPa
    : previousLimitPa
  waveformPressureLimitPa.value = pressureLimitPa
  context.beginPath()
  for (let index = 0; index < width; index += 1) {
    const bucket = pressureBuckets[index]
    const top = height / 2 - (bucket.maximumPa / pressureLimitPa) * height * 0.43
    const bottom = height / 2 - (bucket.minimumPa / pressureLimitPa) * height * 0.43
    context.moveTo(index + 0.5, top)
    context.lineTo(index + 0.5, bottom)
  }
  context.strokeStyle = vesselActive.value ? '#5cf2d1' : '#42cfe3'
  context.lineWidth = 1.45
  context.shadowBlur = 5
  context.shadowColor = vesselActive.value ? 'rgba(92, 242, 209, .45)' : 'rgba(66, 207, 227, .4)'
  context.stroke()
  context.shadowBlur = 0
  context.strokeStyle = 'rgba(232, 250, 255, .72)'
  context.beginPath()
  context.moveTo(width - 0.5, 0)
  context.lineTo(width - 0.5, height)
  context.stroke()
}

watch(() => [props.spectrogram, props.windowDuration, props.showSpectrogram, props.spectrogramMinimized, spectrogramFrequencyScale.value], () => nextTick(renderSpectrogram), { deep: false })
watch(() => props.audioUrl, () => { audioCurrentTime.value = 0 })
watch(() => props.playing, value => {
  if (!value && generatedAudioActive.value) stopGeneratedAudio(false)
})
watch(() => [props.currentTime, props.showWaveform, props.waveformMinimized, props.vessel, props.waveform, props.signalChannel, props.arrivals], () => nextTick(renderWaveform), { deep: false })
watch(() => props.active, active => {
  if (active) nextTick(() => {
    renderSpectrogram()
    renderWaveform()
  })
})
watch(spectrogramCanvasEl, element => {
  if (!element) return
  nextTick(renderSpectrogram)
})
watch(waveformCanvasEl, element => {
  if (!element) return
  nextTick(renderWaveform)
})

onBeforeUnmount(() => {
  stopWindowDrag()
  stopGeneratedAudio(true)
  revokeClipUrl()
})

</script>

<style scoped>
.vessel-window { position: absolute; z-index: 31; overflow: hidden; color: #c6dce8; border: 1px solid rgba(42,173,213,.58); border-radius: 8px; background: rgba(4,20,34,.96); box-shadow: 0 14px 34px rgba(0,6,16,.56),0 0 20px rgba(0,174,225,.08); font: 11px 'Microsoft YaHei',sans-serif; }
.spectrogram-window { left: 18px; bottom: 18px; width: min(760px, 58vw); }
.waveform-window { right: 18px; bottom: 18px; width: min(560px, 36vw); }
.spectrogram-window.source-window { left: 18px; top: 58px; bottom: auto; }
.waveform-window.source-window { right: 18px; top: 58px; bottom: auto; }
header { height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 9px 0 12px; border-bottom: 1px solid rgba(55,132,163,.3); background: linear-gradient(90deg,rgba(10,55,78,.92),rgba(5,27,43,.9)); }
.window-drag-handle { cursor: move; user-select: none; touch-action: none; }
header div { display: flex; align-items: center; gap: 8px; min-width: 0; }
header div span { display: grid; place-items: center; width: 22px; height: 22px; color: #0ff; border: 1px solid #167e99; border-radius: 4px; font: 700 9px ui-monospace,monospace; }
header div .spectrogram-title-icon svg,header div .waveform-title-icon svg { width: 15px; height: 15px; }
header strong { color: #d7edf5; font-size: 12px; white-space: nowrap; }
header small { flex: 1; overflow: hidden; color: #72a7ba; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
header button { width: 24px; height: 24px; padding: 0; color: #9bb4c1; border: 0; background: transparent; cursor: pointer; font-size: 18px; }
.spectrogram-window-actions { flex: none; display: flex; align-items: center; gap: 2px; margin-left: auto; }
.spectrogram-window-actions button:hover { color: #55e7dc; background: #12384a; border-radius: 4px; }
.playback-error,.playback-status { margin: 0; padding: 6px 10px; border-bottom: 1px solid rgba(55,132,163,.24); font-size: 9px; }
.playback-error { color: #ff9da9; background: rgba(76,20,32,.72); }
.playback-status { color: #76dceb; background: rgba(7,45,63,.72); }
.spectrogram-plot { position: relative; height: 270px; overflow: hidden; }
.spectrogram-pixel-grid { position: absolute; left: 52px; right: 68px; top: 7px; bottom: 30px; }
.spectrogram-canvas { width: 100%; height: 100%; display: block; image-rendering: auto; }
.spectrogram-canvas.readout-enabled { cursor: crosshair; }
.spectrogram-cursor { position: absolute; z-index: 2; top: 0; bottom: 0; width: 1px; background: rgba(248,251,255,.92); box-shadow: 0 0 4px rgba(255,255,255,.5); pointer-events: none; }
.spectrogram-readout-marker { position: absolute; z-index: 4; width: 14px; height: 14px; transform: translate(-50%,-50%); pointer-events: none; }
.spectrogram-readout-cross { position: absolute; inset: 0; border: 1.5px solid rgba(235,250,255,.95); border-radius: 50%; background: rgba(3,20,35,.28); box-shadow: 0 0 8px rgba(32,224,255,.6); }
.spectrogram-readout-cross::before,.spectrogram-readout-cross::after { content: ''; position: absolute; background: #3be6ff; box-shadow: 0 0 4px rgba(59,230,255,.8); }
.spectrogram-readout-cross::before { left: -5px; right: -5px; top: 50%; height: 1.5px; transform: translateY(-50%); }
.spectrogram-readout-cross::after { top: -5px; bottom: -5px; left: 50%; width: 1.5px; transform: translateX(-50%); }
.spectrogram-readout-card { position: absolute; left: 16px; top: 50%; display: flex; flex-direction: column; gap: 1px; padding: 3px 7px; white-space: nowrap; color: #7fa5b8; border: 1px solid rgba(74,190,220,.95); border-radius: 3px; background: rgba(4,18,32,.94); box-shadow: 0 3px 10px rgba(0,0,0,.4); font: 9px/1.35 ui-monospace,monospace; transform: translateY(-50%); }
.spectrogram-readout-marker.flip-left .spectrogram-readout-card { left: auto; right: 16px; }
.spectrogram-readout-row { display: flex; align-items: center; gap: 4px; }
.spectrogram-readout-pin { flex: none; width: 9px; height: 12px; color: #ff7ea8; }
.spectrogram-readout-row b,.spectrogram-readout-row strong { color: #5ce6ff; font-weight: 700; }
.spectrogram-readout-level { color: #7f9fb1; }
.spectrogram-frequency-tick { position: absolute; right: calc(100% + 7px); color: #8bb1c1; transform: translateY(50%); font-size: 9px; line-height: 1; white-space: nowrap; }
.spectrogram-time-tick { position: absolute; top: calc(100% + 7px); color: #7794a8; transform: translateX(-50%); font-size: 8px; line-height: 1; white-space: nowrap; }
.spectrogram-colorbar { position: absolute; top: 7px; right: 7px; bottom: 23px; width: 50px; color: #8bb1c1; font: 8px ui-monospace,monospace; }
.spectrogram-colorbar > i { position: absolute; top: 10px; bottom: 10px; left: 0; width: 10px; border: 1px solid rgba(150,205,225,.34); background: linear-gradient(to top,#000080 0%,#0080ff 20%,#00ffff 40%,#00ff00 60%,#ffff00 80%,#ff0000 100%); }
.spectrogram-colorbar span { position: absolute; left: 15px; color: #a7c9d6; line-height: 1; white-space: nowrap; }
.spectrogram-colorbar .colorbar-max { top: 6px; }
.spectrogram-colorbar .colorbar-min { bottom: 6px; }
.spectrogram-colorbar b { position: absolute; top: 50%; left: 15px; width: 33px; color: #668ea0; transform: translateY(-50%); font-size: 7px; line-height: 1.25; font-weight: 500; }
.spectrogram-axis-title { position: absolute; color: #6f98aa; font-size: 8px; pointer-events: none; }
.spectrogram-y-title { left: 4px; top: 50%; transform: translate(-38%,-50%) rotate(-90deg); white-space: nowrap; }
.spectrogram-x-title { left: 50%; bottom: 2px; transform: translateX(-50%); }
.spectrogram-window footer { display: flex; align-items: center; gap: 14px; height: 27px; padding: 0 12px; color: #7796a8; border-top: 1px solid rgba(55,132,163,.24); font-size: 9px; }
.spectrogram-window footer span { display: flex; align-items: center; gap: 5px; }
.spectrogram-window footer span.inactive { opacity: .45; }
.spectrogram-window footer i { width: 6px; height: 6px; border-radius: 50%; }
.model-dot { background: #f0c93d; }.weather-dot { background: #00a7a5; }
.spectrogram-window footer b { margin-left: auto; color: #73d8ef; font-weight: 500; }
.waveform-plot { position: relative; height: 172px; padding: 7px 10px 25px 54px; background: #061827; }
.waveform-canvas { width: 100%; height: 100%; display: block; }
.waveform-level,.waveform-time { position: absolute; color: #789eae; font: 8px ui-monospace,monospace; pointer-events: none; }
.waveform-level { left: 28px; transform: translateY(-50%); }.waveform-positive { top: 8px; }.waveform-zero { top: 50%; }.waveform-negative { bottom: 25px; transform: translateY(50%); }
.waveform-time { bottom: 10px; }.waveform-start { left: 54px; }.waveform-now { right: 10px; }
.waveform-axis-title { position: absolute; color: #6f98aa; font-size: 8px; pointer-events: none; }
.waveform-y-title { left: 4px; top: 50%; transform: translate(-38%,-50%) rotate(-90deg); white-space: nowrap; }
.waveform-x-title { left: 55%; bottom: 1px; transform: translateX(-50%); }
.waveform-window footer { display: flex; align-items: center; gap: 10px; height: 27px; padding: 0 12px; color: #7796a8; border-top: 1px solid rgba(55,132,163,.24); font-size: 9px; }
.waveform-window footer span { display: flex; align-items: center; gap: 5px; }.waveform-window footer i { width: 6px; height: 6px; border-radius: 50%; }.waveform-window footer b { margin-left: auto; color: #73d8ef; font-weight: 500; }
.spectrogram-playback { height: 36px; display: flex; align-items: center; gap: 7px; padding: 0 10px; color: #a9c7d6; border-top: 1px solid rgba(55,132,163,.24); background: rgba(6,28,43,.92); }
.spectrogram-playback audio { width: 100%; height: 30px; }
.spectrogram-playback button,.spectrogram-playback select { flex: none; height: 24px; color: #9edcf0; border: 1px solid #285c75; border-radius: 4px; background: #0d2a3c; cursor: pointer; }
.play-button { width: 29px; color: #00e9aa !important; border-color: #008b74 !important; background: #103e38 !important; }.reset-button { width: 27px; }
.spectrogram-playback time { flex: none; color: #d4ebf4; font: 9px ui-monospace,monospace; }
.timeline { position: relative; flex: 1; min-width: 120px; height: 24px; display: grid; align-items: center; }
.timeline input { position: relative; z-index: 2; width: 100%; margin: 0; accent-color: #00badc; }
.timeline-progress { position: absolute; z-index: 1; left: 2px; top: 11px; height: 2px; max-width: calc(100% - 4px); background: #00badc; pointer-events: none; }
.spectrogram-playback select { width: 49px; padding: 0 3px; font-size: 9px; }
.spectrogram-audio { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px; border-top: 1px solid rgba(55,132,163,.24); background: rgba(5,24,38,.94); }
.spectrogram-audio audio { flex: 1; min-width: 0; height: 30px; }
.spectrogram-audio button { flex: none; height: 24px; padding: 0 9px; color: #9edcf0; border: 1px solid #285c75; border-radius: 4px; background: #0d2a3c; cursor: pointer; font-size: 10px; }
.spectrogram-audio .audio-generate { color: #00e9aa; border-color: #008b74; background: #103e38; }
.spectrogram-audio .audio-preview { display: grid; place-items: center; width: 30px; padding: 0; }
.spectrogram-audio .audio-preview svg { width: 16px; height: 16px; }
.spectrogram-audio .audio-preview:disabled { cursor: wait; opacity: .7; }
.spectrogram-audio .audio-preview.generating { animation: pulse .9s ease-in-out infinite alternate; }
.spectrogram-audio .audio-download:hover,.spectrogram-audio .audio-generate:hover { color: #d9faff; border-color: #3f8fae; }
.audio-volume { flex: none; display: flex; align-items: center; gap: 5px; color: #8fb3c3; font-size: 9px; }
.audio-volume input { width: 72px; accent-color: #00badc; }
.audio-volume b { min-width: 27px; color: #9edcf0; font: 500 9px ui-monospace,monospace; }
@keyframes pulse { to { opacity: .35; } }
@media(max-width: 1050px) { .spectrogram-window { width: calc(58vw - 24px); }.waveform-window { width: calc(42vw - 30px); } }
@media(max-width: 720px) {
  .spectrogram-window { left: 54px; right: 8px; bottom: 8px; width: auto; }
  .waveform-window { left: 54px; right: 8px; top: 56px; bottom: auto; width: auto; }
  .spectrogram-plot { height: 220px; }
  .spectrogram-playback { gap: 5px; padding: 0 6px; }
  .spectrogram-playback time { font-size: 8px; }
  .spectrogram-playback select { width: 44px; }
}
</style>
