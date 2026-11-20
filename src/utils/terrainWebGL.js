import {
  TERRAIN_MAX_MESH_SEGMENTS,
  normalizeExaggeration,
  pickBandStep,
  terrainColorAt,
  terrainLighting,
  terrainMesh,
  terrainShadowMask,
} from './terrainRendering.js'

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
  float perspective = 1.0 / (1.0 - ry * 0.35);

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
    if (this.colorTexture) this.gl.deleteTexture(this.colorTexture)
    if (this.shadowTexture) this.gl.deleteTexture(this.shadowTexture)
    if (this.program) this.gl.deleteProgram(this.program)
    this.colorTexture = null
    this.shadowTexture = null
    this.shadowMask = null
    this.program = null
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

  render(grid, camera, controls = {}) {
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

    // perspective 只依赖旋转后的 ry，矩形四角即可得到精确的雾浓度范围。
    const halfX = spanX / (2 * span)
    const halfY = spanY / (2 * span)
    let invMin = Infinity
    let invMax = -Infinity
    for (const x of [-halfX, halfX]) {
      for (const y of [-halfY, halfY]) {
        const ry = x * sinYaw + y * cosYaw
        const inv = 1 / (1 - ry * .35)
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
