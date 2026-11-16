/**
 * 风 / 雨 / 海况地形表层覆盖层。
 *
 * 数据来自「天气与环境噪声」侧边栏的预报接口响应体（AnalyseForecastEnvironmentNoise），
 * 每个 frame.weather 里是单点的风（wind10_mps / wind_direction_deg）、
 * 雨（precipitation_mmh）、海况（wave_hs_m / wave_direction_deg）等标量。
 *
 * 覆盖层使用区域风 / 雨 / 海况网格（按上游天气模型0.25°原生分辨率对齐），
 * 按原生网格单元直接着色，不做空间插值：
 *  - 静态贴纸（海面 0 m）：每个0.25°单元保持一个固定值与固定颜色；
 *  - 动态网格线（可选，需开启「动态显示」）：风为真实平流 + 渐隐拖尾轨迹、
 *    海况为浪峰线（法线沿浪向）；雨只显示静态色层，
 *    动态取值同样使用最近邻原生网格值，并贴在海面（0 m 深度）。
 * 图例（范围、单位、色带）随选中字段切换，颜色取同一套色标。
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** 三个物理字段的图例配置：范围、单位、刻度、色带、取值与方向来源。 */
export const WEATHER_OVERLAY_FIELDS = Object.freeze({
  wind: Object.freeze({
    key: 'wind',
    label: '风',
    unit: 'm/s',
    legendLabel: 'Wind 10 m (m/s)',
    range: [0, 40],
    ticks: [0, 5, 10, 15, 20, 30, 40],
    valueOf: (weather) => Number(weather?.wind10_mps),
    directionOf: (weather) => Number(weather?.wind_direction_deg),
    regionValue: 'wind_speed_mps',
    regionDirection: 'wind_direction_deg',
    colorStops: Object.freeze([
      [0, [20, 30, 120]],
      [0.25, [40, 90, 220]],
      [0.45, [30, 200, 200]],
      [0.6, [40, 210, 90]],
      [0.75, [240, 220, 40]],
      [0.9, [245, 90, 40]],
      [1, [150, 30, 90]],
    ]),
  }),
  rain: Object.freeze({
    key: 'rain',
    label: '雨',
    unit: 'mm/h',
    legendLabel: 'Rain (mm/h)',
    range: [0.1, 60],
    ticks: [0.1, 5, 15, 30, 60],
    valueOf: (weather) => Number(weather?.precipitation_mmh),
    directionOf: () => null,
    regionValue: 'rain_rate_mmh',
    regionDirection: null,
    colorStops: Object.freeze([
      [0, [70, 20, 150]],
      [0.35, [40, 60, 210]],
      [0.7, [20, 180, 220]],
      [1, [255, 220, 60]],
    ]),
  }),
  sea: Object.freeze({
    key: 'sea',
    label: '海况',
    unit: 'm',
    legendLabel: 'Sig. wave height (m)',
    range: [0, 10],
    ticks: [0, 1, 2, 4, 6, 10],
    valueOf: (weather) => Number(weather?.wave_hs_m),
    directionOf: (weather) => Number(weather?.wave_direction_deg),
    regionValue: 'wave_height_m',
    regionDirection: 'wave_direction_deg',
    colorStops: Object.freeze([
      [0, [10, 40, 120]],
      [0.3, [0, 160, 200]],
      [0.55, [0, 220, 120]],
      [0.75, [230, 230, 40]],
      [0.88, [255, 140, 30]],
      [1, [220, 50, 150]],
    ]),
  }),
})

/** 区域环境噪声伪彩图配置；数值范围按每次返回的区域网格自适应。 */
export const REGIONAL_NOISE_OVERLAY_FIELD = Object.freeze({
  key: 'noise',
  label: '区域预报噪声',
  unit: 'dB',
  legendLabel: '环境噪声频带级 (dB re 1 μPa²)',
  range: [40, 120],
  ticks: [40, 60, 80, 100, 120],
  regionValue: 'noise_level_db',
  regionDirection: null,
  colorStops: Object.freeze([
    [0, [40, 20, 110]],
    [0.2, [30, 70, 190]],
    [0.4, [15, 165, 210]],
    [0.6, [55, 205, 110]],
    [0.78, [245, 220, 55]],
    [0.9, [245, 115, 35]],
    [1, [175, 25, 55]],
  ]),
})

