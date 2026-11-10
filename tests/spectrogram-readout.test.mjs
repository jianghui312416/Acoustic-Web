import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addSpectrogramReadoutMarker,
  clearSpectrogramReadout,
  setSpectrogramReadoutEnabled,
  spectrogramReadout,
} from '../src/modules/acoustic/spectrogramReadout.js'

test('spectrogram readout stores multiple shared readout points', () => {
  clearSpectrogramReadout()
  setSpectrogramReadoutEnabled(true)
  assert.equal(spectrogramReadout.enabled, true)

  addSpectrogramReadoutMarker(12.5, 126)
  addSpectrogramReadoutMarker(4, 84)
  assert.equal(spectrogramReadout.markers.length, 2)
  assert.equal(spectrogramReadout.markers[0].timeS, 12.5)
  assert.equal(spectrogramReadout.markers[0].frequencyHz, 126)
  assert.equal(spectrogramReadout.markers[1].timeS, 4)
  assert.equal(spectrogramReadout.markers[1].frequencyHz, 84)
})

test('duplicate and invalid points are ignored', () => {
  clearSpectrogramReadout()
  setSpectrogramReadoutEnabled(true)
  addSpectrogramReadoutMarker(5, 100)
  addSpectrogramReadoutMarker(5, 100)
  addSpectrogramReadoutMarker(Number.NaN, 100)
  addSpectrogramReadoutMarker(8, 0)
  assert.equal(spectrogramReadout.markers.length, 1)
})

test('disabling the readout clears all stored points', () => {
  setSpectrogramReadoutEnabled(true)
  addSpectrogramReadoutMarker(3, 84)
  addSpectrogramReadoutMarker(9, 200)
  setSpectrogramReadoutEnabled(false)
  assert.equal(spectrogramReadout.enabled, false)
  assert.equal(spectrogramReadout.markers.length, 0)
})
