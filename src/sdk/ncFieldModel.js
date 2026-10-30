/**
 * ncFieldModel.js — 声场 NC 解析统一接口
 * ==========================================
 *
 * 声场 NC / JSON 原始数据在 UI 侧通常有三种消费形态：
 *   - **二维全方位声场**（俯视图 / 球面色块图 /aso2D 散点图）
 *   - **距离—深度剖面**（某一方位的 TL 伪彩图 / 声线图）
 *   - **三维体**（见 `ncTlrdParser.js` / `ncVolumeBuilder.js`）
 *
 * 本模块把前两种形态的「数据结构解析」收敛为统一接口，屏蔽数据源的差异，
 * 使上层（web / docs 示例 / 其它业务）只面对一套模型：
 *
 * | 数据源（`SOUND_FIELD_SOURCE`） | 原始数据 | TL 取值方式 |
 * |---|---|---|
 * | `tlrd` | `response_Analyse3DTLRD.json` | `loadingTlv.data[sector*row + depth][range]` |
 * | `rtrd` | `response_Analyse2DRTRD.json` | **无 TL**：单个方位剖面的真实声线（`trackData`）+ 海底采样（`sampling`） |
 *
 * **统一模型约定**
 *
 * - 方位：`0° = 正东，逆时针为正`（与 `AzimuthPointer` / `bearingDegFromSource` / 体渲染切面一致）。
 * - 距离：水平距离，单位 **米**（源数据为 km 时在此换算）。
 * - 深度：向下为正，单位 **米**。
 * - 无效值：统一为 `NaN`（`tlrd` 的 `200 / 9999` 已处理）。
 *
 * 与三维体的关系：`tlrd` 分支复用 `parseAnalyse3DTlrd`（带 JSON 级缓存），
 * 三维体纹理请继续走 `decodeTlrdPolarVolume`，两者共享同一份解析结果。
 *
 * **静态声线模拟**：`rtrd`（Analyse2DRTRD）只是三维声场中某一个方位的二维声线结果，
 * 没有 TL。把它传给任意数据源的 `buildProfileModel(json, { source, rayData })`，
 * 该模型的**所有方位**都会使用这套真实声线 ⇒ 适用于「静态模拟：无论转到什么方位都显示同一份声线」。
 */
import { normalizeAzimuth360 } from './azimuthPointer.js'
import { TLRD_DEFAULT_SOURCE, TLRD_PLUGIN, parseAnalyse3DTlrd } from './ncTlrdParser.js'
import { VOLUME_TL_COLOR_MAX, VOLUME_TL_COLOR_MIN } from './tlColor.js'

/** 纬度 1° 对应米数（近似） */
const M_PER_DEG_LAT = 110574
/** 经度 1° 对应米数（近似，随纬度变化） */
const mPerDegLon = (lat) => 111320 * Math.cos((Number(lat) * Math.PI) / 180)

/**
 * 声场数据源枚举。
 * @readonly
 * @type {{TLRD: 'tlrd', RTRD: 'rtrd'}}
 */
export const SOUND_FIELD_SOURCE = Object.freeze({
  /** 三维传播损失标准格式（Analyse3DTLRD）：`loadingTlv.data[sector×depth][range]` */
  TLRD: 'tlrd',
  /** 二维声线轨迹返回数据（Analyse2DRTRD）：单个方位剖面的真实声线 + 海底采样，不含 TL */
  RTRD: 'rtrd',
})

/** 二维声线轨迹返回数据的插件名（XWOcean Analyse2DRTRD） */
export const RTRD_PLUGIN = 'Analyse2DRTRD'

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

/**
 * 任意值 → 有限数值，非数值返回 NaN。
 * @param {*} v 原始值
 * @returns {number}
 */
