<template>
  <svg class="noise-chart" viewBox="0 0 248 98" role="img" :aria-label="`${band.label} 环境噪声频谱曲线`">
    <rect class="band-area" :x="bandStartX" y="8" :width="bandWidth" height="70" />
    <g class="grid"><path d="M25 8V78H243M25 12H243M25 29H243M25 45H243M25 62H243M79 8V78M134 8V78M188 8V78" /></g>
    <line class="band-edge" :x1="bandStartX" y1="8" :x2="bandStartX" y2="78" />
    <line class="band-edge" :x1="bandEndX" y1="8" :x2="bandEndX" y2="78" />
    <polyline v-if="paths.shipping" :points="paths.shipping" class="shipping" />
    <polyline v-if="paths.wind" :points="paths.wind" class="wind" />
    <polyline v-if="paths.rain" :points="paths.rain" class="rain" />
    <polyline v-if="paths.turbulence" :points="paths.turbulence" class="turbulence" />
    <polyline v-if="paths.thermal" :points="paths.thermal" class="thermal" />
    <polyline v-if="paths.total" :points="paths.total" class="total" />
    <line v-if="meanLineY !== null" class="band-mean" :x1="bandStartX" :y1="meanLineY" :x2="bandEndX" :y2="meanLineY" />
    <g class="axis y-axis"><text x="4" y="14">100</text><text x="8" y="31">80</text><text x="8" y="47">60</text><text x="8" y="64">40</text><text x="8" y="80">20</text></g>
    <g class="axis"><text x="22" y="90">10</text><text x="72" y="90">100</text><text x="128" y="90">1k</text><text x="181" y="90">10k</text><text x="229" y="90">100k</text><text class="band-label" x="26" y="7">{{ band.label }}</text><text x="175" y="7">dB re 1 μPa²/Hz</text></g>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import {
  activeWeatherNoiseBand, currentWeatherNoiseCurves, forecastNoiseSummary, weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import { chartPoints } from '@/utils/weatherNoiseForecast.js'

const paths = computed(() => {
  const curves = currentWeatherNoiseCurves.value
  const crop = (values) => Array.isArray(values) ? values.filter((_, index) => index % 4 === 0) : []
  const points = (values) => {
    const source = crop(values)
    if (source.length < 2) return ''
    return chartPoints(source, 218, 70, 20, 105).split(' ').map(pair => {
      const [x, y] = pair.split(',').map(Number)
      return `${(x + 25).toFixed(1)},${(y + 8).toFixed(1)}`
    }).join(' ')
  }
  return {
    shipping: points(curves.shipping),
    wind: points(curves.wind),
    rain: points(curves.rain),
    turbulence: points(curves.turbulence),
    thermal: points(curves.thermal),
    total: points(curves.total),
  }
})

const band = activeWeatherNoiseBand
const frequencyRange = computed(() => {
  const frequency = weatherNoiseState.result?.frequency_hz || [10, 100000]
  return [Number(frequency[0]) || 10, Number(frequency[frequency.length - 1]) || 100000]
})
const xAtFrequency = (frequency) => {
  const [min, max] = frequencyRange.value
  const clamped = Math.min(max, Math.max(min, Number(frequency)))
  return 25 + 218 * Math.log10(clamped / min) / Math.log10(max / min)
}
const bandStartX = computed(() => xAtFrequency(band.value.low_hz))
const bandEndX = computed(() => xAtFrequency(band.value.high_hz))
const bandWidth = computed(() => Math.max(0, bandEndX.value - bandStartX.value))
const meanLineY = computed(() => {
  const value = Number(forecastNoiseSummary.value?.meanPsdDb)
  if (!Number.isFinite(value)) return null
  return Math.min(78, Math.max(8, 8 + (105 - value) * 70 / 85))
})
</script>

<style scoped>
.noise-chart { width:100%; height:auto; display:block; border-radius:6px; background:#0b1929; }
.band-area { fill:#2f9fc3; opacity:.12; }
.grid path { fill:none; stroke:#21374c; stroke-width:.8; }
.band-edge { stroke:#48b9dc; stroke-width:.65; opacity:.8; }
.band-mean { stroke:#73e8f3; stroke-width:1.2; stroke-dasharray:1.5 2; }
polyline { fill:none; stroke-width:1.35; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
.shipping { stroke:#eebc58; stroke-dasharray:5 2; }.wind { stroke:#59dff5; stroke-dasharray:2 2; }.rain { stroke:#5aa8ff; stroke-dasharray:4 2; }.turbulence { stroke:#8ca0b3; stroke-dasharray:3 2; }.thermal { stroke:#b993ff; stroke-dasharray:2 2; }.total { stroke:#f5f8fb; stroke-width:2; }
.axis { fill:#718ca0; font:7px ui-monospace,monospace; }
.axis .band-label { fill:#76cbe4; }
</style>
