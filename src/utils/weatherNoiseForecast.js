export function clampFrameIndex(value, frameCount) {
  const max = Math.max(0, Number(frameCount || 0) - 1)
  const index = Math.round(Number(value) || 0)
  return Math.min(max, Math.max(0, index))
}

export function directionLabel(degrees) {
  const value = Number(degrees)
  if (!Number.isFinite(value)) return '风向未知'
  const labels = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风']
  return labels[Math.round((((value % 360) + 360) % 360) / 45) % labels.length]
}

export function formatForecastTime(value) {
  if (!value) return '—'
  const parsed = new Date(String(value).includes('Z') ? value : `${value}:00Z`)
  if (!Number.isFinite(parsed.getTime())) return String(value).replace('T', ' ')
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

export function nearestFrequencyIndex(frequencies, targetHz) {
  if (!Array.isArray(frequencies) || !frequencies.length) return -1
  let selected = 0
  let distance = Infinity
  frequencies.forEach((value, index) => {
    const next = Math.abs(Number(value) - Number(targetHz))
    if (next < distance) { distance = next; selected = index }
  })
  return selected
}

/** 频带内功率谱密度的线性功率平均，单位仍为 dB re 1 μPa²/Hz。 */
export function meanBandLevelDb(frequencies, levels, lowHz = 50, highHz = 1000) {
  if (!Array.isArray(frequencies) || !Array.isArray(levels)) return null
  const low = Number(lowHz)
  const high = Number(highHz)
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null
  const samples = frequencies.slice(0, levels.length).map((value, index) => ({
    frequency: Number(value),
    power: 10 ** (Number(levels[index]) / 10),
  })).filter(sample => Number.isFinite(sample.frequency) && Number.isFinite(sample.power))
    .sort((a, b) => a.frequency - b.frequency)
  let integratedPower = 0
  let coveredBandwidth = 0
  for (let index = 1; index < samples.length; index++) {
    const left = samples[index - 1]
    const right = samples[index]
    if (right.frequency <= left.frequency) continue
    const start = Math.max(low, left.frequency)
    const stop = Math.min(high, right.frequency)
    if (stop <= start) continue
    const ratioAt = frequency => (frequency - left.frequency) / (right.frequency - left.frequency)
    const startPower = left.power + (right.power - left.power) * ratioAt(start)
    const stopPower = left.power + (right.power - left.power) * ratioAt(stop)
    integratedPower += (startPower + stopPower) * (stop - start) / 2
    coveredBandwidth += stop - start
  }
  // 只有完整覆盖所选频带时才返回该频带均值，避免把缺测范围当作零功率。
  if (coveredBandwidth < (high - low) * (1 - 1e-9) || integratedPower <= 0) return null
  return 10 * Math.log10(integratedPower / (high - low))
}

/**
 * 频带噪声级 = 频带内平均功率谱密度 + 10lg(带宽)。平均值按线性频率积分，
 * 因而不会受接口采用对数频率采样影响。
 * 返回 dB re 1 μPa²；meanPsdDb 仍为 dB re 1 μPa²/Hz，便于界面解释计算过程。
 */
export function bandNoiseMetricsDb(frequencies, levels, lowHz = 50, highHz = 1000) {
  const low = Number(lowHz)
  const high = Number(highHz)
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return { meanPsdDb: null, bandwidthHz: null, bandwidthCorrectionDb: null, bandLevelDb: null }
  }
  const meanPsdDb = meanBandLevelDb(frequencies, levels, low, high)
  const bandwidthHz = high - low
  const bandwidthCorrectionDb = 10 * Math.log10(bandwidthHz)
  return {
    meanPsdDb,
    bandwidthHz,
    bandwidthCorrectionDb,
    bandLevelDb: Number.isFinite(meanPsdDb) ? meanPsdDb + bandwidthCorrectionDb : null,
  }
}

export function spectrumValueAt(frequencies, levels, targetHz) {
  const index = nearestFrequencyIndex(frequencies, targetHz)
  const value = index >= 0 ? Number(levels?.[index]) : NaN
  return Number.isFinite(value) ? value : null
}

export function clampShippingActivity(value) {
  const activity = Number(value)
  return Number.isFinite(activity) ? Math.min(1, Math.max(0, activity)) : 0
}

/** Coates/Stojanovic 的 Wenz 远距离航运噪声经验谱，频率单位 Hz。 */
export function coatesStojanovicShippingCurve(frequencies, shippingActivity) {
  const activity = clampShippingActivity(shippingActivity)
  return (frequencies || []).map(value => {
    const frequencyKhz = Number(value) / 1000
    return 40 + 20 * (activity - 0.5)
      + 26 * Math.log10(frequencyKhz)
      - 60 * Math.log10(frequencyKhz + 0.03)
  })
}

export function powerSumCurvesDb(curves) {
  const valid = (curves || []).filter(values => Array.isArray(values) && values.length)
  if (!valid.length) return []
  const length = Math.min(...valid.map(values => values.length))
  return Array.from({ length }, (_, index) => {
    const power = valid.reduce((sum, values) => sum + 10 ** (Number(values[index]) / 10), 0)
    return 10 * Math.log10(power)
  })
}

export function chartPoints(values, width = 248, height = 54, minValue, maxValue) {
  if (!Array.isArray(values) || values.length < 2) return ''
  const finite = values.map(Number).filter(Number.isFinite)
  if (!finite.length) return ''
  const min = Number.isFinite(minValue) ? minValue : Math.min(...finite)
  const max = Number.isFinite(maxValue) ? maxValue : Math.max(...finite)
  const span = Math.max(0.001, max - min)
  return values.map((value, index) => {
    const x = index * width / (values.length - 1)
    const y = height - (Number(value) - min) * height / span
    return `${x.toFixed(1)},${Math.min(height, Math.max(0, y)).toFixed(1)}`
  }).join(' ')
}
