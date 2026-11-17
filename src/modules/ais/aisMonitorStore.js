import { computed, reactive } from 'vue'
import { getRealtimeAis, getRealtimeAisTrack } from '@/api/soundFieldApi.js'
import { aisTrackPointKey, normalizeAisTrackPoint, projectAisPosition } from '@/utils/aisTrackMotion.js'
import {
  coastlineStats,
  ensureCoastline,
  ensureLandMask,
  filterLandVessels,
  isLandMaskReady,
} from '@/utils/aisLandMask.js'
import { estimateJomopansEchoSpectrum } from '@/utils/jomopansEcho.js'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
export const AIS_TRACK_REFRESH_INTERVAL_MS = 5_000
/** 超过该时长没有新的 AIS 位置报文后停止推算并开始淡出。 */
export const AIS_TRACK_STALE_MS = 60_000
export const AIS_TRACK_FADE_MS = 2_000

export const aisMonitorState = reactive({
  connected: true,
  displayEnabled: true,
  loading: false,
  error: '',
  vessels: [],
  selectedMmsi: null,
  selectedVesselSnapshot: null,
  lastUpdated: null,
  historyCoverageSeconds: 0,
  historyComplete: false,
  streamConnected: false,
  sortBy: 'distance',
  minSpeedKn: 0,
  focusRequest: null,
  focusToken: 0,
  panelRequested: false,
  landFilterActive: false,
  landFilteredCount: 0,
  coastlineReady: false,
  coastlineRingCount: 0,
})

export const selectedAisTrackState = reactive({
  mmsi: null,
  points: [],
  latest: null,
  anchorReceivedAt: 0,
  lostAt: 0,
  confirmed: false,
  loading: false,
  found: null,
  error: '',
  lastUpdated: null,
})

let refreshTimer = 0
let requestToken = 0
let trackRefreshTimer = 0
let trackRequestToken = 0
let trackRequestsEnabled = false
let trackAbortController = null

/** 单船航迹只允许在地形视图中请求；切到全球视图时立即停掉轮询。 */
export function setAisTrackRequestsEnabled(enabled) {
  trackRequestsEnabled = Boolean(enabled)
  if (!trackRequestsEnabled) stopSelectedAisTracking()
}

function finiteNumber(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null
  return Number(value)
}

export function estimateSourceLevel(vessel) {
  return Math.round(estimateJomopansEchoSpectrum(vessel).broadbandSourceLevelDb)
}

export function normalizeAisVessel(raw) {
  const longitude = finiteNumber(raw?.longitude)
  const latitude = finiteNumber(raw?.latitude)
  const mmsi = finiteNumber(raw?.mmsi)
  if (longitude == null || latitude == null || mmsi == null) return null
  const vessel = {
    longitude,
    latitude,
    mmsi,
    sog_kn: finiteNumber(raw.sog_kn),
    cog_deg: finiteNumber(raw.cog_deg),
    heading_deg: finiteNumber(raw.heading_deg),
    vessel_name: raw.vessel_name ? String(raw.vessel_name).trim() : null,
    ship_type: finiteNumber(raw.ship_type),
    ship_type_name: raw.ship_type_name ? String(raw.ship_type_name) : '未知',
    length_m: finiteNumber(raw.length_m),
    width_m: finiteNumber(raw.width_m),
    draught_m: finiteNumber(raw.draught_m),
    imo: finiteNumber(raw.imo),
    call_sign: raw.call_sign ? String(raw.call_sign).trim() : null,
    destination: raw.destination ? String(raw.destination).trim() : null,
    data_time_utc: raw.data_time_utc ? String(raw.data_time_utc) : null,
    first_seen_utc: raw.first_seen_utc ? String(raw.first_seen_utc) : null,
    last_seen_utc: raw.last_seen_utc ? String(raw.last_seen_utc) : null,
    position_report_count: finiteNumber(raw.position_report_count),
  }
  const source = estimateJomopansEchoSpectrum(vessel)
  vessel.source_level_db = Math.round(source.broadbandSourceLevelDb)
  vessel.source_model = source.model
  vessel.source_model_class = source.vesselClass
  vessel.source_model_class_label = source.vesselClassLabel
  vessel.source_model_speed_kn = source.modelSpeedKn
  vessel.source_model_length_m = source.modelLengthM
  vessel.source_model_assumptions = source.assumptions
  vessel.source_level_uncertainty_db = source.uncertaintyDb
  vessel.source_model_depth_m = source.sourceDepthM
  vessel.source_spectrum_frequency_hz = source.frequenciesHz
  vessel.source_spectrum_db = source.bandLevelsDb
  return vessel
}

