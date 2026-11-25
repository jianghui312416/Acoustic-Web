import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../src/views/AcousticFieldView.vue', import.meta.url),
  'utf8',
)

test('route fields use four bounded concurrent backend requests and ordered rendering', () => {
  assert.match(source, /const TRACK_FIELD_CONCURRENCY = 4/)
  assert.match(
    source,
    /jobs\.slice\(batchStart, batchStart \+ TRACK_FIELD_CONCURRENCY\)[\s\S]*?Promise\.allSettled\([\s\S]*?requestTrackPointField/,
  )
  assert.match(source, /await loadData\(\{ response: record\.response, regionType: record\.params\.regionType \}\)/)
  assert.doesNotMatch(
    source.slice(source.indexOf('async function runTrackPointFields()'), source.indexOf('// 任何入口触发运行时')),
    /await loadData\(\)/,
  )
})

test('precomputed route results skip duplicate portal and sea-ice requests while loading', () => {
  assert.match(source, /async function loadData\(precomputed = null\)/)
  assert.match(source, /if \(precomputed\?\.response\)[\s\S]*?await loadTlrdData\(precomputed\?\.response \|\| null\)/)
  assert.match(source, /async function loadTlrdData\(precomputedResponse = null\)/)
})

test('one failed route point is recorded without aborting later batches', () => {
  const routeRunner = source.slice(
    source.indexOf('async function runTrackPointFields()'),
    source.indexOf('// 任何入口触发运行时'),
  )
  assert.match(routeRunner, /if \(result\.status === 'rejected'\)[\s\S]*?failures\.push\([\s\S]*?continue/)
  assert.doesNotMatch(routeRunner, /if \(result\.status === 'rejected'\)[\s\S]{0,300}?throw new Error/)
  assert.match(routeRunner, /已完成 \$\{completedCount\}\/\$\{points\.length\} 个航迹点声场/)
})

test('archived route fields clear the transient current GPU volume', () => {
  const routeRunner = source.slice(
    source.indexOf('async function runTrackPointFields()'),
    source.indexOf('// 任何入口触发运行时'),
  )
  assert.match(
    routeRunner,
    /archiveCurrent3dRun\(\)[\s\S]*?terrainRunVisible\.value = false[\s\S]*?raySourceData\.value = null[\s\S]*?currentVolumeTexture = null[\s\S]*?terrainTexture\.value = null/,
  )
})
