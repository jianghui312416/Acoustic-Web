<template>
  <section class="static-channel-view" :class="{ 'module-open': sidebarOpen }">
    <div ref="globeHost" class="static-globe"></div>
    <div v-if="!showResult" class="map-shade"></div>
    <template v-if="!showResult">
      <header class="page-heading">
        <h1>静态信道建模</h1>
      </header>

      <aside ref="parameterPanelRef" class="parameter-panel" :class="{ dragging: parameterPanelDragging }" :style="parameterPanelDragStyle">
        <header class="window-titlebar" title="拖动参数窗口；双击恢复默认位置" @pointerdown="startParameterPanelDrag" @dblclick="resetParameterPanelPosition">
          <span>静态信道参数</span>
          <i aria-hidden="true">❯❯❯</i>
        </header>
        <div class="panel-scroll">
          <p v-if="!propagationLinkReady" class="link-hint link-warning">请先在二维声场完成传播损失与声线计算。</p>

          <div class="section-caption"><span>阵列与信号</span></div>
          <div class="form-row"><label>阵元数量</label><select v-model.number="form.nElem"><option v-for="count in [16, 32, 64, 128, 256]" :key="count" :value="count">{{ count }}</option></select></div>
          <div class="form-row"><label>阵元间距(m)</label><input v-model.number="form.spacingM" type="number" min="0.01" max="20" step="0.05" /></div>
          <div class="form-row"><label>阵列航向(°)</label><input v-model.number="form.headingDeg" type="number" min="0" max="360" step="1" /></div>
          <div class="form-row"><label>中心频率(Hz)</label><input v-model.number="form.frequencyHz" type="number" min="20" max="12000" step="10" /></div>
          <div class="form-row"><label>发射模式</label><select v-model="form.transmissionMode"><option value="single_pulse">单次脉冲</option><option value="periodic">连续发射</option></select></div>
          <div class="form-row"><label>最小发射角(°)</label><input v-model.number="form.launchAngleMinDeg" type="number" min="-90" max="89" step="1" /></div>
          <div class="form-row"><label>最大发射角(°)</label><input v-model.number="form.launchAngleMaxDeg" type="number" min="-89" max="90" step="1" /></div>
          <div class="form-row"><label>CIR 采样率(Hz)</label><input v-model.number="form.sampleRateHz" type="number" min="1000" max="96000" step="1000" /></div>
          <div class="form-row"><label>探测波形</label><select v-model="form.waveformType"><option value="cw">CW 连续波</option><option value="lfm">LFM 线性调频</option></select></div>
          <div class="form-row"><label>LFM 带宽(Hz)</label><input v-model.number="form.lfmBandwidthHz" type="number" min="1" :max="Math.max(1, form.sampleRateHz * .8)" step="10" :disabled="form.waveformType !== 'lfm'" /></div>
          <div class="form-row"><label>脉冲宽度(ms)</label><input v-model.number="form.pulseDurationMs" type="number" min="0.1" :max="form.gatePeriodMs" step="0.1" /></div>
          <div class="form-row"><label>帧周期(ms)</label><input v-model.number="form.gatePeriodMs" type="number" min="1" max="200" step="1" /></div>
          <div class="form-row"><label>阵列孔径</label><div class="readonly-value">{{ apertureM.toFixed(2) }} m</div></div>
          <div class="form-row"><label>置空比(%)</label><input v-model.number="blankingPercent" type="number" min="0" max="95" step="0.5" /></div>
          <div class="form-row"><label>声源级(dB)</label><input v-model.number="form.sourceLevelDb" type="number" min="80" max="260" step="1" /></div>
          <div class="form-row"><label>增益(dB)</label><input v-model.number="form.gainDb" type="number" min="-40" max="40" step="1" /></div>
          <div v-if="latestEnvironmentNoise" class="form-row"><label>环境噪声级(dB)</label><div class="readonly-value">由环境噪声结果决定</div></div>
          <div v-else class="form-row"><label>环境噪声级(dB)</label><input v-model.number="form.ambientNoiseDb" type="number" min="20" max="180" step="1" /></div>
          <div class="form-row"><label>噪声种子</label><input v-model.number="form.noiseSeed" type="number" min="0" max="2147483647" step="1" /></div>
          <div class="form-row"><label>噪声开关</label><select v-model="form.noiseEnabled"><option :value="true">开启</option><option :value="false">关闭</option></select></div>

          <div class="waveform-preview">
            <div><b>发射预显示</b><span>{{ waveformPreviewLabel }}</span></div>
            <svg viewBox="0 0 320 72" preserveAspectRatio="none" aria-label="CW 或 LFM 发射波形预览">
              <line x1="4" y1="36" x2="316" y2="36" />
              <path :d="waveformPreviewPath" />
            </svg>
            <div class="frame-preview"><i :style="{ width: `${previewDutyPercent}%` }"></i><span>发射 {{ form.pulseDurationMs }} ms</span><em>{{ previewGuardLabel }}</em></div>
          </div>

          <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
        </div>
        <footer class="parameter-footer">
          <button v-if="result" type="button" class="history-button" @click="showCachedResult">查看上次结果</button>
          <button type="button" class="reset-button" @click="resetForm">恢复默认</button>
          <button type="button" class="calculate-button" :disabled="loading || !canCalculate" @click="runCalculation">
            {{ loading ? loadingText : '开始计算' }}
          </button>
        </footer>
      </aside>

      <div v-if="loading" class="loading-mask"><i></i><b>{{ loadingText }}</b><span>Bellhop 正在读取环境并生成静态信道…</span></div>
    </template>

    <template v-else>
      <aside class="result-window">
        <header class="result-toolbar">
          <div><strong>静态信道结果</strong></div>
          <button type="button" :disabled="receiverUpdating" @click="returnToSettings">← 返回计算</button>
        </header>

        <main class="result-grid">
        <article class="result-panel tl-panel">
          <header><div><span>01</span><b>阵元传播损失</b></div><em>dB</em></header>
          <div class="tl-summary"><div><span>最小</span><b>{{ result.transmission_loss.min_db.toFixed(2) }}</b></div><div><span>平均</span><b>{{ result.transmission_loss.mean_db.toFixed(2) }}</b></div><div><span>最大</span><b>{{ result.transmission_loss.max_db.toFixed(2) }}</b></div></div>
          <div class="element-list">
            <button v-for="element in result.elements" :key="element.element_index" type="button" :class="{ active: selectedElementIndex === element.element_index }" @click="selectedElementIndex = element.element_index">
              <span>#{{ String(element.element_index + 1).padStart(3, '0') }}</span>
              <i><em :style="{ width: `${tlBarWidth(element.transmission_loss_db)}%` }"></em></i>
              <b>{{ element.transmission_loss_db.toFixed(2) }}</b>
            </button>
          </div>
        </article>

        <article class="result-panel cir-panel">
          <header>
            <div><span>02</span><b>观察阵元 CIR（相对幅度）</b></div>
            <label><small>路径 {{ currentMultipathLabel }}</small>阵元 <select v-model.number="selectedElementIndex"><option v-for="element in result.elements" :key="element.element_index" :value="element.element_index">#{{ element.element_index + 1 }}</option></select></label>
          </header>
          <div class="cir-content">
            <svg viewBox="0 0 1000 210" preserveAspectRatio="none" aria-label="相对峰值幅度dB信道冲激响应">
              <defs><linearGradient id="cir-tap-gradient" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#218aa9"/><stop offset=".72" stop-color="#4de0ea"/><stop offset="1" stop-color="#ffd166"/></linearGradient></defs>
              <g class="cir-db-grid"><line v-for="level in cirDbGrid" :key="level.db" x1="45" :y1="level.y" x2="980" :y2="level.y"/></g>
              <rect v-if="cirAxisModel.broken" :x="cirAxisModel.breakLeft" y="18" :width="cirAxisModel.breakRight - cirAxisModel.breakLeft" height="174" class="cir-break-band"/>
              <g v-if="cirAxisModel.broken" class="cir-break-symbol" :transform="`translate(${(cirAxisModel.breakLeft + cirAxisModel.breakRight) / 2} 105)`"><line x1="-10" y1="10" x2="-2" y2="-10"/><line x1="2" y1="10" x2="10" y2="-10"/></g>
              <line x1="45" y1="18" x2="45" y2="192" class="axis-line"/>
              <g v-for="tap in cirStems" :key="tap.key" :class="tap.state">
                <title>{{ `${tap.delayMs.toFixed(3)} ms · ${tap.relativeDb.toFixed(2)} dB` }}</title>
                <line :x1="tap.x" y1="192" :x2="tap.x" :y2="tap.dbY" class="tap-db"/><circle :cx="tap.x" :cy="tap.dbY" r="4" class="tap-db-fill"/>
              </g>
            </svg>
            <div class="cir-db-axis"><span v-for="level in cirDbGrid" :key="level.db">{{ level.db }}{{ level.db === CIR_DB_FLOOR ? ' dB' : '' }}</span></div>
            <div v-if="cirAxisModel.broken" class="cir-axis broken"><span>0–{{ cirAxisModel.leftMax.toFixed(2) }} ms</span><b>// 跳过 {{ cirAxisModel.omittedMs.toFixed(1) }} ms</b><span>{{ cirAxisModel.rightMin.toFixed(2) }}–{{ cirDurationMs.toFixed(2) }} ms</span></div>
            <div v-else class="cir-axis"><span>0 ms</span><span>相对时延 {{ cirDurationMs.toFixed(3) }} ms</span></div>
            <div class="cir-legend"><span><i class="amplitude"></i>|h| 相对幅度</span><b>最强路径归一化为 0 dB · 显示下限 {{ CIR_DB_FLOOR }} dB</b></div>
            <dl v-if="selectedElement">
              <div><dt>复数抽头</dt><dd>{{ selectedElement.path_count }} 个</dd></div>
              <div><dt>首达时间</dt><dd>{{ selectedElement.impulse_response.reference_delay_s.toFixed(6) }} s</dd></div>
              <div><dt>相干 TL</dt><dd>{{ selectedElement.coherent_transmission_loss_db.toFixed(2) }} dB</dd></div>
              <div><dt>参数来源</dt><dd :title="arrivalFallbackReason">{{ arrivalSourceLabel }}</dd></div>
            </dl>
          </div>
        </article>

        <article class="result-panel tx-panel">
          <header>
            <div><span>03</span><b>发射—首达—多途</b></div>
            <div class="transmission-switch" role="group" aria-label="发射模式">
              <button type="button" :class="{ active: transmissionMode === 'single_pulse' }" :disabled="receiverUpdating" @click="changeTransmissionMode('single_pulse')">单次脉冲</button>
              <button type="button" :class="{ active: transmissionMode === 'periodic' }" :disabled="receiverUpdating" @click="changeTransmissionMode('periodic')">连续发射</button>
            </div>
            <em>{{ probeFrequencyLabel }}</em>
          </header>
          <div class="tx-content">
            <div class="absolute-timeline" aria-label="压缩断轴的发射与多途到达绝对时间概览">
              <div class="timeline-track">
                <i class="timeline-line"></i><i class="timeline-transmit"></i><i class="timeline-break">//</i><i class="timeline-first" :style="timelineFirstStyle"></i>
                <i v-for="tap in timelineTaps" :key="tap.key" class="timeline-tap" :class="tap.state" :style="{ left: `${tap.left}%` }"></i>
                <i class="timeline-playhead" :style="timelinePlayheadStyle"></i>
              </div>
              <div class="timeline-labels"><span>发射 0 s</span><b>传播置空 {{ selectedFirstArrivalS.toFixed(6) }} s · 断轴压缩</b><span>首达 {{ selectedFirstArrivalS.toFixed(6) }} s</span><span>末达 {{ selectedLastArrivalS.toFixed(6) }} s</span></div>
            </div>
            <div class="tx-chart">
              <svg viewBox="0 0 1000 130" preserveAspectRatio="none" :aria-label="`${transmissionModeLabel} CW 或 LFM 发射波形`">
                <line x1="42" y1="65" x2="985" y2="65" class="tx-axis" />
                <path :d="transmitWaveformPath" class="tx-wave" />
              </svg>
              <div><span>{{ transmitWindowStartMs.toFixed(2) }} ms</span><b>{{ transmissionSummary }}</b><span>{{ transmitWindowEndMs.toFixed(2) }} ms</span></div>
              <div class="tx-actions"><button type="button" @click="resetPlaybackToFirstArrival">复位首达</button><button type="button" @click="playbackPaused = !playbackPaused">{{ playbackPaused ? '继续' : '暂停' }}</button></div>
            </div>
          </div>
        </article>

        <section v-if="staticDomainFrame" class="static-domains" aria-label="静态信道五域分析">
          <MotionSignalDomains
            :frame="staticDomainFrame"
            :excluded="['cir']"
            :index-offset="3"
            :closable="false"
            embedded-grid
          />
        </section>
      </main>
      </aside>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { calculateStaticArrayChannel } from '@/api/staticChannelApi.js'
