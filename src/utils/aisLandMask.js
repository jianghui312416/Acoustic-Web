/**
 * 全球陆海掩膜：由本地 GEBCO 高程预生成，0.1° 网格、按位压缩。
 * 只在 AIS 首次连接时懒加载一次，查询为 O(1)，不会进入逐帧渲染路径。
 */
import { createLandPolygonIndex, extractLandPolygonsAsync } from './coastline.js'

const MASK_URL = new URL('../assets/ais-land-mask.bin', import.meta.url).href
const MAGIC_RAW = 'ALM1'
const MAGIC_RLE = 'ALM2'
const HEADER_BYTES = 28
const LOAD_TIMEOUT_MS = 20_000

let activeMask = null
let activeCoastline = null
let maskPromise = null
let coastlinePromise = null

function readMagic(bytes) {
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
}

function decodeRunLengthBits(payload, width, height) {
  const total = width * height
  const bits = new Uint8Array(Math.ceil(total / 8))
  let bit = 0
  let offset = 0
  let land = 0
  while (offset < payload.length && bit < total) {
    let length = 0
    let shift = 0
    let byte = 0
    do {
      if (offset >= payload.length) break
      byte = payload[offset++]
      length |= (byte & 0x7f) << shift
      shift += 7
    } while (byte & 0x80)
    if (!length) continue
    const end = Math.min(total, bit + length)
    if (land) {
      for (let index = bit; index < end; index += 1) {
        bits[index >> 3] |= 1 << (index & 7)
      }
    }
    bit = end
    land ^= 1
  }
  if (bit < total) throw new Error('陆海掩膜数据不完整')
  return bits
}

/** 解析掩膜二进制：magic + width/height + west/north/lonStep/latStep + 位图（ALM1 原始 / ALM2 游程）。 */
export function decodeLandMask(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= HEADER_BYTES) {
    throw new Error('陆海掩膜数据为空')
  }
  const bytes = new Uint8Array(buffer)
  const magic = readMagic(bytes)
  if (magic !== MAGIC_RAW && magic !== MAGIC_RLE) throw new Error('陆海掩膜格式不匹配')
  const view = new DataView(buffer)
  const width = view.getUint32(4, true)
  const height = view.getUint32(8, true)
  const west = view.getFloat32(12, true)
  const north = view.getFloat32(16, true)
  const lonStep = view.getFloat32(20, true)
  const latStep = view.getFloat32(24, true)
  if (!(width > 0 && height > 0 && lonStep > 0 && latStep > 0)) {
    throw new Error('陆海掩膜尺寸无效')
  }
  const expectedBytes = Math.ceil((width * height) / 8)
  const payload = bytes.subarray(HEADER_BYTES)
  if (magic === MAGIC_RAW) {
    if (payload.length < expectedBytes) throw new Error('陆海掩膜数据不完整')
    return { width, height, west, north, lonStep, latStep, bits: payload.subarray(0, expectedBytes) }
  }
  return {
    width,
    height,
    west,
    north,
    lonStep,
    latStep,
    bits: decodeRunLengthBits(payload, width, height),
  }
}

function landAtNumber(mask, longitude, latitude) {
  if (latitude < -90 || latitude > 90) return null
  const wrappedLon = ((longitude + 180) % 360 + 360) % 360 - 180
  let col = Math.floor((wrappedLon - mask.west) / mask.lonStep)
  let row = Math.floor((mask.north - latitude) / mask.latStep)
  if (col < 0) col = 0
  else if (col >= mask.width) col = mask.width - 1
  if (row < 0) row = 0
  else if (row >= mask.height) row = mask.height - 1
  const index = row * mask.width + col
  return ((mask.bits[index >> 3] >> (index & 7)) & 1) === 1
}

/** O(1) 查询：返回 true=陆地、false=海洋、null=掩膜未就绪/坐标无效。 */
export function isLandInMask(mask, lon, lat) {
  if (!mask) return null
  const longitude = Number(lon)
  const latitude = Number(lat)
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  return landAtNumber(mask, longitude, latitude)
}


export function isLandCoordinate(lon, lat) {
  return isLandInMask(activeMask, lon, lat)
}

/** 批量过滤陆地船位；优先使用前端提取的海岸线多边形，未就绪时回退到陆海掩膜。 */
export function filterLandVessels(vessels, mask = activeMask, coastline = activeCoastline) {
  const input = Array.isArray(vessels) ? vessels : []
  if (!mask && !coastline) return { vessels: input, hidden: 0, active: false }
  const visible = []
  let hidden = 0
  for (const vessel of input) {
    const lon = vessel?.longitude
    const lat = vessel?.latitude
    const onLand = coastline
      ? coastline.contains(lon, lat) === true
      : isLandInMask(mask, lon, lat) === true
    if (onLand) hidden += 1
    else visible.push(vessel)
  }
  return { vessels: visible, hidden, active: true }
}

export function isLandMaskReady() {
  return activeMask !== null
}

export function isCoastlineReady() {
  return activeCoastline !== null
}

export function coastlineStats() {
  return activeCoastline
    ? { ready: true, rings: activeCoastline.ringCount, vertices: activeCoastline.vertexCount }
    : { ready: false, rings: 0, vertices: 0 }
}

export function ensureCoastline(mask = activeMask) {
  if (activeCoastline) return Promise.resolve(activeCoastline)
  if (coastlinePromise) return coastlinePromise
  if (!mask) return Promise.resolve(null)
  coastlinePromise = extractLandPolygonsAsync(mask)
    .then((result) => {
      if (!result) return null
      activeCoastline = createLandPolygonIndex(result)
      return activeCoastline
    })
    .catch((error) => {
      console.warn('[AIS] 海岸线提取失败，继续使用陆海掩膜过滤：', error?.message ?? error)
      return null
    })
  return coastlinePromise
}

export function ensureLandMask() {
  if (activeMask) return Promise.resolve(activeMask)
  if (maskPromise) return maskPromise
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller
    ? setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS)
    : 0
  maskPromise = fetch(MASK_URL, { signal: controller?.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    .then((buffer) => {
      activeMask = decodeLandMask(buffer)
      return activeMask
    })
    .catch((error) => {
      console.warn('[AIS] 陆海掩膜加载失败，暂不过滤陆地船位：', error?.message ?? error)
      maskPromise = null
      return null
    })
    .finally(() => {
      if (timer) clearTimeout(timer)
    })
  return maskPromise
}
