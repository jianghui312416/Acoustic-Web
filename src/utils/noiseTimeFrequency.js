const WIND_SPEED_MPS = [0, 1, 2.45, 4.4, 6.7, 9.35, 12.3, 15.5, 18.95, 22.6, 26.4, 30.5, 35]
const RAIN_RATE_MM_H = [0, 0.25, 1, 2.5, 7.5, 20, 50]

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const level = (value, minimum, maximum, fallback) =>
  clamp(Math.round(finite(value, fallback)), minimum, maximum)

export function createDefaultNoiseScenario(windLevel = 4, shipLevel = 3, regionType = 'normal') {
  const wind = level(windLevel, 0, 12, 4)
  const ship = level(shipLevel, 1, 5, 3)
  return {
    durationS: 60,
    stepS: 0.5,
    timeAxis: 'relative',
    seed: 2026,
    windJitterPercent: 6,
    windControlPoints: [
      { timeS: 0, level: wind },
      { timeS: 20, level: clamp(wind + 1, 0, 12) },
      { timeS: 40, level: clamp(wind + 2, 0, 12) },
      { timeS: 60, level: wind },
    ],
    rainEvents: [
      { startS: 13.5, endS: 20, level: 3 },
      { startS: 38.5, endS: 49.5, level: 5 },
    ],
    shipEvents: [
      { startS: 24, endS: 36, level: ship, fundamentalHz: 81, harmonicCount: 4 },
    ],
    iceCrackEvents:
      regionType === 'ice'
        ? [9, 22, 37, 51].map((timeS) => ({ timeS, durationS: 1.5, level: 3 }))
        : [],
  }
}

export function validateNoiseScenario(input, regionType = 'normal') {
  const scenario = input && typeof input === 'object' ? input : {}
  const errors = []
  const duration = finite(scenario.durationS, 0)
  const step = finite(scenario.stepS, 0)
  if (!(duration >= 1 && duration <= 3600)) errors.push('仿真时长必须位于 1 到 3600 秒之间')
  if (!(step >= 0.05 && step <= 10)) errors.push('时间步长必须位于 0.05 到 10 秒之间')
  if (duration > 0 && step > 0 && Math.floor(duration / step) + 1 > 4000) {
    errors.push('时频图时间点数不能超过 4000，请增大时间步长')
  }
  if (!['relative', 'absolute'].includes(scenario.timeAxis)) errors.push('时间轴类型无效')

  const windPoints = Array.isArray(scenario.windControlPoints) ? scenario.windControlPoints : []
  if (!windPoints.length) errors.push('至少需要一个风速控制点')
  windPoints.forEach((point, index) => {
    const timeS = finite(point?.timeS, -1)
    const windLevel = finite(point?.level, -1)
    if (timeS < 0 || timeS > duration) errors.push(`风速控制点 ${index + 1} 超出仿真时间范围`)
    if (windLevel < 0 || windLevel > 12) errors.push(`风速控制点 ${index + 1} 的风级必须位于 0 到 12`)
  })

  const validateIntervals = (items, label, minimumLevel, maximumLevel) => {
    const values = Array.isArray(items) ? items : []
    if (values.length > 30) errors.push(`${label}不能超过 30 个`)
    values.forEach((event, index) => {
      const start = finite(event?.startS, -1)
      const end = finite(event?.endS, -1)
      const eventLevel = finite(event?.level, -1)
      if (start < 0 || end <= start || end > duration) {
        errors.push(`${label} ${index + 1} 的时间区间无效`)
      }
      if (eventLevel < minimumLevel || eventLevel > maximumLevel) {
        errors.push(`${label} ${index + 1} 的等级必须位于 ${minimumLevel} 到 ${maximumLevel}`)
      }
    })
  }
  validateIntervals(scenario.rainEvents, '降雨事件', 0, 6)
  validateIntervals(scenario.shipEvents, '船舶事件', 1, 5)

  if (regionType === 'ice') {
    const cracks = Array.isArray(scenario.iceCrackEvents) ? scenario.iceCrackEvents : []
    if (cracks.length > 50) errors.push('冰裂事件不能超过 50 个')
    cracks.forEach((event, index) => {
      const timeS = finite(event?.timeS, -1)
      const durationS = finite(event?.durationS, 0)
      const crackLevel = finite(event?.level, -1)
      if (timeS < 0 || timeS > duration) errors.push(`冰裂事件 ${index + 1} 超出仿真时间范围`)
      if (!(durationS > 0 && durationS <= duration)) errors.push(`冰裂事件 ${index + 1} 的持续时间无效`)
      if (crackLevel < 1 || crackLevel > 5) errors.push(`冰裂事件 ${index + 1} 的等级必须位于 1 到 5`)
    })
  }
  return errors
}

