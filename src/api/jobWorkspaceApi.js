import { authErrorMessage, http } from './authHttp.js'

function safeJobId(jobId) {
  const safeId = String(jobId || '').trim()
  if (!/^[a-f0-9]{1,32}$/i.test(safeId)) throw new Error('工作 ID 无效')
  return safeId
}

function unwrap(response, fallback) {
  const payload = response?.data ?? null
  return payload ?? { ok: true, message: fallback }
}

export async function listAcousticJobs(limit = 40) {
  try {
    const response = await http.get('jobs', {
      params: { limit: Math.max(1, Math.min(100, Number(limit) || 40)) },
    })
    const payload = unwrap(response)
    return Array.isArray(payload?.jobs) ? payload.jobs : []
  } catch (error) {
    throw new Error(authErrorMessage(error, '读取工作列表失败'))
  }
}

export async function loadAcousticJob(jobId) {
  const safeId = safeJobId(jobId)
  try {
    const response = await http.get(`jobs/${encodeURIComponent(safeId)}/visualization`)
    return unwrap(response)
  } catch (error) {
    throw new Error(authErrorMessage(error, '读取工作声场失败'))
  }
}

/** 读取任务参数（小文件），用于前端判断该任务是否应保留在工作区。 */
export async function loadAcousticJobParams(jobId) {
  const safeId = safeJobId(jobId)
  try {
    const response = await http.get(`file/${encodeURIComponent(safeId)}/params.json`)
    return unwrap(response)
  } catch (error) {
    throw new Error(authErrorMessage(error, '读取任务参数失败'))
  }
}

export async function deleteAcousticJob(jobId) {
  const safeId = safeJobId(jobId)
  try {
    const response = await http.delete(`jobs/${encodeURIComponent(safeId)}`)
    return unwrap(response)
  } catch (error) {
    throw new Error(authErrorMessage(error, '删除工作失败'))
  }
}
