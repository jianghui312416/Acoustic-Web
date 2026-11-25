const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

/**
 * 光照参数：方位 254° / 高度 45° 的西偏南低角度光，能突出山脊与沟谷。
 * ambient + diffuse * illumination 的上下限控制背光面与迎光面的明暗差。
 */
export const terrainLighting = Object.freeze({
  enabled: true,
  hillshadeIntensity: .8,
  hillshadeAzimuth: 254,
  hillshadeAltitude: 45,
  ambient: .34,
  diffuse: .92,
  minLight: .28,
  maxLight: 1.32,
})

// 由浅到深的水深色带：越深越接近近黑的青绿，浅水仍与陆地绿色区分。
export const WATER_COLOR_STOPS = Object.freeze([
  [0, [58, 132, 116]],
  [0.12, [44, 116, 104]],
  [0.28, [30, 96, 92]],
  [0.46, [20, 76, 78]],
  [0.66, [14, 58, 64]],
  [0.84, [10, 42, 50]],
  [1, [6, 28, 36]],
  // [0, [31, 111, 120]],
  // [1, [31, 111, 120]],
])

// 高程分层设色（hypsometric tint）：低地绿、丘陵黄绿、山地赭黄、峰顶灰白。
export const LAND_COLOR_STOPS = Object.freeze([
  [0, [62, 122, 70]],
  [0.16, [82, 138, 62]],
  [0.34, [116, 154, 58]],
  [0.5, [158, 166, 60]],
  [0.66, [192, 172, 72]],
  [0.8, [200, 152, 82]],
  [0.9, [200, 170, 132]],
  [1, [240, 240, 228]],
  // [0, [31, 111, 120]],
  // [1, [31, 111, 120]],
])

export function sampleColorStops(t, stops) {
  const value = clamp(Number(t) || 0, 0, 1)
  for (let index = 0; index < stops.length - 1; index++) {
    const [startAt, startColor] = stops[index]
    const [endAt, endColor] = stops[index + 1]
    if (value > endAt) continue
    const local = (value - startAt) / Math.max(1e-6, endAt - startAt)
    return startColor.map((channel, i) => Math.round(channel + (endColor[i] - channel) * local))
  }
  return [...stops[stops.length - 1][1]]
}

/** 自动选择“好看”的等高距：10 / 20 / 25 / 50 / 100 / 200 / 250 / 500 … 米。 */
export function pickBandStep(span, targetBands = 12) {
  const range = Math.abs(Number(span) || 0)
  if (!(range > 0)) return 0
  const target = Math.max(1, Math.round(Number(targetBands) || 12))
  const raw = range / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / power
  const nice = normalized <= 1 ? 1
    : normalized <= 2 ? 2
      : normalized <= 2.5 ? 2.5
        : normalized <= 5 ? 5 : 10
  return nice * power
}

/**
 * 高程/水深取色。step > 0 时按固定等高距量化，得到分层设色的硬边；
 * step = 0 时返回连续渐变，用于缩略图与图例。
 */
export function terrainColorAt(height, min = -8000, max = 0, options = {}) {
  const value = Number(height)
  if (!Number.isFinite(value)) return [0, 0, 0]
  if (value > 0) {
    const landMax = Math.max(1, Number(max) > 0 ? Number(max) : 1)
    let t = clamp(value / landMax, 0, 1)
    const step = Number(options.landBand) || 0
    if (step > 0) t = clamp(Math.floor(value / step) * step / landMax, 0, 1)
    return sampleColorStops(t, LAND_COLOR_STOPS)
  }
  const depthMax = Math.max(1, -Math.min(0, Number(min) || 0))
  let t = clamp(-value / depthMax, 0, 1)
  const step = Number(options.waterBand) || 0
  if (step > 0) t = clamp(Math.floor(-value / step) * step / depthMax, 0, 1)
  return sampleColorStops(t, WATER_COLOR_STOPS)
}
export function normalizeExaggeration(value) {
  return clamp(Number.isFinite(Number(value)) ? Number(value) : 3, 0.5, 50)
}

// Screen-space subdivision, bounded by the original raster and a fixed face budget.
// Exaggeration deliberately does not select a new mesh; only zoom/viewport does.
export const TERRAIN_MAX_MESH_SEGMENTS = 384
export function terrainSegments(size, zoom = 1, subdivisionThreshold = .75, maxSegments = TERRAIN_MAX_MESH_SEGMENTS) {
  const pixels = Math.min(size.width * .72, size.height * 1.2) * zoom
  const cap = clamp(Number(maxSegments) || TERRAIN_MAX_MESH_SEGMENTS, 32, TERRAIN_MAX_MESH_SEGMENTS)
  return clamp(
    2 ** Math.ceil(Math.log2(Math.max(1, pixels / (12 * subdivisionThreshold)))),
    32,
    cap
  )
}

