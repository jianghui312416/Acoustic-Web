function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function forecastNoiseSpectrum(result, frameIndex, point = {}) {
  const frequencies = Array.from(result?.frequency_hz || [], Number)
  const frames = Array.isArray(result?.frames) ? result.frames : []
  if (frequencies.length < 2 || !frames.length) throw new Error('环境噪声响应缺少有效频谱。')
  const index = Math.max(0, Math.min(frames.length - 1, Math.round(Number(frameIndex) || 0)))
  const frame = frames[index]
  const psd = Array.from(frame?.varying_components_db?.total || [], Number)
  if (psd.length !== frequencies.length || !psd.every(Number.isFinite)) {
    throw new Error('环境噪声响应中的总噪声谱无效。')
  }
  const lon = finiteNumber(point.lon ?? point.longitude)
  const lat = finiteNumber(point.lat ?? point.latitude)
  return {
    frequency_hz: frequencies,
    psd_db: psd,
    model: String(result?.model || 'Wenz/天气环境噪声'),
    query_time: String(frame?.time || ''),
    lon,
    lat,
  }
}

export async function loadPositionNoiseSpectra(points, options = {}) {
  const analyse = options.analyse
  if (typeof analyse !== 'function') throw new Error('缺少环境噪声计算函数。')
  const ais = options.ais
  const frameIndex = Number(options.frameIndex) || 0
  const maximumFrequency = Math.max(20, Math.min(100000, Number(options.maximumFrequency) || 24000))
  const concurrency = Math.max(1, Math.min(6, Math.round(Number(options.concurrency) || 4)))
  const normalized = Array.from(points || [], point => ({
    lon: finiteNumber(point?.lon ?? point?.longitude),
    lat: finiteNumber(point?.lat ?? point?.latitude),
  }))
  if (normalized.some(point => point.lon === null || point.lat === null)) {
    throw new Error('环境噪声位置包含无效经纬度。')
  }
  const cache = new Map()
  const unique = []
  normalized.forEach(point => {
    const key = `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`
    if (!cache.has(key)) {
      cache.set(key, null)
      unique.push({ ...point, key })
    }
  })
  let cursor = 0
  async function worker() {
    while (cursor < unique.length) {
      const item = unique[cursor]
      cursor += 1
      const result = await analyse({
        coordX: item.lon,
        coordY: item.lat,
        forecastHours: 48,
        minFreq: 10,
        maxFreq: maximumFrequency,
        numPoints: 512,
        ais,
      })
      cache.set(item.key, forecastNoiseSpectrum(result, frameIndex, item))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()))
  return normalized.map(point => cache.get(`${point.lon.toFixed(6)},${point.lat.toFixed(6)}`))
}

export function backendSpectrogramMatrix(payload) {
  const times = Array.from(payload?.time_s || [], Number)
  const frequencies = Array.from(payload?.frequency_hz || [], Number)
  const rows = Array.isArray(payload?.psd_db)
    ? payload.psd_db
    : Array.isArray(payload?.dbfs_per_hz) ? payload.dbfs_per_hz : []
  if (!times.length || !frequencies.length || rows.length !== frequencies.length) {
    return { times: [], frequencies: [], data: [], minDb: 0, maxDb: 1 }
  }
  const data = []
  const levels = []
  rows.forEach((row, frequencyIndex) => {
    if (!Array.isArray(row)) return
    row.forEach((value, timeIndex) => {
      const level = Number(value)
      if (!Number.isFinite(level) || timeIndex >= times.length) return
      data.push([timeIndex, frequencyIndex, level])
      levels.push(level)
    })
  })
  if (!levels.length) return { times: [], frequencies: [], data: [], minDb: 0, maxDb: 1 }
  return {
    times,
    frequencies,
    continuous: Boolean(payload?.continuous),
    data,
    minDb: Math.floor(levels.reduce((a, b) => Math.min(a, b), Infinity) / 5) * 5,
    maxDb: Math.ceil(levels.reduce((a, b) => Math.max(a, b), -Infinity) / 5) * 5,
  }
}

export function backendWaveformSeries(payload) {
  const rawTimes = Array.from(payload?.time_s || [], Number)
  const rawValues = Array.from(payload?.values || [], Number)
  const count = Math.min(rawTimes.length, rawValues.length)
  const times = []
  const values = []
  for (let index = 0; index < count; index += 1) {
    const time = rawTimes[index]
    const value = rawValues[index]
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue
    times.push(time)
    values.push(value)
  }
  return { times, values, ...(payload?.continuous ? { continuous: true } : {}) }
}

function repeatedWindowCycles(dataStart, dataEnd, currentTime, windowDuration, sampleStep = 0) {
  const period = Math.max(1e-9, dataEnd - dataStart + Math.max(0, sampleStep))
  const current = Math.max(0, Number(currentTime) || 0)
  const duration = Math.max(1e-6, Number(windowDuration) || 1)
  const windowStart = Math.max(0, current - duration)
  const windowEnd = windowStart + duration
  const firstCycle = Math.max(0, Math.floor((windowStart - dataEnd) / period))
  const lastCycle = Math.max(firstCycle, Math.ceil((current - dataStart) / period))
  return { period, current, duration, windowStart, windowEnd, firstCycle, lastCycle }
}

