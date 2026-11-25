import {
  TERRAIN_MAX_MESH_SEGMENTS,
  normalizeExaggeration, terrainLighting, terrainMesh, terrainSegments, hillshade,
  pickBandStep, terrainColorAt, screenHeightGradient, contourLineWidth,
  terrainShadowMask, terrainShadowFactor,
} from './terrainRendering.js'
import { detectionClassColor, standardNormalCdf } from './signalExcess.js'
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
export function bathymetryColor(height, min = -8000, max = 0) {
  return terrainColorAt(height, min, max)
}

export function createTerrainProjection(bounds, size, floor, camera = {}) {
  const yaw = camera.yaw || 0
  const pitch = camera.pitch ?? 0.68
  const panX = Number(camera.panX) || 0
  const panY = Number(camera.panY) || 0
  const scale = Math.min(size.width * .72, size.height * 1.2) * (camera.zoom || 1)
  const cosLat = Math.max(.1, Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180))
  const spanX = (bounds.east - bounds.west) * cosLat
  const spanY = bounds.north - bounds.south
  const span = Math.max(spanX, spanY)
  // X/Y 已按经纬跨度等比例归一化；Z 使用相同的物理米制跨度。
  // 因此倍率 1 是真实纵横比例，而不是按“最大水深”再次归一化后的视觉厚度。
  const horizontalSpanM = Math.max(1, span * 110574)
  const verticalExaggeration = normalizeExaggeration(camera.verticalExaggeration)
  // 三角函数与相机无关，提到闭包外，避免逐顶点重复计算。
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const sinPitch = Math.sin(pitch)
  const cosPitch = Math.cos(pitch)
  return (lon, lat, elevation) => {
    const x = (lon - (bounds.west + bounds.east) / 2) * cosLat / span
    const y = ((bounds.north + bounds.south) / 2 - lat) / span
    const rx = x * cosYaw - y * sinYaw
    const ry = x * sinYaw + y * cosYaw
    const z = elevation / horizontalSpanM * verticalExaggeration
    // 透视只属于斜视视角。此前即使 pitch=90°（正俯视）仍按 ry 做远小近大，
    // 会把水平圆形压成蛋形，并让不同深度的声源标记看起来偏离体中心。
    const perspectiveStrength = .35 * Math.abs(cosPitch)
    const perspective = 1 / (1 - ry * perspectiveStrength)
    return { x: size.width * .5 + panX + rx * scale * perspective,
      y: size.height * .40 + panY + (ry * sinPitch - z * cosPitch) * scale * perspective,
      order: ry + z * .3, perspective }
  }
}

/** 视口中心处每屏幕像素对应的水平米数，用于绘制比例尺。 */
export function terrainMetersPerPixel(bounds, size, camera = {}) {
  const cosLat = Math.max(.1, Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180))
  const spanX = (bounds.east - bounds.west) * cosLat
  const spanY = bounds.north - bounds.south
  const span = Math.max(spanX, spanY)
  const horizontalSpanM = Math.max(1, span * 110574)
  const scale = Math.min(size.width * .72, size.height * 1.2) * (camera.zoom || 1)
  return horizontalSpanM / scale
}

function polygon(ctx, points, color) {
  ctx.beginPath()
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  if (color.startsWith('rgb(')) { ctx.strokeStyle = color; ctx.lineWidth = .5; ctx.stroke() }
}

function averageRgb(colors) {
  if (!colors.length) return [0, 0, 0]
  return [0, 1, 2].map(channel => Math.round(
    colors.reduce((sum, color) => sum + color[channel], 0) / colors.length
  ))
}

/** 方位显示只在声强域插值，避免直接平均对数 dB；不改写原始 TL 数据。 */
function interpolateTlDbByIntensity(a, b, t) {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : NaN
  if (!Number.isFinite(b)) return a
  const fraction = clamp(t, 0, 1)
  if (fraction <= 0) return a
  if (fraction >= 1) return b
  const intensity = (1 - fraction) * Math.pow(10, -a / 10) + fraction * Math.pow(10, -b / 10)
  return intensity > 0 ? -10 * Math.log10(intensity) : NaN
}

/**
 * Canvas 没有逐顶点着色；用共享顶点颜色构造面内线性渐变，避免每个网格单元
 * 使用一个常量色而产生棋盘边界。渐变只作用于显示，不改写 TL 数据。
 */
function gradientPolygon(ctx, points, colors, alpha) {
  if (!points?.length || !colors?.length) return
  const left = averageRgb([colors[0], colors[3] ?? colors[0]])
  const right = averageRgb([colors[1] ?? colors[0], colors[2] ?? colors[0]])
  const center = averageRgb(colors)
  const from = {
    x: ((points[0]?.x || 0) + (points[3]?.x ?? points[0]?.x ?? 0)) / 2,
    y: ((points[0]?.y || 0) + (points[3]?.y ?? points[0]?.y ?? 0)) / 2,
  }
  const to = {
    x: ((points[1]?.x ?? points[0]?.x ?? 0) + (points[2]?.x ?? points[0]?.x ?? 0)) / 2,
    y: ((points[1]?.y ?? points[0]?.y ?? 0) + (points[2]?.y ?? points[0]?.y ?? 0)) / 2,
  }
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
  gradient.addColorStop(0, `rgba(${left.join(',')},${alpha})`)
  gradient.addColorStop(0.5, `rgba(${center.join(',')},${alpha})`)
  gradient.addColorStop(1, `rgba(${right.join(',')},${alpha})`)
  ctx.beginPath()
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()
  // 半透明面不能逐格描边：共享边会被重复混合成明亮的横竖网笼。相邻面只填充，
  // 浏览器的子像素覆盖负责公共边抗锯齿，不额外叠加任何网格线。
}

const terrainLineGeometryCache = new WeakMap()

function pushLineSegment(target, from, to) {
  target.push(from.lon, from.lat, from.elevation, to.lon, to.lat, to.elevation)
}

