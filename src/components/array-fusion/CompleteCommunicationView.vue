<template>
  <section class="communication-view" :class="{ 'module-open': sidebarOpen }">
    <div class="ambient-grid"></div>
    <header class="page-header">
      <div>
        <h1>完整通信 · BER 归因分析</h1>
        <p>复用阵列融合静态 CIR，在同一信道、同一信息比特 Eb/N0 下分离调制、OFDM 与 Turbo 编码贡献。</p>
      </div>
      <div class="channel-badge" :class="{ ready: channelAvailable }">
        <i></i><b>{{ channelAvailable ? '静态信道已联动' : '等待静态信道' }}</b>
        <small>{{ channelAvailable ? `Bellhop ${latestStaticChannel.bellhop_job_id}` : '请先完成静态信道计算' }}</small>
      </div>
    </header>

    <div v-if="!channelAvailable" class="empty-state">
      <div class="empty-icon"><span></span><span></span><span></span></div>
      <h2>尚未取得阵列融合静态信道</h2>
      <p>先进入“静态信道”，完成 Bellhop 声场和阵元复数 CIR 计算，再返回本页。最近一次结果会在模块间自动联动。</p>
    </div>

    <template v-else>
      <div class="workflow">
        <article v-for="(stage, index) in stages" :key="stage.title">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <b>{{ stage.title }}</b>
          <small>{{ stage.detail }}</small>
        </article>
      </div>

      <main class="workspace">
        <aside ref="controlPanelRef" class="control-panel" :class="{ dragging: controlPanelDragging }" :style="controlPanelDragStyle">
          <div class="panel-title" title="拖动参数窗口；双击恢复默认位置" @pointerdown="startControlPanelDrag" @dblclick="resetControlPanelPosition"><b>仿真控制</b></div>
          <div class="control-scroll">
            <label>观察阵元
              <select v-model.number="form.selectedElement">
                <option v-for="element in latestStaticChannel.elements" :key="element.element_index" :value="element.element_index">
                  #{{ element.element_index + 1 }} · TL {{ Number(element.transmission_loss_db).toFixed(2) }} dB
                </option>
              </select>
            </label>

            <fieldset>
              <legend>重点方案</legend>
              <div class="segmented">
                <button type="button" :class="{ active: form.modulation === 'BPSK' }" @click="form.modulation = 'BPSK'">BPSK</button>
                <button type="button" :class="{ active: form.modulation === 'QPSK' }" @click="form.modulation = 'QPSK'">QPSK</button>
              </div>
              <div class="segmented">
                <button type="button" :class="{ active: form.waveform === 'single_carrier' }" @click="form.waveform = 'single_carrier'">单载波</button>
                <button type="button" :class="{ active: form.waveform === 'ofdm' }" @click="form.waveform = 'ofdm'">OFDM</button>
              </div>
              <div class="segmented">
                <button type="button" :class="{ active: form.coding === 'none' }" @click="form.coding = 'none'">不编码</button>
                <button type="button" :class="{ active: form.coding === 'turbo' }" @click="form.coding = 'turbo'">Turbo</button>
              </div>
            </fieldset>

            <fieldset>
              <legend>链路与统计</legend>
              <div class="two-columns">
              <label>通信采样率 / Hz<input v-model.number="form.sampleRateHz" type="number" min="10" :max="sourceSampleRate" step="100"></label>
              <label>信息比特 / 帧<input v-model.number="form.bitsPerFrame" type="number" min="64" max="4096" step="64"></label>
              <label>Turbo 迭代<input v-model.number="form.turboIterations" type="number" min="1" max="12" step="1"></label>
              <label>每点帧数<input v-model.number="form.framesPerPoint" type="number" min="1" max="40" step="1"></label>
              <label class="wide-field">最大距离 BER 阈值<input v-model.number="form.berThreshold" type="number" min="0.00000001" max="0.49" step="0.0001"></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>OFDM 子载波配置</legend>
              <div class="two-columns">
                <label>FFT 总点数<select v-model.number="form.fftSize"><option v-for="size in fftSizes" :key="size" :value="size">{{ size }}</option></select></label>
                <label>循环前缀 / 点<input v-model.number="form.cpSamples" type="number" min="0" :max="form.fftSize - 1" step="1"></label>
                <label>数据子载波<input v-model.number="form.dataSubcarriers" type="number" min="1" :max="maxDataSubcarriers" step="1"></label>
                <label>导频子载波<input v-model.number="form.pilotSubcarriers" type="number" min="0" :max="form.fftSize - 1" step="1"></label>
                <label>子载波间隔<output>{{ subcarrierSpacingHz.toFixed(2) }} Hz</output></label>
                <label>OFDM 符号时长<output>{{ ofdmSymbolDurationMs.toFixed(2) }} ms</output></label>
                <label class="wide-field">保护 / 空载波<output>{{ guardSubcarriers }} 个（含未占用频点）</output></label>
              </div>
              <div class="carrier-preview"><i class="guard"></i><i class="data" :style="{ flexGrow: form.dataSubcarriers }"></i><i class="pilot" :style="{ flexGrow: Math.max(1, form.pilotSubcarriers) }"></i><span>保护 {{ guardSubcarriers }} · 数据 {{ form.dataSubcarriers }} · 导频 {{ form.pilotSubcarriers }}</span></div>
            </fieldset>

            <fieldset>
              <legend>帧结构</legend>
              <div class="three-columns">
                <label>前导 / 符号<input v-model.number="form.preambleSymbols" type="number" min="0" max="64" step="1"></label>
                <label>帧头 / bit<input v-model.number="form.headerBits" type="number" min="0" max="2048" step="8"></label>
                <label>帧间保护 / 点<input v-model.number="form.guardSamples" type="number" min="0" max="8192" step="8"></label>
              </div>
              <div class="frame-layout"><i class="preamble"></i><i class="header"></i><i class="payload"></i><i class="gap"></i><span>前导</span><span>帧头</span><span>有效载荷</span><span>保护</span></div>
            </fieldset>

            <fieldset>
              <legend>Eb/N0 扫描 / dB</legend>
              <div class="three-columns">
                <label>起点<input v-model.number="form.ebn0Start" type="number" min="-20" max="40" step="1"></label>
                <label>终点<input v-model.number="form.ebn0End" type="number" min="-20" max="40" step="1"></label>
                <label>步长<input v-model.number="form.ebn0Step" type="number" min="0.5" max="10" step="0.5"></label>
              </div>
            </fieldset>

            <button class="run-button" type="button" :disabled="loading || !communicationParametersValid" @click="runCommunicationStudy">
              <span v-if="loading" class="spinner"></span>{{ loading ? '正在执行 Log-MAP 仿真…' : '运行完整链路 BER 研究' }}
            </button>
            <p v-if="!communicationParametersValid" class="error-message">数据与导频子载波总数不能超过 FFT 点数，且 CP、采样率和帧结构参数必须有效。</p>
            <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
          </div>
        </aside>

        <section class="results-panel">
          <div class="channel-strip">
            <div><span>静态信道</span><b>{{ latestStaticChannel.motion.time_invariant ? '时不变' : '时变' }}</b></div>
            <div><span>复数路径</span><b>{{ selectedElement?.path_count ?? 0 }}</b></div>
            <div><span>所选阵元 TL</span><b>{{ Number(selectedElement?.transmission_loss_db ?? 0).toFixed(2) }} dB</b></div>
            <div><span>最大超额时延</span><b>{{ maxExcessDelayMs.toFixed(2) }} ms</b></div>
            <div v-if="result"><span>CP 覆盖</span><b :class="result.channel.ofdm_cp_covers_channel ? 'good' : 'warn'">{{ result.channel.ofdm_cp_covers_channel ? '完整' : '不足' }}</b></div>
          </div>

          <div v-if="!result" class="result-placeholder">
            <div class="signal-rings"><i></i><i></i><i></i><b>BER</b></div>
            <h2>受控对照尚未运行</h2>
            <p>一次运行会自动生成统一基准，并分别只改变调制、波形和编码，避免把多种增益混在同一条曲线里。</p>
          </div>

          <template v-else>
            <div class="result-toolbar">
              <div><b>{{ selectedScenario?.label }}</b></div>
              <label>归因观察点<select v-model.number="analysisEbn0"><option v-for="value in ebn0Values" :key="value" :value="value">{{ value }} dB</option></select></label>
            </div>

            <div v-if="channelChanged" class="stale-notice">
              接收位置或观察阵元已改变；下方保留的是上一次通信结果。点击“运行完整链路 BER 研究”可基于新静态信道重新计算。
            </div>

            <div class="metric-grid">
              <article><span>当前信道 BER</span><b>{{ formatBer(result.link_metrics?.current_ber) }}</b><small>95% 上界 {{ formatBer(result.link_metrics?.current_ber_95pct_upper_bound) }} · Eb/N0 {{ formatDb(result.link_metrics?.current_ebn0_db) }}</small></article>
              <article><span>净通信速率</span><b>{{ formatRate(result.link_metrics?.net_information_rate_bps) }}</b><small>有效吞吐 {{ formatRate(result.link_metrics?.effective_goodput_bps) }}</small></article>
              <article><span>中断概率</span><b>{{ formatPercent(result.link_metrics?.outage_probability) }}</b><small>95% 上界 {{ formatPercent(result.link_metrics?.outage_probability_95pct_upper_bound) }}</small></article>
              <article><span>最大通信距离</span><b>{{ formatDistance(result.link_metrics) }}</b><small>BER ≤ {{ formatBer(result.link_metrics?.ber_threshold) }}</small></article>
            </div>

            <div class="result-analysis-grid">
              <article class="chart-card">
                <div class="card-heading"><div><b>BER 性能曲线</b><small>0 个观测误码不等于 BER=0，按 95% 上界 3/N 绘制</small></div><div class="legend"><span v-for="item in chartLegend" :key="item.key"><i :style="{ background: item.color }"></i>{{ item.label }}</span></div></div>
                <div ref="berChart" class="ber-chart"></div>
              </article>
              <div class="result-side">
                <div class="attribution-grid">
                  <article v-for="comparison in attributionAtPoint" :key="comparison.effect" :class="effectClass(comparison.ratio)">
                    <span>{{ effectName(comparison.effect) }}</span>
                    <b>{{ ratioText(comparison.ratio) }}</b>
                    <small>{{ comparison.description }}</small>
                    <div><i :style="{ width: `${ratioBar(comparison.ratio)}%` }"></i></div>
                  </article>
                </div>
                <article class="diagnostic-card">
                  <div class="card-heading"><div><b>BER 偏高原因</b><small>依据当前 CIR、帧结构与接收机自动判断</small></div></div>
                  <ul><li v-for="item in result.ber_diagnostics" :key="item.title" :class="item.severity"><b>{{ item.title }}</b><span>{{ item.detail }}</span></li></ul>
                </article>
                <article class="evidence-table">
                  <div class="card-heading"><div><b>{{ analysisEbn0 }} dB 同点证据</b><small>其余条件相同，单因素变化</small></div></div>
                  <table><thead><tr><th>方案</th><th>调制</th><th>波形</th><th>编码</th><th>BER</th></tr></thead>
                    <tbody><tr v-for="point in tablePoints" :key="point.scenario" :class="{ selected: point.scenario === result.selected_scenario }">
                      <td>{{ point.label }}</td><td>{{ point.modulation }}</td><td>{{ point.waveform === 'ofdm' ? 'OFDM' : '单载波' }}</td><td>{{ point.coding === 'turbo' ? 'Turbo' : '无' }}</td><td :title="`${point.bit_errors}/${point.total_bits} bit`">{{ formatPointBer(point) }}</td>
                    </tr></tbody>
                  </table>
                </article>
              </div>
            </div>
          </template>
        </section>
      </main>
    </template>

  </section>