export const OCEAN_CURRENT_OVERLAY_FIELD = Object.freeze({
  key: 'ocean-current',
  label: '海流',
  unit: 'm/s',
  legendLabel: 'HYCOM 海流速度 (m/s)',
  range: [0, 2],
  ticks: [0, 0.5, 1, 1.5, 2],
  regionValue: 'current_speed_mps',
  regionDirection: 'current_direction_deg',
  colorStops: Object.freeze([
    [0, [20, 40, 120]],
    [0.25, [15, 115, 195]],
    [0.5, [20, 190, 180]],
    [0.7, [95, 210, 95]],
    [0.85, [245, 205, 55]],
    [1, [220, 75, 45]],
  ]),
})

/** 覆盖层是否应参与渲染：主开关打开且选中了某个物理字段。 */
export function weatherOverlayActive(state) {
  return !!(state?.terrainOverlay && state?.overlayField && state.overlayField !== 'off')
}

export function regionalNoiseOverlayActive(state) {
  return !!state?.regionalNoiseOverlay
}

export function oceanCurrentOverlayActive(state) {
  return !!state?.oceanCurrentOverlay
}

/** 从HYCOM u/v三维响应构造当前所选深度的速度与流向原生网格。 */
export function oceanCurrentRegional(current, depthSelection = 'all') {
  const data = current?.data
  const depths = current?.depths_m
  if (!current?.grid || !data || !Array.isArray(depths)) return null
  let u = data.depth_mean_u_mps
  let v = data.depth_mean_v_mps
  if (depthSelection !== 'all') {
    const requested = Number(depthSelection)
    const index = depths.findIndex(depth => Math.abs(Number(depth) - requested) < 1e-6)
    if (index < 0) return null
    u = data.u_mps?.[index]
    v = data.v_mps?.[index]
  }
  if (!Array.isArray(u) || !Array.isArray(v)) return null
  const speed = u.map((row, rowIndex) => row.map((value, column) => {
    const east = Number(value)
    const north = Number(v[rowIndex]?.[column])
    return Number.isFinite(east) && Number.isFinite(north) ? Math.hypot(east, north) : null
  }))
  const direction = u.map((row, rowIndex) => row.map((value, column) => {
    const east = Number(value)
    const north = Number(v[rowIndex]?.[column])
    if (!Number.isFinite(east) || !Number.isFinite(north)) return null
    return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360
  }))
  return {
    ...current,
    data: {
      ...data,
      current_speed_mps: speed,
      current_direction_deg: direction,
    },
  }
}

/** 当前选中的物理字段配置；off / 未选择时返回 null。 */
export function currentOverlayField(state) {
  const key = state?.overlayField
  return key && key !== 'off' ? WEATHER_OVERLAY_FIELDS[key] : null
}

/** 侧边栏色标条使用的 CSS 渐变。 */
export function overlayGradient(field) {
  if (!field) return ''
  const stops = field.colorStops
    .map(([t, rgb]) => `rgb(${rgb.join(',')}) ${(t * 100).toFixed(1)}%`)
    .join(', ')
  return `linear-gradient(90deg, ${stops})`
}

/** 色带取值（t∈[0,1] → [r,g,b]），用于粒子着色。 */
function colorAt(field, ratio) {
  const stops = field.colorStops
  const t = clamp(ratio, 0, 1)
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]
    const [z, cz] = stops[i + 1]
    if (t > z && i < stops.length - 2) continue
    const q = clamp((t - a) / Math.max(1e-6, z - a), 0, 1)
    return ca.map((v, channel) => Math.round(v + (cz[channel] - v) * q))
  }
  return stops[stops.length - 1][1]
}

/** 确定性伪随机：让粒子布局在每次重绘时保持稳定，不随帧跳动。 */
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let cachedParticles = []
let cachedBoundsKey = ''

function particlesFor(bounds, count = 150) {
  const key = `${bounds.west},${bounds.east},${bounds.south},${bounds.north}`
  if (cachedParticles.length && cachedBoundsKey === key) return cachedParticles
  const rand = mulberry32(13579)
  const list = []
  for (let i = 0; i < count; i++) {
    list.push({
      lon: bounds.west + rand() * (bounds.east - bounds.west),
      lat: bounds.south + rand() * (bounds.north - bounds.south),
      phase: rand(),
      speed: 0.35 + rand() * 0.65,
      length: 0.6 + rand() * 1.2,
    })
  }
  cachedParticles = list
  cachedBoundsKey = key
  return list
}