const seaMasks = new WeakMap()

/**
 * 用连通域判别外海，而不是简单用“高程 > 0”判陆。
 * 真实 DEM 海面带有 ±0.x m 噪声，阈值法会在海上留下一圈假岛屿；
 * 从四周边界对 h ≤ 0 的像元做洪水填充，再把面积过小的陆块并回外海，
 * 海岸线才不会被逐像元噪声切碎。
 */
export function terrainSeaMask(grid) {
  const cached = seaMasks.get(grid)
  if (cached) return cached
  const { width, height, values } = grid
  const total = width * height
  const sea = new Uint8Array(total)
  const queue = new Int32Array(total)
  let tail = 0
  const seed = (index) => {
    if (sea[index] || !(values[index] <= .5)) return
    sea[index] = 1
    queue[tail++] = index
  }
  for (let col = 0; col < width; col++) {
    seed(col)
    seed((height - 1) * width + col)
  }
  for (let row = 1; row < height - 1; row++) {
    seed(row * width)
    seed(row * width + width - 1)
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head]
    const row = Math.floor(index / width)
    const col = index - row * width
    if (row > 0) seed(index - width)
    if (row < height - 1) seed(index + width)
    if (col > 0) seed(index - 1)
    if (col < width - 1) seed(index + 1)
  }
  // 面积很小的“陆块”多半是海面噪声；并回外海，避免生成碎线海岸。
  const minLand = Math.max(4, Math.round(total * .0002))
  const visited = new Uint8Array(total)
  const component = new Int32Array(total)
  for (let start = 0; start < total; start++) {
    if (sea[start] || visited[start]) continue
    let count = 0
    let head = 0
    visited[start] = 1
    queue[head++] = start
    while (head > 0) {
      const index = queue[--head]
      component[count++] = index
      const row = Math.floor(index / width)
      const col = index - row * width
      const neighbors = [
        row > 0 ? index - width : -1,
        row < height - 1 ? index + width : -1,
        col > 0 ? index - 1 : -1,
        col < width - 1 ? index + 1 : -1,
      ]
      for (const next of neighbors) {
        if (next < 0 || sea[next] || visited[next]) continue
        visited[next] = 1
        queue[head++] = next
      }
    }
    if (count < minLand) {
      for (let index = 0; index < count; index++) sea[component[index]] = 1
    }
  }
  seaMasks.set(grid, sea)
  return sea
}

const meshes = new WeakMap()
export function terrainMesh(grid, segments) {
  let levels = meshes.get(grid)
  if (!levels) { levels = new Map(); meshes.set(grid, levels) }
  const cols = Math.min(grid.width - 1, segments), rows = Math.min(grid.height - 1, segments)
  const key = `${cols}:${rows}`
  if (levels.has(key)) return levels.get(key)
  const b = grid.bounds
  const dx = (b.east - b.west) * 111320 * Math.cos((b.north + b.south) * Math.PI / 360) / (grid.width - 1)
  const dy = (b.north - b.south) * 110574 / (grid.height - 1)
  // Display-only bilinear sampling removes the stair-stepping of nearest
  // neighbour resampling without changing the underlying bathymetry values.
  const sample = (row, col) => {
    const r0 = Math.floor(row), c0 = Math.floor(col)
    const r1 = Math.min(grid.height - 1, r0 + 1), c1 = Math.min(grid.width - 1, c0 + 1)
    const fr = row - r0, fc = col - c0
    let sum = 0, total = 0
    for (const [index, weight] of [
      [r0 * grid.width + c0, (1 - fr) * (1 - fc)],
      [r0 * grid.width + c1, (1 - fr) * fc],
      [r1 * grid.width + c0, fr * (1 - fc)],
      [r1 * grid.width + c1, fr * fc],
    ]) {
      if (!(weight > 0)) continue
      const value = grid.values[index]
      if (!Number.isFinite(value)) return NaN
      sum += value * weight
      total += weight
    }
    return total > 0 ? sum / total : NaN
  }
  const seaMask = terrainSeaMask(grid)
  const vertices = []
  for (let r = 0; r <= rows; r++) {
    const row = r / rows * (grid.height - 1)
    for (let c = 0; c <= cols; c++) {
      const col = c / cols * (grid.width - 1)
      const elevation = sample(row, col)
      const left = Math.max(0, col - 1), right = Math.min(grid.width - 1, col + 1)
      const north = Math.max(0, row - 1), south = Math.min(grid.height - 1, row + 1)
      const value = (rr, cc) => {
        const result = sample(rr, cc)
        return Number.isFinite(result) ? result : elevation
      }
      const seaRow = clamp(Math.round(row), 0, grid.height - 1)
      const seaCol = clamp(Math.round(col), 0, grid.width - 1)
      vertices.push({
        lon: b.west + col / (grid.width - 1) * (b.east - b.west),
        lat: b.north - row / (grid.height - 1) * (b.north - b.south), elevation,
        slopeX: (value(row, right) - value(row, left)) / Math.max(1, (right - left) * dx),
        slopeY: (value(north, col) - value(south, col)) / Math.max(1, (south - north) * dy),
        sea: seaMask[seaRow * grid.width + seaCol] === 1,
      })
    }
  }
  const faces = []
  const cells = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * (cols + 1) + c
    const face = [i, i + 1, i + cols + 2, i + cols + 1]
    if (face.every(index => Number.isFinite(vertices[index].elevation))) {
      const seaCorners = face.filter(index => vertices[index].sea).length
      faces.push(face)
      cells.push([r, c, seaCorners >= 2])
    }
  }
  const mesh = { vertices, faces, cells }
  levels.set(key, mesh)
  return mesh
}

