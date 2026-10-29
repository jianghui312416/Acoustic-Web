/**
 * ncTlrdParser.js — 三维传播损失「标准格式」（Analyse3DTLRD）解析
 * ==================================================================
 *
 * 以 `response_Analyse3DTLRD.json`（XWOcean 三维传播损失分析返回数据）作为
 * 三维声场数据的**标准输入格式**，将其解析为结构化声场对象，并进一步转换为
 * SDK 极坐标体渲染管线（`NcPolarShaderVolume3DPrimitive` / `SoundField`）
 * 可消费的体纹理对象。
 *
 * 标准格式结构：
 *
 *   Data.Units[0].Response = {
 *     calcFrequency: 100,                 // 计算频率（Hz）
 *     altitudeList:      { size, pairedDataVS: [{ size, x, y } × sector] },  // 海底高程
 *     reconstructDataVS: { size, x, y },                                     // 声速剖面
 *     loadingTlv:        { row, col, sector, size, profile: { x, z }, data } // TL 体数据
 *   }
 *
 * 体数据语义（当前门户为 loadingTlv.data；兼容旧格式 loadingTlv.profile.data）：
 *   - 行数 = sector × row，行索引 = sectorIndex * row + depthIndex（扇区优先）
 *   - 每行 col 个值，对应 profile.x（水平距离，米）
 *   - 值 = 传播损失 TL（dB）
 *
 * 无效值（必须在统计与渲染前剔除）：
 *   - 200  ：水体内的无效值（声线未覆盖 / 未参与解算）
 *   - 9999 ：海底以下与陆地部分（超出该扇区海深范围）
 *
 * 数据本身不含经纬度，声源位置与方位基准由调用方指定。
 */

/** 默认声源位置（标准格式不含经纬度，用作渲染定位的缺省值） */
export const TLRD_DEFAULT_SOURCE = { lon: 119, lat: 19.1 }

/** 标准格式的插件名，用于在 Units 中筛选传播损失单元 */
export const TLRD_PLUGIN = 'Analyse3DTLRD'

/** 水体内无效值（声线未覆盖 / 未参与解算） */
export const TLRD_INVALID_WATER = 200

/** 海底以下与陆地部分的无效值（超出海深范围） */
export const TLRD_INVALID_SUBSTRATE = 9999

import { fillInvalidVoxelRgb } from './ncVolumeBuilder.js'

/** 纬度每度对应米数 */
const M_PER_DEG_LAT = 110574
/** 赤道处经度每度对应米数 */
const M_PER_DEG_LON = 111320

/**
 * 判断 TL 值是否有效（排除水体无效值与海底以下/陆地无效值）。
 * @param {number} v - 原始 TL 值
 * @returns {boolean} true = 有效
 */
export function isTlrdValidValue(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return false
  return n !== TLRD_INVALID_WATER && n !== TLRD_INVALID_SUBSTRATE
}

/**
 * 归一化 TL 值：有效返回数值，无效返回 NaN。
 * @param {number} v - 原始 TL 值
 * @returns {number} TL（dB）或 NaN
 */
export function normalizeTlrdValue(v) {
  return isTlrdValidValue(v) ? Number(v) : NaN
}

/** 解析后的三维声场数据（标准格式） */
export class TlrdSoundFieldData {
  constructor() {
    /** @type {{sn:number|null, taskId:string, selfOrder:number, plugin:string, resultCode:number|null, frequencyHz:number|null}} */
    this.meta = {
      sn: null,
      taskId: '',
      selfOrder: 0,
      plugin: '',
      resultCode: null,
      frequencyHz: null,
    }
    /** @type {{sector:number, row:number, col:number, distance:number[], depth:number[], compassBearings:number[]}} */
    this.grid = { sector: 0, row: 0, col: 0, distance: [], depth: [], compassBearings: [] }
    /** @type {Float32Array} TL 体数据，索引 = (sectorIndex * row + depthIndex) * col + distanceIndex，无效值为 NaN */
    this.tl = new Float32Array(0)
    /** @type {number[][]} 海底高程（m，海面 0、向下为负），[sectorIndex][distanceIndex] */
    this.bottom = []
    /** @type {{depth:number[], speed:number[]}} 声速剖面（reconstructDataVS） */
    this.soundProfile = { depth: [], speed: [] }
    /** @type {{validCount:number, invalidWaterCount:number, invalidSubstrateCount:number, valueMin:number, valueMax:number, mean:number}} */
    this.stats = {
      validCount: 0,
      invalidWaterCount: 0,
      invalidSubstrateCount: 0,
      valueMin: Infinity,
      valueMax: -Infinity,
      mean: NaN,
    }
  }

