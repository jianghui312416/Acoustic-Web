<template>
  <section class="domain-shell" :class="{ 'has-hidden': hidden.size, 'embedded-grid': props.embeddedGrid }">
    <div v-if="hidden.size" class="restore-bar">
      <span>已关闭</span>
      <button v-for="item in closedItems" :key="item.id" type="button" @click="restore(item.id)">还原 {{ item.title }}</button>
      <button type="button" @click="restoreAll">全部还原</button>
    </div>
    <div class="domain-grid" :class="{ compact: hidden.size }">
      <article v-for="item in visibleItems" :key="item.id" class="domain-panel" :class="`domain-${item.id}`">
        <header><span>{{ displayIndex(item) }}</span><b>{{ item.title }}</b><em>{{ itemUnit(item) }}</em><button v-if="props.closable" type="button" aria-label="关闭窗口" @click="close(item.id)">×</button></header>
        <div :ref="(element) => setHost(item.id, element)" class="domain-chart"></div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import echarts from '@/plugins/echarts.js'

const props = defineProps({
  frame: { type: Object, required: true },
  excluded: { type: Array, default: () => [] },
  stationary: { type: Boolean, default: false },
  indexOffset: { type: Number, default: 0 },
  closable: { type: Boolean, default: true },
  embeddedGrid: { type: Boolean, default: false },
})
const items = Object.freeze([
  { id: 'time', index: '02', title: '观察阵元时域', unit: '幅度' },
  { id: 'frequency', index: '03', title: '观察阵元频域', unit: 'dB' },
  { id: 'time-frequency', index: '04', title: '观察阵元时频', unit: 'Hz / dB' },
  { id: 'spatial', index: '05', title: '全阵列空间谱', unit: '° / dB' },
  { id: 'beam', index: '06', title: '全阵列波束输出', unit: '延时求和' },
  { id: 'cir', index: '07', title: '观察阵元 CIR', unit: 'ms / |h|' },
])
const hidden = reactive(new Set())
const hosts = new Map()
const charts = new Map()
const history = reactive([])
let resizeObserver = null
let historyElement = null
let historySource = null

const excludedItems = computed(() => new Set(props.excluded))
const visibleItems = computed(() => items.filter((item) => !excludedItems.value.has(item.id) && !hidden.has(item.id)))
const closedItems = computed(() => items.filter((item) => !excludedItems.value.has(item.id) && hidden.has(item.id)))

function displayIndex(item) {
  return String(Number(item.index) + Number(props.indexOffset || 0)).padStart(2, '0')
}

function itemUnit(item) {
  if (item.id === 'time') return props.frame?.waveformLabel || item.unit
  if (item.id === 'frequency') return props.frame?.frequencyLabel || item.unit
  if (item.id === 'time-frequency') return props.frame?.timeFrequencyLabel || item.unit
  if (item.id === 'spatial') return props.frame?.spatialLabel || item.unit
  if (item.id === 'beam') return props.frame?.beamLabel || item.unit
  return item.unit
}

function setHost(id, element) {
  if (element) hosts.set(id, element)
}

const axis = (name = '') => ({
  type: 'value', name, nameTextStyle: { color: '#638b98', fontSize: 8 },
  axisLine: { lineStyle: { color: '#25576a' } }, axisTick: { show: false },
  axisLabel: { color: '#6e9aa8', fontSize: 8 }, splitLine: { lineStyle: { color: 'rgba(52,130,155,.12)' } },
})
const lineSeries = (data, color = '#41ddf5') => ({
  type: 'line', data, showSymbol: false, animation: false,
  lineStyle: { color, width: 1.3 }, areaStyle: { color: `${color}14` },
})

function ensureChart(id) {
  const host = hosts.get(id)
  if (!host || host.clientWidth < 2 || host.clientHeight < 2) return null
  if (!charts.has(id)) charts.set(id, echarts.init(host))
  return charts.get(id)
}

function renderLine(id, x, y, xName, yName, color) {
  const chart = ensureChart(id)
  if (!chart) return
  chart.setOption({
    animation: false, grid: { left: 39, right: 10, top: 10, bottom: 28 },
    tooltip: { trigger: 'axis', confine: true }, xAxis: { ...axis(xName), data: x, type: 'category', boundaryGap: false },
    yAxis: axis(yName), series: [lineSeries(y, color)],
  }, { notMerge: true })
}