export const selectedAisVessel = computed(() => (
  aisMonitorState.vessels.find((item) => item.mmsi === aisMonitorState.selectedMmsi)
  || (aisMonitorState.selectedVesselSnapshot?.mmsi === aisMonitorState.selectedMmsi
    ? aisMonitorState.selectedVesselSnapshot
    : null)
))

/** 保留未过滤列表：掩膜异步加载完成后可实时重算，无需重新请求 AIS。 */
let rawVessels = []
let maskRequested = false

function applyAisLandFilter() {
  const coastline = coastlineStats()
  aisMonitorState.coastlineReady = coastline.ready
  aisMonitorState.coastlineRingCount = coastline.rings
  if (!isLandMaskReady() && !coastline.ready) {
    aisMonitorState.vessels = rawVessels
    aisMonitorState.landFilterActive = false
    aisMonitorState.landFilteredCount = 0
    return
  }
  const result = filterLandVessels(rawVessels)
  const visible = result.vessels
  aisMonitorState.vessels = visible
  aisMonitorState.landFilterActive = true
  aisMonitorState.landFilteredCount = result.hidden
  const selected = visible.find((vessel) => vessel.mmsi === aisMonitorState.selectedMmsi)
  if (selected) aisMonitorState.selectedVesselSnapshot = selected
}

function requestAisLandMask() {
  if (maskRequested) return
  maskRequested = true
  ensureLandMask().then((mask) => {
    if (!mask) {
      maskRequested = false
      return
    }
    applyAisLandFilter()
    ensureCoastline(mask).then(() => applyAisLandFilter())
  })
}

export async function refreshAisVessels() {
  if (!aisMonitorState.connected || aisMonitorState.loading) return
  requestAisLandMask()
  const token = ++requestToken
  aisMonitorState.loading = true
  aisMonitorState.error = ''
  try {
    const response = await getRealtimeAis({ durationSeconds: 300 })
    if (token !== requestToken || !aisMonitorState.connected) return
    rawVessels = (response?.vessels || []).map(normalizeAisVessel).filter(Boolean)
    applyAisLandFilter()
    aisMonitorState.lastUpdated = new Date(response?.snapshot_time_utc || Date.now())
    aisMonitorState.historyCoverageSeconds = Number(response?.history_coverage_seconds) || 0
    aisMonitorState.historyComplete = response?.history_complete === true
    aisMonitorState.streamConnected = response?.stream_connected !== false
  } catch (error) {
    if (token !== requestToken) return
    aisMonitorState.error = error?.message || 'AIS 实时数据获取失败'
    aisMonitorState.streamConnected = false
  } finally {
    if (token === requestToken) aisMonitorState.loading = false
  }
}

function startTimer() {
  clearInterval(refreshTimer)
  refreshTimer = window.setInterval(refreshAisVessels, REFRESH_INTERVAL_MS)
}

function updateTrackedVessel(raw) {
  const vessel = normalizeAisVessel(raw)
  if (!vessel) return
  const index = rawVessels.findIndex(item => item.mmsi === vessel.mmsi)
  if (index >= 0) rawVessels[index] = vessel
  else rawVessels.push(vessel)
  // 只原地替换这一艘船，避免每 5 秒对整个 AIS 列表重新过滤，
  // 否则会触发全球图层重建和地形 AIS 静态缓存失效，造成周期性卡顿。
  const visibleIndex = aisMonitorState.vessels.findIndex(item => item.mmsi === vessel.mmsi)
  if (visibleIndex >= 0) aisMonitorState.vessels[visibleIndex] = vessel
  if (aisMonitorState.selectedMmsi === vessel.mmsi) aisMonitorState.selectedVesselSnapshot = vessel
}

