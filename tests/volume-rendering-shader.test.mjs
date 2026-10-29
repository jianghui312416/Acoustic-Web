import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const shaderSource = await readFile(new URL('../src/sdk/shaderVolume3D.js', import.meta.url), 'utf8')
const polarClass = shaderSource.slice(shaderSource.indexOf('export class NcPolarShaderVolume3DPrimitive'))

test('polar volume shader uses voxel-aware full-ray sampling and de-correlates fixed-step banding', () => {
  assert.match(polarClass, /crossedCellsPerUnit\s*=\s*max\(1\.0, dot\(abs\(rayDir\), cellCount\)\)/)
  assert.match(polarClass, /voxelAwareStep\s*=\s*0\.72 \/ crossedCellsPerUnit/)
  assert.match(polarClass, /rayLength \/ float\(\$\{MAX_MARCH_STEPS\}\)/)
  assert.match(polarClass, /gl_FragCoord\.xy/)
  assert.doesNotMatch(polarClass, /float dt = \(endT - startT\) \/ float\(\$\{MAX_MARCH_STEPS\}\) \* sampleScale/)
})

test('polar volume shader uses interpolated coverage and step-corrected opacity', () => {
  assert.match(polarClass, /smoothstep\(0\.015, 0\.92, voxel\.a\)/)
  assert.match(polarClass, /textureSize\(u_volumeTexture, 0\)/)
  assert.match(polarClass, /u_wedgeMeta\.w - u_wedgeMeta\.z >= 359\.5/)
  assert.match(polarClass, /1\.0 - exp\(-density \* coverage \* opacitySignal \* dt\)/)
  assert.doesNotMatch(polarClass, /float stepAlphaBase/)
})

test('polar volume integrates once per pixel and converts premultiplied accumulation for alpha blend', () => {
  assert.match(polarClass, /cull:\s*\{ enabled: true \}/)
  assert.match(polarClass, /cameraInside \? this\.renderStateInside : this\.renderState/)
  assert.match(polarClass, /accum\.rgb \/ max\(accum\.a, 0\.0001\)/)
  assert.match(polarClass, /0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7/)
})