function renderFrequency() {
  const frame = props.frame ?? {}
  const frequencies = (frame.elementFrequencies ?? []).map(Number)
  const probes = (frame.probeFrequencies ?? []).map(Number).filter(Number.isFinite)
  const chart = ensureChart('frequency')
  if (!chart) return
  const series = lineSeries(frame.elementSpectrum ?? [], '#68e6ac')
  if (frequencies.length && probes.length) {
    const colors = ['#4fe1f5', '#ffbd5d']
    series.markLine = {
      symbol: 'none', silent: true,
      label: { show: true, position: 'insideEndTop', color: '#dffaff', fontSize: 8, formatter: ({ data }) => data.name },
      data: probes.map((frequency, index) => {
        const nearest = frequencies.reduce((best, value) => Math.abs(value - frequency) < Math.abs(best - frequency) ? value : best, frequencies[0])
        return { name: `f${index + 1} ${frequency.toFixed(0)} Hz`, xAxis: nearest, lineStyle: { color: colors[index % colors.length], width: 1.2, type: 'dashed' } }
      }),
    }
  }
  chart.setOption({
    animation: false, grid: { left: 39, right: 10, top: 18, bottom: 28 },
    tooltip: { trigger: 'axis', confine: true },
    xAxis: { ...axis('Hz'), data: frequencies, type: 'category', boundaryGap: false },
    yAxis: axis('dB'), series: [series],
  }, { notMerge: true })
}

function renderCir() {
  const taps = Array.isArray(props.frame.impulseResponse) ? props.frame.impulseResponse : []
  const chart = ensureChart('cir')
  if (!chart) return
  chart.setOption({
    animation: false, grid: { left: 42, right: 10, top: 25, bottom: 28 }, tooltip: { trigger: 'axis', confine: true },
    legend: { top: 2, right: 5, textStyle: { color: '#789ca8', fontSize: 8 }, itemWidth: 10, itemHeight: 5 },
    xAxis: { ...axis('ms'), type: 'category', data: taps.map((tap) => Number(tap.excess_delay_ms ?? 0).toFixed(2)) },
    yAxis: axis('h'),
    series: [
      { name: '|h|', type: 'line', data: taps.map((tap) => Number(tap.magnitude ?? 0)), showSymbol: true, symbolSize: 6, lineStyle: { color: '#ffbd5d', width: 1.4 }, itemStyle: { color: '#ffbd5d' }, animation: false },
      { name: '实部', type: 'line', data: taps.map((tap) => Number(tap.gain_real ?? tap.magnitude ?? 0)), showSymbol: true, symbolSize: 4, lineStyle: { color: '#49e1f5', width: 1 }, itemStyle: { color: '#49e1f5' }, animation: false },
      { name: '虚部', type: 'line', data: taps.map((tap) => Number(tap.gain_imag ?? 0)), showSymbol: true, symbolSize: 4, lineStyle: { color: '#c58cff', width: 1 }, itemStyle: { color: '#c58cff' }, animation: false },
    ],
  }, { notMerge: true })
}

function renderTimeFrequency() {
  const chart = ensureChart('time-frequency')
  if (!chart || !history.length) return
  const frequencies = history.at(-1).frequencies
  const data = []
  history.forEach((row, column) => row.spectrum.forEach((value, index) => data.push([column, index, value])))
  chart.setOption({
    animation: false, grid: { left: 42, right: 8, top: 8, bottom: 28 }, tooltip: { position: 'top' },
    xAxis: { type: 'category', data: history.map((row) => row.time.toFixed(3)), axisLabel: { color: '#6e9aa8', fontSize: 8 }, axisLine: { lineStyle: { color: '#25576a' } } },
    yAxis: { type: 'category', data: frequencies.map((value) => Math.round(value)), axisLabel: { color: '#6e9aa8', fontSize: 8 }, axisLine: { lineStyle: { color: '#25576a' } } },
    visualMap: { show: false, min: -82, max: -28, inRange: { color: ['#071827', '#083e64', '#00afc4', '#ffe15e', '#ff5847'] } },
    series: [{ type: 'heatmap', data, progressive: 0, animation: false }],
  }, { notMerge: true })
}