</template>

<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import echarts from '@/plugins/echarts.js'
import { calculateStaticCommunication } from '@/api/communicationApi.js'
import { latestStaticChannel, latestStaticElementIndex, selectStaticElement } from '@/modules/array-fusion/staticChannelState.js'
import {
  latestCommunicationResult,
  latestCommunicationSourceKey,
  publishCommunicationResult,
  staticCommunicationSourceKey,
} from '@/modules/array-fusion/communicationState.js'
import { useDraggablePanel } from '@/composables/useDraggablePanel.js'

defineProps({
  sidebarOpen: { type: Boolean, default: false },
})

const stages = Object.freeze([
  { title: '信息比特', detail: '固定码块 · 可复现随机种子' },
  { title: '可选编码', detail: '不编码 / Turbo RSC(7,5)' },
  { title: '调制波形', detail: 'BPSK / QPSK · 单载波 / OFDM' },
  { title: '静态信道', detail: 'array_fusion_service 复数 CIR + AWGN' },
  { title: '软译码', detail: 'LLR · 迭代 Log-MAP / BCJR' },
  { title: '性能归因', detail: 'BER · 三组单因素对照' },
])
const fftSizes = Object.freeze([16, 32, 64, 128, 256, 512, 1024])
const colors = ['#53e6ff', '#f7bd58', '#8b9cff', '#fa6f8a', '#75df9b', '#c688ff', '#f58f56']
const form = reactive({
  selectedElement: Number(latestStaticElementIndex.value || 0),
  modulation: 'QPSK', waveform: 'ofdm', coding: 'turbo',
  sampleRateHz: 2000, bitsPerFrame: 512, fftSize: 256, cpSamples: 64,
  dataSubcarriers: 192, pilotSubcarriers: 16,
  preambleSymbols: 2, headerBits: 32, guardSamples: 32,
  turboIterations: 6, framesPerPoint: 8,
  ebn0Start: -2, ebn0End: 8, ebn0Step: 2,
  berThreshold: 0.001,
})
const {
  panelRef: controlPanelRef,
  dragging: controlPanelDragging,
  dragStyle: controlPanelDragStyle,
  startDragging: startControlPanelDrag,
  resetPanelPosition: resetControlPanelPosition,
} = useDraggablePanel()
const loading = ref(false)
const errorMessage = ref('')
const result = shallowRef(latestCommunicationResult.value)
const calculatedSourceKey = ref(latestCommunicationSourceKey.value)
const analysisEbn0 = ref(4)
const berChart = ref(null)
let chart = null
let resizeObserver = null