  /** 有效 TL 最小值（dB） */
  get valueMin() {
    return this.stats.validCount > 0 ? this.stats.valueMin : 0
  }

  /** 有效 TL 最大值（dB） */
  get valueMax() {
    return this.stats.validCount > 0 ? this.stats.valueMax : 1
  }

  /**
   * 读取指定位置的 TL（dB）。
   * @param {number} sectorIndex 扇区索引（0 起）
   * @param {number} depthIndex 深度层索引（0 起）
   * @param {number} distanceIndex 距离点索引（0 起）
   * @returns {number} TL（dB），越界或无效返回 NaN
   */
  at(sectorIndex, depthIndex, distanceIndex) {
    const { sector, row, col } = this.grid
    if (sectorIndex < 0 || sectorIndex >= sector) return NaN
    if (depthIndex < 0 || depthIndex >= row) return NaN
    if (distanceIndex < 0 || distanceIndex >= col) return NaN
    return this.tl[(sectorIndex * row + depthIndex) * col + distanceIndex]
  }

  /**
   * 判断某网格点是否位于海底以下（或陆地），依据该扇区海底高程判断。
   * @param {number} sectorIndex 扇区索引
   * @param {number} depthIndex 深度层索引
   * @param {number} [distanceIndex=0] 距离点索引
   * @returns {boolean} true = 在海底以下
   */
  isBelowSeabed(sectorIndex, depthIndex, distanceIndex = 0) {
    const altitude = this.bottom?.[sectorIndex]?.[distanceIndex]
    if (!Number.isFinite(altitude)) return false
    const depth = this.grid.depth[depthIndex]
    if (!Number.isFinite(depth)) return false
    // altitude >= 0 表示陆地/岸线，不存在水柱；海底高程为负值。
    return altitude >= 0 || depth > -altitude
  }

  /**
   * 读取某扇区、某距离点的**海底深度**（米，海面 0、向下为正）。
   *
   * 原始数据 `altitudeList.pairedDataVS[s].y` 是海底**高程**（海面 0、向下为负），
   * 这里取绝对值得到与 `grid.depth` 同一口径的海深，便于「距离—深度」剖面绘制地形。
   *
   * @param {number} sectorIndex 扇区索引（0 起）
   * @param {number} distanceIndex 距离点索引（0 起）
   * @returns {number} 海底深度（米，正），无数据或无效返回 NaN
   */
  seabedDepthAt(sectorIndex, distanceIndex) {
    const altitude = Number(this.bottom?.[sectorIndex]?.[distanceIndex])
    if (!Number.isFinite(altitude)) return NaN
    return altitude < 0 ? -altitude : 0
  }

  /**
   * 提取某扇区的海底地形曲线（海底深度，米，向下为正），长度与距离轴 `grid.distance` 一致。
   * @param {number} sectorIndex 扇区索引（0 起）
   * @returns {number[]} 每个距离点对应的海深（米），无效为 NaN
   */
  seabedDepths(sectorIndex) {
    const { col } = this.grid
    const out = new Array(col)
    for (let ix = 0; ix < col; ix++) out[ix] = this.seabedDepthAt(sectorIndex, ix)
    return out
  }

  /**
   * 提取单个扇区的「深度 × 距离」竖直剖面（二维）。
   * @param {number} sectorIndex 扇区索引
   * @returns {{distance:number[], depth:number[], values:number[][], bottom:number[], valueMin:number, valueMax:number}|null}
   *   values 为 row 行 × col 列（行主序），无效值为 NaN
   */
  sliceSector(sectorIndex) {
    const { sector, row, col } = this.grid
    if (sectorIndex < 0 || sectorIndex >= sector) return null
    const values = []
    for (let iz = 0; iz < row; iz++) {
      const line = new Array(col)
      for (let ix = 0; ix < col; ix++) {
        line[ix] = this.tl[(sectorIndex * row + iz) * col + ix]
      }
      values.push(line)
    }
    return {
      distance: this.grid.distance,
      depth: this.grid.depth,
      bottom: this.bottom[sectorIndex] ?? [],
      values,
      valueMin: this.valueMin,
      valueMax: this.valueMax,
    }
  }
}

/**
 * 在 Units 中定位三维传播损失单元。
 * @param {object} json 原始 JSON
 * @returns {object|null} Unit 对象
 */