function renderAll() {
  const frame = props.frame ?? {}
  renderLine('time', frame.waveformTime ?? [], frame.waveform ?? [], frame.waveformTimeUnit ?? 'ms', '幅度', '#49e1f5')
  renderFrequency()
  renderLine('spatial', frame.scanAngles ?? [], frame.curve ?? [], '°', 'dB', '#ffd166')
  renderLine('beam', frame.beamOutputTime ?? [], frame.beamOutput ?? [], frame.beamTimeUnit ?? 'ms', '幅度', '#ff8e6e')
  renderCir()
  renderTimeFrequency()
}

function close(id) {
  charts.get(id)?.dispose()
  charts.delete(id)
  hidden.add(id)
  nextTick(renderAll)
}
function restore(id) { hidden.delete(id); nextTick(renderAll) }
function restoreAll() { hidden.clear(); nextTick(renderAll) }

watch(() => props.frame, (frame) => {
  const selectedElement = Number(frame?.selectedElement ?? 0)
  const source = frame?.historySource ?? null
  const frequencies = frame?.elementFrequencies ?? []
  const spectrum = frame?.elementSpectrum ?? []
  if (props.stationary || historyElement !== selectedElement || historySource !== source) {
    history.splice(0)
    historyElement = selectedElement
    historySource = source
  }
  if (frequencies.length && frequencies.length === spectrum.length) {
    const row = { time: Number(frame.time ?? 0), frequencies: [...frequencies], spectrum: [...spectrum] }
    if (props.stationary) {
      for (let index = 0; index < 24; index += 1) history.push({ ...row, time: index })
    } else {
      const last = history.at(-1)
      if (last?.time > row.time) history.splice(0)
      if (last?.time === row.time) history[history.length - 1] = row
      else history.push(row)
    }
    if (history.length > 36) history.shift()
  }
  nextTick(renderAll)
}, { deep: false, immediate: true })

onMounted(() => {
  nextTick(renderAll)
  resizeObserver = new ResizeObserver(() => charts.forEach((chart) => chart.resize()))
  hosts.forEach((host) => resizeObserver.observe(host))
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  charts.forEach((chart) => chart.dispose())
  charts.clear()
})
</script>

<style scoped>
.domain-shell { min-height: 0; height: 100%; display: grid; grid-template-rows: minmax(0, 1fr); gap: 6px; }
.domain-shell.has-hidden { grid-template-rows: auto minmax(0, 1fr); }
.restore-bar { min-height: 26px; display: flex; align-items: center; gap: 5px; padding: 3px 6px; border: 1px solid rgba(59,166,195,.22); background: rgba(3,25,38,.88); overflow-x: auto; }
.restore-bar span { color: #688e9a; font-size: 8px; white-space: nowrap; }.restore-bar button { border: 1px solid #23576a; color: #88c7d5; background: #071d2a; font-size: 8px; white-space: nowrap; cursor: pointer; }
.domain-grid { min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 7px; }
.domain-panel { min-width: 0; min-height: 0; display: grid; grid-template-rows: 27px minmax(0, 1fr); border: 1px solid rgba(53,150,179,.28); background: rgba(2,20,32,.94); }
.domain-panel header { display: flex; align-items: center; gap: 6px; padding: 0 7px; border-bottom: 1px solid rgba(52,141,168,.2); }.domain-panel header span { color: #38d8f2; font: 8px Consolas, monospace; }.domain-panel header b { color: #c8eaf0; font-size: 10px; font-weight: 500; }.domain-panel header em { margin-left: auto; color: #5f8793; font-size: 8px; font-style: normal; }.domain-panel header button { width: 18px; height: 18px; padding: 0; border: 0; color: #688f9a; background: transparent; cursor: pointer; }.domain-panel header button:hover { color: #ff8b7d; }
.domain-chart { min-height: 0; width: 100%; height: 100%; }
.domain-shell.embedded-grid,.domain-shell.embedded-grid .domain-grid { display: contents; }
.domain-panel header b{font-size:12px;font-weight:600;letter-spacing:.3px}
</style>
