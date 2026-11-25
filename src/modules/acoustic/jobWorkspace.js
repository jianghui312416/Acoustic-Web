import { reactive } from 'vue'
import { listAcousticJobs, loadAcousticJobParams } from '@/api/jobWorkspaceApi.js'
import { isWorkspaceFieldParams } from './workspaceJobFilter.js'

export const jobWorkspace = reactive({
  jobs: [],
  loading: false,
  error: '',
  openedIds: [],
  requestedJobId: '',
  openRequestToken: 0,
  closeRequestedJobId: '',
  closeRequestToken: 0,
})

const WORKSPACE_JOB_CACHE_LIMIT = 200
/** 任务参数判定缓存：updated_at_ms 变化后会重新读取。 */
const workspaceJobCache = new Map()

async function isWorkspaceJob(job) {
  const id = String(job?.job_id || '')
  if (!id) return false
  // 后端 /jobs 已在汇总里给出工作区归属判定：刷新时无需逐个请求 params.json。
  if (typeof job?.workspace_eligible === 'boolean') return job.workspace_eligible
  const updatedAt = Number(job?.updated_at_ms) || 0
  const cached = workspaceJobCache.get(id)
  if (cached && cached.updatedAt === updatedAt) return cached.eligible
  try {
    const params = await loadAcousticJobParams(id)
    const eligible = isWorkspaceFieldParams(params)
    workspaceJobCache.set(id, { updatedAt, eligible })
    if (workspaceJobCache.size > WORKSPACE_JOB_CACHE_LIMIT) {
      workspaceJobCache.delete(workspaceJobCache.keys().next().value)
    }
    return eligible
  } catch {
    workspaceJobCache.set(id, { updatedAt, eligible: false })
    return false
  }
}

export async function refreshJobWorkspace() {
  jobWorkspace.loading = true
  jobWorkspace.error = ''
  try {
    const jobs = await listAcousticJobs()
    const checked = await Promise.all(
      jobs.map(async job => ({ job, eligible: job.openable !== false && await isWorkspaceJob(job) }))
    )
    jobWorkspace.jobs = checked.filter(item => item.eligible).map(item => item.job)
  } catch (error) {
    jobWorkspace.error = error?.message || String(error)
  } finally {
    jobWorkspace.loading = false
  }
}

export function requestOpenJob(jobId) {
  jobWorkspace.requestedJobId = String(jobId || '')
  jobWorkspace.openRequestToken += 1
}

export function markJobOpened(jobId) {
  const id = String(jobId || '')
  jobWorkspace.openedIds = [...jobWorkspace.openedIds.filter(value => value !== id), id]
}

export function markJobClosed(jobId) {
  const id = String(jobId || '')
  jobWorkspace.openedIds = jobWorkspace.openedIds.filter(value => value !== id)
}

export function requestCloseJob(jobId) {
  jobWorkspace.closeRequestedJobId = String(jobId || '')
  jobWorkspace.closeRequestToken += 1
}