function findTlrdUnit(json) {
  const units = json?.Data?.Units
  if (!Array.isArray(units) || units.length === 0) return null
  return units.find((u) => u?.Plugin === TLRD_PLUGIN && u?.Response) ?? units.find((u) => u?.Response) ?? null
}

/**
 * 解析「三维传播损失标准格式」JSON。
 *
 * 同一份 JSON 会被体解码、二维声场、方位剖面图等多处消费，解析结果（只读）按 JSON 对象缓存，
 * 避免同一份数据被反复解析（O(n) → 仅首次 O(n)）。
 *
 * @param {object} json - 已 JSON.parse 的原始对象
 * @param {object} [opts]
 * @param {number[]} [opts.invalidValues=[200, 9999]] 额外视为无效的数值
 * @returns {TlrdSoundFieldData} 只读实例（缓存实例请勿修改）
 */
const PARSE_CACHE = new WeakMap()

export function parseAnalyse3DTlrd(json, opts = {}) {
  // 已解析的紧凑模型可以直接在图表、切面和体渲染之间复用。这样视图层在完成
  // 解码后即可释放门户返回的多层 JavaScript 数组。
  if (json instanceof TlrdSoundFieldData) return json
  // 仅默认参数（无额外无效值）时使用缓存，保证缓存结果与入参一一对应
  const cacheable = !!json && typeof json === 'object' && Object.keys(opts).length === 0
  if (cacheable) {
    const cached = PARSE_CACHE.get(json)
    if (cached) return cached
  }

  const unit = findTlrdUnit(json)
  if (!unit) {
    throw new Error('无效的三维传播损失数据：缺少 Data.Units[].Response')
  }
  const response = unit.Response ?? {}
  const tlv = response.loadingTlv
  // 当前 backworker/api_endpoints 的三维接口把坐标轴放在 profile，矩阵放在
  // loadingTlv.data；历史静态响应曾把矩阵放在 profile.data。两种格式均可渲染。
  const tlRows = Array.isArray(tlv?.data)
    ? tlv.data
    : Array.isArray(tlv?.profile?.data)
      ? tlv.profile.data
      : null
  if (!tlRows?.length) {
    throw new Error('无效的三维传播损失数据：缺少 loadingTlv.data')
  }

  const extra = new Set(Array.isArray(opts.invalidValues) ? opts.invalidValues.map(Number) : [])
  const hasExtra = extra.size > 0

  const result = new TlrdSoundFieldData()
  result.meta = {
    sn: Number.isFinite(Number(json?.Data?.SN)) ? Number(json.Data.SN) : null,
    taskId: json?.Data?.TaskId ?? '',
    selfOrder: Number(json?.Data?.SelfOrder) || 0,
    plugin: unit.Plugin ?? TLRD_PLUGIN,
    resultCode: Number.isFinite(Number(unit.ResultCode)) ? Number(unit.ResultCode) : null,
    frequencyHz: Number.isFinite(Number(response.calcFrequency)) ? Number(response.calcFrequency) : null,
  }

  // ---- 网格定义 ----
  const col = Math.max(0, Number(tlv.col) || Number(tlv.profile.x?.length) || 0)
  const row = Math.max(0, Number(tlv.row) || Number(tlv.profile.z?.length) || 0)
  const rawRows = tlRows.length
  const declaredSector = Math.max(1, Number(tlv.sector) || 1)
  // 行数应为 sector × row；数据缺失时按实际行数反推扇区数
  const sector =
    row > 0 && rawRows > 0 ? Math.max(1, Math.round(rawRows / row)) || declaredSector : declaredSector
  if (row <= 0 || col <= 0) {
    throw new Error('无效的三维传播损失数据：loadingTlv 缺少有效的 row/col')
  }

  result.grid = {
    sector,
    row,
    col,
    distance: buildAxis(tlv.profile.x, col),
    depth: buildAxis(tlv.profile.z, row),
    // Bellhop/门户使用导航方位：正北 0°、顺时针。当前门户响应未显式返回
    // theta_deg 时，后端仍固定用 0（含）到 360（不含）的等间距采样。
    compassBearings:
      Array.isArray(tlv.azimuths) && tlv.azimuths.length === sector
        ? Array.from(tlv.azimuths, Number)
        : Array.from({ length: sector }, (_, s) => (s * 360) / sector),
  }

  // ---- 海底/陆地高程（altitudeList）----
  // 先于 TL 体解析，以便即使后端未把陆地写成 9999，也能按高程主动剔除。
  const paired = response.altitudeList?.pairedDataVS
  if (Array.isArray(paired)) {
    result.bottom = paired
      .slice(0, sector)
      .map((p) => (Array.isArray(p?.y) ? Array.from(p.y, Number) : []))
  }

  // ---- TL 体数据（扇区优先：sectorIndex * row + depthIndex）----
  const tl = new Float32Array(sector * row * col)
  tl.fill(NaN)
  let validCount = 0
  let invalidWaterCount = 0
  let invalidSubstrateCount = 0
  let sum = 0
  let vMin = Infinity
  let vMax = -Infinity
  for (let s = 0; s < sector; s++) {
    for (let iz = 0; iz < row; iz++) {
      const line = tlRows[s * row + iz]
      if (!line) continue
      const base = (s * row + iz) * col
      for (let ix = 0; ix < col; ix++) {
        const n = Number(line[ix])
        if (!Number.isFinite(n)) continue
        const bottomAltitude = Number(result.bottom?.[s]?.[ix])
        const sampleDepth = Number(result.grid.depth[iz])
        // 正高程为陆地；负高程的绝对值为海深。两类都不得出现水声 TL。
        if (
          Number.isFinite(bottomAltitude) &&
          Number.isFinite(sampleDepth) &&
          (bottomAltitude >= 0 || sampleDepth > -bottomAltitude)
        ) {
          invalidSubstrateCount++
          continue
        }
        if (n === TLRD_INVALID_WATER) {
          invalidWaterCount++
          continue
        }
        if (n === TLRD_INVALID_SUBSTRATE) {
          invalidSubstrateCount++
          continue
        }
        if (hasExtra && extra.has(n)) continue
        tl[base + ix] = n
        validCount++
        sum += n
        if (n < vMin) vMin = n
        if (n > vMax) vMax = n
      }
    }
  }
  result.tl = tl
  result.stats = {
    validCount,
    invalidWaterCount,
    invalidSubstrateCount,
    valueMin: validCount > 0 ? vMin : Infinity,
    valueMax: validCount > 0 ? vMax : -Infinity,
    mean: validCount > 0 ? sum / validCount : NaN,
  }

  // ---- 声速剖面（reconstructDataVS）----
  const rvs = response.reconstructDataVS
  if (rvs) {
    result.soundProfile = {
      depth: Array.isArray(rvs.x) ? Array.from(rvs.x, Number) : [],
      speed: Array.isArray(rvs.y) ? Array.from(rvs.y, Number) : [],
    }
  }

  if (cacheable) PARSE_CACHE.set(json, result)
  return result
}