const channelAvailable = computed(() => latestStaticChannel.value?.type === 'static_channel_resp' && latestStaticChannel.value?.elements?.length)
const sourceSampleRate = computed(() => Number(latestStaticChannel.value?.impulse_response?.sample_rate_hz ?? 8000))
const selectedElement = computed(() => latestStaticChannel.value?.elements?.find((element) => Number(element.element_index) === Number(form.selectedElement)) ?? latestStaticChannel.value?.elements?.[0])
const currentSourceKey = computed(() => staticCommunicationSourceKey(latestStaticChannel.value, form.selectedElement))
const channelChanged = computed(() => Boolean(result.value && calculatedSourceKey.value !== currentSourceKey.value))
const maxExcessDelayMs = computed(() => Math.max(0, ...(selectedElement.value?.impulse_response?.taps ?? []).map((tap) => 1000 * Number(tap.excess_delay_s ?? 0))))
const maxDataSubcarriers = computed(() => Math.max(1, Number(form.fftSize) - Number(form.pilotSubcarriers)))
const guardSubcarriers = computed(() => Math.max(0, Number(form.fftSize) - Number(form.dataSubcarriers) - Number(form.pilotSubcarriers)))
const subcarrierSpacingHz = computed(() => Number(form.sampleRateHz) / Math.max(1, Number(form.fftSize)))
const ofdmSymbolDurationMs = computed(() => 1000 * (Number(form.fftSize) + Number(form.cpSamples)) / Math.max(1, Number(form.sampleRateHz)))
const communicationParametersValid = computed(() => Number(form.dataSubcarriers) >= 1
  && Number(form.pilotSubcarriers) >= 0
  && Number(form.dataSubcarriers) + Number(form.pilotSubcarriers) <= Number(form.fftSize)
  && Number(form.cpSamples) >= 0 && Number(form.cpSamples) < Number(form.fftSize)
  && Number(form.sampleRateHz) >= 10 && Number(form.sampleRateHz) <= sourceSampleRate.value
  && Number(form.preambleSymbols) >= 0 && Number(form.headerBits) >= 0 && Number(form.guardSamples) >= 0)
