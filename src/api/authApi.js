import { http } from './authHttp.js'

function payload(response) {
  return response?.data ?? {}
}

export async function loginRequest(username, password) {
  const response = await http.post(
    'auth/login',
    { username, password },
    { timeout: 30_000, skipAuthRedirect: true }
  )
  return payload(response)
}

export async function registerRequest(form) {
  const response = await http.post('auth/register', form, {
    timeout: 30_000,
    skipAuthRedirect: true,
  })
  return payload(response)
}

export async function logoutRequest() {
  const response = await http.post('auth/logout')
  return payload(response)
}

export async function fetchCurrentUser() {
  const response = await http.get('auth/me', { skipAuthRedirect: true })
  return payload(response)
}

export async function changePasswordRequest(currentPassword, newPassword) {
  const response = await http.post('auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  return payload(response)
}

export async function listUsers(params = {}) {
  const response = await http.get('admin/users', { params })
  return payload(response)
}

export async function fetchAdminStats() {
  const response = await http.get('admin/stats')
  return payload(response)
}

export async function fetchOperationLogs(limit = 200) {
  const response = await http.get('admin/operation-logs', { params: { limit } })
  return payload(response)
}

export async function approveUser(userId) {
  const response = await http.post(`admin/users/${userId}/approve`)
  return payload(response)
}

export async function rejectUser(userId) {
  const response = await http.post(`admin/users/${userId}/reject`)
  return payload(response)
}

export async function disableUser(userId) {
  const response = await http.post(`admin/users/${userId}/disable`)
  return payload(response)
}

export async function enableUser(userId) {
  const response = await http.post(`admin/users/${userId}/enable`)
  return payload(response)
}

export async function setUserRole(userId, role) {
  const response = await http.post(`admin/users/${userId}/role`, { role })
  return payload(response)
}