export function toFiniteNumber(v) {
  if (v == null) return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * TL 值规范化：`null` / 非数值 / `0` 视为无效体素（与体纹理解码一致），返回 NaN。
 * @param {*} v 原始值
 * @returns {number}
 */
export function validTlValue(v) {
  const n = toFiniteNumber(v)
  return n === 0 ? NaN : n
}

/**
 * 角度归一化到 [0, 360)。
 * @param {number} deg 角度（度）
 * @returns {number}
 */
export function normalize360(deg) {
  return normalizeAzimuth360(toFiniteNumber(deg))
}

/**
 * 角度归一化到 (-180, 180]。
 * @param {number} deg 角度（度）
 * @returns {number}
 */
export function normalize180(deg) {
  return ((((toFiniteNumber(deg) + 180) % 360) + 360) % 360) - 180
}

/**
 * 门户 / Bellhop 的导航方位（正北 0°、顺时针）转为界面方位
 * （正东 0°、逆时针）。两套坐标的换算互为自身的逆运算。
 */
export function compassBearingToInternalAzimuth(deg) {
  return normalize360(90 - toFiniteNumber(deg))
}

/** 界面方位（正东 0°、逆时针）转门户导航方位（正北 0°、顺时针）。 */
export function internalAzimuthToCompassBearing(deg) {
  return compassBearingToInternalAzimuth(deg)
}

/**
 * Analyse3DTLRD 每个数据行对应的界面方位。
 *
 * 门户后端以 `linspace(0, 360, sector, endpoint=false)` 生成计算方位，所以
 * 第 s 行对应 s * 360 / sector，而不是该扇区区间的中心点。旧实现额外加了
 * 半个步长，4 扇面时会让 TL 剖面相对三维体固定错开 45°。
 *
 * 若响应显式携带 `loadingTlv.azimuths`，该数组按门户导航方位解释并优先使用。
 */
export function tlrdSectorAzimuths(sector, declaredCompassBearings = null) {
  const count = Math.max(1, Number(sector) || 1)
  const bearings =
    Array.isArray(declaredCompassBearings) && declaredCompassBearings.length === count
      ? declaredCompassBearings
      : Array.from({ length: count }, (_, s) => (s * 360) / count)
  return bearings.map(compassBearingToInternalAzimuth)
}

/**
 * 在升序数组中查找最接近 v 的下标。
 * @param {number[]} sorted 升序数组
 * @param {number} v 目标值
 * @returns {number} 下标，空数组返回 -1
 */
export function nearestIndex(sorted, v) {
  if (!sorted || sorted.length === 0) return -1
  let lo = 0
  let hi = sorted.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] > v) hi = mid
    else lo = mid
  }
  return Math.abs(sorted[lo] - v) <= Math.abs(sorted[hi] - v) ? lo : hi
}

/**
 * 取某条声线（row / 方位）在某深度层、某距离点的 TL（dB）。
 * 兼容两种层结构：`layers[depthIdx].grid.values[row][col]` 与 `[depthIdx][row][col]`。
 * @param {Array} layers 原始 TL 层数据
 * @param {number} row 声线（方位）下标
 * @param {number} depthIndex 深度层下标
 * @param {number} col 距离点下标
 * @returns {number} TL（dB），无效返回 NaN
 */
export function tlAt(layers, row, depthIndex, col) {
  const layer = Array.isArray(layers) ? layers[depthIndex] : null
  if (!layer) return NaN
  const v = Array.isArray(layer) ? layer?.[row]?.[col] : layer?.grid?.values?.[row]?.[col]
  return toFiniteNumber(v)
}

/** 统一「字符串 sourceId / 配置对象」两种传参写法 */
function splitSource(sourceOrOpts) {
  if (sourceOrOpts == null) return { source: null, opts: {} }
  if (typeof sourceOrOpts === 'string') return { source: sourceOrOpts, opts: {} }
  const { source, sourceId = source, ...opts } = sourceOrOpts
  return { source: sourceId ?? null, opts }
}

/* ------------------------------------------------------------------ *
 * 数据源识别
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 二维声线轨迹（Analyse2DRTRD）+ 静态方位声线注入
 * ------------------------------------------------------------------ */

/**
 * 取出二维声线轨迹返回数据（Analyse2DRTRD）的 `Response`。
 * @param {object} json 原始数据
 * @returns {object|null} 找不到返回 null
 */
function pickRtrdResponse(json) {
  const units = json?.Data?.Units
  if (!Array.isArray(units) || units.length === 0) return null
  const unit = units.find((u) => u?.Plugin === RTRD_PLUGIN || !!u?.Response?.trackData)
  return unit?.Response ?? null
}

/** 是否为二维声线轨迹返回数据（Analyse2DRTRD） */
function isRtrdJson(json) {
  const res = pickRtrdResponse(json)
  return Array.isArray(res?.trackData?.data) && res.trackData.data.length > 0
}

/** `parseAnalyse2DRtrd` 的 JSON 级缓存（避免每次取声线都重扫上万点） */
const RTRD_CACHE = new WeakMap()

