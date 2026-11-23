import { portalApiUrl } from '@/config/runtimeConfig.js'

const responseCache = new Map()
const CACHE_TTL_MS = 120_000
const CACHE_LIMIT = 16

function boundsKey(bounds, limit) {
  if (!bounds) return ''
  const round = value => Math.round(Number(value) * 10000) / 10000
  return [round(bounds.west), round(bounds.south), round(bounds.east), round(bounds.north), limit].join('|')
}

/**
 * 按地形视口范围读取 GEBCO SCUFN 海底地名。
 * @param {{west:number,south:number,east:number,north:number}} bounds
 * @param {{limit?:number, minExtentM?:number, categories?:string[]|null, signal?:AbortSignal}} options
 */
export async function fetchSeafloorFeatures(bounds, options = {}) {
  if (!bounds) throw new Error('缺少海底地名查询范围')
  const limit = Math.max(1, Math.min(2000, Math.round(Number(options.limit) || 600)))
  const key = boundsKey(bounds, limit)
  const cached = responseCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload

  const url = new URL('GetSeafloorFeatures', portalApiUrl())
  url.searchParams.set('west', String(bounds.west))
  url.searchParams.set('south', String(bounds.south))
  url.searchParams.set('east', String(bounds.east))
  url.searchParams.set('north', String(bounds.north))
  url.searchParams.set('limit', String(limit))
  if (Number.isFinite(Number(options.minExtentM)) && Number(options.minExtentM) > 0) {
    url.searchParams.set('minExtentM', String(Number(options.minExtentM)))
  }
  if (Array.isArray(options.categories) && options.categories.length) {
    url.searchParams.set('categories', options.categories.join(','))
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || `海底地名请求失败（${response.status}）`)
  }
  if (!payload || !Array.isArray(payload.features)) {
    throw new Error('海底地名响应格式无效')
  }
  responseCache.set(key, { at: Date.now(), payload })
  if (responseCache.size > CACHE_LIMIT) {
    responseCache.delete(responseCache.keys().next().value)
  }
  return payload
}
