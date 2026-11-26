import { computed, reactive } from 'vue'
import { signalTransmissionControls } from './signalTransmissionControls.js'

const DOUBLE_CLICK_DUPLICATE_MS = 600

let routeSeq = 0

function newRouteId() {
  routeSeq += 1
  return `route-${Date.now().toString(36)}-${routeSeq}`
}

const pad2 = value => String(value).padStart(2, '0')

/** 发射时间默认取当前本地时间，精确到秒。 */
export function defaultTransmitTimeString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 文本输入框展示值：日期与时间用空格分隔，便于手动编辑。 */
export function formatTransmitTimeForDisplay(value) {
  return String(value || '').replace('T', ' ')
}

const TRANSMIT_TIME_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/

/**
 * 将用户手动输入的发射时间规范化为 `YYYY-MM-DDTHH:mm:ss`（精确到秒）。
 * 支持 `2026-01-02 03:04[:05]`、`2026/01/02 03:04` 等写法；无法解析返回空串。
 */
export function normalizeTransmitTimeInput(value) {
  const match = String(value || '').trim().match(TRANSMIT_TIME_PATTERN)
  if (!match) return ''
  const [, year, month, day, hour, minute, second = '0'] = match
  const pad = part => String(Number(part)).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
}

/**
 * 发射航线状态。
 *
 * `routes` 是权威数据：每条航线拥有自己的航迹点 / 参数 / 是否完成 / 发射时间。
 * 顶层 `points/params/finished/...` 是**当前航线**的镜像，保留给既有地图绘制、
 * 航线声场计算与信号链路播放等单航迹代码路径使用。
 */
