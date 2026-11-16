import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVesselReceiveSpectrogram,
  buildSelectedVesselRoute,
  distancePerMinuteM,
  greatCircleDistanceM,
  initialBearingDeg,
  resampleTrackByDistance,
  resolveVesselSimulationProfile,
  routeDurationSeconds,
  spectrogramPressureSeries,
  routeSampleIndexAtTime,
  sampleReceiverTlDb,
  SELECTED_VESSEL_MAX_RANGE_NM,
} from '../src/utils/vesselNoiseSimulation.js'

test('builds a selected AIS vessel route along COG with a one nautical mile limit', () => {
  const route = buildSelectedVesselRoute({
    longitude: 114,
    latitude: 22,
    cog_deg: 90,
    heading_deg: 180,
    sog_kn: 12,
  })
  assert.equal(route.length, 2)
  assert.ok(Math.abs(initialBearingDeg(route[0], route[1]) - 90) < 1e-6)
  assert.ok(Math.abs(greatCircleDistanceM(route[0], route[1]) - SELECTED_VESSEL_MAX_RANGE_NM * 1852) < 1e-5)
})

test('falls back to AIS heading and rejects a vessel without a usable direction', () => {
  const route = buildSelectedVesselRoute({
    longitude: 114,
    latitude: 22,
    cog_deg: 511,
    heading_deg: 315,
  })
  assert.equal(route.length, 2)
  assert.ok(Math.abs(initialBearingDeg(route[0], route[1]) - 315) < 1e-6)
  assert.deepEqual(buildSelectedVesselRoute({ longitude: 114, latitude: 22 }), [])
})

test('a single route point produces one fixed source field station', () => {
  assert.deepEqual(resampleTrackByDistance([{ lon: 116, lat: 16 }], 1000), [
    { lon: 116, lat: 16, index: 0, distanceM: 0, distanceKm: 0 },
  ])
})

test('integrates spectrogram PSD into RMS sound pressure in Pa', () => {
  const pressure = spectrogramPressureSeries({
    times: [0, 1],
    frequencies: [100, 200],
    data: [[0, 0, 60], [0, 1, 60], [1, 0, 40], [1, 1, 40]],
  })
  assert.equal(pressure.times.length, 2)
  assert.ok(Math.abs(pressure.rmsPa[0] - 0.01) < 1e-10)
  assert.ok(Math.abs(pressure.rmsPa[1] - 0.001) < 1e-10)
})

test('uses AIS speed when a vessel is selected and manual speed otherwise', () => {
  const selected = resolveVesselSimulationProfile({ mmsi: 123, sog_kn: 14.2 }, 8)
  const manual = resolveVesselSimulationProfile(null, 9.5)
  assert.equal(selected.sog_kn, 14.2)
  assert.equal(selected.speedSource, 'ais')
  assert.equal(manual.sog_kn, 9.5)
  assert.equal(manual.speedSource, 'manual')
})

test('resamples a picked vessel route at one kilometre stations and preserves the endpoint', () => {
  const samples = resampleTrackByDistance([{ lon: 114, lat: 22 }, { lon: 114.03, lat: 22 }], 1000)
  assert.equal(samples[0].distanceM, 0)
  assert.ok(samples.length >= 4)
  assert.ok(samples.slice(1, -1).every((sample, index) => Math.abs(sample.distanceM - (index + 1) * 1000) < 1e-6))
  assert.ok(Math.abs(samples.at(-1).lon - 114.03) < 1e-8)
  assert.equal(routeSampleIndexAtTime(samples, 0, 60), 0)
  assert.equal(routeSampleIndexAtTime(samples, 60, 60), samples.length - 1)
})

test('builds one field station per minute from vessel speed', () => {
  const spacingM = distancePerMinuteM(12)
  assert.ok(Math.abs(spacingM - 370.4) < 1e-9)
  const samples = resampleTrackByDistance([{ lon: 114, lat: 22 }, { lon: 114.02, lat: 22 }], spacingM)
  const durationS = routeDurationSeconds(samples, 12)
  assert.equal(routeSampleIndexAtTime(samples, 59.9, durationS), 0)
  assert.equal(routeSampleIndexAtTime(samples, 60, durationS), 1)
  assert.ok(durationS > 300)
})

test('uses compass bearings and nearest receiver range/depth to sample Bellhop TL', () => {
  const field = {
    grid: { sector: 4, row: 2, col: 3, compassBearings: [0, 90, 180, 270], depth: [10, 30], distance: [0, 1000, 2000] },
    at(sector, depth, distance) { return sector * 10 + depth * 3 + distance + 60 },
  }
  assert.equal(Math.round(initialBearingDeg({ lon: 114, lat: 22 }, { lon: 115, lat: 22 })), 90)
  assert.equal(sampleReceiverTlDb(field, { bearingDeg: 92, distanceM: 1100, depthM: 28 }), 74)
})

test('hydrophone spectrogram power-sums JOMOPANS receive PSD and environmental background', () => {
  const samples = [{ distanceM: 0 }, { distanceM: 1000 }]
  const result = buildVesselReceiveSpectrogram({
    samples,
    durationS: 10,
    sourceSpectrum: { frequenciesHz: [100, 1000], spectralDensityDb: [160, 150] },
    receiverTlDb: [80, 90],
    receiverDistancesM: [1000, 2000],
    referenceFrequencyHz: 100,
    backgroundFrequencyHz: [100, 1000],
    backgroundSpectrumDb: [50, 40],
    timeCount: 3,
    frequencyCount: 32,
  })
  assert.equal(result.data.length, 96)
  assert.equal(result.calculatedCount, 2)
  const firstMean = result.data.filter(item => item[0] === 0).reduce((sum, item) => sum + item[2], 0) / 32
  const lastMean = result.data.filter(item => item[0] === 2).reduce((sum, item) => sum + item[2], 0) / 32
  assert.ok(firstMean > lastMean)
  assert.ok(result.maxDb > result.minDb)
})

