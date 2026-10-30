import { computeTerrainStats, normalizeTerrainBounds } from './terrainPreview.js'

const grids = new Map()

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

// The field occupies one third of the regional width; never change its physical radius.
export function acousticTerrainBounds(center, radiusKm) {
  const latSpan = Math.max(.65, Math.max(1, Number(radiusKm) || 20) * 6 / 110.574)
  const lonSpan = latSpan / Math.max(.05, Math.cos(center.lat * Math.PI / 180))
  return normalizeTerrainBounds({ west: center.lon - lonSpan / 2, east: center.lon + lonSpan / 2,
    south: center.lat - latSpan / 2, north: center.lat + latSpan / 2 })
}

export async function loadBathymetry(inputBounds, resolution = 96, options = {}) {
  const request = buildLocalGebcoUrl(inputBounds, resolution, options.baseUrl)
  if (!grids.has(request.url)) {
    grids.set(request.url, requestGrid(request.url, options.fetchJson || defaultFetchJson)
      .then(grid => {
        if (grids.size > 24) grids.delete(grids.keys().next().value)
        return grid
      })
      .catch(error => { grids.delete(request.url); throw error }))
  }
  try { return await grids.get(request.url) } catch (error) {
    throw new Error('本地 GEBCO_2026_sub_ice 海底高程读取失败', { cause: error })
  }
}
