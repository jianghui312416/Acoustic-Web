import { shallowRef } from 'vue'

// 完整通信页面可能因模块切换而卸载；在会话级保存最近结果及其来源信道，
// 这样返回页面时仍能查看旧结果，并能判断静态信道是否已经发生变化。
export const latestCommunicationResult = shallowRef(null)
export const latestCommunicationSourceKey = shallowRef('')

export function staticCommunicationSourceKey(channel, elementIndex = 0) {
  if (!channel) return ''
  const array = channel.array ?? {}
  return [
    channel.bellhop_job_id ?? '',
    channel.ray_job_id ?? '',
    channel.arrival_job_id ?? '',
    channel.impulse_response?.native_arrivals_used ? 'native-arrivals' : 'geometry-fallback',
    Number(array.center_range_km ?? 0).toFixed(6),
    Number(array.depth_m ?? 0).toFixed(3),
    Number(array.center_lon ?? 0).toFixed(7),
    Number(array.center_lat ?? 0).toFixed(7),
    Number(elementIndex) || 0,
  ].join('|')
}

export function publishCommunicationResult(result, sourceKey) {
  if (!result || result.type !== 'communication_study_resp') return
  latestCommunicationResult.value = result
  latestCommunicationSourceKey.value = String(sourceKey || '')
}
