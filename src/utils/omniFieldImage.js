/**
 * omniFieldImage.js
 * ==========================================
 * 把「全方位传播损失」某一深度层的二维声场栅格化成**地理配准的 PNG（dataURL）**，
 * 用于在 Cesium 球面上以 ImageryLayer 形式叠加展示（见 AcousticFieldView 的「二维声场」开关）。
 *
 * **数据语义（两种风格一致）**：取加载数据的某一深度层，逐单元用其**实测经纬度**定位，
 * 用该单元在该深度的 **dB 值**按 `colorRange` 定义的**色标**取色 —— 即「该深度下、各经纬度
 * 处的 dB 值」，不做平滑平均、不把真实坐标替换成合成坐标（方位稀疏到铺不成面时才做角向补齐）。
 *
 * 两种风格（o.style）：
 *  - 'heatmap'：每个数据坐标点画一个**小正方形**，正方形颜色 = 该点 dB 值在色标上的映射
 *               （画法 o.render='cells'；'smooth' 为旧的泼溅插值连续色面），叠加等距离线与声源标记；
 *  - 'sonar'  ：参考水面舰声呐「PDA 俯视显示」——透明背景 + 等距离圈（「10KM」式标注）
 *               + 由声源向各方位辐射的**射线**，射线沿该方位各单元的实测经纬度连线，
 *               颜色同样取自色标（与热力图 / 三维体同一口径），更接近真实装备显示效果（默认）。
 *
 * 处理流程（heatmap）：
 *  1. 取该深度层所有有效单元的实测经纬度与 dB；方位数少于 OMNI_AZ_FILL_MIN_ROWS 时
 *     （如 tlrd 4~12 个扇区）按角向插值补齐成连续圆盘，否则一律用原始点位；
 *  2. 画法 'cells' 逐点画正方形；'smooth' 则泼溅到粗网格（默认 257×257）后双线性采样成连续色面；
 *  3. 按 TL 色标着色，落在数据筛选区间之外或未覆盖区域为透明；
 *  4. 叠加等距离线与声源标记；
 *  5. 返回 PNG dataURL 与对应的经纬矩形，供 SingleTileImageryProvider 直接贴到球面。
 *
 * 处理流程（sonar）：
 *  1. 逐方位（行）取该深度层各单元的 TL 与实测经纬度，方位不足时按方位角线性插值
 *     加密成 rayCount 条射线（插值方位的经纬度由两侧实测方位按同比例插值）；
 *  2. 每条射线按 dB 在色标上取色，同色连续段合并描边；
 *  3. 叠加等距离圈（实线 + 距离标注，标注置于圈正上方）与声源标记。
 */
import { sampleTlColorStops } from '@/sdk'
import { tlAt } from './omniFieldModel.js'

/** 纬度 1° 对应米（近似） */
const M_PER_DEG_LAT = 110574
/** 经度 1° 对应米（近似，随纬度变化） */
const mPerDegLon = (lat) => 111320 * Math.cos((Number(lat) * Math.PI) / 180)

/** 声呐 PDA 风格射线分级配色（低 TL = 传播好 = 最高等级，与参考图一致：红 → 黄 → 青） */
export const SONAR_RAY_CLASS_COLORS = ['#ff2f2f', '#ffe23d', '#22d3ee']

/** 热力图默认的方位目标数：方位少于该值时按角向插值补齐成连续圆盘 */
export const OMNI_AZ_FILL_ROWS = 120

/**
 * 方位数少于该值时才按角向插值补齐。
 * 二维图的定义是「该深度下、各经纬度处的 dB」⇒ 方位够密的数据（如 layers 的 36 个方位）
 * 必须用原始点位，插值只会把真实坐标换成合成坐标、把实测 dB 换成插值 dB；
 * 只有稀疏到铺不成面（tlrd 4~12 个扇区、panels 13 个方位）才需要补齐。
 */
export const OMNI_AZ_FILL_MIN_ROWS = 24

/** 取 1 / 2 / 5 × 10^n 中不小于 raw 的最小值（距离线步长取整） */
function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const base = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) {
    if (base * m >= raw) return base * m
  }
  return base * 10
}

/** 影像边缘留白系数：给最外圈留出描边 + 标注的位置，避免最外圈贴边被裁掉一半线宽 */
const IMAGE_EDGE_PADDING = 1.02

/**
 * 等距离线半径列表（米）：约 targetCount 圈，步长取整到 1/2/5×10ⁿ。
 *
 * **最外圈必须不小于 maxDist**：等距离线的作用是给数据提供距离参照，若最外圈比数据
 * 最大距离还小（如 maxDist = 185.2 km 时按 50 km 步长只画到 150 km），最外圈之外那圈
 * 数据就失去了参照刻度；因此不足时向上补一个整步长倍数。
 *
 * @param {number} maxDist 最大显示距离（米）
 * @param {number} targetCount 目标圈数
 * @returns {number[]} 半径（米），升序且最后一个 ≥ maxDist
 */