/**
 * 面片在屏幕空间的高程变化率（米/像素），对应 GLSL 里的
 * `length(vec2(dFdx(h), dFdy(h)))`。Canvas 2D 没有逐像素导数，
 * 用投影后的两个三角形反解平面梯度来近似。
 */
export function screenHeightGradient(points, elevations) {
  if (!points || points.length < 4 || !elevations || elevations.length < 4) return 0
  const [a, b, c, d] = points
  const [ha, hb, hc, hd] = elevations
  const triangle = (p0, p1, p2, h0, h1, h2) => {
    const ax = p1.x - p0.x, ay = p1.y - p0.y
    const bx = p2.x - p0.x, by = p2.y - p0.y
    const det = ax * by - bx * ay
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return 0
    const dhdx = ((h1 - h0) * by - (h2 - h0) * ay) / det
    const dhdy = ((h2 - h0) * ax - (h1 - h0) * bx) / det
    return Math.hypot(dhdx, dhdy)
  }
  return (triangle(a, b, c, ha, hb, hc) + triangle(a, c, d, ha, hc, hd)) * .5
}

/**
 * 用屏幕空间梯度归一化等高线线宽：坡陡时变细，平缓时变粗，
 * 避免陡坡上的等高线糊成一片、平地上又细到看不见。
 */
export function contourLineWidth(step, gradient, options = {}) {
  const interval = Math.abs(Number(step) || 0)
  const baseWidth = Number.isFinite(Number(options.baseWidth)) ? Number(options.baseWidth) : .9
  if (!(interval > 0)) return baseWidth
  const grad = Math.max(Math.abs(Number(gradient) || 0), 1e-6)
  const targetSpacing = Math.max(1, Number(options.targetSpacingPx) || 26)
  const minWidth = Number.isFinite(Number(options.minWidth)) ? Number(options.minWidth) : .35
  const maxWidth = Number.isFinite(Number(options.maxWidth)) ? Number(options.maxWidth) : 1.9
  const reference = interval / targetSpacing
  return clamp(baseWidth * Math.sqrt(reference / grad), minWidth, maxWidth)
}

export function hillshade(slopeX, slopeY, lighting, shadow = 1) {
  const azimuth = lighting.hillshadeAzimuth * Math.PI / 180
  const altitude = lighting.hillshadeAltitude * Math.PI / 180
  const x = -slopeX * lighting.zFactor, y = -slopeY * lighting.zFactor
  const illumination = Math.max(0, (x * Math.sin(azimuth) * Math.cos(altitude) +
    y * Math.cos(azimuth) * Math.cos(altitude) + Math.sin(altitude)) / Math.hypot(x, y, 1))
  const ambient = Number.isFinite(lighting.ambient) ? lighting.ambient : 1 - lighting.hillshadeIntensity
  const diffuse = Number.isFinite(lighting.diffuse) ? lighting.diffuse : lighting.hillshadeIntensity
  // 阴影只削弱直射分量（diffuse），环境光仍然保留，避免背光面变成纯黑。
  return clamp(ambient + diffuse * illumination * shadow,
    Number.isFinite(lighting.minLight) ? lighting.minLight : 0,
    Number.isFinite(lighting.maxLight) ? lighting.maxLight : Infinity)
}

