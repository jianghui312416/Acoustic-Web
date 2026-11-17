const EARTH_RADIUS_M = 6_371_008.8
const KNOT_TO_MPS = 1852 / 3600
const SCREEN_HEADING_SAMPLE_DEG = 0.002

function finiteNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validHeading(value) {
  const heading = finiteNumber(value)
  return heading != null && heading >= 0 && heading < 360 ? heading : null
}

/** 船首向优先，缺失时退回航迹向；无效的 511 等值不会覆盖航迹向。 */
export function aisHeadingDegrees(vessel) {
  return validHeading(vessel?.heading_deg) ?? validHeading(vessel?.cog_deg) ?? 0
}

/**
 * 把地理航向转换为屏幕旋转角（0 = 屏幕正上方，顺时针为正）。
 * 地形视图会随相机偏航和俯仰改变南北方向，必须用实际投影计算，
 * 不能直接把地理航向当作屏幕角度使用。
 */
export function screenHeadingAngle(project, longitude, latitude, headingDeg, elevation = 0) {
  if (typeof project !== 'function') return 0
  const lon = finiteNumber(longitude)
  const lat = finiteNumber(latitude)
  if (lon == null || lat == null) return 0
  const bearing = (finiteNumber(headingDeg) ?? 0) * Math.PI / 180
  const cosLat = Math.max(0.1, Math.cos(lat * Math.PI / 180))
  const step = SCREEN_HEADING_SAMPLE_DEG
  const start = project(lon, lat, elevation)
  const end = project(
    lon + Math.sin(bearing) * step / cosLat,
    lat + Math.cos(bearing) * step,
    elevation
  )
  if (!start || !end) return 0
  const dx = end.x - start.x
  const dy = end.y - start.y
  return Math.hypot(dx, dy) > 1e-9 ? Math.atan2(dx, -dy) : 0
}

export function normalizeAisTrackPoint(raw) {
  const longitude = finiteNumber(raw?.longitude)
  const latitude = finiteNumber(raw?.latitude)
  if (longitude == null || latitude == null) return null
  return {
    longitude,
    latitude,
    sog_kn: finiteNumber(raw?.sog_kn),
    cog_deg: finiteNumber(raw?.cog_deg),
    heading_deg: finiteNumber(raw?.heading_deg),
    data_time_utc: raw?.data_time_utc ? String(raw.data_time_utc) : null,
  }
}

export function aisTrackPointKey(point) {
  return `${point?.data_time_utc || ''}|${Number(point?.longitude).toFixed(7)}|${Number(point?.latitude).toFixed(7)}`
}

/** 沿大圆按航速和航向推算位置；航向 0° 为正北、90° 为正东。 */
export function projectAisPosition(point, elapsedMs, maxProjectionMs = 300_000) {
  const start = normalizeAisTrackPoint(point)
  if (!start) return null
  const speedKn = Math.max(0, finiteNumber(start.sog_kn) || 0)
  const courseDeg = finiteNumber(start.cog_deg) ?? finiteNumber(start.heading_deg) ?? 0
  const durationMs = Math.max(0, Math.min(Number(elapsedMs) || 0, maxProjectionMs))
  if (!speedKn || !durationMs) return start

  const angularDistance = speedKn * KNOT_TO_MPS * durationMs / 1000 / EARTH_RADIUS_M
  const bearing = courseDeg * Math.PI / 180
  const lat1 = start.latitude * Math.PI / 180
  const lon1 = start.longitude * Math.PI / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  )
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  )
  return {
    ...start,
    longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180,
    latitude: lat2 * 180 / Math.PI,
  }
}