/**
 * 构建坐标轴：优先使用数据自带轴，缺失时按索引合成 0..n-1。
 * @param {number[]} src 原始轴数组
 * @param {number} n 轴长度
 * @returns {number[]}
 */
function buildAxis(src, n) {
  if (Array.isArray(src) && src.length >= n) {
    return Array.from(src.slice(0, n), Number)
  }
  return Array.from({ length: n }, (_, i) => i)
}

/**
 * 将解析后的三维声场数据转换为极坐标体纹理对象（未 finalize），
 * 可直接交给 `finalizeNcPolarVolume` + `NcPolarShaderVolume3DPrimitive` 渲染。
 *
 * 体纹理轴： width = range（距离）  height = theta（方位）  depth = depth（深度）
 *
 * @param {TlrdSoundFieldData} parsed - parseAnalyse3DTlrd 的返回结果
 * @param {object} [opts]
 * @param {number} [opts.sourceLon=119] 声源经度
 * @param {number} [opts.sourceLat=19.1] 声源纬度
 * @param {number} [opts.angleMin=0] 起始方位角（度，罗盘方位）
 * @param {number} [opts.angleMax=360] 结束方位角（度）
 * @param {number} [opts.angleInterp=2] 扇区之间的方位插值倍数（让方位过渡平滑）
 * @param {boolean} [opts.wrapTheta=true] 方位轴首尾环绕（360° 连续），扇区按环形插值
 * @returns {object} 纹理对象，含 width/height/depth/data/valueMin/valueMax/depthValues/wedgeMeta 等
 */
