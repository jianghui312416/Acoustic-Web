import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildNoiseTimeFrequency,
  createDefaultNoiseScenario,
  validateNoiseScenario,
} from '../src/utils/noiseTimeFrequency.js'

test('default scenario creates a bounded, reproducible time-frequency matrix', () => {
  const scenario = createDefaultNoiseScenario(4, 3, 'normal')
  assert.deepEqual(validateNoiseScenario(scenario, 'normal'), [])

  const first = buildNoiseTimeFrequency({ scenario, maxFreq: 1000, fallbackWindLevel: 4 })
  const second = buildNoiseTimeFrequency({ scenario, maxFreq: 1000, fallbackWindLevel: 4 })
  assert.equal(first.times.length, 121)
  assert.equal(first.freqs.length, 80)
  assert.equal(first.data.length, 121 * 80)
  assert.deepEqual(first.data, second.data)
  assert.deepEqual(first.rainBands, [[13.5, 20], [38.5, 49.5]])
  assert.deepEqual(first.shipBands, [[24, 36]])
})

test('multiple rain and ship intervals only raise levels inside configured windows', () => {
  const scenario = createDefaultNoiseScenario(0, 1, 'normal')
  scenario.windJitterPercent = 0
  scenario.windControlPoints = [{ timeS: 0, level: 0 }, { timeS: 60, level: 0 }]
  scenario.rainEvents = [
    { startS: 5, endS: 15, level: 6 },
    { startS: 35, endS: 45, level: 5 },
  ]
  scenario.shipEvents = [
    { startS: 20, endS: 30, level: 5, fundamentalHz: 81, harmonicCount: 4 },
  ]
  const model = buildNoiseTimeFrequency({ scenario, maxFreq: 1000, fallbackWindLevel: 0 })
  const frequencyIndex = (target) => model.freqs.reduce(
    (best, value, index) => Math.abs(value - target) < Math.abs(model.freqs[best] - target) ? index : best,
    0
  )
  const valueAt = (timeS, target) => {
    const timeIndex = model.times.findIndex((value) => value === timeS)
    return model.data[timeIndex * model.freqs.length + frequencyIndex(target)][2]
  }
  assert.ok(valueAt(10, 1000) > valueAt(0, 1000), 'heavy rain should raise the configured interval')
  assert.ok(valueAt(25, 81) > valueAt(0, 81), 'ship passage should raise its configured interval')
  assert.ok(valueAt(40, 1000) > valueAt(0, 1000), 'second rain interval should be independent')
})

test('ice crack events are applied only to ice scenarios', () => {
  const scenario = createDefaultNoiseScenario(2, 2, 'ice')
  scenario.windJitterPercent = 0
  scenario.rainEvents = []
  scenario.shipEvents = []
  scenario.iceCrackEvents = [{ timeS: 10, durationS: 1, level: 5 }]
  assert.deepEqual(validateNoiseScenario(scenario, 'ice'), [])

  const normal = buildNoiseTimeFrequency({ scenario, variant: 'normal', maxFreq: 500 })
  const ice = buildNoiseTimeFrequency({ scenario, variant: 'ice', maxFreq: 500 })
  const frequencyIndex = 20
  const timeIndex = ice.times.findIndex((value) => value === 10)
  const flatIndex = timeIndex * ice.freqs.length + frequencyIndex
  assert.ok(ice.data[flatIndex][2] > normal.data[flatIndex][2])
  assert.deepEqual(normal.crackTimes, [])
  assert.deepEqual(ice.crackTimes, [10])
})

test('validation rejects out-of-range and reversed event intervals', () => {
  const scenario = createDefaultNoiseScenario(4, 3, 'ice')
  scenario.rainEvents.push({ startS: 50, endS: 20, level: 9 })
  scenario.iceCrackEvents.push({ timeS: 80, durationS: 0, level: 8 })
  const errors = validateNoiseScenario(scenario, 'ice')
  assert.ok(errors.some((message) => message.includes('降雨事件')))
  assert.ok(errors.some((message) => message.includes('冰裂事件')))
})

test('absolute time axis derives labels from the selected query time', () => {
  const scenario = createDefaultNoiseScenario(4, 3, 'normal')
  scenario.timeAxis = 'absolute'
  const model = buildNoiseTimeFrequency({
    scenario,
    queryTime: '2025-01-02T12:00:00',
    maxFreq: 200,
  })
  assert.match(model.timeLabels[0], /12:00:00/)
  assert.match(model.displayTimes.at(-1), /12:01:00/)
})

test('keeps a configured frequency ceiling above 1 kHz', () => {
  const model = buildNoiseTimeFrequency({
    scenario: createDefaultNoiseScenario(4, 3, 'normal'),
    maxFreq: 2000,
  })
  assert.equal(model.maxFreq, 2000)
  assert.ok(Math.abs(model.freqs.at(-1) - 2000) < 1e-6)
})