const ebn0Values = computed(() => [...new Set((result.value?.points ?? []).map((point) => Number(point.ebn0_db)))].sort((a, b) => a - b))
const selectedScenario = computed(() => result.value?.scenarios?.find((scenario) => scenario.key === result.value?.selected_scenario))
const selectedPoint = computed(() => result.value?.points?.find((point) => point.scenario === result.value?.selected_scenario && Number(point.ebn0_db) === Number(analysisEbn0.value)))
const tablePoints = computed(() => (result.value?.points ?? []).filter((point) => Number(point.ebn0_db) === Number(analysisEbn0.value)))
const chartLegend = computed(() => (result.value?.scenarios ?? []).map((scenario, index) => ({ ...scenario, color: colors[index % colors.length] })))
const attributionAtPoint = computed(() => (result.value?.attribution?.comparisons ?? []).map((comparison) => {
  const point = comparison.points.find((item) => Number(item.ebn0_db) === Number(analysisEbn0.value)) ?? comparison.points[0]
  return { ...comparison, ratio: Number(point?.ber_ratio_changed_over_reference ?? 1) }
}))

watch(() => form.selectedElement, (value) => selectStaticElement(value))
watch(latestStaticElementIndex, (value) => { form.selectedElement = Number(value || 0) })
watch([() => form.fftSize, () => form.pilotSubcarriers], () => {
  form.pilotSubcarriers = Math.max(0, Math.min(Number(form.fftSize) - 1, Number(form.pilotSubcarriers)))
  form.dataSubcarriers = Math.max(1, Math.min(maxDataSubcarriers.value, Number(form.dataSubcarriers)))
  form.cpSamples = Math.max(0, Math.min(Number(form.fftSize) - 1, Number(form.cpSamples)))
})
watch(result, async () => { await nextTick(); renderChart() })

function ebn0Sweep() {
  const start = Number(form.ebn0Start); const end = Number(form.ebn0End); const step = Number(form.ebn0Step)
  if (![start, end, step].every(Number.isFinite) || step <= 0 || end <= start) throw new Error('Eb/N0 终点必须大于起点，步长必须为正数')
  const values = []
  for (let value = start; value <= end + step * 1e-6 && values.length < 17; value += step) values.push(Number(value.toFixed(6)))
  if (values.length < 2 || values.length > 16) throw new Error('Eb/N0 扫描点数必须为 2–16 个')
  return values
}

function staticChannelPayload() {
  const channel = latestStaticChannel.value
  return {
    type: channel.type,
    motion: channel.motion,
    bellhop_job_id: channel.bellhop_job_id,
    ray_job_id: channel.ray_job_id,
    frequency_hz: channel.frequency_hz,
    impulse_response: channel.impulse_response,
    array: channel.array,
    signal: { gating: channel.signal?.gating },
    noise: channel.noise,
    sound_field: channel.sound_field,
    element: selectedElement.value,
  }
}

