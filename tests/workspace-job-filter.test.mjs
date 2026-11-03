import test from 'node:test'
import assert from 'node:assert/strict'
import { isWorkspaceFieldParams } from '../src/modules/acoustic/workspaceJobFilter.js'

test('workspace keeps multi-bearing full 3d sound field tasks', () => {
  assert.equal(isWorkspaceFieldParams({
    calculation_mode: '3d',
    sound_field_view: 'full_3d',
    section_count: 4,
    portal_request: { sector: 4 },
  }), true)
})

test('workspace rejects 2d ray tasks created while viewing a cross-section', () => {
  assert.equal(isWorkspaceFieldParams({
    calculation_mode: '2d',
    sound_field_view: 'selected_section',
    section_count: 1,
    portal_request: { azimuth: 90, sector: undefined },
  }), false)
})

test('workspace rejects single-bearing 3d tasks', () => {
  assert.equal(isWorkspaceFieldParams({
    calculation_mode: '3d',
    sound_field_view: 'full_3d',
    section_count: 1,
  }), false)
})

test('workspace rejects selected-section 3d tasks', () => {
  assert.equal(isWorkspaceFieldParams({
    calculation_mode: '3d',
    sound_field_view: 'selected_section',
    section_count: 4,
  }), false)
})

test('workspace falls back to legacy params without calculation_mode', () => {
  assert.equal(isWorkspaceFieldParams({
    section_count: 4,
    portal_request: { sector: 4 },
  }), true)
  assert.equal(isWorkspaceFieldParams({
    section_count: 4,
    portal_request: { azimuth: 90, sector: 4 },
  }), false)
})

test('workspace rejects missing or invalid params', () => {
  assert.equal(isWorkspaceFieldParams(null), false)
  assert.equal(isWorkspaceFieldParams({}), false)
})
