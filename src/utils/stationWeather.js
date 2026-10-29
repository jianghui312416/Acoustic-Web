export const WEATHER_TYPES = ['DT_ENV_10m_WIND_U', 'DT_ENV_10m_WIND_V', 'DT_ENV_RAIN']

export function stationSurfaceValue(wrapped) {
  const data = wrapped?.Data?.Units?.[0]?.Response?.data
  const surface = Array.isArray(data) ? data.find(p => Number(p.x) === 0) : null
  if (surface?.y == null || surface.y === '') return null
  const value = Number(surface.y)
  return Number.isFinite(value) && Math.abs(value) !== 9999 ? value : null
}

export function windFromComponents(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null
  const speed = Math.hypot(u, v)
  const direction = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360
  const names = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风']
  return { speed, direction, label: speed < .05 ? '静风' : names[Math.round(direction / 45) % 8] }
}

// 累积量和降雨率分开显示；不猜测累积时段。
export function rainMeasurement(value, unit) {
  if (!Number.isFinite(value) || value < 0) return null
  const units = { 'mm/h': [1, '毫米/小时'], 'mm/hr': [1, '毫米/小时'], 'mm': [1, '毫米'], 'm': [1000, '毫米'], 'kg m-2 s-1': [3600, '毫米/小时'] }
  const conversion = units[String(unit).trim()]
  return conversion ? { value: value * conversion[0], unit: conversion[1] } : null
}