export function decodeTlrdPolarVolume(parsed, opts = {}) {
  const grid = parsed?.grid
  if (!grid || grid.row <= 0 || grid.col <= 0 || grid.sector <= 0) {
    throw new Error('三维声场数据无效：缺少网格定义')
  }
  const { sector, row, col } = grid

  const srcLon = Number(opts.sourceLon)
  const srcLat = Number(opts.sourceLat)
  const sourceLon = Number.isFinite(srcLon) ? srcLon : TLRD_DEFAULT_SOURCE.lon
  const sourceLat = Number.isFinite(srcLat) ? srcLat : TLRD_DEFAULT_SOURCE.lat
  const angleMin = Number.isFinite(Number(opts.angleMin)) ? Number(opts.angleMin) : 0
  const angleMax = Number.isFinite(Number(opts.angleMax)) ? Number(opts.angleMax) : 360
  // 方位插值倍数：扇区之间做线性插值，默认 2（与 tlTxtVolume 一致，让方位过渡平滑）
  const angleInterp = Math.max(1, Number(opts.angleInterp) || 2)
  const wrapTheta = opts.wrapTheta !== false

  // RGBA 体纹理为 4 字节/体素，还会上传一份到 GPU。固定 8 倍方位插值会在
  // 大网格上生成数亿体素，因此按体素预算自适应降低方位采样；小数据保持原样。
  // 16M RGBA 体素约 64 MiB；配合一份 GPU 纹理，能把单结果的可视化部分稳定
  // 控制在百 MB 级，同时仍高于常见屏幕能分辨出的有效三维采样密度。
  const maxVoxels = Math.max(1, Number(opts.maxVoxels) || 16 * 1024 * 1024)
  const maxHeight = Math.max(2, Math.floor(maxVoxels / Math.max(1, col * row)))

  // 环形方位纹理首尾各保留一行相同扇区，避免 CLAMP_TO_EDGE 在 0°/360° 处
  // 产生断缝；非环形数据仍保持普通插值行数。
  const requestedHeight = wrapTheta && sector > 1
    ? Math.max(sector + 1, Math.round(sector * angleInterp) + 1)
    : Math.max(sector, Math.round(sector * angleInterp))
  const minHeight = requestedHeight > 1 ? 2 : 1
  const height = Math.max(minHeight, Math.min(requestedHeight, maxHeight))
  const depthValues = grid.depth.slice(0, row)

  // 值域：仅统计有效体素（200 / 9999 已在上一步被剔除）
  let vMin = Number.isFinite(parsed.stats.valueMin) ? parsed.stats.valueMin : Infinity
  let vMax = Number.isFinite(parsed.stats.valueMax) ? parsed.stats.valueMax : -Infinity
  if (!Number.isFinite(vMin) || !Number.isFinite(vMax) || vMax <= vMin) {
    vMin = 0
    vMax = 1
  }

  const data = new Uint8Array(col * height * row * 4)
  // 归一化：预计算缩放系数，热循环内直接算 0–255（等价于 round((v-vMin)/(vMax-vMin)*255)）
  const normScale = 255 / (vMax - vMin)
  let validCount = 0

  // 纹理行 → 扇区插值参数：只与 y 有关，提到深度循环外预计算（原为每层重复计算）
  const s0Arr = new Int32Array(height)
  const s1Arr = new Int32Array(height)
  const fracArr = new Float64Array(height)
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0
    // 环形：最后一行回到 sector 0；非环形：首尾精确落在首/末扇区。
    const sectorF = wrapTheta ? t * sector : t * Math.max(0, sector - 1)
    let s0 = Math.floor(sectorF)
    let s1 = s0 + 1
    fracArr[y] = sectorF - s0
    if (wrapTheta) {
      s0 = ((s0 % sector) + sector) % sector
      s1 = ((s1 % sector) + sector) % sector
    } else {
      s0 = Math.min(sector - 1, Math.max(0, s0))
      s1 = Math.min(sector - 1, s1)
    }
    s0Arr[y] = s0
    s1Arr[y] = s1
  }

  // TL 扁平数组 + 每扇区 / 每深度层的行首偏移：热循环内用一次加法取代 parsed.at() 的
  // 方法调用与三次边界检查（原实现每个体素调用两次 at()，共 2×row×height×col 次）
  const tl = parsed.tl
  const sectorStride = row * col
  const rowStride = height * col * 4

  for (let iz = 0; iz < row; iz++) {
    const depthOffset = iz * col
    for (let y = 0; y < height; y++) {
      const base0 = s0Arr[y] * sectorStride + depthOffset
      const base1 = s1Arr[y] * sectorStride + depthOffset
      const frac = fracArr[y]
      const outRow = iz * rowStride + y * col * 4

      for (let ix = 0; ix < col; ix++) {
        const v0 = tl[base0 + ix]
        const v1 = tl[base1 + ix]
        let v
        let coverage = 0
        const valid0 = v0 === v0
        const valid1 = v1 === v1
        if (valid0 && valid1) {
          v = v0 + (v1 - v0) * frac
          coverage = 1
        } else if (valid0) {
          v = v0
          coverage = 1 - frac
        } else if (valid1) {
          v = v1
          coverage = frac
        } else {
          v = NaN
        }

        const o = outRow + ix * 4
        if (v === v) {
          // 归一化到 0–255（NaN 已排除，v0/v1 的自比较即 isFinite 判定）
          let n = ((v - vMin) * normScale + 0.5) | 0
          if (n < 0) n = 0
          else if (n > 255) n = 255
          data[o] = n
          data[o + 1] = n
          data[o + 2] = n
          // 不再把“一个扇区有效、相邻扇区为陆地”的插值格强行设为完全有效；
          // 覆盖率会向陆地扇区平滑衰减，并在陆地扇区中心严格为 0。
          data[o + 3] = Math.max(0, Math.min(255, Math.round(coverage * 255)))
          validCount += coverage
        } else {
          data[o] = 0
          data[o + 1] = 0
          data[o + 2] = 0
          data[o + 3] = 0
        }
      }
    }
  }
  // 无效体素（200 / 9999 哨兵、海底以下）回填邻近有效值，A 通道仍为 0（本身不渲染）：
  // 避免三线性插值在远距离末端 / 海底等数据边界把 TL 稀释成值域最低端（表现为数据里
  // 并不存在的低 TL —— 色标下限色）
  fillInvalidVoxelRgb(data, col, height, row, { wrapY: wrapTheta })

  const distance = grid.distance
  const pathMaxM = Math.max(1, distance.length ? distance[distance.length - 1] : col)
  const depthMinM = depthValues[0] ?? 0
  const depthMaxM = depthValues[depthValues.length - 1] ?? depthMinM + 1

  const degLat = Math.max(1e-6, pathMaxM / M_PER_DEG_LAT)
  const degLon = Math.max(1e-6, pathMaxM / Math.max(1e-6, M_PER_DEG_LON * Math.cos((sourceLat * Math.PI) / 180)))

  return {
    width: col,
    height,
    depth: row,
    data,
    // WebGL sampler3D 使用硬件三线性过滤；只改变显示采样，不改写 Bellhop TL 数据。
    textureFilter: 'linear',
    valueMin: vMin,
    valueMax: vMax,
    lonMin: sourceLon - degLon,
    lonMax: sourceLon + degLon,
    latMin: sourceLat - degLat,
    latMax: sourceLat + degLat,
    depthMin: depthMinM,
    depthMax: depthMaxM,
    depthValues,
    sourceWidth: col,
    sourceHeight: height,
    sourceDepth: row,
    requestedHeight,
    volumeMemoryLimited: height < requestedHeight,
    wedgeMeta: {
      sourceLon,
      sourceLat,
      angleMin,
      angleMax,
      // pathMinM 取 0：让声源中心（path=0）也能采样到最内圈数据，避免中心渲染成空圈
      pathMinM: 0,
      pathMaxM,
      depthMinM,
      depthMaxM,
    },
    validVoxelRatio: validCount / Math.max(1, col * height * row),
    coordinateMode: 'polar_range_theta_depth',
  }
}

/**
 * 从文件内容（字符串）解析三维声场标准格式数据。
 * @param {string} text - JSON 文本
 * @returns {TlrdSoundFieldData}
 */
export function parseAnalyse3DTlrdText(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(`三维传播损失数据不是有效的 JSON：${err?.message ?? err}`)
  }
  return parseAnalyse3DTlrd(json)
}

/**
 * 一步到位：标准格式 JSON → 极坐标体纹理对象。
 *
 * @param {object} json - 已 JSON.parse 的原始对象
 * @param {object} [parseOpts] - 透传给 parseAnalyse3DTlrd
 * @param {object} [volumeOpts] - 透传给 decodeTlrdPolarVolume
 * @returns {{ parsed: TlrdSoundFieldData, texture: object }}
 */
export function decodeTlrdVolumeFromJson(json, parseOpts = {}, volumeOpts = {}) {
  const parsed = parseAnalyse3DTlrd(json, parseOpts)
  return { parsed, texture: decodeTlrdPolarVolume(parsed, volumeOpts) }
}
