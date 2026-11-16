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
  playbackTimeS: 0,
})

let activeSocket = null
let generation = 0

function appendChunk(previous, chunk) {
  if (!previous) return chunk
  const result = { ...chunk, waveforms: {}, spectrograms: {} }
  for (const [name, wave] of Object.entries(chunk.waveforms)) {
    const old = previous.waveforms[name]
    result.waveforms[name] = { continuous: true, time_s: [...old.time_s, ...wave.time_s], values: [...old.values, ...wave.values] }
  }
  for (const [name, spec] of Object.entries(chunk.spectrograms)) {
    const old = previous.spectrograms[name]
    result.spectrograms[name] = { ...spec, time_s: [...old.time_s, ...spec.time_s],
      psd_db: spec.psd_db.map((row, i) => [...old.psd_db[i], ...row]) }
  }
  const cutoff = Math.max(0, chunk.available_until_s - 300)
  for (const wave of Object.values(result.waveforms)) {
    const first = wave.time_s.findIndex(t => t >= cutoff)
    if (first > 0) { wave.time_s = wave.time_s.slice(first); wave.values = wave.values.slice(first) }
  }
  for (const spec of Object.values(result.spectrograms)) {
    const first = spec.time_s.findIndex(t => t >= cutoff)
    if (first > 0) { spec.time_s = spec.time_s.slice(first); spec.psd_db = spec.psd_db.map(row => row.slice(first)) }
    delete spec.dbfs_per_hz
  }
  result.available_from_s = cutoff
  return result
}

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
    playbackTimeS: 0,
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
    onChunk(chunk) {
      if (currentGeneration !== generation) return
      signalTransmissionSession.result = appendChunk(signalTransmissionSession.result, chunk)
      signalTransmissionSession.state = 'streaming'
      signalTransmissionSession.message = `连续信号已计算至 ${chunk.available_until_s.toFixed(1)} s`
      const continueWhenBuffered = () => {
        if (currentGeneration !== generation) return
        if (chunk.available_until_s <= signalTransmissionSession.playbackTimeS + 60) activeSocket?.continueStream()
        else window.setTimeout(continueWhenBuffered, 200)
      }
      continueWhenBuffered()
    },
    onComplete(event) {
      if (currentGeneration !== generation) return
      signalTransmissionSession.result = { ...signalTransmissionSession.result, files: event.files }
      signalTransmissionSession.state = 'complete'
      signalTransmissionSession.percent = 100
      signalTransmissionSession.message = 'Waypoint连续链路计算完成'
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