function bilinearField(values, width, height, u, v) {
  const x = u * (width - 1)
  const y = v * (height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const a = values[y0 * width + x0] ?? 0
  const b = values[y0 * width + x1] ?? 0
  const c = values[y1 * width + x0] ?? 0
  const d = values[y1 * width + x1] ?? 0
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

function sampleGridHeight(grid, row, col) {
  const r0 = Math.floor(row)
  const c0 = Math.floor(col)
  const r1 = Math.min(grid.height - 1, r0 + 1)
  const c1 = Math.min(grid.width - 1, c0 + 1)
  const fr = row - r0
  const fc = col - c0
  const value = (r, c) => {
    const v = grid.values[r * grid.width + c]
    return Number.isFinite(v) ? v : 0
  }
  return value(r0, c0) * (1 - fr) * (1 - fc)
    + value(r0, c1) * (1 - fr) * fc
    + value(r1, c0) * fr * (1 - fc)
    + value(r1, c1) * fr * fc
}

const shadowMaskCache = new WeakMap()
const SHADOW_MASK_MAX_SIZE = 160

/**
 * 方向光的地形自阴影（高度场光线步进）。
 *
 * 从每个采样点沿太阳方位水平前进，若前方地形高于“光源射线”，该点即被遮挡。
 * 竖直夸张会拉伸地形但不会改变光源高度角，因此在原始高程空间中把高度角
 * 折算为 atan(tan(altitude) / exaggeration)，保证阴影方向与山坡明暗一致。
 * 结果缓存在网格上，只有光照方位/高度或夸张倍率变化时才重新计算。
 */
export function terrainShadowMask(grid, azimuthDeg, altitudeDeg, exaggeration = 1) {
  if (!grid?.values?.length || !(grid.width > 1) || !(grid.height > 1)) return null
  const azimuth = ((Number(azimuthDeg) || 0) % 360 + 360) % 360
  const altitude = clamp(Number(altitudeDeg) || 45, 0.5, 89.5)
  const vertical = normalizeExaggeration(exaggeration)
  const key = `${Math.round(azimuth)}:${Math.round(altitude)}:${Math.round(vertical * 10)}`

  let cache = shadowMaskCache.get(grid)
  if (!cache) {
    cache = new Map()
    shadowMaskCache.set(grid, cache)
  }
  if (cache.has(key)) {
    const cached = cache.get(key)
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const scale = Math.min(1, SHADOW_MASK_MAX_SIZE / Math.max(grid.width, grid.height))
  const width = Math.max(2, Math.round(grid.width * scale))
  const height = Math.max(2, Math.round(grid.height * scale))
  const heights = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    const srcRow = row / (height - 1) * (grid.height - 1)
    for (let col = 0; col < width; col++) {
      const srcCol = col / (width - 1) * (grid.width - 1)
      heights[row * width + col] = sampleGridHeight(grid, srcRow, srcCol)
    }
  }

  const b = grid.bounds
  const cosLat = Math.max(.1, Math.cos((Number(b.north) + Number(b.south)) * Math.PI / 360))
  const eastMeters = Math.max(1, (Number(b.east) - Number(b.west)) * 111320 * cosLat)
  const northMeters = Math.max(1, (Number(b.north) - Number(b.south)) * 110574)
  const sinAzimuth = Math.sin(azimuth * Math.PI / 180)
  const cosAzimuth = Math.cos(azimuth * Math.PI / 180)
  const rise = Math.tan(altitude * Math.PI / 180) / vertical
  const step = Math.max(1, 0.8 * Math.min(
    eastMeters / (width - 1),
    northMeters / (height - 1),
  ))
  const maxSteps = Math.min(420, Math.ceil(Math.hypot(eastMeters, northMeters) / step))
  const values = new Float32Array(width * height)

  for (let row = 0; row < height; row++) {
    const v0 = row / (height - 1)
    for (let col = 0; col < width; col++) {
      const u0 = col / (width - 1)
      const base = heights[row * width + col]
      let lit = 1
      for (let i = 1; i <= maxSteps; i++) {
        const meters = i * step
        const u = u0 + (meters * sinAzimuth) / eastMeters
        const v = v0 - (meters * cosAzimuth) / northMeters
        if (u < 0 || u > 1 || v < 0 || v > 1) break
        const occluder = bilinearField(heights, width, height, u, v)
        // 0.5 m 偏置过滤 DEM 噪声造成的假阴影。
        if (occluder > base + meters * rise + 0.5) {
          lit = 0
          break
        }
      }
      values[row * width + col] = lit
    }
  }

  const mask = { width, height, values }
  cache.set(key, mask)
  if (cache.size > 6) cache.delete(cache.keys().next().value)
  return mask
}

/** 在阴影掩膜上按归一化坐标 (u = 西→东, v = 北→南) 双线性取样。 */
export function terrainShadowFactor(mask, u, v) {
  if (!mask) return 1
  return bilinearField(mask.values, mask.width, mask.height, clamp(u, 0, 1), clamp(v, 0, 1))
}
