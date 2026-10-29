/**
 * NC 极坐标体纹理：纹理轴 = range × theta × depth，渲染时 geo→极坐标 再采样
 */
import { finalizeVolumeTexture } from './shaderVolume3D.js'

export const NC_DEFAULT_SOURCE = { lon: 119, lat: 19.1 }

/**
 * 将 Base64 编码的体数据解码为 Uint8Array（RGBA 字节序列）。
 * @param {string} dataBase64 - Base64 字符串
 * @returns {Uint8Array} 解码后的字节数组
 */
function decodeBase64Volume(dataBase64) {
  const binStr = atob(dataBase64)
  const data = new Uint8Array(binStr.length)
  for (let i = 0; i < binStr.length; i++) data[i] = binStr.charCodeAt(i)
  return data
}

/**
 * 无效体素（A = 0）的 R/G/B 回填：用**最近的有效值**填其归一化值，A 通道保持 0。
 *
 * 背景：3D 纹理按三线性插值采样。若无效体素写成 RGBA(0,0,0,0)，有效体素与其混合时
 * R 通道（归一化 TL）会被拉向 0，插值结果被"稀释"到值域最低端 —— 表现为数据边界
 * （远距离末端、海底以下、无效扇区交界）出现**数据中并不存在的低 TL**，即色标下限色
 * （红）。把无效体素的 RGB 回填成邻近有效值后，插值只在有效值之间进行，不再产生
 * 该类伪影；A 仍为 0，无效体素本身依旧不参与渲染。
 *
 * 采用三个轴向的就地最近邻扩散。旧实现为每个体素额外分配 value、known 和
 * Int32 队列（合计 6 字节/体素）；大体数据在 RGBA 纹理之外会瞬间再占数 GB。
 * 这里直接借用无效体素的 RGBA 字节作为临时标记，额外内存保持 O(1)。
 *
 * @param {Uint8Array} data RGBA 体纹理（R/G/B = 归一化值，A = 有效标记），就地修改
 * @param {number} width x 轴长度（range / 距离）
 * @param {number} height y 轴长度（theta / 方位）
 * @param {number} depth z 轴长度（深度层）
 * @param {{wrapY?:boolean}} [opts] wrapY = 方位轴首尾环绕（扇区环形数据时传 true）
 * @returns {number} 回填的体素数（未被任何有效体素连通到的空洞返回时仍为 0 值）
 */
export function fillInvalidVoxelRgb(data, width, height, depth, opts = {}) {
  const w = Math.max(1, Math.floor(Number(width)) || 0)
  const h = Math.max(1, Math.floor(Number(height)) || 0)
  const d = Math.max(1, Math.floor(Number(depth)) || 0)
  const n = w * h * d
  if (!data || data.length < n * 4) return 0
  const wrapY = opts.wrapY === true
  let valid = 0
  let unknown = 0
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] > 0) valid++
    else unknown++
  }
  if (!unknown || valid === 0) return 0

  // 临时填充值使用 A=1、B=R^255 标记。原始有效体素是灰度 RGB，因此即使其
  // 覆盖率恰好为 1，也不会被清理阶段误认为临时体素。
  const isKnown = (voxel) => data[voxel * 4 + 3] > 0
  const copyTemporary = (target, source) => {
    const targetOffset = target * 4
    const value = data[source * 4]
    data[targetOffset] = value
    data[targetOffset + 1] = value
    data[targetOffset + 2] = value ^ 255
    data[targetOffset + 3] = 1
  }

  /** 沿一条轴线把已知点之间的空洞按最近端点填满。 */
  const fillLine = (start, step, length, circular = false) => {
    let first = -1
    let previous = -1
    for (let p = 0; p < length; p++) {
      const voxel = start + p * step
      if (!isKnown(voxel)) continue
      if (first < 0) first = p
      if (previous >= 0 && p - previous > 1) {
        const left = start + previous * step
        const right = voxel
        for (let q = previous + 1; q < p; q++) {
          copyTemporary(start + q * step, q - previous <= p - q ? left : right)
        }
      }
      previous = p
    }
    if (first < 0) return

    const firstVoxel = start + first * step
    const lastVoxel = start + previous * step
    if (circular && first !== previous) {
      for (let q = previous + 1; q < length; q++) {
        const fromLast = q - previous
        const fromFirst = length - q + first
        copyTemporary(start + q * step, fromLast <= fromFirst ? lastVoxel : firstVoxel)
      }
      for (let q = 0; q < first; q++) {
        const fromLast = length - previous + q
        const fromFirst = first - q
        copyTemporary(start + q * step, fromLast < fromFirst ? lastVoxel : firstVoxel)
      }
    } else {
      for (let q = 0; q < first; q++) copyTemporary(start + q * step, firstVoxel)
      for (let q = previous + 1; q < length; q++) copyTemporary(start + q * step, lastVoxel)
    }
  }

  const plane = w * h
  for (let z = 0; z < d; z++) {
    for (let y = 0; y < h; y++) fillLine(z * plane + y * w, 1, w)
  }
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) fillLine(z * plane + x, w, h, wrapY)
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) fillLine(y * w + x, plane, d)
  }

  let filled = 0
  for (let i = 0; i < n; i++) {
    const offset = i * 4
    if (data[offset + 3] !== 1 || data[offset + 2] !== (data[offset] ^ 255)) continue
    data[offset + 2] = data[offset]
    data[offset + 3] = 0
    filled++
  }
  return filled
}

