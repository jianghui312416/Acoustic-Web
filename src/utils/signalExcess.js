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

export function createSignalExcessField(tlField, params) {
  if (!tlField?.grid) return null
  const noiseLevel = Number(params?.noiseLevel)
  if (!Number.isFinite(noiseLevel)) return null

  const grid = tlField.grid
  const depths = Array.isArray(grid.depth) ? grid.depth : []
  const low = Math.min(Number(params.minDepth), Number(params.maxDepth))
  const high = Math.max(Number(params.minDepth), Number(params.maxDepth))
  const offset = Number(params.sourceLevel) - noiseLevel
    - Number(params.detectionThreshold) + Number(params.arrayGain)
  if (!Number.isFinite(offset)) return null

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
  field.at = (sectorIndex, depthIndex, distanceIndex) => {
    if (!inBand(Number(depths[depthIndex]))) return NaN
    const tl = tlField.at(sectorIndex, depthIndex, distanceIndex)
    return Number.isFinite(tl) ? offset - tl : NaN
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
