import test from 'node:test'
import assert from 'node:assert/strict'
import { moonLightDirection } from '../src/utils/moonLight.js'

test('moon light direction is finite and normalized for terrain lighting', () => {
  const light = moonLightDirection('2025-01-10T12:00:00', 16, 116)
  assert.ok(Number.isFinite(light.azimuthDeg))
  assert.ok(light.azimuthDeg >= 0 && light.azimuthDeg < 360)
  assert.ok(light.altitudeDeg >= 15 && light.altitudeDeg <= 80)
  assert.ok(light.rawAltitudeDeg >= -90 && light.rawAltitudeDeg <= 90)
})

test('moon light direction follows simulation time', () => {
  const first = moonLightDirection('2025-01-10T12:00:00', 16, 116)
  const second = moonLightDirection('2025-01-20T18:00:00', 16, 116)
  assert.ok(Math.abs(first.azimuthDeg - second.azimuthDeg) > 1)
})
