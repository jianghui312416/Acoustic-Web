/**
 * 风 / 雨 / 海况地形表层覆盖层。
 *
 * 数据来自「天气与环境噪音」侧边栏的预报接口响应体（AnalyseForecastEnvironmentNoise），
 * 每个 frame.weather 里是单点的风（wind10_mps / wind_direction_deg）、
 * 雨（precipitation_mmh）、海况（wave_hs_m / wave_direction_deg）等标量。
 *
 * 覆盖层把单点预报值作为「场强度」，驱动分布在区域地形表面的一组稳定粒子：
 *  - 风 / 海况：沿流向（风向 / 浪向）推进的短划线（streamline / swell crests）；
 *  - 雨：垂直方向的短竖线，随降雨强度提升密度与亮度。
 * 图例（范围、单位、色带）随选中字段切换，颜色取粒子着色所需的同一条色带。
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

/** 覆盖层是否应参与渲染：主开关打开且选中了某个物理字段。 */
export function weatherOverlayActive(state) {
  return !!(state?.terrainOverlay && state?.overlayField && state.overlayField !== 'off')
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

function sampleElevation(grid, lon, lat) {
  const b = grid.bounds
  const w = grid.width
  const h = grid.height
  const col = clamp(Math.round((lon - b.west) / Math.max(1e-6, b.east - b.west) * (w - 1)), 0, w - 1)
  const row = clamp(Math.round((b.north - lat) / Math.max(1e-6, b.north - b.south) * (h - 1)), 0, h - 1)
  const value = grid.values[row * w + col]
  return Number.isFinite(value) ? value : 0
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

/**
 * 在已绘制的地形表面（Canvas 2D）上叠加当前字段的动态粒子。
 *
 * @param {HTMLCanvasElement} canvas 地形画布
 * @param {{project: Function}} scene drawTerrainScene 的返回值（含 project 投影函数）
 * @param {object} grid 地形格网 { bounds, width, height, values }
 * @param {object} field WEATHER_OVERLAY_FIELDS 中的一项
 * @param {object} weather 当前预报帧的 weather 字段
 * @param {number} elapsedMs 动画时钟（毫秒）
 */
export function drawWeatherOverlay(canvas, scene, grid, field, weather, elapsedMs) {
  if (!canvas || !scene?.project || !grid || !field || !weather) return
  const project = scene.project
  const raw = field.valueOf(weather)
  if (!Number.isFinite(raw)) return

  const [min, max] = field.range
  const intensity = clamp((raw - min) / Math.max(1e-6, max - min), 0, 1)
  if (intensity <= 0.005) return

  const ctx = canvas.getContext('2d')
  const rect = canvas.getBoundingClientRect()
  const width = rect.width
  const height = rect.height
  if (!width || !height) return
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const bounds = grid.bounds
  const particles = particlesFor(bounds)
  const visibleCount = Math.round(particles.length * (0.12 + intensity * 0.88))
  const direction = field.directionOf(weather)
  const flow = Number.isFinite(direction) ? bearingUnit(direction) : null
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
  const cell = span * 0.3
  const time = (elapsedMs || 0) * 0.001
  const color = colorAt(field, clamp(intensity, 0, 1))
  const isRain = field.key === 'rain'

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let i = 0; i < visibleCount; i++) {
    const p = particles[i]
    let lon = p.lon
    let lat = p.lat

    if (flow) {
      const t = (p.phase + time * 0.12 * p.speed) % 1
      const offset = t * cell
      lon = wrap(p.lon + flow.kLon * offset, bounds.west, bounds.east)
      lat = wrap(p.lat + flow.kLat * offset, bounds.south, bounds.north)
    } else {
      // 雨：垂直滴水，用相位制造下落/闪烁感
      const t = (p.phase + time * 0.6 * p.speed) % 1
      lat = wrap(p.lat + (1 - t) * 0.02 * span, bounds.south, bounds.north)
    }

    const elevHere = sampleElevation(grid, lon, lat)
    const head = project(lon, lat, elevHere + 8)
    if (!head || ![head.x, head.y].every(Number.isFinite)) continue
    if (head.x < -30 || head.x > width + 30 || head.y < -30 || head.y > height + 30) continue

    let tail
    if (flow) {
      const tailLon = lon - flow.kLon * span * 0.012 * p.length
      const tailLat = lat - flow.kLat * span * 0.012 * p.length
      tail = project(tailLon, tailLat, sampleElevation(grid, tailLon, tailLat) + 8)
    } else {
      tail = project(lon, wrap(lat - 0.012 * span, bounds.south, bounds.north), elevHere + 8)
    }
    if (!tail || ![tail.x, tail.y].every(Number.isFinite)) continue

    const flicker = 0.55 + 0.45 * ((time * 1.7 + p.phase) % 1)
    const alpha = (0.2 + 0.8 * intensity) * flicker
    ctx.strokeStyle = isRain
      ? `rgba(190,225,255,${alpha.toFixed(3)})`
      : `rgba(${color.join(',')},${alpha.toFixed(3)})`
    ctx.lineWidth = isRain ? 1.2 : 1.6
    ctx.beginPath()
    ctx.moveTo(tail.x, tail.y)
    ctx.lineTo(head.x, head.y)
    ctx.stroke()
  }
}