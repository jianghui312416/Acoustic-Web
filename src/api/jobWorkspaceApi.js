import { portalApiUrl } from '@/config/runtimeConfig.js'

async function readJson(response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || `请求失败（${response.status}）`)
  }
  return payload
}

export async function listAcousticJobs(limit = 40) {
  const url = new URL('jobs', portalApiUrl())
  url.searchParams.set('limit', String(Math.max(1, Math.min(100, Number(limit) || 40))))
  const payload = await readJson(await fetch(url, { cache: 'no-store' }))
  return Array.isArray(payload?.jobs) ? payload.jobs : []
}

export async function loadAcousticJob(jobId) {
  const safeId = String(jobId || '').trim()
  if (!/^[a-f0-9]{1,32}$/i.test(safeId)) throw new Error('工作 ID 无效')
  const url = new URL(`jobs/${encodeURIComponent(safeId)}/visualization`, portalApiUrl())
  return readJson(await fetch(url, { cache: 'no-store' }))
}

export async function deleteAcousticJob(jobId) {
  const safeId = String(jobId || '').trim()
  if (!/^[a-f0-9]{1,32}$/i.test(safeId)) throw new Error('工作 ID 无效')
  const url = new URL(`jobs/${encodeURIComponent(safeId)}`, portalApiUrl())
  return readJson(await fetch(url, { method: 'DELETE', cache: 'no-store' }))
}
