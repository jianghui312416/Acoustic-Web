const DEFAULT_PORTAL_API_URL = 'http://127.0.0.1:8888/'
const DEFAULT_API_TIMEOUT_MS = 120_000

function runtimeEnv() {
  return import.meta.env ?? {}
}

function normalizedUrl(value, fallback) {
  const url = String(value || fallback).trim()
  return url.endsWith('/') ? url : `${url}/`
}

/** 运行时配置统一入口，便于开发、测试和部署环境使用不同接口地址。 */
export function portalApiUrl() {
  return normalizedUrl(runtimeEnv().VITE_PORTAL_API_URL, DEFAULT_PORTAL_API_URL)
}

export function apiTimeoutMs() {
  const configured = Number(runtimeEnv().VITE_API_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_API_TIMEOUT_MS
}
