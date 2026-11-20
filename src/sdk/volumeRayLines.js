import {
  VOLUME_TL_COLOR_MIN,
  VOLUME_TL_COLOR_MAX,
  colorByTlBlueOnly,
  sampleTlColorStops,
} from './tlColor.js'
import { VOLUME_SLICE_MODE } from './shaderVolume3D.js'

const Cesium = window.GeoVis

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/** 方位角归一化到 [0, 360) */
function normalize360(deg) {
  return ((deg % 360) + 360) % 360
}

/** 两个方位角的最小夹角（0~180） */
function azimuthDiffDeg(a, b) {
  const d = Math.abs(normalize360(a) - normalize360(b))
  return Math.min(d, 360 - d)
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpScatterPoint(a, b, t) {
  return {
    rayId: a.rayId,
    longitude: lerp(a.longitude, b.longitude, t),
    latitude: lerp(a.latitude, b.latitude, t),
    depthM: lerp(a.depthM, b.depthM, t),
    tlDb: Number.isFinite(a.tlDb) && Number.isFinite(b.tlDb) ? lerp(a.tlDb, b.tlDb, t) : a.tlDb,
    pathDistM: lerp(a.pathDistM, b.pathDistM, t),
  }
}

function bearingDegFromLonLat(source, lon, lat) {
  const latRad = (source.lat * Math.PI) / 180
  const cosLat = Math.cos(latRad)
  const dxM = (lon - source.lon) * cosLat * 111320
  const dyM = (lat - source.lat) * 110574
  return (Math.atan2(dyM, dxM) * 180) / Math.PI
}

export function positionFromScatterPoint(point, volume) {
  const exag = Math.max(0.5, volume.depthExaggeration ?? 1)
  const offset = volume.displayAltitudeOffset ?? 0
  return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, -point.depthM * exag + offset)
}

/** 逆模型矩阵缓存：按 modelMatrix 实例缓存（体 finalize / refinalize 后才变化） */
const INVERSE_MODEL_CACHE = new WeakMap()
/** 复用的临时坐标，避免每段两次 new Cartesian3 */
const TMP_LOCAL = new Cesium.Cartesian3()

export function worldToVolumeUvw(cartesian, volume) {
  let inverse = INVERSE_MODEL_CACHE.get(volume.modelMatrix)
  if (!inverse) {
    inverse = Cesium.Matrix4.inverseTransformation(volume.modelMatrix, new Cesium.Matrix4())
    INVERSE_MODEL_CACHE.set(volume.modelMatrix, inverse)
  }
  const local = Cesium.Matrix4.multiplyByPoint(inverse, cartesian, TMP_LOCAL)
  const altSpan = volume.bottomAltitude - volume.topAltitude || 1
  return {
    x: local.x / (volume.localHalfWidth * 2) + 0.5,
    y: local.y / (volume.localHalfHeight * 2) + 0.5,
    z: (local.z - volume.topAltitude) / altSpan,
  }
}

export function passesVolumeSliceUvw(uvw, sliceClip, sliceMeta, volume) {
  if (!sliceClip?.enabled) return true

  const threshold = clamp(sliceClip.position ?? 1, 0, 1)
  const mode = sliceClip.mode ?? VOLUME_SLICE_MODE.azimuth
  const meta = sliceMeta || volume.sliceMeta || volume.wedgeMeta || {}

  if (mode === VOLUME_SLICE_MODE.azimuth) {
    const lon = lerp(volume.lonMin, volume.lonMax, clamp(uvw.x, 0, 1))
    const lat = lerp(volume.latMin, volume.latMax, clamp(uvw.y, 0, 1))
    const source = { lon: meta.sourceLon, lat: meta.sourceLat }
    const angleDeg = bearingDegFromLonLat(source, lon, lat)

    if (sliceClip.azimuthDeg != null && Number.isFinite(sliceClip.azimuthDeg)) {
      const angleNorm = ((angleDeg - sliceClip.azimuthDeg + 360) % 360) / 360
      return angleNorm <= threshold
    }

    let angleNorm
    if (meta.isCircle) {
      angleNorm = ((angleDeg - meta.angleMin + 360) % 360) / 360
    } else {
      const span = Math.max(0.001, meta.angleMax - meta.angleMin)
      angleNorm = clamp((angleDeg - meta.angleMin) / span, 0, 1)
    }
    return angleNorm <= threshold
  }
  if (mode === VOLUME_SLICE_MODE.depth) return clamp(uvw.z, 0, 1) <= threshold
  if (mode === VOLUME_SLICE_MODE.lon) return clamp(uvw.x, 0, 1) <= threshold
  return clamp(uvw.y, 0, 1) <= threshold
}

