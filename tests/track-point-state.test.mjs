import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { signalTransmissionControls } from '../src/modules/acoustic/signalTransmissionControls.js'
import {
  addTrackPoint,
  finishTrackPoints,
  clearTrackPoints,
  finishTrackPointsFromDoubleClick,
  resetTrackPoints,
  trackPointDrawing,
  trackPointState,
  undoLastTrackPoint,
} from '../src/modules/acoustic/trackPointState.js'

const terrainPreviewSource = await readFile(
  new URL('../src/components/terrain/TerrainPreviewMode.vue', import.meta.url),
  'utf8',
)

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

test('undo removes only the latest unfinished route point and keeps state aligned', () => {
  signalTransmissionControls.selectTrackPoints = true
  resetTrackPoints()
  addTrackPoint({ lon: 116.2, lat: 15.8 }, 1000, { sourceDepthM: 80 })
  addTrackPoint({ lon: 116.3, lat: 15.9 }, 2000, { sourceDepthM: 120 })

  assert.equal(undoLastTrackPoint(), true)
  assert.equal(trackPointState.points.length, 1)
  assert.equal(trackPointState.params.length, 1)
  assert.equal(trackPointState.addedAt.length, 1)
  assert.equal(trackPointState.lastAddedAt, 1000)
  assert.equal(trackPointState.selectedIndex, 0)

  assert.equal(finishTrackPoints(), true)
  assert.equal(undoLastTrackPoint(), false)
  assert.equal(trackPointState.points.length, 1)
  clearTrackPoints()
  signalTransmissionControls.selectTrackPoints = false
})

test('route selection distinguishes a short right click from right-button rotation', () => {
  assert.match(terrainPreviewSource, /const TRACK_RIGHT_CLICK_MAX_MS = 350/)
  assert.match(
    terrainPreviewSource,
    /!moved[\s\S]*?mode === 'rotate'[\s\S]*?heldMs <= TRACK_RIGHT_CLICK_MAX_MS[\s\S]*?undoLastTrackPoint\(\)/,
  )
  assert.match(terrainPreviewSource, /dragState\.mode === 'rotate'[\s\S]*?camera\.value =/)
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