/** 解析 Analyse2DRTRD 的原始实现（无缓存） */
function decodeRtrd(json) {
  const res = pickRtrdResponse(json)
  const raw = Array.isArray(res?.trackData?.data) ? res.trackData.data : []

  const rays = []
  let maxDistM = 0
  let maxDepthM = 0
  for (const r of raw) {
    const xs = r?.x
    const zs = r?.z
    if (!Array.isArray(xs) || !Array.isArray(zs)) continue
    const n = Math.min(xs.length, zs.length)
    const pts = []
    for (let k = 0; k < n; k++) {
      // 距离取绝对值：源数据偶有负值（-0 或反向追迹），按正的水平距离处理
      const distM = Math.abs(toFiniteNumber(xs[k]))
      const depthM = toFiniteNumber(zs[k])
      if (!Number.isFinite(distM) || !Number.isFinite(depthM)) continue
      if (distM > maxDistM) maxDistM = distM
      if (depthM > maxDepthM) maxDepthM = depthM
      pts.push([distM, depthM])
    }
    if (pts.length >= 2) rays.push(pts)
  }
  if (!rays.length) return null

  // 海底地形：sampling.data.y 为海底高程（向下为负）⇒ 海深 = -y
  const sx = res?.sampling?.data?.x
  const sy = res?.sampling?.data?.y
  const seabed = { dist: [], depth: [] }
  if (Array.isArray(sx) && Array.isArray(sy)) {
    const n = Math.min(sx.length, sy.length)
    for (let i = 0; i < n; i++) {
      const distM = Math.abs(toFiniteNumber(sx[i]))
      const elevM = toFiniteNumber(sy[i])
      if (!Number.isFinite(distM) || !Number.isFinite(elevM)) continue
      const depthM = -elevM
      if (!(depthM > 0)) continue
      seabed.dist.push(distM)
      seabed.depth.push(depthM)
      if (distM > maxDistM) maxDistM = distM
      if (depthM > maxDepthM) maxDepthM = depthM
    }
  }

  return {
    plugin: RTRD_PLUGIN,
    frequencyHz: toFiniteNumber(res?.calcFrequency),
    rayCount: rays.length,
    rays,
    // 至少两个采样点才成线 ⇒ 可用于绘制地形曲线
    seabed: seabed.dist.length >= 2 ? seabed : null,
    // 声源深度：第一条声线的起点深度
    sourceDepthM: rays[0][0][1],
    maxDistM,
    maxDepthM,
  }
}

/**
 * 解析二维声线轨迹返回数据（Analyse2DRTRD）——**单个方位剖面**的真实声线 + 海底地形。
 *
 * 源数据结构（`Data.Units[i].Response`）：
 *  - `trackData.data[i]`：第 i 条声线，`x` = 水平距离（米）、`z` = 深度（米，向下为正）；
 *  - `sampling.data`：`x` = 水平距离（米）、`y` = 海底**高程**（米，向下为负）⇒ 海深 = `-y`；
 *  - `calcFrequency`：计算频率（Hz）。
 *
 * @param {object} json 原始数据
 * @returns {object|null} `{ plugin, frequencyHz, rayCount, rays, seabed, sourceDepthM, maxDistM, maxDepthM }`
 *   `rays` 每条为 `[[distM, depthM], ...]`；`seabed` 为 `{ dist, depth }`（无地形时 null）；解析失败返回 null
 */
export function parseAnalyse2DRtrd(json) {
  if (!json || typeof json !== 'object') return null
  if (RTRD_CACHE.has(json)) return RTRD_CACHE.get(json)
  const out = decodeRtrd(json)
  RTRD_CACHE.set(json, out)
  return out
}

/**
 * 把「二维声线返回数据」的真实声线附加到剖面模型上（**静态方位模拟**）。
 *
 * 该数据只是三维声场中某一个方位的声线结果，静态模拟环境下把它挂到模型上后，
 * `collectRayPaths` 对模型的**任意方位行**都返回同一套声线 ⇒ 转到什么方位都展示这份声线。
 *
 * @param {object} model `buildProfileModel` 的模型对象（原地附加字段）
 * @param {object|null} rayJson `response_Analyse2DRTRD.json` 原始数据
 * @returns {object} 原模型
 */
function attachStaticRays(model, rayJson) {
  const parsed = parseAnalyse2DRtrd(rayJson)
  if (!parsed) return model
  model.rayPaths = parsed.rays
  model.rayCount = parsed.rayCount
  model.sourceDepthM = parsed.sourceDepthM
  model.maxDistM = parsed.maxDistM
  model.frequencyHz = parsed.frequencyHz
  return model
}

/** 是否为三维传播损失标准格式（Analyse3DTLRD） */
function isTlrdJson(json) {
  const units = json?.Data?.Units
  if (!Array.isArray(units) || units.length === 0) return false
  return units.some((u) => u?.Plugin === TLRD_PLUGIN || !!u?.Response?.loadingTlv)
}

/**
 * 自动识别声场数据源类型（无需调用方传 `sourceId`）。
 * @param {object} json 原始数据
 * @returns {'tlrd'|'rtrd'|null} 无法识别返回 null
 */
export function detectSoundFieldSource(json) {
  if (!json || typeof json !== 'object') return null
  // rtrd 与 tlrd 同为 Data.Units 结构，先按插件名 / trackData 判定
  if (isRtrdJson(json)) return SOUND_FIELD_SOURCE.RTRD
  if (isTlrdJson(json)) return SOUND_FIELD_SOURCE.TLRD
  return null
}

/* ------------------------------------------------------------------ *
 * 1. 二维全方位声场模型（omni）
 * ------------------------------------------------------------------ */

/**
 * 规范化 `response_Analyse3DTLRD.json`（三维传播损失标准格式）。
 *
 * @param {object} json tlrd 原始数据
 * @param {object} [opts]
 * @param {number} [opts.sourceLon] 声源经度，缺省 `TLRD_DEFAULT_SOURCE.lon`
 * @param {number} [opts.sourceLat] 声源纬度，缺省 `TLRD_DEFAULT_SOURCE.lat`
 * @returns {object|null} omni 模型
 */
