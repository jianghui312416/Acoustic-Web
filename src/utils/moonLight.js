/**
 * 低精度月球位置 → 地形方向光。
 *
 * 使用 Meeus《Astronomical Algorithms》简化月球黄经/黄纬级数，误差约 0.3°，
 * 足够用于地形明暗方向。结果按“正北 0°、顺时针”的罗盘方位返回。
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

const sin = (degrees) => Math.sin(degrees * DEG)
const cos = (degrees) => Math.cos(degrees * DEG)
const normalizeDeg = (value) => ((value % 360) + 360) % 360

/** 仿真时间按 UTC 解析；无时区的 ISO 字符串默认补 Z。 */
function toUtcDate(value) {
  if (value instanceof Date) return new Date(value.getTime())
  if (typeof value === 'number') return new Date(value)
  const text = String(value ?? '').trim()
  if (!text) return new Date()
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const date = new Date(hasZone ? normalized : `${normalized}Z`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

/**
 * 计算指定时刻、观测点的月球方位。
 * @param {string|number|Date} dateInput 仿真时间（UTC）
 * @param {number} latitudeDeg 观测点纬度
 * @param {number} longitudeDeg 观测点经度（东经为正）
 * @returns {{ azimuthDeg: number, altitudeDeg: number, rawAltitudeDeg: number, date: Date }}
 */
export function moonLightDirection(dateInput, latitudeDeg, longitudeDeg) {
  const date = toUtcDate(dateInput)
  const jd = date.getTime() / 86400000 + 2440587.5
  const T = (jd - 2451545.0) / 36525

  // 月球平黄经、平距角、太阳/月球平近点角、升交点角距（度）。
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T ** 2
    + T ** 3 / 538841 - T ** 4 / 65194000
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T ** 2
    + T ** 3 / 545868 - T ** 4 / 113065000
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T ** 2
    + T ** 3 / 24490000
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T ** 2
    + T ** 3 / 69699 - T ** 4 / 14712000
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T ** 2
    - T ** 3 / 3526000 + T ** 4 / 863310000

  // 地心黄道坐标（简化级数）。
  const lambda = Lp
    + 6.289 * sin(Mp)
    + 1.274 * sin(2 * D - Mp)
    + 0.658 * sin(2 * D)
    + 0.214 * sin(2 * Mp)
    - 0.186 * sin(M)
    - 0.114 * sin(2 * F)
  const beta = 5.128 * sin(F)
    + 0.280 * sin(Mp + F)
    + 0.277 * sin(Mp - F)
    + 0.173 * sin(2 * D - F)
    + 0.055 * sin(2 * D - Mp + F)
    + 0.046 * sin(2 * D - Mp - F)
    + 0.033 * sin(2 * D + F)
    + 0.017 * sin(2 * Mp + F)

  // 黄道 → 赤道。
  const eps = 23.439291 - 0.0130042 * T
  const sinBeta = sin(beta)
  const cosBeta = cos(beta)
  const sinLambda = sin(lambda)
  const cosLambda = cos(lambda)
  const sinEps = sin(eps)
  const cosEps = cos(eps)
  const dec = Math.asin(sinBeta * cosEps + cosBeta * sinEps * sinLambda)
  const ra = Math.atan2(
    sinLambda * cosEps - (sinBeta / Math.max(1e-9, Math.abs(cosBeta))) * sinEps,
    cosLambda
  )

  // 格林尼治/本地恒星时 → 时角 → 地平坐标。
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T ** 2 - T ** 3 / 38710000
  const lst = (gmst + Number(longitudeDeg || 0)) * DEG
  const hourAngle = lst - ra
  const lat = Number(latitudeDeg || 0) * DEG

  const sinAltitude = Math.sin(lat) * Math.sin(dec)
    + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle)
  const rawAltitudeDeg = Math.asin(Math.max(-1, Math.min(1, sinAltitude))) * RAD

  // 本地东-北-天坐标；atan2(东, 北) 即从正北顺时针的方位角。
  const east = -Math.cos(dec) * Math.sin(hourAngle)
  const north = Math.sin(dec) * Math.cos(lat)
    - Math.cos(dec) * Math.cos(hourAngle) * Math.sin(lat)
  const azimuthDeg = normalizeDeg(Math.atan2(east, north) * RAD)

  return {
    azimuthDeg,
    // 月在地平线下时光照会从地下打上来，显示上夹到 15°~80° 以保持地形可读。
    altitudeDeg: Math.max(15, Math.min(80, rawAltitudeDeg)),
    rawAltitudeDeg,
    date,
  }
}
