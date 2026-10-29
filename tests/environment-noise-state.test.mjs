import test from 'node:test'
import assert from 'node:assert/strict'

const { latestEnvironmentNoise, publishEnvironmentNoise } = await import(
  '../src/modules/array-fusion/environmentNoiseState.js'
)

test('environment noise time-frequency result is normalized for array-channel reuse', () => {
  const published = publishEnvironmentNoise({
    timeFrequency: {
      time: [0, 1],
      frequency: [100, 200],
      psd: [[60, 61], [62, 63]],
    },
  }, { receiverX: 120, receiverY: 30, depth: 80, time: '2026-10-22 12:00:00' }, 'normal')
  assert.equal(published, true)
  assert.deepEqual(latestEnvironmentNoise.value.frequency_hz, [100, 200])
  assert.deepEqual(latestEnvironmentNoise.value.psd_db[1], [62, 63])
  assert.equal(latestEnvironmentNoise.value.source, '环境噪声接口时频结果')
})
