/**
 * dynamicRayPaths.js — 二维声线动态轨迹接口
 * ==========================================
 *
 * 与 `parseAnalyse2DRtrd`（静态二维声线轨迹）对应，本模块把同一个 Analyse2DRTRD
 * 返回数据展开成**随时间变化的声线帧**，供「流星 / 水流」式声线动画直接消费：
 *
 * ```
 * const animation = buildDynamicRayFrames(rayJson, {
 *   frameCount: 90,      // 一个周期的帧数
 *   durationMs: 6000,    // 一个周期的时长
 *   trailRatio: 0.25,    // 流星尾迹长度（占单条声线总弧长的比例）
 * })
 * animation.frames[t].rays[i].x // 第 t 帧、第 i 条声线的水平距离数组（米）
 * animation.frames[t].rays[i].z // 第 t 帧、第 i 条声线的深度数组（米，向下为正）
 * ```
 *
 * 输出约定：
 *  - `x`：水平距离，单位 **米**，与 `parseAnalyse2DRtrd` 的 `rays[][][0]` 一致；
 *  - `z`：深度，单位 **米**，向下为正，与 `parseAnalyse2DRtrd` 的 `rays[][][1]` 一致；
 *  - `progress` / `timeMs`：动画进度（0 ~ 1）与时间（毫秒）；
 *  - 每帧只返回当前可见的**尾 → 头**片段，客户端直接按数组绘制折线即可；
 *  - `trailRatio = 0` 时尾迹固定在声源，表现为声线从声源逐步伸长到最大距离；
 *  - `trailRatio > 0` 时尾迹跟随声线头部移动，表现为流星 / 水流效果。
 *
 * 声线按**自身弧长**推进，因此长度不同的声线会在同一周期内同时到达各自终点，
 * 不需要额外提供声速 / 传播时间数据。
 */
import { RTRD_PLUGIN, parseAnalyse2DRtrd, toFiniteNumber } from './ncFieldModel.js'

