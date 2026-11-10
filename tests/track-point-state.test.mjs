import test from 'node:test'
import assert from 'node:assert/strict'

import { signalTransmissionControls } from '../src/modules/acoustic/signalTransmissionControls.js'
import {
  addTrackPoint,
  finishTrackPoints,
  clearTrackPoints,
  finishTrackPointsFromDoubleClick,
  resetTrackPoints,
  trackPointDrawing,
  trackPointState,
} from '../src/modules/acoustic/trackPointState.js'

test('track point drawing follows the signal transmission switch', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()
  assert.equal(trackPointDrawing.value, true)

  assert.equal(addTrackPoint({ lon: 116.2, lat: 15.8, elevation: -120 }), true)
  assert.equal(trackPointState.points.length, 1)
  assert.deepEqual(trackPointState.points[0], { lon: 116.2, lat: 15.8, elevation: -120 })
  assert.equal(addTrackPoint({ lon: Number.NaN, lat: 15.8 }), false)

  signalTransmissionControls.selectTrackPoints = false
  assert.equal(trackPointDrawing.value, false)
  clearTrackPoints()
  assert.equal(trackPointState.points.length, 0)
})

test('double click only finishes and neither click is kept as a route point', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()

  addTrackPoint({ lon: 116.2, lat: 15.8, elevation: -120 }, 1000)
  addTrackPoint({ lon: 116.3, lat: 15.9, elevation: -90 }, 2000)
  addTrackPoint({ lon: 116.3, lat: 15.9, elevation: -90 }, 2050)
  assert.equal(finishTrackPointsFromDoubleClick(2100), true)
  assert.equal(trackPointState.points.length, 1)
  assert.equal(trackPointState.points[0].lon, 116.2)
  assert.equal(trackPointState.finished, true)
  assert.equal(trackPointDrawing.value, false)
  assert.equal(addTrackPoint({ lon: 116.4, lat: 16 }), false)

  clearTrackPoints()
  signalTransmissionControls.selectTrackPoints = false
})

test('explicit finish keeps all picked points for touch and single-click workflows', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()
  addTrackPoint({ lon: 116.2, lat: 15.8 })
  addTrackPoint({ lon: 116.21, lat: 15.81 })
  assert.equal(finishTrackPoints(), true)
  assert.equal(trackPointState.points.length, 2)
  assert.equal(trackPointState.finished, true)
  clearTrackPoints()
  signalTransmissionControls.selectTrackPoints = false
})

test('a single route point is a valid fixed source position', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()
  addTrackPoint({ lon: 116.2, lat: 15.8 })
  assert.equal(finishTrackPoints(), true)
  assert.equal(trackPointState.points.length, 1)
  assert.equal(trackPointState.finished, true)
  clearTrackPoints()
  signalTransmissionControls.selectTrackPoints = false
})
