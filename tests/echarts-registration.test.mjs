import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('registers the custom chart used by the seabed lithology mask', async () => {
  const source = await readFile(new URL('../src/plugins/echarts.js', import.meta.url), 'utf8')
  assert.match(source, /import\s*\{[^}]*\bCustomChart\b[^}]*\}\s*from\s*['"]echarts\/charts['"]/s)
  assert.match(source, /echarts\.use\(\[[\s\S]*\bCustomChart\b[\s\S]*\]\)/)
})
