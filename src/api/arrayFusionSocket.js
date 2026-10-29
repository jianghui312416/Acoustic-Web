import { normalizeFusionFrame } from '@/modules/array-fusion/arrayFusionModel.js'

export const ARRAY_FUSION_WS_URL = String(import.meta.env.VITE_ARRAY_FUSION_WS_URL || '').trim()

export function createArrayFusionSocket({
  url = ARRAY_FUSION_WS_URL,
  onFrame,
  onField,
  onProfile,
  onMotionConfig,
  onError,
  onStatus,
} = {}) {
  let socket = null
  let reconnectTimer = 0
  let closedByClient = false

  const publishStatus = (state, message) => onStatus?.({ state, message })

  function connect() {
    if (!url || closedByClient) {
      publishStatus('demo', '演示数据')
      return
    }

    publishStatus('connecting', '连接阵列数据…')
    try {
      socket = new WebSocket(url)
    } catch (error) {
      publishStatus('error', `连接失败：${error.message}`)
      scheduleReconnect()
      return
    }

    socket.addEventListener('open', () => publishStatus('live', '实时数据'))
    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === 'config_ack' || payload?.type === 'pong') return
        if (payload?.type === 'motion_config_ack' || payload?.type === 'motion_state_ack') {
          onMotionConfig?.(payload)
          return
        }
        if (payload?.type === 'field_resp') {
          onField?.(payload)
          return
        }
        if (payload?.type === 'profile_resp') {
          onProfile?.(payload)
          return
        }
        if (payload?.type === 'error') {
          onError?.(payload)
          return
        }
        if (payload?.type === 'frame' || payload?.type === 'motion_frame') {
          onFrame?.(normalizeFusionFrame(payload))
        }
      } catch {
        publishStatus('error', '收到无法解析的阵列数据')
      }
    })
    socket.addEventListener('close', () => {
      socket = null
      if (!closedByClient) {
        publishStatus('demo', '连接中断，已切换演示数据')
        scheduleReconnect()
      }
    })
    socket.addEventListener('error', () => publishStatus('error', '实时数据连接异常'))
  }

  function scheduleReconnect() {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = window.setTimeout(connect, 3000)
  }

  function sendFrame(frame) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(frame))
    return true
  }

  function sendConfig(config) {
    return sendFrame({ type: 'config', ...config })
  }

  function sendMotionConfig(config) {
    return sendFrame({ type: 'motion_config', ...config })
  }

  function sendMotionFrame(frame) {
    return sendFrame({ type: 'motion_frame', ...frame })
  }

  function pauseMotion(time = 0) {
    return sendFrame({ type: 'motion_pause', t: time })
  }

  function seekMotion(time = 0) {
    return sendFrame({ type: 'motion_seek', t: time })
  }

  function bindBellhop(jobId) {
    return sendFrame({ type: 'bellhop_bind', bellhop_job_id: jobId })
  }

  function requestField(jobId = '') {
    return sendFrame({ type: 'field_req', bellhop_job_id: jobId })
  }

  function requestProfile(params = {}) {
    return sendFrame({ type: 'profile_req', ...params })
  }

  function close() {
    closedByClient = true
    window.clearTimeout(reconnectTimer)
    socket?.close()
    socket = null
  }

  connect()
  return {
    sendFrame, sendConfig, sendMotionConfig, sendMotionFrame, pauseMotion, seekMotion,
    bindBellhop, requestField, requestProfile, close,
  }
}