export function buildTlrdOmniModel(json, opts = {}) {
  let parsed
  try {
    parsed = parseAnalyse3DTlrd(json)
  } catch {
    return null
  }
  const { sector, row: depthCount, col: rangeCount, depth, distance } = parsed.grid
  if (!sector || !depthCount || !rangeCount) return null

  const sourceLon = Number.isFinite(Number(opts.sourceLon)) ? Number(opts.sourceLon) : TLRD_DEFAULT_SOURCE.lon
  const sourceLat = Number.isFinite(Number(opts.sourceLat)) ? Number(opts.sourceLat) : TLRD_DEFAULT_SOURCE.lat
  const depths = depth.slice()
  const colDist = distance.slice()

  // 方位行与三维纹理严格同轴：第 s 行是门户实际计算的 s × 360/sector 导航方位。
  const azimuths = tlrdSectorAzimuths(sector, parsed.grid.compassBearings)

  // TL 层：layers[depthIdx][sector][col]，复用 tlAt 的数组分支（海底以下/陆地为 NaN；水体未覆盖的 200 保留为有限值）
  const layers = []
  for (let d = 0; d < depthCount; d++) {
    const perDepth = []
    for (let s = 0; s < sector; s++) {
      const start = (s * depthCount + d) * rangeCount
      perDepth.push(parsed.tl.subarray(start, start + rangeCount))
    }
    layers.push(perDepth)
  }

  const perDegLon = Math.max(1e-6, mPerDegLon(sourceLat))
  const cells = []
  for (let s = 0; s < sector; s++) {
    const azRad = (azimuths[s] * Math.PI) / 180
    for (let col = 0; col < rangeCount; col++) {
      const dist = colDist[col]
      cells.push({
        row: s,
        col,
        lon: sourceLon + (dist * Math.cos(azRad)) / perDegLon,
        lat: sourceLat + (dist * Math.sin(azRad)) / M_PER_DEG_LAT,
        az: azimuths[s],
        dist,
      })
    }
  }

  const vMin = Number(parsed.stats.valueMin)
  const vMax = Number(parsed.stats.valueMax)
  return {
    source: SOUND_FIELD_SOURCE.TLRD,
    sourceLon,
    sourceLat,
    depths,
    azimuths,
    rows: sector,
    cols: rangeCount,
    layers,
    colDist,
    cells,
    maxDist: colDist[colDist.length - 1] ?? 0,
    valueMin: Number.isFinite(vMin) ? vMin : VOLUME_TL_COLOR_MIN,
    valueMax: Number.isFinite(vMax) ? vMax : VOLUME_TL_COLOR_MAX,
    depthMax: depths[depths.length - 1] ?? 0,
  }
}

/**
 * 按数据源构建**二维全方位声场模型**（失败返回 null）。
 *
 * 模型字段（三种数据源完全同构）：
 *
 * | 字段 | 说明 |
 * |---|---|
 * | `source` | 数据源类型（`SOUND_FIELD_SOURCE`） |
 * | `sourceLon` / `sourceLat` | 声源经纬度 |
 * | `depths` | 深度轴（米，向下为正） |
 * | `azimuths` | 每条声线的方位角（度，0 = 正东，逆时针为正） |
 * | `rows` / `cols` | 方位数 / 距离点数 |
 * | `layers` | 原始 TL 层数据（配合 `tlAt` 取值） |
 * | `colDist` | 每个 col 的水平距离（米） |
 * | `cells` | 逐网格单元 `{ row, col, lon, lat, az, dist }` |
 * | `maxDist` | 最大传播距离（米） |
 * | `valueMin` / `valueMax` | TL 值域（dB） |
 * | `depthMax` | 最大深度（米） |
 *
 * @param {object} json 原始数据
 * @param {string|object} [sourceOrOpts] 数据源类型，或 `{ source, sourceId, sourceLon, sourceLat, sourceIndex }`
 * @returns {object|null} omni 模型，数据无效返回 null
 */
export function buildOmniFieldModel(json, sourceOrOpts) {
  if (!json) return null
  const { opts } = splitSource(sourceOrOpts)
  try {
    return buildTlrdOmniModel(json, opts)
  } catch {
    return null
  }
}

/**
 * 在极坐标域（方位角 × 距离）内做反距离加权（IDW）插值，把稀疏网格补齐成闭合圆盘。
 *
 * 以声源为圆心：角度 = 方位角（0~360°，正东 0° 逆时针为正），半径 = 水平距离（米）。
 *
 * @param {Array<{az:number, dist:number, row:number, col:number}>} cells omni 模型的 cells
 * @param {(cell:object) => number} tlGetter 取 TL 的函数（NaN 表示无效）
 * @param {number} maxDist 圆盘半径上限（米）
 * @param {number} [nTheta=360] 方位角分辨率
 * @param {number} [nRadius=120] 距离分辨率（环数）
 * @returns {Array<[number, number, number]>} `[东西向距离m, 南北向距离m, TL][]`
 */