/**
 * 统计有效体素数量（以 RGBA 的 A 通道 > 0 判定有效）。
 * @param {Uint8Array} data - RGBA 体数据
 * @returns {number} 有效体素个数
 */
function countValidVoxels(data) {
  let n = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) n++
  }
  return n
}

/**
 * 解码极坐标体 JSON（version 1 旧版 / version 3 新版）
 */
export function decodeNcPolarVolumeJson(raw) {
  if (!raw?.texture?.dataBase64) {
    throw new Error('体 JSON 格式无效')
  }

  const mode = raw.coordinateMode ?? (raw.version === 1 ? 'polar_range_theta_depth' : null)
  if (mode === 'geo_lon_lat_depth') {
    throw new Error('当前为经纬落格体（易呈米字放射），请运行 npm run preprocess:volume 生成极坐标体 JSON')
  }

  const data = decodeBase64Volume(raw.texture.dataBase64)
  const totalCells = raw.texture.width * raw.texture.height * raw.texture.depth
  const validCount = countValidVoxels(data)

  const rawWedge = raw.wedgeMeta ?? {}
  // 经纬度 / 数值字段若为 null、NaN 等无效值，回退到默认值
  const srcLon = Number(rawWedge.sourceLon)
  const srcLat = Number(rawWedge.sourceLat)
  // 统一 path 单位为「米」：兼容旧数据（pathMinKm/pathMaxKm 千米）与新数据（pathMinM/pathMaxM 米）
  const wedge = {
    sourceLon: Number.isFinite(srcLon) ? srcLon : NC_DEFAULT_SOURCE.lon,
    sourceLat: Number.isFinite(srcLat) ? srcLat : NC_DEFAULT_SOURCE.lat,
    angleMin: rawWedge.angleMin ?? -180,
    angleMax: rawWedge.angleMax ?? 180,
    pathMinM: rawWedge.pathMinM ?? (rawWedge.pathMinKm ?? 0) * 1000,
    pathMaxM: rawWedge.pathMaxM ?? (rawWedge.pathMaxKm ?? 50) * 1000,
    depthMinM: rawWedge.depthMinM ?? raw.bounds.depth.min,
    depthMaxM: rawWedge.depthMaxM ?? raw.bounds.depth.max,
  }

  const depthValues = raw.depthValues?.length
    ? raw.depthValues
    : Array.from({ length: raw.texture.depth }, (_, iz) => {
        const t = iz / Math.max(1, raw.texture.depth - 1)
        return raw.bounds.depth.min + t * (raw.bounds.depth.max - raw.bounds.depth.min)
      })

  return {
    width: raw.texture.width,
    height: raw.texture.height,
    depth: raw.texture.depth,
    data,
    // 显式启用三维纹理线性过滤，避免不同入口加载时退化为最近邻块状采样。
    textureFilter: 'linear',
    valueMin: raw.bounds.value.min,
    valueMax: raw.bounds.value.max,
    lonMin: raw.bounds.lon.min,
    lonMax: raw.bounds.lon.max,
    latMin: raw.bounds.lat.min,
    latMax: raw.bounds.lat.max,
    depthMin: raw.bounds.depth.min,
    depthMax: raw.bounds.depth.max,
    depthValues,
    sourceWidth: raw.texture.width,
    sourceHeight: raw.texture.height,
    sourceDepth: raw.texture.depth,
    wedgeMeta: wedge,
    validVoxelRatio: raw.validVoxelRatio ?? validCount / Math.max(1, totalCells),
    coordinateMode: mode ?? 'polar_range_theta_depth',
  }
}

/** 极坐标体 + 深度夸张 + wedgeMeta，供 WedgeShaderVolume3DPrimitive 使用 */
export function finalizeNcPolarVolume(texture, depthExaggeration = 24, options = {}) {
  const finalized = finalizeVolumeTexture(texture, depthExaggeration, options)
  const wedge = texture.wedgeMeta ?? {}
  return {
    ...finalized,
    wedgeMeta: {
      sourceLon: wedge.sourceLon ?? NC_DEFAULT_SOURCE.lon,
      sourceLat: wedge.sourceLat ?? NC_DEFAULT_SOURCE.lat,
      angleMin: wedge.angleMin ?? -180,
      angleMax: wedge.angleMax ?? 180,
      pathMinM: wedge.pathMinM ?? 0,
      pathMaxM: wedge.pathMaxM ?? 50000,
      depthMinM: wedge.depthMinM ?? texture.depthMin,
      depthMaxM: wedge.depthMaxM ?? texture.depthMax,
    },
  }
}
