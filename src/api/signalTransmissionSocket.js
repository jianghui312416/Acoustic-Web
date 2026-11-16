import { portalApiUrl } from '@/config/runtimeConfig.js'

export function signalTransmissionWsUrl(baseUrl = portalApiUrl()) {
  const url = new URL('ws/signal-transmission', baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function absolutePortalFileUrl(path, baseUrl = portalApiUrl()) {
  if (!path) return ''
  return new URL(String(path).replace(/^\//, ''), baseUrl).toString()
}

export function createSignalTransmissionSocket({
  url = signalTransmissionWsUrl(),
  onReady,
  onProgress,
  onResult,
  onChunk,
  onComplete,
  onError,
  onStatus,
} = {}) {
  let socket = null
  let closedByClient = false

  function connect() {
    onStatus?.({ state: 'connecting', message: '正在连接信号传输服务…' })
    try {
      socket = new WebSocket(url)
    } catch (error) {
      onError?.(error)
      return
    }
    socket.addEventListener('open', () => onStatus?.({ state: 'connected', message: '信号传输服务已连接' }))
    socket.addEventListener('message', event => {
      try {
        const payload = JSON.parse(event.data)
        if (payload?.type === 'config_ack') onReady?.(payload)
        else if (payload?.type === 'progress') onProgress?.(payload)
        else if (payload?.type === 'result') onResult?.(payload)
        else if (payload?.type === 'chunk') onChunk?.(payload)
        else if (payload?.type === 'stream_complete') onComplete?.(payload)
        else if (payload?.type === 'error') onError?.(new Error(payload.message || '信号传输计算失败'))
      } catch (error) {
        onError?.(new Error(`无法解析信号传输响应：${error.message}`))
      }
    })
    socket.addEventListener('error', () => onError?.(new Error('信号传输 WebSocket 连接异常')))
    socket.addEventListener('close', () => {
      socket = null
      if (!closedByClient) onStatus?.({ state: 'closed', message: '信号传输服务连接已关闭' })
    })
  }

  function simulate(request) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({ ...request, type: 'simulate' }))
    return true
  }

  function close() {
    closedByClient = true
    socket?.close()
    socket = null
  }

  connect()
  return { simulate, close, continueStream() {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'continue' }))
  } }
}
