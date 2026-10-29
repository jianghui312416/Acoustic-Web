/** 水平距离（米） */
export function horizDistM(lon, lat, srcLon, srcLat) {
  const latRad = (srcLat * Math.PI) / 180
  const dx = (lon - srcLon) * Math.cos(latRad) * 111320
  const dy = (lat - srcLat) * 110574
  return Math.hypot(dx, dy)
}