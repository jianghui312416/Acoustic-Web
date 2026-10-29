<template>
  <div class="noise-result">
    <section v-if="hasDepthProfile" class="noise-card">
      <header class="noise-card-head">
        <span>预报噪声深度剖面 NL(z)</span>
        <small v-if="depthProfile?.calcFrequency">计算频率 {{ fmt(depthProfile.calcFrequency, 1) }} Hz</small>
      </header>
      <div ref="depthEl" class="noise-chart" :style="{ height: '250px' }"></div>
    </section>

    <section v-if="spectrumSeries.length" class="noise-card">
      <header class="noise-card-head">
        <span>{{ spectrumTitle }}</span>
        <small>{{ spectrumSeries.length }} 条曲线</small>
      </header>
      <div ref="spectrumEl" class="noise-chart" :style="{ height: '260px' }"></div>
    </section>

    <section v-if="timeFrequency" class="noise-card">
      <header class="noise-card-head">
        <span>模拟时频图（{{ Math.round(timeFrequency.minFreq) }}–{{ Math.round(timeFrequency.maxFreq) }} Hz）</span>
        <small>{{ timeFrequency.durationS }} s</small>
      </header>
      <div ref="timeFreqEl" class="noise-chart" :style="{ height: '300px' }"></div>
    </section>

    <section v-if="hasDirectivity" class="noise-card">
      <header class="noise-card-head">
        <span>垂直指向性（绝对声级）</span>
        <small>
          峰值 {{ fmt(directivity?.peakGrazingAngle, 1) }}° ·
          凹陷 {{ fmt(directivity?.notchGrazingAngle, 1) }}°
        </small>
      </header>
      <div ref="directivityEl" class="noise-chart" :style="{ height: '240px' }"></div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import echarts from '@/plugins/echarts.js'
import { buildNoiseTimeFrequency } from '@/utils/noiseTimeFrequency.js'

const props = defineProps({
  data: { type: Object, default: null },
  variant: { type: String, default: 'normal' },
  params: { type: Object, default: null },
})

/** 与后端 environment_noise.py 一致的海况 / 风级换算风速（m/s）。 */
const WIND_SPEED_MPS = [0, 1, 2.45, 4.4, 6.7, 9.35, 12.3, 15.5, 18.95, 22.6, 26.4, 30.5, 35]
/** 与后端一致的降雨等级换算雨强（mm/h）。 */
const RAIN_RATE_MM_H = [0, 0.25, 1, 2.5, 7.5, 20, 50]
/** 非冰区手动等级模式的分量谱（Wenz 经验曲线，与后端计算口径一致）。 */
function normalComponentCurves(frequency, params) {
  const shipLevel = Number(params?.shipDensityLevel)
  const windLevel = Number(params?.windSpeed)
  const rainLevel = Number(params?.rainIntensity)
  if (![shipLevel, windLevel, rainLevel].every(Number.isFinite)) return []

  const shippingFactor = (shipLevel - 1) / 4
  const windMps = WIND_SPEED_MPS[Math.max(0, Math.min(12, Math.round(windLevel)))]
  const rainRate = RAIN_RATE_MM_H[Math.max(0, Math.min(6, Math.round(rainLevel)))]
  const rainAt5k = rainLevel > 0 ? 50 + 17 * Math.log10(rainRate) : null
  const rainPeak = rainAt5k == null ? null : rainAt5k + 15 * Math.log2(13500 / 5000)

  const turbulence = []
  const shipping = []
  const thermal = []
  const wind = []
  const rain = []
  for (const value of frequency) {
    const khz = value / 1000
    turbulence.push(17 - 30 * Math.log10(khz))
    shipping.push(
      40 + 20 * (shippingFactor - 0.5) + 26 * Math.log10(khz) - 60 * Math.log10(khz + 0.03)
    )
    thermal.push(-15 + 20 * Math.log10(khz))
    wind.push(50 + 7.5 * Math.sqrt(Math.max(0, windMps)) + 20 * Math.log10(khz) - 40 * Math.log10(khz + 0.4))
    if (rainAt5k == null) continue
    rain.push(
      value < 13500
        ? rainAt5k + 15 * Math.log2(value / 5000)
        : rainPeak - 7 * Math.log2(value / 13500)
    )
  }

  const curves = [
    { name: '湍流', values: turbulence, color: '#6ee7a8', type: 'dashed', width: 1.2 },
    { name: '航运', values: shipping, color: '#f0a35c', type: 'dashed', width: 1.2 },
    { name: '热噪声', values: thermal, color: '#b388ff', type: 'dashed', width: 1.2 },
    { name: '风生', values: wind, color: '#29c3f0', type: 'dashed', width: 1.2 },
  ]
  if (rain.length) {
    curves.push({ name: '降雨', values: rain, color: '#f7d75c', type: 'dashed', width: 1.2 })
  }
  return curves
}

