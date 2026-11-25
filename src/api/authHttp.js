import axios from 'axios'
import { apiTimeoutMs, portalApiUrl } from '@/config/runtimeConfig.js'

const TOKEN_KEY = 'acoustic_access_token'
const USER_KEY = 'acoustic_user'

export function getAccessToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setAccessToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage 不可用时保持内存态由调用方处理 */
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setStoredUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* 忽略存储异常 */
  }
}

export function clearAuthStorage() {
  setAccessToken('')
  setStoredUser(null)
}

export function redirectToLogin() {
  clearAuthStorage()
  const current = (window.location.hash || '').replace(/^#/, '') || '/'
  if (current.startsWith('/login')) return
  window.location.hash = `#/login?redirect=${encodeURIComponent(current)}`
}

/** 给下载链接、图片地址或 WebSocket 地址附加访问令牌。 */
export function withAccessToken(url, token = getAccessToken()) {
  if (!url) return ''
  try {
    const target = new URL(String(url), portalApiUrl())
    if (token) target.searchParams.set('access_token', token)
    return target.toString()
  } catch {
    return String(url)
  }
}

export const http = axios.create({
  baseURL: portalApiUrl(),
  timeout: apiTimeoutMs(),
})

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    if (status === 401 && !error.config?.skipAuthRedirect) {
      redirectToLogin()
    }
    return Promise.reject(error)
  }
)

export function authErrorMessage(error, fallback = '请求失败') {
  return error?.response?.data?.detail || error?.response?.data?.message || error?.message || fallback
}
