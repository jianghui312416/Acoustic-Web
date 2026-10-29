import test from 'node:test'
import assert from 'node:assert/strict'

const {
  DEFAULT_MODULE_ID,
  defaultSubmoduleId,
  findModule,
  moduleCatalog,
} = await import('../src/config/moduleCatalog.js')

test('module catalog has unique module and submodule identifiers', () => {
  const moduleIds = moduleCatalog.map((item) => item.id)
  assert.equal(new Set(moduleIds).size, moduleIds.length)

  for (const moduleItem of moduleCatalog) {
    assert.ok(moduleItem.label)
    assert.ok(moduleItem.viewKey)
    const childIds = moduleItem.children.map((item) => item.id)
    assert.equal(new Set(childIds).size, childIds.length)
  }
})

test('default module and submodule can be resolved', () => {
  const moduleItem = findModule(DEFAULT_MODULE_ID)
  assert.equal(moduleItem.id, DEFAULT_MODULE_ID)
  assert.equal(moduleItem.label, '体绘制')
  assert.deepEqual(moduleItem.children, [])
  assert.equal(defaultSubmoduleId(moduleItem), '3d')
})

test('sidebar catalog only exposes the acoustic volume module', () => {
  assert.deepEqual(moduleCatalog.map((item) => item.id), [DEFAULT_MODULE_ID])
  assert.equal(moduleCatalog.some((item) => item.label === '水声通信'), false)
})
