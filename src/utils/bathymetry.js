import { computeTerrainStats, mercatorY, normalizeTerrainBounds } from './terrainPreview.js'

const localGrids = new Map()

export const BATHYMETRY_SOURCES = {
  local: 'local',
  online: 'online',
}

export function buildLocalGebcoUrl(inputBounds, resolution = 96, baseUrl = '/api/gebco') {
  const bounds = normalizeTerrainBounds(inputBounds)
  const params = new URLSearchParams({
    west: String(bounds.west), east: String(bounds.east),
    south: String(bounds.south), north: String(bounds.north),
    resolution: String(Math.max(2, Math.min(512, Math.round(Number(resolution) || 96)))),
  })
  return { url: `${baseUrl}?${params}`, bounds }
}

function validateGrid(payload) {
  const width = Number(payload?.width)
  const height = Number(payload?.height)
  const values = Array.isArray(payload?.values)
    ? Float32Array.from(payload.values, value => value == null ? NaN : Number(value))
    : null
  const bounds = payload?.bounds
  if (!(width > 1 && height > 1) || values?.length !== width * height ||
      ![bounds?.west, bounds?.east, bounds?.south, bounds?.north].every(Number.isFinite) ||
      !values.some(Number.isFinite)) {
    throw new Error('本地 GEBCO 子网格格式无效')
  }
  return { width, height, values, bounds, source: payload.source || 'GEBCO_2026_sub_ice', ...computeTerrainStats(values) }
}

async function requestGrid(url, fetchJson) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = await fetchJson(url)
      if (payload?.error) throw new Error(payload.error)
      return validateGrid(payload)
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw lastError
}

async function defaultFetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function loadLocalBathymetry(inputBounds, resolution, options) {
  const request = buildLocalGebcoUrl(inputBounds, resolution, options.baseUrl)
  if (!localGrids.has(request.url)) {
    localGrids.set(request.url, requestGrid(request.url, options.fetchJson || defaultFetchJson)
      .then(grid => {
        if (localGrids.size > 24) localGrids.delete(localGrids.keys().next().value)
        return grid
      })
      .catch(error => { localGrids.delete(request.url); throw error }))
  }
  try {
    return { ...await localGrids.get(request.url), dataSource: BATHYMETRY_SOURCES.local }
  } catch (error) {
    throw new Error('本地 GEBCO_2026_sub_ice 海底高程读取失败', { cause: error })
  }
}

// Terrarium stores signed elevation (including ocean bathymetry), not RGB imagery.
// https://github.com/tilezen/joerd/blob/master/docs/formats.md
export function decodeTerrarium(r, g, b) { return r * 256 + g + b / 256 - 32768 }

export function terrainTilePoint(lon, lat, zoom) {
  const n = 2 ** zoom
  const x = Math.min(n - 1e-8, Math.max(0, (lon + 180) / 360 * n))
  const y = Math.min(n - 1e-8, Math.max(0, mercatorY(lat) * n))
  return { x: Math.floor(x), y: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) }
}

const onlineTiles = new Map()
let activeRequests = 0
const requestQueue = []
async function limitedRequest(task) {
  if (activeRequests >= 4) await new Promise(resolve => requestQueue.push(resolve))
  else activeRequests++
  try { return await task() } finally {
    const next = requestQueue.shift()
    if (next) next()
    else activeRequests--
  }
}

function readTileImage(z, x, y, baseUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const finish = (error, data) => {
      clearTimeout(timer)
      image.onload = image.onerror = null
      if (error) { image.src = ''; reject(error) } else resolve(data)
    }
    const timer = setTimeout(() => finish(new Error('在线海底高程服务连接超时')), 10000)
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 256
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 0, 0)
        finish(null, ctx.getImageData(0, 0, 256, 256).data)
      } catch (error) { finish(error) }
    }
    image.onerror = () => finish(new Error(`在线海底高程连接失败（${z}/${x}/${y}）`))
    image.src = `${baseUrl}/${z}/${x}/${y}.png`
  })
}

