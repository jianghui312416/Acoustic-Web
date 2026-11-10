import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  applyHydrophonePreampDefaults,
  combinedTonePreviewDurationS,
  normalizeSignalTransmissionControls,
  parseFrequencyHz,
  signalTransmissionControls,
} from '../src/modules/acoustic/signalTransmissionControls.js'

const controlsComponent = fs.readFileSync(
  new URL('../src/components/acoustic/SignalTransmissionControls.vue', import.meta.url),
  'utf8',
)

test('signal transmission defaults include source level, frequencies and navigation depth', () => {
  assert.equal(signalTransmissionControls.sourceLevelDb, 105)
  assert.deepEqual(signalTransmissionControls.frequenciesHz, [84, 126])
  assert.equal(signalTransmissionControls.frequencyHzText, '84, 126')
  assert.equal(signalTransmissionControls.navigationDepthM, 150)
  assert.equal(signalTransmissionControls.receiverDepthM, 30)
  assert.equal(signalTransmissionControls.propagationModel, 'bellhop')
  assert.equal(signalTransmissionControls.hydrophone, 'BK-8103')
  assert.equal(signalTransmissionControls.adcBits, 24)
  assert.equal(signalTransmissionControls.showSourceTimeFrequency, false)
  assert.equal(signalTransmissionControls.showSourceWaveform, false)
  assert.equal(signalTransmissionControls.spectrogramFrequencyScale, 'linear')
})

test('signal transmission accepts multiple frequencies separated by commas or spaces', () => {
  assert.deepEqual(parseFrequencyHz('84, 126'), [84, 126])
  assert.deepEqual(parseFrequencyHz('100 200，300'), [100, 200, 300])
  assert.deepEqual(parseFrequencyHz('84, 84, 126'), [84, 126])
  assert.deepEqual(parseFrequencyHz(''), [])
})

test('dual-tone preview spans two periods of the combined repeating waveform', () => {
  assert.ok(Math.abs(combinedTonePreviewDurationS([84, 126]) - 2 / 42) < 1e-12)
  assert.ok(Math.abs(combinedTonePreviewDurationS([100]) - 2 / 100) < 1e-12)
})

test('normalization keeps valid frequencies and clamps navigation depth', () => {
  const controls = {
    ...signalTransmissionControls,
    frequencyHzText: '90, 180',
    navigationDepthM: -20,
  }
  normalizeSignalTransmissionControls(controls)
  assert.deepEqual(controls.frequenciesHz, [90, 180])
  assert.equal(controls.frequencyHzText, '90, 180')
  assert.equal(controls.navigationDepthM, 0)
})

test('normalization keeps display window independent from backend sample budget', () => {
  const controls = {
    ...signalTransmissionControls,
    sampleRate: 96000,
    simulationDurationS: 120,
    propagationModel: 'unknown',
    adcBits: 12,
    spectrogramFrequencyScale: 'unknown',
  }
  normalizeSignalTransmissionControls(controls)
  assert.equal(controls.simulationDurationS, 120)
  assert.equal(controls.propagationModel, 'bellhop')
  assert.equal(controls.adcBits, 24)
  assert.equal(controls.spectrogramFrequencyScale, 'linear')
})

test('hydrophone types match the referenced curve files and fall back to B&K 8103', () => {
  for (const hydrophone of ['BK-8103', 'BK-8106', 'RESON-TC4013']) {
    const controls = { ...signalTransmissionControls, hydrophone }
    normalizeSignalTransmissionControls(controls)
    assert.equal(controls.hydrophone, hydrophone)
  }
  const controls = { ...signalTransmissionControls, hydrophone: 'HTI-96-MIN' }
  normalizeSignalTransmissionControls(controls)
  assert.equal(controls.hydrophone, 'BK-8103')
})

test('B&K 8106 starts with zero additional gain and restores external gain for other hydrophones', () => {
  const controls = { ...signalTransmissionControls, hydrophone: 'BK-8106', preampGainDb: 8 }
  const savedGain = applyHydrophonePreampDefaults(controls, 'BK-8103', 6)
  assert.equal(savedGain, 8)
  assert.equal(controls.preampGainDb, 0)

  controls.preampGainDb = 3
  controls.hydrophone = 'RESON-TC4013'
  applyHydrophonePreampDefaults(controls, 'BK-8106', savedGain)
  assert.equal(controls.preampGainDb, 8)
})

test('frequency settings are followed by a source waveform preview for manual and AIS sources', () => {
  const frequencyInput = controlsComponent.indexOf('aria-label="频率设置"')
  const preview = controlsComponent.indexOf('aria-label="发射信号时域图预览"')
  assert.ok(frequencyInput >= 0)
  assert.ok(preview > frequencyInput)
  assert.match(controlsComponent, /estimateJomopansEchoSpectrum\(selectedVessel\.value\)/)
  assert.match(controlsComponent, /state\.frequenciesHz/)
  assert.match(controlsComponent, /state\.sourceLevelDb/)
  assert.match(controlsComponent, /const waveformChart = computed/)
  assert.match(controlsComponent, /Math\.sin\(/)
  assert.match(controlsComponent, /frequencies\.length === 2/)
  assert.match(controlsComponent, /双频/)
  assert.match(controlsComponent, /combinedTonePreviewDurationS\(frequencies, 2\)/)
  assert.match(controlsComponent, /2个重复周期/)
  assert.match(controlsComponent, /class="st-waveform-line"/)
})

test('propagation and multipath settings are collapsed by default', () => {
  assert.match(controlsComponent, /<details class="st-advanced">\s*<summary>传播与多途<\/summary>/)
})
