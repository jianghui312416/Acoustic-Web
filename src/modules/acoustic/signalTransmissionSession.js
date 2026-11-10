import { reactive } from 'vue'
import { createSignalTransmissionSocket } from '@/api/signalTransmissionSocket.js'

export const signalTransmissionSession = reactive({
  state: 'idle',
  phase: '',
  percent: 0,
  message: '',
  error: '',
  result: null,
  requestId: '',
  /** 前端实时航迹播放是否仍在运行（WebSocket 计算完成后仍可能继续播放）。 */
  playbackActive: false,
})

let activeSocket = null
let generation = 0

export function resetSignalTransmissionSession() {
  stopSignalTransmissionSession({ preserveResult: false })
}

export function stopSignalTransmissionSession({ preserveResult = true } = {}) {
  activeSocket?.close()
  activeSocket = null
  generation += 1
  const result = preserveResult ? signalTransmissionSession.result : null
  Object.assign(signalTransmissionSession, {
    state: 'idle', phase: '', percent: 0, message: '', error: '', result, requestId: '', playbackActive: false,
  })
}

export function runSignalTransmissionSession(request) {
  activeSocket?.close()
  const currentGeneration = ++generation
  const requestId = String(request?.request_id || `signal-${Date.now()}-${generation}`)
  Object.assign(signalTransmissionSession, {
    state: 'connecting',
    phase: 'connect',
    percent: 0,
    message: '正在连接信号传输服务…',
    error: '',
    result: null,
    requestId,
    playbackActive: true,
  })
  activeSocket = createSignalTransmissionSocket({
    onReady() {
      if (currentGeneration !== generation) return
      signalTransmissionSession.state = 'running'
      signalTransmissionSession.message = '正在提交发射参数…'
      if (!activeSocket?.simulate({ ...request, request_id: requestId })) {
        signalTransmissionSession.state = 'error'
        signalTransmissionSession.error = '信号传输请求发送失败。'
      }
    },
    onProgress(event) {
      if (currentGeneration !== generation) return
      signalTransmissionSession.state = event.phase === 'complete' ? 'finalizing' : 'running'
      signalTransmissionSession.phase = event.phase || ''
      signalTransmissionSession.percent = Number(event.percent) || 0
      signalTransmissionSession.message = event.message || ''
    },
    onResult(result) {
      if (currentGeneration !== generation) return
      Object.assign(signalTransmissionSession, {
        state: 'complete',
        phase: 'complete',
        percent: 100,
        message: '发射—传播—接收链路计算完成',
        error: '',
        result,
      })
      activeSocket?.close()
      activeSocket = null
    },
    onError(error) {
      if (currentGeneration !== generation || signalTransmissionSession.state === 'complete') return
      signalTransmissionSession.state = 'error'
      signalTransmissionSession.error = error?.message || String(error)
      signalTransmissionSession.message = '信号传输计算失败'
      activeSocket?.close()
      activeSocket = null
    },
    onStatus(status) {
      if (currentGeneration !== generation || signalTransmissionSession.state === 'complete') return
      if (status.state === 'connecting') signalTransmissionSession.message = status.message
    },
  })
  return requestId
}
