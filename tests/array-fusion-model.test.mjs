import test from 'node:test'
import assert from 'node:assert/strict'

const {
  createDemoFrame,
  createScenarioHistory,
  createScenarioState,
  createLiveSpectrogram,
  createSpectrogram,
  mergeRemoteFrame,
  normalizeFusionFrame,
  wrapBearing,
} = await import('../src/modules/array-fusion/arrayFusionModel.js')

test('demo frame keeps all linked-domain values within display ranges', () => {
  const frame = createDemoFrame(64, { centerFrequency: 1200, threshold: 6 })
  assert.equal(frame.curve.length, 121)
  assert.ok(frame.trueBearing >= -90 && frame.trueBearing <= 90)
  assert.ok(frame.peakBearing >= -90 && frame.peakBearing <= 90)
  assert.ok(frame.rangeKm > 0)
  assert.equal(frame.detected, frame.snr >= 6)
})

test('demo CIR and receive beam output evolve with motion time', () => {
  const first = createDemoFrame(10, { centerFrequency: 1000 })
  const later = createDemoFrame(10.2, { centerFrequency: 1000 })
  assert.notDeepEqual(first.impulseResponse, later.impulseResponse)
  assert.notDeepEqual(first.beamOutput, later.beamOutput)
  assert.ok(first.impulseResponse.every((tap) => Number.isFinite(tap.gain_real) && Number.isFinite(tap.gain_imag)))
})

test('switching the observed element updates only element-scoped demo domains', () => {
  const first = createDemoFrame(10, { centerFrequency: 1000, nElem: 16, selectedElement: 1 })
  const last = createDemoFrame(10, { centerFrequency: 1000, nElem: 16, selectedElement: 16 })
  assert.equal(first.selectedElement, 0)
  assert.equal(last.selectedElement, 15)
  assert.notDeepEqual(first.waveform, last.waveform)
  assert.notDeepEqual(first.elementSpectrum, last.elementSpectrum)
  assert.notDeepEqual(first.impulseResponse, last.impulseResponse)
  assert.deepEqual(first.spectrum, last.spectrum)
  assert.deepEqual(first.curve, last.curve)
  assert.deepEqual(first.beamOutput, last.beamOutput)
})

test('platform, array and independent target tracks evolve together', () => {
  const start = createScenarioState(12, 'alpha')
  const later = createScenarioState(82, 'alpha')
  const bravo = createScenarioState(82, 'bravo')
  assert.notEqual(start.platform.eastKm, later.platform.eastKm)
  assert.notEqual(start.array.eastKm, later.array.eastKm)
  assert.notDeepEqual(later.target, bravo.target)
  assert.ok(Number.isFinite(later.radialSpeedMps))
  assert.ok(later.trueBearing >= -90 && later.trueBearing <= 90)
  const history = createScenarioHistory(50, 'alpha')
  assert.ok(history.length > 10)
  assert.notEqual(history[0].target.eastKm, history.at(-1).target.eastKm)
})

test('configured globe routes drive platform and target positions', () => {
  const options = {
    duration: 100,
    platformRoute: [{ eastKm: 0, northKm: 0 }, { eastKm: 20, northKm: 0 }],
    targetRoute: [{ eastKm: 30, northKm: 40 }, { eastKm: 10, northKm: 40 }],
    platformSpeedKnots: 12,
    targetSpeedKnots: 18,
  }
  const middle = createScenarioState(50, 'alpha', options)
  assert.ok(Math.abs(middle.platform.eastKm - 0.3086664) < 0.001)
  assert.ok(Math.abs(middle.target.eastKm - 29.5370004) < 0.001)
  assert.equal(middle.platform.speedKnots, 12)
  assert.equal(middle.target.speedKnots, 18)
  assert.ok(Math.abs(middle.array.eastKm - middle.platform.eastKm) > 0)
})

