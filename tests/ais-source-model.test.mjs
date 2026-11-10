import assert from 'node:assert/strict'
import test from 'node:test'

import {
  JOMOPANS_FREQUENCIES_HZ,
  classifyJomopansVessel,
  estimateJomopansEchoSpectrum,
} from '../src/utils/jomopansEcho.js'

test('maps AIS ship types to JOMOPANS-ECHO vessel classes', () => {
  assert.equal(classifyJomopansVessel({ ship_type: 30 }), 'fishing')
  assert.equal(classifyJomopansVessel({ ship_type: 31 }), 'tug')
  assert.equal(classifyJomopansVessel({ ship_type: 33 }), 'dredger')
  assert.equal(classifyJomopansVessel({ ship_type: 65, length_m: 180 }), 'cruise')
  assert.equal(classifyJomopansVessel({ ship_type: 65, length_m: 80 }), 'passenger')
  assert.equal(classifyJomopansVessel({ ship_type: 72, sog_kn: 12 }), 'containership')
  assert.equal(classifyJomopansVessel({ ship_type: 70, sog_kn: 12 }), 'bulker')
  assert.equal(classifyJomopansVessel({ ship_type: 70, sog_kn: 18 }), 'containership')
  assert.equal(classifyJomopansVessel({ ship_type: 82 }), 'tanker')
})

test('produces the published 20 Hz to 20 kHz decidecade spectrum and broadband sum', () => {
  const result = estimateJomopansEchoSpectrum({ ship_type: 70, sog_kn: 13.9, length_m: 100 })
  assert.equal(result.model, 'JOMOPANS-ECHO')
  assert.equal(result.vesselClass, 'bulker')
  assert.equal(result.bandLevelsDb.length, 31)
  assert.equal(result.frequenciesHz, JOMOPANS_FREQUENCIES_HZ)
  assert.ok(Math.abs(result.frequenciesHz[0] - 20) < 1e-12)
  assert.ok(Math.abs(result.frequenciesHz.at(-1) - 20_000) < 1e-8)
  assert.ok(Math.abs(result.broadbandSourceLevelDb - 177.7) < 0.1)
  assert.equal(result.uncertaintyDb, 6)
  assert.equal(result.sourceDepthM, 6)
})

test('applies the published speed and length power-law corrections', () => {
  const reference = estimateJomopansEchoSpectrum({ ship_type: 30, sog_kn: 6.4, length_m: 100 })
  const doubled = estimateJomopansEchoSpectrum({ ship_type: 30, sog_kn: 12.8, length_m: 200 })
  const expectedDifference = 80 * Math.log10(2)
  assert.ok(Math.abs((doubled.broadbandSourceLevelDb - reference.broadbandSourceLevelDb) - expectedDifference) < 1e-9)
})

test('records low-speed and missing-AIS assumptions instead of hiding them', () => {
  const stopped = estimateJomopansEchoSpectrum({ ship_type: 80, sog_kn: 0 })
  assert.equal(stopped.modelSpeedKn, 1)
  assert.equal(stopped.modelLengthM, 100)
  assert.ok(stopped.assumptions.some((item) => item.includes('低速外推')))
  assert.ok(stopped.assumptions.some((item) => item.includes('船长缺失')))

  const missing = estimateJomopansEchoSpectrum({ ship_type: 30, length_m: 32 })
  assert.equal(missing.modelSpeedKn, 6.4)
  assert.ok(missing.assumptions.some((item) => item.includes('航速缺失')))

  const dredging = estimateJomopansEchoSpectrum({ ship_type: 33, sog_kn: 1.8, length_m: 120 })
  assert.equal(dredging.modelSpeedKn, 14)
  assert.ok(dredging.assumptions.some((item) => item.includes('疏浚')))
})

