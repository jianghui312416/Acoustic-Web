/**
 * tlTxtVolume.js — 将「三维传播损失返回数据」的 loadingTlv 转换为极坐标体纹理
 * ==================================================================================
 *
 * XWOcean Analyse3DTLRD 返回的 loadingTlv 是一个「深度 × 距离」的二维剖面，
 * 并按扇区（sector）重复多份：
 *
 *   row    = 100   深度方向网格数
 *   col    = 300   水平距离方向网格数
 *   sector = 4     扇区数
 *   data   = 400 行 × 300 列，行索引 = sectorIndex * row + depthIndex
 *
 * 本模块将其转换为 SDK 极坐标体渲染管线（NcPolarShaderVolume3DPrimitive）可
 * 消费的纹理对象：
 *
 *   纹理轴  x = path（距离）  y = angle（扇区/方位）  z = depth（深度）
 *
 * 转换后可直接调用 finalizeNcPolarVolume + NcPolarShaderVolume3DPrimitive 渲染，
 * 或通过 SoundField.setVolume 注入。
 *
 * 数据不含声源经纬度，故由调用方传入 sourceLon/sourceLat 定位。
 */

const DEFAULT_SOURCE = { lon: 119, lat: 19.1 }

/** TL 色带默认范围（与 tlColor.js 一致，红→蓝 60–120 dB） */
export const TL_TXT_COLOR_MIN = 60
export const TL_TXT_COLOR_MAX = 120

/**
 * 将 loadingTlv 数据解码为极坐标体纹理对象（未 finalize）。
 *
 * @param {object} tlv - loadingTlv 原始对象
 * @param {object} [opts]
 * @param {number} [opts.sourceLon=119] 声源经度
 * @param {number} [opts.sourceLat=19.1] 声源纬度
 * @param {number} [opts.angleMin=0] 起始方位角（度）
 * @param {number} [opts.angleMax=360] 结束方位角（度）
 * @returns {object} 纹理对象，含 width/height/depth/data/valueMin/valueMax/depthValues/wedgeMeta 等
 */
export function decodeTlTxtVolume(tlv, opts = {}) {
  if (!tlv || !Array.isArray(tlv.data) || tlv.data.length === 0) {
    throw new Error('loadingTlv 数据无效')
  }

  const row = Number(tlv.row) || 0
  const col = Number(tlv.col) || 0
  const sector = Math.max(1, Number(tlv.sector) || 1)
  const profileX = Array.from(tlv.profile?.x ?? [])
  const profileZ = Array.from(tlv.profile?.z ?? [])

  if (row <= 0 || col <= 0) {
    throw new Error('loadingTlv 缺少有效的 row/col')
  }

  // 角度方向插值倍数：4 个扇区之间做线性插值，让体渲染的方位过渡更平滑
  const angleInterp = 2
  const height = Math.max(sector, sector * angleInterp)

  // 深度轴（米）
  const depthValues =
    profileZ.length >= row
      ? profileZ.slice(0, row)
      : Array.from({ length: row }, (_, iz) => iz)

  // 路径（距离）范围（单位：米）
  const pathMinM = profileX[0] ?? 0
  const pathMaxM = profileX[profileX.length - 1] ?? profileX[col - 1] ?? col

  // 计算值范围
  let valueMin = Infinity
  let valueMax = -Infinity
  let validCount = 0
  for (let s = 0; s < sector; s++) {
    for (let z = 0; z < row; z++) {
      const line = tlv.data[s * row + z]
      if (!line) continue
      for (let x = 0; x < col; x++) {
        const v = Number(line[x])
        if (!Number.isFinite(v)) continue
        validCount++
        if (v < valueMin) valueMin = v
        if (v > valueMax) valueMax = v
      }
    }
  }
  if (!Number.isFinite(valueMin)) {
    valueMin = 0
    valueMax = 1
  }
  if (valueMax <= valueMin) valueMax = valueMin + 1

  // 归一化到 0–255（R 通道），A 通道存覆盖率（有效体素 = 255）
  const data = new Uint8Array(col * height * row * 4)
  const norm = (v) => Math.max(0, Math.min(255, Math.round(((v - valueMin) / (valueMax - valueMin)) * 255)))

  for (let z = 0; z < row; z++) {
    for (let y = 0; y < height; y++) {
      // 扇区号（浮点，用于插值）
      const sectorF = sector > 1 ? (y / (height - 1 || 1)) * (sector - 1) : 0
      const s0 = Math.floor(sectorF)
      const s1 = Math.min(sector - 1, s0 + 1)
      const frac = sectorF - s0

      for (let x = 0; x < col; x++) {
        const v0 = Number(tlv.data[s0 * row + z]?.[x])
        const v1 = Number(tlv.data[s1 * row + z]?.[x])
        let v
        let valid
        if (Number.isFinite(v0) && Number.isFinite(v1)) {
          v = v0 + (v1 - v0) * frac
          valid = true
        } else if (Number.isFinite(v0)) {
          v = v0
          valid = true
        } else if (Number.isFinite(v1)) {
          v = v1
          valid = true
        } else {
          v = 0
          valid = false
        }

        const idx = ((z * height) + y) * col + x
        const o = idx * 4
        data[o] = norm(v)
        data[o + 1] = 0
        data[o + 2] = norm(v)
        data[o + 3] = valid ? 255 : 0
      }
    }
  }

  const sourceLon = Number(opts.sourceLon ?? DEFAULT_SOURCE.lon)
  const sourceLat = Number(opts.sourceLat ?? DEFAULT_SOURCE.lat)
  const angleMin = Number(opts.angleMin ?? 0)
  const angleMax = Number(opts.angleMax ?? 360)
  // path 统一用「米」：profileX 本身即米，不再换算成 km
  const pathMaxM_ = Math.max(pathMinM + 1, pathMaxM)

  // pathMinM 取 0：让声源中心（path=0）也能采样到最内圈数据，
  // 避免中心因 pathNorm < 0 被丢弃而渲染成空圈。
  const wedgeMeta = {
    sourceLon,
    sourceLat,
    angleMin,
    angleMax,
    pathMinM: 0,
    pathMaxM: pathMaxM_,
    depthMinM: depthValues[0] ?? 0,
    depthMaxM: depthValues[depthValues.length - 1] ?? depthValues[0] + 1,
  }

  // 由声源 + 最大路径半径估算经纬度外包络（用于定位体与 geo→极坐标采样）
  const mPerDegLat = 110574
  const mPerDegLon = 111320 * Math.cos((sourceLat * Math.PI) / 180)
  const degLat = Math.max(1e-6, pathMaxM_ / mPerDegLat)
  const degLon = Math.max(1e-6, pathMaxM_ / Math.max(1e-6, mPerDegLon))

  return {
    width: col,
    height,
    depth: row,
    data,
    valueMin,
    valueMax,
    lonMin: sourceLon - degLon,
    lonMax: sourceLon + degLon,
    latMin: sourceLat - degLat,
    latMax: sourceLat + degLat,
    depthMin: wedgeMeta.depthMinM,
    depthMax: wedgeMeta.depthMaxM,
    depthValues,
    sourceWidth: col,
    sourceHeight: height,
    sourceDepth: row,
    wedgeMeta,
    validVoxelRatio: validCount / Math.max(1, col * row * sector),
    coordinateMode: 'polar_range_theta_depth',
  }
}
