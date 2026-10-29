// Visual propagation clock, not a travel-time solver: no sound-speed field is available here.
// All tracks advance by the same physical arc length to form a coherent wavefront.
export function buildRayFlow(paths = [], frameModel = null) {
  const tracks = []
  for (const path of paths) {
    let points = []
    const flush = () => {
      if (points.length > 1) {
        const cumulative = [0]
        for (let i = 1; i < points.length; i++) {
          cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
        }
        if (cumulative.at(-1) > 0) tracks.push({ points, cumulative, length: cumulative.at(-1) })
      }
      points = []
    }
    for (const point of path) {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) { flush(); continue }
      if (!points.length || point[0] !== points.at(-1)[0] || point[1] !== points.at(-1)[1]) points.push(point)
    }
    flush()
  }
  if (!tracks.length && !frameModel?.frames?.length) return null
  const length = tracks.reduce((max, track) => Math.max(max, track.length), 0)
  const flow = { tracks, length, trailLength: length * 0.018, durationMs: 8000, frameModel }
  if (frameModel?.frames?.length) {
    const frames = frameModel.frames
    const lastTime = Number(frames.at(-1).timeMs)
    flow.durationMs = Math.max(1, Number(frameModel.durationMs) || lastTime || 8000)
    // 服务端帧按传播时间给出每条声线从声源到当前头位置的可见片段（x/z）。
    // 直接绘制整段，并让头部最亮、声源端淡出，形成「声线随 t 生长」动画，
    // 而不是只画头部的一小段流星尾迹。
    flow.serverFrames = frames.map((frame, index) => ({
      timeMs: Number.isFinite(Number(frame.timeMs)) ? Number(frame.timeMs)
        : (Number.isFinite(Number(frame.progress)) ? Number(frame.progress) : index / Math.max(1, frames.length - 1)) * flow.durationMs,
      trails: (frame.rays ?? []).flatMap(ray => {
        const points = (ray.x ?? []).map((x, i) => [Number(x), Number(ray.z?.[i])])
        const local = buildRayFlow([points])
        // 后端帧给出“声源 → 当前头部”的完整路径；只取头部附近的
        // 短尾迹绘制，避免动态模式在三维体上看起来像一组静态全长折线。
        return local?.tracks.map(track => trailPoints(track, track.length, Math.max(track.length * .018, 1e-6))) ?? []
      }),
    })).sort((a, b) => a.timeMs - b.timeMs)
  }
  return flow
}

export function resolveRayFlow(response, fallbackPaths = []) {
  const body = response?.frames?.length ? response
    : response?.Data?.Units?.find(unit => unit?.Response?.frames?.length)?.Response
  return buildRayFlow(fallbackPaths, body ?? null)
}

function atDistance(track, distance) {
  const { points, cumulative } = track
  if (distance <= 0) return points[0]
  if (distance >= track.length) return points.at(-1)
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumulative[mid] <= distance) lo = mid
    else hi = mid
  }
  const t = (distance - cumulative[lo]) / (cumulative[hi] - cumulative[lo])
  return [points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t]
}

// Keep original vertices (including surface/bottom reflection corners), adding evenly
// spaced samples so even a two-point ray gets a graduated tail.
function trailPoints(track, head, tailLength) {
  const tail = Math.max(0, head - tailLength)
  const end = Math.min(track.length, head)
  if (tail >= end) return []
  const distances = [tail, end]
  for (let i = 1; i < 8; i++) {
    const distance = tail + (head - tail) * i / 8
    if (distance < end) distances.push(distance)
  }
  // Binary search avoids rescanning the complete track on every paint.
  let lo = 0
  let hi = track.cumulative.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (track.cumulative[mid] <= tail) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < track.cumulative.length && track.cumulative[i] < end; i++) distances.push(track.cumulative[i])
  return [...new Set(distances)].sort((a, b) => a - b).map(distance => ({
    point: atDistance(track, distance),
    alpha: Math.pow(Math.max(0, 1 - (head - distance) / tailLength), 1.7),
  }))
}

export function sampleRayFlow(flow, elapsedMs) {
  if (!flow) return []
  const duration = flow.durationMs
  const progress = ((elapsedMs % duration) + duration) % duration / duration
  if (flow.serverFrames) {
    const time = progress * duration
    const frames = flow.serverFrames
    if (time < frames[0].timeMs) return []
    let lo = 0
    let hi = frames.length
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (frames[mid].timeMs <= time) lo = mid
      else hi = mid
    }
    return frames[lo].trails
  }
  if (flow.tracks.length) {
    // Extra tail distance lets the last particles leave the chart before relaunching.
    const head = progress * (flow.length + flow.trailLength)
    return flow.tracks.map(track => trailPoints(track, head, flow.trailLength)).filter(points => points.length > 1)
  }
  return []
}

// Continuous physical value -> category position, including nonuniform/descending axes.
export function fractionalAxisIndex(values, value) {
  if (values.length < 2) return 0
  const direction = values.at(-1) >= values[0] ? 1 : -1
  let lo = 0
  let hi = values.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (direction * values[mid] <= direction * value) lo = mid
    else hi = mid
  }
  const span = values[hi] - values[lo]
  return lo + (span ? (value - values[lo]) / span : 0)
}

export function rayChartViewport(chart, distances, depths, category, bottom, right = 54) {
  if (!chart || chart.isDisposed() || !distances.length || !depths.length) return null
  const first = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, category ? [0, 0] : [distances[0], depths[0]])
  const last = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, category ? [distances.length - 1, depths.length - 1] : [distances.at(-1), depths.at(-1)])
  if (!first?.every(Number.isFinite) || !last?.every(Number.isFinite)) return null
  return {
    rect: [62, 16, Math.max(0, chart.getWidth() - 62 - right), Math.max(0, chart.getHeight() - 16 - bottom)],
    project: ([x, z]) => {
      const tx = category ? fractionalAxisIndex(distances, x) / Math.max(1, distances.length - 1) : (x - distances[0]) / (distances.at(-1) - distances[0] || 1)
      const tz = category ? fractionalAxisIndex(depths, z) / Math.max(1, depths.length - 1) : (z - depths[0]) / (depths.at(-1) - depths[0] || 1)
      return [first[0] + tx * (last[0] - first[0]), first[1] + tz * (last[1] - first[1])]
    },
  }
}