function passesSliceAtPoint(point, volume, sliceClip) {
  const pos = positionFromScatterPoint(point, volume)
  const uvw = worldToVolumeUvw(pos, volume)
  return passesVolumeSliceUvw(uvw, sliceClip, volume.sliceMeta, volume)
}

function findSliceBoundaryT(pointA, pointB, volume, sliceClip, insideA) {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5
    const pass = passesSliceAtPoint(lerpScatterPoint(pointA, pointB, mid), volume, sliceClip)
    if (insideA) {
      if (pass) lo = mid
      else hi = mid
    } else if (pass) {
      hi = mid
    } else {
      lo = mid
    }
  }
  return (lo + hi) * 0.5
}

function clipSegmentPositions(pointA, pointB, volume, sliceClip) {
  // 切面未启用：整段保留，无需任何坐标变换（原实现仍会做两次「世界坐标 → uvw」求值）
  if (!sliceClip?.enabled) {
    return [positionFromScatterPoint(pointA, volume), positionFromScatterPoint(pointB, volume)]
  }

  const passA = passesSliceAtPoint(pointA, volume, sliceClip)
  const passB = passesSliceAtPoint(pointB, volume, sliceClip)

  if (passA && passB) {
    return [positionFromScatterPoint(pointA, volume), positionFromScatterPoint(pointB, volume)]
  }
  if (!passA && !passB) return null

  const tCut = findSliceBoundaryT(pointA, pointB, volume, sliceClip, passA)
  const cutPoint = lerpScatterPoint(pointA, pointB, tCut)
  const cutPos = positionFromScatterPoint(cutPoint, volume)

  if (passA) {
    return [positionFromScatterPoint(pointA, volume), cutPos]
  }
  return [cutPos, positionFromScatterPoint(pointB, volume)]
}

function segmentColor(tlDb, lineAlpha, colorMode = {}, colorStops) {
  if (colorMode.fixed) {
    return Cesium.Color.fromCssColorString(String(colorMode.fixed)).withAlpha(lineAlpha)
  }
  if (colorMode.blue) {
    const alpha = lineAlpha * (colorMode.blueAlpha ?? 0.85)
    return colorByTlBlueOnly(tlDb, VOLUME_TL_COLOR_MIN, VOLUME_TL_COLOR_MAX, alpha)
  }
  if (!Number.isFinite(tlDb)) {
    return Cesium.Color.WHITE.withAlpha(lineAlpha * 0.35)
  }
  if (tlDb < VOLUME_TL_COLOR_MIN || tlDb > VOLUME_TL_COLOR_MAX) {
    return Cesium.Color.WHITE.withAlpha(lineAlpha * 0.55)
  }
  const span = VOLUME_TL_COLOR_MAX - VOLUME_TL_COLOR_MIN
  const t = clamp((tlDb - VOLUME_TL_COLOR_MIN) / span, 0, 1)
  const [r, g, b] = sampleTlColorStops(t, colorStops)
  return new Cesium.Color(r / 255, g / 255, b / 255, lineAlpha)
}

export function groupScatterPointsByRay(points) {
  const map = new Map()
  for (const p of points) {
    if (!map.has(p.rayId)) map.set(p.rayId, [])
    map.get(p.rayId).push(p)
  }
  return [...map.values()]
    .map((ray) => ray.sort((a, b) => a.pathDistM - b.pathDistM))
    .filter((ray) => ray.length >= 2)
}

/**
 * 计算一条声线的代表方位角（度，0 = 正东，90 = 正北）
 *
 * 优先使用散点自带的 `bearingDeg`（如 Bellhop panels 数据的 ray.bearing_deg），
 * 否则取离声源最远的点反算方位（分层网格数据每行即一个方位剖面）。
 *
 * @param {Array<object>} rayPoints 单条声线的散点（按传播距离升序）
 * @param {{lon: number, lat: number}} source 声源点
 * @returns {number} 方位角 [0, 360)，无法计算时为 NaN
 */
export function computeRayBearingDeg(rayPoints, source) {
  for (const p of rayPoints) {
    if (Number.isFinite(p?.bearingDeg)) return normalize360(p.bearingDeg)
  }

  let far = null
  for (const p of rayPoints) {
    if (!Number.isFinite(p?.longitude) || !Number.isFinite(p?.latitude)) continue
    if (!far || (p.pathDistM ?? 0) > (far.pathDistM ?? 0)) far = p
  }
  if (!far || !Number.isFinite(source?.lon) || !Number.isFinite(source?.lat)) return NaN

  return normalize360(bearingDegFromLonLat(source, far.longitude, far.latitude))
}

