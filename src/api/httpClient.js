import { apiTimeoutMs } from '../config/runtimeConfig.js'

/**
 * 通用 JSON 传输层。这里只处理网络、超时和 JSON 解码；
 * ResultCode 等业务协议由各领域 API 模块负责。
 */
export async function postJson(url, payload, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? apiTimeoutMs()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    let data = null
    try {
      data = await response.json()
    } catch {
      // 网关异常可能返回空内容或非 JSON，交给领域 API 结合 HTTP 状态处理。
    }

    return { response, data }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`接口请求超时（${timeoutMs} ms）`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