export const trackPointState = reactive({
  routes: [],
  activeRouteId: '',
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
  const speed = Number(signalTransmissionControls.vesselSpeedKn)
  return {
    sourceDepthM: 150,
    frequencyHz: 100,
    rangeNm: 10,
    grazingAngleMin: -25,
    grazingAngleMax: 25,
    lineCount: 10,
    sector: 4,
    model: 'bellhop',
    // 航速作用在该点之后的航段；第一段用此时填写的航速。
    speedKn: Number.isFinite(speed) && speed > 0 ? speed : 4,
  }
}

export function activeTrackRoute() {
  return trackPointState.routes.find(route => route.id === trackPointState.activeRouteId) || null
}

/** 把当前航线镜像到顶层字段，供旧的单航迹代码继续读取。 */
function syncActiveMirror() {
  const route = activeTrackRoute()
  trackPointState.points = route ? route.points : []
  trackPointState.params = route ? route.params : []
  trackPointState.addedAt = route ? route.addedAt : []
  trackPointState.finished = route ? Boolean(route.finished) : false
  trackPointState.lastAddedAt = route ? Number(route.lastAddedAt) || 0 : 0
  if (!route) trackPointState.selectedIndex = -1
  trackPointState.revision += 1
}

function createRouteObject({ transmitTime } = {}) {
  const route = reactive({
    id: newRouteId(),
    points: [],
    params: [],
    addedAt: [],
    finished: false,
    lastAddedAt: 0,
    transmitTime: transmitTime || defaultTransmitTimeString(),
  })
  trackPointState.routes.push(route)
  return route
}

function activateRoute(routeId) {
  trackPointState.activeRouteId = String(routeId || '')
  trackPointState.selectedIndex = -1
  syncActiveMirror()
}

/** 新建一条空航线并设为当前航线，返回航线 id。 */
export function createTrackRoute(options = {}) {
  const route = createRouteObject(options)
  activateRoute(route.id)
  return route.id
}

export function selectTrackRoute(routeId) {
  if (!trackPointState.routes.some(route => route.id === routeId)) return false
  if (trackPointState.activeRouteId === routeId) return true
  activateRoute(routeId)
  return true
}

/** 保证存在一条可继续落点的航线；当前航线已完成时自动新建。 */
export function ensureDrawingTrackRoute() {
  const route = activeTrackRoute()
  if (route && !route.finished) return route.id
  return createTrackRoute()
}

export function removeTrackRoute(routeId) {
  const id = String(routeId || '')
  const index = trackPointState.routes.findIndex(route => route.id === id)
  if (index < 0) return false
  const wasActive = trackPointState.activeRouteId === id
  trackPointState.routes.splice(index, 1)
  if (wasActive) {
    const next = trackPointState.routes[Math.max(0, index - 1)] || trackPointState.routes[0] || null
    trackPointState.activeRouteId = next ? next.id : ''
  }
  syncActiveMirror()
  return true
}

export function updateRouteTransmitTime(routeId, value) {
  const route = trackPointState.routes.find(item => item.id === String(routeId || ''))
  if (!route) return false
  const normalized = normalizeTransmitTimeInput(value)
  if (!normalized) return false
  route.transmitTime = normalized
  trackPointState.revision += 1
  return true
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

/** 航线选择开关打开且当前航线尚未结束时，仅由地形区域接收点选。 */
export const trackPointDrawing = computed(() => (
  Boolean(signalTransmissionControls.selectTrackPoints)
    && Boolean(trackPointState.activeRouteId)
    && !trackPointState.finished
))

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function resetTrackPoints() {
  trackPointState.routes = []
  trackPointState.activeRouteId = ''
  trackPointState.selectedIndex = -1
  trackPointState.finished = false
  trackPointState.points = []
  trackPointState.params = []
  trackPointState.addedAt = []
  trackPointState.lastAddedAt = 0
  trackPointState.revision += 1
  trackFieldRunState.message = ''
  trackFieldRunState.error = ''
  trackFieldRunState.completedCount = 0
  // 保留一条空的当前航线，保证“开始选择”后即可直接落点。
  createRouteObject()
  trackPointState.activeRouteId = trackPointState.routes[0].id
  syncActiveMirror()
}

export function addTrackPoint(point, now = Date.now(), params = null) {
  const route = activeTrackRoute()
  if (!route || route.finished) return false
  const lon = finiteNumber(point?.lon)
  const lat = finiteNumber(point?.lat)
  if (lon === null || lat === null) return false
  const elevation = finiteNumber(point?.elevation)
  route.points.push({
    lon,
    lat,
    elevation: elevation === null ? 0 : elevation,
  })
  route.params.push({
    ...defaultTrackPointParams(),
    ...(params && typeof params === 'object' ? params : {}),
  })
  route.addedAt.push(now)
  route.lastAddedAt = now
  syncActiveMirror()
  return true
}

/** 选择过程中撤销最后一个航迹点，并保持点、参数和双击时间记录严格对齐。 */
export function undoLastTrackPoint() {
  const route = activeTrackRoute()
  if (!route || route.finished || !route.points.length) return false
  route.points.pop()
  route.params.pop()
  route.addedAt.pop()
  route.lastAddedAt = route.addedAt.at(-1) || 0
  trackPointState.selectedIndex = route.points.length - 1
  syncActiveMirror()
  return true
}

/** 双击仅用于结束选择：移除双击过程中由两次 pointerup 产生的航迹点。 */
export function finishTrackPointsFromDoubleClick(now = Date.now()) {
  const route = activeTrackRoute()
  if (!route || route.finished) return false
  let duplicateCount = 0
  for (let index = route.addedAt.length - 1; index >= 0 && duplicateCount < 2; index -= 1) {
    if (now - route.addedAt[index] > DOUBLE_CLICK_DUPLICATE_MS) break
    duplicateCount += 1
  }
  while (duplicateCount > 0 && route.points.length) {
    route.points.pop()
    route.params.pop()
    route.addedAt.pop()
    duplicateCount -= 1
  }
  route.finished = true
  trackPointState.selectedIndex = -1
  syncActiveMirror()
  return true
}

/** 触屏等场景可显式完成当前航线；一个航迹点表示固定发射位置。 */
export function finishTrackPoints() {
  const route = activeTrackRoute()
  if (!route || route.finished || route.points.length < 1) return false
  route.finished = true
  trackPointState.selectedIndex = -1
  syncActiveMirror()
  return true
}

function normalizeRestorePoints(points) {
  return Array.isArray(points)
    ? points
        .filter(point => Number.isFinite(Number(point?.lon)) && Number.isFinite(Number(point?.lat)))
        .map(point => ({
          lon: Number(point.lon),
          lat: Number(point.lat),
          elevation: Number.isFinite(Number(point.elevation)) ? Number(point.elevation) : 0,
        }))
        .slice(0, 2000)
    : []
}

function normalizeRestoreParams(points, params) {
  const list = Array.isArray(params) ? params : []
  return points.map((_, index) => ({
    ...defaultTrackPointParams(),
    ...(list[index] && typeof list[index] === 'object' ? list[index] : {}),
  }))
}

/**
 * 仅在用户打开工作区记录时，用记录中的点位完整替换当前航线集合。
 * 兼容旧版单航迹快照（points/params/finished）与新版多航线快照（routes）。
 */
export function restoreTrackPoints(snapshot) {
  const restored = []
  if (Array.isArray(snapshot?.routes) && snapshot.routes.length) {
    for (const item of snapshot.routes) {
      const points = normalizeRestorePoints(item?.points)
      if (!points.length) continue
      restored.push(reactive({
        id: newRouteId(),
        points,
        params: normalizeRestoreParams(points, item?.params),
        addedAt: [],
        finished: Boolean(item?.finished ?? true),
        lastAddedAt: 0,
        transmitTime: normalizeTransmitTimeInput(item?.transmitTime) || defaultTransmitTimeString(),
      }))
    }
  } else {
    const points = normalizeRestorePoints(snapshot?.points)
    if (points.length) {
      restored.push(reactive({
        id: newRouteId(),
        points,
        params: normalizeRestoreParams(points, snapshot?.params),
        addedAt: [],
        finished: Boolean(snapshot?.finished && points.length),
        lastAddedAt: 0,
        transmitTime: normalizeTransmitTimeInput(snapshot?.transmitTime) || defaultTransmitTimeString(),
      }))
    }
  }
  if (!restored.length) {
    resetTrackPoints()
    return
  }
  trackPointState.routes = restored
  trackPointState.activeRouteId = restored[0].id
  trackPointState.selectedIndex = -1
  syncActiveMirror()
}

/** 序列化为工作区快照可持久化的普通对象。 */
export function serializeTrackRoutes() {
  return trackPointState.routes
    .filter(route => route.points.length)
    .map(route => ({
      transmitTime: route.transmitTime,
      finished: Boolean(route.finished),
      points: route.points.map(point => ({
        lon: Number(point.lon),
        lat: Number(point.lat),
        elevation: Number(point.elevation) || 0,
      })),
      params: route.params.map(params => ({ ...params })),
    }))
}

export function clearTrackPoints() {
  resetTrackPoints()
}
