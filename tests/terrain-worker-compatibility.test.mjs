import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installTerrainWorkerCompatibility } from '../src/utils/terrainWorkerCompatibility.js'

test('routes terrain workers only, forwards receiver/arguments/result, installs once', () => {
  class TaskProcessor {
    constructor(name) { this._workerName = name }
    scheduleTask(...args) { return { receiver:this, args } }
  }
  const engine = { TaskProcessor }
  installTerrainWorkerCompatibility(engine)
  const installed = TaskProcessor.prototype.scheduleTask
  installTerrainWorkerCompatibility(engine)
  assert.equal(TaskProcessor.prototype.scheduleTask, installed)
  for (const name of ['createVerticesFromHeightmap','createVerticesFromQuantizedTerrainMesh','createVerticesFromGoogleEarthEnterpriseBuffer','createBoxGeometry']) {
    const worker = new TaskProcessor(name)
    const params = {}, transfers = []
    const result = worker.scheduleTask(params,transfers)
    assert.equal(result.receiver, worker)
    assert.deepEqual(result.args,[params,transfers])
    assert.equal(worker._workerName, name === 'createBoxGeometry' ? name : 'terrain/' + name)
    worker.scheduleTask(params)
    assert.ok(!worker._workerName.includes('terrain/terrain/'))
  }
})
