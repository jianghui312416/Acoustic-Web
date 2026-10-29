/**
 * bottomTypeModel.js
 * ==========================================
 * 航线海底底质类型（lithology_class_id）解析与分段。
 *
 * 数据来源：门户 `GetEnvDataRoute` 接口，`dataType = DT_ENV_GEOACOUSTIC_CLASSID`。
 * 响应（节选）：
 *   Response = {
 *     SamplingPoints: { size, x: [lon], y: [lat] },
 *     Depths: [...],
 *     ProfileData: { size, data: [{ size: 1, x: [0], y: [classId] }, ...] },
 *   }
 *
 * 约定：
 *   - classId > 0 视为有效底质类型，显示为「类型N」；
 *   - classId <= 0、null、NaN 或缺测视为未使用有效声学参数，显示为「默认」。
 *   - 返回的分段按距离（米）覆盖 [0, fallbackDistanceM]，相邻同类型合并。
 */

export const BOTTOM_TYPE_DATA_TYPE = 'DT_ENV_GEOACOUSTIC_CLASSID'
export const BOTTOM_ACOUSTIC_DATA_TYPES = Object.freeze({
  cp: 'DT_ENV_GEOACOUSTIC_CP',
  alphaP: 'DT_ENV_GEOACOUSTIC_ALPHA_P',
  density: 'DT_ENV_GEOACOUSTIC_DENSITY',
  porosity: 'DT_ENV_GEOACOUSTIC_POROSITY',
})

/** 类型编号配色（按编号循环）；「默认」固定为灰色。 */
const TYPE_COLORS = [
  '#8a6f52',
  '#9a7d5c',
  '#7c6a54',
  '#a5875e',
  '#6f5f51',
  '#9f7a4f',
  '#6e8077',
  '#a98f66',
  '#856b51',
  '#7d8c76',
  '#a1805c',
  '#6d5f4e',
  '#8e7f5f',
]

const DEFAULT_COLOR = '#7a7063'

const EARTH_RADIUS_M = 6371008.8

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6
}

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

/** 统一 class id：有效正数 → 四舍五入整数；其余 → 0（默认）。 */
export function normalizeBottomTypeId(value) {
  const n = toFiniteNumber(value)
  return n > 0 ? Math.round(n) : 0
}

/** 类型编号 → 展示文案。 */
export function bottomTypeLabel(value) {
  const id = normalizeBottomTypeId(value)
  return id > 0 ? `类型${id}` : '默认'
}

/** 类型编号 → 色块颜色。 */
export function bottomTypeColor(value) {
  const id = normalizeBottomTypeId(value)
  if (id <= 0) return DEFAULT_COLOR
  return TYPE_COLORS[(id - 1) % TYPE_COLORS.length]
}

const ACOUSTIC_FIELD_ALIASES = Object.freeze({
  cp: ['cp', 'Cp', 'compressionalSpeed', 'compressional_speed', 'soundSpeed', 'sound_speed'],
  alphaP: ['alphaP', 'Alpha_p', 'alpha_p', 'compressionalAttenuation', 'compressional_attenuation'],
  density: ['density', 'Density', 'rho', 'Rho'],
  porosity: ['porosity', 'Porosity'],
  thickness: ['thickness', 'Thickness', 'layerThickness', 'layer_thickness'],
})

/**
 * 统一底质声学参数字段。接口只返回类型编号时保留 null，界面明确显示「—」，
 * 避免用臆造的物性值替代真实数据；后端补充任一常见字段名后即可直接展示。
 */
export function bottomTypeAcousticProperties(value) {
  const source = value && typeof value === 'object'
    ? { ...value, ...(value.properties || {}), ...(value.acoustics || {}) }
    : {}
  const out = {}
  for (const [target, aliases] of Object.entries(ACOUSTIC_FIELD_ALIASES)) {
    let parsed = null
    for (const key of aliases) {
      const raw = Array.isArray(source[key]) ? source[key][0] : source[key]
      if (raw == null || raw === '') continue
      const number = Number(raw)
      if (Number.isFinite(number)) {
        parsed = number
        break
      }
    }
    out[target] = parsed
  }
  return out
}

