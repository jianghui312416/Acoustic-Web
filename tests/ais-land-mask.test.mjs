import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  decodeLandMask,
  filterLandVessels,
  isLandInMask,
} from '../src/utils/aisLandMask.js'

function buildMask({ width, height, west, north, lonStep, latStep, landIndexes }) {
  const buffer = new ArrayBuffer(28 + Math.ceil((width * height) / 8))
  const bytes = new Uint8Array(buffer)
  bytes.set([65, 76, 77, 49])
  const view = new DataView(buffer)
  view.setUint32(4, width, true)
  view.setUint32(8, height, true)
  view.setFloat32(12, west, true)
  view.setFloat32(16, north, true)
  view.setFloat32(20, lonStep, true)
  view.setFloat32(24, latStep, true)
  for (const index of landIndexes) {
    bytes[28 + (index >> 3)] |= 1 << (index & 7)
  }
  return buffer
}

function testMask() {
  return decodeLandMask(buildMask({
    width: 5,
    height: 5,
    west: 0,
    north: 50,
    lonStep: 10,
    latStep: 10,
    landIndexes: [6, 7, 8, 11, 12, 13, 16, 17, 18],
  }))
}

test('land mask decodes and answers O(1) ocean/land queries', () => {
  const mask = testMask()
  assert.equal(mask.width, 5)
  assert.equal(mask.height, 5)
  assert.equal(isLandInMask(mask, 25, 25), true)
  assert.equal(isLandInMask(mask, 45, 25), false)
  assert.equal(isLandInMask(mask, 15, 35), true)
  assert.equal(isLandInMask(mask, Number.NaN, 25), null)
})

test('land filtering removes every vessel coordinate classified as land', () => {
  const mask = testMask()
  const vessels = [
    { mmsi: 1, longitude: 25, latitude: 25 },
    { mmsi: 2, longitude: 15, latitude: 35 },
    { mmsi: 3, longitude: 45, latitude: 25 },
  ]
  const filtered = filterLandVessels(vessels, mask)
  assert.equal(filtered.active, true)
  assert.equal(filtered.hidden, 2)
  assert.deepEqual(filtered.vessels, [vessels[2]])
  assert.deepEqual(filterLandVessels(vessels, null), { vessels, hidden: 0, active: false })
})

test('shipped GEBCO land mask separates known land and sea positions', () => {
  const file = fs.readFileSync(new URL('../src/assets/ais-land-mask.bin', import.meta.url))
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const mask = decodeLandMask(buffer)
  assert.equal(mask.width, 18000)
  assert.equal(mask.height, 9000)
  assert.equal(isLandInMask(mask, 116.4, 39.9), true, 'Beijing should be land')
  assert.equal(isLandInMask(mask, 10, 23), true, 'Sahara should be land')
  assert.equal(isLandInMask(mask, 116.0, 16.0), false, 'South China Sea should be ocean')
  assert.equal(isLandInMask(mask, -30, 30), false, 'Atlantic should be ocean')
  assert.equal(isLandInMask(mask, 114.17, 22.29), false, 'Victoria Harbour should be ocean')
})
