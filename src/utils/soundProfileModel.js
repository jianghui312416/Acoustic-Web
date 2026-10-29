/**
 * soundProfileModel.js（兼容层）
 * ==========================================
 * 「距离—深度」剖面模型与声线追踪的实现已统一迁移至 `@/sdk`
 * （`analysis/soundfield/ncFieldModel.js`），本文件仅做 re-export，
 * 保证既有引用路径 `@/utils/soundProfileModel.js` 不失效。
 *
 * 新代码请直接从 SDK 引入：
 *   import { buildProfileModel, nearestAzimuthRow, collectRayPaths } from '@/sdk'
 */
export {
  normalizeAzimuth360 as normalize360,
  normalize180,
  nearestIndex,
  buildProfileModel,
  nearestAzimuthRow,
  distanceColumns,
  profileAxisGeometry,
  seabedDepthAtDistance,
  clipRayPathsByProfile,
  collectRayPaths,
} from '@/sdk'

/** 距离文案：<1km 用 m，其余用 km（UI 格式化，不属于 SDK 解析职责） */
export function fmtDist(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${n.toFixed(0)} m`
}

/** 取 1 / 2 / 5 × 10^n 中不小于 raw 的最小值（刻度取整） */
export function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const base = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 5, 10]) {
    if (base * m >= raw) return base * m
  }
  return base * 10
}