function buildTerrainLineGeometry(grid) {
  const cached = terrainLineGeometryCache.get(grid)
  if (cached) return cached

  const segments = Math.max(1, Math.min(
    TERRAIN_MAX_MESH_SEGMENTS,
    grid.width - 1,
    grid.height - 1,
  ))
  const mesh = terrainMesh(grid, segments)
  const waterBand = pickBandStep(Math.max(0, -Math.min(0, Number(grid.min) || 0)), 12)
  const landBand = pickBandStep(Math.max(0, Number(grid.max) || 0), 12)
  const contours = []
  const coastline = []

  for (let faceIndex = 0; faceIndex < mesh.faces.length; faceIndex += 1) {
    const indices = mesh.faces[faceIndex]
    const vertices = indices.map(index => mesh.vertices[index])
    const sea = vertices.map(vertex => vertex.sea === true)

    if (sea.some(Boolean) && !sea.every(Boolean)) {
      const crossings = []
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
        if (sea[a] === sea[b]) continue
        const from = vertices[a]
        const to = vertices[b]
        crossings.push({
          lon: (from.lon + to.lon) / 2,
          lat: (from.lat + to.lat) / 2,
          elevation: (from.elevation + to.elevation) / 2,
        })
      }
      if (crossings.length === 2) {
        pushLineSegment(coastline, crossings[0], crossings[1])
      } else if (crossings.length === 4) {
        const centerSea = sea.filter(Boolean).length >= 2
        const links = centerSea ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]]
        for (const [a, b] of links) pushLineSegment(coastline, crossings[a], crossings[b])
      }
    }

    const cell = mesh.cells?.[faceIndex]
    const isSea = cell ? cell[2] === true : false
    const step = isSea ? waterBand : landBand
    if (!(step > 0)) continue

    const values = vertices.map(vertex => isSea
      ? Math.min(vertex.elevation, 0)
      : Math.max(vertex.elevation, 0))
    const start = Math.min(...values)
    const end = Math.max(...values)
    const first = Math.ceil(start / step)
    const last = Math.floor(end / step)
    if (last < first) continue

    const stride = Math.max(1, Math.ceil((last - first + 1) / 6))
    for (let index = first; index <= last; index += stride) {
      const level = index * step
      if (level === 0) continue
      const crossings = []
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
        const va = values[a] - level
        const vb = values[b] - level
        if (va * vb > 0) continue
        const t = va / (va - vb || 1e-9)
        const from = vertices[a]
        const to = vertices[b]
        crossings.push({
          lon: from.lon + (to.lon - from.lon) * t,
          lat: from.lat + (to.lat - from.lat) * t,
          elevation: level,
        })
      }
      if (crossings.length === 2) {
        pushLineSegment(contours, crossings[0], crossings[1])
      } else if (crossings.length === 4) {
        const centerAbove = (values[0] + values[1] + values[2] + values[3]) / 4 >= level
        const links = centerAbove ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]]
        for (const [a, b] of links) pushLineSegment(contours, crossings[a], crossings[b])
      }
    }
  }

  const geometry = { contours, coastline }
  terrainLineGeometryCache.set(grid, geometry)
  return geometry
}

