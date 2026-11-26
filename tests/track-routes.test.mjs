import test from 'node:test'
import assert from 'node:assert/strict'

import { signalTransmissionControls } from '../src/modules/acoustic/signalTransmissionControls.js'
import {
  addTrackPoint,
  createTrackRoute,
  defaultTransmitTimeString,
  ensureDrawingTrackRoute,
  finishTrackPoints,
  formatTransmitTimeForDisplay,
  normalizeTransmitTimeInput,
  removeTrackRoute,
  resetTrackPoints,
  restoreTrackPoints,
  selectTrackRoute,
  serializeTrackRoutes,
  trackPointDrawing,
  trackPointState,
} from '../src/modules/acoustic/trackPointState.js'

function seedRoute(points) {
  ensureDrawingTrackRoute()
  for (const point of points) addTrackPoint(point)
  finishTrackPoints()
  return trackPointState.activeRouteId
}

test('multiple transmission routes keep their own points and transmit time', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()

  const first = seedRoute([{ lon: 116.1, lat: 15.1 }, { lon: 116.2, lat: 15.2 }])
  const second = seedRoute([{ lon: 117.1, lat: 16.1 }])

  assert.notEqual(first, second)
  assert.equal(trackPointState.routes.length, 2)
  assert.equal(trackPointState.routes[0].points.length, 2)
  assert.equal(trackPointState.routes[1].points.length, 1)
  assert.match(trackPointState.routes[0].transmitTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)

  // 顶层镜像跟随当前（最后一条）航线。
  assert.equal(trackPointState.points.length, 1)
  assert.equal(trackPointState.activeRouteId, second)

  // 切换当前航线后镜像同步。
  selectTrackRoute(first)
  assert.equal(trackPointState.points.length, 2)
  assert.equal(trackPointState.finished, true)
  assert.equal(trackPointDrawing.value, false)

  resetTrackPoints()
  signalTransmissionControls.selectTrackPoints = false
})

test('serialization keeps only routes that actually have points', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()
  seedRoute([{ lon: 116.1, lat: 15.1 }])
  createTrackRoute() // 空航线不入快照

  const serialized = serializeTrackRoutes()
  assert.equal(serialized.length, 1)
  assert.equal(serialized[0].points.length, 1)
  assert.equal(serialized[0].finished, true)
  assert.ok(serialized[0].params[0].speedKn > 0)

  resetTrackPoints()
  signalTransmissionControls.selectTrackPoints = false
})

test('restore rebuilds every route and removing a route reselects a survivor', () => {
  restoreTrackPoints({
    routes: [
      {
        transmitTime: '2026-01-02T03:04',
        finished: true,
        points: [{ lon: 116.1, lat: 15.1 }, { lon: 116.2, lat: 15.2 }],
        params: [{ speedKn: 5 }, { speedKn: 6 }],
      },
      {
        transmitTime: '2026-02-03T04:05',
        finished: true,
        points: [{ lon: 117.1, lat: 16.1 }],
        params: [{ speedKn: 7 }],
      },
    ],
  })

  assert.equal(trackPointState.routes.length, 2)
  assert.equal(trackPointState.routes[1].transmitTime, '2026-02-03T04:05:00')
  assert.equal(trackPointState.routes[0].transmitTime, '2026-01-02T03:04:00')
  assert.equal(trackPointState.routes[0].params[1].speedKn, 6)

  const removedId = trackPointState.routes[1].id
  assert.equal(removeTrackRoute(removedId), true)
  assert.equal(trackPointState.routes.length, 1)
  assert.equal(trackPointState.activeRouteId, trackPointState.routes[0].id)
  assert.equal(trackPointState.points.length, 2)
})

test('restore still accepts the legacy single-track snapshot', () => {
  restoreTrackPoints({
    points: [{ lon: 116.1, lat: 15.1 }],
    params: [{ speedKn: 4 }],
    finished: true,
  })
  assert.equal(trackPointState.routes.length, 1)
  assert.equal(trackPointState.finished, true)
  assert.equal(trackPointState.points.length, 1)
})

test('default transmit time matches the second-precision format', () => {
  assert.match(defaultTransmitTimeString(new Date(2026, 0, 2, 3, 4, 5)), /^2026-01-02T03:04:05$/)
})

test('manual transmit time input accepts common formats and normalizes to seconds', () => {
  assert.equal(normalizeTransmitTimeInput('2026-01-02 03:04:05'), '2026-01-02T03:04:05')
  assert.equal(normalizeTransmitTimeInput('2026-01-02 03:04'), '2026-01-02T03:04:00')
  assert.equal(normalizeTransmitTimeInput('2026/1/2 3:4:5'), '2026-01-02T03:04:05')
  assert.equal(normalizeTransmitTimeInput('not a time'), '')
  assert.equal(formatTransmitTimeForDisplay('2026-01-02T03:04:05'), '2026-01-02 03:04:05')
})
