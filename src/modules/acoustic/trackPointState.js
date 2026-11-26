import { computed, reactive } from 'vue'
import { signalTransmissionControls } from './signalTransmissionControls.js'

const DOUBLE_CLICK_DUPLICATE_MS = 600

export const trackPointState = reactive({
  points: [],
  params: [],
  selectedIndex: -1,
  finished: false,
  revision: 0,
  lastAddedAt: 0,
  addedAt: [],
})

export const trackFieldRunState = reactive({
  requestToken: 0,
  running: false,
  message: '',
  error: '',
  completedCount: 0,
})

function defaultTrackPointParams() {
  return {
    sourceDepthM: 150,
    frequencyHz: 100,
    rangeNm: 10,
    grazingAngleMin: -25,
    grazingAngleMax: 25,
    lineCount: 10,
    sector: 4,
    model: 'bellhop',
  }
}

export function updateTrackPointParams(index, patch) {
  const target = trackPointState.params[index]
  if (!target || !patch || typeof patch !== 'object') return
  trackPointState.params[index] = { ...target, ...patch }
  trackPointState.revision += 1
}

export function selectTrackPoint(index) {
  const next = Number(index)
  trackPointState.selectedIndex = Number.isInteger(next) && next >= 0 && next < trackPointState.points.length
    ? next
    : -1
}

export function requestTrackFieldRun() {
  if (trackFieldRunState.running) return
  trackFieldRunState.requestToken += 1
}

/** 航迹点选择开关打开且尚未双击结束时，仅由地形区域接收点选。 */
export const trackPointDrawing = computed(() => (
  Boolean(signalTransmissionControls.selectTrackPoints) && !trackPointState.finished
))

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function resetTrackPoints() {
  trackPointState.points = []
  trackPointState.params = []
  trackPointState.selectedIndex = -1
  trackPointState.finished = false
  trackPointState.revision += 1
  trackPointState.lastAddedAt = 0
  trackPointState.addedAt = []
  trackFieldRunState.message = ''
  trackFieldRunState.error = ''
  trackFieldRunState.completedCount = 0
}

export function addTrackPoint(point, now = Date.now(), params = null) {
  if (trackPointState.finished) return false
  const lon = finiteNumber(point?.lon)
  const lat = finiteNumber(point?.lat)
  if (lon === null || lat === null) return false
  const elevation = finiteNumber(point?.elevation)
  trackPointState.points.push({
    lon,
    lat,
    elevation: elevation === null ? 0 : elevation,
  })
  trackPointState.params.push({
    ...defaultTrackPointParams(),
    ...(params && typeof params === 'object' ? params : {}),
  })
  trackPointState.revision += 1
  trackPointState.lastAddedAt = now
  trackPointState.addedAt.push(now)
  return true
}

/** 选择过程中撤销最后一个航迹点，并保持点、参数和双击时间记录严格对齐。 */
export function undoLastTrackPoint() {
  if (trackPointState.finished || !trackPointState.points.length) return false
  trackPointState.points.pop()
  trackPointState.params.pop()
  trackPointState.addedAt.pop()
  trackPointState.lastAddedAt = trackPointState.addedAt.at(-1) || 0
  trackPointState.selectedIndex = trackPointState.points.length - 1
  trackPointState.revision += 1
  return true
}

/** 双击仅用于结束选择：移除双击过程中由两次 pointerup 产生的航迹点。 */
export function finishTrackPointsFromDoubleClick(now = Date.now()) {
  if (trackPointState.finished) return false
  let duplicateCount = 0
  for (let index = trackPointState.addedAt.length - 1; index >= 0 && duplicateCount < 2; index -= 1) {
    if (now - trackPointState.addedAt[index] > DOUBLE_CLICK_DUPLICATE_MS) break
    duplicateCount += 1
  }
  while (duplicateCount > 0 && trackPointState.points.length) {
    trackPointState.points.pop()
    trackPointState.params.pop()
    trackPointState.addedAt.pop()
    duplicateCount -= 1
  }
  trackPointState.finished = true
  trackPointState.selectedIndex = -1
  trackPointState.revision += 1
  return true
}

/** 触屏等场景可显式完成；一个航迹点表示固定发射位置。 */
export function finishTrackPoints() {
  if (trackPointState.finished || trackPointState.points.length < 1) return false
  trackPointState.finished = true
  trackPointState.selectedIndex = -1
  trackPointState.revision += 1
  return true
}

/** 仅在用户打开工作区记录时，用记录中的点位完整替换当前航迹。 */
export function restoreTrackPoints(snapshot) {
  const points = Array.isArray(snapshot?.points)
    ? snapshot.points.filter(point => Number.isFinite(Number(point?.lon)) && Number.isFinite(Number(point?.lat))).map(point => ({
      lon: Number(point.lon),
      lat: Number(point.lat),
      elevation: Number.isFinite(Number(point.elevation)) ? Number(point.elevation) : 0,
    })).slice(0, 2000)
    : []
  const params = Array.isArray(snapshot?.params) ? snapshot.params : []
  trackPointState.points = points
  trackPointState.params = points.map((_, index) => ({
    ...defaultTrackPointParams(),
    ...(params[index] && typeof params[index] === 'object' ? params[index] : {}),
  }))
  trackPointState.finished = Boolean(snapshot?.finished && points.length)
  trackPointState.selectedIndex = -1
  trackPointState.lastAddedAt = 0
  trackPointState.addedAt = []
  trackPointState.revision += 1
}

export function clearTrackPoints() {
  if (!trackPointState.points.length && !trackPointState.finished) return
  resetTrackPoints()
}