function defaultTileBaseUrl() {
  return import.meta.env?.VITE_BATHYMETRY_TILE_URL ||
    (import.meta.env?.DEV ? '/bathy' : 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium')
}

async function readOnlineTile(z, x, y, options) {
  const key = `${options.tileBaseUrl || ''}:${z}/${x}/${y}`
  if (onlineTiles.has(key)) return onlineTiles.get(key)
  const baseUrl = options.tileBaseUrl || defaultTileBaseUrl()
  const pending = limitedRequest(async () => {
    try { return await readTileImage(z, x, y, baseUrl) } catch {
      await new Promise(resolve => setTimeout(resolve, 350))
      return readTileImage(z, x, y, baseUrl)
    }
  })
  onlineTiles.set(key, pending)
  try {
    const data = await pending
    if (onlineTiles.size > 64) onlineTiles.delete(onlineTiles.keys().next().value)
    return data
  } catch (error) { onlineTiles.delete(key); throw error }
}

async function sampleTerrariumGrid(bounds, resolution, zoom, tileReader) {
  const locations = []
  const needed = new Map()
  // Rows consistently run north → south, matching the displayed latitude axis.
  for (let row = 0; row < resolution; row++) {
    const lat = bounds.north - row / (resolution - 1) * (bounds.north - bounds.south)
    for (let col = 0; col < resolution; col++) {
      const lon = bounds.west + col / (resolution - 1) * (bounds.east - bounds.west)
      const p = terrainTilePoint(lon, lat, zoom)
      const key = `${p.x}/${p.y}`
      locations.push({ ...p, key })
      if (!needed.has(key)) needed.set(key, { x: p.x, y: p.y })
    }
  }
  const results = await Promise.allSettled([...needed].map(async ([key, p]) => [key, await tileReader(zoom, p.x, p.y)]))
  const failed = results.find(result => result.status === 'rejected')
  if (failed) throw failed.reason
  const pixels = new Map(results.map(result => result.value))
  const values = new Float32Array(locations.map(p => {
    const rgba = pixels.get(p.key)
    const i = (p.py * 256 + p.px) * 4
    return rgba[i + 3] ? decodeTerrarium(rgba[i], rgba[i + 1], rgba[i + 2]) : NaN
  }))
  if (!values.some(Number.isFinite)) throw new Error('所选区域没有有效高程')
  return { width: resolution, height: resolution, values, bounds, ...computeTerrainStats(values) }
}

async function loadOnlineBathymetry(inputBounds, resolution, options) {
  const bounds = normalizeTerrainBounds(inputBounds)
  const size = Math.max(2, Math.min(512, Math.round(Number(resolution) || 96)))
  let zoom = 8
  while (zoom > 0) {
    const nw = terrainTilePoint(bounds.west, bounds.north, zoom)
    const se = terrainTilePoint(bounds.east, bounds.south, zoom)
    if ((se.x - nw.x + 1) * (se.y - nw.y + 1) <= 16) break
    zoom--
  }
  let lastError
  const initialZoom = zoom
  const tileReader = options.readTile || ((z, x, y) => readOnlineTile(z, x, y, options))
  // Retry the entire footprint at a coarser level. Never mix an old footprint with a new field.
  for (; zoom >= Math.max(0, initialZoom - 2); zoom--) {
    try {
      const grid = await sampleTerrariumGrid(bounds, size, zoom, tileReader)
      return {
        ...grid,
        source: 'Terrarium',
        dataSource: BATHYMETRY_SOURCES.online,
        zoom,
        reducedResolution: zoom < initialZoom,
      }
    } catch (error) { lastError = error }
  }
  throw new Error('在线海底高程服务连接失败，重试及较低分辨率均未能加载', { cause: lastError })
}

// The field occupies one third of the regional width; never change its physical radius.
export function acousticTerrainBounds(center, radiusKm) {
  const latSpan = Math.max(.65, Math.max(1, Number(radiusKm) || 20) * 6 / 110.574)
  const lonSpan = latSpan / Math.max(.05, Math.cos(center.lat * Math.PI / 180))
  return normalizeTerrainBounds({ west: center.lon - lonSpan / 2, east: center.lon + lonSpan / 2,
    south: center.lat - latSpan / 2, north: center.lat + latSpan / 2 })
}

export async function loadBathymetry(inputBounds, resolution = 96, options = {}) {
  const source = options.source === BATHYMETRY_SOURCES.online
    ? BATHYMETRY_SOURCES.online
    : BATHYMETRY_SOURCES.local
  return source === BATHYMETRY_SOURCES.online
    ? loadOnlineBathymetry(inputBounds, resolution, options)
    : loadLocalBathymetry(inputBounds, resolution, options)
}
