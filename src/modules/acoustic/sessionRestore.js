/**
 * 同一标签页的声场工作现场快照（sessionStorage）。
 *
 * 电脑锁屏 / 休眠唤醒后，浏览器常会丢弃 WebGL 上下文，甚至直接重载整页。
 * Vue 里的 viewMode、已打开的工作区都只在内存中，重载后会回到默认的全球视图，
 * 看起来就是“锁屏后工作界面丢失”。这里在视图模式、工作区打开状态变化以及
 * 页面隐藏（锁屏）时把这几项写入会话存储，重载后由 AcousticFieldView 恢复。
 *
 * 使用 sessionStorage 而非 localStorage：只在当前标签页（含重载 / 休眠恢复）
 * 内生效，新开标签页仍从干净状态开始，且不同用户互不影响。
 */
const STORAGE_KEY_PREFIX = 'acoustic_session_restore'
const SESSION_VERSION = 1

function currentUserId() {
  try {
    const user = JSON.parse(globalThis.localStorage?.getItem('acoustic_user') || 'null')
    const identity = user?.id ?? user?.user_id ?? user?.username ?? user?.name
    return identity === undefined || identity === null ? '' : String(identity).trim()
  } catch {
    return ''
  }
}

function storageKey() {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(currentUserId())}`
}

function storage() {
  try {
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

/** 读取上一次保存的现场；不存在、版本不符或解析失败时返回 null。 */
export function readSessionRestore() {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(storageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== SESSION_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * 只有被浏览器“丢弃（tab discard）”后重新加载的页面才恢复现场。
 * 手动刷新(F5 / Ctrl+R)、关闭后重开、普通导航都会得到 false，从而从头开始。
 */
export function isSessionRestoreAllowed() {
  return typeof document !== 'undefined' && document.wasDiscarded === true
}

/**
 * 页面启动时调用：允许恢复时返回上次现场，否则清空存储并返回 null。
 * 手动刷新时清空，避免之后标签页被丢弃又恢复成刷新前的旧状态。
 */
export function consumeSessionRestore() {
  if (!isSessionRestoreAllowed()) {
    clearSessionRestore()
    return null
  }
  return readSessionRestore()
}

/** 覆盖写入现场（viewMode / activeWorkspaceId / openedJobIds）。 */
export function writeSessionRestore(state) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(storageKey(), JSON.stringify({
      viewMode: state?.viewMode === 'terrain' ? 'terrain' : 'globe',
      activeWorkspaceId: String(state?.activeWorkspaceId || ''),
      openedJobIds: Array.isArray(state?.openedJobIds)
        ? [...new Set(state.openedJobIds.map(id => String(id || '')).filter(Boolean))]
        : [],
      v: SESSION_VERSION,
      savedAt: Date.now(),
    }))
  } catch {
    /* 会话存储不可用时忽略，最多丢失一次现场恢复能力 */
  }
}

export function clearSessionRestore() {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(storageKey())
  } catch {
    /* 忽略存储异常 */
  }
}