/**
 * 按方位角筛选声线散点：仅保留「整体走向落在 toleranceDeg 内」的声线，
 * 用于展示单个方位的声线剖面。
 *
 * @param {Array<object>} points 声线散点
 * @param {object} options
 * @param {number} options.azimuthDeg 目标方位（度，0 = 正东）
 * @param {number} [options.toleranceDeg=1] 方位容差（度）
 * @param {number} options.sourceLon 声源经度
 * @param {number} options.sourceLat 声源纬度
 * @returns {Array<object>} 命中方位的声线散点
 */
export function filterRayPointsByAzimuth(points, options = {}) {
  if (!Number.isFinite(Number(options?.azimuthDeg))) return Array.isArray(points) ? points : []
  return filterRaysByAzimuth(groupScatterPointsByRay(points), options).flat()
}

/**
 * 按方位筛选「已分组」的声线（每条声线一组）
 *
 * @param {Array<Array<object>>} rays groupScatterPointsByRay 的输出
 * @param {object} options
 * @param {number} options.azimuthDeg 目标方位（度，0 = 正东）
 * @param {number} [options.toleranceDeg=1] 方位容差（度）
 * @param {number} options.sourceLon 声源经度
 * @param {number} options.sourceLat 声源纬度
 * @returns {Array<Array<object>>} 命中方位的声线
 */
export function filterRaysByAzimuth(rays, options = {}) {
  const { azimuthDeg, toleranceDeg = 1, sourceLon, sourceLat } = options ?? {}
  if (!Array.isArray(rays)) return []
  if (!Number.isFinite(Number(azimuthDeg))) return rays

  const tol = Math.max(0, Number(toleranceDeg) || 0)
  const source = { lon: sourceLon, lat: sourceLat }

  return rays.filter((ray) => {
    const bearing = computeRayBearingDeg(ray, source)
    return Number.isFinite(bearing) && azimuthDiffDeg(bearing, azimuthDeg) <= tol
  })
}

function decimateRay(ray, maxSegments = 320) {
  if (ray.length <= maxSegments + 1) return ray
  const step = Math.max(1, Math.ceil((ray.length - 1) / maxSegments))
  const out = [ray[0]]
  for (let i = step; i < ray.length; i += step) out.push(ray[i])
  const last = ray[ray.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/**
 * 构建与体渲染切面一致的声线 PolylineCollection
 *
 * @param {Array<object>} points 声线散点
 * @param {object} volume finalize 后的体数据
 * @param {object} [options]
 * @param {object} [options.azimuthFilter] 仅绘制该方位的声线：{ azimuthDeg, toleranceDeg, sourceLon, sourceLat }
 */
export function createVolumeRayLineCollection(points, volume, options = {}) {
  const { azimuthFilter = null } = options
  const rays = filterRaysByAzimuth(groupScatterPointsByRay(points), azimuthFilter)
  return createRayLineCollectionFromRays(rays, volume, options)
}

/**
 * 由「已分组声线」构建 PolylineCollection（跳过分组 / 排序，便于上层缓存复用）
 *
 * @param {Array<Array<object>>} rays groupScatterPointsByRay 的输出
 * @param {object} volume finalize 后的体数据
 * @param {object} [options] 同 createVolumeRayLineCollection
 */
export function createRayLineCollectionFromRays(rays, volume, options = {}) {
  const {
    sliceClip = { enabled: false, mode: VOLUME_SLICE_MODE.azimuth, position: 1 },
    lineWidth = 1.5,
    lineAlpha = 0.88,
    maxSegmentsPerRay = 320,
    colorMode = {},
    colorStops,
  } = options

  const collection = new Cesium.PolylineCollection()

  for (const ray of rays ?? []) {
    const decimated = decimateRay(ray, maxSegmentsPerRay)
    for (let i = 0; i < decimated.length - 1; i++) {
      const a = decimated[i]
      const b = decimated[i + 1]
      const positions = clipSegmentPositions(a, b, volume, sliceClip)
      if (!positions || positions.length < 2) continue

      // 段颜色取两端均值（内联，避免每段分配临时数组）
      const aOk = Number.isFinite(a.tlDb)
      const bOk = Number.isFinite(b.tlDb)
      const tl = aOk && bOk ? (a.tlDb + b.tlDb) / 2 : aOk ? a.tlDb : bOk ? b.tlDb : NaN

      collection.add({
        positions,
        width: lineWidth,
        arcType: Cesium.ArcType.NONE,
        material: Cesium.Material.fromType(Cesium.Material.ColorType, {
          color: segmentColor(tl, lineAlpha, colorMode, colorStops),
        }),
      })
    }
  }

  return collection
}