async function runCommunicationStudy() {
  if (!channelAvailable.value || loading.value || !communicationParametersValid.value) return
  loading.value = true; errorMessage.value = ''
  try {
    const data = await calculateStaticCommunication({
      static_channel: staticChannelPayload(),
      communication: {
        selected_element: Number(form.selectedElement), modulation: form.modulation,
        waveform: form.waveform, coding: form.coding,
        sample_rate_hz: Number(form.sampleRateHz), information_bits_per_frame: Number(form.bitsPerFrame),
        frames_per_point: Number(form.framesPerPoint), fft_size: Number(form.fftSize),
        cyclic_prefix_samples: Number(form.cpSamples), turbo_iterations: Number(form.turboIterations),
        data_subcarriers: Number(form.dataSubcarriers), pilot_subcarriers: Number(form.pilotSubcarriers),
        preamble_symbols: Number(form.preambleSymbols), header_bits: Number(form.headerBits),
        guard_samples: Number(form.guardSamples),
        ebn0_db: ebn0Sweep(), random_seed: 20261021, interleaver_seed: 20261021,
        ber_threshold: Number(form.berThreshold),
      },
    })
    result.value = data
    calculatedSourceKey.value = currentSourceKey.value
    publishCommunicationResult(data, calculatedSourceKey.value)
    analysisEbn0.value = data.points.some((point) => Number(point.ebn0_db) === 4) ? 4 : Number(data.points[Math.floor(data.points.length / 2)]?.ebn0_db ?? 0)
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  } finally {
    loading.value = false
  }
}

function renderChart() {
  if (!berChart.value || !result.value) return
  resizeObserver?.observe(berChart.value)
  if (!chart) chart = echarts.init(berChart.value)
  const series = result.value.scenarios.map((scenario, index) => ({
    name: scenario.label, type: 'line', smooth: false, showSymbol: true, symbolSize: 6,
    lineStyle: { width: scenario.key === result.value.selected_scenario ? 3 : 1.5 },
    itemStyle: { color: colors[index % colors.length] },
    data: result.value.points.filter((point) => point.scenario === scenario.key).sort((a, b) => a.ebn0_db - b.ebn0_db).map((point) => [point.ebn0_db, point.ber > 0 ? point.ber : point.zero_error_95pct_upper_bound, point]),
  }))
  chart.setOption({
    animationDuration: 450,
    grid: { left: 66, right: 28, top: 20, bottom: 48 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(2,16,28,.96)', borderColor: '#236b83', textStyle: { color: '#d7f7ff', fontSize: 11 }, formatter(params) {
      const title = `${params[0]?.axisValue ?? ''} dB`
      return [title, ...params.map((item) => { const point = item.data[2]; return `${item.marker}${item.seriesName}<br/>BER ${formatPointBer(point)} · ${point.bit_errors}/${point.total_bits} bit 误码` })].join('<br/>')
    } },
    xAxis: { type: 'value', name: 'Eb/N0 / dB', nameTextStyle: { color: '#7ba9b7' }, axisLabel: { color: '#789aa5' }, axisLine: { lineStyle: { color: '#315564' } }, splitLine: { lineStyle: { color: 'rgba(79,142,160,.13)' } } },
    yAxis: { type: 'log', name: 'BER', min: 1e-5, max: 1, nameTextStyle: { color: '#7ba9b7' }, axisLabel: { color: '#789aa5' }, axisLine: { lineStyle: { color: '#315564' } }, splitLine: { lineStyle: { color: 'rgba(79,142,160,.13)' } } },
    series,
  }, true)
}

function formatBer(value) {
  if (value == null || value === '') return '--'
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  if (number === 0) return '0（本次）'
  return number < .001 ? number.toExponential(2) : number.toFixed(5)
}

function formatPointBer(point) {
  const ber = Number(point?.ber)
  if (!Number.isFinite(ber)) return '--'
  if (ber > 0) return formatBer(ber)
  const upper = Number(point?.zero_error_95pct_upper_bound)
  return Number.isFinite(upper) && upper > 0
    ? `≤ ${formatBer(upper)}（95% 上界）`
    : '本次 0 误码（样本不足）'
}

function formatDb(value) {
  if (value == null || value === '') return '--'
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(2)} dB` : '--'
}

function formatRate(value) {
  if (value == null || value === '') return '--'
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)} Mb/s`
  if (number >= 1e3) return `${(number / 1e3).toFixed(2)} kb/s`
  return `${number.toFixed(1)} b/s`
}

function formatPercent(value) {
  if (value == null || value === '') return '--'
  const number = Number(value)
  return Number.isFinite(number) ? `${(number * 100).toFixed(number < .01 ? 2 : 1)}%` : '--'
}