import MotionSignalDomains from '@/components/array-fusion/MotionSignalDomains.vue'
import { publishStaticChannel } from '@/modules/array-fusion/staticChannelState.js'
import {
  latestPropagationLink,
  propagationLinkVersion,
} from '@/modules/array-fusion/propagationLinkState.js'
import { applyGlobeCamera, captureGlobeCamera, registerGlobeViewer, sharedGlobeCamera } from '@/modules/array-fusion/globeCameraState.js'
import { latestEnvironmentNoise } from '@/modules/array-fusion/environmentNoiseState.js'
import { VOLUME_TL_COLOR_MAX, VOLUME_TL_COLOR_MIN, VOLUME_TL_COLOR_STOPS, buildTlGradient, sampleTlColorStops } from '@/sdk'
import { Cesium, createCesiumViewer } from '@/utils/cesium.js'
import { useDraggablePanel } from '@/composables/useDraggablePanel.js'

const props = defineProps({
  sidebarOpen: { type: Boolean, default: false },
})
const DEFAULTS = Object.freeze({
  sourceLon: 113.82, sourceLat: 13.46, sourceDepthM: 120,
  receiverLon: 114.06, receiverLat: 13.78, receiverDepthM: 80,
  nElem: 64, spacingM: 0.75, headingDeg: 90, frequencyHz: 1000,
  launchAngleMinDeg: -90, launchAngleMaxDeg: 90, sampleRateHz: 8000,
  transmissionMode: 'single_pulse', waveformType: 'cw', lfmBandwidthHz: 400, pulseDurationMs: 9.6, gatePeriodMs: 16,
  sourceLevelDb: 190, gainDb: 0, ambientNoiseDb: 78, noiseSeed: 20261015, noiseEnabled: true,
})
const form = reactive({ ...DEFAULTS })
const {
  panelRef: parameterPanelRef,
  dragging: parameterPanelDragging,
  dragStyle: parameterPanelDragStyle,
  startDragging: startParameterPanelDrag,
  resetPanelPosition: resetParameterPanelPosition,
} = useDraggablePanel()
const globeHost = ref(null)
const loading = ref(false)
const loadingText = ref('开始计算')
const errorMessage = ref('')
const result = ref(null)
const showResult = ref(false)
const selectedElementIndex = ref(0)
const fieldDisplayMode = ref('tl')
const tlCanvas = ref(null)
const fieldPlot = ref(null)
const receiverUpdating = ref(false)
const resultError = ref('')
const receiverDraft = reactive({ rangeKm: 0, depthM: 0 })
const receiverDrag = reactive({ active: false, pointerId: null, startRangeKm: 0, startDepthM: 0 })
let lastAppliedPropagationVersion = -1
const playbackTick = ref(0)
const playbackPaused = ref(false)
watch([result, selectedElementIndex], ([channel, elementIndex]) => {
  if (channel) publishStaticChannel(channel, elementIndex)
}, { flush: 'sync' })

let viewer = null
let unregisterGlobeViewer = () => {}
let mapFeatures = []
let fieldResizeObserver = null
let playbackTimer = null
const RAY_PLOT = Object.freeze({ left: 24, right: 976, top: 22, bottom: 448 })
const tlLegendStyle = Object.freeze({ background: buildTlGradient(VOLUME_TL_COLOR_STOPS) })

function routeGeometry(source, receiver) {
  const lon1 = Number(source.lon) * Math.PI / 180
  const lat1 = Number(source.lat) * Math.PI / 180
  const lon2 = Number(receiver.lon) * Math.PI / 180
  const lat2 = Number(receiver.lat) * Math.PI / 180
  const dLon = lon2 - lon1
  const dLat = lat2 - lat1
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const distanceM = 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return { distanceM, distanceNm: distanceM / 1852, bearingDeg: ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360 }
}

const geometry = computed(() => routeGeometry(
  { lon: form.sourceLon, lat: form.sourceLat },
  { lon: form.receiverLon, lat: form.receiverLat },
))
const propagationLinkReady = computed(() => Boolean(
  latestPropagationLink.value?.bellhopJobId && latestPropagationLink.value?.rayJobId
))
const noiseSourceLabel = computed(() => result.value?.noise?.source || result.value?.noise?.model || '内置噪声')
const apertureM = computed(() => Math.max(0, Number(form.nElem) - 1) * Number(form.spacingM))
const effectiveSourceLevelDb = computed(() => Math.max(80, Math.min(260,
  (Number(form.sourceLevelDb) || 0) + (Number(form.gainDb) || 0))))
const previewDutyPercent = computed(() => 100 * Math.max(0, Math.min(1, Number(form.pulseDurationMs) / Math.max(.001, Number(form.gatePeriodMs)))))
const previewBlankingPercent = computed(() => 100 - previewDutyPercent.value)
const blankingPercent = computed({
  get: () => previewBlankingPercent.value,
  set: (value) => {
    const percent = Math.max(0, Math.min(95, Number(value) || 0))
    const periodMs = Math.max(1, Number(form.gatePeriodMs) || 16)
    form.pulseDurationMs = Number(Math.max(0.1, periodMs * (1 - percent / 100)).toFixed(3))
  },
})
const previewGuardMs = computed(() => Math.max(0, Number(form.gatePeriodMs) - Number(form.pulseDurationMs)))
const previewGuardLabel = computed(() => form.transmissionMode === 'periodic' ? `保护 ${previewGuardMs.value.toFixed(1)} ms` : '单次发射 · 不重复')
const waveformPreviewLabel = computed(() => form.waveformType === 'lfm'
  ? `LFM · ${form.frequencyHz} Hz ± ${Number(form.lfmBandwidthHz) / 2} Hz`
  : `CW · ${form.frequencyHz} Hz`)
const waveformPreviewPath = computed(() => {
  const count = 180
  const periodS = Math.max(.001, Number(form.gatePeriodMs)) / 1000
  const pulseS = Math.max(.0001, Math.min(periodS, Number(form.pulseDurationMs) / 1000))
  const centerHz = Math.max(1, Number(form.frequencyHz))
  const bandwidthHz = Math.max(.1, Number(form.lfmBandwidthHz))
  const durationS = periodS * 2
  return Array.from({ length: count }, (_, index) => {
    const timeS = durationS * index / (count - 1)
    const pulseTimeS = form.transmissionMode === 'periodic' ? timeS % periodS : timeS
    let value = 0
    if (pulseTimeS < pulseS) {
      const phase = form.waveformType === 'lfm'
        ? 2 * Math.PI * ((centerHz - bandwidthHz / 2) * pulseTimeS + .5 * (bandwidthHz / pulseS) * pulseTimeS ** 2)
        : 2 * Math.PI * centerHz * timeS
      value = Math.cos(phase)
    }
    return `${index ? 'L' : 'M'} ${(4 + 312 * index / (count - 1)).toFixed(2)} ${(36 - value * 27).toFixed(2)}`
  }).join(' ')
})
const launchAngleValid = computed(() => {
  const minimum = Number(form.launchAngleMinDeg)
  const maximum = Number(form.launchAngleMaxDeg)
  return Number.isFinite(minimum) && Number.isFinite(maximum) && minimum >= -90 && maximum <= 90 && minimum < maximum
})
const canCalculate = computed(() => propagationLinkReady.value
  && geometry.value.distanceM > 100 && launchAngleValid.value
  && Number(form.gatePeriodMs) >= 1 && Number(form.gatePeriodMs) <= 200
  && Number(form.pulseDurationMs) >= .1 && Number(form.pulseDurationMs) <= Number(form.gatePeriodMs)
  && ['single_pulse', 'periodic'].includes(form.transmissionMode)
  && ['cw', 'lfm'].includes(form.waveformType)
  && [form.sourceLon, form.sourceLat, form.receiverLon, form.receiverLat, form.sourceDepthM, form.receiverDepthM, form.frequencyHz, form.sourceLevelDb, form.gainDb, form.ambientNoiseDb, form.noiseSeed].every((value) => Number.isFinite(Number(value))))
const selectedElement = computed(() => result.value?.elements?.[selectedElementIndex.value] ?? result.value?.elements?.[0] ?? null)
const nativeArrivalsUsed = computed(() => Boolean(result.value?.impulse_response?.native_arrivals_used))
const arrivalSourceLabel = computed(() => nativeArrivalsUsed.value ? 'Bellhop 原生幅相' : '声线几何回退')
const arrivalFallbackReason = computed(() => String(result.value?.impulse_response?.fallback_reason ?? ''))
const selectedFirstArrivalS = computed(() => Number(selectedElement.value?.impulse_response?.reference_delay_s ?? 0))
const selectedLastArrivalS = computed(() => Math.max(selectedFirstArrivalS.value, ...(selectedElement.value?.impulse_response?.taps ?? []).map((tap) => Number(tap.delay_s))))
const signalSampleRateHz = computed(() => Math.max(1, Number(result.value?.signal?.sample_rate_hz ?? 8000)))
const gatePeriodS = computed(() => Math.max(1e-6, Number(result.value?.signal?.gating?.period_s ?? 0.016)))
const transmissionMode = computed(() => result.value?.signal?.gating?.transmission_mode ?? form.transmissionMode ?? 'single_pulse')
const transmissionModeLabel = computed(() => transmissionMode.value === 'periodic' ? '连续发射' : '单次脉冲')
const playbackWindowSize = 256
const playbackRangeStartS = computed(() => Number(result.value?.signal?.timeline?.playback_start_s ?? Math.max(0, selectedFirstArrivalS.value - gatePeriodS.value)))
const playbackRangeEndS = computed(() => Number(result.value?.signal?.timeline?.playback_end_s ?? selectedLastArrivalS.value + 2 * gatePeriodS.value))
const playbackTimesS = computed(() => {
  const serverTimes = (result.value?.beam?.timeline?.time_s ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value))
  if (serverTimes.length) return serverTimes
  const start = playbackRangeStartS.value
  const end = Math.max(start, playbackRangeEndS.value)
  const pulseDurationS = Math.max(1 / signalSampleRateHz.value, Number(result.value?.signal?.gating?.on_duration_s ?? gatePeriodS.value))
  const stepS = Math.max(1 / signalSampleRateHz.value, Math.min(0.12, pulseDurationS / 4))
  const frameCount = Math.min(1024, Math.max(2, Math.ceil((end - start) / stepS) + 1))
  return Array.from({ length: frameCount }, (_, index) => start + (end - start) * index / Math.max(1, frameCount - 1))
})
const playbackMaximumIndex = computed(() => Math.max(0, playbackTimesS.value.length - 1))
const currentPlaybackIndex = computed(() => playbackMaximumIndex.value ? playbackTick.value % (playbackMaximumIndex.value + 1) : 0)
const currentPlaybackTimeS = computed(() => Number(playbackTimesS.value[currentPlaybackIndex.value] ?? playbackRangeStartS.value))
const analysisWindowTimes = computed(() => Array.from({ length: playbackWindowSize }, (_, index) => currentPlaybackTimeS.value + index / signalSampleRateHz.value))
const transmitOnDurationS = computed(() => Math.max(1e-6, Number(result.value?.signal?.gating?.on_duration_s ?? gatePeriodS.value)))
const transmitDisplayDurationS = computed(() => transmissionMode.value === 'periodic'
  ? 2 * gatePeriodS.value
  : Math.max(gatePeriodS.value, 1.25 * transmitOnDurationS.value))