/** 动态声线接口默认参数 */
export const DYNAMIC_RAY_DEFAULTS = Object.freeze({
  /** 一个动画周期的帧数（含首尾帧），范围 2 ~ 2000 */
  frameCount: 60,
  /** 一个动画周期的时长（毫秒） */
  durationMs: 6000,
  /** 尾迹长度占单条声线总弧长的比例，0 ~ 1；0 表示固定从声源逐步伸长 */
  trailRatio: 0.25,
  /** 尾迹的固定物理长度（米）：> 0 时优先于 trailRatio，使各声线尾迹等长 */
  trailLengthM: 0,
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function resolveFrameCount(value) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? clamp(n, 2, 2000) : DYNAMIC_RAY_DEFAULTS.frameCount
}

function resolveDurationMs(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : DYNAMIC_RAY_DEFAULTS.durationMs
}

function resolveTrailRatio(value) {
  const n = Number(value)
  return Number.isFinite(n) ? clamp(n, 0, 1) : DYNAMIC_RAY_DEFAULTS.trailRatio
}

function resolveTrailLengthM(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 把「原始 Analyse2DRTRD JSON / parseAnalyse2DRtrd 结果 / 声线数组」统一成声线数组。
 * @param {object|number[][][]} input
 * @returns {{rays: number[][][], plugin:string, frequencyHz:number, sourceDepthM:number,
 *            maxDistM:number, maxDepthM:number, rayCount:number}|null}
 */
function resolveRaySource(input) {
  if (Array.isArray(input)) {
    const rays = input.filter((path) => Array.isArray(path) && path.length >= 2)
    if (!rays.length) return null
    return {
      rays,
      plugin: RTRD_PLUGIN,
      frequencyHz: NaN,
      sourceDepthM: Number(rays[0]?.[0]?.[1]),
      maxDistM: maxPathMetric(rays, 0),
      maxDepthM: maxPathMetric(rays, 1),
      rayCount: rays.length,
    }
  }

  if (input && Array.isArray(input.rays) && Array.isArray(input.rays[0]) && Array.isArray(input.rays[0][0])) {
    return {
      rays: input.rays,
      plugin: input.plugin || RTRD_PLUGIN,
      frequencyHz: toFiniteNumber(input.frequencyHz),
      sourceDepthM: toFiniteNumber(input.sourceDepthM),
      maxDistM: toFiniteNumber(input.maxDistM),
      maxDepthM: toFiniteNumber(input.maxDepthM),
      rayCount: Number(input.rayCount) || input.rays.length,
    }
  }

  const parsed = parseAnalyse2DRtrd(input)
  return parsed ? { ...parsed } : null
}

function maxPathMetric(rays, axis) {
  let max = 0
  for (const path of rays) {
    for (const point of path) {
      const value = toFiniteNumber(point?.[axis])
      if (Number.isFinite(value) && value > max) max = value
    }
  }
  return max
}

/** 把一条声线整理成有限点，并计算累计弧长（米）。 */
function buildTrack(path) {
  const points = []
  for (const point of Array.isArray(path) ? path : []) {
    const x = toFiniteNumber(point?.[0])
    const z = toFiniteNumber(point?.[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    points.push([x, z])
  }
  if (points.length < 2) return null

  const cumulative = new Float64Array(points.length)
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dz = points[i][1] - points[i - 1][1]
    cumulative[i] = cumulative[i - 1] + Math.hypot(dx, dz)
  }
  const lengthM = cumulative[cumulative.length - 1]
  if (!(lengthM > 0)) return null
  return { points, cumulative, lengthM }
}

/** 弧长位置 → 声线上的插值点；越界时返回首 / 尾点。 */
function pointAtDistance(track, distanceM) {
  const { points, cumulative, lengthM } = track
  if (distanceM <= 0) return points[0]
  if (distanceM >= lengthM) return points[points.length - 1]

  let lo = 0
  let hi = cumulative.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumulative[mid] <= distanceM) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const span = cumulative[hi] - cumulative[lo]
  const t = span > 0 ? (distanceM - cumulative[lo]) / span : 0
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9
}

/**
 * 取一条声线在 `[tailDistanceM, headDistanceM]` 弧长区间内的可见折线。
 * 返回的 `x` / `z` 从尾端指向头部，可直接用于 ECharts / Cesium 折线。
 */
function sampleTrackSegment(track, tailDistanceM, headDistanceM) {
  const headDistance = clamp(headDistanceM, 0, track.lengthM)
  const tailDistance = clamp(tailDistanceM, 0, headDistance)
  const x = []
  const z = []
  if (!(headDistance > 0)) {
    return { x, z, head: null, tail: null, headDistanceM: 0, tailDistanceM: 0 }
  }

  const tailPoint = pointAtDistance(track, tailDistance)
  x.push(tailPoint[0])
  z.push(tailPoint[1])

  for (let i = 0; i < track.points.length; i++) {
    const distance = track.cumulative[i]
    if (distance <= tailDistance + 1e-9 || distance >= headDistance - 1e-9) continue
    const point = track.points[i]
    const last = [x[x.length - 1], z[z.length - 1]]
    if (!samePoint(last, point)) {
      x.push(point[0])
      z.push(point[1])
    }
  }

  const headPoint = pointAtDistance(track, headDistance)
  const last = [x[x.length - 1], z[z.length - 1]]
  if (!samePoint(last, headPoint)) {
    x.push(headPoint[0])
    z.push(headPoint[1])
  }

  return {
    x,
    z,
    head: headPoint,
    tail: tailPoint,
    headDistanceM: headDistance,
    tailDistanceM: tailDistance,
  }
}

/**
 * 生成某一进度下的声线帧（不依赖预先生成的 `frames`）。
 * @param {object} model `buildDynamicRayFrames` 的返回值
 * @param {number} progress 动画进度，0 ~ 1
 * @returns {object|null} 与 `frames[i]` 同结构的帧对象
 */
export function sampleDynamicRayFrame(model, progress) {
  if (!model?.rays?.length) return null
  const p = clamp(Number(progress) || 0, 0, 1)
  const frameCount = Math.max(2, Number(model.frameCount) || 2)
  const index = Math.round(p * (frameCount - 1))
  if (!Array.isArray(model._tracks)) return model.frames?.[index] ?? null
  return buildFrame(model, index, index / (frameCount - 1))
}

/**
 * 按时间取声线帧（自动换算为进度）。
 * @param {object} model `buildDynamicRayFrames` 的返回值
 * @param {number} timeMs 当前时间（毫秒，相对动画起点）
 * @returns {object|null} 帧对象
 */
export function dynamicRayFrameAt(model, timeMs) {
  const durationMs = Math.max(1, Number(model?.durationMs) || 1)
  return sampleDynamicRayFrame(model, Number(timeMs) / durationMs)
}

function buildFrame(model, index, progress) {
  const rays = model._tracks.map((track, id) => {
    const headDistanceM = track.lengthM * progress
    const tailLengthM =
      model.trailLengthM > 0 ? model.trailLengthM : track.lengthM * model.trailRatio
    // trailRatio / trailLengthM 都为 0 时尾迹固定在声源，声线从声源逐步伸长。
    const tailDistanceM = tailLengthM > 0 ? Math.max(0, headDistanceM - tailLengthM) : 0
    const segment = sampleTrackSegment(track, tailDistanceM, headDistanceM)
    return {
      id,
      x: segment.x,
      z: segment.z,
      head: segment.head,
      tail: segment.tail,
      headDistanceM: segment.headDistanceM,
      tailDistanceM: segment.tailDistanceM,
      progress,
    }
  })
  return {
    index,
    timeMs: progress * model.durationMs,
    progress,
    rays,
  }
}

/**
 * 基于二维声线轨迹（Analyse2DRTRD）构建随时间变化的动态声线。
 *
 * 输入可以是：
 *  - Analyse2DRTRD 原始 JSON（`Data.Units[0].Response.trackData`）；
 *  - `parseAnalyse2DRtrd(json)` 的返回值；
 *  - 直接传入声线数组 `[[[distM, depthM], ...], ...]`。
 *
 * @param {object|number[][][]} input 二维声线数据
 * @param {object} [options]
 * @param {number} [options.frameCount=60] 帧数（含首尾帧），2 ~ 2000
 * @param {number} [options.durationMs=6000] 周期时长（毫秒）
 * @param {number} [options.trailRatio=0.25] 尾迹占单条声线弧长的比例，0 ~ 1
 * @param {number} [options.trailLengthM=0] 固定尾迹长度（米），> 0 时优先于 trailRatio
 * @returns {object|null} 动态声线模型；无有效声线时返回 null
 */
export function buildDynamicRayFrames(input, options = {}) {
  const source = resolveRaySource(input)
  if (!source) return null

  const tracks = []
  for (const path of source.rays) {
    const track = buildTrack(path)
    if (track) tracks.push(track)
  }
  if (!tracks.length) return null

  const frameCount = resolveFrameCount(options.frameCount)
  const durationMs = resolveDurationMs(options.durationMs)
  const trailRatio = resolveTrailRatio(options.trailRatio)
  const trailLengthM = resolveTrailLengthM(options.trailLengthM)
  const maxDistM = Number.isFinite(source.maxDistM) ? source.maxDistM : maxPathMetric(source.rays, 0)
  const maxDepthM = Number.isFinite(source.maxDepthM) ? source.maxDepthM : maxPathMetric(source.rays, 1)

  const model = {
    plugin: source.plugin || RTRD_PLUGIN,
    frequencyHz: Number.isFinite(source.frequencyHz) ? source.frequencyHz : NaN,
    sourceDepthM: Number.isFinite(source.sourceDepthM) ? source.sourceDepthM : tracks[0].points[0][1],
    maxDistM,
    maxDepthM,
    rayCount: tracks.length,
    frameCount,
    durationMs,
    frameIntervalMs: durationMs / (frameCount - 1),
    trailRatio,
    trailLengthM,
    rays: tracks.map((track, id) => ({
      id,
      lengthM: track.lengthM,
      pointCount: track.points.length,
    })),
    frames: [],
  }
  // 内部弧长轨迹不参与序列化；`frames` 已包含可直接消费的 x / z 数组。
  Object.defineProperty(model, '_tracks', { value: tracks, enumerable: false })

  for (let i = 0; i < frameCount; i++) {
    model.frames.push(buildFrame(model, i, i / (frameCount - 1)))
  }

  return model
}

/** 从门户响应中取出二维声线 `Response`（找不到返回 null）。 */
function pickPortalResponse(input) {
  const units = input?.Data?.Units
  if (!Array.isArray(units) || units.length === 0) return null
  const unit = units.find(
    (item) =>
      item?.Plugin === RTRD_PLUGIN ||
      item?.Plugin === `${RTRD_PLUGIN}Dynamic` ||
      !!item?.Response?.trackData ||
      Array.isArray(item?.Response?.frames)
  )
  return unit?.Response ?? null
}

/**
 * 统一获取动态声线帧模型：
 *  - 后端 `Analyse2DRTRDDynamic` 响应已带 `frames` 时直接使用；
 *  - 其余情况（普通 `Analyse2DRTRD` 响应 / 声线数组）在本地构建帧。
 *
 * @param {object|number[][][]} input 原始门户响应、`parseAnalyse2DRtrd` 结果或声线数组
 * @param {object} [options] 本地构建帧时的参数，同 `buildDynamicRayFrames`
 * @returns {object|null} 动态声线模型
 */
export function resolveDynamicRayFrames(input, options = {}) {
  if (input && Array.isArray(input.frames) && input.frames.length) return input
  const response = pickPortalResponse(input)
  if (response && Array.isArray(response.frames) && response.frames.length) return response
  return buildDynamicRayFrames(input, options)
}

/** 与 `buildDynamicRayFrames` 等价的别名，便于按「动态声线接口」语义调用。 */
export const buildDynamicRayPaths = buildDynamicRayFrames

/** 与静态接口 `parseAnalyse2DRtrd` 对应的动态解析别名。 */
export const parseAnalyse2DRtrdDynamic = buildDynamicRayFrames
