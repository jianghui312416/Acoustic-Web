import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aisHeadingDegrees,
  normalizeAisTrackPoint,
  projectAisPosition,
  screenHeadingAngle,
} from '../src/utils/aisTrackMotion.js'

test('projects an AIS vessel eastward using knots and course over ground', () => {
  const projected = projectAisPosition({
    longitude: 120,
    latitude: 0,
    sog_kn: 18,
    cog_deg: 90,
  }, 2_000)

  assert.ok(projected.longitude > 120)
  assert.ok(Math.abs(projected.latitude) < 1e-8)
  // 18 kn × 2 s = 18.52 m, about 0.0001665° at the equator.
  assert.ok(Math.abs(projected.longitude - 120.0001665) < 0.000002)
})

test('prefers course over ground and caps stale extrapolation', () => {
  const point = { longitude: 120, latitude: 30, sog_kn: 10, cog_deg: 0, heading_deg: 90 }
  const capped = projectAisPosition(point, 600_000)
  const fiveMinutes = projectAisPosition(point, 300_000)
  assert.deepEqual(capped, fiveMinutes)
  assert.ok(capped.latitude > 30)
})

test('keeps missing AIS heading null so course over ground can be used', () => {
  const point = normalizeAisTrackPoint({
    longitude: 120,
    latitude: 30,
    heading_deg: null,
    cog_deg: 180,
  })
  assert.equal(point.heading_deg, null)
  assert.equal(point.cog_deg, 180)
  assert.equal(aisHeadingDegrees(point), 180)
})

test('converts geographic heading into the rotated terrain screen direction', () => {
  const northUp = (lon, lat) => ({ x: lon, y: -lat })
  const rotated180 = (lon, lat) => ({ x: -lon, y: lat })

  assert.ok(Math.abs(screenHeadingAngle(northUp, 120, 30, 0)) < 1e-9)
  assert.ok(Math.abs(screenHeadingAngle(northUp, 120, 30, 90) - Math.PI / 2) < 1e-9)
  assert.ok(Math.abs(Math.abs(screenHeadingAngle(rotated180, 120, 30, 0)) - Math.PI) < 1e-9)
  assert.ok(Math.abs(screenHeadingAngle(rotated180, 120, 30, 180)) < 1e-9)
})