test('fixed display frequency bounds preserve narrowband signal energy', () => {
  const result = buildVesselReceiveSpectrogram({
    samples: [{ distanceM: 0 }],
    durationS: 30,
    sourceSpectrum: {
      narrowband: true,
      frequenciesHz: [84, 126],
      spectralDensityDb: [105, 105],
    },
    receiverTlDb: [0],
    receiverDistancesM: [0],
    backgroundFrequencyHz: [20, 24000],
    backgroundSpectrumDb: [-300, -300],
    minimumFrequencyHz: 20,
    maximumFrequencyHz: 24000,
    timeCount: 3,
    frequencyCount: 112,
  })
  assert.equal(result.frequencies[0], 20)
  assert.ok(Math.abs(result.frequencies.at(-1) - 24000) < 1e-8)
  const nearestIndex = target => result.frequencies.reduce((best, frequency, index) => (
    Math.abs(frequency - target) < Math.abs(result.frequencies[best] - target) ? index : best
  ), 0)
  const meanAtFrequency = index => {
    const values = result.data.filter(item => item[1] === index).map(item => item[2])
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  assert.ok(meanAtFrequency(nearestIndex(84)) > meanAtFrequency(nearestIndex(1000)) + 20)
})

test('plays stochastic environmental noise before vessel noise enters after the pre-roll', () => {
  const result = buildVesselReceiveSpectrogram({
    samples: [{ distanceM: 0 }, { distanceM: 1000 }],
    durationS: 20,
    routeDurationS: 10,
    preRollS: 10,
    sourceSpectrum: { frequenciesHz: [100, 1000], spectralDensityDb: [160, 150] },
    receiverTlDb: [80, 80],
    receiverDistancesM: [1000, 1000],
    backgroundFrequencyHz: [100, 1000],
    backgroundSpectrumDb: [50, 40],
    timeCount: 5,
    frequencyCount: 32,
  })
  const meanAt = timeIndex => {
    const values = result.data.filter(item => item[0] === timeIndex)
    return values.reduce((sum, item) => sum + item[2], 0) / values.length
  }
  assert.equal(result.preRollS, 10)
  assert.ok(meanAt(0) < meanAt(4) - 15)
  assert.notEqual(result.data[0][2], result.data[32][2])
  assert.ok(result.acousticProfile.bladePassFrequencyHz > result.acousticProfile.shaftRateHz)
})

test('keeps the stochastic hydrophone texture continuous for one seed and varies another run', () => {
  const options = {
    samples: [{ distanceM: 0 }, { distanceM: 1000 }],
    durationS: 30,
    sourceSpectrum: {
      vesselClass: 'recreational',
      modelSpeedKn: 20,
      referenceSpeedKn: 10.6,
      frequenciesHz: [20, 20000],
      spectralDensityDb: [165, 125],
    },
    receiverTlDb: [75, 82],
    receiverDistancesM: [500, 1500],
    backgroundFrequencyHz: [20, 20000],
    backgroundSpectrumDb: [70, 25],
    timeCount: 31,
    frequencyCount: 64,
  }
  const first = buildVesselReceiveSpectrogram({ ...options, textureSeed: 1234 })
  const repeated = buildVesselReceiveSpectrogram({ ...options, textureSeed: 1234 })
  const different = buildVesselReceiveSpectrogram({ ...options, textureSeed: 5678 })
  assert.deepEqual(first.data, repeated.data)
  assert.notDeepEqual(first.data, different.data)
  assert.ok(first.acousticProfile.bladeCount >= 3 && first.acousticProfile.bladeCount <= 5)
  assert.ok(first.acousticProfile.resonanceFrequenciesHz.length === 3)
  assert.ok(first.acousticProfile.swellFrequencyHz >= 0.05)
  assert.ok(first.acousticProfile.swellFrequencyHz <= 0.15)
  const bpfIndex = first.frequencies.reduce((best, frequency, index) => (
    Math.abs(frequency - first.acousticProfile.bladePassFrequencyHz)
      < Math.abs(first.frequencies[best] - first.acousticProfile.bladePassFrequencyHz)
      ? index
      : best
  ), 0)
  const meanAtFrequency = index => {
    const values = first.data.filter(item => item[1] === index).map(item => item[2])
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const comparisonIndex = Math.min(first.frequencies.length - 1, bpfIndex + 2)
  assert.ok(meanAtFrequency(bpfIndex) > meanAtFrequency(comparisonIndex) + 1)
})

test('does not treat uncalculated null Bellhop stations as zero-loss measurements', () => {
  const result = buildVesselReceiveSpectrogram({
    samples: [{ distanceM: 0 }, { distanceM: 1000 }],
    sourceSpectrum: { frequenciesHz: [100], spectralDensityDb: [160] },
    receiverTlDb: [80, null],
    receiverDistancesM: [1000, 2000],
    backgroundFrequencyHz: [100],
    backgroundSpectrumDb: [50],
  })
  assert.equal(result.calculatedCount, 1)
  assert.ok(result.data.every(item => item[2] < 100))
})
