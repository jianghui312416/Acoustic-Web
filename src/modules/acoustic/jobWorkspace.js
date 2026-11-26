import { reactive } from 'vue'
import {
  deleteWorkspaceRecord as deleteWorkspaceRecordApi,
  listAcousticJobs,
  listWorkspaceRecords,
  loadAcousticJobParams,
  saveWorkspaceRecord as saveWorkspaceRecordApi,
} from '@/api/jobWorkspaceApi.js'
import { isWorkspaceFieldParams } from './workspaceJobFilter.js'

export const jobWorkspace = reactive({
  jobs: [],
  loading: false,
  error: '',
  openedIds: [],
  requestedJobId: '',
  openRequestToken: 0,
  closeRequestedJobId: '',
  closeRequestedJobIds: [],
  closeRequestToken: 0,
  saveRequestToken: 0,
  activeWorkspaceId: '',
  records: {},
})

function recordJobIds(record) {
  const values = Array.isArray(record?.job_ids)
    ? record.job_ids
    : Array.isArray(record?.jobIds) ? record.jobIds : record?.jobId ? [record.jobId] : []
  return [...new Set(values.map(String).filter(Boolean))]
}

function normalizeWorkspaceRecord(record) {
  const id = String(record?.workspace_id || record?.id || '')
  if (!id) return null
  return {
    ...record,
    id,
    workspace_id: id,
    job_ids: recordJobIds(record),
    snapshot: record?.snapshot && typeof record.snapshot === 'object' ? record.snapshot : {},
    updatedAt: Number(record?.updatedAt) || Date.parse(record?.updated_at || '') || Date.now(),
  }
}

/** 将上一版本保存在本机的记录一次性上传；成功后移除旧键，后续只使用后端。 */
async function migrateLegacyLocalRecords(serverRecords) {
  try {
    const user = JSON.parse(globalThis.localStorage?.getItem('acoustic_user') || 'null')
    const identity = user?.id ?? user?.user_id ?? user?.username ?? user?.name
    if (identity === undefined || identity === null || !String(identity).trim()) return serverRecords
    const key = `acoustic_workspace_records:${encodeURIComponent(String(identity).trim())}`
    const legacy = JSON.parse(globalThis.localStorage?.getItem(key) || 'null')
    const records = Object.values(legacy?.records || {}).filter(record => record?.id)
    if (!records.length) return serverRecords
    const known = new Set(serverRecords.map(record => String(record?.workspace_id || record?.id || '')))
    const migrated = [...serverRecords]
    for (const record of records) {
      if (known.has(String(record.id))) continue
      const saved = await saveWorkspaceRecordApi(record.id, {
        label: record.label || '工作区',
        snapshot: record.snapshot || {},
        job_ids: recordJobIds(record),
      })
      if (saved) migrated.push(saved)
    }
    globalThis.localStorage?.removeItem(key)
    return migrated
  } catch {
    // 保留旧键，下一次刷新时重试；迁移失败不阻断后端工作区列表。
    return serverRecords
  }
}

export function workspaceRecordById(recordId) {
  return jobWorkspace.records[String(recordId || '')] || null
}

function workspaceJobs() {
  return Object.values(jobWorkspace.records).map(record => {
    const jobIds = recordJobIds(record)
    // 二维声场 / 噪声 / 信号链保存在 snapshot.resultRefs 中，卡片的声场数量
    // 需要与三维 job_ids 合并统计。
    const resultRefCount = Array.isArray(record.snapshot?.resultRefs) ? record.snapshot.resultRefs.length : 0
    const fieldCount = jobIds.length + resultRefCount
    return {
      job_id: record.id,
      model_label: record.label || '工作区',
      status: fieldCount ? 'completed' : 'draft',
      status_label: fieldCount ? `${fieldCount} 个声场` : '未计算',
      updated_at_ms: record.updatedAt,
      openable: true,
      local_only: fieldCount === 0,
      workspace_record: true,
      job_ids: jobIds,
      field_count: fieldCount,
    }
  })
}

