import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRayFlow, resolveRayFlow, sampleRayFlow, fractionalAxisIndex, rayChartViewport } from '../src/utils/rayFlow.js'

test('backend frames win over static tracks and retain nonuniform timestamps and heads', () => {
  const response = { Data: { Units: [{ Response: { durationMs: 1000, frames: [
    { timeMs: 0, rays: [] },
    { timeMs: 100, rays: [{ x: [0, 40], z: [20, 30] }, { x: [0, 25], z: [20, 55] }] },
    { timeMs: 800, rays: [{ x: [0, 90], z: [20, 80] }] },
  ] } }] } }
  const flow = resolveRayFlow(response, [[[0, 0], [10000, 0]]])
  assert.deepEqual(sampleRayFlow(flow, 99), [])
  assert.deepEqual(sampleRayFlow(flow, 101).map(trail => trail.at(-1).point), [[40, 30], [25, 55]])
  assert.deepEqual(sampleRayFlow(flow, 799).map(trail => trail.at(-1).point), [[40, 30], [25, 55]])
  assert.deepEqual(sampleRayFlow(flow, 800)[0].at(-1).point, [90, 80])
  assert.deepEqual(sampleRayFlow(flow, 1000), [])
})

test('frames-only responses render with short tails and bright heads', () => {
  const flow = resolveRayFlow({ durationMs: 1000, frames: [
    { timeMs: 0, rays: [{ x: [0, 500, 1000], z: [20, 30, 20] }] },
  ] })
  const trail = sampleRayFlow(flow, 400)[0]
  assert.ok(trail[0].point[0] > 980)
  assert.ok(trail[0].alpha < 0.001)
  assert.equal(trail.at(-1).alpha, 1)
  assert.deepEqual(trail.at(-1).point, [1000, 20])
})

test('local fallback advances equal arc lengths, not equal per-ray fractions', () => {
  const flow = buildRayFlow([[[0, 0], [100, 0]], [[0, 0], [0, 200]]])
  const trails = sampleRayFlow(flow, 2000)
  assert.equal(trails.length, 2)
  assert.equal(trails[0].at(-1).point[0], trails[1].at(-1).point[1])
  assert.equal(sampleRayFlow(flow, 6000).length, 1, 'short ray must leave instead of freezing its head')
})

test('reflection vertices remain inside a short trail', () => {
  const flow = buildRayFlow([[[0, 50], [100, 0], [200, 50]]])
  const elapsed = (Math.hypot(100, 50) + 1) / (flow.length + flow.trailLength) * flow.durationMs
  const trail = sampleRayFlow(flow, elapsed)[0]
  assert.ok(trail.some(({ point }) => point[0] === 100 && point[1] === 0))
  assert.ok(trail.every(({ point }) => point[1] >= 0))
})

test('empty or degenerate data does not create animation', () => {
  assert.equal(resolveRayFlow(null), null)
  assert.equal(buildRayFlow([[[1, 1], [1, 1]]]), null)
  assert.deepEqual(sampleRayFlow(null, 100), [])
})

test('nonuniform and descending category axes interpolate continuously under zoom', () => {
  assert.equal(fractionalAxisIndex([0, 100, 400], 250), 1.5)
  assert.equal(fractionalAxisIndex([100, 80, 0], 40), 1.5)
  const chart = {
    isDisposed: () => false, getWidth: () => 600, getHeight: () => 250,
    convertToPixel: (_, [x, y]) => [20 + x * 200, 16 + y * 80],
  }
  const viewport = rayChartViewport(chart, [0, 100, 400], [0, 50, 200], true, 52)
  assert.deepEqual(viewport.project([250, 125]), [320, 136])
  assert.deepEqual(viewport.rect, [62, 16, 484, 182])
})
