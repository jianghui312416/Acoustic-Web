import { ref, shallowRef } from 'vue'

// 水声传播与水声通信之间的轻量联动状态。这里只保存任务号、计算参数和
// 接收阵中心，不复制二维声场的大体积网格数据。
export const latestPropagationLink = shallowRef(null)
export const propagationLinkVersion = ref(0)

function nextVersion() {
  propagationLinkVersion.value += 1
}

export function publishPropagationLink(link) {
  if (!link?.source) return false
  latestPropagationLink.value = {
    ...link,
    receiver: link.receiver ? { ...link.receiver } : null,
    source: { ...link.source },
    portalParams: link.portalParams ? { ...link.portalParams } : null,
    updatedAt: Date.now(),
  }
  nextVersion()
  return true
}

export function annotatePropagationReceiver(receiver) {
  if (!latestPropagationLink.value || !receiver) return false
  latestPropagationLink.value = {
    ...latestPropagationLink.value,
    receiver: { ...receiver },
    updatedAt: Date.now(),
  }
  nextVersion()
  return true
}

export function clearPropagationLink() {
  latestPropagationLink.value = null
  nextVersion()
}
