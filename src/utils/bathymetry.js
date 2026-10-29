import { computeTerrainStats, mercatorY, normalizeTerrainBounds } from './terrainPreview.js'

// Terrarium stores signed elevation (including ETOPO1 ocean bathymetry), not RGB imagery.
// https://github.com/tilezen/joerd/blob/master/docs/formats.md
export function decodeTerrarium(r, g, b) { return r * 256 + g + b / 256 - 32768 }

export function terrainTilePoint(lon, lat, zoom) {
  const n = 2 ** zoom
  const x = Math.min(n - 1e-8, Math.max(0, (lon + 180) / 360 * n))
  const y = Math.min(n - 1e-8, Math.max(0, mercatorY(lat) * n))
  return { x: Math.floor(x), y: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) }
}

const tiles = new Map()
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

function readTileImage(z, x, y) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const finish = (error, data) => {
      clearTimeout(timer)
      image.onload = image.onerror = null
      if (error) { image.src = ''; reject(error) } else resolve(data)
    }
    const timer = setTimeout(() => finish(new Error('海底高程服务连接超时')), 10000)
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 256
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(image, 0, 0)
        finish(null, ctx.getImageData(0, 0, 256, 256).data)
      } catch (error) { finish(error) }
    }
    image.onerror = () => finish(new Error(`海底高程连接失败（${z}/${x}/${y}）`))
    const base = import.meta.env?.VITE_BATHYMETRY_TILE_URL || (import.meta.env?.DEV ? '/bathy' : 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium')
    image.src = `${base}/${z}/${x}/${y}.png`
  })
}

async function readTile(z, x, y) {
  const key = `${z}/${x}/${y}`
  if (tiles.has(key)) return tiles.get(key)
  const pending = limitedRequest(async () => {
    try { return await readTileImage(z,x,y) } catch {
      await new Promise(resolve => setTimeout(resolve, 350))
      return readTileImage(z,x,y)
    }
  })
  tiles.set(key, pending)
  try {
    const data = await pending
    if (tiles.size > 64) tiles.delete(tiles.keys().next().value)
    return data
  } catch (error) { tiles.delete(key); throw error }
}

// The field occupies one third of the regional width; never change its physical radius.
export function acousticTerrainBounds(center, radiusKm) {
  const latSpan = Math.max(.65, Math.max(1, Number(radiusKm) || 20) * 6 / 110.574)
  const lonSpan = latSpan / Math.max(.05, Math.cos(center.lat * Math.PI / 180))
  return normalizeTerrainBounds({ west: center.lon - lonSpan / 2, east: center.lon + lonSpan / 2,
    south: center.lat - latSpan / 2, north: center.lat + latSpan / 2 })
}

export async function loadBathymetry(inputBounds, resolution = 96, options = {}) {
  const bounds = normalizeTerrainBounds(inputBounds)
  let zoom = 8
  while (zoom > 0) {
    const nw = terrainTilePoint(bounds.west, bounds.north, zoom)
    const se = terrainTilePoint(bounds.east, bounds.south, zoom)
    if ((se.x - nw.x + 1) * (se.y - nw.y + 1) <= 16) break
    zoom--
  }
  let lastError
  const initialZoom = zoom
  // Retry the entire footprint at a coarser level. Never mix an old footprint with a new field.
  for (; zoom >= Math.max(0, initialZoom - 2); zoom--) {
    try {
      const grid = await sampleGrid(bounds, resolution, zoom, options.readTile || readTile)
      return { ...grid, zoom, reducedResolution: zoom < initialZoom }
    } catch (error) { lastError = error }
  }
  throw new Error('海底高程服务连接失败，重试及较低分辨率均未能加载', { cause: lastError })
}

async function sampleGrid(bounds, resolution, zoom, tileReader) {
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
  const entries = results.map(result => result.value)
  const pixels = new Map(entries)
  const values = new Float32Array(locations.map(p => {
    const rgba = pixels.get(p.key)
    const i = (p.py * 256 + p.px) * 4
    return rgba[i + 3] ? decodeTerrarium(rgba[i], rgba[i + 1], rgba[i + 2]) : NaN
  }))
  if (!values.some(Number.isFinite)) throw new Error('所选区域没有有效高程')
  return { width: resolution, height: resolution, values, bounds, ...computeTerrainStats(values) }
}
