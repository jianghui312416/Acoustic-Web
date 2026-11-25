/**
 * 由三维传播损失 TL 体派生「信号余量」SE 体：
 *   SE = SL − TL − NL − DT + AG
 *
 * - 只保留目标深度区间 [minDepth, maxDepth] 内的水体；区间外视为无效（不渲染）。
 * - 通过 Object.create 复用原声场体的 grid / bottom / soundProfile 等只读字段，
 *   仅重写 at() 与 isBelowSeabed()，从而让现有体渲染管线直接按 SE 着色。
 *
 * @param {object} tlField parseAnalyse3DTlrd 返回的三维声场体
 * @param {{sourceLevel:number, noiseLevel:number, detectionThreshold:number, arrayGain:number, minDepth:number, maxDepth:number}} params
 * @returns {object|null} 派生 SE 体；参数无效时返回 null
 */

/** 信号余量 SE 的发散色标：负值蓝 → 0 白 → 正值红。 */
export const SIGNAL_EXCESS_COLOR_STOPS = Object.freeze([
  [0, [24, 52, 160]],
  [0.35, [72, 140, 235]],
  [0.5, [238, 240, 244]],
  [0.65, [240, 150, 70]],
  [1, [200, 44, 44]],
])

/** 三色探测分级；null 表示低于 25% 时不显示。 */
export function detectionClassColor(probability) {
  const pd = Number(probability)
  if (!Number.isFinite(pd) || pd < 25) return null
  if (pd < 50) return [0, 0, 0]
  if (pd <= 75) return [255, 255, 0]
  return [255, 0, 0]
}

/**
 * 三色模式图例。Margin 模式把 25/50/75% 反算为 SE 阈值，Pd 模式直接使用百分比。
 */
export function buildDetectionClassGradient(min, max, displayMode = 'pd', sigma = 6) {
  const low = Number(min)
  const high = Number(max)
  const span = Math.max(1e-6, high - low)
  const spread = Math.max(1e-6, Number(sigma) || 6)
  const valueAt = displayMode === 'pd'
    ? (pd) => pd
    : (pd) => (pd === 25 ? -0.67448975 * spread : pd === 75 ? 0.67448975 * spread : 0)
  const position = (pd) => Math.min(100, Math.max(0, ((valueAt(pd) - low) / span) * 100)).toFixed(3)
  const p25 = position(25)
  const p50 = position(50)
  const p75 = position(75)
  return `linear-gradient(90deg, transparent 0%, transparent ${p25}%, #000 ${p25}%, #000 ${p50}%, #ffff00 ${p50}%, #ffff00 ${p75}%, #ff0000 ${p75}%, #ff0000 100%)`
}

/**
 * 标准正态累积分布 Φ(z)，用于由信号余量 SE 计算探测概率 Pd = Φ(SE / σ)。
 * 采用 Abramowitz & Stegun 7.1.26 近似，精度约 1e-7。
 */
export function standardNormalCdf(z) {
  const value = Number(z)
  if (!Number.isFinite(value)) return NaN
  const t = 1 / (1 + 0.2316419 * Math.abs(value))
  const d = 0.3989422804014327 * Math.exp(-value * value / 2)
  const cdf = 1 - d * t * (0.319381530
    + t * (-0.356563782
      + t * (1.781477937
        + t * (-1.821255978
          + t * 1.330274429))))
  return value >= 0 ? cdf : 1 - cdf
}

/**
 * 解析信号余量生效的深度区间。
 * - 全深度模拟：直接取整个深度轴范围；
 * - 否则取侧边栏目标深度区间 [minDepth, maxDepth]（自动纠正上下限顺序）。
 *
 * @param {object} params 信号余量参数
 * @param {number[]} [depths] 深度轴（升序）
 * @returns {{low:number, high:number, fullDepth:boolean}}
 */
export function resolveSignalExcessDepthRange(params, depths = []) {
  const list = Array.isArray(depths) ? depths : []
  const fullDepth = Boolean(params?.fullDepth) && list.length > 0
  return {
    low: fullDepth
      ? Number(list[0])
      : Math.min(Number(params?.minDepth), Number(params?.maxDepth)),
    high: fullDepth
      ? Number(list[list.length - 1])
      : Math.max(Number(params?.minDepth), Number(params?.maxDepth)),
    fullDepth,
  }
}

/** SE = SL − NL − DT + AG 中与 TL 无关的常数项。无效参数返回 NaN。 */
export function resolveSignalExcessOffset(params) {
  return Number(params?.sourceLevel) - Number(params?.noiseLevel)
    - Number(params?.detectionThreshold) + Number(params?.arrayGain)
}

