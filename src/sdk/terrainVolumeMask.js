/**
 * 用 GeoVis 当前地形瓦片进一步裁剪极坐标声场体。
 *
 * Analyse3DTLRD 的 altitudeList 只沿少量扇区提供海底剖面；当传播圆跨过
 * 海岸线时，扇区之间的角向插值仍可能越过真实陆地。本模块在纹理的
 * “方位 × 距离”列上采样数字地球地形：正高程整列视为陆地，负高程还可
 * 作为额外海深约束。仅修改 A 通道，TL 数值和颜色保持原样。
 */

const Cesium = window.GeoVis

const EARTH_RADIUS_M = 6371008.8

function destinationLonLat(lonDeg, latDeg, bearingDeg, distanceM) {
  const angular = Number(distanceM) / EARTH_RADIUS_M
  const bearing = Cesium.Math.toRadians(Number(bearingDeg))
  const lon1 = Cesium.Math.toRadians(Number(lonDeg))
  const lat1 = Cesium.Math.toRadians(Number(latDeg))
  const sinLat2 =
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)))
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    )
  return {
    lon: ((Cesium.Math.toDegrees(lon2) + 540) % 360) - 180,
    lat: Cesium.Math.toDegrees(lat2),
  }
}

/**
 * sampleTerrainMostDetailed 要求地形提供器带瓦片可用性（availability）。
 * GeoVis 打包后类名会被压缩，不能用 constructor.name 判断椭球地形，
 * 统一用 instanceof + 能力检测，避免对椭球地形发起注定失败的采样。
 * @param {object} terrainProvider GeoVis scene.terrainProvider
 * @returns {boolean}
 */
export function canSampleTerrain(terrainProvider) {
  if (!terrainProvider || typeof Cesium?.sampleTerrainMostDetailed !== 'function') {
    return false
  }
  const Ellipsoid = Cesium.EllipsoidTerrainProvider
  if (typeof Ellipsoid === 'function' && terrainProvider instanceof Ellipsoid) return false
  return Boolean(terrainProvider.availability)
}

async function sampleInChunks(provider, positions, chunkSize) {
  const out = []
  for (let start = 0; start < positions.length; start += chunkSize) {
    const chunk = positions.slice(start, start + chunkSize)
    const sampled = await Cesium.sampleTerrainMostDetailed(provider, chunk)
    out.push(...sampled)
  }
  return out
}

/**
 * @param {object} texture decodeTlrdPolarVolume 返回的可变纹理对象
 * @param {object} terrainProvider GeoVis scene.terrainProvider
 * @param {object} [options]
 * @param {number} [options.landThresholdM=1] 高于此海拔视为陆地；0 m 可能代表无海底高程的海面
 * @param {number} [options.chunkSize=1024] 单批地形采样点数
 * @returns {Promise<{supported:boolean,sampledColumns:number,landColumns:number,blockedColumns:number,maskedVoxels:number,visiblePathMaxM:number,sourceOnLand:boolean}>}
 */