/** 真实平流粒子：位置随流场积分前进，拖尾记录最近若干历史位置。 */
const ADVECT_PARTICLE_COUNT = 120
const MAX_TRAIL_POINTS = 24
const MIN_PARTICLE_AGE_MS = 5000
const MAX_PARTICLE_AGE_MS = 11000
// 视觉时间加速：只影响粒子在屏幕上的运动速度，不改变色标与HYCOM数值。
// 海流量级通常比风速低一到两个数量级，使用风的倍率会近似静止。
const METERS_PER_DEGREE = 110574
const ADVECTION_TIME_WARP = 3000
const OCEAN_CURRENT_TIME_WARP = 60000

const advectStates = new Map()

function spawnAdvectParticle(bounds, rand) {
  const maxAgeMs = MIN_PARTICLE_AGE_MS + rand() * (MAX_PARTICLE_AGE_MS - MIN_PARTICLE_AGE_MS)
  return {
    lon: bounds.west + rand() * (bounds.east - bounds.west),
    lat: bounds.south + rand() * (bounds.north - bounds.south),
    ageMs: rand() * maxAgeMs,
    maxAgeMs,
    speed: 0,
    direction: NaN,
    trail: [],
  }
}

function ensureAdvectState(bounds, nowMs, layerKey) {
  const boundsKey = `${bounds.west},${bounds.east},${bounds.south},${bounds.north}`
  const cached = advectStates.get(layerKey)
  if (cached?.particles?.length && cached.boundsKey === boundsKey) return cached
  const seed = layerKey === 'ocean-current' ? 97531 : layerKey === 'sea' ? 86420 : 24680
  const rand = mulberry32(seed)
  const state = {
    particles: Array.from({ length: ADVECT_PARTICLE_COUNT }, () => spawnAdvectParticle(bounds, rand)),
    boundsKey,
    lastMs: nowMs,
  }
  advectStates.set(layerKey, state)
  return state
}

/** 在当前流场采样风速（m/s）与风向（°），返回经纬度/秒漂移向量。 */
function sampleFlowVelocity(sampler, lon, lat, timeWarp = ADVECTION_TIME_WARP) {
  const speed = sampleGridValue(sampler.values, sampler.longitudes, sampler.latitudes, lon, lat)
  if (!Number.isFinite(speed) || speed < 0) return null
  let direction = NaN
  if (sampler.dirs) {
    direction = sampleGridDirection(sampler.dirs, sampler.longitudes, sampler.latitudes, lon, lat)
  }
  if (!Number.isFinite(direction)) return { dLon: 0, dLat: 0, speed, direction: NaN }
  const { kLon, kLat } = bearingUnit(direction)
  const degPerSec = speed * timeWarp / METERS_PER_DEGREE
  return { dLon: kLon * degPerSec, dLat: kLat * degPerSec, speed, direction }
}

function stepAdvection(particles, sampler, bounds, dtSec, timeWarp = ADVECTION_TIME_WARP) {
  for (const particle of particles) {
    const velocity = sampleFlowVelocity(sampler, particle.lon, particle.lat, timeWarp)
    if (velocity) {
      particle.speed = velocity.speed
      particle.direction = velocity.direction
      particle.lon = wrap(particle.lon + velocity.dLon * dtSec, bounds.west, bounds.east)
      particle.lat = wrap(particle.lat + velocity.dLat * dtSec, bounds.south, bounds.north)
    }
    particle.trail.push({ lon: particle.lon, lat: particle.lat })
    if (particle.trail.length > MAX_TRAIL_POINTS) particle.trail.shift()
    particle.ageMs += dtSec * 1000
    if (particle.ageMs >= particle.maxAgeMs) {
      const next = spawnAdvectParticle(bounds, Math.random)
      particle.lon = next.lon
      particle.lat = next.lat
      particle.ageMs = next.ageMs
      particle.maxAgeMs = next.maxAgeMs
      particle.speed = next.speed
      particle.direction = next.direction
      particle.trail = next.trail
    }
  }
}

const wrap = (value, lo, hi) => {
  const span = Math.max(1e-6, hi - lo)
  return lo + ((((value - lo) % span) + span) % span)
}

function bearingUnit(directionDeg) {
  // 气象方位角：0=北，90=东；转成经纬度单位流向 (dLon, dLat)。
  const rad = (Number(directionDeg) || 0) * Math.PI / 180
  return { kLon: Math.sin(rad), kLat: Math.cos(rad) }
}

/** 后端无效数据哨兵值：≥ 该绝对值的量级均视为无数据（与 stationWeather 的 9999 口径一致）。 */
const INVALID_WEATHER_VALUE = 9999

