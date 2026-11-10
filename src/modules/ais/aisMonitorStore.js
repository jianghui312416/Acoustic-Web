import { computed, reactive } from 'vue'
import { getRealtimeAis } from '@/api/soundFieldApi.js'
import {
  coastlineStats,
  ensureCoastline,
  ensureLandMask,
  filterLandVessels,
  isLandMaskReady,
} from '@/utils/aisLandMask.js'
import { estimateJomopansEchoSpectrum } from '@/utils/jomopansEcho.js'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

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

let refreshTimer = 0
let requestToken = 0

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
}

