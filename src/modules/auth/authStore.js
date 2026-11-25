import { computed, reactive } from 'vue'
import {
  clearAuthStorage,
  getAccessToken,
  getStoredUser,
  setAccessToken,
  setStoredUser,
} from '@/api/authHttp.js'
import { fetchCurrentUser, loginRequest, logoutRequest } from '@/api/authApi.js'

export const authState = reactive({
  user: getStoredUser(),
  token: getAccessToken(),
  ready: false,
})

export const isAuthenticated = computed(() => Boolean(authState.token && authState.user))
export const isAdmin = computed(() => authState.user?.role === 'admin')

let restorePromise = null

function applySession(payload) {
  const token = payload?.access_token || ''
  const user = payload?.user || null
  setAccessToken(token)
  setStoredUser(user)
  authState.token = token
  authState.user = user
  authState.ready = true
}

export function clearSession() {
  clearAuthStorage()
  authState.token = ''
  authState.user = null
  authState.ready = true
}

export async function restoreSession(force = false) {
  if (authState.ready && !force) return authState.user
  if (!getAccessToken()) {
    authState.token = ''
    authState.user = null
    authState.ready = true
    return null
  }
  if (restorePromise && !force) return restorePromise
  restorePromise = (async () => {
    try {
      const data = await fetchCurrentUser()
      authState.user = data.user || null
      authState.token = getAccessToken()
      setStoredUser(authState.user)
    } catch (error) {
      const status = error?.response?.status
      if (status === 401 || status === 403) {
        clearSession()
      } else {
        authState.user = getStoredUser()
        authState.token = getAccessToken()
      }
    } finally {
      authState.ready = true
      restorePromise = null
    }
    return authState.user
  })()
  return restorePromise
}

export async function login(username, password) {
  const data = await loginRequest(username, password)
  applySession(data)
  return data.user
}

export async function logout() {
  try {
    await logoutRequest()
  } catch {
    /* 令牌可能已失效，仍清理本地状态 */
  }
  clearSession()
}

export async function refreshUser() {
  const data = await fetchCurrentUser()
  authState.user = data.user || null
  setStoredUser(authState.user)
  return authState.user
}
