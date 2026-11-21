import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { terrainVolumeSliceCount } = await import('../src/utils/terrainWebGL.js')

const source = await readFile(new URL('../src/utils/terrainWebGL.js', import.meta.url), 'utf8')
const volumeShaders = source.slice(
  source.indexOf('const VOLUME_VERTEX_SHADER'),
  source.indexOf('const VOLUME_UNIFORM_NAMES'),
)
const fragment = source.slice(
  source.indexOf('const VOLUME_FRAGMENT_SHADER'),
  source.indexOf('const VOLUME_UNIFORM_NAMES'),
)

test('terrain GPU volume samples interpolated azimuth rows without re-quantizing sectors', () => {
  assert.match(fragment, /texture\(\s*uVolumeTexture,\s*clamp\(vec3\(pathNorm, angleNorm, depthNorm\)/s)
  assert.doesNotMatch(fragment, /sectorInterp|uAngleCount|uAngleMode/)
})

test('terrain GPU volume matches Cesium bearing and strict-nearest addressing', () => {
  assert.match(fragment, /sin\(dLonRad\) \* cos\(latRad\)/)
  assert.match(fragment, /cos\(srcLatRad\) \* sin\(latRad\)/)
  assert.match(fragment, /int\(floor\(angleNorm \* float\(angleRows\) \+ 0\.5\)\) % angleRows/)
  assert.match(source, /uniform1i\(u\.uStrictNearest, volume\.strictNearest === true \? 1 : 0\)/)
})

test('terrain GPU volume rotates one view-aligned slice stack continuously through every pitch', () => {
  assert.match(volumeShaders, /uniform vec3 uSliceCenter/)
  assert.match(volumeShaders, /uniform vec3 uSliceExtents/)
  assert.match(volumeShaders, /float ry = q \* uSinPitch \+ s \* uCosPitch/)
  assert.match(volumeShaders, /float z = -q \* uCosPitch \+ s \* uSinPitch/)
  assert.match(volumeShaders, /float depthM = -z \* uHorizontalSpanM/)
  assert.doesNotMatch(source, /sliceOrientation|uSliceOrientation/)
  assert.match(source, /const slice = -1 \+ \(2 \* index\) \/ Math\.max\(1, slices - 1\)/)
  assert.match(source, /push\(-1, -1, slice\)[\s\S]*push\(-1, 1, slice\)/)
  assert.match(source, /const lonMin = Number\.isFinite\(Number\(volume\.lonMin\)\)/)
  assert.match(source, /q: ry \* view\.sinPitch - z \* view\.cosPitch/)
  assert.match(source, /s: ry \* view\.cosPitch \+ z \* view\.sinPitch/)
  assert.match(source, /uniform3f\(u\.uSliceCenter, rxCenter, qCenter, sCenter\)/)
})

test('terrain GPU volume uses float terrain and Cesium-style seabed feathering', () => {
  assert.match(fragment, /float sampleTerrainElevation\(vec2 uv\)/)
  assert.match(fragment, /texelFetch\(uHeightMap, p0, 0\)\.r/)
  assert.match(fragment, /if \(uDebugNoTerrain == 0 && vDepthM >= waterDepth\) discard/)
  assert.match(fragment, /effectiveBottomM = min\(effectiveBottomM, mix\(uPath\.z, uPath\.w, voxel\.g\)\)/)
  assert.match(fragment, /smoothstep\(0\.0, max\(8\.0, uFeatherM\), effectiveBottomM - vDepthM\)/)
  assert.match(fragment, /vec3\(1\.5\) \/ textureShapeF/)
  assert.match(source, /gl\.R32F, width, height, 0, gl\.RED, gl\.FLOAT, data/)
  assert.doesNotMatch(source, /uHeightRange/)
})

test('terrain GPU volume preserves Cesium cavities and step-corrected opacity', () => {
  assert.match(fragment, /if \(tl > uDb\.y\) discard/)
  assert.match(fragment, /if \(uStrictNearest == 0\) displayRatio = pow\(displayRatio, 0\.82\)/)
  assert.match(fragment, /float strictOpacity = 0\.56 \+ 0\.44 \* clamp\(\(110\.0 - tl\) \/ 70\.0/)
  assert.match(fragment, /opacitySignal = pow\(strictOpacity, max\(0\.1, uAlpha\.y\)\)/)
  assert.match(fragment, /float density = max\(0\.0, uAlpha\.x\) \* 5\.5/)
  assert.match(fragment, /1\.0 - exp\(-density \* coverage \* opacitySignal \* uStepLength\)/)
  assert.doesNotMatch(fragment, /alpha <= 0\.003/)
  assert.match(source, /CESIUM_DEFAULT_ALPHA_SCALE \* Math\.pow\(opacity \/ TERRAIN_DEFAULT_OPACITY, 0\.55\)/)
  assert.match(source, /uniform1f\(u\.uStepLength, 1 \/ Math\.max\(1, sliceCount - 1\)\)/)
})

test('terrain GPU volume sampling control changes the actual slice count', () => {
  assert.equal(terrainVolumeSliceCount(0.03), 35)
  assert.equal(terrainVolumeSliceCount(0.01), 101)
  assert.equal(terrainVolumeSliceCount(0.004), 251)
  assert.match(source, /const sliceCount = terrainVolumeSliceCount\(controls\?\.sampling\)/)
  assert.match(source, /view-aligned:\$\{slices\}/)
})

test('terrain GPU clip keeps one azimuth half and follows the direction line', () => {
  assert.match(fragment, /uniform vec3 uClipInfo/)
  assert.match(fragment, /compassDelta > 0\.0001 && compassDelta < 180\.0/)
  assert.match(source, /controls\?\.clipGpuVolume === true/)
})

test('terrain GPU volume uses perspective-correct interpolation on oblique slices', () => {
  assert.match(volumeShaders, /float clipW = max\(0\.0001, 1\.0 \/ perspective\)/)
  assert.match(volumeShaders, /gl_Position = vec4\(ndc \* clipW, depth \* clipW, clipW\)/)
})