export async function refreshSelectedAisTrack() {
  const mmsi = selectedAisTrackState.mmsi
  if (!trackRequestsEnabled || !mmsi || selectedAisTrackState.loading) return
  const token = ++trackRequestToken
  trackAbortController?.abort()
  const controller = new AbortController()
  trackAbortController = controller
  selectedAisTrackState.loading = true
  try {
    const response = await getRealtimeAisTrack(
      mmsi,
      { durationSeconds: 300 },
      { signal: controller.signal }
    )
    if (token !== trackRequestToken || selectedAisTrackState.mmsi !== mmsi) return
    const previousFound = selectedAisTrackState.found
    const previousConfirmed = selectedAisTrackState.confirmed
    const points = (response.track || []).map(normalizeAisTrackPoint).filter(Boolean)
    const latest = normalizeAisTrackPoint(response.vessel) || points.at(-1) || selectedAisTrackState.latest
    const latestChanged = latest && aisTrackPointKey(latest) !== aisTrackPointKey(selectedAisTrackState.latest)
    selectedAisTrackState.points = points
    if (latestChanged || !selectedAisTrackState.latest) {
      selectedAisTrackState.latest = latest
      selectedAisTrackState.anchorReceivedAt = Date.now()
    }
    if (response.vessel) updateTrackedVessel(response.vessel)
    const nextFound = response.found !== false
    if (nextFound) {
      // 首次确认或丢失后重新出现时，从当前时刻重新开始推算。
      if (!previousConfirmed || previousFound === false) {
        selectedAisTrackState.anchorReceivedAt = Date.now()
      }
      selectedAisTrackState.confirmed = true
      selectedAisTrackState.lostAt = 0
    } else if (previousConfirmed && previousFound !== false) {
      // 只有已经确认过的船丢失时才进入淡出；刚点击但后端尚未收录时不立即消失。
      selectedAisTrackState.lostAt = Date.now()
    }
    selectedAisTrackState.found = nextFound
    selectedAisTrackState.lastUpdated = new Date(response.snapshot_time_utc || Date.now())
    selectedAisTrackState.error = ''
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') return
    if (token === trackRequestToken) selectedAisTrackState.error = error?.message || '单船 AIS 航迹获取失败'
  } finally {
    if (trackAbortController === controller) trackAbortController = null
    if (token === trackRequestToken) selectedAisTrackState.loading = false
  }
}

function scheduleTrackRefresh(delayMs = AIS_TRACK_REFRESH_INTERVAL_MS) {
  clearTimeout(trackRefreshTimer)
  if (!trackRequestsEnabled || !selectedAisTrackState.mmsi) return
  trackRefreshTimer = window.setTimeout(async () => {
    const startedAt = Date.now()
    await refreshSelectedAisTrack()
    scheduleTrackRefresh(Math.max(0, AIS_TRACK_REFRESH_INTERVAL_MS - (Date.now() - startedAt)))
  }, delayMs)
}

export function startSelectedAisTracking(vessel) {
  const mmsi = finiteNumber(vessel?.mmsi)
  if (!trackRequestsEnabled || mmsi == null) return
  clearTimeout(trackRefreshTimer)
  trackAbortController?.abort()
  trackAbortController = null
  trackRequestToken += 1
  selectedAisTrackState.mmsi = mmsi
  selectedAisTrackState.points = []
  selectedAisTrackState.latest = normalizeAisTrackPoint(vessel)
  selectedAisTrackState.anchorReceivedAt = Date.now()
  selectedAisTrackState.lostAt = 0
  selectedAisTrackState.confirmed = false
  selectedAisTrackState.loading = false
  selectedAisTrackState.found = null
  selectedAisTrackState.error = ''
  selectedAisTrackState.lastUpdated = null
  const startedAt = Date.now()
  refreshSelectedAisTrack().finally(() => {
    if (selectedAisTrackState.mmsi !== mmsi) return
    scheduleTrackRefresh(Math.max(0, AIS_TRACK_REFRESH_INTERVAL_MS - (Date.now() - startedAt)))
  })
}

