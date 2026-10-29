import test from 'node:test'
import assert from 'node:assert/strict'

const {
  annotatePropagationReceiver,
  clearPropagationLink,
  latestPropagationLink,
  propagationLinkVersion,
  publishPropagationLink,
} = await import('../src/modules/array-fusion/propagationLinkState.js')

test('propagation link carries a receiver annotation into the communication workflow', () => {
  clearPropagationLink()
  const initialVersion = propagationLinkVersion.value
  assert.equal(publishPropagationLink({
    bellhopJobId: 'tl-task',
    rayJobId: 'ray-task',
    source: { lon: 120, lat: 30, depthM: 100 },
    receiver: { lon: 120.1, lat: 30.1, depthM: 80, rangeM: 12000 },
  }), true)
  assert.ok(propagationLinkVersion.value > initialVersion)

  annotatePropagationReceiver({ lon: 120.2, lat: 30.2, depthM: 60, rangeM: 18000 })
  assert.equal(latestPropagationLink.value.receiver.depthM, 60)
  assert.equal(latestPropagationLink.value.receiver.rangeM, 18000)
})