function refreshLocalWorkspaceCards() {
  const cards = workspaceJobs()
  const referenced = new Set(cards.flatMap(card => card.job_ids))
  const backendJobs = jobWorkspace.jobs.filter(job => !job.workspace_record && !referenced.has(String(job.job_id)))
  jobWorkspace.jobs = [...cards, ...backendJobs]
}

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
    const [jobs, remoteRecords] = await Promise.all([listAcousticJobs(), listWorkspaceRecords()])
    const records = await migrateLegacyLocalRecords(remoteRecords)
    jobWorkspace.records = Object.fromEntries(
      records.map(normalizeWorkspaceRecord).filter(Boolean).map(record => [record.id, record])
    )
    const checked = await Promise.all(
      jobs.map(async job => ({ job, eligible: job.openable !== false && await isWorkspaceJob(job) }))
    )
    const cards = workspaceJobs()
    const referenced = new Set(cards.flatMap(card => card.job_ids))
    jobWorkspace.jobs = [
      ...cards,
      ...checked.filter(item => item.eligible && !referenced.has(String(item.job.job_id))).map(item => item.job),
    ]
  } catch (error) {
    jobWorkspace.error = error?.message || String(error)
    jobWorkspace.jobs = workspaceJobs()
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

export function requestSaveWorkspaceDraft() {
  jobWorkspace.saveRequestToken += 1
}

function newWorkspaceId() {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
  return `workspace-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`
}

async function persistWorkspaceRecord(id, record) {
  try {
    const saved = normalizeWorkspaceRecord(await saveWorkspaceRecordApi(id, {
      label: record.label,
      snapshot: record.snapshot,
      job_ids: recordJobIds(record),
    }))
    if (!saved) throw new Error('后端未返回工作区记录')
    jobWorkspace.records = { ...jobWorkspace.records, [saved.id]: saved }
    jobWorkspace.activeWorkspaceId = saved.id
    refreshLocalWorkspaceCards()
    return saved.id
  } catch (error) {
    jobWorkspace.error = error?.message || String(error)
    return ''
  }
}

export async function saveWorkspaceDraft(snapshot) {
  const active = workspaceRecordById(jobWorkspace.activeWorkspaceId)
  const id = active?.id || newWorkspaceId()
  return persistWorkspaceRecord(id, {
    ...active,
    label: active?.label || `工作区 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    job_ids: recordJobIds(active),
    snapshot,
  })
}

export async function attachJobToActiveWorkspace(jobId, snapshot, label = '声场工作区') {
  const job = String(jobId || '')
  if (!job) return ''
  const active = workspaceRecordById(jobWorkspace.activeWorkspaceId)
  const id = active?.id || newWorkspaceId()
  return persistWorkspaceRecord(id, {
    ...active,
    label: active?.label || label,
    job_ids: [...new Set([...recordJobIds(active), job])],
    snapshot,
  })
}

export function activateWorkspace(recordId) {
  jobWorkspace.activeWorkspaceId = String(recordId || '')
}

export async function deleteLocalWorkspaceDraft(recordId) {
  try {
    await deleteWorkspaceRecordApi(recordId)
    if (jobWorkspace.activeWorkspaceId === recordId) jobWorkspace.activeWorkspaceId = ''
    markJobClosed(recordId)
    const records = { ...jobWorkspace.records }
    delete records[recordId]
    jobWorkspace.records = records
    refreshLocalWorkspaceCards()
    return true
  } catch (error) {
    jobWorkspace.error = error?.message || String(error)
    return false
  }
}

export function requestCloseJob(jobId) {
  const id = String(jobId || '')
  jobWorkspace.closeRequestedJobId = id
  jobWorkspace.closeRequestedJobIds = id ? [id] : []
  jobWorkspace.closeRequestToken += 1
}

export function requestCloseWorkspace(recordId, jobIds = []) {
  const id = String(recordId || '')
  jobWorkspace.closeRequestedJobId = id
  jobWorkspace.closeRequestedJobIds = [id, ...jobIds.map(String)].filter(Boolean)
  jobWorkspace.closeRequestToken += 1
}