function acousticSampleAt(payload, index) {
  const response = unwrapResponse(payload)
  const profile = response?.ProfileData?.data?.[index]
  const sampling = response?.SamplingPoints
  const sample = profile && typeof profile === 'object' ? { ...profile } : {}
  if (sampling && typeof sampling === 'object') {
    for (const aliases of Object.values(ACOUSTIC_FIELD_ALIASES)) {
      for (const key of aliases) {
        if (Array.isArray(sampling[key]) && sampling[key][index] != null) sample[key] = sampling[key][index]
      }
    }
  }
  return bottomTypeAcousticProperties(sample)
}

function sameAcoustics(a, b) {
  return ['cp', 'alphaP', 'density', 'porosity', 'thickness'].every((key) => (a?.[key] ?? null) === (b?.[key] ?? null))
}

/**
 * 球面目标点（罗盘方位：正北 0°、顺时针）。
 * @returns {{lon:number, lat:number}}
 */
export function destinationPoint(lonDeg, latDeg, bearingDeg, distanceM) {
  const angular = (Number(distanceM) || 0) / EARTH_RADIUS_M
  const bearing = ((Number(bearingDeg) || 0) * Math.PI) / 180
  const lon1 = ((Number(lonDeg) || 0) * Math.PI) / 180
  const lat1 = ((Number(latDeg) || 0) * Math.PI) / 180
  const sinLat2 =
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)))
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    )
  return {
    lon: ((lon2 * 180) / Math.PI + 540) % 360 - 180,
    lat: (lat2 * 180) / Math.PI,
  }
}

/** 两点间球面距离（米）。 */
export function distanceBetween(lon1, lat1, lon2, lat2) {
  const p1 = ((Number(lat1) || 0) * Math.PI) / 180
  const p2 = ((Number(lat2) || 0) * Math.PI) / 180
  const dLat = p2 - p1
  // 跨 180° 经线时取最短经度差，避免把折返点误当成绕地球一周。
  let dLonDeg = (Number(lon2) || 0) - (Number(lon1) || 0)
  dLonDeg = ((dLonDeg + 540) % 360) - 180
  const dLon = (dLonDeg * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}

/**
 * 生成从声源沿指定罗盘方位、总距离 distanceM 的等距航线点（含首尾）。
 * 返回结构直接用于 GetEnvDataRoute 的 `points: [{x: lon, y: lat}]`。
 */
export function buildRoutePoints(lonDeg, latDeg, bearingDeg, distanceM, count = 180) {
  const n = Math.max(2, Math.round(Number(count) || 180))
  const total = Math.max(0, Number(distanceM) || 0)
  const points = []
  for (let i = 0; i < n; i++) {
    const distance = (total * i) / (n - 1)
    const point = destinationPoint(lonDeg, latDeg, bearingDeg, distance)
    points.push({ x: round6(point.lon), y: round6(point.lat) })
  }
  return points
}

/** 从完整门户响应或 Response 对象中取业务响应体。 */
function unwrapResponse(payload) {
  if (!payload || typeof payload !== 'object') return null
  const units = payload?.Data?.Units
  if (Array.isArray(units) && units.length) {
    const unit =
      units.find((item) => /GetEnvDataRoute/i.test(String(item?.Plugin || ''))) || units[0]
    return unit?.Response ?? null
  }
  if (payload.Response && typeof payload.Response === 'object') return payload.Response
  return payload
}

/** 取数组中第一个有限数值，用于兼容标量 / 单元素数组。 */
function firstFinite(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const n = toFiniteNumber(item)
      if (Number.isFinite(n)) return n
    }
    return NaN
  }
  return toFiniteNumber(value)
}

const CLASS_ID_KEYS = [
  'lithology_class_id',
  'lithologyClassId',
  'classId',
  'class_id',
  'ClassId',
  'lithology',
]

/**
 * 从响应中提取每个航线点的 class id（未归一化，缺测为 NaN）。
 * 兼容：
 *   - SamplingPoints 上直接给出 class id 数组；
 *   - ProfileData.data[i].y 为长度 1 的数组（当前后端格式）；
 *   - 顶层 class id / data 数组。
 */
