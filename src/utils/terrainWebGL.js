import {
  TERRAIN_MAX_MESH_SEGMENTS,
  normalizeExaggeration,
  pickBandStep,
  terrainColorAt,
  terrainLighting,
  terrainMesh,
  terrainShadowMask,
} from './terrainRendering.js'

const TERRAIN_VOLUME_MIN_SLICES = 35
const TERRAIN_VOLUME_MAX_SLICES = 251
const CESIUM_DEFAULT_ALPHA_SCALE = 0.42
const TERRAIN_DEFAULT_OPACITY = 1.7

/** 将归一化最大采样步长换算为视线方向切片数。 */
export function terrainVolumeSliceCount(sampling) {
  const value = Number(sampling)
  const step = clamp(Number.isFinite(value) ? value : 0.01, 0.004, 0.03)
  return clamp(Math.ceil(1 / step) + 1, TERRAIN_VOLUME_MIN_SLICES, TERRAIN_VOLUME_MAX_SLICES)
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aSlope;
layout(location = 2) in float aElevation;
layout(location = 3) in vec2 aUv;

uniform float uWidth;
uniform float uHeight;
uniform float uScale;
uniform float uPanX;
uniform float uPanY;
uniform float uCosYaw;
uniform float uSinYaw;
uniform float uCosPitch;
uniform float uSinPitch;
uniform float uExaggeration;
uniform float uMinElevation;
uniform float uMaxElevation;

out vec2 vSlope;
out float vElevT;
out float vFogT;
out vec2 vUv;

void main() {
  float x = aPosition.x;
  float y = aPosition.y;
  float z = aPosition.z * uExaggeration;

  float rx = x * uCosYaw - y * uSinYaw;
  float ry = x * uSinYaw + y * uCosYaw;
  // Perspective must disappear in a true top-down view. Keeping a ry-dependent
  // scale at pitch=90 degrees turns horizontal circles into egg shapes.
  float perspectiveStrength = 0.35 * abs(uCosPitch);
  float perspective = 1.0 / (1.0 - ry * perspectiveStrength);

  float sx = uWidth * 0.5 + uPanX + rx * uScale * perspective;
  float sy = uHeight * 0.40 + uPanY + (ry * uSinPitch - z * uCosPitch) * uScale * perspective;

  vec2 ndc = vec2(sx / uWidth * 2.0 - 1.0, 1.0 - sy / uHeight * 2.0);

  // 用与 Canvas 渲染器相同的 order 作为深度，让 GPU 深度测试代替逐面排序。
  float order = ry + z * 0.3;
  float depth = clamp(0.5 - order * 0.5, 0.0001, 0.9999) * 2.0 - 1.0;
  gl_Position = vec4(ndc, depth, 1.0);

  vSlope = aSlope;
  vElevT = (aElevation - uMinElevation) / max(1.0, uMaxElevation - uMinElevation);
  vFogT = 1.0 / perspective;
  vUv = aUv;
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vSlope;
in float vElevT;
in float vFogT;
in vec2 vUv;

uniform sampler2D uColorMap;
uniform sampler2D uShadowMap;
uniform float uShadowEnabled;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uMinLight;
uniform float uMaxLight;
uniform float uZFactor;
uniform float uBrightness;
uniform vec3 uFogColor;
uniform float uFogStrength;
uniform float uInvMin;
uniform float uInvMax;

out vec4 fragColor;

void main() {
  vec3 base = texture(uColorMap, vec2(clamp(vElevT, 0.0, 1.0), 0.5)).rgb;

  // 与 terrainRendering.hillshade() 相同的方向光模型，但法线在片元阶段插值，
  // 因此放大后不会再出现逐面片的明暗台阶。
  vec2 slope = vSlope * uZFactor;
  vec3 normal = normalize(vec3(-slope.x, -slope.y, 1.0));
  // 自阴影只削弱直射分量；未开启时 mix 回 1.0，保持原有明暗。
  float shadow = mix(1.0, texture(uShadowMap, vUv).r, uShadowEnabled);
  float illumination = max(dot(normal, normalize(uLightDir)), 0.0) * shadow;
  float shade = clamp(uAmbient + uDiffuse * illumination, uMinLight, uMaxLight);

  vec3 lit = clamp(base * shade * uBrightness, 0.0, 1.0);

  float fog = 0.0;
  if (uFogStrength > 0.0) {
    float t = clamp((vFogT - uInvMin) / max(0.000001, uInvMax - uInvMin), 0.0, 1.0);
    fog = uFogStrength * pow(t, 1.35);
  }

  fragColor = vec4(mix(lit, uFogColor, fog), 1.0);
}
`

const VOLUME_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in float aSlice;

uniform float uWidth;
uniform float uHeight;
uniform float uScale;
uniform float uPanX;
uniform float uPanY;
uniform float uCosYaw;
uniform float uSinYaw;
uniform float uCosPitch;
uniform float uSinPitch;
uniform float uExaggeration;
uniform float uHorizontalSpanM;
uniform vec3 uSliceCenter;
uniform vec3 uSliceExtents;

out vec2 vLocal;
out float vDepthM;

void main() {
  // View-aligned coordinates: rx is screen-horizontal, q is screen-vertical,
  // and s runs from the back of the volume to the front. This basis rotates
  // continuously with pitch, becoming horizontal at top-down and vertical at side view.
  float rx = uSliceCenter.x + aPosition.x * uSliceExtents.x;
  float q = uSliceCenter.y + aPosition.y * uSliceExtents.y;
  float s = uSliceCenter.z + aSlice * uSliceExtents.z;
  float ry = q * uSinPitch + s * uCosPitch;
  float z = -q * uCosPitch + s * uSinPitch;
  float x = rx * uCosYaw + ry * uSinYaw;
  float y = -rx * uSinYaw + ry * uCosYaw;
  float depthM = -z * uHorizontalSpanM / max(0.0001, uExaggeration);
  float perspectiveStrength = 0.35 * abs(uCosPitch);
  float perspective = 1.0 / (1.0 - ry * perspectiveStrength);
  float sx = uWidth * 0.5 + uPanX + rx * uScale * perspective;
  float sy = uHeight * 0.40 + uPanY + (ry * uSinPitch - z * uCosPitch) * uScale * perspective;
  vec2 ndc = vec2(sx / uWidth * 2.0 - 1.0, 1.0 - sy / uHeight * 2.0);
  float order = ry + z * 0.3;
  float depth = clamp(0.5 - order * 0.5, 0.0001, 0.9999) * 2.0 - 1.0;
  // Preserve the existing screen projection while allowing perspective-correct
  // interpolation of volume coordinates across an oblique slice.
  float clipW = max(0.0001, 1.0 / perspective);
  gl_Position = vec4(ndc * clipW, depth * clipW, clipW);
  vLocal = vec2(x, y);
  vDepthM = depthM;
}
`

const VOLUME_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vLocal;
in float vDepthM;

uniform sampler3D uVolumeTexture;
uniform sampler2D uHeightMap;
uniform sampler2D uColorLut;
uniform vec4 uGeo;
uniform vec4 uTerrain;
uniform vec4 uWedge;
uniform vec4 uPath;
uniform vec2 uValue;
uniform vec2 uDb;
uniform vec2 uAlpha;
uniform float uStepLength;
// x = 是否裁剪半体，y = 罗盘方位角
uniform vec3 uClipInfo;
uniform float uFeatherM;
uniform int uHasBottomDepth;
uniform int uStrictNearest;
uniform int uVolumeMode;
uniform float uSliceDepthM;
uniform int uDebugNoTerrain;

out vec4 fragColor;

float sampleTerrainElevation(vec2 uv) {
  ivec2 size = textureSize(uHeightMap, 0);
  vec2 texel = clamp(
    clamp(uv, vec2(0.0), vec2(1.0)) * vec2(size) - 0.5,
    vec2(0.0),
    vec2(size - 1)
  );
  ivec2 p0 = ivec2(floor(texel));
  ivec2 p1 = min(p0 + 1, size - 1);
  vec2 f = fract(texel);
  float h00 = texelFetch(uHeightMap, p0, 0).r;
  float h10 = texelFetch(uHeightMap, ivec2(p1.x, p0.y), 0).r;
  float h01 = texelFetch(uHeightMap, ivec2(p0.x, p1.y), 0).r;
  float h11 = texelFetch(uHeightMap, p1, 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

void main() {
  float lon = uGeo.x + vLocal.x * uGeo.z / uGeo.w;
  float lat = uGeo.y - vLocal.y * uGeo.z;
  vec2 terrainUv = vec2(
    (lon - uTerrain.x) / max(1e-9, uTerrain.y - uTerrain.x),
    (uTerrain.w - lat) / max(1e-9, uTerrain.w - uTerrain.z)
  );
  if (terrainUv.x < 0.0 || terrainUv.x > 1.0 || terrainUv.y < 0.0 || terrainUv.y > 1.0) discard;
  float terrainElev = sampleTerrainElevation(terrainUv);
  float waterDepth = max(0.0, -terrainElev);
  // Hard clip first so feathering can never leak the volume below seabed or onto land.
  if (uDebugNoTerrain == 0 && vDepthM >= waterDepth) discard;

  float srcLatRad = radians(uWedge.y);
  float latRad = radians(lat);
  float dLonRad = radians(lon - uWedge.x);
  float cosSrcLat = max(0.01, cos(srcLatRad));
  float east = (lon - uWedge.x) * 111320.0 * cosSrcLat;
  float north = (lat - uWedge.y) * 110574.0;
  float rangeM = length(vec2(east, north));
  if (rangeM < uPath.x || rangeM > uPath.y) discard;
  // Match Cesium's spherical initial-bearing calculation. The previous planar
  // atan(east, north) drifts enough over a large region to select another sector.
  float bearingY = sin(dLonRad) * cos(latRad);
  float bearingX = cos(srcLatRad) * sin(latRad)
    - sin(srcLatRad) * cos(latRad) * cos(dLonRad);
  float bearing = degrees(atan(bearingY, bearingX));
  if (uClipInfo.x > 0.5) {
    // 内部方位角是正东 0°、逆时针为正；罗盘角方向相反。
    // 保留内部方位 [箭头, 箭头+180°] 对应的半个体。
    float compassDelta = mod(bearing - uClipInfo.y + 360.0, 360.0);
    if (compassDelta > 0.0001 && compassDelta < 180.0) discard;
  }
  float angleSpan = max(0.001, uWedge.w - uWedge.z);
  float angleNorm = mod(bearing - uWedge.z + 720.0, 360.0) / angleSpan;
  if (angleNorm < 0.0 || angleNorm > 1.0) discard;
  float pathNorm = clamp((rangeM - uPath.x) / max(1.0, uPath.y - uPath.x), 0.0, 1.0);
  if (vDepthM < uPath.z || vDepthM > uPath.w) discard;
  float depthNorm = (vDepthM - uPath.z) / max(1.0, uPath.w - uPath.z);
  if (uVolumeMode == 1) {
    // 调试：只保留目标深度附近的切片，用于和 Cesium 的单深度切片对照。
    float sliceDepthNorm = clamp((uSliceDepthM - uPath.z) / max(1.0, uPath.w - uPath.z), 0.0, 1.0);
    float thickness = max(2.0, (uPath.w - uPath.z) / 64.0);
    if (abs(vDepthM - uSliceDepthM) > thickness) discard;
    depthNorm = sliceDepthNorm;
  }

  // 平滑纹理已经包含 CPU 插值后的方位行和 360° 重复尾行，必须像 Cesium
  // 一样直接按 angleNorm 采样。再次按原始扇区数离散会丢弃插值行并产生巨大扇瓣。
  ivec3 textureShape = textureSize(uVolumeTexture, 0);
  int angleRows = textureShape.y;
  vec4 voxel;
  if (uStrictNearest == 1) {
    // 严格最近邻模式复制 Cesium 的逐节点索引规则。
    int rangeIndex = clamp(
      int(floor(pathNorm * float(textureShape.x - 1) + 0.5)),
      0,
      textureShape.x - 1
    );
    int angleIndex = int(floor(angleNorm * float(angleRows) + 0.5)) % angleRows;
    int depthIndex = clamp(
      int(floor(depthNorm * float(textureShape.z - 1) + 0.5)),
      0,
      textureShape.z - 1
    );
    voxel = texelFetch(uVolumeTexture, ivec3(rangeIndex, angleIndex, depthIndex), 0);
  } else {
    voxel = texture(
      uVolumeTexture,
      clamp(vec3(pathNorm, angleNorm, depthNorm), vec3(0.001), vec3(0.999))
    );
  }
  float coverage = smoothstep(0.015, 0.92, voxel.a);
  vec3 textureShapeF = max(vec3(textureShape), vec3(1.0));
  vec3 texUvw = vec3(pathNorm, angleNorm, depthNorm);
  vec3 edgeWidth = min(vec3(0.12), vec3(1.5) / textureShapeF);
  vec3 edgeLow = smoothstep(vec3(0.0), edgeWidth, texUvw);
  vec3 edgeHigh = smoothstep(vec3(0.0), edgeWidth, vec3(1.0) - texUvw);
  float angleEdge = angleSpan >= 359.5 ? 1.0 : edgeLow.y * edgeHigh.y;
  coverage *= min(min(edgeLow.x * edgeHigh.x, angleEdge), edgeLow.z * edgeHigh.z);

  float effectiveBottomM = 1e20;
  if (uDebugNoTerrain == 0) effectiveBottomM = waterDepth;
  if (uHasBottomDepth == 1 && uDebugNoTerrain == 0) {
    effectiveBottomM = min(effectiveBottomM, mix(uPath.z, uPath.w, voxel.g));
  }
  if (effectiveBottomM < 1e19) {
    if (vDepthM >= effectiveBottomM) discard;
    coverage *= smoothstep(0.0, max(8.0, uFeatherM), effectiveBottomM - vDepthM);
  }
  if (coverage <= 0.001) discard;
  float tl = mix(uValue.x, uValue.y, voxel.r);
  // Cesium treats values above the active display maximum as empty space.
  // Clamping them to the last blue LUT entry fills real cavities after many
  // blended slices and is the main cause of the solid GPU shell.
  if (tl > uDb.y) discard;
  float displayRatio = clamp((tl - uDb.x) / max(1.0, uDb.y - uDb.x), 0.0, 1.0);
  if (uStrictNearest == 0) displayRatio = pow(displayRatio, 0.82);
  vec3 color = texture(uColorLut, vec2(displayRatio, 0.5)).rgb;
  // Match Cesium's strict-nearest density curve and smooth-mode value alpha.
  float opacitySignal;
  if (uStrictNearest == 1) {
    float strictOpacity = 0.56 + 0.44 * clamp((110.0 - tl) / 70.0, 0.0, 1.0);
    opacitySignal = pow(strictOpacity, max(0.1, uAlpha.y));
  } else {
    float valueAlpha = pow(clamp(1.0 - displayRatio, 0.0, 1.0), max(0.1, uAlpha.y));
    opacitySignal = mix(0.08, 1.0, valueAlpha);
  }
  // Match Cesium's step-size-corrected Beer-Lambert integration so opacity
  // stays stable when the slice count or view direction changes.
  float density = max(0.0, uAlpha.x) * 5.5;
  float alpha = clamp(
    1.0 - exp(-density * coverage * opacitySignal * uStepLength),
    0.0,
    0.14
  );
  fragColor = vec4(color, alpha);
}
`

const VOLUME_UNIFORM_NAMES = [
  'uWidth', 'uHeight', 'uScale', 'uPanX', 'uPanY',
  'uCosYaw', 'uSinYaw', 'uCosPitch', 'uSinPitch', 'uExaggeration',
  'uHorizontalSpanM', 'uSliceCenter', 'uSliceExtents',
  'uVolumeTexture', 'uHeightMap', 'uColorLut',
  'uGeo', 'uTerrain', 'uWedge', 'uPath', 'uValue', 'uDb', 'uAlpha', 'uStepLength', 'uClipInfo',
  'uFeatherM', 'uHasBottomDepth', 'uStrictNearest',
  'uVolumeMode', 'uSliceDepthM', 'uDebugNoTerrain',
]

const UNIFORM_NAMES = [
  'uWidth', 'uHeight', 'uScale', 'uPanX', 'uPanY',
  'uCosYaw', 'uSinYaw', 'uCosPitch', 'uSinPitch', 'uExaggeration',
  'uMinElevation', 'uMaxElevation',
  'uColorMap', 'uLightDir', 'uAmbient', 'uDiffuse', 'uMinLight', 'uMaxLight',
  'uZFactor', 'uBrightness', 'uFogColor', 'uFogStrength', 'uInvMin', 'uInvMax',
  'uShadowMap', 'uShadowEnabled',
]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`地形着色器编译失败：${log || '未知错误'}`)
  }
  return shader
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`地形着色器链接失败：${log || '未知错误'}`)
  }
  return program
}

function colorChannel(value, fallback) {
  const number = Number(value)
  return clamp(Number.isFinite(number) ? number : fallback, 0, 255) / 255
}

/**
 * GPU 地形底图：逐片元光照 + 一维色带纹理。
 *
 * 投影公式与 terrainScene.createTerrainProjection 完全一致，因此 2D canvas
 * 上的声线、声场、AIS、参考轴等叠加层无需改动即可对齐。
 */
export class TerrainWebGLRenderer {
  constructor(canvas) {
    if (!canvas) throw new Error('缺少地形 WebGL canvas')
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('浏览器未提供 WebGL2 上下文')

    this.canvas = canvas
    this.gl = gl
    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uniforms = {}
    gl.useProgram(this.program)
    for (const name of UNIFORM_NAMES) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name)
    }

    // GPU 体渲染：切片式三维纹理采样，失败时自动回退到 Canvas 声场体。
    this.volumeProgram = null
    this.volumeUniforms = {}
    try {
      this.volumeProgram = createProgram(gl, VOLUME_VERTEX_SHADER, VOLUME_FRAGMENT_SHADER)
      for (const name of VOLUME_UNIFORM_NAMES) {
        this.volumeUniforms[name] = gl.getUniformLocation(this.volumeProgram, name)
      }
    } catch (error) {
      console.warn('[terrain] GPU 体渲染着色器不可用，回退到 Canvas 声场：', error?.message ?? error)
      this.volumeProgram = null
    }
    this.volumeActive = false
    this.volumeTexture = null
    this.volumeTextureKey = null
    this.volumeDataRef = null
    this.heightTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture)
    // R32F terrain is sampled with explicit bilinear texelFetch in the volume shader,
    // avoiding both 8-bit elevation banding and float-linear extension requirements.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.heightGrid = null
    this.colorLutTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.colorLutTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.colorLutKey = null
    this.volumeGeometry = null
    this.volumeGeometryKey = null

    this.geometry = null
    this.colorKey = null
    this.disposed = false
    this.contextLost = false

    this.colorTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // 自阴影掩膜纹理；默认 1×1 全白，关闭阴影时仍可安全采样。
    this.shadowMask = null
    this.shadowTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]),
    )

    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    this.onContextLost = event => {
      event.preventDefault()
      this.contextLost = true
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost, false)
  }

  disposeGeometry() {
    const gl = this.gl
    if (!this.geometry) return
    gl.deleteVertexArray(this.geometry.vao)
    for (const buffer of this.geometry.buffers) gl.deleteBuffer(buffer)
    gl.deleteBuffer(this.geometry.indexBuffer)
    this.geometry = null
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false)
    this.disposeGeometry()
    this.disposeVolumeGeometry()
    if (this.colorTexture) this.gl.deleteTexture(this.colorTexture)
    if (this.shadowTexture) this.gl.deleteTexture(this.shadowTexture)
    if (this.volumeTexture) this.gl.deleteTexture(this.volumeTexture)
    if (this.heightTexture) this.gl.deleteTexture(this.heightTexture)
    if (this.colorLutTexture) this.gl.deleteTexture(this.colorLutTexture)
    if (this.program) this.gl.deleteProgram(this.program)
    if (this.volumeProgram) this.gl.deleteProgram(this.volumeProgram)
    this.colorTexture = null
    this.shadowTexture = null
    this.volumeTexture = null
    this.heightTexture = null
    this.colorLutTexture = null
    this.shadowMask = null
    this.program = null
    this.volumeProgram = null
  }

  disposeVolumeGeometry() {
    const gl = this.gl
    if (!this.volumeGeometry) return
    gl.deleteVertexArray(this.volumeGeometry.vao)
    gl.deleteBuffer(this.volumeGeometry.buffer)
    this.volumeGeometry = null
  }

  buildGeometry(grid) {
    const gl = this.gl
    this.disposeGeometry()

    const segments = Math.max(1, Math.min(
      TERRAIN_MAX_MESH_SEGMENTS,
      grid.width - 1,
      grid.height - 1,
    ))
    const mesh = terrainMesh(grid, segments)
    if (!mesh.faces.length) return

    const b = grid.bounds
    const cosLat = Math.max(.1, Math.cos((b.north + b.south) * Math.PI / 360))
    const spanX = (b.east - b.west) * cosLat
    const spanY = b.north - b.south
    const span = Math.max(1e-9, Math.max(spanX, spanY))
    const horizontalSpanM = Math.max(1, span * 110574)
    const centerLon = (b.west + b.east) / 2
    const centerLat = (b.south + b.north) / 2

    const count = mesh.vertices.length
    const position = new Float32Array(count * 3)
    const slope = new Float32Array(count * 2)
    const elevation = new Float32Array(count)
    const uv = new Float32Array(count * 2)
    const lonSpan = Math.max(1e-9, b.east - b.west)
    const latSpan = Math.max(1e-9, b.north - b.south)

    mesh.vertices.forEach((vertex, index) => {
      position[index * 3] = (vertex.lon - centerLon) * cosLat / span
      position[index * 3 + 1] = (centerLat - vertex.lat) / span
      position[index * 3 + 2] = vertex.elevation / horizontalSpanM

      slope[index * 2] = Number.isFinite(vertex.slopeX) ? vertex.slopeX : 0
      slope[index * 2 + 1] = Number.isFinite(vertex.slopeY) ? vertex.slopeY : 0
      // 海面 ±0.x m 噪声按海陆掩膜夹到 0，避免色带在海岸处抖动。
      elevation[index] = vertex.sea
        ? Math.min(vertex.elevation, 0)
        : Math.max(vertex.elevation, 0)
      // 阴影掩膜纹理坐标：u 西→东，v 北→南，与 terrainShadowMask 的行列顺序一致。
      uv[index * 2] = (vertex.lon - b.west) / lonSpan
      uv[index * 2 + 1] = (b.north - vertex.lat) / latSpan
    })

    const indices = new Uint32Array(mesh.faces.length * 6)
    mesh.faces.forEach((face, index) => {
      const offset = index * 6
      indices[offset] = face[0]
      indices[offset + 1] = face[1]
      indices[offset + 2] = face[2]
      indices[offset + 3] = face[0]
      indices[offset + 4] = face[2]
      indices[offset + 5] = face[3]
    })

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    const buffers = []
    const addAttribute = (location, size, data) => {
      const buffer = gl.createBuffer()
      buffers.push(buffer)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
    }

    addAttribute(0, 3, position)
    addAttribute(1, 2, slope)
    addAttribute(2, 1, elevation)
    addAttribute(3, 2, uv)

    const indexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

    gl.bindVertexArray(null)

    this.geometry = { grid, vao, buffers, indexBuffer, count: indices.length }
  }

  ensureColorLut(grid, controls) {
    const gl = this.gl
    const showBands = controls?.terrainBands === true
    const min = Number.isFinite(Number(grid.min)) ? Number(grid.min) : -1
    const max = Number.isFinite(Number(grid.max)) ? Number(grid.max) : 1
    const key = `${min}:${max}:${showBands ? 1 : 0}`
    if (this.colorKey === key) return

    const size = 1024
    const data = new Uint8Array(size * 4)
    const landSpan = Math.max(0, max)
    const waterSpan = Math.max(0, -Math.min(0, min))
    const landBand = showBands ? pickBandStep(landSpan, 12) : 0
    const waterBand = showBands ? pickBandStep(waterSpan, 12) : 0

    for (let index = 0; index < size; index++) {
      const ratio = index / (size - 1)
      const value = min + (max - min) * ratio
      const [r, g, b] = terrainColorAt(value, min, max, { landBand, waterBand })
      const offset = index * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
    }

    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data,
    )
    this.colorKey = key
  }

  ensureShadowTexture(grid, azimuthDeg, altitudeDeg, exaggeration) {
    const mask = terrainShadowMask(grid, azimuthDeg, altitudeDeg, exaggeration)
    if (!mask) return false
    if (mask === this.shadowMask) return true
    const gl = this.gl
    const data = new Uint8Array(mask.values.length)
    for (let index = 0; index < mask.values.length; index++) {
      data[index] = Math.round(clamp(mask.values[index], 0, 1) * 255)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8, mask.width, mask.height, 0, gl.RED, gl.UNSIGNED_BYTE, data,
    )
    this.shadowMask = mask
    return true
  }

  ensureHeightTexture(grid) {
    if (this.heightGrid === grid) return
    const gl = this.gl
    const width = Math.max(1, Number(grid.width) || 1)
    const height = Math.max(1, Number(grid.height) || 1)
    const data = new Float32Array(width * height)
    for (let index = 0; index < data.length; index++) {
      const value = Number(grid.values?.[index])
      data[index] = Number.isFinite(value) ? value : 0
    }
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data)
    this.heightGrid = grid
  }

  ensureVolumeColorLut(controls) {
    const gl = this.gl
    const stops = Array.isArray(controls?.colorStops) && controls.colorStops.length >= 2
      ? controls.colorStops
      : [[0, [255, 40, 0]], [1, [0, 0, 127]]]
    const key = JSON.stringify(stops)
    if (this.colorLutKey === key) return
    const size = 256
    const data = new Uint8Array(size * 4)
    for (let index = 0; index < size; index++) {
      const t = index / (size - 1)
      let color = stops[stops.length - 1][1]
      for (let segment = 0; segment < stops.length - 1; segment++) {
        const [start, startColor] = stops[segment]
        const [end, endColor] = stops[segment + 1]
        if (t > end && segment < stops.length - 2) continue
        const ratio = clamp((t - start) / Math.max(1e-6, end - start), 0, 1)
        color = startColor.map((channel, channelIndex) =>
          Math.round(channel + (endColor[channelIndex] - channel) * ratio))
        break
      }
      data[index * 4] = clamp(Number(color?.[0]) || 0, 0, 255)
      data[index * 4 + 1] = clamp(Number(color?.[1]) || 0, 0, 255)
      data[index * 4 + 2] = clamp(Number(color?.[2]) || 0, 0, 255)
      data[index * 4 + 3] = 255
    }
    gl.bindTexture(gl.TEXTURE_2D, this.colorLutTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    this.colorLutKey = key
  }

  ensureVolumeTexture(volume) {
    if (!volume?.data || !(volume.width > 0) || !(volume.height > 0) || !(volume.depth > 0)) return false
    const gl = this.gl
    const meta = volume.wedgeMeta ?? {}
    const key = `${volume.width}x${volume.height}x${volume.depth}:${volume.textureFilter}:${volume.valueMin}:${volume.valueMax}:${meta.sourceLon},${meta.sourceLat},${meta.pathMinM},${meta.pathMaxM},${meta.angleMin},${meta.angleMax},${meta.depthMinM},${meta.depthMaxM}`
    if (this.volumeTexture && this.volumeTextureKey === key && this.volumeDataRef === volume.data) return true
    if (!this.volumeTexture) this.volumeTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA8,
      volume.width, volume.height, volume.depth, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, volume.data,
    )
    // 与主三维体一致：严格最近邻时不做任何插值。平滑纹理已经包含一行
    // 360° 重复尾值，因此使用 CLAMP_TO_EDGE，避免尾行再次跨边界混合。
    const filter = volume.textureFilter === 'nearest' ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    this.volumeTextureKey = key
    this.volumeDataRef = volume.data
    return true
  }

  ensureVolumeGeometry(grid, volume, slices) {
    const gl = this.gl
    const meta = volume.wedgeMeta ?? {}
    const b = grid.bounds
    const depthMin = Number(meta.depthMinM) || 0
    const depthMax = Math.max(depthMin + 1, Number(meta.depthMaxM) || depthMin + 1)
    const key = `${b.west},${b.east},${b.south},${b.north}:${depthMin}:${depthMax}:view-aligned:${slices}`
    if (this.volumeGeometry && this.volumeGeometryKey === key) return
    this.disposeVolumeGeometry()

    const vertices = slices * 6 * 3
    const data = new Float32Array(vertices)
    let offset = 0
    const push = (rx, q, slice) => {
      data[offset++] = rx
      data[offset++] = q
      data[offset++] = slice
    }
    for (let index = 0; index < slices; index++) {
      // Back-to-front planes in normalized view space. Uniforms rotate and scale
      // this unit quad continuously for every yaw/pitch without rebuilding it.
      const slice = -1 + (2 * index) / Math.max(1, slices - 1)
      push(-1, -1, slice)
      push(1, -1, slice)
      push(1, 1, slice)
      push(-1, -1, slice)
      push(1, 1, slice)
      push(-1, 1, slice)
    }

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8)
    gl.bindVertexArray(null)
    this.volumeGeometry = { vao, buffer, count: vertices / 3 }
    this.volumeGeometryKey = key
  }

  renderVolume(grid, volume, controls, view) {
    const gl = this.gl
    this.volumeActive = false
    if (!this.volumeProgram || !volume) return false
    if (!this.ensureVolumeTexture(volume)) return false
    this.ensureHeightTexture(grid)
    this.ensureVolumeColorLut(controls)
    const sliceCount = terrainVolumeSliceCount(controls?.sampling)
    this.ensureVolumeGeometry(grid, volume, sliceCount)
    if (!this.volumeGeometry) return false

    const meta = volume.wedgeMeta ?? {}
    const b = grid.bounds
    const u = this.volumeUniforms
    gl.useProgram(this.volumeProgram)
    gl.uniform1f(u.uWidth, view.width)
    gl.uniform1f(u.uHeight, view.height)
    gl.uniform1f(u.uScale, view.scale)
    gl.uniform1f(u.uPanX, view.panX)
    gl.uniform1f(u.uPanY, view.panY)
    gl.uniform1f(u.uCosYaw, view.cosYaw)
    gl.uniform1f(u.uSinYaw, view.sinYaw)
    gl.uniform1f(u.uCosPitch, view.cosPitch)
    gl.uniform1f(u.uSinPitch, view.sinPitch)
    gl.uniform1f(u.uExaggeration, view.exaggeration)
    gl.uniform1f(u.uHorizontalSpanM, view.horizontalSpanM)
    const centerLon = (b.west + b.east) / 2
    const centerLat = (b.south + b.north) / 2
    const lonMin = Number.isFinite(Number(volume.lonMin)) ? Number(volume.lonMin) : b.west
    const lonMax = Number.isFinite(Number(volume.lonMax)) ? Number(volume.lonMax) : b.east
    const latMin = Number.isFinite(Number(volume.latMin)) ? Number(volume.latMin) : b.south
    const latMax = Number.isFinite(Number(volume.latMax)) ? Number(volume.latMax) : b.north
    const localXMin = (lonMin - centerLon) * view.cosLat / view.span
    const localXMax = (lonMax - centerLon) * view.cosLat / view.span
    const localYMin = (centerLat - latMax) / view.span
    const localYMax = (centerLat - latMin) / view.span
    const depthMin = Number(meta.depthMinM) || 0
    const depthMax = Math.max(depthMin + 1, Number(meta.depthMaxM) || depthMin + 1)
    const zTop = -depthMin / view.horizontalSpanM * view.exaggeration
    const zBottom = -depthMax / view.horizontalSpanM * view.exaggeration
    const viewCorners = []
    for (const x of [localXMin, localXMax]) {
      for (const y of [localYMin, localYMax]) {
        for (const z of [zBottom, zTop]) {
          const rx = x * view.cosYaw - y * view.sinYaw
          const ry = x * view.sinYaw + y * view.cosYaw
          viewCorners.push({
            rx,
            q: ry * view.sinPitch - z * view.cosPitch,
            s: ry * view.cosPitch + z * view.sinPitch,
          })
        }
      }
    }
    const rxMin = Math.min(...viewCorners.map(point => point.rx))
    const rxMax = Math.max(...viewCorners.map(point => point.rx))
    const qMin = Math.min(...viewCorners.map(point => point.q))
    const qMax = Math.max(...viewCorners.map(point => point.q))
    const sMin = Math.min(...viewCorners.map(point => point.s))
    const sMax = Math.max(...viewCorners.map(point => point.s))
    const rxCenter = (rxMin + rxMax) / 2
    const qCenter = (qMin + qMax) / 2
    const sCenter = (sMin + sMax) / 2
    const rxExtent = (rxMax - rxMin) / 2
    const qExtent = (qMax - qMin) / 2
    const sExtent = (sMax - sMin) / 2
    gl.uniform3f(u.uSliceCenter, rxCenter, qCenter, sCenter)
    gl.uniform3f(
      u.uSliceExtents,
      Math.max(1e-6, rxExtent),
      Math.max(1e-6, qExtent),
      Math.max(1e-6, sExtent),
    )
    gl.uniform4f(u.uGeo, (b.west + b.east) / 2, (b.south + b.north) / 2, view.span, view.cosLat)
    gl.uniform4f(u.uTerrain, b.west, b.east, b.south, b.north)
    gl.uniform4f(
      u.uWedge,
      Number(meta.sourceLon) || 0,
      Number(meta.sourceLat) || 0,
      Number.isFinite(Number(meta.angleMin)) ? Number(meta.angleMin) : 0,
      Number.isFinite(Number(meta.angleMax)) ? Number(meta.angleMax) : 360,
    )
    gl.uniform4f(
      u.uPath,
      Number.isFinite(Number(meta.pathMinM)) ? Number(meta.pathMinM) : 0,
      Number.isFinite(Number(meta.pathMaxM)) ? Number(meta.pathMaxM) : 1,
      Number.isFinite(Number(meta.depthMinM)) ? Number(meta.depthMinM) : 0,
      Number.isFinite(Number(meta.depthMaxM)) ? Number(meta.depthMaxM) : 1,
    )
    gl.uniform2f(u.uValue, Number(volume.valueMin) || 0, Number(volume.valueMax) || 1)
    gl.uniform2f(
      u.uDb,
      Number.isFinite(Number(controls?.dbMin)) ? Number(controls.dbMin) : 45,
      Number.isFinite(Number(controls?.dbMax)) ? Number(controls.dbMax) : 128,
    )
    const opacity = clamp(Number.isFinite(Number(controls?.opacity)) ? Number(controls.opacity) : 1.7, 0.2, 5)
    const requestedAlphaScale = Number(controls?.alphaScale)
    gl.uniform2f(
      u.uAlpha,
      Number.isFinite(requestedAlphaScale)
        ? requestedAlphaScale
        : CESIUM_DEFAULT_ALPHA_SCALE * Math.pow(opacity / TERRAIN_DEFAULT_OPACITY, 0.55),
      clamp(Number.isFinite(Number(controls?.alphaPower)) ? Number(controls.alphaPower) : 1.3, 0.35, 3),
    )
    gl.uniform1f(u.uStepLength, 1 / Math.max(1, sliceCount - 1))
    const internalAzimuth = Number(controls?.clipAzimuthDeg)
    const compassAzimuth = Number.isFinite(internalAzimuth)
      ? ((90 - internalAzimuth) % 360 + 360) % 360
      : 0
    gl.uniform3f(u.uClipInfo, controls?.clipGpuVolume === true ? 1 : 0, compassAzimuth, 0)
    const featherDepthMin = Number.isFinite(Number(meta.depthMinM)) ? Number(meta.depthMinM) : 0
    const featherDepthMax = Number.isFinite(Number(meta.depthMaxM)) ? Number(meta.depthMaxM) : featherDepthMin + 1
    const featherDepthSpan = Math.max(1, featherDepthMax - featherDepthMin)
    gl.uniform1f(u.uFeatherM, Math.max(8, Math.min(160, featherDepthSpan * 0.25)))
    gl.uniform1i(u.uHasBottomDepth, volume.hasBottomDepth ? 1 : 0)
    const debug = globalThis.__acousticVolumeDebug ?? {}
    gl.uniform1i(u.uStrictNearest, volume.strictNearest === true ? 1 : 0)
    gl.uniform1i(u.uVolumeMode, debug.volumeMode === 'slice' ? 1 : 0)
    gl.uniform1f(u.uSliceDepthM, Number.isFinite(Number(debug.sliceDepthM)) ? Number(debug.sliceDepthM) : 150)
    gl.uniform1i(u.uDebugNoTerrain, debug.disableTerrainClip === true ? 1 : 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture)
    gl.uniform1i(u.uVolumeTexture, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.heightTexture)
    gl.uniform1i(u.uHeightMap, 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.colorLutTexture)
    gl.uniform1i(u.uColorLut, 2)

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    gl.bindVertexArray(this.volumeGeometry.vao)
    gl.drawArrays(gl.TRIANGLES, 0, this.volumeGeometry.count)
    gl.bindVertexArray(null)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)
    gl.activeTexture(gl.TEXTURE0)
    this.volumeActive = true
    return true
  }

  render(grid, camera, controls = {}, volume = null) {
    if (this.disposed) return
    if (this.contextLost || this.gl.isContextLost()) {
      throw new Error('地形 WebGL 上下文已丢失')
    }

    const gl = this.gl
    const canvas = this.canvas
    const rect = canvas.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    if (!(width > 0 && height > 0)) return false

    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const pixelWidth = Math.max(1, Math.round(width * dpr))
    const pixelHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    gl.viewport(0, 0, pixelWidth, pixelHeight)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    if (!grid) return false
    if (!this.geometry || this.geometry.grid !== grid) this.buildGeometry(grid)
    if (!this.geometry) return false
    this.ensureColorLut(grid, controls)

    const b = grid.bounds
    const cosLat = Math.max(.1, Math.cos((b.north + b.south) * Math.PI / 360))
    const spanX = (b.east - b.west) * cosLat
    const spanY = b.north - b.south
    const span = Math.max(1e-9, Math.max(spanX, spanY))
    const horizontalSpanM = Math.max(1, span * 110574)

    const yaw = Number(camera?.yaw) || 0
    const pitch = Number.isFinite(Number(camera?.pitch)) ? Number(camera.pitch) : 0.68
    const zoom = Number.isFinite(Number(camera?.zoom)) ? Number(camera.zoom) : 1
    const panX = Number(camera?.panX) || 0
    const panY = Number(camera?.panY) || 0
    const exaggeration = normalizeExaggeration(controls?.terrainExaggeration)
    const scale = Math.min(width * .72, height * 1.2) * zoom
    const sinYaw = Math.sin(yaw)
    const cosYaw = Math.cos(yaw)
    const sinPitch = Math.sin(pitch)
    const cosPitch = Math.cos(pitch)

    // perspective 依赖旋转后的 ry 和俯仰角；正俯视时强度为 0。
    const halfX = spanX / (2 * span)
    const halfY = spanY / (2 * span)
    let invMin = Infinity
    let invMax = -Infinity
    for (const x of [-halfX, halfX]) {
      for (const y of [-halfY, halfY]) {
        const ry = x * sinYaw + y * cosYaw
        const perspectiveStrength = .35 * Math.abs(cosPitch)
        const inv = 1 / (1 - ry * perspectiveStrength)
        if (inv < invMin) invMin = inv
        if (inv > invMax) invMax = inv
      }
    }

    const showFog = controls?.terrainFog !== false
    const fogStrength = showFog
      ? clamp(Number.isFinite(Number(controls?.terrainFogStrength))
        ? Number(controls.terrainFogStrength) : .6, 0, 1)
      : 0
    const fog = Array.isArray(controls?.terrainFogColor) && controls.terrainFogColor.length === 3
      ? controls.terrainFogColor
      : [7, 19, 30]

    const lightAzimuthDeg = Number.isFinite(Number(controls?.lightAzimuthDeg))
      ? Number(controls.lightAzimuthDeg) : terrainLighting.hillshadeAzimuth
    const lightAltitudeDeg = Number.isFinite(Number(controls?.lightAltitudeDeg))
      ? Number(controls.lightAltitudeDeg) : terrainLighting.hillshadeAltitude
    const azimuth = lightAzimuthDeg * Math.PI / 180
    const altitude = lightAltitudeDeg * Math.PI / 180
    const min = Number.isFinite(Number(grid.min)) ? Number(grid.min) : -1
    const max = Number.isFinite(Number(grid.max)) ? Number(grid.max) : 1
    const shadowEnabled = controls?.terrainShadows === true
      && this.ensureShadowTexture(grid, lightAzimuthDeg, lightAltitudeDeg, exaggeration)

    const u = this.uniforms
    gl.useProgram(this.program)
    gl.uniform1f(u.uWidth, width)
    gl.uniform1f(u.uHeight, height)
    gl.uniform1f(u.uScale, scale)
    gl.uniform1f(u.uPanX, panX)
    gl.uniform1f(u.uPanY, panY)
    gl.uniform1f(u.uCosYaw, cosYaw)
    gl.uniform1f(u.uSinYaw, sinYaw)
    gl.uniform1f(u.uCosPitch, cosPitch)
    gl.uniform1f(u.uSinPitch, sinPitch)
    gl.uniform1f(u.uExaggeration, exaggeration)
    gl.uniform1f(u.uMinElevation, min)
    gl.uniform1f(u.uMaxElevation, max)

    gl.uniform3f(
      u.uLightDir,
      Math.sin(azimuth) * Math.cos(altitude),
      Math.cos(azimuth) * Math.cos(altitude),
      Math.sin(altitude),
    )
    gl.uniform1f(u.uAmbient, terrainLighting.ambient)
    gl.uniform1f(u.uDiffuse, terrainLighting.diffuse)
    gl.uniform1f(u.uMinLight, terrainLighting.minLight)
    gl.uniform1f(u.uMaxLight, terrainLighting.maxLight)
    gl.uniform1f(u.uZFactor, exaggeration)
    gl.uniform1f(u.uBrightness, clamp(
      Number.isFinite(Number(controls?.terrainBrightness)) ? Number(controls.terrainBrightness) : 1,
      0.5,
      4
    ))
    gl.uniform3f(
      u.uFogColor,
      colorChannel(fog[0], 0),
      colorChannel(fog[1], 0),
      colorChannel(fog[2], 0),
    )
    gl.uniform1f(u.uFogStrength, fogStrength)
    gl.uniform1f(u.uInvMin, invMin)
    gl.uniform1f(u.uInvMax, invMax)
    gl.uniform1f(u.uShadowEnabled, shadowEnabled ? 1 : 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture)
    gl.uniform1i(u.uColorMap, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture)
    gl.uniform1i(u.uShadowMap, 1)
    gl.activeTexture(gl.TEXTURE0)

    gl.bindVertexArray(this.geometry.vao)
    gl.drawElements(gl.TRIANGLES, this.geometry.count, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)

    // 地形之后绘制体，并关闭伪深度测试：避免不同拖拽角度下整块声场被
    // 地形深度误判而消失；海底以下仍由片元着色器按真实水深裁剪。
    this.renderVolume(grid, volume, controls, {
      width, height, scale, panX, panY, cosYaw, sinYaw, cosPitch, sinPitch,
      exaggeration, horizontalSpanM, span, cosLat, halfX, halfY,
    })
    return true
  }
}

export function createTerrainWebGLRenderer(canvas) {
  try {
    return new TerrainWebGLRenderer(canvas)
  } catch (error) {
    console.warn('[terrain] WebGL 地形初始化失败，回退到 Canvas 渲染：', error)
    return null
  }
}
