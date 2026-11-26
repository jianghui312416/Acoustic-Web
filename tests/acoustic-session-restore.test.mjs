import test from 'node:test'
import assert from 'node:assert/strict'

function makeStorage() {
  const map = new Map()
  return {
    map,
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { map.set(key, String(value)) },
    removeItem(key) { map.delete(key) },
    clear() { map.clear() },
  }
}

globalThis.localStorage = makeStorage()
globalThis.sessionStorage = makeStorage()

const {
  clearSessionRestore,
  readSessionRestore,
  writeSessionRestore,
} = await import('../src/modules/acoustic/sessionRestore.js')

function setUser(id) {
  globalThis.localStorage.setItem('acoustic_user', JSON.stringify({ id }))
}

test('round-trips the view mode, active workspace and opened jobs', () => {
  clearSessionRestore()
  setUser('alice')
  writeSessionRestore({
    viewMode: 'terrain',
    activeWorkspaceId: 'workspace-1',
    openedJobIds: ['job-a', 'job-b', 'job-a', ''],
  })
  const saved = readSessionRestore()
  assert.equal(saved.viewMode, 'terrain')
  assert.equal(saved.activeWorkspaceId, 'workspace-1')
  assert.deepEqual(saved.openedJobIds, ['job-a', 'job-b'])
})

test('normalizes unknown view modes to the globe view', () => {
  clearSessionRestore()
  setUser('alice')
  writeSessionRestore({ viewMode: 'sideways', openedJobIds: [] })
  assert.equal(readSessionRestore().viewMode, 'globe')
})

test('is scoped per user so one account cannot restore another', () => {
  clearSessionRestore()
  setUser('alice')
  writeSessionRestore({ viewMode: 'terrain', activeWorkspaceId: 'alice-ws', openedJobIds: ['a'] })
  setUser('bob')
  assert.equal(readSessionRestore(), null)
  setUser('alice')
  assert.equal(readSessionRestore().activeWorkspaceId, 'alice-ws')
})

test('clearing the session removes the saved state', () => {
  setUser('alice')
  writeSessionRestore({ viewMode: 'terrain', activeWorkspaceId: 'ws', openedJobIds: ['x'] })
  clearSessionRestore()
  assert.equal(readSessionRestore(), null)
})