export function extractBottomTypeIds(payload) {
  const response = unwrapResponse(payload)
  if (!response) return []
  const sampling = response.SamplingPoints
  if (sampling && typeof sampling === 'object') {
    for (const key of CLASS_ID_KEYS) {
      if (Array.isArray(sampling[key])) return sampling[key].map(toFiniteNumber)
    }
  }
  const profiles = response?.ProfileData?.data
  if (Array.isArray(profiles)) {
    return profiles.map((profile) => {
      if (profile == null) return NaN
      if (Array.isArray(profile)) return firstFinite(profile)
      if (typeof profile !== 'object') return toFiniteNumber(profile)
      for (const key of CLASS_ID_KEYS) {
        if (key in profile) return firstFinite(profile[key])
      }
      if ('y' in profile) return firstFinite(profile.y)
      if ('value' in profile) return firstFinite(profile.value)
      return NaN
    })
  }
  for (const key of [...CLASS_ID_KEYS, 'values', 'data']) {
    const arr = response[key]
    if (Array.isArray(arr) && arr.every((item) => typeof item === 'number' || item == null)) {
      return arr.map(toFiniteNumber)
    }
  }
  return []
}

/** 从响应中提取航线采样点经纬度（可能为空）。 */
export function extractBottomTypePositions(payload) {
  const response = unwrapResponse(payload)
  const sampling = response?.SamplingPoints
  if (!sampling) return []
  const xs = Array.isArray(sampling.x) ? sampling.x : null
  const ys = Array.isArray(sampling.y) ? sampling.y : null
  if (!xs || !ys) return []
  const count = Math.min(xs.length, ys.length)
  const out = []
  for (let i = 0; i < count; i++) {
    const lon = toFiniteNumber(xs[i])
    const lat = toFiniteNumber(ys[i])
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ lon, lat })
  }
  return out
}

/**
 * 求每个 class id 对应的沿航线距离（米）。
 * 优先使用响应采样点位置；没有位置时按请求航线点 / 索引均分到总距离。
 */
function sampleDistances(positions, count, totalM) {
  if (count <= 0) return []
  const total = Math.max(0, Number(totalM) || 0)
  if (positions.length >= 2) {
    const cumulative = [0]
    for (let i = 1; i < positions.length; i++) {
      cumulative.push(
        cumulative[i - 1] +
          distanceBetween(
            positions[i - 1].lon,
            positions[i - 1].lat,
            positions[i].lon,
            positions[i].lat
          )
      )
    }
    const routeLength = cumulative[cumulative.length - 1]
    if (routeLength > 0) {
      if (positions.length === count) {
        return cumulative.map((d) => (d / routeLength) * (total || routeLength))
      }
      const out = []
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1)
        const target = t * routeLength
        let k = 1
        while (k < cumulative.length - 1 && cumulative[k] < target) k++
        const span = cumulative[k] - cumulative[k - 1]
        const local = span > 0 ? (target - cumulative[k - 1]) / span : 0
        const d = cumulative[k - 1] + local * span
        out.push((d / routeLength) * (total || routeLength))
      }
      return out
    }
  }
  if (count === 1) return [0]
  return Array.from({ length: count }, (_, i) => (total * i) / (count - 1))
}

/** 把逐点 class id 合并为连续分段。 */
function mergeSegments(segments) {
  const out = []
  for (const segment of segments) {
    if (!(segment.endM > segment.startM)) continue
    const previous = out[out.length - 1]
    if (previous && previous.id === segment.id && sameAcoustics(previous.acoustics, segment.acoustics)) {
      previous.endM = segment.endM
    } else {
      out.push({ ...segment })
    }
  }
  return out
}

/**
 * 将航线底质响应转换为沿距离的底质分段。
 *
 * @param {object|null} payload 完整门户响应或 Response
 * @param {object} [options]
 * @param {number} [options.fallbackDistanceM=0] 航线总距离（米）
 * @param {{x:number,y:number}[]} [options.routePoints] 请求航线点（响应无位置时使用）
 * @returns {{startM:number,endM:number,id:number,label:string}[]}
 */
