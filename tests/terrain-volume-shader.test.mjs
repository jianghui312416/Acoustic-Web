import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { terrainVolumeSliceCount } = await import('../src/utils/terrainWebGL.js')

const source = await readFile(new URL('../src/utils/terrainWebGL.js', import.meta.url), 'utf8')
const vertexShader = source.slice(
  source.indexOf('const VOLUME_VERTEX_SHADER'),
  source.indexOf('const VOLUME_FRAGMENT_SHADER'),
)
const fragment = source.slice(
  source.indexOf('const VOLUME_FRAGMENT_SHADER'),
  source.indexOf('const VOLUME_UNIFORM_NAMES'),
)
const renderVolume = source.slice(
  source.indexOf('renderVolume(grid, volume, controls, view) {'),
  source.indexOf('render(grid, camera, controls = {}, volume = null) {'),
)

test('terrain GPU volume is a screen-space raymarch proxy', () => {
  assert.match(vertexShader, /in vec2 aPosition/)
  assert.match(vertexShader, /gl_Position = vec4\(aPosition, 0\.0, 1\.0\)/)
  assert.match(fragment, /for \(int i = 0; i < \$\{MAX_VOLUME_STEPS\}; i\+\+\)/)
  assert.match(fragment, /float s = uSMax - \(float\(i\) \+ jitter\) \* ds/)
  assert.doesNotMatch(vertexShader, /aLocalDepth/)
  assert.doesNotMatch(source, /addCylinderWall|addRadialWall/)
})

test('terrain raymarch inverts the pseudo-perspective per pixel', () => {
  assert.match(fragment, /uScreenMin|uScreenMax/)
  assert.match(fragment, /float denom = max\(0\.0001, 1\.0 \+ k \* sy \* uSinPitch/)
  assert.match(fragment, /float d = \(1\.0 - k \* s \* uCosPitch\) \/ denom/)
  assert.match(fragment, /float ry = s \* uCosPitch \+ q \* uSinPitch/)
  assert.match(fragment, /float z = s \* uSinPitch - q \* uCosPitch/)
})

test('terrain raymarch samples the polar volume and preserves Cesium addressing', () => {
  assert.match(fragment, /sin\(dLonRad\) \* cos\(latRad\)/)
  assert.match(fragment, /cos\(srcLatRad\) \* sin\(latRad\)/)
  assert.match(fragment, /int\(floor\(angleNorm \* float\(angleRows\) \+ 0\.5\)\) % angleRows/)
  assert.match(source, /uniform1i\(u\.uStrictNearest, volume\.strictNearest === true \? 1 : 0\)/)
  assert.match(fragment, /if \(rangeM > uPath\.y\) continue/)
  assert.match(fragment, /rangeM <= max\(uPath\.x, firstCellM \* 0\.5\)/)
})

test('terrain raymarch first-hit clip and seabed clip', () => {
  assert.match(fragment, /uniform vec3 uClipInfo/)
  assert.match(fragment, /compassDelta > 0\.0001 && compassDelta < 180\.0/)
  assert.match(fragment, /if \(uDebugNoTerrain == 0 && depthM >= waterDepth\) continue/)
  assert.match(fragment, /effectiveBottomM = min\(effectiveBottomM, mix\(uPath\.z, uPath\.w, voxel\.g\)\)/)
  assert.match(fragment, /smoothstep\(0\.0, max\(8\.0, uFeatherM\), effectiveBottomM - depthM\)/)
})

test('terrain raymarch outputs first-hit TL color with a single alpha', () => {
  assert.match(fragment, /displayRatio = clamp\(\(tl - uDb\.x\) \/ max\(1\.0, uDb\.y - uDb\.x\), 0\.0, 1\.0\)/)
  assert.doesNotMatch(fragment, /if \(tl > uDb\.y\) continue/)
  assert.match(fragment, /if \(uStrictNearest == 0\) displayRatio = pow\(displayRatio, 0\.82\)/)
  assert.match(fragment, /float alpha = clamp\(uAlpha\.x, 0\.0, 1\.0\) \* 0\.85/)
  assert.match(fragment, /fragColor = vec4\(color, alpha\)/)
  assert.doesNotMatch(fragment, /opacitySignal|Beer-Lambert|accum\.rgb/)
})

test('renderVolume sets raymarch bounds and blends the full-screen quad', () => {
  assert.match(renderVolume, /gl\.uniform2f\(u\.uScreenMin/)
  assert.match(renderVolume, /gl\.uniform1f\(u\.uSMin, sMin\)/)
  assert.match(renderVolume, /gl\.uniform1f\(u\.uSteps, stepCount\)/)
  assert.match(renderVolume, /gl\.drawArrays\(gl\.TRIANGLES, 0, this\.volumeGeometry\.count\)/)
  assert.match(renderVolume, /gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\)/)
})

test('legacy sampling helper remains bounded for compatible controls', () => {
  assert.equal(terrainVolumeSliceCount(0.03), 35)
  assert.equal(terrainVolumeSliceCount(0.01), 101)
  assert.equal(terrainVolumeSliceCount(0.004), 251)
})