/** 数值清洗：过滤 NaN/±Infinity、负值（风/雨/海况量级均非负）以及无效数据哨兵值。 */
const num = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return NaN
  if (number < 0 || Math.abs(number) >= INVALID_WEATHER_VALUE) return NaN
  return number
}

/** 取当前区域网格的实际最小/最大值，作为本次色标范围。 */
function fieldDataRange(values) {
  let min = Infinity
  let max = -Infinity
  for (const row of values) {
    if (!Array.isArray(row)) continue
    for (const value of row) {
      const number = num(value)
      if (Number.isFinite(number)) {
        if (number < min) min = number
        if (number > max) max = number
      }
    }
  }
  if (!Number.isFinite(min)) return null
  return { min, max }
}

function normalizeRange(value, range) {
  if (!range) return 0.5
  const span = range.max - range.min
  if (span > 1e-9) return clamp((value - range.min) / span, 0, 1)
  return 0.5
}

/** 把颜色向白色提亮，用于半透明浅色表层。 */
function lighten(rgb, amount) {
  return rgb.map(channel => Math.round(channel + (255 - channel) * amount))
}

/** 从区域天气响应中取出当前字段的原生网格样本（值 + 可选方向）。 */
function regionalSampler(regional, field) {
  const grid = regional?.grid
  const data = regional?.data
  const latitudes = grid?.latitudes
  const longitudes = grid?.longitudes
  if (!Array.isArray(latitudes) || latitudes.length < 2) return null
  if (!Array.isArray(longitudes) || longitudes.length < 2) return null
  const values = field?.regionValue ? data?.[field.regionValue] : null
  if (!Array.isArray(values) || !values.length) return null
  const directionField = field?.regionDirection
  const dirs = directionField && Array.isArray(data?.[directionField]) ? data[directionField] : null
  return { latitudes, longitudes, values, dirs }
}

/** 侧边栏图例使用的当前字段实际 min/max（来自区域网格，剔除无效数据）。 */
export function overlayFieldDataRange(field, regional) {
  const sampler = regionalSampler(regional, field)
  if (!sampler) return null
  return fieldDataRange(sampler.values)
}

function nearestAxisIndex(axis, target) {
  let nearest = 0
  let distance = Infinity
  for (let index = 0; index < axis.length; index++) {
    const nextDistance = Math.abs(Number(axis[index]) - target)
    if (nextDistance < distance) {
      distance = nextDistance
      nearest = index
    }
  }
  return nearest
}

/** 最近邻读取原生网格值，不在相邻0.25°网格点之间插值。 */
function sampleGridValue(values, longitudes, latitudes, lon, lat) {
  const column = nearestAxisIndex(longitudes, lon)
  const row = nearestAxisIndex(latitudes, lat)
  return num(values[row]?.[column])
}

/** 风向 / 浪向同样使用最近邻原生网格值。 */
function sampleGridDirection(values, longitudes, latitudes, lon, lat) {
  return sampleGridValue(values, longitudes, latitudes, lon, lat)
}

function axisCellEdges(axis) {
  const edges = [Number(axis[0]) + (Number(axis[0]) - Number(axis[1])) / 2]
  for (let index = 1; index < axis.length; index++) {
    edges.push((Number(axis[index - 1]) + Number(axis[index])) / 2)
  }
  const last = axis.length - 1
  edges.push(Number(axis[last]) + (Number(axis[last]) - Number(axis[last - 1])) / 2)
  return edges
}

/** 静态贴纸：每个0.25°原生网格单元使用一个固定值和固定颜色，不做插值。 */
function drawRegionalFill(ctx, scene, width, height, grid, field, sampler) {
  const bounds = grid?.bounds
  if (!bounds) return
  const dataRange = fieldDataRange(sampler.values)
  if (!dataRange) return
  const longitudeEdges = axisCellEdges(sampler.longitudes)
  const latitudeEdges = axisCellEdges(sampler.latitudes)
  for (let row = 0; row < sampler.latitudes.length; row++) {
    const north = Math.min(Number(bounds.north), latitudeEdges[row])
    const south = Math.max(Number(bounds.south), latitudeEdges[row + 1])
    if (!(north > south)) continue
    for (let column = 0; column < sampler.longitudes.length; column++) {
      const west = Math.max(Number(bounds.west), longitudeEdges[column])
      const east = Math.min(Number(bounds.east), longitudeEdges[column + 1])
      if (!(east > west)) continue
      const value = num(sampler.values[row]?.[column])
      if (!Number.isFinite(value)) continue
      const points = [
        scene.project(west, north, 0), scene.project(east, north, 0),
        scene.project(east, south, 0), scene.project(west, south, 0),
      ]
      if (!points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) continue
      if (points.every(point => point.x < 0) || points.every(point => point.x > width) ||
          points.every(point => point.y < 0) || points.every(point => point.y > height)) continue
      const ratio = normalizeRange(value, dataRange)
      const rgb = lighten(colorAt(field, ratio), 0.55)
      const color = `rgba(${rgb.join(',')},${(0.3 + 0.45 * ratio).toFixed(3)})`
      ctx.fillStyle = color
      ctx.beginPath()
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
      ctx.closePath()
      ctx.fill()
    }
  }
}