/**
 * 将后端一次性分析块按播放时间组成滚动显示窗。超过分析块时循环使用后端块，
 * 前端只做截取与坐标重排，不生成新的声学数据。
 */
export function rollingBackendWaveformSeries(series, currentTime, windowDuration) {
  const times = Array.from(series?.times || [], Number)
  const values = Array.from(series?.values || [], Number)
  const count = Math.min(times.length, values.length)
  if (count < 2) return { times: [], values: [], windowStartS: 0, windowEndS: Math.max(1e-6, Number(windowDuration) || 1) }
  const dataStart = times[0]
  const dataEnd = times[count - 1]
  const sampleStep = (dataEnd - dataStart) / Math.max(1, count - 1)
  const window = repeatedWindowCycles(dataStart, dataEnd, currentTime, windowDuration, sampleStep)
  if (series?.continuous) {
    const indices = times.map((t, i) => i).filter(i => times[i] >= window.windowStart && times[i] <= window.current)
    return { times: indices.map(i => times[i]), values: indices.map(i => values[i]),
      windowStartS: window.windowStart, windowEndS: window.windowEnd }
  }
  const output = []
  for (let cycle = window.firstCycle; cycle <= window.lastCycle; cycle += 1) {
    const offset = cycle * window.period
    for (let index = 0; index < count; index += 1) {
      const time = times[index] + offset
      if (time < window.windowStart - 1e-9 || time > window.current + 1e-9) continue
      output.push([time, values[index]])
    }
  }
  output.sort((left, right) => left[0] - right[0])
  return {
    times: output.map(item => item[0]),
    values: output.map(item => item[1]),
    windowStartS: window.windowStart,
    windowEndS: window.windowEnd,
  }
}

export function rollingBackendSpectrogramMatrix(matrix, currentTime, windowDuration) {
  const sourceTimes = Array.from(matrix?.times || [], Number)
  const frequencies = Array.from(matrix?.frequencies || [], Number)
  if (sourceTimes.length < 2 || !frequencies.length || !matrix?.data?.length) {
    return { times: [], frequencies, data: [], minDb: Number(matrix?.minDb) || 0, maxDb: Number(matrix?.maxDb) || 1 }
  }
  const dataStart = sourceTimes[0]
  const dataEnd = sourceTimes[sourceTimes.length - 1]
  const sampleStep = (dataEnd - dataStart) / Math.max(1, sourceTimes.length - 1)
  const window = repeatedWindowCycles(dataStart, dataEnd, currentTime, windowDuration, sampleStep)
  // 输出列数按“显示窗长 / 后端帧间隔”确定，避免把较短窗口稀疏映射到
  // 整个后端分析块宽度而产生规则透明竖列。
  const width = Math.max(2, Math.min(4096, Math.round(window.duration / Math.max(1e-9, sampleStep)) + 1))
  const times = Array.from({ length: width }, (_, index) => (
    window.windowStart + index / Math.max(1, width - 1) * window.duration
  ))
  // 后端为控制响应体积会把时频列抽取到最多 200 列。抽取后的时间轴可能由
  // 两种相邻步长交替组成，若再把原列四舍五入映射到等距画布，会发生两列
  // 撞到同一像素、另一像素无人填充的情况，表现为规则黑色竖线。这里改为
  // 逐个输出列反查最近的后端列，确保每个可见时间列都被完整填充。
  const sourceRows = Array.from(
    { length: sourceTimes.length },
    () => Array(frequencies.length).fill(null),
  )
  for (const entry of matrix.data) {
    const sourceTimeIndex = Number(entry?.[0])
    const frequencyIndex = Number(entry?.[1])
    const level = Number(entry?.[2])
    if (!Number.isInteger(sourceTimeIndex) || sourceTimeIndex < 0 || sourceTimeIndex >= sourceTimes.length) continue
    if (!Number.isInteger(frequencyIndex) || frequencyIndex < 0 || frequencyIndex >= frequencies.length) continue
    if (!Number.isFinite(level)) continue
    sourceRows[sourceTimeIndex][frequencyIndex] = level
  }

  function nearestSourceIndex(absoluteTime) {
    const phase = ((absoluteTime - dataStart) % window.period + window.period) % window.period
    const localTime = matrix.continuous ? absoluteTime : dataStart + phase
    if (localTime >= dataEnd) {
      return localTime - dataEnd <= dataStart + window.period - localTime
        ? sourceTimes.length - 1
        : 0
    }
    let lower = 0
    let upper = sourceTimes.length - 1
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2)
      if (sourceTimes[middle] <= localTime) lower = middle
      else upper = middle
    }
    return localTime - sourceTimes[lower] <= sourceTimes[upper] - localTime
      ? lower
      : upper
  }

  const data = []
  for (let timeIndex = 0; timeIndex < times.length; timeIndex += 1) {
    const time = times[timeIndex]
    if (time > window.current + 1e-9) continue
    if (matrix.continuous && (time < dataStart || time > dataEnd)) continue
    const row = sourceRows[nearestSourceIndex(time)]
    for (let frequencyIndex = 0; frequencyIndex < row.length; frequencyIndex += 1) {
      const level = row[frequencyIndex]
      if (Number.isFinite(level)) data.push([timeIndex, frequencyIndex, level])
    }
  }
  return {
    times,
    frequencies,
    data,
    minDb: Number(matrix.minDb),
    maxDb: Number(matrix.maxDb),
  }
}
