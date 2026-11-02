/** 经纬度显示 / 输入格式：十进制度、度分、度分秒。 */
export const COORD_FORMATS = Object.freeze(['DD', 'DM', 'DMS'])

export function normalizeCoordFormat(value) {
  const format = String(value || '').toUpperCase()
  return COORD_FORMATS.includes(format) ? format : 'DD'
}

export function nextCoordFormat(value) {
  const format = normalizeCoordFormat(value)
  return COORD_FORMATS[(COORD_FORMATS.indexOf(format) + 1) % COORD_FORMATS.length]
}

function hemispheres(value, isLatitude) {
  return value < 0 ? (isLatitude ? 'S' : 'W') : (isLatitude ? 'N' : 'E')
}

function formatDM(value, isLatitude) {
  const abs = Math.abs(Number(value) || 0)
  const degrees = Math.floor(abs)
  const minutes = (abs - degrees) * 60
  return `${degrees}°${minutes.toFixed(3)}′${hemispheres(value, isLatitude)}`
}

function formatDMS(value, isLatitude) {
  const abs = Math.abs(Number(value) || 0)
  const degrees = Math.floor(abs)
  const totalMinutes = (abs - degrees) * 60
  const minutes = Math.floor(totalMinutes)
  const seconds = (totalMinutes - minutes) * 60
  return `${degrees}°${String(minutes).padStart(2, '0')}′${seconds.toFixed(2)}″${hemispheres(value, isLatitude)}`
}

export function formatCoordinate(value, format = 'DD', isLatitude = false) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const normalized = normalizeCoordFormat(format)
  if (normalized === 'DM') return formatDM(number, isLatitude)
  if (normalized === 'DMS') return formatDMS(number, isLatitude)
  return `${number.toFixed(5)}°`
}

export function formatCoordPair(lat, lon, format = 'DD') {
  return `${formatCoordinate(lat, format, true)}, ${formatCoordinate(lon, format, false)}`
}

function parseSingleCoordinate(part) {
  if (!part) return NaN
  const hemisphere = (String(part).match(/[NSEW]/i)?.[0] || '').toUpperCase()
  const numbers = String(part).match(/-?\d+(?:\.\d+)?/g)?.map(Number) || []
  if (!numbers.length) return NaN
  const sign = numbers[0] < 0 || hemisphere === 'S' || hemisphere === 'W' ? -1 : 1
  const degrees = Math.abs(numbers[0])
  const minutes = Number(numbers[1]) || 0
  const seconds = Number(numbers[2]) || 0
  return sign * (degrees + minutes / 60 + seconds / 3600)
}

/**
 * 解析“纬度, 经度”文本，兼容 DD / DM / DMS 以及 N/S/E/W 后缀。
 * 没有逗号时按两个十进制数字兜底。
 */
export function parseCoordPair(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const parts = raw.split(/[,;，；]/).map((part) => part.trim()).filter(Boolean)
  let lat
  let lon
  if (parts.length >= 2) {
    lat = parseSingleCoordinate(parts[0])
    lon = parseSingleCoordinate(parts[1])
  } else {
    const numbers = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || []
    if (numbers.length < 2) return null
    lat = numbers[0]
    lon = numbers[1]
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}