function formatDistance(metrics) {
  const number = Number(metrics?.maximum_distance_km)
  if (!Number.isFinite(number)) return '未达到门限'
  return `${metrics?.coverage_limited_by_field ? '≥ ' : ''}${number.toFixed(2)} km`
}
function effectName(effect) { return ({ modulation: '调制技术影响', waveform: 'OFDM 波形影响', coding: 'Turbo 编码影响' })[effect] ?? effect }
function ratioText(ratio) {
  if (!Number.isFinite(ratio)) return '--'
  if (ratio < 1) return `BER 降低 ${((1 - ratio) * 100).toFixed(1)}%`
  if (ratio > 1) return `BER 升高 ${((ratio - 1) * 100).toFixed(1)}%`
  return 'BER 基本不变'
}
function ratioBar(ratio) { return Math.max(4, Math.min(100, ratio < 1 ? (1 - ratio) * 100 : (ratio - 1) * 50)) }
function effectClass(ratio) { return { positive: ratio < .95, negative: ratio > 1.05, neutral: ratio >= .95 && ratio <= 1.05 } }

onMounted(() => {
  resizeObserver = new ResizeObserver(() => chart?.resize())
  if (berChart.value) resizeObserver.observe(berChart.value)
})
onActivated(async () => { await nextTick(); renderChart() })
onBeforeUnmount(() => { resizeObserver?.disconnect(); chart?.dispose(); chart = null })
</script>

