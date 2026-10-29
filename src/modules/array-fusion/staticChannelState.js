import { ref, shallowRef } from 'vue'

// 静态信道与完整通信在同一前端模块内切换。用轻量会话状态保留最近一次
// array_fusion_service 结果，避免复制大体积声场网格或重复运行 Bellhop。
export const latestStaticChannel = shallowRef(null)
export const latestStaticElementIndex = ref(0)

export function publishStaticChannel(channel, elementIndex = 0) {
  if (!channel || channel.type !== 'static_channel_resp') return
  latestStaticChannel.value = channel
  const maximum = Math.max(0, Number(channel.elements?.length ?? 1) - 1)
  latestStaticElementIndex.value = Math.min(maximum, Math.max(0, Number(elementIndex) || 0))
}

export function selectStaticElement(elementIndex) {
  latestStaticElementIndex.value = Math.max(0, Number(elementIndex) || 0)
}