const transmitDisplaySampleCount = computed(() => {
  const highestFrequencyHz = Math.max(...(result.value?.signal?.probe_frequencies_hz ?? []).map(Number).filter(Number.isFinite), 1)
  return Math.min(2048, Math.max(playbackWindowSize, Math.ceil(4 * highestFrequencyHz * transmitDisplayDurationS.value)))
})
const transmitWindowTimeS = computed(() => Array.from(
  { length: transmitDisplaySampleCount.value },
  (_, index) => index * transmitDisplayDurationS.value / Math.max(1, transmitDisplaySampleCount.value - 1),
))
const transmitWindowTimeMs = computed(() => transmitWindowTimeS.value.map((time) => 1000 * time))
const transmitWindowStartMs = computed(() => Number(transmitWindowTimeMs.value[0] ?? 0))
const transmitWindowEndMs = computed(() => Number(transmitWindowTimeMs.value.at(-1) ?? 0))
const transmitOnMs = computed(() => 1000 * transmitOnDurationS.value)
const transmitOffMs = computed(() => 1000 * Number(result.value?.signal?.gating?.off_duration_s ?? 0))
const transmissionSummary = computed(() => transmissionMode.value === 'periodic'
  ? `连续相位 · 开 ${transmitOnMs.value.toFixed(1)} / 关 ${transmitOffMs.value.toFixed(1)} ms`
  : `单次发射 · 脉宽 ${transmitOnMs.value.toFixed(1)} ms`)
