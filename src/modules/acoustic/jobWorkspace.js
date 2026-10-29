import { reactive } from 'vue'
import { listAcousticJobs } from '@/api/jobWorkspaceApi.js'

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

export async function refreshJobWorkspace() {
  jobWorkspace.loading = true
  jobWorkspace.error = ''
  try {
    jobWorkspace.jobs = await listAcousticJobs()
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