export function interpolatePolarToDisk(cells, tlGetter, maxDist, nTheta = 360, nRadius = 120) {
  if (!cells || cells.length === 0 || !(maxDist > 0)) return []

  const samples = []
  for (const c of cells) {
    const v = tlGetter(c)
    if (!Number.isFinite(v)) continue
    samples.push([normalize360(c.az), c.dist, v])
  }
  if (samples.length === 0) return []

  // 极坐标空间分箱（方位 bin 尺寸 = 360/nTheta，距离 bin 尺寸 = maxDist/nRadius）
  const stepTheta = 360 / nTheta
  const stepR = maxDist / nRadius
  const binsTheta = Math.max(1, Math.ceil(360 / stepTheta))
  const binsR = Math.max(1, Math.ceil(maxDist / stepR))
  const bins = new Map()
  for (let i = 0; i < samples.length; i++) {
    const bt = Math.min(binsTheta - 1, Math.max(0, Math.floor(samples[i][0] / stepTheta)))
    const br = Math.min(binsR - 1, Math.max(0, Math.floor(samples[i][1] / stepR)))
    const key = br * binsTheta + bt
    if (!bins.has(key)) bins.set(key, [])
    bins.get(key).push(i)
  }

  // 搜索半径（bin 环数）：覆盖约 2.5 倍步长的邻域
  const searchR = Math.max(stepTheta * 2.5, stepR * 2.5)
  const searchR2 = searchR * searchR
  const ringT = Math.max(1, Math.ceil(searchR / stepTheta))
  const ringR = Math.max(1, Math.ceil(searchR / stepR))

  const out = []
  for (let ir = 0; ir < nRadius; ir++) {
    const r = (ir + 0.5) * stepR
    const br = Math.min(binsR - 1, Math.max(0, Math.floor(r / stepR)))
    for (let it = 0; it < nTheta; it++) {
      const az = (it + 0.5) * stepTheta
      const bt = Math.min(binsTheta - 1, Math.max(0, Math.floor(az / stepTheta)))

      let sumW = 0
      let sumWV = 0
      let found = 0
      let exact = NaN

      // 方位角需循环搜索（0° 附近同时查 360° 附近的 bin）
      for (let oy = -ringR; oy <= ringR && !Number.isFinite(exact); oy++) {
        const brr = br + oy
        if (brr < 0 || brr >= binsR) continue
        for (let ox = -ringT; ox <= ringT; ox++) {
          const btt = ((bt + ox) % binsTheta + binsTheta) % binsTheta
          const idxs = bins.get(brr * binsTheta + btt)
          if (!idxs) continue
          for (const idx of idxs) {
            const [saz, sdist, sv] = samples[idx]
            const dTheta = Math.min(Math.abs(saz - az), 360 - Math.abs(saz - az))
            const dR = sdist - r
            const d2 = dTheta * dTheta + dR * dR
            if (d2 === 0) {
              exact = sv
              break
            }
            if (d2 > searchR2) continue
            const w = 1 / d2
            sumW += w
            sumWV += w * sv
            found++
          }
          if (Number.isFinite(exact)) break
        }
      }

      let tl
      if (Number.isFinite(exact)) tl = exact
      else if (found === 0) continue
      else tl = sumW > 0 ? sumWV / sumW : sumWV

      // 极坐标 → 直角坐标（正东 0°、逆时针 ⇒ 东西向 = r·cos(az)，南北向 = r·sin(az)）
      const azRad = (az * Math.PI) / 180
      out.push([r * Math.cos(azRad), r * Math.sin(azRad), tl])
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 2. 距离—深度剖面模型（profile）+ 声线追踪
 * ------------------------------------------------------------------ */

/**
 * 构建「距离—深度」剖面模型，两种数据源统一形态：
 *
 * @param {object} json 原始数据
 * @param {string|object} [sourceOrOpts] 数据源类型，或
 *   `{ source, sourceId, azimuthDeg, sourceLon, sourceLat, rayData }`
 * @returns {object|null} 剖面模型 `{
 *   kind, sourceLon, sourceLat, depths, azimuths, rows, cols, depthMax,
 *   colDistFor(row), tlAt(row, depthIndex, col), rayPaths, hasSeabed, seabedFor(row) }`
 *   `hasSeabed` / `seabedFor(row)`：海底地形（海深，米，向下为正）。
 *   仅 `tlrd` 数据源自带（标准格式 `altitudeList.pairedDataVS[row].y`，取绝对值）；
 *   其余数据源 `hasSeabed = false`、`seabedFor(row)` 返回空数组。
 *
 *   `opts.rayData`（`response_Analyse2DRTRD.json` 原始数据）为**静态方位声线**：
 *   传入后模型的 `rayPaths` 为该二维返回数据的真实声线，`collectRayPaths` 对任意方位都返回这套声线，
 *   并附带 `rayCount` / `sourceDepthM` / `maxDistM` / `frequencyHz`（见 `attachStaticRays`）。
 */
export function buildProfileModel(json, sourceOrOpts) {
  const { opts } = splitSource(sourceOrOpts)
  const model = buildProfileModelCore(json, sourceOrOpts)
  // 静态方位声线：二维返回数据挂到任意数据源的模型上 ⇒ 所有方位共用同一套真实声线
  return model && opts.rayData ? attachStaticRays(model, opts.rayData) : model
}

/** `buildProfileModel` 的实现：按数据源类型构建剖面模型（不含 `opts.rayData` 注入） */
function buildProfileModelCore(json, sourceOrOpts) {
  if (!json) return null
  const { source, opts } = splitSource(sourceOrOpts)
  const picked = source ?? detectSoundFieldSource(json) ?? SOUND_FIELD_SOURCE.TLRD

  // ── rtrd：二维声线轨迹返回数据（单个方位剖面：真实声线 + 海底地形，无 TL）──
  if (picked === SOUND_FIELD_SOURCE.RTRD) {
    const parsed = parseAnalyse2DRtrd(json)
    if (!parsed) return null
    const seabed = parsed.seabed
    const dists = seabed ? seabed.dist : []
    const seabedDepths = seabed ? seabed.depth : []
    return {
      kind: SOUND_FIELD_SOURCE.RTRD,
      sourceLon: toFiniteNumber(opts.sourceLon),
      sourceLat: toFiniteNumber(opts.sourceLat),
      // 无 TL 网格 ⇒ 深度轴为空，剖面色块无从绘制（消费方按 kind 判断）
      depths: [],
      azimuths: [normalize360(toFiniteNumber(opts.azimuthDeg) || 0)],
      rows: 1,
      cols: dists.length,
      depthMax: parsed.maxDepthM,
      colDistFor: () => dists,
      tlAt: () => NaN,
      // 真实声线轨迹（物理单位：米），`collectRayPaths` 直接使用
      rayPaths: parsed.rays,
      rayCount: parsed.rayCount,
      sourceDepthM: parsed.sourceDepthM,
      maxDistM: parsed.maxDistM,
      frequencyHz: parsed.frequencyHz,
      hasSeabed: !!seabed,
      seabedFor: () => seabedDepths,
    }
  }

  // ── tlrd：三维传播损失标准格式（sector × depth × range）──
  if (picked === SOUND_FIELD_SOURCE.TLRD) {
    let parsed
    try {
      parsed = parseAnalyse3DTlrd(json)
    } catch {
      return null
    }
    const sector = parsed.grid.sector
    const depths = parsed.grid.depth.slice()
    const dists = parsed.grid.distance.slice()
    const response = json?.Data?.Units?.find((unit) => unit?.Response?.loadingTlv)?.Response
    const declaredAzimuths = response?.loadingTlv?.azimuths
    const azimuths = tlrdSectorAzimuths(sector, declaredAzimuths ?? parsed.grid.compassBearings)
    // 海底地形：标准格式的 altitudeList.pairedDataVS[s].y 即该扇区各距离点的海底高程
    const hasSeabed = parsed.bottom.some((line) => Array.isArray(line) && line.length > 0)
    return {
      kind: SOUND_FIELD_SOURCE.TLRD,
      sourceLon: TLRD_DEFAULT_SOURCE.lon,
      sourceLat: TLRD_DEFAULT_SOURCE.lat,
      depths,
      azimuths,
      rows: sector,
      cols: parsed.grid.col,
      depthMax: Math.max(...depths.filter(Number.isFinite), 0),
      colDistFor: () => dists,
      tlAt: (row, d, col) => parsed.at(row, d, col),
      hasSeabed,
      seabedFor: (row) => (hasSeabed ? parsed.seabedDepths(row) : []),
    }
  }

  return null
}

/**
 * 当前方位（数据行）下标：取与目标方位最接近的一行。
 * @param {object} model buildProfileModel 的结果
 * @param {number} azimuthDeg 目标方位角（度）
 * @returns {number} 行下标
 */
export function nearestAzimuthRow(model, azimuthDeg) {
  const target = normalize360(azimuthDeg)
  if (!model?.azimuths?.length) return 0
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < model.azimuths.length; i++) {
    const diff = Math.abs(normalize180(model.azimuths[i] - target))
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}

/**
 * 取某个方位（数据行）的距离列，按 maxRadiusM 截断。
 * @param {object} model buildProfileModel 的结果
 * @param {number} rowIndex 方位行下标
 * @param {number} [maxRadiusM] 最大距离（米），0 / 负值表示不限
 * @returns {Array<{col:number, dist:number}>}
 */
export function distanceColumns(model, rowIndex, maxRadiusM) {
  if (!model) return []
  const maxRadius = Number(maxRadiusM) > 0 ? Number(maxRadiusM) : Infinity
  const colDistAll = model.colDistFor?.(rowIndex) ?? []
  const out = []
  for (let col = 0; col < model.cols; col++) {
    const dist = colDistAll[col]
    if (!Number.isFinite(dist) || dist > maxRadius) continue
    out.push({ col, dist })
  }
  return out
}

/**
 * 当前 TL 方位剖面的统一物理坐标与海底采样。
 * TL 伪彩图和声线图必须共同使用这份结果，避免一边按类别下标、一边按带余量的
 * 数值坐标，从视觉上产生传播损失与声线错位。
 */
export function profileAxisGeometry(model, rowIndex, maxRadiusM = 0) {
  if (!model) return { maxDistanceM: 0, maxDepthM: 0, seabedSamples: [] }
  const columns = distanceColumns(model, rowIndex, maxRadiusM)
  const depths = Array.isArray(model.depths) ? model.depths.map(toFiniteNumber).filter(Number.isFinite) : []
  const seabed = typeof model.seabedFor === 'function' ? model.seabedFor(rowIndex) : []
  return {
    maxDistanceM: columns.length ? Number(columns[columns.length - 1].dist) || 0 : 0,
    maxDepthM: depths.length ? Math.max(...depths, 0) : 0,
    // 保留无效/陆地列为 NaN，使图表地形线在陆地处断开，也使声线在该处被裁掉。
    seabedSamples: columns.map(({ col, dist }) => {
      const value = toFiniteNumber(seabed?.[col])
      return [Number(dist), value > 0 ? value : NaN]
    }),
  }
}

/** 在等距或非等距海底采样上按距离线性插值；陆地/缺测区返回 NaN。 */
export function seabedDepthAtDistance(seabedSamples, distanceM) {
  const samples = Array.isArray(seabedSamples) ? seabedSamples : []
  const d = Number(distanceM)
  if (!samples.length || !Number.isFinite(d)) return NaN
  if (d < samples[0][0] || d > samples[samples.length - 1][0]) return NaN
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (Number(samples[mid][0]) > d) hi = mid
    else lo = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  const da = Number(a?.[0])
  const db = Number(b?.[0])
  const za = Number(a?.[1])
  const zb = Number(b?.[1])
  if (Math.abs(d - da) < 1e-7) return za
  if (Math.abs(d - db) < 1e-7) return zb
  if (!Number.isFinite(za) || !Number.isFinite(zb)) return NaN
  if (!(db > da)) return za
  const t = Math.min(1, Math.max(0, (d - da) / (db - da)))
  return za + (zb - za) * t
}

/**
 * 用当前 TL 剖面的海底与共同坐标范围裁剪声线。
 * 返回值可能把一条声线拆成多段，防止 ECharts 跨越陆地/海底把断点重新连起来。
 */
export function clipRayPathsByProfile(paths, geometry) {
  const source = Array.isArray(paths) ? paths : []
  const seabedSamples = geometry?.seabedSamples ?? []
  const maxDistanceM = Number(geometry?.maxDistanceM)
  const maxDepthM = Number(geometry?.maxDepthM)
  const hasDistanceLimit = maxDistanceM > 0
  const hasDepthLimit = maxDepthM > 0
  const hasSeabed = seabedSamples.some((sample) => Number.isFinite(Number(sample?.[1])))

  const visible = (point) => {
    const distance = Number(point?.[0])
    const depth = Number(point?.[1])
    if (!Number.isFinite(distance) || !Number.isFinite(depth) || distance < 0 || depth < 0) return false
    if (hasDistanceLimit && distance > maxDistanceM) return false
    if (hasDepthLimit && depth > maxDepthM) return false
    if (!hasSeabed) return true
    const bottomDepth = seabedDepthAtDistance(seabedSamples, distance)
    return Number.isFinite(bottomDepth) && depth <= bottomDepth
  }

  const boundary = (a, b, aVisible) => {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2
      const p = [Number(a[0]) + (Number(b[0]) - Number(a[0])) * t, Number(a[1]) + (Number(b[1]) - Number(a[1])) * t]
      if (visible(p) === aVisible) lo = t
      else hi = t
    }
    const t = (lo + hi) / 2
    return [
      Math.round((Number(a[0]) + (Number(b[0]) - Number(a[0])) * t) * 10) / 10,
      Math.round((Number(a[1]) + (Number(b[1]) - Number(a[1])) * t) * 100) / 100,
    ]
  }

  const output = []
  for (const path of source) {
    if (!Array.isArray(path) || path.length < 2) continue
    let segment = []
    let previous = path[0]
    let previousVisible = visible(previous)
    if (previousVisible) segment.push(previous)
    for (let i = 1; i < path.length; i++) {
      const point = path[i]
      const pointVisible = visible(point)
      if (pointVisible !== previousVisible) {
        const cut = boundary(previous, point, previousVisible)
        if (previousVisible) {
          segment.push(cut)
          if (segment.length >= 2) output.push(segment)
          segment = []
        } else {
          segment = [cut]
        }
      }
      if (pointVisible) segment.push(point)
      previous = point
      previousVisible = pointVisible
    }
    if (segment.length >= 2) output.push(segment)
  }
  return output
}

/**
 * 声线轨迹（物理单位：米）。
 *
 * 优先级：
 * 1. `model.rayPaths`：二维声线返回数据（Analyse2DRTRD）的真实声线，
 *    **与方位无关**（静态模拟时由 `buildProfileModel` 的 `opts.rayData` 注入）；
 * 2. 回退：沿距离列追踪 TL 极小值深度的近似声线。
 *
 * @param {object} model buildProfileModel 的结果
 * @param {object} [opts]
 * @param {number} [opts.rowIndex=0] 近似声线所用的方位行下标
 * @param {number} [opts.azimuth=0] 目标方位（度）
 * @param {number} [opts.maxRadiusM=0] 最大距离（米），0 表示不限
 * @param {number} [opts.rayCount=10] 近似声线条数（2 ~ 20）
 * @returns {{paths: number[][][], real: boolean}} `paths` 每条为 `[[distM, depthM], ...]`
 */
export function collectRayPaths(model, opts = {}) {
  const empty = { paths: [], real: false }
  if (!model) return empty

  const { rowIndex = 0, maxRadiusM = 0, rayCount = 10 } = opts
  const maxRadius = Number(maxRadiusM) > 0 ? Number(maxRadiusM) : Infinity

  // ── 真实声线（Analyse2DRTRD：返回数据自带完整轨迹，不随方位变化）──
  if (Array.isArray(model.rayPaths) && model.rayPaths.length) {
    const paths = []
    for (const pts of model.rayPaths) {
      const clipped = []
      for (let k = 0; k < pts.length; k++) {
        const distM = toFiniteNumber(pts[k]?.[0])
        const depthM = toFiniteNumber(pts[k]?.[1])
        if (!Number.isFinite(distM) || !Number.isFinite(depthM)) continue
        if (distM > maxRadius * 1.01) continue
        clipped.push([Math.round(distM * 10) / 10, Math.round(depthM * 100) / 100])
      }
      if (clipped.length >= 2) paths.push(clipped)
    }
    if (paths.length) return { paths, real: true }
  }

  // ── 回退：沿距离列追踪 TL 极小值深度，生成近似声线 ──
  const colEntries = distanceColumns(model, rowIndex, maxRadiusM)
  if (!colEntries.length) return empty
  const lineCount = Math.max(1, Math.min(20, Number(rayCount) || 10))
  const approx = Array.from({ length: lineCount }, () => [])
  const depthCount = model.depths.length
  // 复用两个 TypedArray：vals 按深度下标存 TL，order 存有效深度下标（排序后即「TL 由小到大」的深度序）
  const vals = new Float64Array(depthCount)
  const order = new Int32Array(depthCount)
  for (const { col, dist } of colEntries) {
    let n = 0
    for (let d = 0; d < depthCount; d++) {
      const v = model.tlAt(rowIndex, d, col)
      if (Number.isFinite(v)) {
        vals[d] = v
        order[n++] = d
      }
    }
    if (n === 0) continue
    const sorted = order.subarray(0, n)
    sorted.sort((a, b) => vals[a] - vals[b])
    for (let r = 0; r < lineCount; r++) {
      const pick = sorted[Math.min(n - 1, Math.floor((r / lineCount) * n))]
      const depthM = toFiniteNumber(model.depths[pick])
      if (!Number.isFinite(depthM)) continue
      approx[r].push([Math.round(dist * 10) / 10, Math.round(depthM * 100) / 100])
    }
  }
  return { paths: approx.filter((p) => p.length >= 2), real: false }
}

/* ------------------------------------------------------------------ *
 * 3. 一步到位：原始 JSON → omni + profile
 * ------------------------------------------------------------------ */

/**
 * 一次性产出声场 NC 数据的两种消费模型（二维声场 + 方位剖面），并回传识别出的数据源。
 *
 * @param {object} json 原始数据
 * @param {string|object} [sourceOrOpts] 数据源类型或配置（同 `buildOmniFieldModel`）
 * @returns {{source: string, omni: object|null, profile: object|null}}
 */
export function parseSoundFieldNc(json, sourceOrOpts) {
  const { source, opts } = splitSource(sourceOrOpts)
  const picked = source ?? detectSoundFieldSource(json) ?? SOUND_FIELD_SOURCE.TLRD
  return {
    source: picked,
    omni: buildOmniFieldModel(json, { source: picked, ...opts }),
    profile: buildProfileModel(json, { source: picked, ...opts }),
  }
}

/* ------------------------------------------------------------------ *
 * 兼容别名（web 侧早期实现迁移前的导出名）
 * ------------------------------------------------------------------ */

/** @deprecated 请使用 `buildTlrdOmniModel` */
export const buildTlrdOmniData = buildTlrdOmniModel
/** @deprecated 请使用 `buildOmniFieldModel` */
export const buildOmniField = buildOmniFieldModel
