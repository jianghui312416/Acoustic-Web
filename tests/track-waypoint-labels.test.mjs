import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/components/terrain/TerrainPreviewMode.vue', import.meta.url),
  'utf8'
)

test('terrain track points render persistent sequential waypoint labels', () => {
  assert.match(source, /const label = `Waypoint \$\{index \+ 1\}`/)
  assert.match(source, /ctx\.fillText\(label, labelX, labelY\)/)
  assert.match(source, /projected\.forEach\(\(\{ source, index \}\)/)
})