export async function maskVolumeByTerrain(texture, terrainProvider, options = {}) {
  const canSample = texture?.data instanceof Uint8Array && canSampleTerrain(terrainProvider)
  if (!canSample) {
    return { supported: false, sampledColumns: 0, landColumns: 0, maskedVoxels: 0, visiblePathMaxM: 0 }
  }

  const width = Math.max(1, Number(texture.width) || 1)
  const height = Math.max(1, Number(texture.height) || 1)
  const depth = Math.max(1, Number(texture.depth) || 1)
  const meta = texture.wedgeMeta ?? {}
  const pathMin = Number(meta.pathMinM) || 0
  const pathMax = Number(meta.pathMaxM) || pathMin + 1
  const angleMin = Number(meta.angleMin) || 0
  const angleMax = Number(meta.angleMax) || 360
  const sourceLon = Number(meta.sourceLon)
  const sourceLat = Number(meta.sourceLat)
  if (!Number.isFinite(sourceLon) || !Number.isFinite(sourceLat)) {
    return { supported: false, sampledColumns: 0, landColumns: 0, maskedVoxels: 0, visiblePathMaxM: 0 }
  }

  // 严格最近邻纹理每行就是一个原始扇区（行中心 = 扇区中心），不能用 y/(height-1)
  // 把行线性铺满 360°，否则海底掩膜会按错误方位采样。
  const strictRows = texture.strictNearest === true
  const positions = new Array(width * height)
  for (let y = 0; y < height; y++) {
    const ty = strictRows ? y / height : height > 1 ? y / (height - 1) : 0
    // shader 的极坐标方位采用罗盘方位：0° 北、90° 东、顺时针。
    const bearing = angleMin + (angleMax - angleMin) * ty
    for (let x = 0; x < width; x++) {
      const tx = width > 1 ? x / (width - 1) : 0
      const pathM = pathMin + (pathMax - pathMin) * tx
      const p = destinationLonLat(sourceLon, sourceLat, bearing, pathM)
      positions[y * width + x] = Cesium.Cartographic.fromDegrees(p.lon, p.lat)
    }
  }

  const sampled = await sampleInChunks(
    terrainProvider,
    positions,
    Math.max(128, Number(options.chunkSize) || 1024)
  )
  const landThresholdM = Number.isFinite(Number(options.landThresholdM))
    ? Number(options.landThresholdM)
    : 1
  const depthValues = Array.isArray(texture.depthValues) ? texture.depthValues : []
  let landColumns = 0
  let blockedColumns = 0
  let maskedVoxels = 0
  const sourceHeight = Number(sampled[0]?.height)
  const sourceOnLand = Number.isFinite(sourceHeight) && sourceHeight > landThresholdM

  for (let y = 0; y < height; y++) {
    let landBarrierReached = false
    for (let x = 0; x < width; x++) {
      const terrainHeight = Number(sampled[y * width + x]?.height)
      if (!Number.isFinite(terrainHeight) && !landBarrierReached) continue
      const isLand = Number.isFinite(terrainHeight) && terrainHeight > landThresholdM
      if (isLand) landBarrierReached = true
      const isBlockedBehindLand = landBarrierReached && !isLand
      const terrainWaterDepth = terrainHeight < -landThresholdM ? -terrainHeight : Infinity
      if (isLand) landColumns++
      else if (isBlockedBehindLand) blockedColumns++
      if (!landBarrierReached && !Number.isFinite(terrainWaterDepth)) continue

      for (let z = 0; z < depth; z++) {
        const sampleDepth = Number(depthValues[z] ?? z)
        if (!landBarrierReached && !(sampleDepth > terrainWaterDepth)) continue
        const alphaIndex = (((z * height + y) * width + x) * 4) + 3
        if (texture.data[alphaIndex] !== 0) {
          texture.data[alphaIndex] = 0
          maskedVoxels++
        }
      }
    }
  }

  // 计算裁剪后仍有数据的最远距离，供相机聚焦实际可见水域；否则仍按原始
  // 73 km 包围圈取景时，海岸附近仅剩的数公里声场会小到几乎看不见。
  let visibleMaxX = -1
  let visibleColumns = 0
  let visibleLonMin = Number.POSITIVE_INFINITY
  let visibleLonMax = Number.NEGATIVE_INFINITY
  let visibleLatMin = Number.POSITIVE_INFINITY
  let visibleLatMax = Number.NEGATIVE_INFINITY
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let visible = false
      for (let z = 0; z < depth; z++) {
        if (texture.data[(((z * height + y) * width + x) * 4) + 3] > 0) {
          visible = true
          break
        }
      }
      if (visible) {
        visibleColumns++
        if (x > visibleMaxX) visibleMaxX = x
        const position = sampled[y * width + x]
        if (position) {
          const lon = Cesium.Math.toDegrees(position.longitude)
          const lat = Cesium.Math.toDegrees(position.latitude)
          visibleLonMin = Math.min(visibleLonMin, lon)
          visibleLonMax = Math.max(visibleLonMax, lon)
          visibleLatMin = Math.min(visibleLatMin, lat)
          visibleLatMax = Math.max(visibleLatMax, lat)
        }
      }
    }
  }
  const visiblePathMaxM = visibleMaxX >= 0
    ? pathMin + ((pathMax - pathMin) * visibleMaxX) / Math.max(1, width - 1)
    : 0

  texture.terrainMask = {
    sampledColumns: sampled.length,
    landColumns,
    blockedColumns,
    maskedVoxels,
    visibleColumns,
    visiblePathMaxM,
    sourceOnLand,
    visibleGeoBounds: Number.isFinite(visibleLonMin)
      ? {
          lonMin: visibleLonMin,
          lonMax: visibleLonMax,
          latMin: visibleLatMin,
          latMax: visibleLatMax,
        }
      : null,
  }
  texture.visiblePathMaxM = visiblePathMaxM
  texture.visibleGeoBounds = texture.terrainMask.visibleGeoBounds
  return { supported: true, ...texture.terrainMask }
}
