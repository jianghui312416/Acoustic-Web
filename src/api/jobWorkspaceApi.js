import { authErrorMessage, http } from './authHttp.js'

function safeJobId(jobId) {
  const safeId = String(jobId || '').trim()
  if (!/^[a-f0-9]{1,32}$/i.test(safeId)) throw new Error('工作 ID 无效')
  return safeId
}

function safeWorkspaceId(workspaceId) {
  const safeId = String(workspaceId || '').trim()
  if (!/^[a-z0-9_-]{1,64}$/i.test(safeId)) throw new Error('工作区 ID 无效')
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

/** 按任务类型取回已保存结果（二维声场 / 噪声 / 信号链）。 */
export async function loadAcousticJobResult(jobId) {
  const safeId = safeJobId(jobId)
  try {
    const response = await http.get(`jobs/${encodeURIComponent(safeId)}/restore`)
    return unwrap(response)
  } catch (error) {
    throw new Error(authErrorMessage(error, '读取工作结果失败'))
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

export async function listWorkspaceRecords() {
  try {
    const response = await http.get('workspaces')
    const payload = unwrap(response)
    return Array.isArray(payload?.workspaces) ? payload.workspaces : []
  } catch (error) {
    throw new Error(authErrorMessage(error, '读取工作区记录失败'))
  }
}

export async function saveWorkspaceRecord(workspaceId, record) {
  const safeId = safeWorkspaceId(workspaceId)
  try {
    const response = await http.put(`workspaces/${encodeURIComponent(safeId)}`, {
      label: record?.label || '工作区',
      snapshot: record?.snapshot || {},
      job_ids: Array.isArray(record?.job_ids) ? record.job_ids : [],
    })
    return unwrap(response)?.workspace || null
  } catch (error) {
    throw new Error(authErrorMessage(error, '保存工作区失败'))
  }
}

export async function deleteWorkspaceRecord(workspaceId) {
  const safeId = safeWorkspaceId(workspaceId)
  try {
    const response = await http.delete(`workspaces/${encodeURIComponent(safeId)}`)
    return unwrap(response)
  } catch (error) {
    throw new Error(authErrorMessage(error, '删除工作区失败'))
  }
}
