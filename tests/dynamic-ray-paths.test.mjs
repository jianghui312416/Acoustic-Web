import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.window = { GeoVis: {} }

const {
  buildDynamicRayFrames,
  buildDynamicRayPaths,
  parseAnalyse2DRtrdDynamic,
  resolveDynamicRayFrames,
  sampleDynamicRayFrame,
  dynamicRayFrameAt,
  DYNAMIC_RAY_DEFAULTS,
} = await import('../src/sdk/dynamicRayPaths.js')

function rtrdFixture() {
  return {
    Data: {
      Units: [{
        Plugin: 'Analyse2DRTRD',
        Response: {
          calcFrequency: 100,
          trackData: {
            data: [
              { x: [0, 100, 200], z: [20, 40, 20] },
              { x: [0, 50, 100], z: [20, 10, 20] },
            ],
          },
          sampling: { data: { x: [0, 200], y: [-100, -100] } },
        },
      }],
    },
  }
}

test('builds one frame per time step with x/z arrays per ray', () => {
  const model = buildDynamicRayFrames(rtrdFixture(), {
    frameCount: 5,
    durationMs: 400,
    trailRatio: 0,
  })

  assert.equal(model.plugin, 'Analyse2DRTRD')
  assert.equal(model.rayCount, 2)
  assert.equal(model.frameCount, 5)
  assert.equal(model.durationMs, 400)
  assert.equal(model.frameIntervalMs, 100)
  assert.ok(Math.abs(model.rays[0].lengthM - 2 * Math.hypot(100, 20)) < 1e-9)
  assert.ok(Math.abs(model.rays[1].lengthM - 2 * Math.hypot(50, 10)) < 1e-9)
  assert.equal(model.frames.length, 5)

  for (const frame of model.frames) {
    assert.equal(frame.rays.length, 2)
    for (const ray of frame.rays) {
      assert.ok(Array.isArray(ray.x))
      assert.ok(Array.isArray(ray.z))
      assert.equal(ray.x.length, ray.z.length)
    }
  }

  assert.deepEqual(model.frames[0].rays[0].x, [])
  assert.deepEqual(model.frames[0].rays[0].z, [])
  assert.deepEqual(model.frames.at(-1).rays[0].x, [0, 100, 200])
  assert.deepEqual(model.frames.at(-1).rays[0].z, [20, 40, 20])
  assert.deepEqual(model.frames.at(-1).rays[1].x, [0, 50, 100])
})

test('moves a trail behind each ray head when trailRatio is positive', () => {
  const model = buildDynamicRayFrames(rtrdFixture(), {
    frameCount: 5,
    durationMs: 400,
    trailRatio: 0.5,
  })
  const last = model.frames.at(-1).rays[0]

  assert.deepEqual(last.head, [200, 20])
  assert.ok(Math.abs(last.tailDistanceM - Math.hypot(100, 20)) < 1e-9)
  assert.ok(last.tail[0] >= 50 && last.tail[0] <= 100)
  assert.ok(last.x[0] >= last.tail[0])
  assert.equal(last.x.at(-1), 200)
})

test('supports a fixed trail length and raw ray arrays', () => {
  const rays = [[[0, 10], [100, 10], [200, 10]]]
  const model = buildDynamicRayPaths(rays, {
    frameCount: 3,
    durationMs: 200,
    trailLengthM: 50,
  })
  const last = model.frames.at(-1).rays[0]

  assert.equal(last.headDistanceM, 200)
  assert.equal(last.tailDistanceM, 150)
  assert.deepEqual(last.x, [150, 200])
  assert.deepEqual(last.z, [10, 10])
})

test('samples an arbitrary progress or time without rebuilding frames', () => {
  const model = parseAnalyse2DRtrdDynamic(rtrdFixture(), {
    frameCount: 5,
    durationMs: 400,
    trailRatio: 0,
  })
  const halfway = sampleDynamicRayFrame(model, 0.5)
  const byTime = dynamicRayFrameAt(model, 200)

  assert.equal(halfway.progress, 0.5)
  assert.equal(halfway.rays[0].x.at(-1), 100)
  assert.equal(byTime.rays[0].x.at(-1), 100)
  assert.equal(DYNAMIC_RAY_DEFAULTS.frameCount, 60)
})

test('uses frames returned by the backend dynamic interface', () => {
  const response = {
    Data: {
      Units: [{
        Plugin: 'Analyse2DRTRDDynamic',
        Response: {
          durationMs: 400,
          frameCount: 2,
          frames: [
            { index: 0, timeMs: 0, progress: 0, rays: [] },
            { index: 1, timeMs: 400, progress: 1, rays: [{ id: 0, x: [0, 100], z: [10, 20] }] },
          ],
        },
      }],
    },
  }

  const model = resolveDynamicRayFrames(response)
  assert.equal(model.frameCount, 2)
  assert.deepEqual(model.frames[1].rays[0].x, [0, 100])
})

test('returns null when no valid ray exists', () => {
  assert.equal(buildDynamicRayFrames(null), null)
  assert.equal(buildDynamicRayFrames([]), null)
  assert.equal(buildDynamicRayFrames({ Data: { Units: [] } }), null)
})
