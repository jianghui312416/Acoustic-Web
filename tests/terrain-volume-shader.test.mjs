import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const {
  terrainVolumeMarchStepCount,
  terrainVolumeSliceCount,
} = await import('../src/utils/terrainWebGL.js')

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
  source.indexOf('renderVolume(grid, volume, controls, view, clip = null) {'),
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
  assert.match(fragment, /if \(rangeM > uPath\.y\) \{[\s\S]*hasRangeOutsideSample = true/)
  assert.match(fragment, /rangeM <= max\(uPath\.x, firstCellM \* 0\.5\)/)
  assert.match(fragment, /for \(int rangeStep = 0; rangeStep < 8; rangeStep\+\+\)/)
  assert.match(fragment, /sampleRangeM\(middleGeoDepth\.x, middleGeoDepth\.y\) > uPath\.y/)
})

test('terrain raymarch clip and seabed drape', () => {
  assert.match(fragment, /uniform vec3 uClipInfo/)
  assert.match(fragment, /compassDelta > 0\.0001 && compassDelta < 180\.0/)
  assert.match(fragment, /for \(int cutStep = 0; cutStep < 8; cutStep\+\+\)/)
  assert.match(fragment, /float middleS = mix\(outsideS, insideS, 0\.5\)/)
  assert.match(fragment, /if \(uDebugNoTerrain == 0 && depthM >= waterDepth\) continue/)
  // Drape the bottom onto the displayed seabed, capped at the data depth.
  assert.match(fragment, /float dataBottomM = uHasBottomDepth == 1/)
  assert.match(fragment, /\? mix\(uPath\.z, uPath\.w, voxel\.g\)[\s\S]*?: uPath\.w/)
  assert.match(fragment, /visualBottomM = min\(waterDepth, uPath\.w\)/)
  // Below the acoustic bottom reuse the last valid TL layer with a taper.
  assert.match(fragment, /if \(depthM > dataBottomM\)/)
  assert.match(fragment, /bottomTaper = mix/)
  assert.match(fragment, /if \(depthM >= visualBottomM\) continue/)
  assert.match(fragment, /uniform float uFeatherM/)
  assert.match(fragment, /smoothstep\(0\.0, max\(8\.0, uFeatherM\), visualBottomM - depthM\)/)
})

