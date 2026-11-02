/**
 * 把 Analyse3DRTRDDynamic / AnalyseIce3DRTRDDynamic 的三维声线响应拆分为
 * 各方位可复用的二维声线结构（水平距离 + 深度），供现有剖面图、三维体动画
 * 和垂直切面渲染直接消费。
 */

const normalize360 = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? ((number % 360) + 360) % 360 : 0
}

function sameAzimuth(a, b) {
  const diff = Math.abs(normalize360(a) - normalize360(b))
  return Math.min(diff, 360 - diff) < 1e-3
}

function responseBody(response) {
  const body = response?.Data?.Units?.[0]?.Response ?? response?.Response ?? response
  return body && typeof body === 'object' ? body : null
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function horizontalDistance(x, y) {
  const east = finite(x)
  const north = finite(y)
  if (east == null || north == null) return null
  return Math.hypot(east, north)
}

function adaptTrack(track) {
  const xs = Array.isArray(track?.x) ? track.x : []
  const ys = Array.isArray(track?.y) ? track.y : []
  const zs = Array.isArray(track?.z) ? track.z : []
  const count = Math.min(xs.length, zs.length)
  const x = []
  const z = []
  for (let index = 0; index < count; index++) {
    const distance = horizontalDistance(xs[index], ys[index])
    const depth = finite(zs[index])
    if (distance == null || depth == null || depth === 9999) continue
    x.push(distance)
    z.push(depth)
  }
  return x.length >= 2 ? { x, z } : null
}

function adaptSampling(body, azimuth) {
  const list = body?.sampling?.data
  if (!Array.isArray(list) || !list.length) return null
  const item = list.find((entry) => sameAzimuth(entry?.azimuth, azimuth))
  if (!item) return null
  const xs = Array.isArray(item.x) ? item.x : []
  const ys = Array.isArray(item.y) ? item.y : []
  const zs = Array.isArray(item.z) ? item.z : []
  const count = Math.min(xs.length, zs.length)
  const x = []
  const y = []
  for (let index = 0; index < count; index++) {
    const distance = horizontalDistance(xs[index], ys[index])
    const bottomDepth = finite(zs[index])
    if (distance == null || bottomDepth == null) continue
    x.push(distance)
    y.push(-bottomDepth)
  }
  if (x.length < 2) return null
  return { size: x.length, data: { x, y } }
}

function adaptFrameRay(ray) {
  const xs = Array.isArray(ray?.x) ? ray.x : []
  const ys = Array.isArray(ray?.y) ? ray.y : []
  const zs = Array.isArray(ray?.z) ? ray.z : []
  const count = Math.min(xs.length, zs.length)
  const x = []
  const z = []
  for (let index = 0; index < count; index++) {
    const distance = horizontalDistance(xs[index], ys[index])
    const depth = finite(zs[index])
    if (distance == null || depth == null || depth === 9999) continue
    x.push(distance)
    z.push(depth)
  }
  return x.length >= 1 ? { id: ray?.id, x, z } : null
}

/**
 * @param {object} response 门户完整响应或业务 Response。
 * @returns {{ body: object, byAzimuth: Map<number, {
 *   staticResponse: object,
 *   dynamicResponse: object,
 *   distanceMaxM: number,
 *   sourceDepthM: number,
 * }> } | null}
 */
export function adapt3dRayResponseToAzimuths(response) {
  const body = responseBody(response)
  if (!body) return null

  const tracks = Array.isArray(body?.trackData?.data) ? body.trackData.data : []
  const frames = Array.isArray(body?.frames) ? body.frames : []
  const sectionAzimuthById = new Map()
  for (const section of Array.isArray(body?.sections) ? body.sections : []) {
    for (const id of Array.isArray(section?.rayIds) ? section.rayIds : []) {
      sectionAzimuthById.set(id, section.azimuth)
    }
  }

  const trackAzimuth = (track) => finite(track?.azimuth) ?? finite(sectionAzimuthById.get(track?.id))
  const azimuthSet = new Set()
  for (const entry of Array.isArray(body?.azimuths) ? body.azimuths : []) {
    const azimuth = finite(entry)
    if (azimuth != null) azimuthSet.add(normalize360(azimuth))
  }
  for (const track of tracks) {
    const azimuth = trackAzimuth(track)
    if (azimuth != null) azimuthSet.add(normalize360(azimuth))
  }
  for (const frame of frames) {
    for (const ray of Array.isArray(frame?.rays) ? frame.rays : []) {
      const azimuth = finite(ray?.azimuth) ?? finite(sectionAzimuthById.get(ray?.id))
      if (azimuth != null) azimuthSet.add(normalize360(azimuth))
    }
  }
  if (!azimuthSet.size) return null

  const byAzimuth = new Map()
  for (const azimuth of azimuthSet) {
    const staticRays = tracks
      .filter((track) => {
        const value = trackAzimuth(track)
        return value != null && sameAzimuth(value, azimuth)
      })
      .map(adaptTrack)
      .filter(Boolean)

    const trackData = { size: staticRays.length, data: staticRays }
    const sampling = adaptSampling(body, azimuth)
    const staticResponse = {
      calcFrequency: body.calcFrequency,
      coordinateSystem: body.coordinateSystem,
      trackData,
      ...(sampling ? { sampling } : {}),
    }

    const dynamicFrames = frames.map((frame) => ({
      index: frame?.index,
      timeMs: finite(frame?.timeMs) ?? 0,
      progress: finite(frame?.progress) ?? 0,
      rays: (Array.isArray(frame?.rays) ? frame.rays : [])
        .filter((ray) => {
          const value = finite(ray?.azimuth) ?? finite(sectionAzimuthById.get(ray?.id))
          return value != null && sameAzimuth(value, azimuth)
        })
        .map(adaptFrameRay)
        .filter(Boolean),
    }))
    const lastFrameMs = dynamicFrames.length ? dynamicFrames[dynamicFrames.length - 1].timeMs : 0
    const dynamicResponse = {
      ...staticResponse,
      frameCount: dynamicFrames.length,
      durationMs: Math.max(1, lastFrameMs || 0),
      trailRatio: 0,
      frames: dynamicFrames,
    }

    const allPoints = staticRays.flatMap((ray) => ray.x.map((distance, index) => [distance, ray.z[index]]))
    const distanceMaxM = allPoints.reduce((max, point) => Math.max(max, point[0]), 0)
    const sourceDepthM = staticRays[0]?.z?.[0] ?? null
    byAzimuth.set(azimuth, { staticResponse, dynamicResponse, distanceMaxM, sourceDepthM })
  }

  return { body, byAzimuth }
}