/** 雨：无流场方向，用相位驱动垂直下落短竖线。 */
function drawRainDrops(ctx, scene, width, height, grid, field, sampler, dataRange, rgba, elapsedMs) {
  const bounds = grid.bounds
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
  const particles = particlesFor(bounds)
  const time = (elapsedMs || 0) * 0.001
  const projectAt = (lon, lat) => scene.project(lon, lat, 0)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const particle of particles) {
    const raw = sampleGridValue(sampler.values, sampler.longitudes, sampler.latitudes, particle.lon, particle.lat)
    if (!Number.isFinite(raw)) continue
    const intensity = normalizeRange(raw, dataRange)
    if (intensity <= 0.005) continue
    const alpha = 0.3 + 0.7 * intensity
    const t = (particle.phase + time * 0.6 * particle.speed) % 1
    const lat = wrap(particle.lat + (1 - t) * 0.02 * span, bounds.south, bounds.north)
    const head = projectAt(particle.lon, lat)
    if (!head || ![head.x, head.y].every(Number.isFinite)) continue
    if (head.x < -30 || head.x > width + 30 || head.y < -30 || head.y > height + 30) continue
    const tail = projectAt(particle.lon, wrap(lat - 0.012 * span, bounds.south, bounds.north))
    if (!tail || ![tail.x, tail.y].every(Number.isFinite)) continue
    ctx.strokeStyle = rgba(lighten(colorAt(field, intensity), 0.25), alpha)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(tail.x, tail.y)
    ctx.lineTo(head.x, head.y)
    ctx.stroke()
  }
}

