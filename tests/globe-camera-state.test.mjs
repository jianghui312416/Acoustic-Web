import test from 'node:test'
import assert from 'node:assert/strict'

const {
  applyGlobeCamera,
  captureGlobeCamera,
  clearGlobeCamera,
  sharedGlobeCamera,
} = await import('../src/modules/array-fusion/globeCameraState.js')

function fakeViewer(overrides = {}) {
  const applied = []
  return {
    applied,
    camera: {
      positionWC: { x: 1, y: 2, z: 3, clone() { return { x: this.x, y: this.y, z: this.z } } },
      heading: 0.25,
      pitch: -1.1,
      roll: 0,
      setView(view) { applied.push(view) },
      ...overrides,
    },
    scene: { requestRender() {} },
  }
}

test('camera state survives switching between the propagation and communication globes', () => {
  clearGlobeCamera()
  const source = fakeViewer()
  assert.equal(captureGlobeCamera(source), true)
  assert.deepEqual(sharedGlobeCamera.value.position, { x: 1, y: 2, z: 3 })

  const target = fakeViewer({ heading: 0, pitch: 0, roll: 0 })
  assert.equal(applyGlobeCamera(target), true)
  assert.deepEqual(target.applied, [{
    destination: { x: 1, y: 2, z: 3 },
    orientation: { heading: 0.25, pitch: -1.1, roll: 0 },
  }])
})

test('ignores viewers without a camera and can be cleared', () => {
  clearGlobeCamera()
  assert.equal(captureGlobeCamera(null), false)
  assert.equal(applyGlobeCamera({}), false)
  const viewer = fakeViewer()
  captureGlobeCamera(viewer)
  clearGlobeCamera()
  assert.equal(applyGlobeCamera(viewer), false)
})