const probeFrequencyLabel = computed(() => {
  const frequencies = (result.value?.signal?.probe_frequencies_hz ?? []).map(Number)
  if (result.value?.signal?.waveform_type === 'lfm' && frequencies.length >= 2) return `LFM ${frequencies[0].toFixed(0)}–${frequencies[1].toFixed(0)} Hz`
  return frequencies.length ? `CW ${frequencies[0].toFixed(0)} Hz` : '探测信号'
})
function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor
}
function gateOpen(emissionTimeS) {
  if (emissionTimeS < 0) return false
  const onDurationS = Number(result.value?.signal?.gating?.on_duration_s ?? gatePeriodS.value)
  if (transmissionMode.value === 'single_pulse') return emissionTimeS < onDurationS
  return positiveModulo(emissionTimeS, gatePeriodS.value) < onDurationS
}
function probeAt(emissionTimeS) {
  if (!gateOpen(emissionTimeS)) return 0
  const frequencies = result.value?.signal?.probe_frequencies_hz ?? []
  if (result.value?.signal?.waveform_type === 'lfm') {
    const start = Number(frequencies[0] ?? 0)
    const end = Number(frequencies[1] ?? start)
    const pulseTime = transmissionMode.value === 'periodic' ? positiveModulo(emissionTimeS, gatePeriodS.value) : emissionTimeS
    const pulseDuration = Math.max(1e-12, Number(result.value?.signal?.gating?.on_duration_s ?? gatePeriodS.value))
    const phase = 2 * Math.PI * (start * pulseTime + .5 * ((end - start) / pulseDuration) * pulseTime ** 2)
    return Math.SQRT2 * Math.cos(phase)
  }
  const frequency = Number(frequencies[0] ?? 0)
  return Math.SQRT2 * Math.cos(2 * Math.PI * frequency * emissionTimeS)
}
function synthesizeCleanElement(element, times) {
  const taps = element?.impulse_response?.taps ?? []
  return times.map((time) => taps.reduce((sum, tap) => {
    const emissionTime = Number(time) - Number(tap.delay_s)
    return sum + Number(tap.magnitude ?? 0) * probeAt(emissionTime)
  }, 0))
}
function sampleElementNoise(element, timeS) {
  const noise = element?.signal?.noise_waveform ?? []
  if (!result.value?.noise?.enabled || !noise.length) return 0
  const startS = Number(element?.signal?.window_start_s ?? element?.signal?.receive_time_s?.[0] ?? 0)
  const sampleIndex = Math.round((Number(timeS) - startS) * signalSampleRateHz.value)
  const wrappedIndex = positiveModulo(sampleIndex, noise.length)
  return Number(noise[wrappedIndex] ?? 0)
}
const transmitWindowSamples = computed(() => transmitWindowTimeS.value.map(probeAt))
const dynamicCleanElementWindows = computed(() => (result.value?.elements ?? []).map((element) => synthesizeCleanElement(element, analysisWindowTimes.value)))
const dynamicElementWindows = computed(() => (result.value?.elements ?? []).map((element, elementIndex) => {
  const clean = dynamicCleanElementWindows.value[elementIndex] ?? []
  return analysisWindowTimes.value.map((time, sampleIndex) => Number(clean[sampleIndex] ?? 0) + sampleElementNoise(element, time))
}))
const selectedWindowSamples = computed(() => dynamicElementWindows.value[selectedElementIndex.value] ?? [])
const selectedCleanWindowSamples = computed(() => dynamicCleanElementWindows.value[selectedElementIndex.value] ?? [])
const selectedSignalPresent = computed(() => selectedCleanWindowSamples.value.some((sample) => Math.abs(Number(sample)) > 1e-18))
const arraySignalPresent = computed(() => dynamicCleanElementWindows.value.some((samples) => samples.some((sample) => Math.abs(Number(sample)) > 1e-18)))
const receiverNoisePresent = computed(() => Boolean(result.value?.noise?.enabled && (selectedElement.value?.signal?.noise_waveform ?? []).length))
const environmentNoiseBandLabel = computed(() => {
  const range = result.value?.noise?.frequency_range_hz
  if (!Array.isArray(range) || range.length !== 2) return ''
  const lower = Number(range[0])
  const upper = Number(range[1])
  return Number.isFinite(lower) && Number.isFinite(upper)
    ? `环境噪声 ${Math.round(lower)}–${Math.round(upper)} Hz`
    : ''
})
const transmitWaveformPath = computed(() => {
  const values = transmitWindowSamples.value.filter(Number.isFinite)
  if (values.length < 2) return ''
  const maximum = Math.max(...values.map(Math.abs), 1e-12)
  return values.map((value, index) => {
    const x = 42 + (index / (values.length - 1)) * 943
    const y = 65 - (value / maximum) * 46
    return `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
})
const receiveTimelineStartS = computed(() => playbackRangeStartS.value)
function receiveTimelineLeft(timeS) {
  const time = Number(timeS)
  if (time <= selectedFirstArrivalS.value) {
    const preArrivalSpan = Math.max(1e-9, selectedFirstArrivalS.value - receiveTimelineStartS.value)
    return 62 + 6 * Math.max(0, Math.min(1, (time - receiveTimelineStartS.value) / preArrivalSpan))
  }
  const multipathSpan = Math.max(1e-9, selectedLastArrivalS.value - selectedFirstArrivalS.value)
  return 68 + 28 * Math.max(0, Math.min(1, (time - selectedFirstArrivalS.value) / multipathSpan))
}
const timelineFirstStyle = computed(() => ({ left: `${receiveTimelineLeft(selectedFirstArrivalS.value)}%` }))
const selectedSortedTaps = computed(() => [...(selectedElement.value?.impulse_response?.taps ?? [])].sort((left, right) => Number(left.delay_s) - Number(right.delay_s)))
const currentMultipathIndex = computed(() => {
  let active = -1
  selectedSortedTaps.value.forEach((tap, index) => {
    if (gateOpen(currentPlaybackTimeS.value - Number(tap.delay_s))) active = index
  })
  return active
})
const currentMultipathLabel = computed(() => {
  if (currentMultipathIndex.value >= 0) return `${currentMultipathIndex.value + 1}/${selectedSortedTaps.value.length}`
  if (!selectedSortedTaps.value.length) return '无到达路径'
  return currentPlaybackTimeS.value < selectedFirstArrivalS.value ? '等待首达' : '多径间隔'
})
function multipathState(index) {
  if (index === currentMultipathIndex.value) return 'current'
  return currentPlaybackTimeS.value >= Number(selectedSortedTaps.value[index]?.delay_s ?? Infinity) ? 'passed' : 'pending'
}
const timelineTaps = computed(() => {
  return selectedSortedTaps.value.map((tap, index) => ({
    key: `${tap.tap_index}-${index}`,
    left: receiveTimelineLeft(tap.delay_s),
    state: multipathState(index),
  }))
})
const timelinePlayheadStyle = computed(() => ({ left: `${receiveTimelineLeft(currentPlaybackTimeS.value)}%` }))

function resetPlaybackToFirstArrival() {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  playbackTimesS.value.forEach((time, index) => {
    const distance = Math.abs(Number(time) - selectedFirstArrivalS.value)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })
  playbackTick.value = nearestIndex
  playbackPaused.value = true
}

function windowedSpectrum(samples, times, frequencies, referenceAmplitude = 0) {
  const values = (samples ?? []).map(Number)
  const sampleTimes = (times ?? []).map(Number)
  const bins = (frequencies ?? []).map(Number)
  if (values.length < 2 || sampleTimes.length !== values.length || !bins.length) return []
  const origin = sampleTimes[0]
  let windowSum = 0
  const magnitudes = bins.map((frequency) => {
    let real = 0
    let imag = 0
    values.forEach((sample, index) => {
      const weight = values.length > 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (values.length - 1)) : 1
      if (frequency === bins[0]) windowSum += weight
      const phase = 2 * Math.PI * frequency * (sampleTimes[index] - origin)
      real += sample * weight * Math.cos(phase)
      imag -= sample * weight * Math.sin(phase)
    })
    return Math.hypot(real, imag)
  })
  const peak = Math.max(...magnitudes, 0)
  if (peak < 1e-18) return bins.map(() => -82)
  const fixedReference = Number(referenceAmplitude) > 0 ? Number(referenceAmplitude) * Math.max(windowSum, 1) / 2 : peak
  return magnitudes.map((magnitude) => Math.max(-82, Math.min(-28, 20 * Math.log10(Math.max(magnitude, 1e-18) / fixedReference) - 30)))
}

function selectSpatialFrequencies(signal) {
  const probes = (signal?.probe_frequencies_hz ?? []).map(Number).filter((value) => Number.isFinite(value) && value > 0)
  if (signal?.waveform_type !== 'lfm' || probes.length < 2) return probes.length ? [probes[0]] : []
  const low = Math.min(probes[0], probes[1])
  const high = Math.max(probes[0], probes[1])
  const candidates = (signal?.frequencies_hz ?? []).map(Number).filter((value) => Number.isFinite(value) && value >= low && value <= high)
  if (!candidates.length) return [low, high]
  const maximumBins = 24
  if (candidates.length <= maximumBins) return candidates
  return Array.from(new Set(Array.from(
    { length: maximumBins },
    (_, index) => candidates[Math.round(index * (candidates.length - 1) / (maximumBins - 1))],
  )))
}

function dynamicSpatialSpectrum(signal, scanAngles, elementWindows, times, frequencies) {
  const bins = frequencies?.length ? frequencies : selectSpatialFrequencies(signal)
  const angles = (scanAngles ?? []).map(Number)
  if (!bins.length || !angles.length || !times.length) return []
  const soundSpeed = Number(signal?.sound_speed_m_s ?? 1500)
  const origin = times[0] ?? 0
  const powers = angles.map(() => 0)
  bins.forEach((frequency) => {
    const snapshots = (result.value?.elements ?? []).map((element, elementIndex) => {
      const values = (elementWindows[elementIndex] ?? []).map(Number)
      let real = 0
      let imag = 0
      values.forEach((sample, index) => {
        const weight = values.length > 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (values.length - 1)) : 1
        const phase = 2 * Math.PI * frequency * ((times[index] ?? origin) - origin)
        real += sample * weight * Math.cos(phase)
        imag -= sample * weight * Math.sin(phase)
      })
      return { real, imag, offsetM: Number(element.offset_m ?? 0) }
    })
    angles.forEach((angle, angleIndex) => {
      let real = 0
      let imag = 0
      snapshots.forEach((snapshot) => {
        const phase = 2 * Math.PI * frequency * snapshot.offsetM * Math.sin(angle * Math.PI / 180) / soundSpeed
        real += snapshot.real * Math.cos(phase) - snapshot.imag * Math.sin(phase)
        imag += snapshot.real * Math.sin(phase) + snapshot.imag * Math.cos(phase)
      })
      powers[angleIndex] += real ** 2 + imag ** 2
    })
  })
  const peak = Math.max(...powers, 0)
  if (peak < 1e-30) return powers.map(() => -42)
  return powers.map((power) => Math.max(-42, 10 * Math.log10(Math.max(power, 1e-30) / peak)))
}

const dynamicElementSpectrum = computed(() => {
  const signal = result.value?.signal
  const tapMagnitudes = (selectedElement.value?.impulse_response?.taps ?? []).map((tap) => Math.abs(Number(tap.magnitude ?? 0)))
  const referenceAmplitude = Math.SQRT2 * Math.max(...tapMagnitudes, 1e-18)
  return windowedSpectrum(selectedWindowSamples.value, analysisWindowTimes.value, signal?.frequencies_hz, referenceAmplitude)
})
const spatialFrequencyBins = computed(() => selectSpatialFrequencies(result.value?.signal))
const dynamicSpatialCurve = computed(() => arraySignalPresent.value
  ? dynamicSpatialSpectrum(result.value?.signal, result.value?.beam?.scan_angles_deg, dynamicElementWindows.value, analysisWindowTimes.value, spatialFrequencyBins.value)
  : [])
const dynamicPeakAngleDeg = computed(() => {
  const curve = dynamicSpatialCurve.value
  const angles = result.value?.beam?.scan_angles_deg ?? []
  if (!curve.length) return 0
  const peakIndex = curve.reduce((best, value, index) => value > curve[best] ? index : best, 0)
  return Number(angles[peakIndex] ?? 0)
})
const dynamicBeamOutput = computed(() => {
  const elements = result.value?.elements ?? []
  if (!elements.length) return []
  const soundSpeed = Number(result.value?.signal?.sound_speed_m_s ?? 1500)
  const sine = Math.sin(dynamicPeakAngleDeg.value * Math.PI / 180)
  const sum = Array(playbackWindowSize).fill(0)
  elements.forEach((element, elementIndex) => {
    const samples = dynamicElementWindows.value[elementIndex] ?? []
    const correctionSamples = Number(element.offset_m ?? 0) * sine * signalSampleRateHz.value / soundSpeed
    sum.forEach((_, index) => {
      const position = index + correctionSamples
      const lower = Math.floor(position)
      const fraction = position - lower
      const left = samples[lower] ?? 0
      const right = samples[lower + 1] ?? left
      sum[index] += left + (right - left) * fraction
    })
  })
  return sum.map((sample) => sample / elements.length)
})
const staticDomainFrame = computed(() => {
  const element = selectedElement.value
  const signal = result.value?.signal
  const beam = result.value?.beam
  if (!element || !signal || !beam) return null
  return {
    frame: playbackTick.value,
    time: currentPlaybackTimeS.value,
    selectedElement: Number(element.element_index ?? 0),
    waveformTime: analysisWindowTimes.value.map((value) => Number(value).toFixed(6)),
    waveform: selectedWindowSamples.value,
    waveformTimeUnit: '绝对时间 / s',
    waveformLabel: `${selectedSignalPresent.value ? (receiverNoisePresent.value ? '有效到达 + 背景噪声' : '有效到达') : (receiverNoisePresent.value ? '当前窗口仅背景噪声' : '当前窗口无路径信号')} · ${currentPlaybackTimeS.value.toFixed(6)} s`,
    elementFrequencies: signal.frequencies_hz ?? [],
    elementSpectrum: dynamicElementSpectrum.value,
    probeFrequencies: signal.probe_frequencies_hz ?? [],
    frequencyLabel: `${probeFrequencyLabel.value} · ${selectedSignalPresent.value ? (receiverNoisePresent.value ? '信号 + 噪声' : transmissionModeLabel.value) : (receiverNoisePresent.value ? '当前窗口背景噪声底' : '当前窗口无路径信号')}`,
    timeFrequencyLabel: `${selectedSignalPresent.value ? (receiverNoisePresent.value ? '信号 + 背景噪声' : '有效到达') : (receiverNoisePresent.value ? '当前窗口背景噪声底' : '当前窗口无路径信号')}${environmentNoiseBandLabel.value ? ` · ${environmentNoiseBandLabel.value}` : ''}`,
    scanAngles: beam.scan_angles_deg ?? [],
    curve: dynamicSpatialCurve.value,
    spatialLabel: arraySignalPresent.value
      ? (signal.waveform_type === 'lfm' ? `当前有效到达 · LFM宽带融合 ${spatialFrequencyBins.value.length} 频点` : '当前有效到达 · CW窄带扫描')
      : (selectedSortedTaps.value.length ? '当前窗口处于多径间隔 · 空白' : '信道没有可用到达路径 · 空白'),
    beamOutputTime: analysisWindowTimes.value.map((value) => Number(value).toFixed(6)),
    beamOutput: dynamicBeamOutput.value,
    beamTimeUnit: '绝对时间 / s',
    beamLabel: `窗口起点 ${currentPlaybackTimeS.value.toFixed(6)} s`,
    impulseResponse: element.impulse_response?.taps ?? [],
    historySource: result.value,
  }
})

const rayExtent = computed(() => {
  const rays = result.value?.ray_geometry?.rays ?? []
  const ranges = rays.flatMap((ray) => ray.range_km ?? []).map(Number).filter(Number.isFinite)
  const depths = rays.flatMap((ray) => ray.depth_m ?? []).map(Number).filter(Number.isFinite)
  const bottomRanges = (result.value?.sound_field?.bathymetry?.range_m ?? []).map((value) => Number(value) / 1000).filter(Number.isFinite)
  const bottomDepths = (result.value?.sound_field?.bathymetry?.bottom_depth_m ?? []).map(Number).filter(Number.isFinite)
  const fieldRanges = (result.value?.sound_field?.range_km ?? []).map(Number).filter(Number.isFinite)
  const fieldDepths = (result.value?.sound_field?.depth_m ?? []).map(Number).filter(Number.isFinite)
  const fieldMaxRange = fieldRanges.length ? Math.max(...fieldRanges) : Number.NaN
  const fieldMaxDepth = fieldDepths.length ? Math.max(...fieldDepths) : Number.NaN
  return {
    // 静态信道只展示声源到阵列的 TL 剖面；Bellhop 为追踪而多算的远程声线不应扩大显示轴。
    maxRange: Number.isFinite(fieldMaxRange) && fieldMaxRange > 0 ? fieldMaxRange : Math.max(result.value?.array?.center_range_km ?? 1, ...bottomRanges, ...ranges, 1),
    maxDepth: Number.isFinite(fieldMaxDepth) && fieldMaxDepth > 0 ? fieldMaxDepth : Math.max(result.value?.array?.depth_m ?? 1, ...bottomDepths, ...depths, 1),
  }
})
function rayPlotPoint(rangeKm, depthM, clampToPlot = true) {
  const width = RAY_PLOT.right - RAY_PLOT.left
  const height = RAY_PLOT.bottom - RAY_PLOT.top
  const range = Number(rangeKm)
  const depth = Number(depthM)
  return {
    x: RAY_PLOT.left + ((clampToPlot ? Math.max(0, Math.min(rayExtent.value.maxRange, range)) : range) / rayExtent.value.maxRange) * width,
    y: RAY_PLOT.top + ((clampToPlot ? Math.max(0, Math.min(rayExtent.value.maxDepth, depth)) : depth) / rayExtent.value.maxDepth) * height,
  }
}
const rayPaths = computed(() => (result.value?.ray_geometry?.rays ?? []).map((ray, index) => {
  const points = (ray.range_km ?? []).map((range, pointIndex) => ({ range: Number(range), depth: Number(ray.depth_m?.[pointIndex]) })).filter((point) => Number.isFinite(point.range) && Number.isFinite(point.depth))
  const path = points.map((point, pointIndex) => {
    const plotPoint = rayPlotPoint(point.range, point.depth, false)
    return `${pointIndex ? 'L' : 'M'} ${plotPoint.x} ${plotPoint.y}`
  }).join(' ')
  return { key: `${ray.ray_index}-${index}`, path }
}))
const bathymetryPlotPoints = computed(() => {
  const ranges = (result.value?.sound_field?.bathymetry?.range_m ?? []).map((value) => Number(value) / 1000)
  const depths = (result.value?.sound_field?.bathymetry?.bottom_depth_m ?? []).map(Number)
  const samples = ranges.map((range, index) => [range, depths[index]]).filter(([range, depth]) => Number.isFinite(range) && Number.isFinite(depth)).sort((a, b) => a[0] - b[0])
  if (!samples.length) return []
  const sampleRanges = samples.map(([range]) => range)
  const sampleDepths = samples.map(([, depth]) => depth)
  const plotRanges = [0, ...sampleRanges.filter((range) => range > 0 && range < rayExtent.value.maxRange), rayExtent.value.maxRange]
  return plotRanges.map((range) => rayPlotPoint(range, interpolateSeries(sampleRanges, sampleDepths, range)))
})
const terrainLinePath = computed(() => bathymetryPlotPoints.value.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '))
const terrainMaskPath = computed(() => terrainLinePath.value ? `${terrainLinePath.value} L ${RAY_PLOT.right} ${RAY_PLOT.bottom} L ${RAY_PLOT.left} ${RAY_PLOT.bottom} Z` : '')
const waterClipPath = computed(() => {
  if (!bathymetryPlotPoints.value.length) return `M ${RAY_PLOT.left} ${RAY_PLOT.top} H ${RAY_PLOT.right} V ${RAY_PLOT.bottom} H ${RAY_PLOT.left} Z`
  const reverseBottom = [...bathymetryPlotPoints.value].reverse().map((point) => `L ${point.x} ${point.y}`).join(' ')
  return `M ${RAY_PLOT.left} ${RAY_PLOT.top} L ${RAY_PLOT.right} ${RAY_PLOT.top} ${reverseBottom} Z`
})
const sourceMarker = computed(() => rayPlotPoint(0, Number(result.value?.source?.depth_m ?? 0)))
const receiverMarker = computed(() => rayPlotPoint(
  Number(receiverDraft.rangeKm || result.value?.array?.center_range_km || 0),
  Number(receiverDraft.depthM ?? result.value?.array?.depth_m ?? 0),
))
const receiverHandleStyle = computed(() => ({
  left: `${(receiverMarker.value.x / 1000) * 100}%`,
  top: `${(receiverMarker.value.y / 470) * 100}%`,
}))
const cirDurationMs = computed(() => Math.max(0, ...(selectedElement.value?.impulse_response?.taps ?? []).map((tap) => Number(tap.excess_delay_s) * 1000)))
const CIR_DB_FLOOR = -60
const CIR_PLOT = Object.freeze({ left: 45, right: 980, breakLeft: 730, breakRight: 815 })
const cirDbGrid = Object.freeze([0, -20, -40, CIR_DB_FLOOR].map((db) => ({ db, y: 18 + (-db / -CIR_DB_FLOOR) * 174 })))
const cirAxisModel = computed(() => {
  const delays = selectedSortedTaps.value.map((tap) => Math.max(0, Number(tap.excess_delay_s) * 1000)).sort((left, right) => left - right)
  const duration = Math.max(cirDurationMs.value, 0.001)
  let largestGap = 0
  let largestGapIndex = -1
  for (let index = 0; index < delays.length - 1; index += 1) {
    const gap = delays[index + 1] - delays[index]
    if (gap > largestGap) { largestGap = gap; largestGapIndex = index }
  }
  const broken = largestGapIndex >= 0 && largestGap > Math.max(50, duration * 0.28)
  const leftMax = broken ? delays[largestGapIndex] : duration
  const rightMin = broken ? delays[largestGapIndex + 1] : duration
  return {
    ...CIR_PLOT,
    broken,
    leftMax,
    rightMin,
    omittedMs: broken ? Math.max(0, rightMin - leftMax) : 0,
  }
})
function cirDelayX(delayMs) {
  const axis = cirAxisModel.value
  if (!axis.broken) return axis.left + (delayMs / Math.max(cirDurationMs.value, 0.001)) * (axis.right - axis.left)
  if (delayMs <= axis.leftMax) return axis.left + (delayMs / Math.max(axis.leftMax, 0.001)) * (axis.breakLeft - axis.left)
  const tailSpan = cirDurationMs.value - axis.rightMin
  if (tailSpan <= 1e-6) return axis.breakRight + 0.72 * (axis.right - axis.breakRight)
  return axis.breakRight + ((delayMs - axis.rightMin) / tailSpan) * (axis.right - axis.breakRight)
}
const cirStems = computed(() => {
  const taps = selectedSortedTaps.value
  const magnitudes = taps.map((tap) => Math.max(0, Number(tap.magnitude ?? Math.hypot(Number(tap.gain_real ?? 0), Number(tap.gain_imag ?? 0)))))
  const peakMagnitude = Math.max(...magnitudes, 1e-300)
  return taps.map((tap, index) => {
    const delayMs = Number(tap.excess_delay_s) * 1000
    const relativeDb = Math.max(CIR_DB_FLOOR, 20 * Math.log10(Math.max(magnitudes[index], 1e-300) / peakMagnitude))
    return {
      key: `${tap.tap_index}-${index}`,
      x: cirDelayX(delayMs),
      delayMs,
      relativeDb,
      dbY: 18 + (-relativeDb / -CIR_DB_FLOOR) * 174,
      state: multipathState(index),
    }
  })
})

function interpolateSeries(xValues, yValues, target) {
  if (!xValues.length || xValues.length !== yValues.length) return Number.POSITIVE_INFINITY
  if (target <= xValues[0]) return yValues[0]
  for (let index = 1; index < xValues.length; index += 1) {
    if (target <= xValues[index]) {
      const width = xValues[index] - xValues[index - 1]
      const ratio = width > 0 ? (target - xValues[index - 1]) / width : 0
      return yValues[index - 1] + (yValues[index] - yValues[index - 1]) * ratio
    }
  }
  return yValues.at(-1)
}

function tlColor(value) {
  const numericValue = Number(value)
  const span = VOLUME_TL_COLOR_MAX - VOLUME_TL_COLOR_MIN
  const normalized = Math.max(0, Math.min(1, (numericValue - VOLUME_TL_COLOR_MIN) / span))
  const [r, g, b] = sampleTlColorStops(normalized, VOLUME_TL_COLOR_STOPS)
  return `rgb(${r},${g},${b})`
}

function canvasPlotBounds(width, height) {
  const left = (RAY_PLOT.left / 1000) * width
  const right = (RAY_PLOT.right / 1000) * width
  const top = (RAY_PLOT.top / 470) * height
  const bottom = (RAY_PLOT.bottom / 470) * height
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function drawFieldMarker(context, x, y, color, label, align = 'left') {
  context.save()
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = 1.2
  context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill()
  context.beginPath(); context.moveTo(x - 10, y); context.lineTo(x + 10, y); context.moveTo(x, y - 10); context.lineTo(x, y + 10); context.stroke()
  context.font = '10px sans-serif'
  context.textAlign = align
  context.textBaseline = 'middle'
  context.shadowColor = '#00101a'
  context.shadowBlur = 3
  context.fillText(label, x + (align === 'right' ? -13 : 13), y)
  context.restore()
}

function drawTlField() {
  const canvas = tlCanvas.value
  const field = result.value?.sound_field
  if (!canvas || !field?.range_km?.length || !field?.depth_m?.length || !field?.tl_db?.length) return
  const width = Math.max(10, canvas.clientWidth)
  const height = Math.max(10, canvas.clientHeight)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
  const context = canvas.getContext('2d'); context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height); context.fillStyle = '#03101d'; context.fillRect(0, 0, width, height)
  const ranges = field.range_km.map(Number); const depths = field.depth_m.map(Number)
  const maxRange = rayExtent.value.maxRange; const maxDepth = rayExtent.value.maxDepth
  const plot = canvasPlotBounds(width, height)
  const bottomRangeKm = (field.bathymetry?.range_m ?? []).map((value) => Number(value) / 1000)
  const bottomDepthM = (field.bathymetry?.bottom_depth_m ?? []).map(Number)
  const rangeStep = ranges.length > 1 ? Math.abs(ranges.at(-1) - ranges[0]) / (ranges.length - 1) : maxRange
  const depthStep = depths.length > 1 ? Math.abs(depths.at(-1) - depths[0]) / (depths.length - 1) : maxDepth
  const cellWidth = (rangeStep / maxRange) * plot.width; const cellHeight = (depthStep / maxDepth) * plot.height
  context.save(); context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip()
  depths.forEach((depth, depthIndex) => {
    const row = field.tl_db[depthIndex] ?? []
    ranges.forEach((range, rangeIndex) => {
      const bottom = interpolateSeries(bottomRangeKm, bottomDepthM, range)
      const value = Number(row[rangeIndex])
      if (depth > bottom || !Number.isFinite(value)) return
      context.fillStyle = tlColor(value)
      context.fillRect(plot.left + (range / maxRange) * plot.width - cellWidth / 2, plot.top + (depth / maxDepth) * plot.height - cellHeight / 2, cellWidth + 1, cellHeight + 1)
    })
  })
  if (bottomRangeKm.length && bottomDepthM.length) {
    context.beginPath()
    bottomRangeKm.forEach((range, index) => {
      const x = plot.left + (range / maxRange) * plot.width; const y = Math.min(plot.bottom, plot.top + (bottomDepthM[index] / maxDepth) * plot.height)
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y)
    })
    context.lineTo(plot.right, plot.bottom); context.lineTo(plot.left, plot.bottom); context.closePath()
    context.fillStyle = 'rgba(100,116,139,0.5)'; context.fill()
    context.beginPath()
    bottomRangeKm.forEach((range, index) => {
      const x = plot.left + (range / maxRange) * plot.width; const y = Math.min(plot.bottom, plot.top + (bottomDepthM[index] / maxDepth) * plot.height)
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y)
    })
    context.strokeStyle = 'rgba(241,245,249,0.95)'; context.lineWidth = 1.6; context.stroke()
  }
  context.restore()
  const sourceX = plot.left
  const sourceY = plot.top + (Number(result.value.source.depth_m) / maxDepth) * plot.height
  drawFieldMarker(context, sourceX, sourceY, '#ffd166', '声源')
}

function observeTlField() {
  fieldResizeObserver?.disconnect()
  if (!tlCanvas.value?.parentElement) return
  fieldResizeObserver = new ResizeObserver(() => drawTlField())
  fieldResizeObserver.observe(tlCanvas.value.parentElement)
  drawTlField()
}

function syncReceiverDraft(channelResult = result.value) {
  receiverDraft.rangeKm = Number(channelResult?.array?.center_range_km ?? 0)
  receiverDraft.depthM = Number(channelResult?.array?.depth_m ?? 0)
  form.transmissionMode = channelResult?.signal?.gating?.transmission_mode ?? form.transmissionMode
}

function currentChannelPayload(channelResult = result.value) {
  return {
    bellhop_job_id: channelResult?.bellhop_job_id,
    ray_job_id: channelResult?.ray_job_id,
    arrival_job_id: channelResult?.arrival_job_id,
    range_km: Number(receiverDraft.rangeKm),
    receiver_depth_m: Number(receiverDraft.depthM),
    n_elem: Number(form.nElem),
    element_spacing_m: Number(form.spacingM),
    array_heading_deg: Number(form.headingDeg),
    frequency_hz: Number(form.frequencyHz),
    impulse_sample_rate_hz: Number(form.sampleRateHz),
    transmission_mode: form.transmissionMode,
    waveform_type: form.waveformType,
    noise_enabled: Boolean(form.noiseEnabled),
    source_level_db: effectiveSourceLevelDb.value,
    ambient_noise_db: Number(form.ambientNoiseDb),
    noise_seed: Math.round(Number(form.noiseSeed)),
    lfm_bandwidth_hz: Number(form.lfmBandwidthHz),
    pulse_duration_s: Number(form.pulseDurationMs) / 1000,
    gate_period_s: Number(form.gatePeriodMs) / 1000,
    max_section_error_deg: 8,
    native_arrivals_enabled: true,
    arrival_beam_count: 0,
    environment_noise: latestEnvironmentNoise.value,
  }
}

function updateReceiverDraftFromPointer(event) {
  const plotElement = fieldPlot.value
  if (!plotElement || !result.value) return
  const rect = plotElement.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return
  const viewX = ((event.clientX - rect.left) / rect.width) * 1000
  const viewY = ((event.clientY - rect.top) / rect.height) * 470
  const xRatio = Math.max(0, Math.min(1, (viewX - RAY_PLOT.left) / (RAY_PLOT.right - RAY_PLOT.left)))
  const yRatio = Math.max(0, Math.min(1, (viewY - RAY_PLOT.top) / (RAY_PLOT.bottom - RAY_PLOT.top)))
  const halfApertureKm = apertureM.value / 2000
  const minimumRangeKm = Math.max(0.001, halfApertureKm)
  const maximumRangeKm = Math.max(minimumRangeKm, rayExtent.value.maxRange - halfApertureKm)
  const rangeKm = Math.max(minimumRangeKm, Math.min(maximumRangeKm, xRatio * rayExtent.value.maxRange))
  const bottomRanges = (result.value.sound_field?.bathymetry?.range_m ?? []).map((value) => Number(value) / 1000)
  const bottomDepths = (result.value.sound_field?.bathymetry?.bottom_depth_m ?? []).map(Number)
  const bottomDepthM = interpolateSeries(bottomRanges, bottomDepths, rangeKm)
  const waterDepthLimitM = Number.isFinite(bottomDepthM)
    ? Math.max(0, Math.min(rayExtent.value.maxDepth, bottomDepthM - 1))
    : rayExtent.value.maxDepth
  receiverDraft.rangeKm = rangeKm
  receiverDraft.depthM = Math.max(0, Math.min(waterDepthLimitM, yRatio * rayExtent.value.maxDepth))
}

function beginReceiverDrag(event) {
  if (receiverUpdating.value || !result.value) return
  resultError.value = ''
  receiverDrag.active = true
  receiverDrag.pointerId = event.pointerId
  receiverDrag.startRangeKm = Number(receiverDraft.rangeKm)
  receiverDrag.startDepthM = Number(receiverDraft.depthM)
  event.currentTarget.setPointerCapture?.(event.pointerId)
  updateReceiverDraftFromPointer(event)
  event.preventDefault()
}

function moveReceiverDrag(event) {
  if (!receiverDrag.active || event.pointerId !== receiverDrag.pointerId) return
  updateReceiverDraftFromPointer(event)
  event.preventDefault()
}

function cancelReceiverDrag(event) {
  if (!receiverDrag.active || event.pointerId !== receiverDrag.pointerId) return
  receiverDraft.rangeKm = receiverDrag.startRangeKm
  receiverDraft.depthM = receiverDrag.startDepthM
  receiverDrag.active = false
  receiverDrag.pointerId = null
}

async function updateReceiverChannel() {
  if (!result.value || receiverUpdating.value) return
  const previousResult = result.value
  receiverUpdating.value = true
  resultError.value = ''
  try {
    const updated = await calculateStaticArrayChannel(currentChannelPayload(previousResult))
    result.value = updated
    selectedElementIndex.value = Math.min(selectedElementIndex.value, Math.max(0, updated.elements.length - 1))
    syncReceiverDraft(updated)
    resetPlaybackToFirstArrival()
    if (Number.isFinite(Number(updated.array?.center_lon))) form.receiverLon = Number(updated.array.center_lon)
    if (Number.isFinite(Number(updated.array?.center_lat))) form.receiverLat = Number(updated.array.center_lat)
    form.receiverDepthM = Number(updated.array.depth_m)
    await nextTick()
    if (fieldDisplayMode.value === 'tl') drawTlField()
    return true
  } catch (error) {
    result.value = previousResult
    syncReceiverDraft(previousResult)
    resultError.value = error?.message || String(error)
    return false
  } finally {
    receiverUpdating.value = false
  }
}

async function changeTransmissionMode(mode) {
  if (!result.value || receiverUpdating.value || mode === transmissionMode.value) return
  const previousMode = form.transmissionMode
  form.transmissionMode = mode
  playbackPaused.value = true
  const updated = await updateReceiverChannel()
  if (!updated) {
    form.transmissionMode = previousMode
    return
  }
  resetPlaybackToFirstArrival()
}

async function endReceiverDrag(event) {
  if (!receiverDrag.active || event.pointerId !== receiverDrag.pointerId) return
  updateReceiverDraftFromPointer(event)
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  receiverDrag.active = false
  receiverDrag.pointerId = null
  const changed = Math.abs(receiverDraft.rangeKm - receiverDrag.startRangeKm) > 1e-6 || Math.abs(receiverDraft.depthM - receiverDrag.startDepthM) > 1e-6
  if (changed) await updateReceiverChannel()
}

function clearFeatures() { if (viewer?.features) mapFeatures.forEach((feature) => { try { viewer.features.remove(feature) } catch {} }); mapFeatures = [] }
function addFeature(feature) { if (!feature || !viewer?.features) return; try { mapFeatures.push(feature.addTo(viewer.features) || feature) } catch {} }
function renderFeatures() {
  if (!viewer?.features) return
  clearFeatures()
  const source = [Number(form.sourceLon), Number(form.sourceLat), 700]
  const receiver = [Number(form.receiverLon), Number(form.receiverLat), 700]
  const amber = Cesium.Color.fromCssColorString('#ffc65c')
  const cyan = Cesium.Color.fromCssColorString('#39d9ff')
  addFeature(new Cesium.Point(source, { color: amber, pixelSize: 15, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }))
  addFeature(new Cesium.Point(receiver, { color: cyan, pixelSize: 15, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }))
  addFeature(new Cesium.Polyline([source, receiver], { colors: [amber.withAlpha(.72), cyan.withAlpha(.72)], width: 3 }))
  viewer.scene?.requestRender?.()
}
function applyLatestPropagationLink(force = false) {
  const link = latestPropagationLink.value
  if (!link || (!force && lastAppliedPropagationVersion === propagationLinkVersion.value)) return false
  const receiver = link.receiver
  form.sourceLon = Number(link.source?.lon)
  form.sourceLat = Number(link.source?.lat)
  form.sourceDepthM = Number(link.source?.depthM)
  if (receiver) {
    form.receiverLon = Number(receiver.lon)
    form.receiverLat = Number(receiver.lat)
    form.receiverDepthM = Number(receiver.depthM)
  }
  if (Number(link.frequencyHz) > 0) form.frequencyHz = Number(link.frequencyHz)
  const grazing = Number(link.portalParams?.grazingAngle)
  const beamWidth = Number(link.portalParams?.beamWidth)
  if (Number.isFinite(grazing) && Number.isFinite(beamWidth)) {
    form.launchAngleMinDeg = grazing - beamWidth / 2
    form.launchAngleMaxDeg = grazing + beamWidth / 2
  }
  lastAppliedPropagationVersion = propagationLinkVersion.value
  nextTick(() => renderFeatures())
  return true
}
function resetForm() {
  Object.assign(form, DEFAULTS)
  errorMessage.value = ''
  if (!applyLatestPropagationLink(true)) renderFeatures()
}
function showCachedResult() {
  if (!result.value) return
  showResult.value = true
  resetPlaybackToFirstArrival()
  nextTick(() => { observeTlField(); if (fieldDisplayMode.value === 'tl') drawTlField() })
}
function returnToSettings() {
  fieldResizeObserver?.disconnect()
  receiverDrag.active = false
  receiverDrag.pointerId = null
  receiverUpdating.value = false
  resultError.value = ''
  showResult.value = false
  selectedElementIndex.value = 0
  playbackTick.value = 0
  playbackPaused.value = false
  applyLatestPropagationLink()
  nextTick(() => renderFeatures())
}
function tlBarWidth(value) {
  const min = Number(result.value?.transmission_loss?.min_db ?? value)
  const max = Number(result.value?.transmission_loss?.max_db ?? value)
  return max > min ? 18 + ((Number(value) - min) / (max - min)) * 82 : 70
}

async function runCalculation() {
  if (!canCalculate.value || loading.value) return
  loading.value = true; errorMessage.value = ''
  loadingText.value = '计算各阵元复数 CIR'
  try {
    const link = latestPropagationLink.value
    const jobId = String(link?.bellhopJobId || '').trim()
    const rayJobId = String(link?.rayJobId || '').trim()
    if (!jobId || !rayJobId) throw new Error('请先在二维声场完成传播损失和声线计算')
    loadingText.value = '计算 Bellhop 原生到达并生成各阵元复数 CIR'
    result.value = await calculateStaticArrayChannel({
      bellhop_job_id: jobId,
      ray_job_id: rayJobId,
      source_lon: Number(form.sourceLon), source_lat: Number(form.sourceLat),
      receiver_lon: Number(form.receiverLon), receiver_lat: Number(form.receiverLat), receiver_depth_m: Number(form.receiverDepthM),
      n_elem: Number(form.nElem), element_spacing_m: Number(form.spacingM), array_heading_deg: Number(form.headingDeg),
      frequency_hz: Number(form.frequencyHz), impulse_sample_rate_hz: Number(form.sampleRateHz),
      transmission_mode: form.transmissionMode,
      waveform_type: form.waveformType, lfm_bandwidth_hz: Number(form.lfmBandwidthHz),
      noise_enabled: Boolean(form.noiseEnabled),
      source_level_db: effectiveSourceLevelDb.value,
      ambient_noise_db: Number(form.ambientNoiseDb),
      noise_seed: Math.round(Number(form.noiseSeed)),
      pulse_duration_s: Number(form.pulseDurationMs) / 1000, gate_period_s: Number(form.gatePeriodMs) / 1000,
      max_section_error_deg: 8,
      native_arrivals_enabled: true,
      arrival_beam_count: 0,
      environment_noise: latestEnvironmentNoise.value,
    })
    showResult.value = true
    syncReceiverDraft(result.value)
    resultError.value = ''
    selectedElementIndex.value = 0
    resetPlaybackToFirstArrival()
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  } finally {
    loading.value = false; loadingText.value = '开始计算'
  }
}

onMounted(async () => {
  applyLatestPropagationLink(true)
  await nextTick()
  viewer = createCesiumViewer(globeHost.value, { requestWebgl2: false })
  viewer.scene.globe.depthTestAgainstTerrain = false
  unregisterGlobeViewer = registerGlobeViewer('communication', viewer)
  applyGlobeCamera(viewer)
  renderFeatures()
  playbackTimer = window.setInterval(() => {
    if (result.value && !playbackPaused.value) playbackTick.value += 1
  }, 120)
})
onActivated(async () => {
  if (!showResult.value) {
    applyLatestPropagationLink()
    await nextTick()
    // 进入通信模块时沿用传播模块离开前的数字地球视角，不重新定位链路。
    applyGlobeCamera(viewer)
    renderFeatures()
    return
  }
  await nextTick()
  observeTlField()
  if (fieldDisplayMode.value === 'tl') drawTlField()
})
onDeactivated(() => {
  if (viewer && !viewer.isDestroyed?.()) captureGlobeCamera(viewer)
})
watch(fieldDisplayMode, async (mode) => { if (mode === 'tl') { await nextTick(); drawTlField() } })
watch(selectedElementIndex, async () => { await nextTick(); resetPlaybackToFirstArrival() })
watch(propagationLinkVersion, () => { if (!showResult.value) applyLatestPropagationLink() })
// 传播模块离开/进入通信时相机状态会更新；即使本组件被 KeepAlive 隐藏也同步。
watch(sharedGlobeCamera, () => {
  if (viewer && !viewer.isDestroyed?.()) applyGlobeCamera(viewer)
})
onBeforeUnmount(() => { unregisterGlobeViewer(); if (viewer && !viewer.isDestroyed?.()) captureGlobeCamera(viewer); if (playbackTimer) window.clearInterval(playbackTimer); fieldResizeObserver?.disconnect(); clearFeatures(); if (viewer && !viewer.isDestroyed?.()) viewer.destroy(); viewer = null })
</script>

<style scoped>
.static-channel-view { position: absolute; inset: 54px 0 0; min-width: 980px; overflow: hidden; color: #d9f7ff; background: #020b15; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
.static-globe { position: absolute; inset: 0; }.static-globe :deep(.cesium-widget),.static-globe :deep(canvas){width:100%;height:100%}.map-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(1,11,20,.12) 34%,rgba(1,11,20,.7) 72%,rgba(1,11,20,.94))}
.page-heading{position:absolute;top:36px;left:38px;pointer-events:none;text-shadow:0 2px 12px #000}.page-heading span{color:#48cbea;font:10px Consolas,monospace;letter-spacing:2.6px}.page-heading h1{margin:8px 0 7px;font-size:26px;font-weight:500;letter-spacing:4px}.page-heading p{margin:0;color:#88aeb9;font-size:12px}
.parameter-panel{position:absolute;z-index:10;top:18px;right:20px;bottom:18px;width:390px;display:grid;grid-template-rows:48px minmax(0,1fr) 58px;border:1px solid rgba(66,190,221,.38);background:rgba(2,21,34,.95);box-shadow:0 18px 55px rgba(0,0,0,.45)}.panel-title{display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid rgba(67,166,193,.22);background:linear-gradient(90deg,rgba(21,103,129,.35),transparent)}.panel-title b{font-size:15px;letter-spacing:2px}.panel-title span{color:#5dcde8;font-size:9px}.panel-scroll{padding:4px 16px 16px;overflow-y:auto;scrollbar-color:#245f73 #061a28;scrollbar-width:thin}.section-title{display:flex;justify-content:space-between;margin:14px 0 9px;padding-left:8px;border-left:2px solid #36cbe9;color:#8fc5d2;font-size:11px;letter-spacing:1px}.section-title em{color:#5e8c98;font:9px Consolas,monospace;font-style:normal;letter-spacing:0}
.coordinate-card{margin-top:10px;padding:10px;border:1px solid rgba(69,152,176,.2);background:rgba(7,43,59,.48)}.coordinate-card.source{border-left:2px solid #ffc65c}.coordinate-card.receiver{border-left:2px solid #39d9ff}.coordinate-card>div:first-child{display:flex;justify-content:space-between}.coordinate-card b{font-size:11px}.coordinate-card em{color:#648b96;font-size:9px;font-style:normal}.coords{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.coords label span,.coordinate-bottom label>span,.form-grid label>span{display:block;margin-bottom:4px;color:#7198a3;font-size:9px}.coordinate-bottom{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.coordinate-bottom label>div,.form-grid label>div{display:flex;align-items:center}.coordinate-bottom button{height:45px;margin-top:13px;border:1px solid rgba(70,159,183,.3);color:#7daab5;font-size:9px;background:rgba(4,28,40,.8);cursor:pointer}.coordinate-bottom button.active{color:#d9fbff;border-color:#41cae8;background:rgba(32,139,166,.35)}
input,select{min-width:0;width:100%;height:28px;padding:0 8px;border:1px solid rgba(71,155,179,.28);border-radius:0;color:#d4f3f8;outline:none;background:#061d2b;box-sizing:border-box}input:focus,select:focus{border-color:#3ac7e5}i{font-style:normal}.coordinate-bottom i,.form-grid i{width:27px;color:#5f8a96;font-size:9px;text-align:right}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.form-grid output{height:28px;display:flex;align-items:center;padding:0 8px;color:#66d6eb;font:11px Consolas,monospace;border:1px solid rgba(71,155,179,.18);background:#061824}.output-tags{display:flex;flex-wrap:wrap;gap:6px}.output-tags span{padding:6px 8px;border:1px solid rgba(65,186,213,.25);color:#83c7d5;font-size:9px;background:rgba(9,65,82,.25)}.error-message{margin:12px 0 0;padding:8px 9px;border-left:2px solid #ff6f6f;color:#efaaaa;font-size:10px;line-height:1.6;background:rgba(105,28,32,.2)}
.waveform-preview{margin-top:10px;padding:8px;border:1px solid rgba(65,186,213,.2);background:#041925}.waveform-preview>div:first-child{display:flex;justify-content:space-between;align-items:center}.waveform-preview b{font-size:9px}.waveform-preview span,.waveform-preview em{color:#7198a3;font:8px Consolas,monospace;font-style:normal}.waveform-preview svg{display:block;width:100%;height:58px;margin-top:4px;background:rgba(2,12,20,.65)}.waveform-preview svg line{stroke:rgba(91,156,174,.3);stroke-dasharray:3 3}.waveform-preview svg path{fill:none;stroke:#ffc761;stroke-width:1.1;vector-effect:non-scaling-stroke}.frame-preview{position:relative;height:15px;margin-top:4px;display:flex;align-items:center;justify-content:space-between;padding:0 5px;overflow:hidden;background:rgba(50,91,105,.22)}.frame-preview i{position:absolute;inset:0 auto 0 0;background:rgba(52,199,230,.24);border-right:1px solid #39cce9}.frame-preview span,.frame-preview em{position:relative;z-index:1;color:#9dc5ce}
.parameter-panel footer{display:flex;align-items:center;justify-content:flex-end;gap:9px;padding:0 16px;border-top:1px solid rgba(67,166,193,.22)}.reset-button,.calculate-button,.history-button{height:34px;padding:0 18px;border:1px solid rgba(76,163,187,.35);cursor:pointer}.reset-button{color:#789ca5;background:transparent}.history-button{margin-right:auto;color:#79e8fa;border-color:rgba(57,207,234,.45);background:rgba(13,82,103,.45)}.calculate-button{min-width:130px;color:#e6fbff;border-color:#3bd0ef;background:linear-gradient(180deg,#1687a5,#0b5871);box-shadow:0 0 18px rgba(52,201,232,.18)}.calculate-button:disabled{opacity:.45;cursor:not-allowed}.map-help{position:absolute;bottom:24px;left:38px;display:flex;flex-direction:column;gap:4px;padding:10px 13px;border-left:2px solid #43cde9;background:rgba(1,17,28,.76)}.map-help b{font-size:11px}.map-help span{color:#7198a4;font-size:9px}
.integration-note{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;padding:8px 10px;border-left:2px solid #3bc9e8;background:rgba(16,91,113,.24)}.integration-note.noise{border-left-color:#b388ff;background:rgba(82,52,127,.2)}.integration-note b{font-size:10px;color:#bff7ff}.integration-note span{font-size:9px;line-height:1.45;color:#7fa9b4}
.loading-mask{position:absolute;z-index:20;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(1,11,20,.75);backdrop-filter:blur(3px)}.loading-mask i{width:44px;height:44px;border:2px solid rgba(71,201,229,.22);border-top-color:#48d4ef;border-radius:50%;animation:spin .8s linear infinite}.loading-mask b{margin-top:16px;font-size:15px;letter-spacing:2px}.loading-mask span{margin-top:7px;color:#739aa6;font-size:10px}@keyframes spin{to{transform:rotate(360deg)}}
.result-toolbar{height:68px;display:grid;grid-template-columns:260px 1fr auto;align-items:center;gap:16px;padding:0 18px;border-bottom:1px solid rgba(69,174,205,.26);background:rgba(2,17,29,.94)}.result-toolbar>div{display:flex;flex-direction:column}.result-toolbar>div span{color:#4ec8e7;font:9px Consolas,monospace;letter-spacing:2px}.result-toolbar>div strong{margin-top:4px;font-size:18px;letter-spacing:2px}.result-toolbar dl{display:flex;justify-content:center;gap:35px;margin:0}.result-toolbar dl div{display:flex;flex-direction:column}.result-toolbar dt{color:#678d99;font-size:9px}.result-toolbar dd{margin:4px 0 0;color:#c4e9ee;font:10px Consolas,monospace}.result-toolbar .task-ids dd{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.result-toolbar dd.ok{color:#5ce7a6}.result-toolbar button{height:32px;padding:0 13px;border:1px solid rgba(62,190,219,.38);color:#76d9ed;font-size:10px;background:rgba(10,73,93,.35);cursor:pointer}
.result-grid{position:absolute;inset:80px 14px 14px;display:grid;grid-template-columns:minmax(560px,1.4fr) minmax(300px,.6fr);grid-template-rows:minmax(340px,calc(100vh - 450px)) 280px 520px;gap:10px;overflow-y:auto;padding-right:4px;scrollbar-color:#245f73 #061a28;scrollbar-width:thin}.result-panel{min-height:0;border:1px solid rgba(69,174,205,.26);background:rgba(3,24,39,.94);box-shadow:0 10px 30px rgba(0,5,12,.22)}.result-panel>header{height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid rgba(67,161,187,.18);background:linear-gradient(90deg,rgba(16,69,88,.28),transparent)}.result-panel>header>div{display:flex;align-items:center;gap:9px}.result-panel>header span{color:#3fc3e7;font:10px Consolas,monospace}.result-panel>header b{font-size:14px;font-weight:500;letter-spacing:1.5px}.result-panel>header em{color:#688f9b;font-size:9px;font-style:normal}.field-actions button{height:25px;padding:0 8px;border:1px solid rgba(70,164,188,.28);color:#6f96a1;font-size:9px;background:#061c2a;cursor:pointer}.field-actions button.active{color:#72e4f5;border-color:#3bc4e4;background:rgba(27,124,150,.3)}.ray-panel{display:grid;grid-template-rows:44px minmax(0,1fr)}.ray-stage{position:relative;min-height:0;padding:12px 18px 24px 42px}.ray-stage svg,.tl-canvas{display:block;width:100%;height:100%;border:1px solid rgba(65,157,181,.16);box-sizing:border-box}.grid-lines line{stroke:rgba(71,154,178,.12);stroke-width:1}.ray-path{fill:none;stroke:rgba(255,45,85,.82);stroke-width:1.3;vector-effect:non-scaling-stroke}.terrain-mask{fill:rgba(100,116,139,.5);stroke:none}.terrain-line{fill:none;stroke:rgba(241,245,249,.95);stroke-width:1.6;vector-effect:non-scaling-stroke}.source-marker{stroke:#ffd166;fill:#ffd166}.source-marker path,.receiver-marker path{fill:none;stroke-width:1;vector-effect:non-scaling-stroke}.receiver-marker{stroke:#49ddff;fill:#49ddff}.depth-axis{position:absolute;top:12px;bottom:24px;left:7px;display:flex;flex-direction:column;justify-content:space-between;color:#638b98;font:9px Consolas,monospace}.range-axis{position:absolute;right:18px;bottom:7px;left:42px;display:flex;justify-content:space-between;color:#638b98;font:9px Consolas,monospace}.ray-legend,.tl-legend{position:absolute;top:24px;right:30px;display:flex;align-items:center;gap:10px;padding:6px 8px;color:#7199a4;font-size:9px;background:rgba(1,15,25,.76)}.ray-legend i{display:inline-block;width:7px;height:7px;margin-right:4px;border-radius:50%}.ray-legend .amber{background:#ffd166}.ray-legend .cyan{background:#49ddff}.ray-legend .line{width:13px;height:1px;border-radius:0;background:#ff2d55;vertical-align:middle}.tl-legend>i{width:120px;height:7px}.tl-legend b{padding-left:8px;border-left:1px solid rgba(113,153,164,.3);color:#94a3b8;font-weight:400}
.field-plot{position:relative;width:100%;height:100%;min-height:0}.receiver-drag-handle{position:absolute;z-index:6;width:30px;height:30px;padding:0;border:0;border-radius:50%;color:#49ddff;background:transparent;transform:translate(-50%,-50%);cursor:grab;touch-action:none;filter:drop-shadow(0 0 4px rgba(0,8,14,.9))}.receiver-drag-handle:active,.receiver-drag-handle.dragging{cursor:grabbing}.receiver-drag-handle:disabled{cursor:wait}.receiver-drag-handle::before{content:"";position:absolute;inset:8px;border:2px solid currentColor;border-radius:50%;background:rgba(73,221,255,.82)}.receiver-drag-handle::after{content:"";position:absolute;top:14px;left:1px;width:28px;height:1px;background:currentColor}.receiver-drag-handle>i{position:absolute;top:1px;left:14px;width:1px;height:28px;background:currentColor}.receiver-drag-handle>span{position:absolute;left:31px;top:8px;padding:2px 4px;color:#8cecff;font:9px Consolas,monospace;white-space:nowrap;background:rgba(1,15,25,.74);pointer-events:none}.receiver-drag-handle.label-left>span{right:31px;left:auto}.receiver-drag-handle.busy{animation:receiverPulse .75s ease-in-out infinite alternate}@keyframes receiverPulse{to{filter:drop-shadow(0 0 8px rgba(73,221,255,.95));opacity:.65}}.result-error{position:absolute;z-index:8;right:30px;bottom:34px;max-width:min(520px,70%);padding:7px 10px;border-left:2px solid #ff7474;color:#ffc0c0;font-size:9px;line-height:1.5;background:rgba(73,15,24,.88)}
.tl-panel{display:grid;grid-template-rows:44px 82px minmax(0,1fr)}.tl-summary{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid rgba(67,161,187,.14)}.tl-summary div{display:flex;flex-direction:column;justify-content:center;padding-left:13px;border-right:1px solid rgba(67,161,187,.12)}.tl-summary span{color:#6d939e;font-size:9px}.tl-summary b{margin-top:5px;color:#daf5f8;font:17px Consolas,monospace}.element-list{min-height:0;overflow-y:auto;padding:6px 10px}.element-list button{width:100%;display:grid;grid-template-columns:42px 1fr 58px;align-items:center;gap:8px;padding:6px;border:0;border-bottom:1px solid rgba(63,143,165,.1);color:#749aa5;background:transparent;cursor:pointer}.element-list button:hover,.element-list button.active{color:#c9eef3;background:rgba(28,114,138,.22)}.element-list button span,.element-list button b{font:9px Consolas,monospace}.element-list button b{text-align:right}.element-list button>i{height:3px;background:rgba(65,133,151,.2)}.element-list button>i em{display:block;height:100%;background:linear-gradient(90deg,#2b86bb,#53e0cf,#ffd166)}
.cir-panel{grid-column:1/-1;display:grid;grid-template-rows:44px minmax(0,1fr)}.cir-panel header label{display:flex;align-items:center;gap:7px;color:#6c939e;font-size:9px}.cir-panel header select{width:80px;height:25px}.cir-content{position:relative;display:grid;grid-template-columns:1fr 260px;min-height:0}.cir-content>svg{width:100%;height:100%;padding:8px 8px 22px 24px;box-sizing:border-box}.axis-line{stroke:rgba(83,160,180,.3);stroke-width:1;vector-effect:non-scaling-stroke}.cir-db-grid line{stroke:rgba(83,160,180,.18);stroke-width:1;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}.tap-db{stroke:#50dce9;stroke-width:2;vector-effect:non-scaling-stroke}.tap-db-fill{fill:#ffbd5f;stroke:#ffe0a1;stroke-width:1;vector-effect:non-scaling-stroke}.cir-db-axis{position:absolute;top:13px;bottom:76px;left:2px;display:flex;flex-direction:column;justify-content:space-between;color:#658b97;font:8px Consolas,monospace;text-align:right}.cir-axis{position:absolute;right:284px;bottom:8px;left:42px;display:flex;justify-content:space-between;color:#658b97;font:9px Consolas,monospace}.cir-legend{position:absolute;top:8px;right:286px;display:flex;align-items:center;gap:10px;color:#7199a4;font-size:9px}.cir-legend i{display:inline-block;width:13px;height:2px;margin-right:4px;vertical-align:middle}.cir-legend .amplitude{background:#50dce9}.cir-legend b{color:#5f8490;font-weight:400}.cir-content dl{margin:16px 14px;padding:6px 12px;border-left:1px solid rgba(67,161,187,.18);background:rgba(4,31,45,.42)}.cir-content dl div{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(61,137,158,.11)}.cir-content dt{color:#668c98;font-size:9px}.cir-content dd{margin:0;color:#bae2e9;font:9px Consolas,monospace}
.static-domains{grid-column:1/-1;min-height:520px;height:520px}.static-domains :deep(.domain-grid){grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}.static-domains :deep(.domain-panel:nth-child(4)),.static-domains :deep(.domain-panel:nth-child(5)){grid-column:span 1}
@media(max-height:760px){.result-grid{grid-template-rows:minmax(300px,calc(100vh - 390px)) 230px 480px}.static-domains{height:480px;min-height:480px}.result-toolbar{height:60px}.result-grid{inset:70px 12px 12px}.page-heading{top:25px}}

/* 单屏静态信道仪表盘：所有结果固定在四行网格中，不产生页面滚动。 */
.result-grid{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));overflow:hidden;padding-right:0}
.ray-panel{grid-column:1/3;grid-row:1/3}.tl-panel{grid-column:3;grid-row:1/3}.cir-panel{grid-column:4;grid-row:1/3}.tx-panel{grid-column:1;grid-row:3;display:grid;grid-template-rows:44px minmax(0,1fr)}
.static-domains{display:contents;height:auto;min-height:0}.static-domains :deep(.domain-shell.embedded-grid),.static-domains :deep(.domain-shell.embedded-grid .domain-grid){display:contents}
.static-domains :deep(.domain-time){grid-column:2;grid-row:3}.static-domains :deep(.domain-frequency){grid-column:3;grid-row:3}.static-domains :deep(.domain-time-frequency){grid-column:4;grid-row:3}.static-domains :deep(.domain-panel.domain-spatial){grid-column:1/3;grid-row:4}.static-domains :deep(.domain-panel.domain-beam){grid-column:3/5;grid-row:4}
.cir-panel .cir-content{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}.cir-panel .cir-content>svg{padding:5px 7px 18px 18px}.cir-panel .cir-db-axis{top:10px;bottom:76px;left:1px}.cir-panel .cir-axis{right:12px;bottom:70px;left:28px}.cir-panel .cir-legend{top:5px;right:8px;gap:5px}.cir-panel .cir-legend b{display:none}.cir-panel .cir-content dl{display:grid;grid-template-columns:1fr 1fr;margin:0 7px 5px;padding:2px 7px}.cir-panel .cir-content dl div{padding:4px 0}.cir-panel header label{gap:3px}.cir-panel header select{width:62px}
.tx-content{display:grid;grid-template-rows:46px minmax(0,1fr);min-height:0}.absolute-timeline{padding:5px 9px 0;border-bottom:1px solid rgba(67,161,187,.14)}.timeline-track{position:relative;height:15px}.timeline-line{position:absolute;top:7px;left:3%;right:3%;height:1px;background:rgba(93,165,183,.48)}.timeline-transmit,.timeline-first,.timeline-tap{position:absolute;top:3px;width:2px;height:9px;background:#ffd166}.timeline-transmit{left:3%}.timeline-first{background:#4fe0f1}.timeline-tap{top:5px;width:1px;height:6px;background:#b18cff}.timeline-break{position:absolute;top:-2px;left:46%;padding:0 3px;color:#ff9f68;background:#031827;font:bold 12px Consolas,monospace;transform:skew(-12deg)}.timeline-playhead{position:absolute;top:0;width:1px;height:15px;background:#fff;box-shadow:0 0 5px #6be9ff;transition:left .1s linear}.timeline-labels{display:grid;grid-template-columns:auto 1fr auto auto;gap:6px;color:#6b929d;font:7px Consolas,monospace}.timeline-labels b{text-align:center;color:#ff9f68;font-weight:400}.timeline-labels span:nth-last-child(-n+2){color:#83cbd6}.tx-chart{position:relative;min-height:0}.tx-chart svg{display:block;width:100%;height:100%;padding:1px 5px 15px 14px;box-sizing:border-box}.tx-axis{stroke:rgba(132,195,210,.4);stroke-width:1;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}.tx-wave{fill:none;stroke:#ffbd5d;stroke-width:1.35;vector-effect:non-scaling-stroke}.tx-chart>div{position:absolute;right:8px;bottom:2px;left:22px;display:flex;justify-content:space-between;color:#658b97;font:7px Consolas,monospace}.tx-chart>div b{color:#9b8790;font-weight:400}.tx-chart>button{position:absolute;top:2px;right:5px;height:18px;padding:0 6px;border:1px solid rgba(70,164,188,.28);color:#7fd9e8;background:rgba(4,35,50,.82);font-size:8px;cursor:pointer}
.cir-panel header label small{color:#51d9ed;font:8px Consolas,monospace}.cir-content svg g{transition:opacity .12s ease,filter .12s ease}.cir-content svg g.pending{opacity:.2}.cir-content svg g.active{opacity:1;filter:drop-shadow(0 0 3px rgba(91,226,246,.65))}.timeline-tap{transition:height .12s ease,top .12s ease,background .12s ease}.timeline-tap:not(.active){background:#614b78}.timeline-tap.active{top:2px;height:11px;background:#c596ff;box-shadow:0 0 4px rgba(197,150,255,.75)}
.tx-actions{position:absolute;top:2px;right:5px;display:flex;gap:3px}.tx-actions button{height:18px;padding:0 6px;border:1px solid rgba(70,164,188,.28);color:#7fd9e8;background:rgba(4,35,50,.9);font-size:8px;cursor:pointer}.tx-actions button:first-child{color:#ffd18a;border-color:rgba(226,166,77,.38)}
.transmission-switch{margin-left:auto;gap:0!important;white-space:nowrap}.transmission-switch button{height:21px;padding:0 5px;border:1px solid rgba(70,164,188,.25);color:#688f9b;background:#061c2a;font-size:7px;cursor:pointer}.transmission-switch button+button{margin-left:-1px}.transmission-switch button.active{position:relative;color:#d9fbff;border-color:#3bc4e4;background:rgba(27,124,150,.42)}.transmission-switch button:disabled{cursor:wait;opacity:.5}.tx-panel>header>em{max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cir-content svg g.pending{opacity:.14;filter:none}.cir-content svg g.passed{opacity:.42;filter:none}.cir-content svg g.current{opacity:1;filter:drop-shadow(0 0 5px rgba(255,210,103,.9))}.timeline-tap.pending{top:5px;height:6px;background:#3e354b;box-shadow:none}.timeline-tap.passed{top:4px;height:8px;background:#796095;box-shadow:none}.timeline-tap.current{top:1px;height:13px;background:#ffd166;box-shadow:0 0 6px rgba(255,209,102,.95)}
.cir-panel header>div{min-width:0;flex:1}.cir-panel header>div b{overflow:hidden;font-size:11px;letter-spacing:.4px;text-overflow:ellipsis;white-space:nowrap}.cir-panel header label{flex:none;white-space:nowrap}.cir-panel header label small{max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cir-panel .cir-content>svg{padding-left:30px}.cir-panel .cir-db-axis{top:10px;bottom:76px;left:4px;width:25px;align-items:flex-end;text-shadow:0 1px 2px #020b15}.tap-db{stroke:url(#cir-tap-gradient);stroke-width:2.4}.tap-db-fill{filter:drop-shadow(0 0 2px rgba(255,209,102,.7))}.cir-break-band{fill:rgba(39,107,128,.09);stroke:rgba(73,190,217,.2);stroke-width:1;stroke-dasharray:3 5;vector-effect:non-scaling-stroke}.cir-break-symbol line{stroke:#ffb660;stroke-width:2;vector-effect:non-scaling-stroke}.cir-axis.broken{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:5px}.cir-axis.broken span:last-child{text-align:right}.cir-axis.broken b{color:#ffb660;font-weight:400;white-space:nowrap}.cir-legend{padding:2px 4px;border:1px solid rgba(57,155,181,.14);background:rgba(2,20,32,.72)}

/* 参数面板与二维/三维声场保持同一套标题栏、分组和表单行样式 */
.parameter-panel{grid-template-rows:38px minmax(0,1fr) 58px;background:linear-gradient(180deg,rgba(22,61,83,.96),rgba(10,40,60,.95))}
.window-titlebar{display:flex;align-items:center;gap:4px;padding:0 12px;border-bottom:2px solid rgba(81,183,220,.55);background:linear-gradient(90deg,rgba(24,91,121,.72),rgba(12,44,65,.35))}
.window-titlebar span{font-size:15px;font-weight:700;letter-spacing:.5px}
.window-titlebar i{color:#e7b24c;font-size:12px;letter-spacing:-5px;font-style:normal}
.panel-scroll{padding:10px 14px 6px}
.section-caption{position:relative;display:flex;align-items:center;justify-content:center;height:28px;margin:2px 0 4px;color:#25c9f7;font-size:12px;font-weight:700}
.section-caption::before,.section-caption::after{content:'';height:1px;flex:1;background:rgba(65,153,188,.35)}
.section-caption span{padding:0 10px}
.form-row{display:grid;grid-template-columns:92px minmax(0,1fr);align-items:center;min-height:34px;gap:8px;margin-bottom:4px}
.form-row>label{font-size:12px;color:#b5cfdb}
.form-row input,.form-row select{height:28px;border:1px solid rgba(95,158,184,.28);border-radius:3px;background:rgba(104,144,165,.25);font-size:12px;color:#dceff6;font-variant-numeric:tabular-nums}
.form-row input:focus,.form-row select:focus{border-color:#2fc4f1;box-shadow:0 0 0 2px rgba(47,196,241,.12)}
.readonly-value{display:flex;align-items:center;min-width:0;height:28px;padding:0 10px;color:#7dd9f3;font-size:11px;font-variant-numeric:tabular-nums;border:1px solid rgba(95,158,184,.2);border-radius:3px;background:rgba(30,92,119,.26);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.link-hint{margin:2px 0 8px;color:#78a8bc;font-size:10px;line-height:1.5}
.waveform-preview{margin-top:6px}
.parameter-panel footer{padding:0 14px}
.link-warning{color:#ffca75}

/* 参数面板移到左侧，与二维声场保持一致的阅读顺序 */
.static-channel-view .parameter-panel{left:18px;right:auto}
.static-channel-view.module-open .parameter-panel{left:216px}
.static-channel-view .parameter-panel{bottom:auto;height:min(740px,calc(100% - 36px))}
.parameter-panel.dragging{z-index:30;box-shadow:0 22px 58px rgba(0,0,0,.62)}
.window-titlebar{cursor:grab;touch-action:none;user-select:none}
.parameter-panel.dragging .window-titlebar{cursor:grabbing}
.static-channel-view .page-heading{left:auto;right:38px;max-width:min(620px,calc(100% - 460px));text-align:right}
.static-channel-view .map-help{left:auto;right:38px}

/* 结果页不再展示 Bellhop 传播损失/声线，重新排布为 3 + 5 个结果面板 */
.result-toolbar{grid-template-columns:1fr auto}
.result-window{position:absolute;z-index:10;top:14px;left:14px;bottom:14px;width:min(1220px,calc(100% - 28px));display:flex;flex-direction:column;overflow:hidden;color:#d9edf5;border:1px solid rgba(66,154,189,.52);border-radius:3px;background:linear-gradient(180deg,rgba(22,61,83,.96),rgba(10,40,60,.95));box-shadow:0 15px 40px rgba(0,8,20,.42)}
.static-channel-view.module-open .result-window{left:214px;width:min(1220px,calc(100% - 228px))}
.static-channel-view .result-window .result-toolbar{height:44px;margin-left:0;padding:0 14px;grid-template-columns:1fr auto;border-bottom:2px solid rgba(81,183,220,.55);background:linear-gradient(90deg,rgba(24,91,121,.72),rgba(12,44,65,.35))}
.static-channel-view .result-window .result-toolbar>div{justify-content:center}
.static-channel-view .result-window .result-toolbar>div strong{margin-top:0}
.static-channel-view .result-window .result-grid{position:relative;top:auto;right:auto;bottom:auto;left:auto;flex:1;width:auto;min-height:0;padding:8px;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(4,minmax(0,1fr));grid-auto-rows:auto;justify-content:stretch;align-content:stretch;gap:8px;overflow:hidden}
.static-channel-view.module-open .result-window .result-grid{left:auto}
.result-panel,.static-domains :deep(.domain-panel){height:auto;min-height:0}
.static-channel-view.module-open .result-toolbar{margin-left:200px}
.static-channel-view.module-open .result-window .result-toolbar{margin-left:0}
.static-channel-view.module-open .result-grid{left:214px}
.result-panel{height:auto;min-height:0;border-color:rgba(67,151,184,.28);border-radius:4px;background:rgba(9,38,57,.55);box-shadow:none;overflow:hidden}
.tl-panel,.cir-panel,.tx-panel{grid-column:auto;grid-row:auto}
.tl-panel{grid-template-rows:32px 52px minmax(0,1fr)}
.cir-panel{grid-template-rows:32px minmax(0,1fr)}
.tx-panel{display:grid;grid-template-rows:32px minmax(0,1fr)}
.result-panel>header{height:32px;box-sizing:border-box;padding:0 10px;background:rgba(9,38,57,.72)}
.static-domains :deep(.domain-time),
.static-domains :deep(.domain-frequency),
.static-domains :deep(.domain-time-frequency),
.static-domains :deep(.domain-panel.domain-spatial),
.static-domains :deep(.domain-panel.domain-beam){grid-column:auto;grid-row:auto}
.static-domains :deep(.domain-panel){height:auto;min-height:0;grid-template-rows:32px minmax(0,1fr);border-color:rgba(67,151,184,.28);border-radius:4px;background:rgba(9,38,57,.55);overflow:hidden}
.static-domains :deep(.domain-panel header){height:32px;box-sizing:border-box;padding:0 10px;background:rgba(9,38,57,.72)}
.result-toolbar>div strong{font-size:15px;font-weight:700;letter-spacing:.5px}
.result-panel>header b,.static-domains :deep(.domain-panel header b){font-size:12px;font-weight:600;letter-spacing:.5px}
.result-panel>header em,.static-domains :deep(.domain-panel header em){font-size:10px}
</style>