test('heading mode uses speed, heading and tow length as physical motion inputs', () => {
  const state = createScenarioState(100, 'alpha', {
    motionMode: 'heading',
    platformRoute: [{ eastKm: 0, northKm: 0 }],
    targetRoute: [{ eastKm: 10, northKm: 10 }],
    platformSpeedKnots: 10,
    targetSpeedKnots: 0,
    platformHeadingDeg: 90,
    targetHeadingDeg: 180,
    towLengthM: 500,
  })
  assert.ok(Math.abs(state.platform.eastKm - 0.514444) < 0.001)
  assert.ok(Math.abs(Math.hypot(
    state.array.eastKm - state.platform.eastKm,
    state.array.northKm - state.platform.northKm,
  ) - 0.5) < 0.001)
})

test('spectrogram produces a complete deterministic heatmap matrix', () => {
  const spectrogram = createSpectrogram(30, { columns: 12, rows: 8 })
  assert.equal(spectrogram.data.length, 96)
  assert.equal(spectrogram.times.length, 12)
  assert.equal(spectrogram.frequencies.length, 8)
  assert.deepEqual(spectrogram, createSpectrogram(30, { columns: 12, rows: 8 }))
})

test('remote frames are normalized and merged with locally derived domains', () => {
  const fallback = createDemoFrame(10)
  const remote = mergeRemoteFrame({ t: 2, az_true: -12, az_peak: -10, range_km: 31, snr: 9, detected: true }, fallback)
  assert.equal(remote.trueBearing, -12)
  assert.equal(remote.peakBearing, -10)
  assert.equal(remote.rangeKm, 31)
  assert.equal(remote.curve.length, fallback.curve.length)
  assert.equal(remote.waveform.length, fallback.waveform.length)
  assert.equal(remote.beamOutput.length, fallback.beamOutput.length)
  assert.equal(remote.impulseResponse.length, fallback.impulseResponse.length)
  assert.equal(normalizeFusionFrame({ az: 120 }).trueBearing, 90)
  const normalizedAgain = normalizeFusionFrame(normalizeFusionFrame({ az_true: -23, az_peak: -21 }))
  assert.equal(normalizedAgain.trueBearing, -23)
  assert.equal(normalizedAgain.peakBearing, -21)
  assert.equal(wrapBearing(190), -170)
  const sixDomains = normalizeFusionFrame({
    signal: {
      time_ms: [0, 1], waveform: [0.1, -0.1],
      frequencies_hz: [100, 200], spectrum_db: [-60, -30],
    },
    channel: { doppler_hz: -2, per_element_tl_db: [80, 81], impulse_response: { taps: [{ magnitude: 1 }] } },
    beam: { output_time_ms: [0, 1], output_waveform: [0.2, 0.1] },
  })
  assert.deepEqual(sixDomains.waveform, [0.1, -0.1])
  assert.deepEqual(sixDomains.elementSpectrum, [-60, -30])
  assert.equal(sixDomains.impulseResponse.length, 1)
  assert.equal(sixDomains.dopplerHz, -2)
  const selectedElement = normalizeFusionFrame({
    selected_element: 1,
    kinematics: {
      platform: { heading_deg: 92 },
      source: { heading_deg: 181 },
      relative: { arrival_bearing_deg: 238.5, broadside_angle_deg: 58.5 },
    },
    channel: {
      selected_element: 1,
      per_element_tl_db: [70, 72],
      elements: [
        { element_index: 0, transmission_loss_db: 70, path_count: 2 },
        { element_index: 1, transmission_loss_db: 72, path_count: 4 },
      ],
    },
  })
  assert.equal(selectedElement.selectedElementTl, 72)
  assert.equal(selectedElement.selectedElementPathCount, 4)
  assert.equal(selectedElement.platformHeading, 92)
  assert.equal(selectedElement.relativeBearing, 238.5)
})

test('live spectrum rows are converted to a linked time-frequency heatmap', () => {
  const live = createLiveSpectrogram([
    { time: 1, frequencies: [100, 200], spectrum: [-60, -40] },
    { time: 1.2, frequencies: [100, 200], spectrum: [-58, -35] },
  ])
  assert.deepEqual(live.times, [1, 1.2])
  assert.deepEqual(live.frequencies, [100, 200])
  assert.deepEqual(live.data, [[0, 0, -60], [0, 1, -40], [1, 0, -58], [1, 1, -35]])
})
