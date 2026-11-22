import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const shaderSource = await readFile(new URL('../src/sdk/shaderVolume3D.js', import.meta.url), 'utf8')
const polarClass = shaderSource.slice(shaderSource.indexOf('export class NcPolarShaderVolume3DPrimitive'))

test('GPU volume preserves all eight Bellhop color stops', () => {
  assert.match(shaderSource, /export const MAX_COLOR_STOPS = 8/)
})

test('polar volume shader uses voxel-aware full-ray sampling and de-correlates fixed-step banding', () => {
  assert.match(polarClass, /crossedCellsPerUnit\s*=\s*max\(1\.0, dot\(abs\(rayDir\), cellCount\)\)/)
  assert.match(polarClass, /voxelAwareStep\s*=\s*0\.72 \/ crossedCellsPerUnit/)
  assert.match(polarClass, /rayLength \/ float\(\$\{MAX_MARCH_STEPS\}\)/)
  assert.match(polarClass, /gl_FragCoord\.xy/)
  assert.doesNotMatch(polarClass, /float dt = \(endT - startT\) \/ float\(\$\{MAX_MARCH_STEPS\}\) \* sampleScale/)
})

test('polar volume shader uses interpolated coverage and direct TL surface color', () => {
  assert.match(polarClass, /smoothstep\(0\.015, 0\.92, voxel\.a\)/)
  assert.match(polarClass, /textureSize\(u_volumeTexture, 0\)/)
  assert.match(polarClass, /u_wedgeMeta\.w - u_wedgeMeta\.z >= 359\.5/)
  assert.match(polarClass, /accum = vec4\(color \* alpha, alpha\);\s*break;/)
  assert.doesNotMatch(polarClass, /1\.0 - exp\(-density/)
})

test('polar volume fills the center from the first range sample without angular seams', () => {
  assert.match(polarClass, /pathM <= max\(u_wedgeMeta2\.x, firstCellM \* 0\.5\)/)
  assert.match(polarClass, /pathNorm = 0\.0;\s*angleNorm = 0\.0;/)
  assert.doesNotMatch(polarClass, /if \(pathNorm < 0\.0 \|\| pathNorm > 1\.0\) return false/)
  assert.match(polarClass, /coverage \*= min\(min\(edgeHigh\.x, angleEdge\), edgeLow\.z \* edgeHigh\.z\)/)
})

test('polar half-body clip exposes an exact, opacity-controlled TL face', () => {
  assert.match(polarClass, /bool cutFaceSample = u_sliceInfo\.y > 0\.5 && u_sliceInfo\.z < 0\.5 && hasClippedPoint/)
  assert.match(polarClass, /for \(int cutStep = 0; cutStep < 8; cutStep\+\+\)/)
  assert.match(polarClass, /float alpha = clamp\(u_depthInfo\.z, 0\.0, 1\.0\)/)
  assert.match(polarClass, /requestedOpacity <= 0\) return/)
})

test('polar volume hard-clips below the interpolated seabed before feathering', () => {
  assert.match(polarClass, /uniform int u_hasBottomDepth/)
  assert.match(polarClass, /if \(depthM >= bottomM\) continue/)
  assert.match(polarClass, /smoothstep\(0\.0, max\(8\.0, u_featherM\), bottomM - depthM\)/)
  assert.match(polarClass, /uniforms\.hasBottomDepth = volume\.hasBottomDepth \? 1 : 0/)
})

test('polar volume emits one nearest TL surface per pixel and converts premultiplied color for alpha blend', () => {
  assert.match(polarClass, /cull:\s*\{ enabled: true \}/)
  assert.match(polarClass, /cameraInside \? this\.renderStateInside : this\.renderState/)
  assert.match(polarClass, /accum\.rgb \/ max\(accum\.a, 0\.0001\)/)
  assert.match(polarClass, /0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7/)
})
