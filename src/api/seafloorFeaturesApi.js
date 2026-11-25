import { authErrorMessage, http } from './authHttp.js'

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

  const params = {
    west: bounds.west,
    south: bounds.south,
    east: bounds.east,
    north: bounds.north,
    limit,
  }
  if (Number.isFinite(Number(options.minExtentM)) && Number(options.minExtentM) > 0) {
    params.minExtentM = Number(options.minExtentM)
  }
  if (Array.isArray(options.categories) && options.categories.length) {
    params.categories = options.categories.join(',')
  }

  let payload
  try {
    const response = await http.get('GetSeafloorFeatures', {
      params,
      signal: options.signal,
    })
    payload = response?.data ?? null
  } catch (error) {
    throw new Error(authErrorMessage(error, '海底地名请求失败'))
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