/**
 * 把单个 TL 值换算为信号余量 SE（dB）或探测概率 Pd（%）。
 * @param {number} tl 传播损失（dB）
 * @param {object} params 信号余量参数
 * @param {number} [offset] 预先解析的常数项，避免逐点重复计算
 */
export function signalExcessValueForTl(tl, params, offset = resolveSignalExcessOffset(params)) {
  const value = Number(tl)
  if (!Number.isFinite(value)) return NaN
  const se = Number(offset) - value
  if (params?.displayMode === 'pd') {
    const sigma = Math.max(1e-6, Number(params?.sigma) || 6)
    return standardNormalCdf(se / sigma) * 100
  }
  return se
}

export function createSignalExcessField(tlField, params) {
  if (!tlField?.grid) return null
  const noiseLevel = Number(params?.noiseLevel)
  if (!Number.isFinite(noiseLevel)) return null

  const grid = tlField.grid
  const depths = Array.isArray(grid.depth) ? grid.depth : []
  // 全深度模拟：深度区间直接取整个 grid 深度范围（含海面到最大深度），忽略侧边栏区间。
  const { low, high } = resolveSignalExcessDepthRange(params, depths)
  const offset = resolveSignalExcessOffset(params)
  if (!Number.isFinite(offset)) return null
  // σ：信号余量波动标准差；σ = 0 退化为稳态阶跃，故钳制到极小正值避免除零。
  const sigma = Math.max(1e-6, Number(params.sigma) || 6)
  const pdMode = params.displayMode === 'pd'

  const inBand = (depth) => Number.isFinite(depth) && depth >= low && depth <= high

  // 把某个深度值映射为 grid.depth 上的（可含小数的）层索引；depth 单调递增。
  const depthIndexFor = (target) => {
    if (depths.length < 2) return 0
    if (target <= Number(depths[0])) return 0
    if (target >= Number(depths[depths.length - 1])) return depths.length - 1
    for (let i = 1; i < depths.length; i++) {
      const upper = Number(depths[i])
      if (upper >= target) {
        const lower = Number(depths[i - 1])
        const span = upper - lower
        return (i - 1) + (span > 0 ? (target - lower) / span : 0)
      }
    }
    return depths.length - 1
  }

  const field = Object.create(tlField)
  field.signalExcess = true
  field.signalExcessPd = pdMode
  field.at = (sectorIndex, depthIndex, distanceIndex) => {
    if (!inBand(Number(depths[depthIndex]))) return NaN
    const tl = tlField.at(sectorIndex, depthIndex, distanceIndex)
    if (!Number.isFinite(tl)) return NaN
    const se = offset - tl
    return pdMode ? standardNormalCdf(se / sigma) * 100 : se
  }
  field.isBelowSeabed = (sectorIndex, depthIndex, distanceIndex) => {
    if (!inBand(Number(depths[depthIndex]))) return true
    return tlField.isBelowSeabed(sectorIndex, depthIndex, distanceIndex)
  }
  // 体渲染把 TL 作为“顶层表面”绘制：普通场在 0 m 取顶面，SE 场应改在目标最小深度取顶面，
  // 否则 0 m 被深度区间裁掉后顶面消失、看起来什么也没渲染。
  field.topDepthIndex = depthIndexFor(low)

  // SE = offset − TL，故 SE_min = offset − TL_max，SE_max = offset − TL_min。
  const tlMin = Number.isFinite(tlField.valueMin) ? tlField.valueMin : 0
  const tlMax = Number.isFinite(tlField.valueMax) ? tlField.valueMax : 1
  let seMin = offset - tlMax
  let seMax = offset - tlMin
  if (!(seMax > seMin)) seMax = seMin + 1
  // Pd 模式把 SE 值域映射到探测概率百分比 [0, 100]。
  if (pdMode) {
    seMin = standardNormalCdf(seMin / sigma) * 100
    seMax = standardNormalCdf(seMax / sigma) * 100
  }
  // 基类 valueMin/valueMax 是只有 getter 的访问器属性，直接赋值在严格模式下会抛错；
  // 用 defineProperty 在派生对象上建立自有数据属性来覆盖。
  Object.defineProperty(field, 'valueMin', { value: seMin, writable: true, enumerable: true, configurable: true })
  Object.defineProperty(field, 'valueMax', { value: seMax, writable: true, enumerable: true, configurable: true })
  field.stats = {
    ...(tlField.stats || {}),
    valueMin: seMin,
    valueMax: seMax,
  }
  return field
}
