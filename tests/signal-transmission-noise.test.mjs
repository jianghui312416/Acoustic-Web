import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  backendSpectrogramMatrix,
  backendWaveformSeries,
  forecastNoiseSpectrum,
  loadPositionNoiseSpectra,
  rollingBackendSpectrogramMatrix,
  rollingBackendWaveformSeries,
} from '../src/modules/acoustic/signalTransmissionNoise.js'

const acousticFieldView = fs.readFileSync(
  new URL('../src/views/AcousticFieldView.vue', import.meta.url),
  'utf8',
)

test('complete transmission asks the backend for Wenz background noise', () => {
  const requestBlock = acousticFieldView.slice(
    acousticFieldView.indexOf('runSignalTransmissionSession({'),
    acousticFieldView.indexOf('lastSignalFieldRequestId = requestId'),
  )
  assert.match(requestBlock, /noise_model:\s*'wenz'/)
  assert.doesNotMatch(requestBlock, /noise_model:\s*'white'/)
  assert.doesNotMatch(requestBlock, /receiver_noise_spectrum/)
})

test('forecast noise spectrum uses the selected frame and location', () => {
  const result = {
    model: 'Wenz test',
    frequency_hz: [10, 100],
    frames: [
      { time: 't0', varying_components_db: { total: [40, 30] } },
      { time: 't1', varying_components_db: { total: [45, 35] } },
    ],
  }
  assert.deepEqual(forecastNoiseSpectrum(result, 1, { lon: 116, lat: 16 }), {
    frequency_hz: [10, 100], psd_db: [45, 35], model: 'Wenz test',
    query_time: 't1', lon: 116, lat: 16,
  })
})

test('position spectra are cached by coordinate while preserving route order', async () => {
  let calls = 0
  const spectra = await loadPositionNoiseSpectra([
    { lon: 116, lat: 16 }, { lon: 116.1, lat: 16.1 }, { lon: 116, lat: 16 },
  ], {
    ais: { vessels: [] },
    analyse: async ({ coordX }) => {
      calls += 1
      return {
        frequency_hz: [10, 100],
        frames: [{ time: 't0', varying_components_db: { total: [coordX, coordX + 1] } }],
      }
    },
  })
  assert.equal(calls, 2)
  assert.equal(spectra.length, 3)
  assert.deepEqual(spectra[0], spectra[2])
})

test('backend spectrogram converts frequency rows into drawable cells', () => {
  const matrix = backendSpectrogramMatrix({
    time_s: [0, 1], frequency_hz: [10, 20], dbfs_per_hz: [[-80, -70], [-60, -50]],
  })
  assert.equal(matrix.data.length, 4)
  assert.equal(matrix.minDb, -80)
  assert.equal(matrix.maxDb, -50)
})

test('backend waveform keeps aligned finite time and pressure samples', () => {
  assert.deepEqual(backendWaveformSeries({
    time_s: [0, 0.5, 1, 1.5], values: [1e-6, -2e-6, Number.NaN, 4e-6, 9e-6],
  }), {
    times: [0, 0.5, 1.5], values: [1e-6, -2e-6, 4e-6],
  })
  assert.deepEqual(backendWaveformSeries(null), { times: [], values: [] })
})

test('continuous backend samples are never repeated beyond their recorded time', () => {
  const wave = rollingBackendWaveformSeries({continuous: true, times: [0, 1, 2], values: [10, 20, 30]}, 5, 2)
  assert.deepEqual(wave.values, [])
  const matrix = rollingBackendSpectrogramMatrix({continuous: true, times: [0, 1, 2], frequencies: [0, 100],
    data: [[0, 0, 1], [1, 0, 2], [2, 0, 3]], minDb: 0, maxDb: 3}, 5, 2)
  assert.deepEqual(matrix.data, [])
})

test('backend plots advance through a rolling window without synthesizing samples', () => {
  const waveform = rollingBackendWaveformSeries({
    times: [0, 1, 2], values: [10, 20, 30],
  }, 3, 2)
  assert.deepEqual(waveform.times, [1, 2, 3])
  assert.deepEqual(waveform.values, [20, 30, 10])
  assert.equal(waveform.windowStartS, 1)
  assert.equal(waveform.windowEndS, 3)

  const matrix = rollingBackendSpectrogramMatrix({
    times: [0, 1, 2], frequencies: [0, 2000, 4000],
    data: [[0, 0, -90], [1, 1, -60], [2, 2, -30]], minDb: -90, maxDb: -30,
  }, 3, 2)
  assert.deepEqual(matrix.times, [1, 2, 3])
  assert.deepEqual(matrix.frequencies, [0, 2000, 4000])
  assert.deepEqual(matrix.data, [[0, 1, -60], [1, 2, -30], [2, 0, -90]])
})

test('rolling spectrogram fills every canvas column after irregular backend downsampling', () => {
  // scipy 的规则时频列经 linspace 抽取后可能交替跨 1 或 2 个原始步长。
  const times = Array.from({ length: 200 }, (_, index) => (
    Math.floor(index * 256 / 199)
  ))
  const frequencies = [0, 1000, 2000]
  const data = []
  for (let timeIndex = 0; timeIndex < times.length; timeIndex += 1) {
    for (let frequencyIndex = 0; frequencyIndex < frequencies.length; frequencyIndex += 1) {
      data.push([timeIndex, frequencyIndex, -80 + frequencyIndex])
    }
  }
  const matrix = rollingBackendSpectrogramMatrix({
    times, frequencies, data, minDb: -80, maxDb: -70,
  }, 256, 256)
  const cells = new Set(matrix.data.map(entry => `${entry[0]}:${entry[1]}`))
  assert.equal(cells.size, matrix.times.length * frequencies.length)
  for (let timeIndex = 0; timeIndex < matrix.times.length; timeIndex += 1) {
    assert.equal(
      matrix.data.filter(entry => entry[0] === timeIndex).length,
      frequencies.length,
    )
  }
})
