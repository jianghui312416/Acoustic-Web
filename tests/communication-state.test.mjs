import test from 'node:test'
import assert from 'node:assert/strict'

import {
  latestCommunicationResult,
  latestCommunicationSourceKey,
  publishCommunicationResult,
  staticCommunicationSourceKey,
} from '../src/modules/array-fusion/communicationState.js'

test('keeps the last communication result and detects receiver-channel changes', () => {
  const channel = {
    bellhop_job_id: 'tl_job',
    ray_job_id: 'ray_job',
    arrival_job_id: 'arrival_job',
    impulse_response: { native_arrivals_used: true },
    array: {
      center_range_km: 12.5,
      depth_m: 80,
      center_lon: 114.06,
      center_lat: 13.78,
    },
  }
  const sourceKey = staticCommunicationSourceKey(channel, 0)
  const result = { type: 'communication_study_resp', link_metrics: { current_ber: 1e-3 } }

  publishCommunicationResult(result, sourceKey)

  assert.equal(latestCommunicationResult.value, result)
  assert.equal(latestCommunicationSourceKey.value, sourceKey)
  assert.notEqual(
    staticCommunicationSourceKey({
      ...channel,
      array: { ...channel.array, center_range_km: 13.0 },
    }, 0),
    sourceKey,
  )
  assert.notEqual(staticCommunicationSourceKey(channel, 1), sourceKey)
  assert.notEqual(
    staticCommunicationSourceKey({
      ...channel,
      impulse_response: { native_arrivals_used: false },
    }, 0),
    sourceKey,
  )
})