export function omniRingRadii(maxDist, targetCount = 5) {
  if (!(maxDist > 0)) return []
  const step = niceStep(maxDist / Math.max(1, targetCount))
  const out = []
  for (let r = step; r <= maxDist * 1.0001 && out.length < 12; r += step) out.push(r)
  // 步长大于最大距离时首轮循环不会产出，补一圈 ≥ maxDist 的整步长半径
  if (!out.length) out.push(step)
  // 补齐到不小于最大距离（防止被圈数上限截断后最外圈反而小于 maxDist）
  if (out[out.length - 1] < maxDist) out.push(Math.ceil(maxDist / step) * step)
  return out
}

/** 距离文案：<1km 用 m，其余用 km */
export function fmtDistLabel(m) {
  const n = Number(m)
  if (!Number.isFinite(n)) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${n.toFixed(0)} m`
}

/** 声呐风格距离圈文案（参考装备显示：10KM / 20KM / 500M） */
export function fmtRingLabel(m) {
  const n = Number(m)
  if (!Number.isFinite(n)) return ''
  return n >= 1000 ? `${Math.round(n / 1000)}KM` : `${Math.round(n)}M`
}

/**
 * 射线分级：按数据筛选范围把 TL 等分成 levels.length 档。
 * 低 TL（传播损失小）→ 最高等级（红色），与参考图的 POI 颜色分级同构。
 * @param {number} vMin 数据筛选下限（dB，对应红色 / 最高等级）
 * @param {number} vMax 数据筛选上限（dB）
 * @param {string[]} [colors] 分级配色（由高到低）
 * @returns {{max:number, color:string}[]} 按 max 升序的分级（v <= max 即命中所属档）
 */
export function buildRayLevels(vMin, vMax, colors = SONAR_RAY_CLASS_COLORS) {
  const palette = Array.isArray(colors) && colors.length ? colors : SONAR_RAY_CLASS_COLORS
  const lo = Number.isFinite(Number(vMin)) ? Number(vMin) : 60
  const hi = Number.isFinite(Number(vMax)) && Number(vMax) > lo ? Number(vMax) : lo + 60
  const span = hi - lo
  return palette.map((color, i) => ({ max: lo + (span * (i + 1)) / palette.length, color }))
}

/** 取某 TL 值命中的分级颜色（无有效分级时返回空串） */
function levelColorOf(levels, v) {
  if (!Array.isArray(levels) || !levels.length || !Number.isFinite(v)) return ''
  for (const lv of levels) {
    if (v <= lv.max) return lv.color
  }
  return levels[levels.length - 1].color
}

/** 距离轴相邻点的间距（米）：由 colDist 首末值 / 点数推算，不足时回退 0 */
function colSpacingM(colDist) {
  const list = Array.isArray(colDist) ? colDist.filter((d) => Number(d) > 0) : []
  if (list.length < 2) return 0
  return Math.abs(Number(list[list.length - 1]) - Number(list[0])) / (list.length - 1)
}

/**
 * 热力图「色块」模式：每个数据坐标点画一个小正方形，正方形颜色 = 该点 TL 值在色标上的映射。
 * - 边长：由「距离向 × 方位向」的像素间距几何平均自动推算（也可用 o.cellPx 直接指定）；
 * - 抽稀：距离向按 stride 跳点，保证相邻正方形之间留出空隙而不是糊成一片；
 * - 方位向按数据实际行距自然分开 ⇒ 球面上呈现为成排分布的彩色小方格。
 */
function drawHeatmapCells(ctx, cfg) {
  const {
    canvas,
    samples,
    west,
    east,
    north,
    south,
    lut,
    cLo,
    cSpan,
    hasColor,
    vMax,
    hasFilter,
    pxPerM,
    maxDist,
    rows,
    colDist,
    cellPx,
  } = cfg
  const size = canvas.width

  // 距离向 / 方位向像素间距 → 自动正方形边长（2~24px）
  const sx = Math.max(0.5, colSpacingM(colDist) * pxPerM)
  const sy = Math.max(0.5, ((2 * maxDist) / Math.max(1, Number(rows) || 1)) * pxPerM)
  const auto = Math.max(2, Math.min(24, Math.sqrt(sx * sy)))
  const raw = Number(cellPx)
  const side = raw > 0 ? Math.max(1, raw) : auto
  // 距离向抽稀步长：相邻正方形中心距 ≈ sx * stride ≥ side
  const stride = Math.max(1, Math.ceil(side / sx))
  const h = side / 2
  const lonSpan = east - west || 1
  const latSpan = north - south || 1

  for (const s of samples) {
    if (s.col % stride !== 0) continue
    const v = s.v
    // 与三维体渲染同一口径：仅裁剪高于上限的体素；低于色标下限（如 60 dB）时按下限色值绘制
    if (hasFilter && v > vMax) continue
    const x = ((s.lon - west) / lonSpan) * (size - 1)
    const y = ((north - s.lat) / latSpan) * (size - 1)
    if (x < -h || y < -h || x > size + h || y > size + h) continue
    const t = hasColor ? Math.max(0, Math.min(1, (v - cLo) / cSpan)) : 0
    const li = Math.max(0, Math.min(255, Math.round(t * 255))) * 3
    ctx.fillStyle = `rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]})`
    ctx.fillRect(x - h, y - h, side, side)
  }
}

/**
 * 稀疏方位数据补齐：把少量方位（rows 条）按方位角线性插值加密成 targetRows 条射线，
 * 并按「距离 × 方位」逐点换算经纬度，得到铺满整个圆盘的采样点。
 *
 * 用途：标准三维声场（Analyse3DTLRD）这类数据只有 4~12 个扇区，若直接按原始网格点绘制，
 * 热力图只会出现在几条孤立的射线上（呈「米」字形点阵），既看不出全方位分布，
 * 也无法与三维体俯视的连续圆环对齐。补齐后与「声呐预测」样式共用同一套角向插值。
 *
 * @param {object} o
 * @param {object} o.model omni 模型
 * @param {number} o.dIdx 深度层下标
 * @param {number} o.targetRows 目标方位数
 * @param {number} o.maxDist 最大显示距离（米）
 * @param {number} o.sourceLon 声源经度
 * @param {number} o.sourceLat 声源纬度
 * @param {number} o.perDegLon 经度 1° 对应米（该纬度）
 * @returns {{lon:number, lat:number, v:number, row:number, col:number}[]} 补齐后的采样点
 */
function buildAzimuthFilledSamples(o) {
  const { model, dIdx, targetRows, maxDist, sourceLon, sourceLat, perDegLon } = o
  const profiles = buildRayProfiles(model, dIdx, maxDist)
  if (profiles.length === 0) return []

  const rows = Math.max(8, Math.min(720, Math.round(Number(targetRows) || 0)))
  const out = []
  for (let i = 0; i < rows; i++) {
    const az = (i * 360) / rows
    const prof = rayProfileAt(profiles, az)
    if (!prof) continue
    // 方位约定：0° = 正东、逆时针为正 ⇒ 东西向 = cos(az)，南北向 = sin(az)
    const rad = (az * Math.PI) / 180
    const cx = Math.cos(rad)
    const cy = Math.sin(rad)
    for (let k = 0; k < prof.length; k++) {
      const dist = prof[k][0]
      const v = prof[k][1]
      if (!Number.isFinite(v) || !(dist >= 0) || dist > maxDist * 1.0001) continue
      // 优先用剖面点的实测经纬度；只有数据本身没给经纬度时才退回「距离 × 方位」的极坐标换算
      const lon = Number.isFinite(prof[k][2]) ? prof[k][2] : sourceLon + (dist * cx) / perDegLon
      const lat = Number.isFinite(prof[k][3]) ? prof[k][3] : sourceLat + (dist * cy) / M_PER_DEG_LAT
      out.push({ lon, lat, v, row: -1, col: k })
    }
  }
  return out
}

/** 生成 256 级 TL 色标查找表，避免逐像素重复插值计算 */
function buildTlLut(stops) {
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const c = sampleTlColorStops(i / 255, stops)
    lut[i * 3] = Math.round(c[0])
    lut[i * 3 + 1] = Math.round(c[1])
    lut[i * 3 + 2] = Math.round(c[2])
  }
  return lut
}

/**
 * 逐方位（行）提取该深度层沿距离的 TL 剖面。
 * @param {object} model omniFieldModel 输出的模型
 * @param {number} dIdx 深度层下标
 * @param {number} maxDist 最大显示距离（米）
 * @returns {{az:number, prof:[number, number][]}[]} 按方位角升序（prof = [dist, tl][]，tl 可能为 NaN）
 */
function buildRayProfiles(model, dIdx, maxDist) {
  // row / col → 该单元的**实测经纬度**。
  // 二维图的定义是「该深度下、各经纬度处的 dB 值」，因此射线/色块都必须落在数据的真实
  // 坐标上，而不是用「跨方位平均距离 colDist × 方位角」的极坐标近似（后者会让 36 个方位
  // 共用一条平均距离轴，与实际点位相差上百米，也无法体现声线弯曲造成的散点分布）。
  const geo = []
  for (const c of model.cells ?? []) {
    const lon = Number(c.lon)
    const lat = Number(c.lat)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    if (!geo[c.row]) geo[c.row] = []
    geo[c.row][c.col] = [lon, lat]
  }
  const out = []
  const cols = Number(model.cols) || 0
  for (let row = 0; row < (Number(model.rows) || 0); row++) {
    const prof = []
    let valid = false
    for (let col = 0; col < cols; col++) {
      const dist = Number(model.colDist?.[col]) || 0
      if (dist > maxDist * 1.0001) break
      const v = tlAt(model.layers, row, dIdx, col)
      if (Number.isFinite(v)) valid = true
      const g = geo[row]?.[col]
      prof.push([dist, v, g ? g[0] : NaN, g ? g[1] : NaN])
    }
    if (!valid || prof.length < 2) continue
    const azRaw = Number(model.azimuths?.[row])
    const az = Number.isFinite(azRaw) ? ((azRaw % 360) + 360) % 360 : (row / Math.max(1, model.rows)) * 360
    out.push({ az, prof })
  }
  out.sort((a, b) => a.az - b.az)
  return out
}

/** 经度线性插值：跨 ±180° 时走近的一侧 */
function lerpLon(a, b, t) {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : NaN
  if (!Number.isFinite(b)) return a
  let d = b - a
  if (d > 180) d -= 360
  else if (d < -180) d += 360
  return a + d * t
}

/** 纬度线性插值 */
function lerpLat(a, b, t) {
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : NaN
  if (!Number.isFinite(b)) return a
  return a + (b - a) * t
}

/**
 * 在给定方位角上取一条射线剖面：由相邻两条实测方位剖面按角度线性插值。
 * 方位不足（如 panels 仅 13 个方位）时用于加密成连续射线扇面。
 * 剖面点携带实测经纬度，插值方位的经纬度由两侧实测方位按同一比例插值得到。
 * @returns {[number, number, number, number][]|null} [dist, tl, lon, lat][]（tl 可能为 NaN）
 */
function rayProfileAt(profiles, az) {
  const n = profiles.length
  if (n === 0) return null
  if (n === 1) return profiles[0].prof

  let hi = 0
  while (hi < n && profiles[hi].az < az) hi++
  const hiIdx = hi % n
  const b = profiles[hiIdx]
  const a = profiles[(hiIdx - 1 + n) % n]
  // 目标方位落在首个方位之前时，需要把 b 视作 +360° 以形成闭环
  const bAz = hiIdx === 0 ? b.az + 360 : b.az
  // 目标方位也要跟着抬一圈：az = 0° 时 a 是最后一个方位（如 349.9°），
  // 直接用 (az - a.az) 会得到负数、t 被 clamp 成 0 ⇒ 0° 射线画的是 349.9° 的剖面。
  // 把 az 抬到 +360° 后 t = (360 - 349.9) / 10.1 = 1，正确命中 0° 剖面。
  const azQ = az < a.az ? az + 360 : az
  const span = bAz - a.az
  const t = span > 0 ? Math.max(0, Math.min(1, (azQ - a.az) / span)) : 0

  const len = Math.min(a.prof.length, b.prof.length)
  const out = []
  for (let i = 0; i < len; i++) {
    const [dist, va, aLon, aLat] = a.prof[i]
    const vb = b.prof[i][1]
    const bLon = b.prof[i][2]
    const bLat = b.prof[i][3]
    const fa = Number.isFinite(va)
    const fb = Number.isFinite(vb)
    let v = NaN
    if (fa && fb) v = va + (vb - va) * t
    else if (fa) v = va
    else if (fb) v = vb
    out.push([dist, v, lerpLon(aLon, bLon, t), lerpLat(aLat, bLat, t)])
  }
  return out
}

/**
 * 声呐 PDA 风格：由声源向各方位辐射着色射线，射线沿数据各点的**实测经纬度**连线。
 * 每条射线先以暗色细线打底（提升在亮底图上的可读性 / 形成装备显示的黑色刻度感），
 * 再按颜色叠加彩色分段；数据缺失段留空（表现为被截断的射线）。
 *
 * 着色默认走 `colorOf`（即 dB 在色标上的映射，与热力图 / 三维体同一色标）；
 * 只有显式传入 `levels` 时才退回「TL 分级色」（红 → 黄 → 青）。
 */
function drawSonarRays(ctx, cfg) {
  const { canvas, center, pxPerM, project, colorOf, levels, rayProfiles, rayCount, rayWidth } = cfg
  const size = canvas.width
  const nRays = Math.max(8, Math.round(Number(rayCount) || 72))
  /** 剖面点 → 画布像素：优先用实测经纬度，数据缺经纬度时才退回极坐标（距离 × 方位） */
  const pointAt = (p, sx, cy) => {
    const xy = project?.(p[2], p[3])
    if (xy) return xy
    return [center + p[0] * sx * pxPerM, center - p[0] * cy * pxPerM]
  }

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'

  // 打底暗线（全部有效段）
  ctx.strokeStyle = 'rgba(8,15,30,0.55)'
  ctx.lineWidth = rayWidth + 1.2
  for (let i = 0; i < nRays; i++) {
    const az = (i * 360) / nRays
    const prof = rayProfileAt(rayProfiles, az)
    if (!prof) continue
    // 方位约定：0° = 正东，逆时针为正（与 AzimuthPointer / bearingDegFromSource 一致）
    // ⇒ 东西向分量 = cos(az)，南北向分量 = sin(az)（画布 y 轴向下，故 y 取负）
    const rad = (az * Math.PI) / 180
    const sx = Math.cos(rad)
    const cy = Math.sin(rad)
    let started = false
    ctx.beginPath()
    for (let k = 0; k < prof.length; k++) {
      const d = prof[k][0]
      const v = prof[k][1]
      if (!Number.isFinite(v) || !(d >= 0)) {
        started = false
        continue
      }
      const [x, y] = pointAt(prof[k], sx, cy)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }

  // 彩色分段（同色连续段合并成一条路径）
  ctx.lineWidth = rayWidth
  for (let i = 0; i < nRays; i++) {
    const az = (i * 360) / nRays
    const prof = rayProfileAt(rayProfiles, az)
    if (!prof) continue
    const rad = (az * Math.PI) / 180
    const sx = Math.cos(rad)
    const cy = Math.sin(rad)
    let run = []
    let runColor = ''
    const flush = () => {
      if (run.length > 1 && runColor) {
        ctx.strokeStyle = runColor
        ctx.beginPath()
        ctx.moveTo(run[0][0], run[0][1])
        for (let j = 1; j < run.length; j++) ctx.lineTo(run[j][0], run[j][1])
        ctx.stroke()
      }
      run = []
    }
    for (let k = 0; k < prof.length; k++) {
      const d = prof[k][0]
      const v = prof[k][1]
      if (!Number.isFinite(v) || !(d >= 0)) {
        flush()
        runColor = ''
        continue
      }
      const color = levels?.length ? levelColorOf(levels, v) : colorOf?.(v) || ''
      const [x, y] = pointAt(prof[k], sx, cy)
      if (color !== runColor) {
        const last = run.length ? run[run.length - 1] : null
        flush()
        runColor = color
        // 段间补一个接点，避免颜色切换处出现缝隙
        if (last) run.push(last)
      }
      run.push([x, y])
    }
    flush()
  }
  ctx.restore()

  // ── 声源标记：白色底圈 + 红色本源（参考图中心样式） ──
  const srcR = Math.max(6, size / 64)
  ctx.save()
  ctx.beginPath()
  ctx.arc(center, center, srcR, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(250,250,252,0.95)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(center, center, srcR * 0.55, 0, Math.PI * 2)
  ctx.fillStyle = '#e11d48'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(15,23,42,0.7)'
  ctx.stroke()
  ctx.restore()
}

/**
 * 生成二维声场俯视图栅格图像（含等距离线）。
 *
 * @param {object} o 参数
 * @param {object} o.model omniFieldModel 输出的统一声场模型（buildOmniFieldModel）
 * @param {'heatmap'|'sonar'} [o.style='sonar'] 渲染风格：连续色阶热力图 / 声呐 PDA 射线
 * @param {number} [o.depthIndex=0] 深度层下标（默认 0 = 海面）
 * @param {number} [o.maxRadiusM=0] 最大显示距离（米），0 表示取数据全部距离
 * @param {{min:number,max:number}} [o.valueRange] 数据筛选范围（dB）：高于上限不绘制；
 *                                  低于下限（如默认 60 dB）时按下限对应的色值绘制（与三维体渲染同一口径，
 *                                  避免出现透明空洞）；声呐风格下同时作为射线分级范围
 * @param {{min:number,max:number}} [o.colorRange] 色标映射范围（dB），min=红 max=蓝（仅热力图）
 * @param {Array} [o.stops] 自定义色标 [[t,[r,g,b]],...]，缺省 SDK 默认色带（仅热力图）
 * @param {'cells'|'smooth'} [o.render='cells'] 热力图画法：逐坐标点小正方形 / 泼溅平滑色面
 * @param {number} [o.azFillRows=0] 热力图方位目标数：0 = 自动（少于 OMNI_AZ_FILL_ROWS 时按角向插值补齐），
 *                                  传 >0 表示固定补齐到该条射线，传 1 表示只用原始点位
 * @param {number} [o.cellPx=0] 小正方形边长（px），0 = 按数据点间距自动推算
 * @param {number} [o.size=640] 输出边长（像素，正方形）
 * @param {boolean} [o.rings=true] 是否叠加等距离线（最外圈半径不小于实际最大距离，
 *                                 影像矩形随之留白，保证最外圈与标注完整可见）
 * @param {number} [o.grid=257] 中间累计网格边长（节点数，仅 smooth 画法）
 * @param {number} [o.rayCount=72] 射线方位数（声呐风格，数据方位不足时按角向插值加密）
 * @param {number} [o.rayWidth=1.6] 射线线宽（像素，声呐风格）
 * @param {string[]} [o.rayColors] 射线分级配色（由高到低，声呐风格）
 * @param {Function} [o.pointVisible] 经纬点是否允许绘制；用于与三维体共用陆地/海底掩膜
 * @returns {{url:string, width:number, height:number, west:number, south:number, east:number, north:number, maxDist:number, ringRadii:number[]}|null}
 */
export function buildOmniFieldImage(o = {}) {
  const model = o.model
  if (!model?.cells?.length) return null

  const style = o.style === 'heatmap' ? 'heatmap' : 'sonar'
  const pointVisible = typeof o.pointVisible === 'function' ? o.pointVisible : () => true
  /** 热力图画法：'cells' 逐坐标点画小正方形（默认） / 'smooth' 泼溅插值成连续色面 */
  const render = o.render === 'smooth' ? 'smooth' : 'cells'
  const depthList = model.depths ?? []
  const dIdx = Math.max(0, Math.min(depthList.length - 1, Number(o.depthIndex) || 0))
  const fullDist = Number(model.maxDist) || 0
  const maxDist = Number(o.maxRadiusM) > 0 ? Math.min(Number(o.maxRadiusM), fullDist) : fullDist
  if (!(maxDist > 0)) return null

  // 等距离线先算：最外圈允许 ≥ maxDist，影像范围要跟着留出余量，否则最外圈半径等于
  // 画布半宽时会贴边，外半条描边被裁掉；数据本身的绘制 / 裁剪仍以 maxDist 为准。
  const showRings = o.rings !== false
  const ringRadii = showRings ? omniRingRadii(maxDist) : []
  const outerRing = ringRadii.length ? ringRadii[ringRadii.length - 1] : 0

  // 覆盖半径（米）：东西 / 南北各 half 米 ⇒ 绘图比例尺一致，等距离线才是正圆
  const half = Math.max(maxDist, outerRing) * IMAGE_EDGE_PADDING
  // ── 1. 声源经纬度 + 覆盖矩形 ──
  const lat0 = Number(model.sourceLat)
  const lon0 = Number(model.sourceLon)
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return null
  const dLat = half / M_PER_DEG_LAT
  const dLon = half / mPerDegLon(lat0)
  const west = lon0 - dLon
  const east = lon0 + dLon
  const south = lat0 - dLat
  const north = lat0 + dLat

  const size = Math.max(128, Number(o.size) || 640)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const center = size / 2
  const pxPerM = size / (2 * half)
  /** 最大显示距离对应的像素半径 */
  const maxDistPx = Math.max(1, maxDist * pxPerM)
  /**
   * 把后续绘制裁剪在「最大显示距离」圆内。
   * 热力图的小正方形（以点为中心外扩 side/2）、平滑泼溅（影响半径 R）以及声呐射线的
   * 末端线宽都会向外溢出；不裁剪就会在声场体半径（如 50 km）之外继续着色，
   * 表现为「体半径之外还有一圈值」。等距离线不参与裁剪（它要画在半径上标刻度）。
   */
  const clipToMaxDist = () => {
    ctx.beginPath()
    ctx.arc(center, center, maxDistPx, 0, Math.PI * 2)
    ctx.clip()
  }

  const vMin = Number(o.valueRange?.min)
  const vMax = Number(o.valueRange?.max)
  const hasFilter = Number.isFinite(vMin) && Number.isFinite(vMax) && vMax > vMin

  // ── 色标：dB → 颜色。两种风格共用同一套映射，保证图上颜色 = 该点 dB 在色标上的取值 ──
  const lut = buildTlLut(o.stops)
  const cMin = Number(o.colorRange?.min)
  const cMax = Number(o.colorRange?.max)
  const hasColor = Number.isFinite(cMin) && Number.isFinite(cMax) && cMax > cMin
  const cSpan = hasColor ? cMax - cMin : 1
  const cLo = hasColor ? cMin : 0
  /** 经纬度 → 画布像素（与热力图色块同一套映射，保证两种风格地理配准完全一致） */
  const project = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
    return [
      ((lon - west) / (east - west || 1)) * (size - 1),
      ((north - lat) / (north - south || 1)) * (size - 1),
    ]
  }
  /** dB → 色标颜色（超出色标范围取端点色，与三维体渲染同一口径） */
  const colorOf = (v) => {
    if (!hasColor || !Number.isFinite(v)) return ''
    const t = Math.max(0, Math.min(1, (v - cLo) / cSpan))
    const li = Math.max(0, Math.min(255, Math.round(t * 255))) * 3
    return `rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]})`
  }

  if (style === 'heatmap') {
    // ── 2. 收集该深度层有效样本：直接用单元真实经纬度，保证贴到球面时与三维体配准 ──
    // 二维图的定义是「该深度下、各经纬度处的 dB」⇒ 方位本就够密的数据（如 layers 的
    // 36 个方位 × 100 个距离）必须直接用原始点位：插值会把真实坐标换成合成坐标、
    // 把实测 dB 换成插值 dB。只有方位稀疏到铺不成面（如 tlrd 仅 4~12 个扇区）才补齐。
    const nativeRows = Number(model.rows) || 0
    const requestedRows = Math.round(Number(o.azFillRows) || 0)
    const needFill = nativeRows > 0 && nativeRows < OMNI_AZ_FILL_MIN_ROWS
    const targetRows = requestedRows > 0 ? requestedRows : needFill ? OMNI_AZ_FILL_ROWS : 0
    let samples = []
    /** 参与绘制的方位数（补齐后按补齐后的密度计算方块间距） */
    let plotRows = nativeRows
    if (targetRows > nativeRows) {
      const filled = buildAzimuthFilledSamples({
        model,
        dIdx,
        targetRows,
        maxDist,
        sourceLon: lon0,
        sourceLat: lat0,
        perDegLon: Math.max(1e-6, mPerDegLon(lat0)),
      })
      if (filled.length) {
        samples = filled
        plotRows = targetRows
      }
    }
    if (samples.length === 0) {
      for (const c of model.cells) {
        const v = tlAt(model.layers, c.row, dIdx, c.col)
        if (!Number.isFinite(v)) continue
        const lon = Number(c.lon)
        const lat = Number(c.lat)
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
        if (Number.isFinite(c.dist) && c.dist > maxDist * 1.0001) continue
        samples.push({ lon, lat, v, row: c.row, col: c.col })
      }
    }
    samples = samples.filter((sample) => pointVisible(sample.lon, sample.lat))
    if (samples.length === 0) return null

    // ── 3. 色块 / 平滑两种画法共用的公共参数（色标已在上面统一构建）──
    const shared = { canvas, samples, west, east, north, south, lut, cLo, cSpan, hasColor, vMin, vMax, hasFilter }

    // 数据一律裁剪在最大距离圆内，避免方块 / 泼溅的外扩溢出声场体半径
    ctx.save()
    clipToMaxDist()

    if (render === 'cells') {
      // ── 3a. 色块画法：逐坐标点画小正方形，颜色 = 该点 dB 值在色标上的映射 ──
      drawHeatmapCells(ctx, {
        ...shared,
        pxPerM: size / (2 * half),
        maxDist,
        rows: plotRows,
        colDist: model.colDist,
        cellPx: o.cellPx,
      })
    } else {
      // ── 3b. 平滑画法：泼溅到粗网格（w = (1 - d²/R²)²）后双线性采样逐像素着色 ──
      const G = Math.max(65, Number(o.grid) || 257)
      const sumW = new Float64Array(G * G)
      const sumWV = new Float64Array(G * G)
      // 平均间距（网格单位）→ 影响半径：既能补洞，又不至于过度平滑
      const spacing = (G - 1) / Math.sqrt(samples.length)
      const R = Math.max(1.2, spacing * 1.6)
      const R2 = R * R
      // 经纬度 → 网格坐标（线性）：x 向东、y 向南（与画布一致，故像素 → 网格无需翻转）
      const lonToGrid = (lon) => ((lon - west) / (east - west)) * (G - 1)
      const latToGrid = (lat) => ((north - lat) / (north - south)) * (G - 1)
      for (const s of samples) {
        const gx = lonToGrid(s.lon)
        const gy = latToGrid(s.lat)
        const x0 = Math.max(0, Math.ceil(gx - R))
        const x1 = Math.min(G - 1, Math.floor(gx + R))
        const y0 = Math.max(0, Math.ceil(gy - R))
        const y1 = Math.min(G - 1, Math.floor(gy + R))
        for (let iy = y0; iy <= y1; iy++) {
          const dy = iy - gy
          const row = iy * G
          for (let ix = x0; ix <= x1; ix++) {
            const dx = ix - gx
            const d2 = dx * dx + dy * dy
            if (d2 > R2) continue
            const k = 1 - d2 / R2
            const w = k * k
            const idx = row + ix
            sumW[idx] += w
            sumWV[idx] += w * s.v
          }
        }
      }

      const img = ctx.createImageData(size, size)
      const data = img.data
      for (let py = 0; py < size; py++) {
        // 画布第 py 行 = 纬度 north - py/(size-1)*(north-south) ⇒ 与 latToGrid 同一方向
        const gy = ((G - 1) * py) / (size - 1)
        const iy0 = Math.floor(gy)
        const iy1 = Math.min(G - 1, iy0 + 1)
        const fy = gy - iy0
        const row0 = iy0 * G
        const row1 = iy1 * G
        for (let px = 0; px < size; px++) {
          const gx = ((G - 1) * px) / (size - 1)
          const ix0 = Math.floor(gx)
          const ix1 = Math.min(G - 1, ix0 + 1)
          const fx = gx - ix0

          const i00 = row0 + ix0
          const i01 = row0 + ix1
          const i10 = row1 + ix0
          const i11 = row1 + ix1

          const w00 = (1 - fx) * (1 - fy)
          const w10 = fx * (1 - fy)
          const w01 = (1 - fx) * fy
          const w11 = fx * fy

          const wSum = sumW[i00] * w00 + sumW[i10] * w10 + sumW[i01] * w01 + sumW[i11] * w11
          const ptr = (py * size + px) * 4
          // putImageData 不受 ctx.clip 约束 ⇒ 超出最大距离圆的像素在这里显式挖空，
          // 否则平滑泼溅会在声场体半径之外糊出一圈颜色
          const ddx = px - center
          const ddy = py - center
          if (wSum <= 0 || ddx * ddx + ddy * ddy > maxDistPx * maxDistPx) {
            data[ptr + 3] = 0
            continue
          }
          const vSum = sumWV[i00] * w00 + sumWV[i10] * w10 + sumWV[i01] * w01 + sumWV[i11] * w11
          const v = vSum / wSum
          // 与三维体渲染同一口径：仅裁剪高于上限的体素；低于色标下限（如 60 dB）时按下限色值绘制
          if (hasFilter && v > vMax) {
            data[ptr + 3] = 0
            continue
          }
          const t = hasColor ? (v - cLo) / cSpan : 0
          let li = Math.round(Math.max(0, Math.min(1, t)) * 255)
          li = Math.max(0, Math.min(255, li)) * 3
          data[ptr] = lut[li]
          data[ptr + 1] = lut[li + 1]
          data[ptr + 2] = lut[li + 2]
          data[ptr + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
    }
    ctx.restore()
  }

  // ── 5. 等距离线 + （声呐风格）射线 + 声源标记 ──
  if (style === 'sonar') {
    const profiles = buildRayProfiles(model, dIdx, maxDist).map((profile) => ({
      ...profile,
      prof: profile.prof.map((point) =>
        pointVisible(point[2], point[3]) ? point : [point[0], NaN, point[2], point[3]]
      ),
    }))
    if (!profiles.length) return null
    ctx.save()
    clipToMaxDist()
    drawSonarRays(ctx, {
      canvas,
      center,
      pxPerM,
      // 沿数据实测经纬度连线 + 与色标一致的取色（不再用「平均距离轴」和固定三档分级）；
      // 只有显式传入 rayColors 时才退回 TL 分级色
      project,
      colorOf,
      levels: Array.isArray(o.rayColors) && o.rayColors.length ? buildRayLevels(vMin, vMax, o.rayColors) : null,
      rayProfiles: profiles,
      rayCount: o.rayCount,
      rayWidth: Math.max(0.6, Number(o.rayWidth) || 1.6),
    })
    ctx.restore()
  }

  if (showRings && ringRadii.length) {
    ctx.save()
    ctx.strokeStyle = style === 'sonar' ? 'rgba(226,240,255,0.62)' : 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1.5
    if (style !== 'sonar') ctx.setLineDash([6, 6])
    for (const r of ringRadii) {
      ctx.beginPath()
      ctx.arc(center, center, r * pxPerM, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()

    // 距离标注（圆环正上方，带描边保证可读）
    ctx.save()
    const fontSize = Math.max(10, Math.round(size / 48))
    ctx.font = `${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(2,6,23,0.85)'
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    // 最少留出「一行字 + 间隙」的上边距，否则最外圈的标注会被画布顶边截掉上半截
    const labelTopPad = fontSize + 3
    for (const r of ringRadii) {
      const label = style === 'sonar' ? fmtRingLabel(r) : fmtDistLabel(r)
      const y = Math.max(labelTopPad, center - r * pxPerM - 3)
      ctx.strokeText(label, center, y)
      ctx.fillText(label, center, y)
    }
    ctx.restore()

    // 热力图风格：声源标记（声呐风格已在 drawSonarRays 内绘制）
    if (style !== 'sonar') {
      ctx.save()
      ctx.beginPath()
      ctx.arc(center, center, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = '#ef4444'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.stroke()
      ctx.restore()
    }
  }

  // ── 6. 输出（画布与矩形关系：左西右东、上北下南） ──
  return {
    url: canvas.toDataURL('image/png'),
    // Cesium SingleTileImageryProvider 需要显式 tileWidth / tileHeight
    width: canvas.width,
    height: canvas.height,
    west,
    south,
    east,
    north,
    maxDist,
    ringRadii,
    depth: depthList[dIdx],
  }
}
