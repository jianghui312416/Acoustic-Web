import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const viewSource = await readFile(new URL('../src/views/AcousticFieldView.vue', import.meta.url), 'utf8')

test('direct terrain exit enters the clean globe without rebuilding released renderers', () => {
  assert.match(
    viewSource,
    /const directTerrainExit = previousMode === 'terrain' && !terrainLeaving\.value/,
  )
  assert.match(
    viewSource,
    /enterCleanGlobeView\(\{ skipRendererSync: true \}\)/,
  )
  assert.match(
    viewSource,
    /if \(skipRendererSync\) \{[\s\S]*?earthRaysVisible\.value = false[\s\S]*?\} else \{[\s\S]*?setEarthRaysVisible\(false\)/,
  )
  assert.match(
    viewSource,
    /if \(!cleanGlobeView\.value\) \{[\s\S]*?refreshVolumeRayScatterPoints\(\)[\s\S]*?syncSoundField\(\)/,
  )
})