function mulberry32(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function interpolateControlPoints(timeS, inputPoints, fallbackLevel) {
  const points = (Array.isArray(inputPoints) ? inputPoints : [])
    .map((point) => ({
      timeS: finite(point?.timeS, 0),
      level: level(point?.level, 0, 12, fallbackLevel),
    }))
    .sort((left, right) => left.timeS - right.timeS)
  if (!points.length) return fallbackLevel
  if (timeS <= points[0].timeS) return points[0].level
  if (timeS >= points[points.length - 1].timeS) return points[points.length - 1].level
  for (let index = 1; index < points.length; index += 1) {
    if (timeS <= points[index].timeS) {
      const previous = points[index - 1]
      const current = points[index]
      const span = Math.max(1e-9, current.timeS - previous.timeS)
      const ratio = (timeS - previous.timeS) / span
      return previous.level + ratio * (current.level - previous.level)
    }
  }
  return points[points.length - 1].level
}

function raisedCosineWindow(timeS, startS, endS, edgeS) {
  if (timeS < startS || timeS > endS) return 0
  const duration = Math.max(1e-9, endS - startS)
  const edge = clamp(edgeS, 1e-6, duration / 2)
  if (timeS < startS + edge) return 0.5 - 0.5 * Math.cos(Math.PI * (timeS - startS) / edge)
  if (timeS > endS - edge) return 0.5 - 0.5 * Math.cos(Math.PI * (endS - timeS) / edge)
  return 1
}

function dbPower(valueDb) {
  return 10 ** (valueDb / 10)
}

function wenzBasePower(freqHz, windSpeedMps) {
  const khz = Math.max(freqHz / 1000, 0.001)
  const turbulence = 17 - 30 * Math.log10(khz)
  const thermal = -15 + 20 * Math.log10(khz)
  const wind = 50 + 7.5 * Math.sqrt(Math.max(0, windSpeedMps)) + 20 * Math.log10(khz) - 40 * Math.log10(khz + 0.4)
  return dbPower(turbulence) + dbPower(thermal) + dbPower(wind)
}

function rainPower(freqHz, rainLevel) {
  const selected = level(rainLevel, 0, 6, 0)
  if (selected <= 0) return 0
  const rate = RAIN_RATE_MM_H[selected]
  const levelAt5k = 50 + 17 * Math.log10(rate)
  const peakFrequency = 13500
  const peakLevel = levelAt5k + 15 * Math.log2(peakFrequency / 5000)
  const valueDb =
    freqHz < peakFrequency
      ? levelAt5k + 15 * Math.log2(Math.max(freqHz, 1) / 5000)
      : peakLevel - 7 * Math.log2(freqHz / peakFrequency)
  return dbPower(valueDb)
}

function shippingPower(freqHz, shipLevel, fundamentalHz, harmonicCount, envelope) {
  const khz = Math.max(freqHz / 1000, 0.001)
  const shippingFactor = (level(shipLevel, 1, 5, 3) - 1) / 4
  const broadbandDb =
    40 + 20 * (shippingFactor - 0.5) + 26 * Math.log10(khz) - 60 * Math.log10(khz + 0.03)
  let power = dbPower(broadbandDb) * envelope
  const baseFrequency = clamp(finite(fundamentalHz, 81), 1, 5000)
  const count = level(harmonicCount, 0, 12, 4)
  for (let order = 1; order <= count; order += 1) {
    const center = baseFrequency * order
    const width = Math.max(1.2, center * 0.015)
    const harmonicDb = broadbandDb + Math.max(2, 16 - 3 * order)
    power += dbPower(harmonicDb) * envelope * Math.exp(-0.5 * ((freqHz - center) / width) ** 2)
  }
  return power
}

function crackPower(freqHz, event, timeS) {
  const center = finite(event?.timeS, 0)
  const duration = Math.max(0.05, finite(event?.durationS, 1.5))
  const strength = level(event?.level, 1, 5, 3)
  const sigma = Math.max(0.05, duration / 2.355)
  const envelope = Math.exp(-0.5 * ((timeS - center) / sigma) ** 2)
  const spectrumDb = 48 + 5 * (strength - 1) + 10 * Math.log10((300 / Math.max(freqHz, 20)) ** 0.35)
  return dbPower(spectrumDb) * envelope
}

function timeLabel(timeS, timeAxis, queryTime, every) {
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

export function buildNoiseTimeFrequency({ scenario: input, variant = 'normal', maxFreq = 1000, queryTime = '', fallbackWindLevel = 4 } = {}) {
  const fallback = createDefaultNoiseScenario(fallbackWindLevel, 3, variant)
  const scenario = input && typeof input === 'object' ? input : fallback
  const durationS = clamp(finite(scenario.durationS, fallback.durationS), 1, 3600)
  const stepS = clamp(finite(scenario.stepS, fallback.stepS), 0.05, 10)
  const timeCount = Math.min(4000, Math.floor(durationS / stepS) + 1)
  const times = Array.from({ length: timeCount }, (_, index) => Math.min(durationS, index * stepS))
  if (times[times.length - 1] < durationS - 1e-9 && times.length < 4000) times.push(durationS)

  const frequencyMinimum = 20
  // 与环境噪声接口的 100 kHz 参数上限保持一致；此前固定钳制到 1 kHz，
  // 会让用户设置的 2 kHz 等频带在前端备用时频模型中被静默截断。
  const frequencyMaximum = clamp(finite(maxFreq, 1000), 100, 100000)
  const frequencyCount = 80
  const frequencyStep = (frequencyMaximum / frequencyMinimum) ** (1 / (frequencyCount - 1))
  const freqs = Array.from({ length: frequencyCount }, (_, index) => frequencyMinimum * frequencyStep ** index)
  const rng = mulberry32(Math.round(finite(scenario.seed, 2026)))
  const jitterPercent = clamp(finite(scenario.windJitterPercent, 0), 0, 50) / 100
  const windJitter = []
  let smoothNoise = 0
  for (let index = 0; index < times.length; index += 1) {
    smoothNoise = 0.82 * smoothNoise + 0.18 * (rng() * 2 - 1)
    windJitter.push(smoothNoise)
  }

  const rainEvents = Array.isArray(scenario.rainEvents) ? scenario.rainEvents : []
  const shipEvents = Array.isArray(scenario.shipEvents) ? scenario.shipEvents : []
  const crackEvents = variant === 'ice' && Array.isArray(scenario.iceCrackEvents) ? scenario.iceCrackEvents : []
  const data = []
  let minDb = Infinity
  let maxDb = -Infinity
  const windLevels = []

  times.forEach((timeS, timeIndex) => {
    const windLevel = interpolateControlPoints(timeS, scenario.windControlPoints, fallbackWindLevel)
    const lowerLevel = Math.floor(windLevel)
    const upperLevel = Math.ceil(windLevel)
    const ratio = windLevel - lowerLevel
    const baseWindSpeed = WIND_SPEED_MPS[lowerLevel] * (1 - ratio) + WIND_SPEED_MPS[upperLevel] * ratio
    const windSpeed = Math.max(0, baseWindSpeed * (1 + jitterPercent * windJitter[timeIndex]))
    windLevels.push(windLevel)

    freqs.forEach((freqHz, frequencyIndex) => {
      let power = wenzBasePower(freqHz, windSpeed)
      rainEvents.forEach((event) => {
        const start = finite(event?.startS, 0)
        const end = finite(event?.endS, 0)
        const envelope = raisedCosineWindow(timeS, start, end, Math.max(stepS, (end - start) * 0.12))
        power += rainPower(freqHz, event?.level) * envelope
      })
      shipEvents.forEach((event) => {
        const start = finite(event?.startS, 0)
        const end = finite(event?.endS, 0)
        const envelope = raisedCosineWindow(timeS, start, end, Math.max(stepS, (end - start) * 0.2))
        power += shippingPower(freqHz, event?.level, event?.fundamentalHz, event?.harmonicCount, envelope)
      })
      crackEvents.forEach((event) => {
        power += crackPower(freqHz, event, timeS)
      })
      const valueDb = 10 * Math.log10(Math.max(power, 1e-14))
      minDb = Math.min(minDb, valueDb)
      maxDb = Math.max(maxDb, valueDb)
      data.push([timeIndex, frequencyIndex, Math.round(valueDb * 10) / 10])
    })
  })

  const labelEvery = durationS <= 120 ? 10 : durationS <= 600 ? 60 : 300
  const timeLabels = times.map((value) => timeLabel(value, scenario.timeAxis, queryTime, labelEvery))
  const displayTimes = times.map((value) => {
    if (scenario.timeAxis !== 'absolute') return `${Math.round(value * 10) / 10} s`
    const base = Date.parse(String(queryTime || '').replace(' ', 'T'))
    return Number.isFinite(base)
      ? new Date(base + value * 1000).toLocaleString('zh-CN', { hour12: false })
      : `${Math.round(value * 10) / 10} s`
  })
  const freqLabels = freqs.map(() => '')
  for (const target of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]) {
    if (target > frequencyMaximum * 1.02) continue
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

  return {
    durationS,
    timeAxis: scenario.timeAxis,
    times,
    displayTimes,
    freqs,
    timeLabels,
    freqLabels,
    data,
    minDb: Math.floor(minDb / 5) * 5,
    maxDb: Math.ceil(maxDb / 5) * 5,
    minFreq: frequencyMinimum,
    maxFreq: frequencyMaximum,
    windLevels,
    rainBands: rainEvents.map((event) => [finite(event?.startS, 0), finite(event?.endS, 0)]),
    shipBands: shipEvents.map((event) => [finite(event?.startS, 0), finite(event?.endS, 0)]),
    crackTimes: crackEvents.map((event) => finite(event?.timeS, 0)),
  }
}