test('terrain raymarch composites front-to-back like Cesium', () => {
  assert.match(fragment, /displayRatio = clamp\(\(value - uDb\.x\) \/ max\(1\.0, uDb\.y - uDb\.x\), 0\.0, 1\.0\)/)
  assert.doesNotMatch(fragment, /if \(tl > uDb\.y\) continue/)
  assert.match(fragment, /if \(uStrictNearest == 0\) displayRatio = pow\(displayRatio, 0\.82\)/)
  assert.match(fragment, /float opacity = clamp\(uAlpha\.x, 0\.0, 1\.0\)/)
  assert.match(fragment, /float stepAlpha = clamp\(opacity \* coverage \* STEP_DENSITY \* ds \/ span/)
  assert.match(fragment, /accumColor \+= \(1\.0 - accumAlpha\) \* color \* stepAlpha/)
  assert.match(fragment, /accumAlpha \+= \(1\.0 - accumAlpha\) \* stepAlpha/)
  assert.match(fragment, /if \(accumAlpha >= 0\.985\) break/)
  assert.match(fragment, /nearOrder = hitX \* uSinYaw \+ hitY \* uCosYaw \+ hitZ \* 0\.3/)
  assert.match(fragment, /gl_FragDepth = clamp\(0\.5 - nearOrder \* 0\.5, 0\.0001, 0\.9999\)/)
  assert.match(fragment, /fragColor = vec4\(accumColor \/ accumAlpha, accumAlpha\)/)
})

test('terrain raymarch uses voxel-aware steps and feathers volume edges', () => {
  assert.match(source, /const MAX_VOLUME_STEPS = 1024/)
  assert.match(renderVolume, /terrainVolumeMarchStepCount\(volume\)/)
  assert.match(fragment, /float jitter = uStrictNearest == 1 \? 0\.5 : blueNoiseJitter/)
  assert.match(fragment, /vec3 edgeWidth = min/)
  assert.match(fragment, /float angleEdge = angleSpan >= 359\.5 \? 1\.0/)
  assert.match(fragment, /float rangeEdge = uStrictNearest == 1 \? 1\.0 : edgeHigh\.x/)
  assert.match(fragment, /coverage \*= min\(min\(rangeEdge, angleEdge\), edgeLow\.z \* edgeHigh\.z\)/)
  assert.equal(terrainVolumeMarchStepCount({ width: 301, height: 24, depth: 101 }), 441)
  assert.equal(terrainVolumeMarchStepCount({ width: 301, height: 24, depth: 101, strictNearest: true }), 661)
  assert.equal(terrainVolumeMarchStepCount({ width: 1024, height: 360, depth: 512 }), 512)
  assert.equal(terrainVolumeMarchStepCount({ width: 1024, height: 360, depth: 512, strictNearest: true }), 1024)
  assert.equal(terrainVolumeMarchStepCount({ width: 2, height: 2, depth: 2 }), 64)
})

test('renderVolume sets raymarch bounds and blends the full-screen quad', () => {
  assert.match(renderVolume, /Number\.isFinite\(Number\(controls\?\.alphaScale\)\)/)
  assert.match(renderVolume, /\? Number\(controls\.alphaScale\)/)
  assert.match(renderVolume, /gl\.uniform2f\(u\.uScreenMin/)
  assert.match(renderVolume, /gl\.uniform1f\(u\.uSMin, sMin\)/)
  assert.match(renderVolume, /gl\.uniform1f\(u\.uSteps, stepCount\)/)
  assert.match(renderVolume, /gl\.uniform1f\(u\.uFeatherM/)
  assert.match(renderVolume, /const featherSpan = Math\.max\(1, depthMax - depthMin\)/)
  assert.match(renderVolume, /gl\.enable\(gl\.DEPTH_TEST\)/)
  assert.doesNotMatch(renderVolume, /gl\.disable\(gl\.DEPTH_TEST\)/)
  assert.match(renderVolume, /gl\.drawArrays\(gl\.TRIANGLES, 0, this\.volumeGeometry\.count\)/)
  assert.match(renderVolume, /gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\)/)
})

test('terrain GPU renderer ray-marches multiple field textures', () => {
  const render = source.slice(
    source.indexOf('render(grid, camera, controls = {}, volume = null) {'),
    source.indexOf('export function createTerrainWebGLRenderer'),
  )
  assert.match(source, /this\.volumeTextures = new Map\(\)/)
  assert.match(render, /this\.renderedVolumeIds = \[\]/)
  assert.match(render, /Array\.isArray\(volume\)/)
  assert.match(render, /for \(const entry of entries\)/)
  assert.match(render, /this\.renderedVolumeIds\.push\(entry\.id\)/)
  assert.match(renderVolume, /this\.ensureVolumeTexture\(volume\)/)
  assert.match(renderVolume, /gl\.bindTexture\(gl\.TEXTURE_3D, volumeTexture\)/)
  assert.match(renderVolume, /const clipVolume = clip === null/)
})

test('signal excess and Pd are derived on the GPU from the TL volume', () => {
  assert.match(fragment, /uniform vec4 uExcess/)
  assert.match(fragment, /uniform vec2 uExcessMode/)
  assert.match(fragment, /float normalCdf\(float z\)/)
  assert.match(fragment, /float se = uExcess\.y - tl/)
  assert.match(fragment, /normalCdf\(se \/ max\(1e-6, uExcessMode\.y\)\) \* 100\.0/)
  assert.match(fragment, /uExcess\.x > 0\.5 && \(depthM < uExcess\.z \|\| depthM > uExcess\.w\)/)
  assert.match(renderVolume, /controls\?\.signalExcess/)
  assert.match(renderVolume, /gl\.uniform4f\(\s*u\.uExcess/)
  assert.match(renderVolume, /gl\.uniform2f\(\s*u\.uExcessMode/)
})

test('legacy sampling helper remains bounded for compatible controls', () => {
  assert.equal(terrainVolumeSliceCount(0.03), 35)
  assert.equal(terrainVolumeSliceCount(0.01), 101)
  assert.equal(terrainVolumeSliceCount(0.004), 251)
})