export function buildBottomTypeSegments(payload, options = {}) {
  const totalM = Math.max(0, Number(options.fallbackDistanceM) || 0)
  if (!(totalM > 0)) return []

  const ids = extractBottomTypeIds(payload)
  const defaultSegment = () => [{ startM: 0, endM: totalM, id: 0, label: bottomTypeLabel(0) }]

  if (!ids.length) return defaultSegment()

  const responsePositions = extractBottomTypePositions(payload)
  const routePoints = Array.isArray(options.routePoints) ? options.routePoints : []
  const positions = responsePositions.length
    ? responsePositions
    : routePoints.map((point) => ({ lon: Number(point?.x), lat: Number(point?.y) }))
  const distances = sampleDistances(positions, ids.length, totalM)

  const samples = []
  for (let i = 0; i < ids.length; i++) {
    const distance = Number(distances[i])
    if (!Number.isFinite(distance)) continue
    samples.push({
      distanceM: Math.max(0, Math.min(totalM, distance)),
      id: normalizeBottomTypeId(ids[i]),
      acoustics: acousticSampleAt(payload, i),
    })
  }
  if (!samples.length) return defaultSegment()
  samples.sort((a, b) => a.distanceM - b.distanceM)

  const segments = []
  if (samples[0].distanceM > 0) {
    segments.push({ startM: 0, endM: samples[0].distanceM, id: 0 })
  }
  // 采样点是离散的：用相邻采样点的中点作为类型切换边界，
  // 这样最后一个采样点（通常位于航线终点）也能覆盖到航线末端。
  for (let i = 0; i < samples.length; i++) {
    const startM =
      i === 0
        ? samples[i].distanceM
        : (samples[i - 1].distanceM + samples[i].distanceM) / 2
    const endM =
      i === samples.length - 1
        ? totalM
        : (samples[i].distanceM + samples[i + 1].distanceM) / 2
    if (endM > startM) segments.push({ startM, endM, id: samples[i].id, acoustics: samples[i].acoustics })
  }

  const merged = mergeSegments(segments)
  if (!merged.length) return defaultSegment()
  return merged.map((segment) => ({ ...segment, label: bottomTypeLabel(segment.id) }))
}

/** 把任一 GetEnvDataRoute 数值响应转换为带距离的位置采样。 */
export function buildRouteValueSamples(payload, options = {}) {
  const totalM = Math.max(0, Number(options.fallbackDistanceM) || 0)
  if (!(totalM > 0)) return []
  const values = extractBottomTypeIds(payload)
  if (!values.length) return []
  const responsePositions = extractBottomTypePositions(payload)
  const routePoints = Array.isArray(options.routePoints) ? options.routePoints : []
  const positions = responsePositions.length
    ? responsePositions
    : routePoints.map((point) => ({ lon: Number(point?.x), lat: Number(point?.y) }))
  const distances = sampleDistances(positions, values.length, totalM)
  const samples = []
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i])
    const distanceM = Number(distances[i])
    if (!Number.isFinite(value) || !Number.isFinite(distanceM)) continue
    samples.push({ distanceM: Math.max(0, Math.min(totalM, distanceM)), value })
  }
  return samples.sort((a, b) => a.distanceM - b.distanceM)
}

function routeValueAt(samples, distanceM) {
  if (!samples.length) return null
  const distance = Number(distanceM)
  if (distance <= samples[0].distanceM) return samples[0].value
  const last = samples[samples.length - 1]
  if (distance >= last.distanceM) return last.value
  let upperIndex = 1
  while (upperIndex < samples.length - 1 && samples[upperIndex].distanceM < distance) upperIndex++
  const lower = samples[upperIndex - 1]
  const upper = samples[upperIndex]
  const span = upper.distanceM - lower.distanceM
  if (!(span > 0)) return lower.value
  const ratio = (distance - lower.distanceM) / span
  return lower.value + (upper.value - lower.value) * ratio
}

/** 将四类真实声学参数按分段中点插值并合并到底质分段。 */
export function enrichBottomTypeSegments(segments, propertyPayloads = {}, options = {}) {
  const source = Array.isArray(segments) ? segments : []
  const samplesByField = Object.fromEntries(
    Object.keys(BOTTOM_ACOUSTIC_DATA_TYPES).map((field) => [
      field,
      buildRouteValueSamples(propertyPayloads[field], options),
    ])
  )
  return source.map((segment) => {
    const midpointM = (Number(segment.startM) + Number(segment.endM)) / 2
    const acoustics = { ...bottomTypeAcousticProperties(segment) }
    for (const field of Object.keys(BOTTOM_ACOUSTIC_DATA_TYPES)) {
      const value = routeValueAt(samplesByField[field], midpointM)
      if (Number.isFinite(value)) acoustics[field] = value
    }
    return { ...segment, acoustics }
  })
}
