import { postJson } from './httpClient.js'
import { portalApiUrl } from '../config/runtimeConfig.js'

export function staticChannelApiUrl() {
  return new URL('array-channel/static', portalApiUrl()).toString()
}

export async function calculateStaticArrayChannel(payload) {
  const { response, data } = await postJson(staticChannelApiUrl(), payload)
  if (!response.ok) {
    const message = data?.detail || data?.message || `静态信道接口 HTTP ${response.status}`
    throw new Error(message)
  }
  if (!data || data.type !== 'static_channel_resp') {
    throw new Error('静态信道接口返回格式无效')
  }
  return data
}