export function stopSelectedAisTracking() {
  clearTimeout(trackRefreshTimer)
  trackRefreshTimer = 0
  trackAbortController?.abort()
  trackAbortController = null
  trackRequestToken += 1
  selectedAisTrackState.mmsi = null
  selectedAisTrackState.points = []
  selectedAisTrackState.latest = null
  selectedAisTrackState.anchorReceivedAt = 0
  selectedAisTrackState.lostAt = 0
  selectedAisTrackState.confirmed = false
  selectedAisTrackState.loading = false
  selectedAisTrackState.found = null
  selectedAisTrackState.error = ''
}

export function selectedAisMotionPosition(now = Date.now()) {
  if (!selectedAisTrackState.latest) return null
  // 后端尚未确认或已丢失时保持最后报文位置，不做推算。
  if (!selectedAisTrackState.confirmed || selectedAisTrackState.found === false) {
    return selectedAisTrackState.latest
  }
  const elapsed = Math.max(0, now - selectedAisTrackState.anchorReceivedAt)
  // 过期后冻结在超时时刻的位置，避免从推算点突然跳回最后报文位置。
  if (elapsed > AIS_TRACK_STALE_MS) {
    return projectAisPosition(selectedAisTrackState.latest, AIS_TRACK_STALE_MS)
  }
  return projectAisPosition(selectedAisTrackState.latest, elapsed)
}

/** 无新报文或已确认的船丢失时让选中船标记和航迹淡出。 */
export function selectedAisTrackOpacity(now = Date.now()) {
  if (!selectedAisTrackState.latest) return 0
  // 后端仍能返回该船位置时保持可见；位置未变化只影响推算，不触发淡出。
  if (selectedAisTrackState.found !== false) return 1
  if (selectedAisTrackState.confirmed) {
    const lostAt = selectedAisTrackState.lostAt || now
    return Math.max(0, 1 - (now - lostAt) / AIS_TRACK_FADE_MS)
  }
  // 刚点击但后端还没收录时先保持可见，等超过无报文有效期后再淡出。
  const elapsed = Math.max(0, now - selectedAisTrackState.anchorReceivedAt)
  if (elapsed <= AIS_TRACK_STALE_MS) return 1
  return Math.max(0, 1 - (elapsed - AIS_TRACK_STALE_MS) / AIS_TRACK_FADE_MS)
}

export function connectAis() {
  aisMonitorState.connected = true
  aisMonitorState.error = ''
  requestAisLandMask()
  refreshAisVessels()
  startTimer()
}

export function disconnectAis() {
  aisMonitorState.connected = false
  aisMonitorState.streamConnected = false
  aisMonitorState.loading = false
  requestToken += 1
  clearInterval(refreshTimer)
  refreshTimer = 0
  stopSelectedAisTracking()
}

export function ensureAisConnection() {
  if (!aisMonitorState.connected) return
  requestAisLandMask()
  if (!aisMonitorState.vessels.length) refreshAisVessels()
  startTimer()
}

export function releaseAisConnection() {
  clearInterval(refreshTimer)
  refreshTimer = 0
}

export function selectAisVessel(vessel, viewMode = '') {
  if (!vessel) return
  aisMonitorState.selectedMmsi = vessel.mmsi
  aisMonitorState.selectedVesselSnapshot = vessel
  aisMonitorState.panelRequested = true
  aisMonitorState.focusToken += 1
  aisMonitorState.focusRequest = {
    token: aisMonitorState.focusToken,
    viewMode,
    mmsi: vessel.mmsi,
    longitude: vessel.longitude,
    latitude: vessel.latitude,
  }
}

export function rememberSelectedAisVessel(vessel) {
  if (!vessel) return
  aisMonitorState.selectedMmsi = vessel.mmsi
  aisMonitorState.selectedVesselSnapshot = vessel
}

export function clearSelectedAisVessel() {
  aisMonitorState.selectedMmsi = null
  aisMonitorState.selectedVesselSnapshot = null
  stopSelectedAisTracking()
}