/** 风 / 海流 / 海况：粒子按流场真实平流；风和海流绘制拖尾，海况绘制浪峰线。 */
function drawAdvectedFlow(ctx, scene, width, height, grid, field, sampler, dataRange, rgba, elapsedMs) {
  const bounds = grid.bounds
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
  const isSea = field.key === 'sea'
  const nowMs = elapsedMs || 0
  const advectState = ensureAdvectState(bounds, nowMs, field.key)
  const particles = advectState.particles
  const dtSec = clamp((nowMs - advectState.lastMs) / 1000, 0, 0.05)
  advectState.lastMs = nowMs

  const timeWarp = field.key === 'ocean-current' ? OCEAN_CURRENT_TIME_WARP : ADVECTION_TIME_WARP
  if (dtSec > 0) stepAdvection(particles, sampler, bounds, dtSec, timeWarp)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const projectAt = (lon, lat) => scene.project(lon, lat, 0)

  for (const particle of particles) {
    const intensity = normalizeRange(particle.speed, dataRange)
    if (intensity <= 0.005) continue
    const alpha = 0.22 + 0.78 * intensity
    const lineRgb = lighten(colorAt(field, intensity), 0.25)

    const head = projectAt(particle.lon, particle.lat)
    if (!head || ![head.x, head.y].every(Number.isFinite)) continue
    if (head.x < -30 || head.x > width + 30 || head.y < -30 || head.y > height + 30) continue

    if (isSea) {
      if (!Number.isFinite(particle.direction)) continue
      // 生命周期淡入淡出（海面闪烁感）+ 浪峰长度/线宽随波高缩放。
      const lifeRatio = clamp(particle.ageMs / particle.maxAgeMs, 0, 1)
      const envelope = Math.min(1, lifeRatio * 5, (1 - lifeRatio) * 4)
      const crestHalf = span * (0.005 + intensity * 0.02)
      const waveAlpha = clamp(alpha * envelope, 0, 1)
      if (waveAlpha <= 0.01) continue
      const flow = bearingUnit(particle.direction)
      const perpLon = -flow.kLat
      const perpLat = flow.kLon
      const a = projectAt(particle.lon + perpLon * crestHalf, particle.lat + perpLat * crestHalf)
      const b = projectAt(particle.lon - perpLon * crestHalf, particle.lat - perpLat * crestHalf)
      if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      grad.addColorStop(0, rgba(lineRgb, waveAlpha * 0.22))
      grad.addColorStop(0.5, rgba(lineRgb, waveAlpha))
      grad.addColorStop(1, rgba(lineRgb, waveAlpha * 0.22))
      ctx.strokeStyle = grad
      ctx.lineWidth = 0.8 + intensity * 1.1
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      continue
    }

    // 风：历史位置连成渐隐拖尾折线，尾部透明、头部最亮；按越界 wrap 处拆段，避免跨域长线。
    const trail = particle.trail
    if (!trail || trail.length < 2) continue
    const spanLon = bounds.east - bounds.west
    const spanLat = bounds.north - bounds.south
    const segments = []
    let current = [trail[0]]
    for (let index = 1; index < trail.length; index++) {
      const previous = trail[index - 1]
      const position = trail[index]
      const wrapped = Math.abs(position.lon - previous.lon) > spanLon * 0.5 ||
        Math.abs(position.lat - previous.lat) > spanLat * 0.5
      if (wrapped) {
        segments.push(current)
        current = [position]
      } else {
        current.push(position)
      }
    }
    segments.push(current)

    for (const segment of segments) {
      const points = []
      for (const position of segment) {
        const point = projectAt(position.lon, position.lat)
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point)
      }
      if (points.length < 2) continue
      const tailPoint = points[0]
      const headPoint = points[points.length - 1]
      const grad = ctx.createLinearGradient(tailPoint.x, tailPoint.y, headPoint.x, headPoint.y)
      grad.addColorStop(0, rgba(lineRgb, 0))
      grad.addColorStop(0.6, rgba(lineRgb, alpha * 0.45))
      grad.addColorStop(1, rgba(lineRgb, alpha))
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.4
      ctx.beginPath()
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
      ctx.stroke()
    }
  }
}

/** 动态网格线：雨为下落短竖线，风/海况按流场真实平流。 */
function drawRegionalFlow(ctx, scene, width, height, grid, field, sampler, elapsedMs) {
  const dataRange = fieldDataRange(sampler.values)
  if (!dataRange) return
  const rgba = (rgb, alpha) => `rgba(${rgb.join(',')},${alpha.toFixed(3)})`
  if (field.key === 'rain') {
    drawRainDrops(ctx, scene, width, height, grid, field, sampler, dataRange, rgba, elapsedMs)
  } else {
    drawAdvectedFlow(ctx, scene, width, height, grid, field, sampler, dataRange, rgba, elapsedMs)
  }
}

/**
 * 在已绘制的地形表面（Canvas 2D）上叠加区域风 / 雨 / 海况：
 * 先铺静态色标填充（贴纸），再按需叠加动态网格线（雨不绘制动态效果）。
 *
 * @param {HTMLCanvasElement} canvas 地形画布
 * @param {{project: Function, faces?: Array}} scene drawTerrainScene 的返回值
 * @param {object} grid 地形格网 { bounds, width, height, values }
 * @param {object} field WEATHER_OVERLAY_FIELDS 中的一项
 * @param {object} regional GetRegionalWeatherForecast 的响应体
 * @param {boolean} dynamic 是否绘制动态网格线
 * @param {number} elapsedMs 动画时钟（毫秒）
 */
export function drawWeatherOverlay(canvas, scene, grid, field, regional, dynamic, elapsedMs) {
  if (!canvas || !scene?.project || !grid || !field || !regional) return
  const sampler = regionalSampler(regional, field)
  if (!sampler) return

  const ctx = canvas.getContext('2d')
  const rect = canvas.getBoundingClientRect()
  const width = rect.width
  const height = rect.height
  if (!width || !height) return
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  drawRegionalFill(ctx, scene, width, height, grid, field, sampler)
  if (dynamic && field.key !== 'rain') {
    drawRegionalFlow(ctx, scene, width, height, grid, field, sampler, elapsedMs)
  }
}

/** 在海面 0 m 绘制区域环境噪声频带级伪彩图。 */
export function drawRegionalNoiseOverlay(canvas, scene, grid, regional) {
  drawWeatherOverlay(canvas, scene, grid, REGIONAL_NOISE_OVERLAY_FIELD, regional, false, 0)
}
