import { computed, reactive } from 'vue'
import { signalTransmissionControls } from './signalTransmissionControls.js'

const DOUBLE_CLICK_DUPLICATE_MS = 600

export const trackPointState = reactive({
  points: [],
  finished: false,
  revision: 0,
  lastAddedAt: 0,
  addedAt: [],
})

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
  trackPointState.finished = false
  trackPointState.revision += 1
  trackPointState.lastAddedAt = 0
  trackPointState.addedAt = []
}

export function addTrackPoint(point, now = Date.now()) {
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
  trackPointState.revision += 1
  trackPointState.lastAddedAt = now
  trackPointState.addedAt.push(now)
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
    trackPointState.addedAt.pop()
    duplicateCount -= 1
  }
  trackPointState.finished = true
  trackPointState.revision += 1
  return true
}

/** 触屏等场景可显式完成；一个航迹点表示固定发射位置。 */
export function finishTrackPoints() {
  if (trackPointState.finished || trackPointState.points.length < 1) return false
  trackPointState.finished = true
  trackPointState.revision += 1
  return true
}

export function clearTrackPoints() {
  if (!trackPointState.points.length && !trackPointState.finished) return
  resetTrackPoints()
}
