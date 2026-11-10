import assert from 'node:assert/strict'
import test from 'node:test'

import { createLandPolygonIndex, extractLandPolygons } from '../src/utils/coastline.js'
import { decodeLandMask, filterLandVessels, isLandInMask } from '../src/utils/aisLandMask.js'

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
  for (const index of landIndexes) bytes[28 + (index >> 3)] |= 1 << (index & 7)
  return decodeLandMask(buffer)
}

function allIndexes(width, height) {
  return Array.from({ length: width * height }, (_, index) => index)
}

test('extracts a closed coastline and filters points inside its land polygon', () => {
  const mask = buildMask({
    width: 5,
    height: 5,
    west: 0,
    north: 50,
    lonStep: 10,
    latStep: 10,
    landIndexes: [6, 7, 8, 11, 12, 13, 16, 17, 18],
  })
  const extraction = extractLandPolygons(mask)
  assert.equal(extraction.ringCount, 1)
  assert.equal(extraction.vertexCount, 12)
  assert.equal(extraction.offsets.length, 2)
  const coastline = createLandPolygonIndex(extraction)
  assert.equal(coastline.contains(25, 25), true)
  assert.equal(coastline.contains(45, 25), false)
  assert.equal(coastline.contains(15, 35), true)
  assert.equal(coastline.contains(Number.NaN, 25), null)
  for (let lat = -85; lat <= 85; lat += 5) {
    for (let lon = -175; lon <= 175; lon += 5) {
      assert.equal(coastline.contains(lon + 2.5, lat + 2.5), isLandInMask(mask, lon + 2.5, lat + 2.5), `${lon},${lat}`)
    }
  }
})

test('keeps interior water holes out of the land polygon filter', () => {
  const width = 7
  const height = 7
  const hole = new Set()
  for (let row = 2; row <= 4; row += 1) {
    for (let col = 2; col <= 4; col += 1) hole.add(row * width + col)
  }
  const mask = buildMask({
    width,
    height,
    west: 0,
    north: 70,
    lonStep: 10,
    latStep: 10,
    landIndexes: allIndexes(width, height).filter((index) => !hole.has(index)),
  })
  const extraction = extractLandPolygons(mask)
  assert.equal(extraction.ringCount, 2)
  const coastline = createLandPolygonIndex(extraction)
  assert.equal(coastline.contains(35, 35), false)
  assert.equal(coastline.contains(15, 35), true)
  assert.equal(coastline.contains(35, 15), true)
})

test('returns no polygons for an all-ocean mask', () => {
  const mask = buildMask({
    width: 6,
    height: 4,
    west: 100,
    north: 20,
    lonStep: 1,
    latStep: 1,
    landIndexes: [],
  })
  const extraction = extractLandPolygons(mask)
  assert.equal(extraction.ringCount, 0)
  assert.equal(extraction.vertexCount, 0)
  const coastline = createLandPolygonIndex(extraction)
  assert.equal(coastline.contains(102.5, 18.5), false)
})

test('uses the extracted coastline polygons to filter land vessels', () => {
  const mask = buildMask({
    width: 5,
    height: 5,
    west: 0,
    north: 50,
    lonStep: 10,
    latStep: 10,
    landIndexes: [6, 7, 8, 11, 12, 13, 16, 17, 18],
  })
  const coastline = createLandPolygonIndex(extractLandPolygons(mask))
  const vessels = [
    { mmsi: 1, longitude: 25, latitude: 25 },
    { mmsi: 2, longitude: 15, latitude: 35 },
    { mmsi: 3, longitude: 45, latitude: 25 },
  ]
  const filtered = filterLandVessels(vessels, null, coastline)
  assert.equal(filtered.active, true)
  assert.equal(filtered.hidden, 2)
  assert.deepEqual(filtered.vessels, [vessels[2]])
})
