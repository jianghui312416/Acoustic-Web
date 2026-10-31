import { normalizeExaggeration, terrainLighting, terrainMesh, terrainSegments, hillshade } from './terrainRendering.js'
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

export function bathymetryColor(height, min = -8000, max = 0) {
  if (height > 0) return [100, 132, 109]
  const t = clamp((height - min) / Math.max(1, Math.min(0, max) - min), 0, 1)
  return [12 + 22 * t, 30 + 78 * t, 65 + 92 * t]
}

export function createTerrainProjection(bounds, size, floor, camera = {}) {
  const yaw = camera.yaw || 0
  const pitch = camera.pitch ?? 0.68
  const scale = Math.min(size.width * .72, size.height * 1.2) * (camera.zoom || 1)
  const cosLat = Math.max(.1, Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180))
  const spanX = (bounds.east - bounds.west) * cosLat
  const spanY = bounds.north - bounds.south
  const span = Math.max(spanX, spanY)
  // X/Y 已按经纬跨度等比例归一化；Z 使用相同的物理米制跨度。
  // 因此倍率 1 是真实纵横比例，而不是按“最大水深”再次归一化后的视觉厚度。
  const horizontalSpanM = Math.max(1, span * 110574)
  const verticalExaggeration = normalizeExaggeration(camera.verticalExaggeration)
  return (lon, lat, elevation) => {
    const x = (lon - (bounds.west + bounds.east) / 2) * cosLat / span
    const y = ((bounds.north + bounds.south) / 2 - lat) / span
    const rx = x * Math.cos(yaw) - y * Math.sin(yaw)
    const ry = x * Math.sin(yaw) + y * Math.cos(yaw)
    const z = elevation / horizontalSpanM * verticalExaggeration
    const perspective = 1 / (1 - ry * .35)
    return { x: size.width * .5 + rx * scale * perspective,
      y: size.height * .40 + (ry * Math.sin(pitch) - z * Math.cos(pitch)) * scale * perspective,
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

/**
 * Canvas 没有逐顶点着色；用共享顶点颜色构造面内线性渐变，避免每个网格单元
 * 使用一个常量色而产生棋盘边界。渐变只作用于显示，不改写 TL 数据。
 */
function gradientPolygon(ctx, points, colors, alpha) {
  if (!points?.length || !colors?.length) return
  const left = averageRgb([colors[0], colors[3] ?? colors[0]])
  const right = averageRgb([colors[1] ?? colors[0], colors[2] ?? colors[0]])
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
  gradient.addColorStop(1, `rgba(${right.join(',')},${alpha})`)
  ctx.beginPath()
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()
}

export function drawTerrainScene(canvas, grid, {
  field,
  source,
  fields = [],
  camera,
  controls = {},
  rayScene = null,
  directionLine = null,
  receiver = null,
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
  const lighting = { ...terrainLighting, zFactor: normalizeExaggeration(controls.terrainExaggeration) }
  const mesh = terrainMesh(grid, terrainSegments({ width, height }, camera?.zoom || 1))
  const points = mesh.vertices.map(v => ({ ...v, ...project(v.lon, v.lat, v.elevation) }))
  const colors = mesh.vertices.map(v => {
    const shade = hillshade(v.slopeX, v.slopeY, lighting)
    return bathymetryColor(v.elevation, grid.min, grid.max).map(c => Math.round(c * shade))
  })
  const faces = mesh.faces.map(indices => {
    const p = indices.map(i => points[i])
    return { p, colors: indices.map(i => colors[i]), order: p.reduce((sum, v) => sum + v.order, 0) / 4 }
  })
  faces.sort((a, b) => a.order - b.order).forEach(f => {
    // Close-up views retain native samples but avoid shading off-screen faces.
    if (f.p.every(p => p.x < 0) || f.p.every(p => p.x > width) ||
        f.p.every(p => p.y < 0) || f.p.every(p => p.y > height)) return
    gradientPolygon(ctx, f.p, f.colors, 1)
  })
  drawTerrainAxes(ctx, project, b, grid)

  let anchor = null
  const anchors = {}
  const fieldLayers = [
    ...(field && source ? [{ id: 'current', field, source, visible: controls.volumeVisible !== false, primary: true }] : []),
    ...(Array.isArray(fields) ? fields : []),
  ]
  for (const fieldLayer of fieldLayers) {
    if (!fieldLayer?.field || !fieldLayer?.source || fieldLayer.visible === false) continue
    const field = fieldLayer.field
    const source = fieldLayer.source
    const { sector, row, col, depth, distance, compassBearings } = field.grid
    const volumeFaces = []
    // sampling 是显示采样上限：减小时提高表面细分，但不再用它抽取独立水平圆盘。
    const samplingQuality = clamp(.01 / (Number(controls.sampling) || .01), .75, 2.25)
    const radialStep = Math.max(1, Math.ceil(Math.max(1, col - 1) / Math.round(54 * samplingQuality)))
    const depthStep = Math.max(1, Math.ceil(Math.max(1, row - 1) / Math.round(44 * samplingQuality)))
    const opacity = clamp((Number(controls.opacity) || 1.7) / 5, .04, 1)
    const alphaPower = clamp(Number(controls.alphaPower) || 1.3, .35, 3)
    const dbMin = Number.isFinite(Number(controls.dbMin)) ? Number(controls.dbMin) : 60
    const dbMax = Math.max(dbMin + 1, Number(controls.dbMax) || 120)
    const rotations = [controls.rotationX, controls.rotationY, controls.rotationZ].map(value => (Number(value) || 0) * Math.PI / 180)
    const offsets = [controls.moveX, controls.moveY, controls.moveZ].map(value => Number(value) || 0)
    const colorStops = Array.isArray(controls.colorStops) && controls.colorStops.length >= 2
      ? controls.colorStops
      : [[0, [255,40,0]], [1, [0,0,127]]]
    const colorAt = (ratio) => {
      const t = clamp(ratio, 0, 1)
      for (let i = 0; i < colorStops.length - 1; i++) {
        const [a, ca] = colorStops[i], [z, cz] = colorStops[i + 1]
        if (t > z && i < colorStops.length - 2) continue
        const q = clamp((t - a) / Math.max(.000001, z - a), 0, 1)
        return ca.map((value, channel) => Math.round(value + (cz[channel] - value) * q))
      }
      return colorStops[colorStops.length - 1][1]
    }
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
    const polar = (angle, radius, z) => {
      const local = rotate(Math.cos(angle) * radius, Math.sin(angle) * radius, -z)
      const lon = source.lon + local.x / (111320 * Math.cos(source.lat * Math.PI / 180))
      const lat = source.lat + local.y / 110574
      if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return null
      const col = Math.round((lon - b.west) / (b.east - b.west) * (grid.width - 1))
      const row = Math.round((b.north - lat) / (b.north - b.south) * (grid.height - 1))
      const floor = grid.values[row * grid.width + col]
      if (!Number.isFinite(floor) || floor >= 0 || local.z < floor) return null
      return project(lon, lat, local.z)
    }
    const projectPolar = (angle, radius, depth = 0) => {
      const local = rotate(Math.cos(angle) * radius, Math.sin(angle) * radius, -depth)
      const lon = source.lon + local.x / (111320 * Math.max(.01, Math.cos(source.lat * Math.PI / 180)))
      const lat = source.lat + local.y / 110574
      return project(lon, lat, local.z)
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
    const averageFinite = (...values) => {
      const valid = values.filter(Number.isFinite)
      return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN
    }
    // 公共角边取两侧扇区均值；相邻表面因此使用完全相同的边界 TL 值。
    const boundaryTl = (boundary, z, r) => averageFinite(
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
      const a = boundaryTlAtDepth(sectorIndex, z, r)
      const bValue = boundaryTlAtDepth(sectorIndex + 1, z, r)
      if (!Number.isFinite(a)) return bValue
      if (!Number.isFinite(bValue)) return a
      return a + (bValue - a) * t
    }
    const depthAt = index => {
      const z = clamp(index, 0, row - 1)
      const lo = Math.floor(z)
      const hi = Math.min(row - 1, lo + 1)
      return Number(depth[lo]) + (Number(depth[hi]) - Number(depth[lo])) * (z - lo)
    }
    const pushFace = (points, values, baseAlpha) => {
      if (points.some(point => !point) || values.some(value => !Number.isFinite(value))) return
      const ratios = values.map(value => clamp((value - dbMin) / (dbMax - dbMin), 0, 1))
      const colors = ratios.map(colorAt)
      const meanRatio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
      const valueOpacity = Math.pow(1 - meanRatio * .42, alphaPower)
      const alpha = clamp(baseAlpha * valueOpacity, .12, .9).toFixed(3)
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

    // 外侧壁：相邻深度节点直接连接，颜色从真实三维 TL 外缘连续插值。
    const outerR = col - 1
    for (let s = 0; s < sector; s++) {
      const { a0, a1, subdivisions } = sectorGeometry(s)
      for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
        const t0 = subdivision / subdivisions
        const t1 = (subdivision + 1) / subdivisions
        const angle0 = a0 + (a1 - a0) * t0
        const angle1 = a0 + (a1 - a0) * t1
        for (let layer = 0; layer < depthNodes.length - 1; layer++) {
          const z0 = depthNodes[layer]
          const z1 = depthNodes[layer + 1]
          pushFace([
            polar(angle0, distance[outerR], depthAt(z0)),
            polar(angle1, distance[outerR], depthAt(z0)),
            polar(angle1, distance[outerR], depthAt(z1)),
            polar(angle0, distance[outerR], depthAt(z1)),
          ], [
            angularTl(s, t0, z0, outerR), angularTl(s, t1, z0, outerR),
            angularTl(s, t1, z1, outerR), angularTl(s, t0, z1, outerR),
          ], .32 + opacity * .42)
        }
      }
    }

    // 底面随每个角度/距离列的最深有效 TL 层变化，保持海底裁剪而非伪造实体底盖。
    const deepestCache = new Map()
    const deepestBoundaryLayer = (boundary, r) => {
      const key = `${wrapSector(boundary)}:${r}`
      if (deepestCache.has(key)) return deepestCache.get(key)
      let found = NaN
      for (let z = row - 1; z >= 0; z--) {
        if (Number.isFinite(boundaryTl(boundary, z, r))) { found = z; break }
      }
      deepestCache.set(key, found)
      return found
    }
    for (let s = 0; s < sector; s++) {
      const { a0, a1, subdivisions } = sectorGeometry(s)
      for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
        const t0 = subdivision / subdivisions
        const t1 = (subdivision + 1) / subdivisions
        const angle0 = a0 + (a1 - a0) * t0
        const angle1 = a0 + (a1 - a0) * t1
        for (let radial = 0; radial < radialNodes.length - 1; radial++) {
          const r0 = radialNodes[radial]
          const r1 = radialNodes[radial + 1]
          const z00 = deepestBoundaryLayer(s, r0)
          const z10 = deepestBoundaryLayer(s + 1, r0)
          const z01 = deepestBoundaryLayer(s, r1)
          const z11 = deepestBoundaryLayer(s + 1, r1)
          if (![z00, z10, z01, z11].every(Number.isFinite)) continue
          const za0 = z00 + (z10 - z00) * t0
          const za1 = z00 + (z10 - z00) * t1
          const zb0 = z01 + (z11 - z01) * t0
          const zb1 = z01 + (z11 - z01) * t1
          pushFace([
            polar(angle0, distance[r0], depthAt(za0)),
            polar(angle1, distance[r0], depthAt(za1)),
            polar(angle1, distance[r1], depthAt(zb1)),
            polar(angle0, distance[r1], depthAt(zb0)),
          ], [
            angularTl(s, t0, za0, r0), angularTl(s, t1, za1, r0),
            angularTl(s, t1, zb1, r1), angularTl(s, t0, zb0, r1),
          ], .22 + opacity * .28)
        }
      }
    }

    volumeFaces.sort((a, bValue) => a.order - bValue.order)
      .forEach(face => gradientPolygon(ctx, face.p, face.colors, face.alpha))
    if (controls.rangeRings) {
      ctx.save()
      ctx.strokeStyle = 'rgba(102,226,255,.65)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      const maxRadius = Math.max(...distance.map(Number).filter(Number.isFinite), 0)
      for (const fraction of [.25, .5, .75, 1]) {
        const ring = []
        for (let angle = 0; angle <= Math.PI * 2 + .001; angle += Math.PI / 36) {
          const point = polar(angle, maxRadius * fraction, Number(source.depth) || 0)
          if (point) ring.push(point)
        }
        if (ring.length < 3) continue
        ctx.beginPath(); ring.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); ctx.stroke()
      }
      ctx.restore()
    }
    if (fieldLayer.primary && Array.isArray(rayScene?.trails) && rayScene.trails.length) {
      const rayAngle = (Number(rayScene.azimuthDeg) || 0) * Math.PI / 180
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const trail of rayScene.trails) {
        if (!Array.isArray(trail) || trail.length < 2) continue
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1]
          const z = trail[i]
          const from = projectPolar(rayAngle, Number(a?.point?.[0]) || 0, Number(a?.point?.[1]) || 0)
          const to = projectPolar(rayAngle, Number(z?.point?.[0]) || 0, Number(z?.point?.[1]) || 0)
          if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) continue
          const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y)
          gradient.addColorStop(0, `rgba(255,92,142,${Math.max(0.08, Number(a.alpha) || 0) * .78})`)
          gradient.addColorStop(1, `rgba(255,244,250,${Math.max(0.12, Number(z.alpha) || 0) * .98})`)
          ctx.strokeStyle = gradient
          ctx.lineWidth = 1.7
          ctx.beginPath()
          ctx.moveTo(from.x, from.y)
          ctx.lineTo(to.x, to.y)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
    if (fieldLayer.primary && directionLine?.visible !== false) {
      const directionAzimuth = Number(directionLine?.azimuthDeg)
      const maxRadius = Math.max(...distance.map(Number).filter(Number.isFinite), 0)
      if (Number.isFinite(directionAzimuth) && maxRadius > 0) {
        const directionAngle = directionAzimuth * Math.PI / 180
        const start = projectPolar(directionAngle, 0, 0)
        const end = projectPolar(directionAngle, maxRadius, 0)
        if ([start.x, start.y, end.x, end.y].every(Number.isFinite)) {
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
    ctx.fillStyle = '#49e68b'
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill()
  }
  return { points, anchor, anchors, faces, project, mesh, lighting }
}

const AXIS_TICKS = 6
const AXIS_TICK_HALF = 4.5

function formatAxisLon(value) {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? 'E' : 'W'}`
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