const TF_COLORS = [
  '#000004',
  '#1b0c41',
  '#4a0c6b',
  '#781c6d',
  '#a52c60',
  '#cf4446',
  '#ed6925',
  '#fb9b06',
  '#f7d13d',
  '#fcffa4',
]

const timeFreqEl = ref(null)

const spectrumEl = ref(null)
const depthEl = ref(null)
const directivityEl = ref(null)

const charts = new Map()
let resizeObserver = null

const fmt = (value, digits = 1) => {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '—'
}

function fmtFrequency(value) {
  const frequency = Number(value)
  if (!Number.isFinite(frequency)) return ''
  if (frequency >= 1000) {
    const khz = frequency / 1000
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)}k`
  }
  return String(Math.round(frequency))
}

const spectrum = computed(() => {
  const response = props.data
  if (!response) return null
  if (Array.isArray(response.freq) && Array.isArray(response.data)) {
    const curves = [
      { name: '总噪声', values: response.data, color: '#ff6b9d', type: 'solid', width: 1.6 },
      ...normalComponentCurves(response.freq, props.params),
    ]
    return { frequency: response.freq, curves }
  }
  const source = response.noiseSpectrum
  if (!source || !Array.isArray(source.frequency)) return null
  const curves = [
    {
      name: 'NL 总计',
      values: source.totalNoiseLevel,
      color: '#29c3f0',
      type: 'solid',
      width: 1.6,
    },
    {
      name: '① 冰裂',
      values: source.IceCrackNoiseLevel,
      color: '#f0a35c',
      type: 'dashed',
      width: 1.4,
    },
    {
      name: '② 风冰',
      values: source.windAndIceNoiseLevel,
      color: '#f7d75c',
      type: 'dotted',
      width: 1.4,
    },
    {
      name: '③ 开阔水',
      values: source.openWaterNoiseLevel,
      color: '#6ee7a8',
      type: 'dashed',
      width: 1.4,
    },
  ].filter((curve) => Array.isArray(curve.values) && curve.values.length)
  return { frequency: source.frequency, curves }
})

const spectrumSeries = computed(() => spectrum.value?.curves ?? [])
const spectrumTitle = computed(() =>
  props.variant === 'ice' ? '预报噪声谱级（冰区多源）' : '噪声谱图'
)

const depthProfile = computed(() => props.data?.depthProfile ?? null)
const hasDepthProfile = computed(
  () => Array.isArray(depthProfile.value?.depth) && Array.isArray(depthProfile.value?.noiseLevel)
)

const directivity = computed(() => props.data?.noiseDirectivity ?? null)
const hasDirectivity = computed(
  () =>
    Array.isArray(directivity.value?.grazingAngle) &&
    Array.isArray(directivity.value?.absNoiseLevel)
)

function timeLabelFor(timeS, timeAxis, queryTime, every) {
  if (Math.abs(Math.round(timeS / every) * every - timeS) > 1e-6) return ''
  if (timeAxis !== 'absolute') return String(Math.round(timeS * 10) / 10)
  const base = Date.parse(String(queryTime || '').replace(' ', 'T'))
  if (!Number.isFinite(base)) return String(Math.round(timeS * 10) / 10)
  return new Date(base + timeS * 1000).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function displayTimeFor(timeS, timeAxis, queryTime) {
  if (timeAxis !== 'absolute') return `${Math.round(timeS * 10) / 10} s`
  const base = Date.parse(String(queryTime || '').replace(' ', 'T'))
  return Number.isFinite(base)
    ? new Date(base + timeS * 1000).toLocaleString('zh-CN', { hour12: false })
    : `${Math.round(timeS * 10) / 10} s`
}

function normalizeServerTimeFrequency(source, params) {
  if (!source || !Array.isArray(source.psd)) return null
  const times = Array.isArray(source.time) ? source.time.map(Number) : []
  const freqs = Array.isArray(source.frequency) ? source.frequency.map(Number) : []
  if (!times.length || freqs.length < 2 || source.psd.length !== times.length) return null
  const scenario = params?.timeFrequencyScenario ?? {}
  const timeAxis = source.timeAxis || scenario.timeAxis || 'relative'
  const durationS = Number(source.duration) || Number(scenario.durationS) || 60
  const labelEvery = durationS <= 120 ? 10 : durationS <= 600 ? 60 : 300
  const timeLabels = times.map((value) => timeLabelFor(value, timeAxis, params?.time, labelEvery))
  const displayTimes = times.map((value) => displayTimeFor(value, timeAxis, params?.time))
  const freqLabels = freqs.map(() => '')
  for (const target of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]) {
    if (target > freqs[freqs.length - 1] * 1.02) continue
    let bestIndex = 0
    let bestDifference = Infinity
    freqs.forEach((value, index) => {
      const difference = Math.abs(Math.log(value / target))
      if (difference < bestDifference) {
        bestDifference = difference
        bestIndex = index
      }
    })
    freqLabels[bestIndex] = target >= 1000 ? `${target / 1000}k` : String(target)
  }

  const data = []
  let minDb = Infinity
  let maxDb = -Infinity
  times.forEach((_, timeIndex) => {
    const row = source.psd[timeIndex] || []
    freqs.forEach((__, frequencyIndex) => {
      const value = Number(row[frequencyIndex])
      if (!Number.isFinite(value)) return
      minDb = Math.min(minDb, value)
      maxDb = Math.max(maxDb, value)
      data.push([timeIndex, frequencyIndex, Math.round(value * 10) / 10])
    })
  })
  if (!data.length) return null

  return {
    durationS,
    timeAxis,
    times,
    displayTimes,
    freqs,
    timeLabels,
    freqLabels,
    data,
    minDb: Math.floor(minDb / 5) * 5,
    maxDb: Math.ceil(maxDb / 5) * 5,
    minFreq: freqs[0],
    maxFreq: freqs[freqs.length - 1],
    rainBands: (Array.isArray(scenario.rainEvents) ? scenario.rainEvents : []).map((event) => [
      Number(event?.startS) || 0,
      Number(event?.endS) || 0,
    ]),
    shipBands: (Array.isArray(scenario.shipEvents) ? scenario.shipEvents : []).map((event) => [
      Number(event?.startS) || 0,
      Number(event?.endS) || 0,
    ]),
    crackTimes: (Array.isArray(scenario.iceCrackEvents) ? scenario.iceCrackEvents : []).map(
      (event) => Number(event?.timeS) || 0
    ),
  }
}

const timeFrequency = computed(() => {
  if (!props.data) return null
  const fromServer = normalizeServerTimeFrequency(props.data.timeFrequency, props.params)
  if (fromServer) return fromServer
  const p = props.params ?? {}
  return buildNoiseTimeFrequency({
    scenario: p.timeFrequencyScenario,
    variant: props.variant,
    maxFreq: p.maxFreq,
    queryTime: p.time,
    fallbackWindLevel: p.windSpeed,
  })
})

function chartAt(element) {
  if (!element) return null
  let chart = charts.get(element)
  if (!chart) {
    chart = echarts.init(element)
    charts.set(element, chart)
  }
  return chart
}

const AXIS_STYLE = {
  axisLine: { lineStyle: { color: 'rgba(122, 180, 204, 0.55)' } },
  axisLabel: { color: '#8fb6c8', fontSize: 10 },
  splitLine: { lineStyle: { color: 'rgba(84, 150, 178, 0.16)' } },
  nameTextStyle: { color: '#8fb6c8', fontSize: 11 },
}

function tooltipStyle() {
  return {
    trigger: 'axis',
    backgroundColor: 'rgba(6, 28, 43, 0.94)',
    borderColor: 'rgba(66, 154, 189, 0.6)',
    textStyle: { color: '#d9edf5', fontSize: 11 },
  }
}

function renderSpectrum() {
  const chart = chartAt(spectrumEl.value)
  const model = spectrum.value
  if (!chart) return
  if (!model?.curves?.length) {
    chart.clear()
    return
  }
  chart.setOption(
    {
      animation: false,
      grid: { left: 48, right: 20, top: 20, bottom: 52 },
      tooltip: tooltipStyle(),
      legend: {
        bottom: 4,
        itemWidth: 16,
        itemHeight: 3,
        textStyle: { color: '#8fb6c8', fontSize: 10 },
      },
      xAxis: {
        type: 'value',
        name: '频率 (Hz)',
        nameLocation: 'middle',
        nameGap: 26,
        min: 0,
        max: 'dataMax',
        ...AXIS_STYLE,
      },
      yAxis: {
        type: 'value',
        name: '谱级 (dB re 1 µPa²/Hz)',
        scale: true,
        ...AXIS_STYLE,
      },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
      series: model.curves.map((curve) => ({
        name: curve.name,
        type: 'line',
        showSymbol: false,
        sampling: 'lttb',
        itemStyle: { color: curve.color },
        lineStyle: { width: curve.width, type: curve.type, color: curve.color },
        data: model.frequency.map((frequency, index) => [frequency, curve.values[index]]),
      })),
    },
    true
  )
}

function renderTimeFrequency() {
  const chart = chartAt(timeFreqEl.value)
  const model = timeFrequency.value
  if (!chart) return
  if (!model?.data?.length) {
    chart.clear()
    return
  }
  const nearestTimeIndex = (timeS) => {
    let bestIndex = 0
    let bestDifference = Infinity
    model.times.forEach((value, index) => {
      const difference = Math.abs(value - Number(timeS))
      if (difference < bestDifference) {
        bestDifference = difference
        bestIndex = index
      }
    })
    return bestIndex
  }
  const eventAreas = [
    ...model.rainBands.map(([start, end]) => [
      { xAxis: nearestTimeIndex(start), itemStyle: { color: 'rgba(41, 195, 240, 0.10)' } },
      { xAxis: nearestTimeIndex(end) },
    ]),
    ...model.shipBands.map(([start, end]) => [
      { xAxis: nearestTimeIndex(start), itemStyle: { color: 'rgba(247, 215, 92, 0.10)' } },
      { xAxis: nearestTimeIndex(end) },
    ]),
  ]
  chart.setOption(
    {
      animation: false,
      grid: { left: 58, right: 80, top: 18, bottom: 42 },
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(6, 28, 43, 0.94)',
        borderColor: 'rgba(66, 154, 189, 0.6)',
        textStyle: { color: '#d9edf5', fontSize: 11 },
        formatter: (info) => {
          const [timeIndex, freqIndex, value] = info.value
          const frequency = model.freqs[freqIndex]
          const frequencyText =
            frequency >= 1000 ? `${(frequency / 1000).toFixed(2)} kHz` : `${frequency.toFixed(1)} Hz`
          return `${model.displayTimes[timeIndex]}<br/>${frequencyText}<br/>${value.toFixed(1)} dB`
        },
      },
      xAxis: {
        type: 'category',
        name: model.timeAxis === 'absolute' ? '时间' : '相对时间 (s)',
        nameLocation: 'middle',
        nameGap: 27,
        data: model.timeLabels,
        ...AXIS_STYLE,
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        name: '频率 (Hz)',
        nameGap: 12,
        data: model.freqs,
        ...AXIS_STYLE,
        axisLabel: {
          ...AXIS_STYLE.axisLabel,
          interval: (index) => index === 0
            || index === model.freqs.length - 1
            || index % Math.max(1, Math.ceil(model.freqs.length / 6)) === 0,
          formatter: (_value, index) => fmtFrequency(model.freqs[index]),
        },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      visualMap: {
        min: model.minDb,
        max: model.maxDb,
        calculable: true,
        orient: 'vertical',
        right: 4,
        top: 'middle',
        itemHeight: 130,
        textStyle: { color: '#8fb6c8', fontSize: 9 },
        inRange: { color: TF_COLORS },
      },
      series: [
        {
          name: '模拟时频图',
          type: 'heatmap',
          data: model.data,
          progressive: 0,
          itemStyle: { borderWidth: 0 },
          emphasis: { itemStyle: { borderColor: '#ffffff', borderWidth: 0.6 } },
          markArea: {
            silent: true,
            label: { show: false },
            data: eventAreas,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: 'rgba(255, 120, 120, 0.75)', width: 1 },
            data: model.crackTimes.map((timeS) => ({ xAxis: nearestTimeIndex(timeS) })),
          },
        },
      ],
    },
    true
  )
}

function renderDepth() {
  const chart = chartAt(depthEl.value)
  const profile = depthProfile.value
  if (!chart) return
  if (!hasDepthProfile.value) {
    chart.clear()
    return
  }
  chart.setOption(
    {
      animation: false,
      color: ['#25c9f7'],
      grid: { left: 52, right: 22, top: 22, bottom: 34 },
      tooltip: {
        ...tooltipStyle(),
        valueFormatter: (value) => `${Number(value).toFixed(2)}`,
      },
      xAxis: {
        type: 'value',
        name: 'NL(z) (dB)',
        scale: true,
        ...AXIS_STYLE,
      },
      yAxis: {
        type: 'value',
        name: '深度 (m)',
        inverse: true,
        ...AXIS_STYLE,
      },
      series: [
        {
          name: '噪声深度剖面',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.6 },
          data: profile.depth.map((depth, index) => [profile.noiseLevel[index], depth]),
        },
      ],
    },
    true
  )
}

function renderDirectivity() {
  const chart = chartAt(directivityEl.value)
  const model = directivity.value
  if (!chart) return
  if (!hasDirectivity.value) {
    chart.clear()
    return
  }
  chart.setOption(
    {
      animation: false,
      color: ['#29c3f0'],
      grid: { left: 52, right: 22, top: 22, bottom: 34 },
      tooltip: tooltipStyle(),
      xAxis: {
        type: 'value',
        name: '投射角 (°)',
        min: -90,
        max: 90,
        interval: 30,
        ...AXIS_STYLE,
      },
      yAxis: {
        type: 'value',
        name: '绝对声级 (dB)',
        scale: true,
        ...AXIS_STYLE,
      },
      series: [
        {
          name: '垂直指向性',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 1.6 },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { type: 'dashed', width: 1 },
            data: [
              {
                xAxis: Number(model.peakGrazingAngle),
                lineStyle: { color: '#6ee7a8' },
              },
              {
                xAxis: Number(model.notchGrazingAngle),
                lineStyle: { color: '#f0a35c' },
              },
            ].filter((item) => Number.isFinite(item.xAxis)),
          },
          data: model.grazingAngle.map((angle, index) => [angle, model.absNoiseLevel[index]]),
        },
      ],
    },
    true
  )
}

function renderAll() {
  renderSpectrum()
  renderTimeFrequency()
  renderDepth()
  renderDirectivity()
}

function resizeAll() {
  for (const chart of charts.values()) chart.resize()
}

watch(
  () => [
    props.data,
    props.variant,
    props.params?.windSpeed,
    props.params?.rainIntensity,
    props.params?.shipDensityLevel,
    props.params?.maxFreq,
    props.params?.timeFrequencyScenario,
  ],
  async () => {
    await nextTick()
    renderAll()
  },
  { deep: true }
)

onMounted(async () => {
  await nextTick()
  renderAll()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resizeAll())
    for (const element of [spectrumEl.value, timeFreqEl.value, depthEl.value, directivityEl.value]) {
      if (element) resizeObserver.observe(element)
    }
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  for (const chart of charts.values()) chart.dispose()
  charts.clear()
})
</script>

<style scoped>
.noise-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.noise-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid rgba(67, 151, 184, 0.28);
  border-radius: 4px;
  background: rgba(9, 38, 57, 0.55);
  overflow: hidden;
}

.noise-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  color: #bfe6f5;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid rgba(67, 151, 184, 0.2);
}

.noise-card-head small {
  color: #78a8bc;
  font-size: 10px;
  font-weight: 400;
}

.noise-chart {
  width: 100%;
}
</style>