function drawLineSegments(ctx, project, segments, color, lineWidth) {
  if (!segments.length) return
  ctx.save()
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  for (let index = 0; index < segments.length; index += 6) {
    const from = project(segments[index], segments[index + 1], segments[index + 2])
    const to = project(segments[index + 3], segments[index + 4], segments[index + 5])
    if (!Number.isFinite(from?.x) || !Number.isFinite(from?.y) ||
        !Number.isFinite(to?.x) || !Number.isFinite(to?.y)) continue
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawTerrainScene(canvas, grid, {
  field,
  source,
  fields = [],
  camera,
  controls = {},
  rayScene = null,
  raySource = null,
  directionLine = null,
  receiver = null,
  meshMax = TERRAIN_MAX_MESH_SEGMENTS,
  paintTerrain = true,
  fullResolution = false,
  skipPrimaryVolume = false,
  skipLayerIds = [],
} = {}) {
  if (!canvas || !grid) return null
  const { width, height } = canvas.getBoundingClientRect()
  if (!width || !height) return null
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
  if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr)
  if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const b = grid.bounds
  const project = createTerrainProjection(b, { width, height }, grid.min, {
    ...camera,
    verticalExaggeration: controls.terrainExaggeration,
  })
  const rayProjectorForSource = (src) => {
    const lon = Number(src?.lon)
    const lat = Number(src?.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
    const cosLat = Math.max(.01, Math.cos(lat * Math.PI / 180))
    return (angle, radius, depth = 0) => project(
      lon + (Math.cos(angle) * (Number(radius) || 0)) / (111320 * cosLat),
      lat + (Math.sin(angle) * (Number(radius) || 0)) / 110574,
      -(Number(depth) || 0),
    )
  }
  const lightAzimuth = Number(controls.lightAzimuthDeg)
  const lightAltitude = Number(controls.lightAltitudeDeg)
  const lighting = {
    ...terrainLighting,
    zFactor: normalizeExaggeration(controls.terrainExaggeration),
    hillshadeAzimuth: Number.isFinite(lightAzimuth) ? lightAzimuth : terrainLighting.hillshadeAzimuth,
    hillshadeAltitude: Number.isFinite(lightAltitude) ? lightAltitude : terrainLighting.hillshadeAltitude,
  }
  const brightness = clamp(Number.isFinite(Number(controls.terrainBrightness))
    ? Number(controls.terrainBrightness) : 1, .5, 4)
  const mesh = terrainMesh(grid, terrainSegments({ width, height }, camera?.zoom || 1, .75, meshMax))
  const points = mesh.vertices.map(v => ({ ...v, ...project(v.lon, v.lat, v.elevation) }))
  const showBands = controls.terrainBands === true
  const showFog = controls.terrainFog !== false
  const showContours = controls.terrainContours === true
  const showCoastline = controls.terrainCoastline === true
  const landSpan = Math.max(0, Number(grid.max) || 0)
  const waterSpan = Math.max(0, -Math.min(0, Number(grid.min) || 0))
  const landBand = pickBandStep(landSpan, 12)
  const waterBand = pickBandStep(waterSpan, 12)
  const colorOptions = {
    landBand: showBands ? landBand : 0,
    waterBand: showBands ? waterBand : 0,
  }
  // 方向光自阴影：与 WebGL 着色器一致，按月亮方位对高度场做光线步进。
  const shadowMask = paintTerrain && controls.terrainShadows === true
    ? terrainShadowMask(grid, lighting.hillshadeAzimuth, lighting.hillshadeAltitude, lighting.zFactor)
    : null
  const lonSpan = Math.max(1e-9, b.east - b.west)
  const latSpan = Math.max(1e-9, b.north - b.south)
  // 坡度/坡向光照，保留连续明暗；高程色带按网格面离散。
  const shades = paintTerrain ? mesh.vertices.map(v => {
    const shadow = shadowMask
      ? terrainShadowFactor(shadowMask, (v.lon - b.west) / lonSpan, (b.north - v.lat) / latSpan)
      : 1
    return hillshade(v.slopeX, v.slopeY, lighting, shadow)
  }) : null
  const fogColor = Array.isArray(controls.terrainFogColor) && controls.terrainFogColor.length === 3
    ? controls.terrainFogColor.map(value => clamp(Number(value) || 0, 0, 255))
    : [7, 19, 30]
  const fogStrength = showFog
    ? clamp(Number.isFinite(Number(controls.terrainFogStrength)) ? Number(controls.terrainFogStrength) : .6, 0, 1)
    : 0
  let fogFactors = null
  if (paintTerrain) {
    // 透视因子 1/perspective 随相机距离增大，用它给远处地形叠加大气透视雾。
    let invMin = Infinity, invMax = -Infinity
    const invDepths = points.map(point => {
      const value = 1 / Math.max(1e-6, Number(point.perspective) || 1)
      if (value < invMin) invMin = value
      if (value > invMax) invMax = value
      return value
    })
    fogFactors = fogStrength > 0 && invMax > invMin
      ? invDepths.map(value => fogStrength * Math.pow(clamp((value - invMin) / (invMax - invMin), 0, 1), 1.35))
      : invDepths.map(() => 0)
  }
  const faces = mesh.faces.map((indices, index) => {
    const p = indices.map(i => points[i])
    if (!paintTerrain) return { p }
    const cell = mesh.cells?.[index] || null
    const elevations = indices.map(i => mesh.vertices[i].elevation)
    const meanElevation = elevations.reduce((sum, value) => sum + value, 0) / elevations.length
    // 外海连通域会修正海面 ±0.x m 噪声，避免把噪声当成陆地画出一圈碎海岸。
    const isSea = cell ? cell[2] === true : meanElevation <= 0
    const displayElevations = elevations.map(value => isSea ? Math.min(value, 0) : Math.max(value, 0))
    const colorElevation = displayElevations.reduce((sum, value) => sum + value, 0) / displayElevations.length
    const faceColor = showBands
      ? terrainColorAt(colorElevation, grid.min, grid.max, colorOptions)
      : null
    const colors = indices.map((vertexIndex, slot) => {
      const color = faceColor || terrainColorAt(displayElevations[slot], grid.min, grid.max, colorOptions)
      const shade = shades[vertexIndex]
      const fog = fogFactors[vertexIndex]
      return color.map((channel, channelIndex) => {
        const lit = clamp(channel * shade * brightness, 0, 255)
        return Math.round(fog > 0 ? lit + (fogColor[channelIndex] - lit) * fog : lit)
      })
    })
    return {
      p,
      colors,
      order: p.reduce((sum, v) => sum + v.order, 0) / 4,
      seaCorners: indices.map(i => mesh.vertices[i].sea === true),
      screenGradient: screenHeightGradient(p, elevations),
      contourStep: isSea ? waterBand : landBand,
      displayElevations,
      cell,
    }
  })
  const strokeEdge = (from, to, color, lineWidth) => {
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
  const contourColor = 'rgba(232, 255, 244, 0.26)'
  const coastlineColor = 'rgba(196, 246, 230, 0.52)'
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  // 二值掩膜的 marching squares：跨海陆边的中点相连，得到斜向平滑海岸线，
  // 而不是沿网格单元逐边描出的直角台阶。
  const drawCoastlineCell = (face) => {
    const sea = face.seaCorners
    const crossings = []
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
      if (sea[a] !== sea[b]) crossings.push(midpoint(face.p[a], face.p[b]))
    }
    if (crossings.length === 2) {
      strokeEdge(crossings[0], crossings[1], coastlineColor, 1.15)
      return
    }
    if (crossings.length !== 4) return
    const centerSea = sea.filter(Boolean).length >= 2
    const links = centerSea ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]]
    for (const [a, b] of links) strokeEdge(crossings[a], crossings[b], coastlineColor, 1.15)
  }
  const drawContourCell = (face) => {
    const step = face.contourStep
    if (!(step > 0)) return
    const values = face.displayElevations
    const start = Math.min(...values)
    const end = Math.max(...values)
    const first = Math.ceil(start / step)
    const last = Math.floor(end / step)
    if (last < first) return
    // 屏幕空间梯度越大（坡越陡）线越细，平地则变粗，视觉密度更均匀。
    const lineWidth = contourLineWidth(step, face.screenGradient)
    const stride = Math.max(1, Math.ceil((last - first + 1) / 6))
    for (let index = first; index <= last; index += stride) {
      const level = index * step
      if (level === 0) continue
      const crossings = []
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
        const va = values[a] - level
        const vb = values[b] - level
        if (va * vb > 0) continue
        const t = va / (va - vb || 1e-9)
        crossings.push({
          x: face.p[a].x + (face.p[b].x - face.p[a].x) * t,
          y: face.p[a].y + (face.p[b].y - face.p[a].y) * t,
        })
      }
      if (crossings.length === 2) {
        strokeEdge(crossings[0], crossings[1], contourColor, lineWidth)
      } else if (crossings.length === 4) {
        // 鞍点：用面中心高于或低于当前等高线决定连接方式。
        const centerAbove = (values[0] + values[1] + values[2] + values[3]) / 4 >= level
        const links = centerAbove ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]]
        for (const [a, b] of links) strokeEdge(crossings[a], crossings[b], contourColor, lineWidth)
      }
    }
  }
  if (paintTerrain) {
    faces.slice().sort((a, b) => a.order - b.order).forEach(face => {
      // Close-up views retain native samples but avoid shading off-screen faces.
      if (face.p.every(p => p.x < 0) || face.p.every(p => p.x > width) ||
          face.p.every(p => p.y < 0) || face.p.every(p => p.y > height)) return
      gradientPolygon(ctx, face.p, face.colors, 1)
      if (showCoastline && face.seaCorners.some(Boolean) && !face.seaCorners.every(Boolean)) {
        drawCoastlineCell(face)
      }
      if (showContours) drawContourCell(face)
    })
  } else if (showCoastline || showContours) {
    const lines = buildTerrainLineGeometry(grid)
    if (showCoastline) drawLineSegments(ctx, project, lines.coastline, coastlineColor, 1.15)
    if (showContours) drawLineSegments(ctx, project, lines.contours, contourColor, .9)
  }
  drawTerrainAxes(ctx, project, b, grid)

  let anchor = null
  let rayProjector = null
  /** 方向方位线箭头端点与所属声场体的极坐标投影（供地形模式拖拽命中/反解角度）。 */
  let directionArrow = null
  let directionProjector = null
  const anchors = {}
  const fieldLayers = [
    ...(field && source ? [{ id: 'current', field, source, visible: controls.volumeVisible !== false, primary: true }] : []),
    ...(Array.isArray(fields) ? fields : []),
  ]
  // Layers already rendered by the GPU volume pass must not be painted again by
  // the Canvas mesher, otherwise the blocky faces stack over the ray-marched body.
  const gpuLayerIds = new Set(Array.isArray(skipLayerIds) ? skipLayerIds : [])
  for (const fieldLayer of fieldLayers) {
    if (!fieldLayer?.field || !fieldLayer?.source || fieldLayer.visible === false) continue
    const field = fieldLayer.field
    const source = fieldLayer.source
    const { sector, row, col, depth, distance, compassBearings } = field.grid
    const volumeFaces = []
    // 静止时按接口返回的全部距离/深度节点绘制，不做抽稀；拖动/缩放期间临时降采样，
    // 松手后自动恢复完整分辨率，避免交互被数万面片拖慢。
    const radialStep = fullResolution ? 1 : Math.max(1, Math.ceil(Math.max(1, col - 1) / 54))
    const depthStep = fullResolution ? 1 : Math.max(1, Math.ceil(Math.max(1, row - 1) / 44))
    const opacity = clamp((Number(controls.opacity) || 1.7) / 5, .04, 1)
    const density = clamp(Number(controls.density) || 3, .25, 8)
    const contrast = clamp(Number(controls.contrast) || 2, .5, 3)
    const edgeSharpness = clamp(Number(controls.edgeSharpness) || 1, .5, 4)
    const dbMin = Number.isFinite(Number(controls.dbMin)) ? Number(controls.dbMin) : 60
    const dbMax = Math.max(dbMin + 1, Number(controls.dbMax) || 120)
    const rotations = [controls.rotationX, controls.rotationY, controls.rotationZ].map(value => (Number(value) || 0) * Math.PI / 180)
    const offsets = [controls.moveX, controls.moveY, controls.moveZ].map(value => Number(value) || 0)
    const colorStops = Array.isArray(controls.colorStops) && controls.colorStops.length >= 2
      ? controls.colorStops
      : [[0, [255,40,0]], [1, [0,0,127]]]
    const colorAt = (ratio) => {
      const t = clamp((clamp(ratio, 0, 1) - .5) * contrast + .5, 0, 1)
      for (let i = 0; i < colorStops.length - 1; i++) {
        const [a, ca] = colorStops[i], [z, cz] = colorStops[i + 1]
        if (t > z && i < colorStops.length - 2) continue
        const q = clamp((t - a) / Math.max(.000001, z - a), 0, 1)
        return ca.map((value, channel) => Math.round(value + (cz[channel] - value) * q))
      }
      return colorStops[colorStops.length - 1][1]
    }
    const threeColor = controls.signalExcess?.threeColor === true
    const probabilityFor = (value) => controls.signalExcess?.pd === true
      ? Number(value)
      : standardNormalCdf(Number(value) / Math.max(1e-6, Number(controls.signalExcess?.sigma) || 6)) * 100
    const rotate = (x, y, z) => {
      const [rx, ry, rz] = rotations
      let y1 = y * Math.cos(rx) - z * Math.sin(rx), z1 = y * Math.sin(rx) + z * Math.cos(rx)
      let x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry)
      return {
        x: x2 * Math.cos(rz) - y1 * Math.sin(rz) + offsets[0],
        y: x2 * Math.sin(rz) + y1 * Math.cos(rz) + offsets[1],
        z: z2 + offsets[2],
      }
    }
    // 地形高程双线性采样：海底裁剪和声场底边都使用同一条连续高程曲线，
    // 避免最近邻网格单元把声场底部切成阶梯或整块缺失。
    const terrainWidth = Math.max(1, Number(grid.width) || 1)
    const terrainHeight = Math.max(1, Number(grid.height) || 1)
    const terrainValues = grid.values
    const terrainLonSpan = Math.max(1e-9, b.east - b.west)
    const terrainLatSpan = Math.max(1e-9, b.north - b.south)
    const elevationAtLonLat = (lon, lat) => {
      if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return null
      const fx = ((lon - b.west) / terrainLonSpan) * (terrainWidth - 1)
      const fy = ((b.north - lat) / terrainLatSpan) * (terrainHeight - 1)
      const x0 = Math.max(0, Math.min(terrainWidth - 1, Math.floor(fx)))
      const y0 = Math.max(0, Math.min(terrainHeight - 1, Math.floor(fy)))
      const x1 = Math.min(terrainWidth - 1, x0 + 1)
      const y1 = Math.min(terrainHeight - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const corners = [
        [terrainValues[y0 * terrainWidth + x0], (1 - tx) * (1 - ty)],
        [terrainValues[y0 * terrainWidth + x1], tx * (1 - ty)],
        [terrainValues[y1 * terrainWidth + x0], (1 - tx) * ty],
        [terrainValues[y1 * terrainWidth + x1], tx * ty],
      ]
      let sum = 0
      let weight = 0
      for (const [value, w] of corners) {
        if (!Number.isFinite(value) || w <= 0) continue
        sum += value * w
        weight += w
      }
      return weight > 0 ? sum / weight : null
    }
    const polar = (angle, radius, z) => {
      const local = rotate(Math.cos(angle) * radius, Math.sin(angle) * radius, -z)
      const lon = source.lon + local.x / (111320 * Math.cos(source.lat * Math.PI / 180))
      const lat = source.lat + local.y / 110574
      if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return null
      const floor = elevationAtLonLat(lon, lat)
      if (!Number.isFinite(floor) || floor >= 0 || local.z < floor) return null
      return project(lon, lat, local.z)
    }
    const projectPolar = (angle, radius, depth = 0) => {
      const local = rotate(Math.cos(angle) * radius, Math.sin(angle) * radius, -depth)
      const lon = source.lon + local.x / (111320 * Math.max(.01, Math.cos(source.lat * Math.PI / 180)))
      const lat = source.lat + local.y / 110574
      return project(lon, lat, local.z)
    }
    /** 某极坐标位置的水深（米，正）；陆地/越界返回 null，浅水返回 0。 */
    const terrainWaterDepthAt = (angle, radius) => {
      const local = rotate(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
      const lon = source.lon + local.x / (111320 * Math.max(.01, Math.cos(source.lat * Math.PI / 180)))
      const lat = source.lat + local.y / 110574
      const elevation = elevationAtLonLat(lon, lat)
      if (!Number.isFinite(elevation)) return null
      return elevation >= 0 ? 0 : -elevation
    }
    if (fieldLayer.primary) rayProjector = projectPolar

    // 裁剪体：仅对方向方位线所在的声场体裁掉半个体，并在切边补出 TL 竖直切面。
    const directionTargetId = directionLine?.layerId
    const isDirectionLayer = directionTargetId ? fieldLayer.id === directionTargetId : fieldLayer.primary
    const clipAzimuthDeg = Number(directionLine?.azimuthDeg)
    const clipAngle = controls.clipBody === true && isDirectionLayer && Number.isFinite(clipAzimuthDeg)
      ? clipAzimuthDeg * Math.PI / 180
      : null
    const isRemovedAngle = (angle) => {
      if (clipAngle == null) return false
      const d = Math.atan2(Math.sin(angle - clipAngle), Math.cos(angle - clipAngle))
      // 保留 [箭头方位, 箭头方位+180°] 的半个圆柱。
      return d < -1e-6
    }

    const axisNodes = (count, step) => {
      const nodes = []
      for (let index = 0; index < count; index += step) nodes.push(index)
      if (nodes[nodes.length - 1] !== count - 1) nodes.push(count - 1)
      return nodes
    }
    const radialNodes = axisNodes(col, radialStep)
    const depthNodes = axisNodes(row, depthStep)
    const wrapSector = index => ((index % sector) + sector) % sector
    const unwrapNear = (angle, reference) => {
      let result = angle
      while (result - reference > Math.PI) result -= Math.PI * 2
      while (result - reference < -Math.PI) result += Math.PI * 2
      return result
    }
    const centerAngles = Array.from({ length: sector }, (_, index) =>
      (90 - (compassBearings[index] ?? index * 360 / sector)) * Math.PI / 180
    )
    // boundaryAngles[s] 是扇区 s 与前一扇区的公共边，保证相邻面真正共边而非互相覆盖。
    const boundaryAngles = centerAngles.map((center, index) => {
      const previous = unwrapNear(centerAngles[wrapSector(index - 1)], center)
      return (previous + center) / 2
    })
    const rawTl = (s, z, r) => {
      const si = wrapSector(s)
      const zi = Math.max(0, Math.min(row - 1, Math.round(z)))
      const ri = Math.max(0, Math.min(col - 1, Math.round(r)))
      if (field.isBelowSeabed(si, zi, ri)) return NaN
      const value = field.at(si, zi, ri)
      return Number.isFinite(value) ? value : NaN
    }
    const averageFiniteIntensity = (...values) => {
      const valid = values.filter(Number.isFinite)
      if (!valid.length) return NaN
      const intensity = valid.reduce((sum, value) => sum + Math.pow(10, -value / 10), 0) / valid.length
      return intensity > 0 ? -10 * Math.log10(intensity) : NaN
    }
    // 公共角边在声强域取两侧扇区均值；相邻表面使用完全相同的边界 TL 值。
    const boundaryTl = (boundary, z, r) => averageFiniteIntensity(
      rawTl(boundary - 1, z, r),
      rawTl(boundary, z, r)
    )
    const boundaryTlAtDepth = (boundary, z, r) => {
      const lo = Math.floor(clamp(z, 0, row - 1))
      const hi = Math.min(row - 1, lo + 1)
      const a = boundaryTl(boundary, lo, r)
      const bValue = boundaryTl(boundary, hi, r)
      if (!Number.isFinite(a)) return bValue
      if (!Number.isFinite(bValue)) return a
      return a + (bValue - a) * (z - lo)
    }
    const angularTl = (sectorIndex, t, z, r) => {
      // 原始节点检查模式下，一个真实方位负责其中心两侧的整个角区，不做方位混合。
      if (controls.strictNearest === true) return rawTl(sectorIndex, z, r)
      const a = boundaryTlAtDepth(sectorIndex, z, r)
      const bValue = boundaryTlAtDepth(sectorIndex + 1, z, r)
      return interpolateTlDbByIntensity(a, bValue, t)
    }
    const depthAt = index => {
      const z = clamp(index, 0, row - 1)
      const lo = Math.floor(z)
      const hi = Math.min(row - 1, lo + 1)
      return Number(depth[lo]) + (Number(depth[hi]) - Number(depth[lo])) * (z - lo)
    }
    const skipVolumeFaces = (fieldLayer.primary && skipPrimaryVolume) || gpuLayerIds.has(fieldLayer.id)
    const pushFace = (points, values, baseAlpha) => {
      if (skipVolumeFaces) return
      if (points.some(point => !point) || values.some(value => !Number.isFinite(value))) return
      if (threeColor) {
        const probabilities = values.map(probabilityFor)
        const meanProbability = probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
        const classColor = detectionClassColor(meanProbability)
        if (!classColor) return
        const alpha = clamp(baseAlpha * density, .12, .98).toFixed(3)
        volumeFaces.push({
          p: points,
          colors: values.map(() => classColor),
          alpha,
          order: points.reduce((sum, point) => sum + point.order, 0) / points.length,
        })
        return
      }
      const ratios = values.map(value => clamp((value - dbMin) / (dbMax - dbMin), 0, 1))
      const colors = ratios.map(colorAt)
      const meanRatio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
      const valueOpacity = Math.pow(1 - meanRatio * .42, edgeSharpness)
      const alpha = clamp(baseAlpha * valueOpacity * density, .12, .98).toFixed(3)
      volumeFaces.push({
        p: points,
        colors,
        alpha,
        order: points.reduce((sum, point) => sum + point.order, 0) / points.length,
      })
    }
    const sectorGeometry = (s) => {
      const a0 = boundaryAngles[s]
      const a1 = unwrapNear(boundaryAngles[wrapSector(s + 1)], a0)
      const subdivisions = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)))
      return { a0, a1, subdivisions }
    }

    if (!skipVolumeFaces) {
    // 顶面：只绘制一个由共享顶点连接的 TL 表面，不再堆叠独立水平圆盘。
    // 信号余量场在目标最小深度取顶面；普通场仍在 0 m（海面）取顶面。
    const topZ = Number.isFinite(field.topDepthIndex) ? clamp(field.topDepthIndex, 0, row - 1) : 0
    for (let s = 0; s < sector; s++) {
      const { a0, a1, subdivisions } = sectorGeometry(s)
      for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
        const t0 = subdivision / subdivisions
        const t1 = (subdivision + 1) / subdivisions
        const angle0 = a0 + (a1 - a0) * t0
        const angle1 = a0 + (a1 - a0) * t1
        if (isRemovedAngle((angle0 + angle1) / 2)) continue
        for (let radial = 0; radial < radialNodes.length - 1; radial++) {
          const r0 = radialNodes[radial]
          const r1 = radialNodes[radial + 1]
          pushFace([
            polar(angle0, distance[r0], depthAt(topZ)),
            polar(angle1, distance[r0], depthAt(topZ)),
            polar(angle1, distance[r1], depthAt(topZ)),
            polar(angle0, distance[r1], depthAt(topZ)),
          ], [
            angularTl(s, t0, topZ, r0), angularTl(s, t1, topZ, r0),
            angularTl(s, t1, topZ, r1), angularTl(s, t0, topZ, r1),
          ], .52 + opacity * .38)
        }
      }
    }

    // 地形贴合：声场底边不再按离散深度层整块裁剪，而是沿双线性采样的真实
    // 海底高程连续收边。这样海山/陡坡处不会出现矩形缺口或阶梯。
    const outerR = col - 1
    const maxTlDepthM = depthAt(row - 1)
    const terrainAngleStep = Math.PI / 30
    const bottomRadialNodes = radialNodes
    const wallSegments = Math.max(2, depthNodes.length - 1)
    const depthIndexNearest = (depthM) => {
      let best = 0
      let bestDiff = Infinity
      for (let index = 0; index < row; index++) {
        const diff = Math.abs((Number(depth[index]) || 0) - depthM)
        if (diff < bestDiff) { bestDiff = diff; best = index }
      }
      return best
    }
    // 在声场底部取当前角度/距离列上仍有效的 TL；地形比 Bellhop 海深更深时
    // 向浅处回退，避免把缺失值当成有效声场。
    const bottomTl = (s, t, depthM, r) => {
      const start = depthIndexNearest(depthM)
      for (let z = start; z >= 0; z--) {
        const value = angularTl(s, t, z, r)
        if (Number.isFinite(value)) return value
      }
      for (let z = start + 1; z < row; z++) {
        const value = angularTl(s, t, z, r)
        if (Number.isFinite(value)) return value
      }
      return NaN
    }
    const bottomDepthAt = (angle, radius) => {
      const waterDepth = terrainWaterDepthAt(angle, radius)
      if (!Number.isFinite(waterDepth)) return null
      return Math.min(waterDepth, maxTlDepthM)
    }

    // 外侧壁：从海面一直连到该方位的真实海底深度，底边连续变化。
    for (let s = 0; s < sector; s++) {
      const { a0, a1 } = sectorGeometry(s)
      const subdivisions = Math.max(1, Math.ceil(Math.abs(a1 - a0) / terrainAngleStep))
      for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
        const t0 = subdivision / subdivisions
        const t1 = (subdivision + 1) / subdivisions
        const angle0 = a0 + (a1 - a0) * t0
        const angle1 = a0 + (a1 - a0) * t1
        if (isRemovedAngle((angle0 + angle1) / 2)) continue
        const bottom0 = bottomDepthAt(angle0, distance[outerR])
        const bottom1 = bottomDepthAt(angle1, distance[outerR])
        if (bottom0 == null || bottom1 == null) continue
        if (bottom0 <= 0 && bottom1 <= 0) continue
        for (let segment = 0; segment < wallSegments; segment++) {
          const f0 = segment / wallSegments
          const f1 = (segment + 1) / wallSegments
          const z00 = bottom0 * f0
          const z01 = bottom0 * f1
          const z10 = bottom1 * f0
          const z11 = bottom1 * f1
          pushFace([
            projectPolar(angle0, distance[outerR], z00),
            projectPolar(angle1, distance[outerR], z10),
            projectPolar(angle1, distance[outerR], z11),
            projectPolar(angle0, distance[outerR], z01),
          ], [
            bottomTl(s, t0, z00, outerR), bottomTl(s, t1, z10, outerR),
            bottomTl(s, t1, z11, outerR), bottomTl(s, t0, z01, outerR),
          ], .32 + opacity * .42)
        }
      }
    }

    // 底面：直接铺在真实海底高程上，四角各自跟随水深，避免整面丢弃。
    for (let s = 0; s < sector; s++) {
      const { a0, a1 } = sectorGeometry(s)
      const subdivisions = Math.max(1, Math.ceil(Math.abs(a1 - a0) / terrainAngleStep))
      for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
        const t0 = subdivision / subdivisions
        const t1 = (subdivision + 1) / subdivisions
        const angle0 = a0 + (a1 - a0) * t0
        const angle1 = a0 + (a1 - a0) * t1
        if (isRemovedAngle((angle0 + angle1) / 2)) continue
        for (let radial = 0; radial < bottomRadialNodes.length - 1; radial++) {
          const r0 = bottomRadialNodes[radial]
          const r1 = bottomRadialNodes[radial + 1]
          const d00 = bottomDepthAt(angle0, distance[r0])
          const d10 = bottomDepthAt(angle1, distance[r0])
          const d11 = bottomDepthAt(angle1, distance[r1])
          const d01 = bottomDepthAt(angle0, distance[r1])
          if ([d00, d10, d11, d01].some(value => value == null)) continue
          if (Math.max(d00, d10, d11, d01) <= 0) continue
          pushFace([
            projectPolar(angle0, distance[r0], d00),
            projectPolar(angle1, distance[r0], d10),
            projectPolar(angle1, distance[r1], d11),
            projectPolar(angle0, distance[r1], d01),
          ], [
            bottomTl(s, t0, d00, r0), bottomTl(s, t1, d10, r0),
            bottomTl(s, t1, d11, r1), bottomTl(s, t0, d01, r1),
          ], .22 + opacity * .28)
        }
      }
    }

    // 沿半体的两条切边补出传播损失切面。
    if (clipAngle != null) {
      const sectorForAngle = (angle) => {
        let best = 0
        let bestDiff = Infinity
        for (let index = 0; index < sector; index++) {
          const diff = Math.abs(Math.atan2(
            Math.sin(angle - centerAngles[index]),
            Math.cos(angle - centerAngles[index])
          ))
          if (diff < bestDiff) {
            bestDiff = diff
            best = index
          }
        }
        return best
      }
      for (const boundaryAngle of [clipAngle, clipAngle + Math.PI]) {
        const s = sectorForAngle(boundaryAngle)
        for (let layer = 0; layer < depthNodes.length - 1; layer++) {
          const z0 = depthNodes[layer]
          const z1 = depthNodes[layer + 1]
          for (let radial = 0; radial < radialNodes.length - 1; radial++) {
            const r0 = radialNodes[radial]
            const r1 = radialNodes[radial + 1]
            pushFace([
              polar(boundaryAngle, distance[r0], depthAt(z0)),
              polar(boundaryAngle, distance[r1], depthAt(z0)),
              polar(boundaryAngle, distance[r1], depthAt(z1)),
              polar(boundaryAngle, distance[r0], depthAt(z1)),
            ], [
              rawTl(s, z0, r0), rawTl(s, z0, r1),
              rawTl(s, z1, r1), rawTl(s, z1, r0),
            ], .5 + opacity * .3)
          }
        }
      }
    }

    volumeFaces.sort((a, bValue) => a.order - bValue.order)
      .forEach(face => gradientPolygon(ctx, face.p, face.colors, face.alpha))
    }
    if (controls.rangeRings) {
      ctx.save()
      ctx.strokeStyle = 'rgba(102,226,255,.65)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      const maxRadius = Math.max(...distance.map(Number).filter(Number.isFinite), 0)
      for (const fraction of [.25, .5, .75, 1]) {
        const radius = maxRadius * fraction
        const ring = []
        for (let angle = 0; angle <= Math.PI * 2 + .001; angle += Math.PI / 36) {
          const point = polar(angle, radius, Number(source.depth) || 0)
          if (point) ring.push(point)
        }
        if (ring.length < 3) continue
        ctx.beginPath(); ring.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); ctx.stroke()
        const labelPoint = ring[Math.round(ring.length / 8)]
        if (labelPoint) {
          const label = radius >= 1000
            ? `${(radius / 1000).toFixed(radius >= 10000 ? 0 : 1)} km`
            : `${Math.round(radius)} m`
          ctx.save()
          ctx.setLineDash([])
          ctx.font = '9px ui-monospace, monospace'
          const labelWidth = ctx.measureText(label).width
          ctx.fillStyle = 'rgba(4,20,32,.8)'
          ctx.fillRect(labelPoint.x - 3, labelPoint.y - 8, labelWidth + 6, 12)
          ctx.fillStyle = '#9feeff'
          ctx.fillText(label, labelPoint.x, labelPoint.y)
          ctx.restore()
        }
      }
      ctx.restore()
    }
    if (fieldLayer.primary && Array.isArray(rayScene?.motions) && rayScene.motions.length) {
      const rayAngle = (Number(rayScene.azimuthDeg) || 0) * Math.PI / 180
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const projectPoints = (points) => {
        const out = []
        for (const p of points) {
          const pt = projectPolar(rayAngle, Number(p?.[0]) || 0, Number(p?.[1]) || 0)
          if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) out.push(pt)
        }
        return out
      }
      const strokePath = (pts) => {
        ctx.beginPath()
        pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
        ctx.stroke()
      }
      const layers = [
        { width: 6, factor: 0.13, blur: 9 },
        { width: 2.8, factor: 0.45, blur: 5 },
        { width: 1.3, factor: 0.95, blur: 0 },
      ]
      for (const motion of rayScene.motions) {
        const path = motion?.path
        const tail = motion?.tail
        const head = motion?.head
        // 1) 淡显完整已走路径（生长轨迹）。
        if (Array.isArray(path) && path.length > 1) {
          const pts = projectPoints(path)
          if (pts.length > 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.18)'
            ctx.lineWidth = 1.2
            strokePath(pts)
          }
        }
        // 2) 头部三层光晕拖尾。
        if (Array.isArray(tail) && tail.length > 1) {
          const pts = tail.map(n => projectPolar(rayAngle, Number(n?.point?.[0]) || 0, Number(n?.point?.[1]) || 0))
            .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
          if (pts.length > 1) {
            const tailPoint = pts[0]
            const headPoint = pts[pts.length - 1]
            for (const layer of layers) {
              const gradient = ctx.createLinearGradient(tailPoint.x, tailPoint.y, headPoint.x, headPoint.y)
              gradient.addColorStop(0, 'rgba(255,255,255,0)')
              gradient.addColorStop(0.62, `rgba(255,255,255,${(layer.factor * 0.5).toFixed(3)})`)
              gradient.addColorStop(1, `rgba(255,255,255,${layer.factor.toFixed(3)})`)
              ctx.strokeStyle = gradient
              ctx.lineWidth = layer.width
              ctx.shadowColor = 'rgba(200,240,255,0.85)'
              ctx.shadowBlur = layer.blur
              strokePath(pts)
            }
            ctx.shadowBlur = 0
          }
        }
        // 3) 发光头点：径向光斑 + 白色核心。
        if (head) {
          const hp = projectPolar(rayAngle, Number(head?.[0]) || 0, Number(head?.[1]) || 0)
          if (hp && Number.isFinite(hp.x) && Number.isFinite(hp.y)) {
            const radius = 3.5
            const radial = ctx.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, radius * 5)
            radial.addColorStop(0, 'rgba(255,255,255,0.9)')
            radial.addColorStop(0.28, 'rgba(200,240,255,0.5)')
            radial.addColorStop(1, 'rgba(200,240,255,0)')
            ctx.fillStyle = radial
            ctx.beginPath()
            ctx.arc(hp.x, hp.y, radius * 5, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = 'rgba(255,255,255,0.96)'
            ctx.beginPath()
            ctx.arc(hp.x, hp.y, Math.max(1.3, radius * 0.4), 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.restore()
    }
    // 方向方位线跟随当前选中的声场体；未指定时仍落在首个（当前）声场体上。
    if (isDirectionLayer && directionLine?.visible !== false) {
      const directionAzimuth = Number(directionLine?.azimuthDeg)
      const maxRadius = Math.max(...distance.map(Number).filter(Number.isFinite), 0)
      if (Number.isFinite(directionAzimuth) && maxRadius > 0) {
        const directionAngle = directionAzimuth * Math.PI / 180
        const start = projectPolar(directionAngle, 0, 0)
        const end = projectPolar(directionAngle, maxRadius, 0)
        if ([start.x, start.y, end.x, end.y].every(Number.isFinite)) {
          directionArrow = { start, tip: end, azimuthDeg: directionAzimuth, maxRadius }
          directionProjector = projectPolar
          const dx = end.x - start.x
          const dy = end.y - start.y
          const length = Math.hypot(dx, dy)
          const compass = ((90 - directionAzimuth) % 360 + 360) % 360
          ctx.save()
          ctx.strokeStyle = '#ff2d95'
          ctx.fillStyle = '#ff2d95'
          ctx.shadowColor = 'rgba(255,45,149,.9)'
          ctx.shadowBlur = 7
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.moveTo(start.x, start.y)
          ctx.lineTo(end.x, end.y)
          ctx.stroke()
          if (length > 1) {
            const ux = dx / length
            const uy = dy / length
            const nx = -uy
            const ny = ux
            ctx.beginPath()
            ctx.moveTo(end.x, end.y)
            ctx.lineTo(end.x - ux * 12 + nx * 5, end.y - uy * 12 + ny * 5)
            ctx.lineTo(end.x - ux * 12 - nx * 5, end.y - uy * 12 - ny * 5)
            ctx.closePath()
            ctx.fill()
          }
          ctx.shadowBlur = 0
          ctx.font = '600 12px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          const labelX = start.x + dx * .62
          const labelY = start.y + dy * .62 - 7
          const label = `${Math.round(compass)}°`
          const labelWidth = ctx.measureText(label).width + 10
          ctx.fillStyle = 'rgba(74,11,46,.86)'
          ctx.fillRect(labelX - labelWidth / 2, labelY - 15, labelWidth, 18)
          ctx.fillStyle = '#ffd6e4'
          ctx.fillText(label, labelX, labelY)
          ctx.restore()
        }
      }
    }
    if (source.lon >= b.west && source.lon <= b.east && source.lat >= b.south && source.lat <= b.north) {
      const layerAnchor = project(source.lon, source.lat, -source.depth)
      anchors[fieldLayer.id || `layer-${Object.keys(anchors).length}`] = { x: layerAnchor.x, y: layerAnchor.y }
      if (fieldLayer.primary) anchor = layerAnchor
      const markerColor = fieldLayer.accent || '#00ffc2'
      ctx.fillStyle = markerColor; ctx.shadowColor = markerColor; ctx.shadowBlur = 12
      ctx.beginPath(); ctx.arc(layerAnchor.x, layerAnchor.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0
    }
  }
  if (!anchor && source && source.lon >= b.west && source.lon <= b.east && source.lat >= b.south && source.lat <= b.north) {
    anchor = project(source.lon, source.lat, -source.depth)
    ctx.fillStyle = '#00ffc2'
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2); ctx.fill()
  }
  if (receiver && Number.isFinite(receiver.depthM) && receiver.lon >= b.west && receiver.lon <= b.east && receiver.lat >= b.south && receiver.lat <= b.north) {
    const p = project(receiver.lon, receiver.lat, -receiver.depthM)
    const nowMs = globalThis.performance?.now?.() ?? Date.now()
    // 水波纹使用 4.2 s 周期慢速扩散；定位针尖端固定在接收坐标。
    const pulse = (nowMs % 4200) / 4200
    ctx.save()
    for (let ring = 0; ring < 3; ring += 1) {
      const progress = (pulse + ring / 3) % 1
      const radius = 5 + progress * 19
      ctx.strokeStyle = `rgba(73,230,139,${(0.58 * (1 - progress)).toFixed(3)})`
      ctx.lineWidth = 1.8 - progress * 0.8
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, radius, Math.max(2.5, radius * 0.42), 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    const pinCenterY = p.y - 12
    ctx.fillStyle = '#41e6c0'
    ctx.strokeStyle = '#e7fffb'
    ctx.lineWidth = 1
    ctx.shadowColor = '#49e68b'
    ctx.shadowBlur = 9
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.bezierCurveTo(p.x - 2, p.y - 4, p.x - 7, p.y - 7, p.x - 7, pinCenterY)
    ctx.arc(p.x, pinCenterY, 7, Math.PI, 0)
    ctx.bezierCurveTo(p.x + 7, p.y - 7, p.x + 2, p.y - 4, p.x, p.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#073d49'
    ctx.beginPath(); ctx.arc(p.x, pinCenterY, 2.4, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  const selectedRayProjector = rayProjectorForSource(raySource)
  if (selectedRayProjector) rayProjector = selectedRayProjector
  return {
    points, anchor, anchors, faces, project, mesh, lighting,
    projectPolar: rayProjector,
    directionArrow,
    directionProjector,
  }
}

const AXIS_TICKS = 6
const AXIS_TICK_HALF = 4.5

function formatAxisLon(value) {
  const raw = Number(value)
  const number = ((raw + 180) % 360 + 360) % 360 - 180
  const absolute = Math.abs(number)
  if (absolute < 0.005) return '0.00°'
  if (Math.abs(absolute - 180) < 0.005) return '180.00°'
  return `${absolute.toFixed(2)}°${number >= 0 ? 'E' : 'W'}`
}

function formatAxisLat(value) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? 'N' : 'S'}`
}

function formatAxisDepth(value) {
  return `${Math.round(Math.abs(value)).toLocaleString('en-US')} m`
}

/**
 * 区域地形的三维参考轴。
 *
 * 原点取选区左下角（西/南）的海面位置；两条水平轴是矩形西南角相邻的
 * 长、宽边在海平面的投影，垂直轴从原点向下表示水深。三条轴各 6 个刻度
 * （含原点），不使用箭头。
 */
function drawTerrainAxes(ctx, project, bounds, grid) {
  const origin = project(bounds.west, bounds.south, 0)
  const east = project(bounds.east, bounds.south, 0)
  const north = project(bounds.west, bounds.north, 0)
  const depthMin = Math.min(0, Number(grid.min) || 0)
  const bottom = project(bounds.west, bounds.south, depthMin)
  const center = project(
    (bounds.west + bounds.east) / 2,
    (bounds.south + bounds.north) / 2,
    0
  )
  const points = [origin, east, north, bottom, center]
  if (!points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))) return

  const axes = [
    {
      to: east,
      labelGap: 18,
      label: t => formatAxisLon(bounds.west + (bounds.east - bounds.west) * t),
    },
    {
      to: north,
      labelGap: 56,
      label: t => formatAxisLat(bounds.south + (bounds.north - bounds.south) * t),
    },
  ]
  if (depthMin < 0) {
    axes.push({
      to: bottom,
      labelGap: 14,
      label: t => formatAxisDepth(depthMin * t),
    })
  }

  ctx.save()
  ctx.lineWidth = 1
  ctx.font = '10px monospace'
  ctx.textBaseline = 'middle'

  for (const axis of axes) {
    const dx = axis.to.x - origin.x
    const dy = axis.to.y - origin.y
    const length = Math.hypot(dx, dy)
    if (length < 3) continue

    ctx.strokeStyle = 'rgba(222, 240, 255, 0.78)'
    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(axis.to.x, axis.to.y)
    ctx.stroke()

    // 屏幕空间外法线：刻度文字始终放在远离地形中心的一侧。
    let nx = -dy / length
    let ny = dx / length
    if ((origin.x - center.x) * nx + (origin.y - center.y) * ny < 0) {
      nx = -nx
      ny = -ny
    }

    for (let i = 0; i < AXIS_TICKS; i += 1) {
      const t = i / (AXIS_TICKS - 1)
      const x = origin.x + dx * t
      const y = origin.y + dy * t

      ctx.strokeStyle = 'rgba(235, 248, 255, 0.95)'
      ctx.beginPath()
      ctx.moveTo(x - nx * AXIS_TICK_HALF, y - ny * AXIS_TICK_HALF)
      ctx.lineTo(x + nx * AXIS_TICK_HALF, y + ny * AXIS_TICK_HALF)
      ctx.stroke()

      const gap = axis.labelGap + AXIS_TICK_HALF
      const lx = x + nx * gap
      const ly = y + ny * gap
      ctx.fillStyle = '#d9efff'
      ctx.shadowColor = 'rgba(0, 12, 24, 0.9)'
      ctx.shadowBlur = 3
      if (Math.abs(nx) > 0.45) {
        ctx.textAlign = nx > 0 ? 'left' : 'right'
        ctx.fillText(axis.label(t), lx, ly)
      } else {
        ctx.textAlign = 'center'
        ctx.textBaseline = ny > 0 ? 'top' : 'bottom'
        ctx.fillText(axis.label(t), lx, ly)
        ctx.textBaseline = 'middle'
      }
      ctx.shadowBlur = 0
    }
  }

  // 原点为三条轴共用，画一个小圆点强调六刻度中的共同起点。
  ctx.fillStyle = 'rgba(235, 248, 255, 0.95)'
  ctx.beginPath()
  ctx.arc(origin.x, origin.y, 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

