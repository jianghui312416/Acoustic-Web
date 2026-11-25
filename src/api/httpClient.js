import { http } from './authHttp.js'
import { apiTimeoutMs } from '../config/runtimeConfig.js'

function compatResponse(response) {
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  }
}

function isTimeout(error) {
  return error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ||
    /timeout/i.test(String(error?.message || ''))
}

async function request(config, timeoutMs) {
  try {
    const response = await http.request({ timeout: timeoutMs ?? apiTimeoutMs(), ...config })
    return { response: compatResponse(response), data: response.data ?? null }
  } catch (error) {
    if (error?.response) {
      return { response: compatResponse(error.response), data: error.response.data ?? null }
    }
    if (isTimeout(error)) {
      throw new Error(`接口请求超时（${timeoutMs ?? apiTimeoutMs()} ms）`, { cause: error })
    }
    throw error
  }
}

/**
 * 通用 JSON 传输层。返回兼容 fetch 的 { response, data }；
 * 认证头、超时和登录失效跳转统一由 Axios 实例处理。
 */
export function postJson(url, payload, options = {}) {
  return request(
    {
      method: 'POST',
      url,
      data: payload,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: options.signal,
    },
    options.timeoutMs
  )
}

/** GET JSON，超时和错误处理规则与 postJson 保持一致。 */
export function getJson(url, options = {}) {
  return request(
    {
      method: 'GET',
      url,
      headers: { Accept: 'application/json', ...options.headers },
      signal: options.signal,
    },
    options.timeoutMs
  )
}
