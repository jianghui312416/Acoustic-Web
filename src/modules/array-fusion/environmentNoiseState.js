import { shallowRef } from 'vue'
import { buildNoiseTimeFrequency } from '../../utils/noiseTimeFrequency.js'

export const latestEnvironmentNoise = shallowRef(null)

function sampledIndexes(length, limit) {
  if (length <= limit) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: limit }, (_, index) =>
    Math.round((index * (length - 1)) / Math.max(1, limit - 1)))
}

function normalizeServerTimeFrequency(source) {
  if (!source || !Array.isArray(source.psd)) return null
  const times = Array.isArray(source.time) ? source.time.map(Number) : []
  const frequencies = Array.isArray(source.frequency) ? source.frequency.map(Number) : []
  if (!times.length || frequencies.length < 2 || source.psd.length !== times.length) return null
  const timeIndexes = sampledIndexes(times.length, 256)
  const frequencyIndexes = sampledIndexes(frequencies.length, 96)
  return {
    time_s: timeIndexes.map((index) => times[index]),
    frequency_hz: frequencyIndexes.map((index) => frequencies[index]),
    psd_db: timeIndexes.map((timeIndex) =>
      frequencyIndexes.map((frequencyIndex) => Number(source.psd[timeIndex]?.[frequencyIndex]))),
  }
}

function normalizeGeneratedTimeFrequency(model) {
  if (!model?.times?.length || !model?.freqs?.length || !model?.data?.length) return null
  const matrix = Array.from({ length: model.times.length }, () => new Array(model.freqs.length).fill(null))
  for (const item of model.data) {
    const timeIndex = Number(item?.[0])
    const frequencyIndex = Number(item?.[1])
    const value = Number(item?.[2])
    if (Number.isInteger(timeIndex) && Number.isInteger(frequencyIndex) && Number.isFinite(value)) {
      matrix[timeIndex][frequencyIndex] = value
    }
  }
  const timeIndexes = sampledIndexes(model.times.length, 256)
  const frequencyIndexes = sampledIndexes(model.freqs.length, 96)
  return {
    time_s: timeIndexes.map((index) => Number(model.times[index])),
    frequency_hz: frequencyIndexes.map((index) => Number(model.freqs[index])),
    psd_db: timeIndexes.map((timeIndex) =>
      frequencyIndexes.map((frequencyIndex) => Number(matrix[timeIndex][frequencyIndex]))),
  }
}

export function publishEnvironmentNoise(result, params, variant = 'normal') {
  if (!result) return false
  let timeFrequency = normalizeServerTimeFrequency(result.timeFrequency)
  let source = '环境噪声接口时频结果'
  if (!timeFrequency) {
    const generated = buildNoiseTimeFrequency({
      scenario: params?.timeFrequencyScenario,
      variant,
      maxFreq: params?.maxFreq,
      queryTime: params?.time,
      fallbackWindLevel: params?.windSpeed,
    })
    timeFrequency = normalizeGeneratedTimeFrequency(generated)
    source = '环境噪声场景时频结果'
  }
  if (!timeFrequency) return false
  latestEnvironmentNoise.value = {
    ...timeFrequency,
    source,
    variant,
    query_time: params?.time || '',
    receiver: {
      lon: Number(params?.receiverX),
      lat: Number(params?.receiverY),
      depth_m: Number(params?.depth),
    },
    updated_at: Date.now(),
  }
  return true
}

export function clearEnvironmentNoise() {
  latestEnvironmentNoise.value = null
}