<style scoped>
.communication-view { position: absolute; inset: 54px 0 0; overflow: hidden; display:grid; grid-template-rows:auto auto minmax(0,1fr); color: #d9f7ff; background: radial-gradient(circle at 50% -10%, rgba(20,111,143,.25), transparent 40%), #020d18; font-family: "Microsoft YaHei", sans-serif; }
.communication-view.module-open { left: 200px; }
.ambient-grid { position: fixed; inset: 54px 0 0; pointer-events: none; opacity: .13; background-image: linear-gradient(rgba(80,190,220,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(80,190,220,.08) 1px, transparent 1px); background-size: 34px 34px; }
.page-header { position: relative; z-index: 1; width:min(1480px,100%); margin: 0 auto; padding: 12px 24px 8px; box-sizing:border-box; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.page-header h1 { margin: 4px 0 4px; font-size: 26px; font-weight: 500; letter-spacing: 3px; }.page-header p { margin: 0; color: #9dc2ce; font-size: 13px; line-height: 1.5; }
.channel-badge { min-width: 210px; padding: 11px 14px 10px 38px; position: relative; border: 1px solid rgba(112,132,142,.28); background: rgba(4,22,34,.85); }.channel-badge i { position: absolute; left: 16px; top: 17px; width: 8px; height: 8px; border-radius: 50%; background: #6b7780; box-shadow: 0 0 0 4px rgba(107,119,128,.13); }.channel-badge.ready i { background: #58e39a; box-shadow: 0 0 9px #58e39a; }.channel-badge b,.channel-badge small { display: block; }.channel-badge b { font-size: 14px; }.channel-badge small { margin-top: 4px; color: #8db3bf; font: 11px Consolas, monospace; }
.workflow { position: relative; z-index: 1; width:min(1480px,100%); margin: 0 auto 7px; padding: 0 24px; box-sizing:border-box; display: grid; grid-template-columns: repeat(6,1fr); gap: 6px; }.workflow article { position: relative; min-height: 50px; padding: 7px 10px; border: 1px solid rgba(67,181,211,.24); background: rgba(4,29,44,.8); }.workflow article::after { content: ''; position: absolute; top: 25px; right: -7px; width: 7px; border-top: 1px solid #3ebedc; }.workflow article:last-child::after { display:none; }.workflow span { color:#38c8e9; font:10px Consolas,monospace; }.workflow b,.workflow small { display:block; }.workflow b { margin:3px 0 2px; font-size:12px; }.workflow small { color:#8fb4bf; font-size:10px; line-height:1.4; }
.empty-state { position: relative; z-index: 1; width: min(680px,calc(100% - 48px)); margin: 90px auto; padding: 60px 45px; text-align:center; border:1px solid rgba(66,178,207,.25); background:rgba(3,23,37,.9); }.empty-state h2 { font-size:18px; letter-spacing:2px; font-weight:500; }.empty-state p { max-width:520px; margin:12px auto 0; color:#769ba6; font-size:12px; line-height:1.8; }.empty-icon { height:54px; display:flex; align-items:flex-end; justify-content:center; gap:8px; }.empty-icon span { width:7px; height:22px; background:#3cc8e9; animation:pulse 1.2s infinite ease-in-out; }.empty-icon span:nth-child(2){height:42px;animation-delay:.15s}.empty-icon span:nth-child(3){height:30px;animation-delay:.3s}@keyframes pulse{50%{opacity:.25;transform:scaleY(.55)}}
.workspace { position:relative; z-index:1; width:min(1480px,100%); min-height:0; height:100%; margin:0 auto; padding:0 24px 12px; box-sizing:border-box; display:grid; grid-template-columns:300px minmax(0,1fr); gap:10px; overflow:hidden; }.control-panel,.results-panel { min-height:0; border:1px solid rgba(67,181,211,.24); background:rgba(3,20,33,.94); }.control-panel{display:grid;grid-template-rows:42px minmax(0,1fr)}.panel-title { height:42px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-bottom:1px solid rgba(67,161,187,.18); }.panel-title b{font-size:14px;letter-spacing:2px}.control-scroll{min-height:0;padding:9px 11px;overflow-y:auto;scrollbar-width:thin;}.control-scroll>label,.two-columns label,.three-columns label{display:flex;flex-direction:column;gap:4px;color:#9bbec8;font-size:12px;margin-bottom:8px}select,input{height:30px;box-sizing:border-box;border:1px solid rgba(74,161,184,.28);background:#061827;color:#c8edf3;padding:0 8px;font:12px Consolas,monospace;outline:none}select:focus,input:focus{border-color:#38c7e8}.control-panel fieldset{margin:1px 0 7px;padding:6px;border:1px solid rgba(67,161,187,.18)}.control-panel legend{padding:0 6px;color:#9bbec8;font-size:11px}.segmented{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px}.segmented:last-child{margin-bottom:0}.segmented button{height:29px;border:1px solid rgba(72,151,173,.25);background:#071c2b;color:#8fb2bd;font-size:11px;cursor:pointer}.segmented button.active{border-color:#39cbea;background:rgba(39,157,184,.18);color:#d4f7ff;box-shadow:inset 0 -2px #36c7e8}.two-columns{display:grid;grid-template-columns:1fr 1fr;gap:0 7px}.three-columns{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.run-button{width:100%;height:38px;border:1px solid #37c9e8;background:linear-gradient(90deg,rgba(18,118,145,.55),rgba(32,171,196,.32));color:#e2fbff;font-size:13px;letter-spacing:1px;cursor:pointer}.run-button:disabled{opacity:.58;cursor:wait}.spinner{display:inline-block;width:10px;height:10px;margin-right:8px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.error-message{padding:7px 9px;margin:7px 0 0;border-left:2px solid #ff6682;background:rgba(134,27,47,.18);color:#ff9bad;font-size:11px;line-height:1.5}
.results-panel{min-width:0;display:grid;grid-template-rows:auto auto auto auto minmax(0,1fr);overflow:hidden}.channel-strip{display:grid;grid-template-columns:repeat(5,1fr);min-height:54px;border-bottom:1px solid rgba(67,161,187,.16)}.channel-strip div{padding:7px 10px;border-right:1px solid rgba(67,161,187,.12)}.channel-strip div:last-child{border-right:0}.channel-strip span,.channel-strip b{display:block}.channel-strip span{color:#8fb2bd;font-size:11px}.channel-strip b{margin-top:4px;font:13px Consolas,monospace}.good{color:#64e5a0!important}.warn{color:#ffb760!important}.result-placeholder{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.result-placeholder h2{font-size:19px;font-weight:500;letter-spacing:2px}.result-placeholder p{max-width:540px;color:#95b8c2;font-size:13px;line-height:1.8}.signal-rings{position:relative;width:100px;height:100px;display:grid;place-items:center}.signal-rings i{position:absolute;inset:10px;border:1px solid rgba(70,207,235,.28);border-radius:50%}.signal-rings i:nth-child(2){inset:22px}.signal-rings i:nth-child(3){inset:34px}.signal-rings b{color:#54daf6;font:12px Consolas,monospace}.result-toolbar{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 11px;border-bottom:1px solid rgba(67,161,187,.14)}.result-toolbar b{display:block;font-size:14px}.result-toolbar label{display:flex;align-items:center;gap:7px;color:#9bbec8;font-size:11px}.result-toolbar select{width:92px;height:29px}.stale-notice{padding:7px 11px;border-bottom:1px solid rgba(255,183,96,.3);color:#ffc179;background:rgba(111,65,16,.2);font-size:11px;line-height:1.5}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:7px 8px}.metric-grid article{padding:7px 9px;border:1px solid rgba(62,157,181,.18);background:#051a29}.metric-grid span,.metric-grid b,.metric-grid small{display:block}.metric-grid span{color:#8fb2bd;font-size:11px}.metric-grid b{margin:5px 0 3px;color:#bceef6;font:18px Consolas,monospace}.metric-grid small{color:#7b9da8;font-size:10px;line-height:1.4}.result-analysis-grid{min-height:0;display:grid;grid-template-columns:minmax(0,1.28fr) minmax(330px,.72fr);gap:7px;padding:0 8px 8px}.chart-card,.evidence-table{min-height:0;border:1px solid rgba(62,157,181,.18);background:#041725}.chart-card{display:grid;grid-template-rows:46px minmax(0,1fr)}.card-heading{min-height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 9px;border-bottom:1px solid rgba(62,157,181,.14)}.card-heading b,.card-heading small{display:block}.card-heading b{font-size:13px}.card-heading small{margin-top:2px;color:#83a5af;font-size:10px;line-height:1.35}.legend{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px 10px;max-width:72%}.legend span{color:#9dbcc6;font-size:10px;white-space:nowrap}.legend i{display:inline-block;width:7px;height:2px;margin-right:4px;vertical-align:middle}.ber-chart{width:100%;height:100%;min-height:180px}.result-side{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:7px}.attribution-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.attribution-grid article{position:relative;padding:7px 8px;border:1px solid rgba(62,157,181,.18);background:#051a29}.attribution-grid span,.attribution-grid b,.attribution-grid small{display:block}.attribution-grid span{color:#94b6c0;font-size:10px}.attribution-grid b{margin:5px 0 3px;font:14px Consolas,monospace}.attribution-grid small{height:30px;overflow:hidden;color:#7c9da8;font-size:9px;line-height:1.45}.attribution-grid div{height:2px;margin-top:5px;background:rgba(255,255,255,.07)}.attribution-grid i{display:block;height:100%;background:#6ddfa0}.attribution-grid.negative i,.attribution-grid article.negative i{background:#ff7189}.attribution-grid article.positive b{color:#66e3a0}.attribution-grid article.negative b{color:#ff8298}.attribution-grid article.neutral b{color:#f4c569}.evidence-table{overflow:auto;scrollbar-width:thin}.evidence-table table{width:100%;border-collapse:collapse;font-size:11px}.evidence-table th,.evidence-table td{padding:6px 7px;text-align:left;border-bottom:1px solid rgba(61,137,157,.11)}.evidence-table th{color:#84a7b2;font-weight:400;position:sticky;top:0;background:#041725}.evidence-table td{color:#a9cbd3}.evidence-table tr.selected td{color:#e2fbff;background:rgba(41,155,182,.09)}
.wide-field{grid-column:1/-1}.two-columns output{height:30px;display:flex;align-items:center;padding:0 8px;color:#69d7ea;border:1px solid rgba(74,161,184,.2);background:#051522;font:11px Consolas,monospace}.carrier-preview{position:relative;height:22px;display:flex;overflow:hidden;border:1px solid rgba(72,151,173,.2);background:#04131f}.carrier-preview i{min-width:5px}.carrier-preview .guard{flex:1;background:#243544}.carrier-preview .data{background:#1687a5}.carrier-preview .pilot{background:#f4b85c}.carrier-preview span{position:absolute;inset:0;display:grid;place-items:center;color:#d6f4f8;font:9px Consolas,monospace;text-shadow:0 1px 3px #000}.frame-layout{display:grid;grid-template-columns:.6fr .45fr 2.7fr .5fr;grid-template-rows:14px 13px;gap:2px}.frame-layout i{display:block}.frame-layout .preamble{background:#9271d1}.frame-layout .header{background:#e3a94e}.frame-layout .payload{background:#238eaa}.frame-layout .gap{background:#334758}.frame-layout span{color:#82a3ae;font-size:9px;text-align:center}.result-side{grid-template-rows:auto minmax(84px,.62fr) minmax(0,1fr)}.diagnostic-card{min-height:0;overflow:hidden;border:1px solid rgba(62,157,181,.18);background:#041725}.diagnostic-card ul{height:calc(100% - 46px);margin:0;padding:4px 8px;box-sizing:border-box;overflow:auto;list-style:none;scrollbar-width:thin}.diagnostic-card li{padding:4px 5px 4px 8px;border-left:2px solid #58a6bd}.diagnostic-card li.high{border-color:#ff6f87}.diagnostic-card li.medium{border-color:#f3b85a}.diagnostic-card li.good{border-color:#5ade9b}.diagnostic-card li b,.diagnostic-card li span{display:block}.diagnostic-card li b{color:#b8dce3;font-size:11px}.diagnostic-card li span{margin-top:3px;color:#83a4af;font-size:10px;line-height:1.45}
.control-panel{position:relative;z-index:3}.panel-title{cursor:grab;touch-action:none;user-select:none}.control-panel.dragging{z-index:20;box-shadow:0 20px 55px rgba(0,0,0,.58)}.control-panel.dragging .panel-title{cursor:grabbing}
@media(max-width:1100px){.workflow{grid-template-columns:repeat(6,1fr)}.workspace{grid-template-columns:240px minmax(700px,1fr);overflow-x:auto}.page-header{align-items:flex-start}.channel-strip{grid-template-columns:repeat(5,1fr)}.result-analysis-grid{grid-template-columns:minmax(430px,1fr) 330px}}
@media(max-height:760px){.page-header p,.workflow small{display:none}.workflow article{min-height:26px}.workspace{grid-template-columns:250px minmax(0,1fr)}.metric-grid article{padding:5px 7px}.ber-chart{min-height:140px}}
.page-header h1{font-size:15px;font-weight:600;letter-spacing:.5px}
.panel-title b{font-size:15px;letter-spacing:.5px}
.card-heading b{font-size:12px;font-weight:600;letter-spacing:.3px}
.result-placeholder h2,.empty-state h2{font-size:15px;font-weight:600;letter-spacing:.5px}
</style>
