import { postJson } from './httpClient.js'
import { portalApiUrl } from '../config/runtimeConfig.js'

export function communicationApiUrl() {
  return new URL('array-channel/communication', portalApiUrl()).toString()
}

export async function calculateStaticCommunication(payload) {
  const { response, data } = await postJson(communicationApiUrl(), payload, { timeoutMs: 180_000 })
  if (!response.ok) {
    const message = data?.detail || data?.message || `完整通信接口 HTTP ${response.status}`
    throw new Error(message)
  }
  if (!data || data.type !== 'communication_study_resp') {
    throw new Error('完整通信接口返回格式无效')
  }
  return data
}
