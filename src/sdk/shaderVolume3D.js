/**
 * shaderVolume3D.js — Cesium 三维声场体渲染核心
 * =============================================
 *
 * 基于 WebGL2 `sampler3D` 的 ray-marching（光线步进）体渲染实现，
 * 将传播损失（TL）体数据渲染为半透明的彩色体：
 *
 *   - `finalizeVolumeTexture`：为体纹理补全定位/包围球等渲染字段
 *   - `RawTexture3D`：上传 RGBA 字节为 WebGL2 3D 纹理
 *   - `ShaderVolume3DPrimitive`：经纬直角体渲染（lon×lat×depth）
 *   - `WedgeShaderVolume3DPrimitive`：楔形体渲染（geo→极坐标再采样）
 *   - `NcPolarShaderVolume3DPrimitive`：NC 极坐标体 + 可旋转切面
 *   - 视角控制：全景 / 俯视 / 沿切面侧视
 */
import { normalizeColorStops } from './tlColor.js'

const Cesium = window.GeoVis

const TEXTURE_DATA_IDS = new WeakMap()
let nextTextureDataId = 0

/** 为同一份体素数据分配稳定 id，避免深度夸张重建后误判为新纹理 */
function ensureTextureDataId(data) {
  if (!data || typeof data !== 'object') return 0
  let id = TEXTURE_DATA_IDS.get(data)
  if (!id) {
    id = ++nextTextureDataId
    TEXTURE_DATA_IDS.set(data, id)
  }
  return id
}

/**
 * 判断体/剖面所在位置是否被地球遮挡（转到了地球背面）。
 * 用体在地表的中心点做椭球遮挡测试：位于近地面半球的点可见，背面被遮挡。
 * 水下体因关闭了深度测试，若无此判断，即使转到地球背面也会“浮”在画面上。
 */
function isVolumeOccludedByGlobe(frameState, volume) {
  if (!volume) return false
  const occluder = frameState?.occluder
  if (!occluder || typeof occluder.isPointVisible !== 'function') return false
  const lon = Number.isFinite(Number(volume.focusCenterLon))
    ? Number(volume.focusCenterLon)
    : (Number(volume.lonMin) + Number(volume.lonMax)) / 2
  const lat = Number.isFinite(Number(volume.focusCenterLat))
    ? Number(volume.focusCenterLat)
    : (Number(volume.latMin) + Number(volume.latMax)) / 2
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  try {
    return !occluder.isPointVisible(Cesium.Cartesian3.fromDegrees(lon, lat, 0))
  } catch {
    return false
  }
}

/** 体渲染光线步进最大步数 */
export const MAX_MARCH_STEPS = 512
/** 体透明度默认缩放系数 */
// UI 与 GPU 使用相同的 0–1 语义：0 完全不可见，1 完整显示。
export const DEFAULT_ALPHA_SCALE = 1
/**
 * TL 值 → 每步 alpha 系数的默认区间 `[低值端系数, 高值端系数]`。
 *
 * 用于体渲染「色标透明度」：TL 越小（60 dB，红）alpha 越大（越实），
 * TL 越大（120 dB，蓝）alpha 越小（越透明），alpha 沿色标由 1 递减到 0.15。
 * 与整体体透明度 `alphaScale` 相互独立。
 */
export const DEFAULT_VALUE_ALPHA_RANGE = [1.0, 0]
/** 体渲染色标最大控制点数（与 shader 中 u_colorStops 数组长度一致） */
// custom/Bellhop 色带包含 8 个控制点；全部保留才能与二维 TL 图逐色一致。
export const MAX_COLOR_STOPS = 8
/** 体渲染切面模式：0 方位 1 深度 2 经度 3 纬度 */
export const VOLUME_SLICE_MODE = {
  azimuth: 0,
  depth: 1,
  lon: 2,
  lat: 3,
}
/** 体边缘羽化半径（体素单位） */
const VOLUME_EDGE_FEATHER_CELLS = 1.35
/** 覆盖率下阈值：低于此值体素视为不可见 */
const VOLUME_MIN_COVERAGE = 0.16
/** 覆盖率上阈值：高于此值体素视为完全覆盖 */
const VOLUME_FULL_COVERAGE = 0.72
/** 深度层边界线的视觉强度 */
const LAYER_VISUAL_STRENGTH = 0.42
/** 深度层边界线的视觉宽度 */
const LAYER_VISUAL_WIDTH = 0.07
/** 全景视角下相机距离缩放系数（相对包围球半径） */
const OVERVIEW_RANGE_SCALE = 3.2

/**
 * 计算两经纬度点间的表面距离（米）。
 * @param {[number, number]} start - 起点 [lon, lat]
 * @param {[number, number]} end - 终点 [lon, lat]
 * @returns {number} 表面距离（米），最小 1
 */
export function getLonLatDistanceMeters(start, end) {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(start[0], start[1]),
    Cesium.Cartographic.fromDegrees(end[0], end[1])
  )
  return Math.max(1, geodesic.surfaceDistance || 1)
}

/** 水上抬升时，最浅层距海平面的留白（米） */
export const VOLUME_SURFACE_MARGIN_M = 30

/**
 * 为体渲染补全 Cesium 相关字段（体渲染前的最后一道加工）。
 *
 * 输入为「解码后的纹理对象」，本函数依据其经纬度/深度边界计算：
 *   - 局部半宽 / 半高（用于 shader 内把单位立方体缩放为实际体）
 *   - 顶 / 底海拔（深度夸张后，水下为负海拔）
 *   - modelMatrix（把体定位到地球上的局部 ENU 坐标系）
 *   - worldBoundingSphere（视锥裁剪用包围球）
 *
 * @param {object} texture - 解码后的体纹理对象（需含 lon/lat/depth 边界与 depthValues）
 * @param {number} [depthExaggeration=10] 深度夸张倍数（放大垂直尺度，突出浅层细节）
 * @param {object} [finalizeOptions]
 * @param {boolean} [finalizeOptions.displayAboveWater] 将整个体抬升到海平面以上（仅视觉）
 * @param {number} [finalizeOptions.surfaceMarginM] 抬升后最浅层距海平面高度（米）
 * @returns {object} 补全后的体对象（在原纹理基础上新增定位/包围球字段）
 */
export function finalizeVolumeTexture(texture, depthExaggeration = 10, finalizeOptions = {}) {
  const { displayAboveWater = false, surfaceMarginM = VOLUME_SURFACE_MARGIN_M } = finalizeOptions
  const centerLon = (texture.lonMin + texture.lonMax) / 2
  const centerLat = (texture.latMin + texture.latMax) / 2
  const localWidth = getLonLatDistanceMeters(
    [texture.lonMin, centerLat],
    [texture.lonMax, centerLat]
  )
  const localHeight = getLonLatDistanceMeters(
    [centerLon, texture.latMin],
    [centerLon, texture.latMax]
  )
  const localHalfWidth = Math.max(1, localWidth / 2)
  const localHalfHeight = Math.max(1, localHeight / 2)

  const depthMin = texture.depthValues[0] ?? 0
  const depthMax = texture.depthValues[texture.depthValues.length - 1] ?? depthMin + 1
  const exag = Math.max(0.5, depthExaggeration)

  let topAltitude = -depthMin * exag
  let bottomAltitude = -depthMax * exag
  let displayAltitudeOffset = 0
  if (displayAboveWater) {
    // 将整个体抬升到海平面以上（bottom 贴到海面 margin 处），避免被 globe 遮挡导致边缘消失
    displayAltitudeOffset = -bottomAltitude + surfaceMarginM
    topAltitude += displayAltitudeOffset
    bottomAltitude += displayAltitudeOffset
  }

  const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0)
  )

  const worldCorners = [
    Cesium.Cartesian3.fromDegrees(texture.lonMin, texture.latMin, bottomAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMax, texture.latMin, bottomAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMax, texture.latMax, bottomAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMin, texture.latMax, bottomAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMin, texture.latMin, topAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMax, texture.latMin, topAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMax, texture.latMax, topAltitude),
    Cesium.Cartesian3.fromDegrees(texture.lonMin, texture.latMax, topAltitude),
  ]

  // 接口给出的外包矩形可能覆盖大面积陆地。地形裁剪后用真正仍有体素的
  // 水域范围生成取景包围球，避免剩余声场在完整 70+ km 视野中小到不可见。
  const visibleBounds = texture.visibleGeoBounds
  let focusBoundingSphere = null
  let focusCenterLon = centerLon
  let focusCenterLat = centerLat
  if (
    visibleBounds &&
    [
      visibleBounds.lonMin,
      visibleBounds.lonMax,
      visibleBounds.latMin,
      visibleBounds.latMax,
    ].every(Number.isFinite)
  ) {
    focusCenterLon = (visibleBounds.lonMin + visibleBounds.lonMax) / 2
    focusCenterLat = (visibleBounds.latMin + visibleBounds.latMax) / 2
    const focusCorners = [
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMin, visibleBounds.latMin, bottomAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMax, visibleBounds.latMin, bottomAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMax, visibleBounds.latMax, bottomAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMin, visibleBounds.latMax, bottomAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMin, visibleBounds.latMin, topAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMax, visibleBounds.latMin, topAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMax, visibleBounds.latMax, topAltitude),
      Cesium.Cartesian3.fromDegrees(visibleBounds.lonMin, visibleBounds.latMax, topAltitude),
    ]
    focusBoundingSphere = Cesium.BoundingSphere.fromPoints(focusCorners)
  }

  return {
    ...texture,
    localHalfWidth,
    localHalfHeight,
    topAltitude,
    bottomAltitude,
    depthExaggeration: exag,
    displayAboveWater,
    displayAltitudeOffset,
    modelMatrix,
    worldBoundingSphere: Cesium.BoundingSphere.fromPoints(worldCorners),
    focusBoundingSphere,
    focusCenterLon,
    focusCenterLat,
  }
}

/**
 * 从 Cesium 的 Context 中提取 WebGL2 上下文（仅当支持 3D 纹理时）。
 *
 * Cesium 封装的 Context 不直接暴露原生 GL，需从内部字段取回。
 * 若环境不支持 WebGL2 / sampler3D，返回 null。
 *
 * @param {object} context - Cesium 的 Context（frameState.context）
 * @returns {WebGL2RenderingContext|null} 原生 WebGL2 上下文，不支持时返回 null
 */
function getWebGL2RenderingContext(context) {
  const gl = context?._gl || context?.gl || context?._originalGLContext
  if (!gl) return null
  const hasTexture3D =
    typeof gl.TEXTURE_3D === 'number' &&
    typeof gl.texImage3D === 'function' &&
    typeof gl.texParameteri === 'function'
  if (!hasTexture3D) return null
  return gl
}

/**
 * WebGL2 3D 纹理封装：将 RGBA 字节体数据上传为 sampler3D。
 *
 * 体数据布局：RGBA，其中 R 通道存归一化数值、A 通道存覆盖率（边缘羽化用）。
 */
class RawTexture3D {
  /**
   * @param {WebGL2RenderingContext} gl - WebGL2 上下文
   * @param {object} volume - 体数据，含 width/height/depth/data/valueMin/valueMax 等
   */
  constructor(gl, volume) {
    this.gl = gl
    this._target = gl.TEXTURE_3D
    this._texture = null
    this.destroyed = false
    this.width = volume.width
    this.height = volume.height
    this.depth = volume.depth

    const max3DSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)
    if (volume.width > max3DSize || volume.height > max3DSize || volume.depth > max3DSize) {
      throw new Error(
        `3D纹理 ${volume.width}x${volume.height}x${volume.depth} 超过 MAX_3D_TEXTURE_SIZE=${max3DSize}`
      )
    }

    const texture = gl.createTexture()
    if (!texture) throw new Error('创建 WebGL2 3D 纹理失败')

    this._texture = texture
    gl.bindTexture(gl.TEXTURE_3D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    // texImage3D 不允许 FLIP_Y / PREMULTIPLY_ALPHA（Cesium 全局默认可能为 true）
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL != null) {
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    }
    const useNearest = volume.textureFilter === 'nearest'
    const filter = useNearest ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA,
      volume.width,
      volume.height,
      volume.depth,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      volume.data
    )
    gl.bindTexture(gl.TEXTURE_3D, null)
  }

  isDestroyed() {
    return this.destroyed
  }

  destroy() {
    if (!this.destroyed && this._texture) {
      this.gl.deleteTexture(this._texture)
    }
    this._texture = null
    this.destroyed = true
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * 将色标数组规范化为固定长度的 uniform 数据：
 *   - `stops`：MAX_COLOR_STOPS 个 Cartesian4（xyz=RGB 0–1，w=归一化位置 t）
 *   - `count`：实际控制点数量（≥2）
 *
 * 传入的色标若控制点不足/无效，则回退到 VOLUME_TL_COLOR_STOPS。
 * @param {Array<[number, [number, number, number]]>|undefined} stops 色标数组
 * @returns {{ stops: Cesium.Cartesian4[], count: number }}
 */
/** 色标数组内容比较（避免每帧因新数组引用而重建 uniform） */
function colorStopsEqual(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p = a[i]
    const q = b[i]
    if (!p || !q || p[0] !== q[0]) return false
    const pc = p[1]
    const qc = q[1]
    if (!pc || !qc || pc.length !== qc.length) return false
    for (let k = 0; k < pc.length; k++) if (pc[k] !== qc[k]) return false
  }
  return true
}

function buildColorStopUniforms(stops) {
  const normalized = normalizeColorStops(stops)
  // 若控制点超过 MAX_COLOR_STOPS，均匀抽样以适配 shader 固定数组
  let sampled = normalized
  if (normalized.length > MAX_COLOR_STOPS) {
    sampled = []
    for (let i = 0; i < MAX_COLOR_STOPS; i++) {
      const idx = Math.round((i * (normalized.length - 1)) / (MAX_COLOR_STOPS - 1))
      sampled.push(normalized[idx])
    }
  }
  const arr = new Array(MAX_COLOR_STOPS)
  for (let i = 0; i < MAX_COLOR_STOPS; i++) {
    const [t, c] = sampled[i] ?? sampled[sampled.length - 1]
    arr[i] = new Cesium.Cartesian4(c[0] / 255, c[1] / 255, c[2] / 255, t)
  }
  return { stops: arr, count: sampled.length }
}

/**
 * 经纬直角体渲染 primitive（基础类）。
 *
 * 通过自定义 DrawCommand + 顶点/片段着色器，把「经纬 × 深度」的直角体纹理
 * 以 ray-marching 方式渲染为半透明彩色体。纹理坐标 (u,v,w) 直接对应体素的
 * 经纬深归一化坐标，不做极坐标映射（极坐标映射由子类 Wedge 实现）。
 *
 * 派生类需实现 `createResources`（构建顶点/索引/纹理/着色器）与 `update`
 * （每帧计算 uniform 并提交 DrawCommand）。
 */
export class ShaderVolume3DPrimitive {
  /**
   * @param {object} options - 渲染参数，见 SoundField.sync() 组装的 options
   */
  constructor(options) {
    this.options = options
    this.command = undefined
    this.vertexArray = undefined
    this.shaderProgram = undefined
    this.texture3D = undefined
    this.renderState = undefined
    this.renderStateInside = undefined
    this.destroyed = false
    // show=false 时本帧不提交 DrawCommand（用于「三维声场体」显隐，无需移出集合）
    this.show = true
    this.textureDataKey = ''
    this.lastError = null
  }

  /** 更新渲染参数（不重建底层资源，仅替换 options 引用） */
  updateOptions(options) {
    this.options = options
  }

  /**
   * 生成体纹理的唯一标识（用于判断是否需要重建 3D 纹理）。
   * 只取决于像素数据本身，深度夸张等纯几何参数变化不会触发整纹理重传。
   */
  getTextureDataKey(volume) {
    return [
      ensureTextureDataId(volume.data),
      volume.width,
      volume.height,
      volume.depth,
      volume.valueMin,
      volume.valueMax,
      volume.textureFilter ?? '',
    ].join('|')
  }

  /** 返回最近一次渲染错误（update 中捕获），无错误时为 null */
  getError() {
    return this.lastError
  }

  /** 是否已销毁 */
  isDestroyed() {
    return this.destroyed
  }

  /** 释放顶点数组、着色器、3D 纹理等 GPU 资源 */
  destroy() {
    this.destroyed = true
    this.command = undefined
    // 释放每帧复用缓存（色标 / 逆矩阵 / uniform 容器）
    this._colorStopUniforms = undefined
    this._colorStopsSource = undefined
    this._inverseModel = undefined
    this._inverseModelSource = undefined
    this._cameraLocal = undefined
    this._cameraUvw = undefined
    this._emptyStops = undefined
    this.ncUniforms = undefined
    this.ncUniformMap = undefined
    if (this.vertexArray && !this.vertexArray.isDestroyed?.()) this.vertexArray.destroy()
    if (this.shaderProgram && !this.shaderProgram.isDestroyed?.()) this.shaderProgram.destroy()
    if (this.texture3D && !this.texture3D.isDestroyed()) this.texture3D.destroy()
    this.vertexArray = undefined
    this.shaderProgram = undefined
    this.texture3D = undefined
    this.renderState = undefined
    this.renderStateInside = undefined
    this.textureDataKey = ''
  }

  /**
   * 色标 uniform 缓存：内容未变时复用（避免每帧排序 + 构造 Cartesian4 数组）。
   * @param {Array<[number, [number, number, number]]>} stops
   * @returns {{ stops: Cesium.Cartesian4[], count: number }}
   */
  ensureColorStopUniforms(stops) {
    if (this._colorStopUniforms && colorStopsEqual(this._colorStopsSource, stops)) {
      return this._colorStopUniforms
    }
    this._colorStopUniforms = buildColorStopUniforms(stops)
    this._colorStopsSource = Array.isArray(stops) ? stops.slice() : stops
    return this._colorStopUniforms
  }

  /**
   * 相机在体局部坐标系中的归一化坐标（uvw）。
   *
   * 逆模型矩阵按 `volume.modelMatrix` 实例缓存（体 finalize / refinalize 后才变化），
   * 中间结果复用同一 Cartesian3，避免每帧执行 4×4 求逆与对象分配。
   *
   * @param {object} volume 已 finalize 的体数据
   * @param {object} frameState Cesium frameState
   * @returns {Cesium.Cartesian3} 复用的 cameraUvw 实例
   */
  computeCameraUvw(volume, frameState) {
    if (this._inverseModelSource !== volume.modelMatrix) {
      this._inverseModel = Cesium.Matrix4.inverseTransformation(
        volume.modelMatrix,
        this._inverseModel ?? new Cesium.Matrix4()
      )
      this._inverseModelSource = volume.modelMatrix
    }
    if (!this._cameraLocal) this._cameraLocal = new Cesium.Cartesian3()
    if (!this._cameraUvw) this._cameraUvw = new Cesium.Cartesian3()

    const local = Cesium.Matrix4.multiplyByPoint(
      this._inverseModel,
      frameState.camera.positionWC,
      this._cameraLocal
    )
    const altSpan = volume.bottomAltitude - volume.topAltitude || 1
    this._cameraUvw.x = local.x / (volume.localHalfWidth * 2) + 0.5
    this._cameraUvw.y = local.y / (volume.localHalfHeight * 2) + 0.5
    this._cameraUvw.z = (local.z - volume.topAltitude) / altSpan
    return this._cameraUvw
  }

  /**
   * 创建（首次）并返回 NC 极坐标体可复用的 uniform 容器与 uniformMap。
   *
   * 原实现每帧重建 uniformMap，并在每个 getter 内 new 一个 Cesium 对象
   * （12 个 Cartesian4 / Cartesian2 / Cartesian3）；改为一次性创建、每帧就地改值后，
   * update() 由「每帧十余次分配 + 一次色标排序」降为「零分配」。
   *
   * @returns {object} uniform 容器（字段为复用的 Cesium 向量实例）
   */
  ensureNcUniforms() {
    if (this.ncUniformMap && this.ncUniforms) return this.ncUniforms

    const v4 = () => new Cesium.Cartesian4()
    const u = {
      localBox: v4(),
      geoBounds: v4(),
      wedgeMeta: v4(),
      wedgeMeta2: v4(),
      sliceInfo: v4(),
      sliceMeta: v4(),
      valueInfo: v4(),
      colorInfo: v4(),
      depthInfo: v4(),
      alphaByValue: new Cesium.Cartesian2(),
      displayTuning: new Cesium.Cartesian3(1, 1, 1),
      cameraUvw: new Cesium.Cartesian3(),
      sampleStep: 0.01,
      strictNearest: 0,
      hasBottomDepth: 0,
      featherM: 160,
    }
    this.ncUniforms = u
    this.ncUniformMap = {
      u_volumeTexture: () => this.texture3D,
      u_colorStops: () => this._colorStopUniforms?.stops ?? this._emptyColorStops(),
      u_colorStopCount: () => this.colorStopCount ?? 0,
      u_localBox: () => u.localBox,
      u_geoBounds: () => u.geoBounds,
      u_wedgeMeta: () => u.wedgeMeta,
      u_wedgeMeta2: () => u.wedgeMeta2,
      u_sliceInfo: () => u.sliceInfo,
      u_sliceMeta: () => u.sliceMeta,
      u_alphaByValue: () => u.alphaByValue,
      u_displayTuning: () => u.displayTuning,
      u_sampleStep: () => u.sampleStep,
      u_strictNearest: () => u.strictNearest,
      u_hasBottomDepth: () => u.hasBottomDepth,
      u_featherM: () => u.featherM,
      u_valueInfo: () => u.valueInfo,
      u_colorInfo: () => u.colorInfo,
      u_depthInfo: () => u.depthInfo,
      u_cameraUvw: () => u.cameraUvw,
    }
    return u
  }

  /** 色标 uniform 尚未就绪时的占位数组（长度固定，避免 shader 数组越界） */
  _emptyColorStops() {
    if (!this._emptyStops) {
      this._emptyStops = Array.from({ length: MAX_COLOR_STOPS }, () => new Cesium.Cartesian4())
    }
    return this._emptyStops
  }

  /** 当体数据发生变化时重建 3D 纹理（数据未变则跳过） */
  recreateTextureIfNeeded(context) {
    const gl = getWebGL2RenderingContext(context)
    if (!gl) {
      throw new Error('需要 WebGL2 才能使用 sampler3D 体渲染')
    }

    const { volume } = this.options
    const nextKey = this.getTextureDataKey(volume)
    if (this.texture3D && this.textureDataKey === nextKey) return

    if (this.texture3D && !this.texture3D.isDestroyed()) {
      this.texture3D.destroy()
    }

    this.texture3D = new RawTexture3D(gl, volume)
    this.textureDataKey = nextKey
  }

  /**
   * 创建底层 GPU 资源（顶点/索引缓冲、3D 纹理、着色器程序、渲染状态）。
   *
   * 顶点是一个「单位立方体」（8 顶点 + 36 索引），着色器中用 u_localBox
   * 把单位立方体缩放/偏移为实际的体包围盒，再用 ray-marching 采样内部体素。
   *
   * @param {object} context - Cesium Context
   */
  createResources(context) {
    if (this.vertexArray && this.shaderProgram && this.renderState) {
      this.recreateTextureIfNeeded(context)
      return
    }

    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ])
    const uvws = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ])
    const indices = new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ])

    const positionBuffer = Cesium.Buffer.createVertexBuffer({
      context,
      typedArray: positions,
      usage: Cesium.BufferUsage.STATIC_DRAW,
    })
    const uvwBuffer = Cesium.Buffer.createVertexBuffer({
      context,
      typedArray: uvws,
      usage: Cesium.BufferUsage.STATIC_DRAW,
    })
    const indexBuffer = Cesium.Buffer.createIndexBuffer({
      context,
      typedArray: indices,
      usage: Cesium.BufferUsage.STATIC_DRAW,
      indexDatatype: Cesium.IndexDatatype.UNSIGNED_SHORT,
    })

    this.vertexArray = new Cesium.VertexArray({
      context,
      attributes: [
        {
          index: 0,
          vertexBuffer: positionBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
        },
        {
          index: 1,
          vertexBuffer: uvwBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
        },
      ],
      indexBuffer,
    })

    this.recreateTextureIfNeeded(context)

    const vertexShaderSource = `
      in vec3 position;
      in vec3 a_uvw;
      uniform vec4 u_localBox;
      out vec3 v_uvw;
      void main() {
        v_uvw = a_uvw;
        vec3 localPosition = vec3(
          position.x * u_localBox.x,
          position.y * u_localBox.y,
          mix(u_localBox.w, u_localBox.z, position.z)
        );
        gl_Position = czm_modelViewProjection * vec4(localPosition, 1.0);
      }
    `

    const fragmentShaderSource = `
      precision highp float;
      precision highp sampler3D;
      in vec3 v_uvw;
      uniform sampler3D u_volumeTexture;
      uniform vec4 u_clipInfo;
      uniform vec4 u_valueInfo;
      uniform vec4 u_colorInfo;
      uniform vec4 u_depthInfo;
      uniform vec4 u_layerInfo;
      uniform vec4 u_renderInfo;
      uniform vec2 u_colorMode;
      uniform vec4 u_geoBounds;
      uniform vec4 u_sliceInfo;
      uniform vec4 u_sliceMeta;
      uniform vec3 u_cameraUvw;
      uniform vec4 u_colorStops[${MAX_COLOR_STOPS}];
      uniform float u_colorStopCount;

      // 从可配置色标 uniform 中按归一化位置 x（0–1）插值取色。
      // 每个 u_colorStops[i] = vec4(r, g, b, t)，t 为归一化位置。
      vec3 getStopColor(float x) {
        float v = clamp(x, 0.0, 1.0);
        float count = clamp(u_colorStopCount, 2.0, ${MAX_COLOR_STOPS}.0);
        for (int i = 0; i < ${MAX_COLOR_STOPS} - 1; i++) {
          if (float(i) >= count - 1.0) break;
          vec4 a = u_colorStops[i];
          vec4 b = u_colorStops[i + 1];
          if (v <= b.w) {
            float span = max(0.000001, b.w - a.w);
            float f = clamp((v - a.w) / span, 0.0, 1.0);
            return mix(a.xyz, b.xyz, f);
          }
        }
        return u_colorStops[${MAX_COLOR_STOPS} - 1].xyz;
      }

      vec3 getVolumeColor(float t) {
        return getStopColor(t);
      }

      vec3 getVolumeColorRedBlue(float t) {
        return getStopColor(t);
      }

      vec4 sampleVolume(vec3 uvw) {
        return texture(u_volumeTexture, clamp(uvw, vec3(0.001), vec3(0.999)));
      }

      vec2 intersectUnitCube(vec3 origin, vec3 dir) {
        vec3 safeDir = vec3(
          abs(dir.x) < 0.00001 ? sign(dir.x) * 0.00001 + 0.00001 : dir.x,
          abs(dir.y) < 0.00001 ? sign(dir.y) * 0.00001 + 0.00001 : dir.y,
          abs(dir.z) < 0.00001 ? sign(dir.z) * 0.00001 + 0.00001 : dir.z
        );
        vec3 invDir = 1.0 / safeDir;
        vec3 t0 = (vec3(0.0) - origin) * invDir;
        vec3 t1 = (vec3(1.0) - origin) * invDir;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float nearT = max(max(tmin.x, tmin.y), tmin.z);
        float farT = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(nearT, farT);
      }

      float bearingDegFromUvw(vec3 p) {
        float lon = mix(u_geoBounds.x, u_geoBounds.y, p.x);
        float lat = mix(u_geoBounds.z, u_geoBounds.w, p.y);
        float srcLon = u_sliceMeta.x;
        float srcLat = u_sliceMeta.y;
        float dLon = radians(lon - srcLon);
        float lat1 = radians(srcLat);
        float lat2 = radians(lat);
        float sy = sin(dLon) * cos(lat2);
        float sx = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon);
        return degrees(atan(sy, sx));
      }

      bool passVolumeSlice(vec3 p) {
        if (u_sliceInfo.y < 0.5) return true;

        float threshold = clamp(u_sliceInfo.x, 0.0, 1.0);
        float mode = u_sliceInfo.z;

        if (mode < 0.5) {
          float angleDeg = bearingDegFromUvw(p);
          float angleMin = u_sliceMeta.z;
          float angleNorm;
          if (u_sliceInfo.w > 0.5) {
            angleNorm = mod(angleDeg - angleMin + 360.0, 360.0) / 360.0;
          } else {
            float angleMax = u_sliceMeta.w;
            angleNorm = clamp((angleDeg - angleMin) / max(0.001, angleMax - angleMin), 0.0, 1.0);
          }
          return angleNorm <= threshold;
        }
        if (mode < 1.5) {
          return p.z <= threshold;
        }
        if (mode < 2.5) {
          return p.x <= threshold;
        }
        return p.y <= threshold;
      }

      void main() {
        vec3 surfacePoint = clamp(v_uvw, vec3(0.0), vec3(1.0));
        vec3 rayDir = normalize(surfacePoint - u_cameraUvw);
        vec2 hit = intersectUnitCube(u_cameraUvw, rayDir);
        float startT = max(hit.x, 0.0);
        float endT = hit.y;
        if (endT <= startT) {
          discard;
        }

        float depthCount = max(1.0, u_depthInfo.w);
        float zMin = clamp(u_depthInfo.x / max(1.0, depthCount - 1.0), 0.0, 1.0);
        float zMax = clamp(u_depthInfo.y / max(1.0, depthCount - 1.0), 0.0, 1.0);
        float dt = (endT - startT) / float(${MAX_MARCH_STEPS});
        vec4 accum = vec4(0.0);

        for (int i = 0; i < ${MAX_MARCH_STEPS}; i++) {
          float t = startT + (float(i) + 0.5) * dt;
          vec3 p = u_cameraUvw + rayDir * t;
          if (
            p.x < u_clipInfo.x || p.x > u_clipInfo.y ||
            p.y < u_clipInfo.z || p.y > u_clipInfo.w ||
            p.z < zMin || p.z > zMax
          ) {
            continue;
          }
          if (!passVolumeSlice(p)) continue;

          vec4 voxel = sampleVolume(p);
          float coverage;
          if (u_renderInfo.x > 0.5) {
            coverage = pow(voxel.a / 255.0, 0.92);
          } else {
            coverage = smoothstep(u_renderInfo.y, u_renderInfo.z, voxel.a);
          }
          if (coverage <= 0.015) continue;

          // R 通道 = TL 归一化比值 (0–1)；A 通道 = 覆盖度 (0–1)
          float dataRatio = clamp(voxel.r, 0.0, 1.0);
          float realValue = mix(u_valueInfo.z, u_valueInfo.w, dataRatio);

          float colorMin = u_colorInfo.x;
          float colorMax = u_colorInfo.y;
          float whiteAlpha = u_colorInfo.w;
          bool inColorRange = realValue >= colorMin && realValue <= colorMax;
          bool useWhiteOutOfRange = whiteAlpha > 0.001;

          if (!useWhiteOutOfRange) {
            if (realValue < u_valueInfo.x || realValue > u_valueInfo.y) continue;
            if (!inColorRange) continue;
          }

          float colorSpan = max(0.001, colorMax - colorMin);
          float displayRatio = clamp((realValue - colorMin) / colorSpan, 0.0, 1.0);
          displayRatio = pow(displayRatio, max(0.35, u_colorInfo.z));

          float layerCoord = p.z * max(1.0, depthCount - 1.0);
          float layerFract = fract(layerCoord);
          float distToLayer = min(layerFract, 1.0 - layerFract);
          float layerEdge = 1.0 - smoothstep(0.0, u_layerInfo.y, distToLayer);
          layerEdge *= u_layerInfo.x * (1.0 - u_renderInfo.x);

          vec3 color;
          float alpha;
          float maxStepAlpha = u_renderInfo.w;
          bool blueMode = u_colorMode.x > 0.5;
          float blueAlphaScale = clamp(u_colorMode.y, 0.05, 1.0);

          if (inColorRange) {
            if (blueMode) {
              color = mix(vec3(0.55, 0.82, 1.0), vec3(0.04, 0.18, 0.72), displayRatio);
            } else if (useWhiteOutOfRange) {
              color = getVolumeColorRedBlue(displayRatio);
            } else {
              color = getVolumeColor(displayRatio);
            }
            color = mix(color, vec3(1.0), layerEdge * 0.1);
            if (u_renderInfo.x > 0.5) {
              alpha = clamp(coverage * 0.24 * u_depthInfo.z * (blueMode ? blueAlphaScale : 1.0), 0.0, maxStepAlpha);
            } else {
              alpha = clamp(
                coverage * 0.1 * u_depthInfo.z * (1.0 + layerEdge * 0.25) * (blueMode ? blueAlphaScale : 1.0),
                0.0,
                maxStepAlpha
              );
            }
          } else {
            if (blueMode) {
              color = vec3(0.72, 0.86, 1.0);
            } else {
              color = vec3(1.0);
            }
            if (u_renderInfo.x > 0.5) {
              alpha = clamp(
                coverage * 0.16 * u_depthInfo.z * (blueMode ? blueAlphaScale * 0.55 : whiteAlpha),
                0.0,
                maxStepAlpha * 0.9
              );
            } else {
              alpha = clamp(
                coverage * 0.08 * u_depthInfo.z * (blueMode ? blueAlphaScale * 0.45 : whiteAlpha * (1.0 - u_renderInfo.x * 0.55)),
                0.0,
                maxStepAlpha * 0.85
              );
            }
          }

          accum.rgb += (1.0 - accum.a) * color * alpha;
          accum.a += (1.0 - accum.a) * alpha;
          if (accum.a > 0.96) break;
        }

        if (accum.a <= 0.003) {
          discard;
        }
  gl_FragColor = accum;
      }
    `

    this.shaderProgram = Cesium.ShaderProgram.fromCache({
      context,
      vertexShaderSource,
      fragmentShaderSource,
      attributeLocations: { position: 0, a_uvw: 1 },
    })

    this.renderState = Cesium.RenderState.fromCache({
      // 抬升显示（displayAboveWater !== false）时开启深度测试，让体块正确被 globe/海面遮挡；
      // 真实水深（水下）模式关闭深度测试，使水下声场透视可见（与 NcPolar 体一致）。
      depthTest: { enabled: this.options.volume?.displayAboveWater !== false },
      depthMask: false,
      blending: Cesium.BlendingState.ALPHA_BLEND,
      cull: { enabled: false },
    })
  }

  /**
   * 每帧渲染回调：计算相机在体局部坐标系中的位置、组装 uniform，提交 DrawCommand。
   *
   * 主要工作：
   *   1. 用 modelMatrix 的逆变换把相机世界坐标转到体局部坐标，得到 u_cameraUvw；
   *   2. 组装值域 / 色带 / 深度裁剪 / 切面 / 渲染模式等 uniform；
   *   3. 首次创建（或复用）DrawCommand 并 push 到 frameState.commandList。
   *
   * @param {object} frameState - Cesium 每帧的渲染状态
   */
  update(frameState) {
    if (this.destroyed || this.show === false) return
    // 转到地球背面（视线被地球遮挡）时跳过绘制，避免远处“浮”出体/黑框
    if (isVolumeOccludedByGlobe(frameState, this.options.volume)) return

    try {
      const context = frameState.context
      this.createResources(context)

      const {
        volume,
        valueRange,
        colorRange,
        colorGamma,
        depthTopIndex,
        depthBottomIndex,
        depthRevealMax,
        alphaScale,
        outOfRangeWhiteAlpha,
        sliceClip,
        renderProfile,
        colorMode,
        colorStops,
      } = this.options

      const shellMode = renderProfile === 'shell'
      const sparseShell = shellMode || (volume.validVoxelRatio != null && volume.validVoxelRatio < 0.08)
      const renderInfo = shellMode
        ? new Cesium.Cartesian4(1, 0.22, 0.52, 0.18)
        : new Cesium.Cartesian4(sparseShell ? 1 : 0, VOLUME_MIN_COVERAGE, VOLUME_FULL_COVERAGE, sparseShell ? 0.18 : 0.16)

      const inverseModel = Cesium.Matrix4.inverseTransformation(
        volume.modelMatrix,
        new Cesium.Matrix4()
      )
      const cameraLocal = Cesium.Matrix4.multiplyByPoint(
        inverseModel,
        frameState.camera.positionWC,
        new Cesium.Cartesian3()
      )

      const cameraX = cameraLocal.x / (volume.localHalfWidth * 2) + 0.5
      const cameraY = cameraLocal.y / (volume.localHalfHeight * 2) + 0.5
      const altSpan = (volume.bottomAltitude - volume.topAltitude) || 1
      const cameraZ = (cameraLocal.z - volume.topAltitude) / altSpan

      const meta = volume.sliceMeta || {}
      const sliceActive = sliceClip?.enabled === true
      const sliceMode = sliceClip?.mode ?? VOLUME_SLICE_MODE.azimuth
      const slicePosition = clamp(sliceClip?.position ?? 1, 0, 1)
      const isCircle = meta.isCircle ? 1 : 0
      const maxDepthIdx = Math.max(0, volume.sourceDepth - 1)
      const useDepthSlice = sliceActive && sliceMode === VOLUME_SLICE_MODE.depth
      const depthBottom = useDepthSlice
        ? maxDepthIdx
        : Math.min(depthBottomIndex, depthRevealMax)

      const colorStopUniforms = buildColorStopUniforms(colorStops)
      const uniformMap = {
        u_volumeTexture: () => this.texture3D,
        u_colorStops: () => colorStopUniforms.stops,
        u_colorStopCount: () => colorStopUniforms.count,
        u_localBox: () =>
          new Cesium.Cartesian4(
            volume.localHalfWidth,
            volume.localHalfHeight,
            volume.bottomAltitude,
            volume.topAltitude
          ),
        u_clipInfo: () => new Cesium.Cartesian4(0, 1, 0, 1),
        u_geoBounds: () =>
          new Cesium.Cartesian4(volume.lonMin, volume.lonMax, volume.latMin, volume.latMax),
        u_sliceInfo: () =>
          new Cesium.Cartesian4(
            slicePosition,
            sliceActive ? 1 : 0,
            sliceMode,
            isCircle
          ),
        u_sliceMeta: () =>
          new Cesium.Cartesian4(
            meta.sourceLon ?? (volume.lonMin + volume.lonMax) * 0.5,
            meta.sourceLat ?? (volume.latMin + volume.latMax) * 0.5,
            meta.angleMin ?? 0,
            meta.angleMax ?? 360
          ),
        u_valueInfo: () =>
          new Cesium.Cartesian4(
            valueRange.min,
            valueRange.max,
            volume.valueMin,
            volume.valueMax
          ),
        u_colorInfo: () =>
          new Cesium.Cartesian4(
            colorRange?.min ?? volume.colorMin ?? volume.valueMin,
            colorRange?.max ?? volume.colorMax ?? volume.valueMax,
            colorGamma ?? 0.82,
            outOfRangeWhiteAlpha ?? 0
          ),
        u_depthInfo: () =>
          new Cesium.Cartesian4(
            depthTopIndex,
            depthBottom,
            alphaScale ?? DEFAULT_ALPHA_SCALE,
            volume.sourceDepth
          ),
        u_layerInfo: () =>
          new Cesium.Cartesian4(
            shellMode ? 0 : LAYER_VISUAL_STRENGTH,
            LAYER_VISUAL_WIDTH,
            0,
            0,
          ),
        u_renderInfo: () => renderInfo,
        u_colorMode: () =>
          new Cesium.Cartesian2(
            colorMode?.blue ? 1 : 0,
            colorMode?.blueAlpha ?? 0.85
          ),
        u_cameraUvw: () => new Cesium.Cartesian3(cameraX, cameraY, cameraZ),
      }

      // 真实水深（水下）模式的包围球位于椭球内部，GeoVis 会误判为被地球遮挡；
      // 此时不提供包围球，交由纹理地形掩膜裁剪（与 NcPolar 体一致）。
      const boundingVolume = volume.displayAboveWater !== false ? volume.worldBoundingSphere : undefined

      if (!this.command) {
        this.command = new Cesium.DrawCommand({
          owner: this,
          primitiveType: Cesium.PrimitiveType.TRIANGLES,
          vertexArray: this.vertexArray,
          shaderProgram: this.shaderProgram,
          renderState: this.renderState,
          uniformMap,
          modelMatrix: volume.modelMatrix,
          boundingVolume,
          pass: Cesium.Pass.TRANSLUCENT,
        })
      }

      this.command.modelMatrix = volume.modelMatrix
      this.command.boundingVolume = boundingVolume
      this.command.uniformMap = uniformMap
      frameState.commandList.push(this.command)
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
}

/** 返回「壳层渲染」渲染模式标识（shell 模式只显示体表面外壳，不累计内部） */
export function getShellRenderProfile() {
  return 'shell'
}

/**
 * 将相机飞行到体渲染体的包围球位置。
 * @param {Cesium.Viewer} viewer - Cesium 视图
 * @param {object} volume - 已 finalize 的体对象（含 worldBoundingSphere）
 * @param {'overview'|'top'} [mode='overview'] - overview 全景斜视 / top 正上方俯视
 * @param {number} [duration=0.55] - 飞行时长（秒）
 */
export function flyToVolumeBoundingSphere(viewer, volume, mode = 'overview', duration = 0.55) {
  const targetSphere = volume.focusBoundingSphere ?? volume.worldBoundingSphere
  const radius = Math.max(targetSphere.radius, 1)
  const centerLon = Number.isFinite(volume.focusCenterLon)
    ? volume.focusCenterLon
    : (volume.lonMin + volume.lonMax) / 2
  const centerLat = Number.isFinite(volume.focusCenterLat)
    ? volume.focusCenterLat
    : (volume.latMin + volume.latMax) / 2

  if (mode === 'top') {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        centerLon,
        centerLat,
        Math.max(80000, radius * 1.4)
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-88),
        roll: 0,
      },
      duration,
    })
    return
  }

  viewer.camera.flyToBoundingSphere(targetSphere, {
    duration,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(22),
      // 保留足够低的观察仰角，让浅海体的垂向厚度在默认全景中可见。
      Cesium.Math.toRadians(-30),
      radius * OVERVIEW_RANGE_SCALE
    ),
  })
}

export const TL_VOLUME_LEGEND = [
  { label: '低 TL（强信号）', color: '#f21f14' },
  { label: '中低', color: '#ff8844' },
  { label: '中等', color: '#ffdd44' },
  { label: '中高', color: '#66bbff' },
  { label: '高 TL（弱信号）', color: '#0d59fa' },
]

/**
 * 楔形体专用体渲染：geo(lon,lat,depth) → 纹理(path,angle,depth) 再采样
 */
export class WedgeShaderVolume3DPrimitive extends ShaderVolume3DPrimitive {
  /**
   * 创建底层 GPU 资源（顶点/索引缓冲、3D 纹理、着色器程序、渲染状态）。
   *
   * 顶点是一个「单位立方体」（8 顶点 + 36 索引），着色器中用 u_localBox
   * 把单位立方体缩放/偏移为实际的体包围盒，再用 ray-marching 采样内部体素。
   *
   * @param {object} context - Cesium Context
   */
  createResources(context) {
    if (this.vertexArray && this.shaderProgram && this.renderState) {
      this.recreateTextureIfNeeded(context)
      return
    }

    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ])
    const uvws = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ])
    const indices = new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ])

    const positionBuffer = Cesium.Buffer.createVertexBuffer({
      context,
      typedArray: positions,
      usage: Cesium.BufferUsage.STATIC_DRAW,
    })
    const uvwBuffer = Cesium.Buffer.createVertexBuffer({
      context,
      typedArray: uvws,
      usage: Cesium.BufferUsage.STATIC_DRAW,
    })
    const indexBuffer = Cesium.Buffer.createIndexBuffer({
      context,
      typedArray: indices,
      usage: Cesium.BufferUsage.STATIC_DRAW,
      indexDatatype: Cesium.IndexDatatype.UNSIGNED_SHORT,
    })

    this.vertexArray = new Cesium.VertexArray({
      context,
      attributes: [
        {
          index: 0,
          vertexBuffer: positionBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
        },
        {
          index: 1,
          vertexBuffer: uvwBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
        },
      ],
      indexBuffer,
    })

    this.recreateTextureIfNeeded(context)

    const vertexShaderSource = `
      in vec3 position;
      in vec3 a_uvw;
      uniform vec4 u_localBox;
      out vec3 v_uvw;
      void main() {
        v_uvw = a_uvw;
        vec3 localPosition = vec3(
          position.x * u_localBox.x,
          position.y * u_localBox.y,
          mix(u_localBox.w, u_localBox.z, position.z)
        );
        gl_Position = czm_modelViewProjection * vec4(localPosition, 1.0);
      }
    `

    const fragmentShaderSource = `
      precision highp float;
      precision highp sampler3D;
      in vec3 v_uvw;
      uniform sampler3D u_volumeTexture;
      uniform vec4 u_geoBounds;
      uniform vec4 u_wedgeMeta;
      uniform vec4 u_wedgeMeta2;
      uniform vec4 u_valueInfo;
      uniform vec4 u_colorInfo;
      uniform vec4 u_depthInfo;
      uniform vec4 u_layerInfo;
      uniform vec4 u_renderInfo;
      uniform vec2 u_colorMode;
      uniform vec3 u_cameraUvw;
      uniform vec4 u_colorStops[${MAX_COLOR_STOPS}];
      uniform float u_colorStopCount;

      vec3 getStopColor(float x) {
        float v = clamp(x, 0.0, 1.0);
        float count = clamp(u_colorStopCount, 2.0, ${MAX_COLOR_STOPS}.0);
        for (int i = 0; i < ${MAX_COLOR_STOPS} - 1; i++) {
          if (float(i) >= count - 1.0) break;
          vec4 a = u_colorStops[i];
          vec4 b = u_colorStops[i + 1];
          if (v <= b.w) {
            float span = max(0.000001, b.w - a.w);
            float f = clamp((v - a.w) / span, 0.0, 1.0);
            return mix(a.xyz, b.xyz, f);
          }
        }
        return u_colorStops[${MAX_COLOR_STOPS} - 1].xyz;
      }

      vec3 getVolumeColor(float t) {
        return getStopColor(t);
      }

      vec2 intersectUnitCube(vec3 origin, vec3 dir) {
        vec3 safeDir = vec3(
          abs(dir.x) < 0.00001 ? 0.00001 : dir.x,
          abs(dir.y) < 0.00001 ? 0.00001 : dir.y,
          abs(dir.z) < 0.00001 ? 0.00001 : dir.z
        );
        vec3 invDir = 1.0 / safeDir;
        vec3 t0 = (vec3(0.0) - origin) * invDir;
        vec3 t1 = (vec3(1.0) - origin) * invDir;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
      }

      bool geoToTextureUvw(vec3 p, out vec3 texUvw) {
        float lon = mix(u_geoBounds.x, u_geoBounds.y, p.x);
        float lat = mix(u_geoBounds.z, u_geoBounds.w, p.y);
        float depthM = mix(u_wedgeMeta2.z, u_wedgeMeta2.w, p.z);

        float srcLon = u_wedgeMeta.x;
        float srcLat = u_wedgeMeta.y;
        float dLon = radians(lon - srcLon);
        float lat1 = radians(srcLat);
        float lat2 = radians(lat);
        float sy = sin(dLon) * cos(lat2);
        float sx = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon);
        float angleDeg = degrees(atan(sy, sx));

        float pathM = length(vec2((lon - srcLon) * cos(lat1) * 111320.0, (lat - srcLat) * 110574.0));
        float pathSpan = max(1.0, u_wedgeMeta2.y - u_wedgeMeta2.x);
        float angleSpan = max(0.001, u_wedgeMeta.w - u_wedgeMeta.z);
        float depthSpan = max(1.0, u_wedgeMeta2.w - u_wedgeMeta2.z);

        float pathNorm = (pathM - u_wedgeMeta2.x) / pathSpan;
        // 方位轴是周期量：先按 360° 取模再归一化，避免 angleDeg（∈(-180,180]）落在
        // angleMin 之下（如 angleMin=-175 时的 -177°）被误判为越界、在体上留下楔形缺口
        float angleNorm = mod(angleDeg - u_wedgeMeta.z + 720.0, 360.0) / angleSpan;
        float depthNorm = (depthM - u_wedgeMeta2.z) / depthSpan;

        // 声源至首个距离节点没有独立数据，连续沿用首列 TL；中心统一使用首方位，
        // 防止 atan(0,0) 周围出现放射状接缝或透明孔洞。
        float firstCellM = pathSpan / max(1.0, float(textureSize(u_volumeTexture, 0).x - 1));
        if (pathM <= max(u_wedgeMeta2.x, firstCellM * 0.5)) {
          pathNorm = 0.0;
          angleNorm = 0.0;
        }

        if (angleNorm < 0.0 || angleNorm > 1.0) return false;
        if (pathNorm > 1.0) return false;
        if (depthNorm < 0.0 || depthNorm > 1.0) return false;

        texUvw = vec3(pathNorm, angleNorm, depthNorm);
        return true;
      }

      void main() {
        vec3 surfacePoint = clamp(v_uvw, vec3(0.0), vec3(1.0));
        vec3 rayDir = normalize(surfacePoint - u_cameraUvw);
        vec2 hit = intersectUnitCube(u_cameraUvw, rayDir);
        float startT = max(hit.x, 0.0);
        float endT = hit.y;
        if (endT <= startT) {
          discard;
        }

        float dt = (endT - startT) / float(${MAX_MARCH_STEPS});
        vec4 accum = vec4(0.0);

        // 每步 alpha 随步长自适应，避免远处体块过度叠加发白、近处发虚
        float stepAlphaBase = clamp(0.045 * u_depthInfo.z, 0.0, 0.12);
        float stepAlphaScale = clamp(0.55 + 0.45 * dt, 0.5, 1.0);

        for (int i = 0; i < ${MAX_MARCH_STEPS}; i++) {
          float t = startT + (float(i) + 0.5) * dt;
          vec3 p = u_cameraUvw + rayDir * t;

          vec3 texUvw;
          if (!geoToTextureUvw(p, texUvw)) continue;

          vec4 voxel = texture(u_volumeTexture, clamp(texUvw, vec3(0.001), vec3(0.999)));
          if (voxel.a <= 0.01) continue;

          float dataRatio = clamp(voxel.r, 0.0, 1.0);
          float realValue = mix(u_valueInfo.z, u_valueInfo.w, dataRatio);
          // 仅裁剪高于上限的体素；低于色带下限（如 60 dB）时按 60 dB 同色显示
          if (realValue > u_valueInfo.y) continue;

          float colorSpan = max(0.001, u_colorInfo.y - u_colorInfo.x);
          float displayRatio = clamp((realValue - u_colorInfo.x) / colorSpan, 0.0, 1.0);
          displayRatio = pow(displayRatio, max(0.35, u_colorInfo.z));

          vec3 color = getVolumeColor(displayRatio);
          float alpha = clamp(stepAlphaBase * stepAlphaScale, 0.0, 0.16);

          accum.rgb += (1.0 - accum.a) * color * alpha;
          accum.a += (1.0 - accum.a) * alpha;
          if (accum.a > 0.94) break;
        }

        if (accum.a <= 0.01) {
          discard;
        }
  gl_FragColor = accum;
      }
    `

    this.shaderProgram = Cesium.ShaderProgram.fromCache({
      context,
      vertexShaderSource,
      fragmentShaderSource,
      attributeLocations: { position: 0, a_uvw: 1 },
    })

    this.renderState = Cesium.RenderState.fromCache({
      // 开启深度测试：让体块正确地对 globe/海面做遮挡（水下部分被海面遮挡，而非穿透浮在水上）
      depthTest: { enabled: true },
      depthMask: false,
      blending: Cesium.BlendingState.ALPHA_BLEND,
      cull: { enabled: false },
    })
  }

  /**
   * 每帧渲染回调（楔形体）：组装楔形体所需 uniform（wedgeMeta / geoBounds 等）
   * 并提交 DrawCommand。与基础类差异在于额外传入极坐标映射参数。
   * @param {object} frameState - Cesium 每帧渲染状态
   */
  update(frameState) {
    if (this.destroyed || this.show === false) return
    // 转到地球背面（视线被地球遮挡）时跳过绘制，避免远处“浮”出体/黑框
    if (isVolumeOccludedByGlobe(frameState, this.options.volume)) return

    try {
      const context = frameState.context
      this.createResources(context)

      const {
        volume,
        valueRange,
        colorRange,
        colorGamma,
        depthTopIndex,
        depthBottomIndex,
        depthRevealMax,
        alphaScale,
        colorStops,
      } = this.options

      const meta = volume.wedgeMeta
      if (!meta) {
        throw new Error('楔形体缺少 wedgeMeta')
      }

      const inverseModel = Cesium.Matrix4.inverseTransformation(
        volume.modelMatrix,
        new Cesium.Matrix4(),
      )
      const cameraLocal = Cesium.Matrix4.multiplyByPoint(
        inverseModel,
        frameState.camera.positionWC,
        new Cesium.Cartesian3(),
      )

      const cameraX = cameraLocal.x / (volume.localHalfWidth * 2) + 0.5
      const cameraY = cameraLocal.y / (volume.localHalfHeight * 2) + 0.5
      const altSpan = volume.bottomAltitude - volume.topAltitude || 1
      const cameraZ = (cameraLocal.z - volume.topAltitude) / altSpan

      const colorStopUniforms = buildColorStopUniforms(colorStops)
      const uniformMap = {
        u_volumeTexture: () => this.texture3D,
        u_colorStops: () => colorStopUniforms.stops,
        u_colorStopCount: () => colorStopUniforms.count,
        u_localBox: () =>
          new Cesium.Cartesian4(
            volume.localHalfWidth,
            volume.localHalfHeight,
            volume.bottomAltitude,
            volume.topAltitude,
          ),
        u_geoBounds: () =>
          new Cesium.Cartesian4(volume.lonMin, volume.lonMax, volume.latMin, volume.latMax),
        u_wedgeMeta: () =>
          new Cesium.Cartesian4(meta.sourceLon, meta.sourceLat, meta.angleMin, meta.angleMax),
        u_wedgeMeta2: () =>
          new Cesium.Cartesian4(meta.pathMinM, meta.pathMaxM, meta.depthMinM, meta.depthMaxM),
        u_valueInfo: () =>
          new Cesium.Cartesian4(
            valueRange.min,
            valueRange.max,
            volume.valueMin,
            volume.valueMax,
          ),
        u_colorInfo: () =>
          new Cesium.Cartesian4(
            colorRange?.min ?? volume.valueMin,
            colorRange?.max ?? volume.valueMax,
            colorGamma ?? 0.82,
            0,
          ),
        u_depthInfo: () =>
          new Cesium.Cartesian4(
            depthTopIndex,
            Math.min(depthBottomIndex, depthRevealMax),
            alphaScale ?? DEFAULT_ALPHA_SCALE,
            volume.sourceDepth,
          ),
        u_layerInfo: () => new Cesium.Cartesian4(0, 0, 0, 0),
        u_renderInfo: () =>
          new Cesium.Cartesian4(0, VOLUME_MIN_COVERAGE, VOLUME_FULL_COVERAGE, 0.16),
        u_cameraUvw: () => new Cesium.Cartesian3(cameraX, cameraY, cameraZ),
      }

      if (!this.command) {
        this.command = new Cesium.DrawCommand({
          owner: this,
          primitiveType: Cesium.PrimitiveType.TRIANGLES,
          vertexArray: this.vertexArray,
          shaderProgram: this.shaderProgram,
          renderState: this.renderState,
          uniformMap,
          modelMatrix: volume.modelMatrix,
          boundingVolume: volume.worldBoundingSphere,
          pass: Cesium.Pass.TRANSLUCENT,
        })
      }

      this.command.modelMatrix = volume.modelMatrix
      this.command.boundingVolume = volume.worldBoundingSphere
      this.command.uniformMap = uniformMap
      frameState.commandList.push(this.command)
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
}

/**
 * NC 极坐标体：Wedge 采样 + 可旋转方位/深度/经纬切面
 */
export class NcPolarShaderVolume3DPrimitive extends WedgeShaderVolume3DPrimitive {
  /**
   * 创建底层 GPU 资源（顶点/索引缓冲、3D 纹理、着色器程序、渲染状态）。
   *
   * 顶点是一个「单位立方体」（8 顶点 + 36 索引），着色器中用 u_localBox
   * 把单位立方体缩放/偏移为实际的体包围盒，再用 ray-marching 采样内部体素。
   *
   * @param {object} context - Cesium Context
   */
  createResources(context) {
    const { volume } = this.options
    if (this.vertexArray && this.shaderProgram && this.renderState) {
      this.recreateTextureIfNeeded(context)
      return
    }

    const positions = new Float32Array([
      -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    ])
    const uvws = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
      0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ])
    // 外向逆时针绕序。配合背面剔除，每个屏幕像素只从相机侧入口面执行一次
    // ray-marching，避免六个包围盒面重复积分同一体数据、放大水平层状伪影。
    const indices = new Uint16Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 5, 4, 0, 1, 5, 1, 6, 5, 1, 2, 6,
      2, 7, 6, 2, 3, 7, 3, 4, 7, 3, 0, 4,
    ])

    const positionBuffer = Cesium.Buffer.createVertexBuffer({
      context,
      typedArray: positions,
      usage: Cesium.BufferUsage.STATIC_DRAW,
    })
    const uvwBuffer = Cesium.Buffer.createVertexBuffer({
      context,
      typedArray: uvws,
      usage: Cesium.BufferUsage.STATIC_DRAW,
    })
    const indexBuffer = Cesium.Buffer.createIndexBuffer({
      context,
      typedArray: indices,
      usage: Cesium.BufferUsage.STATIC_DRAW,
      indexDatatype: Cesium.IndexDatatype.UNSIGNED_SHORT,
    })

    this.vertexArray = new Cesium.VertexArray({
      context,
      attributes: [
        {
          index: 0,
          vertexBuffer: positionBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
        },
        {
          index: 1,
          vertexBuffer: uvwBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
        },
      ],
      indexBuffer,
    })

    this.recreateTextureIfNeeded(context)

    const vertexShaderSource = `
      in vec3 position;
      in vec3 a_uvw;
      uniform vec4 u_localBox;
      out vec3 v_uvw;
      void main() {
        v_uvw = a_uvw;
        vec3 localPosition = vec3(
          position.x * u_localBox.x,
          position.y * u_localBox.y,
          mix(u_localBox.w, u_localBox.z, position.z)
        );
        gl_Position = czm_modelViewProjection * vec4(localPosition, 1.0);
      }
    `

    const fragmentShaderSource = `
      precision highp float;
      precision highp sampler3D;
      in vec3 v_uvw;
      uniform sampler3D u_volumeTexture;
      uniform vec4 u_geoBounds;
      uniform vec4 u_wedgeMeta;
      uniform vec4 u_wedgeMeta2;
      uniform vec4 u_valueInfo;
      uniform vec4 u_colorInfo;
      uniform vec4 u_depthInfo;
      uniform vec4 u_sliceInfo;
      uniform vec4 u_sliceMeta;
      uniform vec3 u_cameraUvw;
      uniform vec4 u_colorStops[${MAX_COLOR_STOPS}];
      uniform float u_colorStopCount;
      // 色标透明度区间：x = 色带下限(60 dB/红)的 alpha 系数，y = 色带上限(120 dB/蓝)的 alpha 系数
      uniform vec2 u_alphaByValue;
      // x = 体密度倍率，y = TL 色彩对比度倍率，z = 边缘锐度倍率。
      uniform vec3 u_displayTuning;
      // 归一化纹理坐标中的最大步长；实际步长还会按当前射线穿过的体素数自适应缩小。
      uniform float u_sampleStep;
      // 严格最近邻（bellhop_gebco 参考模式）：1 = 逐节点 texelFetch、不做三线性插值。
      uniform int u_strictNearest;
      // G 通道是否保存物理海底深度；存在时先硬裁剪海底以下样本，再对海底上方羽化。
      uniform int u_hasBottomDepth;
      // 近底平滑羽化宽度（米）：海底之上 featerM 米内透明度渐变到 0。
      uniform float u_featherM;

      vec3 getStopColor(float x) {
        float v = clamp(x, 0.0, 1.0);
        float count = clamp(u_colorStopCount, 2.0, ${MAX_COLOR_STOPS}.0);
        for (int i = 0; i < ${MAX_COLOR_STOPS} - 1; i++) {
          if (float(i) >= count - 1.0) break;
          vec4 a = u_colorStops[i];
          vec4 b = u_colorStops[i + 1];
          if (v <= b.w) {
            float span = max(0.000001, b.w - a.w);
            float f = clamp((v - a.w) / span, 0.0, 1.0);
            return mix(a.xyz, b.xyz, f);
          }
        }
        return u_colorStops[${MAX_COLOR_STOPS} - 1].xyz;
      }

      vec3 getVolumeColor(float t) {
        return getStopColor(t);
      }

      vec2 intersectUnitCube(vec3 origin, vec3 dir) {
        vec3 safeDir = vec3(
          abs(dir.x) < 0.00001 ? 0.00001 : dir.x,
          abs(dir.y) < 0.00001 ? 0.00001 : dir.y,
          abs(dir.z) < 0.00001 ? 0.00001 : dir.z
        );
        vec3 invDir = 1.0 / safeDir;
        vec3 t0 = (vec3(0.0) - origin) * invDir;
        vec3 t1 = (vec3(1.0) - origin) * invDir;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
      }

      float bearingDegFromUvw(vec3 p) {
        float lon = mix(u_geoBounds.x, u_geoBounds.y, p.x);
        float lat = mix(u_geoBounds.z, u_geoBounds.w, p.y);
        float srcLon = u_sliceMeta.x;
        float srcLat = u_sliceMeta.y;
        float dLon = radians(lon - srcLon);
        float lat1 = radians(srcLat);
        float lat2 = radians(lat);
        float sy = sin(dLon) * cos(lat2);
        float sx = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon);
        return degrees(atan(sy, sx));
      }

      bool passVolumeSlice(vec3 p) {
        if (u_sliceInfo.y < 0.5) return true;

        float threshold = clamp(u_sliceInfo.x, 0.0, 1.0);
        float mode = u_sliceInfo.z;

        if (mode < 0.5) {
          float angleDeg = bearingDegFromUvw(p);
          float angleOffset = u_sliceMeta.z;
          float angleNorm = mod(angleDeg - angleOffset + 360.0, 360.0) / 360.0;
          return angleNorm <= threshold;
        }
        if (mode < 1.5) {
          return p.z <= threshold;
        }
        if (mode < 2.5) {
          return p.x <= threshold;
        }
        return p.y <= threshold;
      }

      bool geoToTextureUvw(vec3 p, out vec3 texUvw) {
        float lon = mix(u_geoBounds.x, u_geoBounds.y, p.x);
        float lat = mix(u_geoBounds.z, u_geoBounds.w, p.y);
        float depthM = mix(u_wedgeMeta2.z, u_wedgeMeta2.w, p.z);

        float srcLon = u_wedgeMeta.x;
        float srcLat = u_wedgeMeta.y;
        float dLon = radians(lon - srcLon);
        float lat1 = radians(srcLat);
        float lat2 = radians(lat);
        float sy = sin(dLon) * cos(lat2);
        float sx = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon);
        float angleDeg = degrees(atan(sy, sx));

        float pathM = length(vec2((lon - srcLon) * cos(lat1) * 111320.0, (lat - srcLat) * 110574.0));
        float pathSpan = max(1.0, u_wedgeMeta2.y - u_wedgeMeta2.x);
        float angleSpan = max(0.001, u_wedgeMeta.w - u_wedgeMeta.z);
        float depthSpan = max(1.0, u_wedgeMeta2.w - u_wedgeMeta2.z);

        float pathNorm = (pathM - u_wedgeMeta2.x) / pathSpan;
        // 方位轴是周期量：先按 360° 取模再归一化，避免 angleDeg（∈(-180,180]）落在
        // angleMin 之下（如 angleMin=-175 时的 -177°）被误判为越界、在体上留下楔形缺口
        float angleNorm = mod(angleDeg - u_wedgeMeta.z + 720.0, 360.0) / angleSpan;
        float depthNorm = (depthM - u_wedgeMeta2.z) / depthSpan;

        // 声源至首个距离节点没有独立数据，连续沿用首列 TL；中心统一使用首方位，
        // 防止 atan(0,0) 周围出现放射状接缝或透明孔洞。
        float firstCellM = pathSpan / max(1.0, float(textureSize(u_volumeTexture, 0).x - 1));
        if (pathM <= max(u_wedgeMeta2.x, firstCellM * 0.5)) {
          pathNorm = 0.0;
          angleNorm = 0.0;
        }

        if (angleNorm < 0.0 || angleNorm > 1.0) return false;
        if (pathNorm > 1.0) return false;
        if (depthNorm < 0.0 || depthNorm > 1.0) return false;

        texUvw = vec3(pathNorm, angleNorm, depthNorm);
        return true;
      }

      void main() {
        vec3 surfacePoint = clamp(v_uvw, vec3(0.0), vec3(1.0));
        vec3 rayDir = normalize(surfacePoint - u_cameraUvw);
        vec2 hit = intersectUnitCube(u_cameraUvw, rayDir);
        float startT = max(hit.x, 0.0);
        float endT = hit.y;
        if (endT <= startT) {
          discard;
        }

        // 0.03 的定义是“归一化纹理坐标最大步长”，不是固定世界距离或步数倍率。
        // 按射线方向估算它会穿过多少个真实体素，使距离/方位/深度三个分辨率不同的轴
        // 都至少按约 0.72 个体素采一次；超过 GPU 循环预算时再均匀压到 512 步。
        vec3 textureShape = max(vec3(textureSize(u_volumeTexture, 0)), vec3(1.0));
        vec3 cellCount = max(textureShape - vec3(1.0), vec3(1.0));
        float crossedCellsPerUnit = max(1.0, dot(abs(rayDir), cellCount));
        float voxelAwareStep = 0.72 / crossedCellsPerUnit;
        float requestedStep = clamp(u_sampleStep, 0.001, 0.05);
        float rayLength = endT - startT;
        float dt = max(min(requestedStep, voxelAwareStep), rayLength / float(${MAX_MARCH_STEPS}));
        vec4 accum = vec4(0.0);
        vec3 lastClippedPoint = vec3(0.0);
        bool hasClippedPoint = false;
        // 轻微的屏幕空间采样抖动可打散规则网格与固定步进产生的莫尔条带，
        // 不改变纹理数据及 TL 数值映射。
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

        for (int i = 0; i < ${MAX_MARCH_STEPS}; i++) {
          float t = startT + (float(i) + jitter) * dt;
          if (t > endT) break;
          vec3 p = u_cameraUvw + rayDir * t;
          if (!passVolumeSlice(p)) {
            lastClippedPoint = p;
            hasClippedPoint = true;
            continue;
          }

          // 从被裁掉的半体进入保留半体时，二分回到精确裁切平面。该样本是露出的
          // 距离—深度 TL 剖面；它直接使用原始体素色，不参与沿视线的体积分混色。
          bool cutFaceSample = u_sliceInfo.y > 0.5 && u_sliceInfo.z < 0.5 && hasClippedPoint;
          if (cutFaceSample) {
            vec3 outsidePoint = lastClippedPoint;
            vec3 insidePoint = p;
            for (int cutStep = 0; cutStep < 8; cutStep++) {
              vec3 midpoint = mix(outsidePoint, insidePoint, 0.5);
              if (passVolumeSlice(midpoint)) insidePoint = midpoint;
              else outsidePoint = midpoint;
            }
            p = insidePoint;
            hasClippedPoint = false;
          }

          vec3 texUvw;
          if (!geoToTextureUvw(p, texUvw)) continue;

          // sampler3D 的 LINEAR 过滤在三轴上执行硬件三线性插值；A 通道也参与插值，
          // 因此将其作为连续覆盖度使用，而不是把每个网格单元当作实体色块。
          vec4 voxel;
          if (u_strictNearest == 1) {
            // 严格最近邻（bellhop_gebco 参考模式）：方位取各扇区中心 ±45° 最近扇区，
            // 距离/深度取最近原始节点，逐节点 texelFetch，不做任何插值。
            int nRange = int(textureShape.x);
            int nSector = int(textureShape.y);
            int nDepth = int(textureShape.z);
            int rIdx = clamp(int(floor(texUvw.x * float(nRange - 1) + 0.5)), 0, nRange - 1);
            int zIdx = clamp(int(floor(texUvw.z * float(nDepth - 1) + 0.5)), 0, nDepth - 1);
            int sIdx = int(floor(texUvw.y * float(nSector) + 0.5)) % nSector;
            voxel = texelFetch(u_volumeTexture, ivec3(rIdx, sIdx, zIdx), 0);
          } else {
            voxel = texture(u_volumeTexture, clamp(texUvw, vec3(0.001), vec3(0.999)));
          }
          float coverage = smoothstep(0.015, 0.92, voxel.a);

          // 体边缘淡出 1.5 个体素，消除包围盒/首末切片的硬轮廓与纹理接缝。
          vec3 edgeWidth = min(vec3(0.12), vec3(1.5) / textureShape);
          vec3 edgeLow = smoothstep(vec3(0.0), edgeWidth, texUvw);
          vec3 edgeHigh = smoothstep(vec3(0.0), edgeWidth, vec3(1.0) - texUvw);
          // 360° 数据的方位首尾是同一个方向，不在这里淡出，否则会人为制造径向透明缝。
          float angleEdge = (u_wedgeMeta.w - u_wedgeMeta.z >= 359.5)
            ? 1.0
            : edgeLow.y * edgeHigh.y;
          // 中心使用首个距离节点回填，不能在 x=0 淡出；只对最大距离外缘做羽化。
          coverage *= min(min(edgeHigh.x, angleEdge), edgeLow.z * edgeHigh.z);
          // 连续海底约束：G 通道是独立的海底深度纹理。先执行硬裁剪，确保任何
          // 羽化或三线性过滤都不会把声场带到海底以下；随后仅在海底上方渐隐。
          if (u_hasBottomDepth == 1) {
            float depthM = mix(u_wedgeMeta2.z, u_wedgeMeta2.w, texUvw.z);
            float bottomM = mix(u_wedgeMeta2.z, u_wedgeMeta2.w, voxel.g);
            if (depthM >= bottomM) continue;
            coverage *= smoothstep(0.0, max(8.0, u_featherM), bottomM - depthM);
          }
          // 只收紧覆盖度羽化，不改变 realValue/displayRatio，因此不会改变色标映射。
          float edgeSharpness = clamp(u_displayTuning.z, 0.5, 4.0);
          coverage = pow(clamp(coverage, 0.0, 1.0), edgeSharpness);
          if (coverage <= 0.001) continue;

          float dataRatio = clamp(voxel.r, 0.0, 1.0);
          float realValue = mix(u_valueInfo.z, u_valueInfo.w, dataRatio);
          // 仅裁剪高于上限的体素；低于色带下限（如 60 dB）时按 60 dB 同色显示
          if (realValue > u_valueInfo.y) continue;

          float colorSpan = max(0.001, u_colorInfo.y - u_colorInfo.x);
          float displayRatio = clamp((realValue - u_colorInfo.x) / colorSpan, 0.0, 1.0);
          // 参考模式不做色标 gamma，保持 fieldColor 原始分段映射；平滑模式沿用可调 gamma。
          if (u_strictNearest == 0) displayRatio = pow(displayRatio, max(0.35, u_colorInfo.z));
          float contrast = clamp(u_displayTuning.y, 0.5, 3.0);
          displayRatio = clamp((displayRatio - 0.5) * contrast + 0.5, 0.0, 1.0);

          vec3 color = getVolumeColor(displayRatio);
          // 整个声场体都采用“剖切面同款”的真实 TL 直出色：命中离相机最近的
          // 有效体素后立即结束，不再把沿途多个 TL 颜色做 Beer-Lambert 混合。
          float density = clamp(u_displayTuning.x, 0.25, 8.0);
          float alpha = clamp(u_depthInfo.z * density * coverage, 0.0, 1.0);
          accum = vec4(color * alpha, alpha);
          break;
        }

        if (accum.a <= 0.0001) {
          discard;
        }
        // Front-to-Back 累积得到的是预乘颜色；Cesium.ALPHA_BLEND 接收直通颜色，
        // 输出前解除预乘，避免 alpha 被再次相乘后出现深色水平条带。
        gl_FragColor = vec4(accum.rgb / max(accum.a, 0.0001), accum.a);
      }
    `

    this.shaderProgram = Cesium.ShaderProgram.fromCache({
      context,
      vertexShaderSource,
      fragmentShaderSource,
      attributeLocations: { position: 0, a_uvw: 1 },
    })

    this.renderState = Cesium.RenderState.fromCache({
      // NC 声场默认按真实水深放在海面以下（displayAboveWater=false）：深度夸张越大
      // 只向下增厚，不会整体飘到地图上方。GeoVis 1.73 的 globe 不支持地下半透明，
      // 因此地下体采用透视显示；陆地/海底由纹理 A 通道的地形掩膜严格裁剪。
      depthTest: { enabled: !!volume.displayAboveWater },
      depthMask: false,
      blending: Cesium.BlendingState.ALPHA_BLEND,
      // 相机在体外时只绘制入口面，保证每个像素只执行一次体积分。
      cull: { enabled: true },
    })
    // 放大进入体内部时，入口面位于包围盒背面；关闭剔除可继续观察内部且各方向
    // 只命中一个出口面，不会出现体外视角的多面重叠积分。
    this.renderStateInside = Cesium.RenderState.fromCache({
      depthTest: { enabled: !!volume.displayAboveWater },
      depthMask: false,
      blending: Cesium.BlendingState.ALPHA_BLEND,
      cull: { enabled: false },
    })
  }

  /**
   * 每帧渲染回调（NC 极坐标体）：在楔形体基础上额外处理可旋转切面
   * （方位 / 深度 / 经纬），组装 u_sliceInfo / u_sliceMeta 后提交 DrawCommand。
   * @param {object} frameState - Cesium 每帧渲染状态
   */
  update(frameState) {
    if (this.destroyed || this.show === false) return
    // 0 的语义是完全不可见：不创建/提交 DrawCommand，避免低精度 alpha 残影。
    const requestedOpacity = Number(this.options.alphaScale ?? DEFAULT_ALPHA_SCALE)
    if (Number.isFinite(requestedOpacity) && requestedOpacity <= 0) return
    // 转到地球背面（视线被地球遮挡）时跳过绘制，避免远处“浮”出体/黑框
    if (isVolumeOccludedByGlobe(frameState, this.options.volume)) return

    try {
      const context = frameState.context
      this.createResources(context)

      const {
        volume,
        valueRange,
        colorRange,
        colorGamma,
        depthTopIndex,
        depthBottomIndex,
        depthRevealMax,
        alphaScale,
        density,
        contrast,
        edgeSharpness,
        valueAlphaRange,
        sliceClip,
        colorStops,
      } = this.options

      const meta = volume.wedgeMeta
      if (!meta) {
        throw new Error('NC 极坐标体缺少 wedgeMeta')
      }

      // 相机局部坐标（复用缓存的逆模型矩阵与临时对象）
      const cameraUvw = this.computeCameraUvw(volume, frameState)
      const cameraInside =
        cameraUvw.x > 0 && cameraUvw.x < 1 &&
        cameraUvw.y > 0 && cameraUvw.y < 1 &&
        cameraUvw.z > 0 && cameraUvw.z < 1
      const activeRenderState = cameraInside ? this.renderStateInside : this.renderState

      const sliceActive = sliceClip?.enabled === true
      const sliceMode = sliceClip?.mode ?? VOLUME_SLICE_MODE.azimuth
      const slicePosition = clamp(sliceClip?.position ?? 1, 0, 1)
      const sliceAzimuthDeg = sliceClip?.azimuthDeg ?? 0

      // 色标透明度区间（60 dB 红 alpha=1 → 120 dB 蓝 alpha=0.15），越大的 DB 越透明
      const valueAlpha =
        Array.isArray(valueAlphaRange) && valueAlphaRange.length >= 2
          ? valueAlphaRange
          : DEFAULT_VALUE_ALPHA_RANGE

      // uniform：只创建一次，之后每帧就地更新字段（避免每帧 new 十余个 Cesium 对象）
      const uniforms = this.ensureNcUniforms()
      const colorStopUniforms = this.ensureColorStopUniforms(colorStops)
      this.colorStopCount = colorStopUniforms.count

      uniforms.localBox.x = volume.localHalfWidth
      uniforms.localBox.y = volume.localHalfHeight
      uniforms.localBox.z = volume.bottomAltitude
      uniforms.localBox.w = volume.topAltitude
      uniforms.geoBounds.x = volume.lonMin
      uniforms.geoBounds.y = volume.lonMax
      uniforms.geoBounds.z = volume.latMin
      uniforms.geoBounds.w = volume.latMax
      uniforms.wedgeMeta.x = meta.sourceLon
      uniforms.wedgeMeta.y = meta.sourceLat
      uniforms.wedgeMeta.z = meta.angleMin
      uniforms.wedgeMeta.w = meta.angleMax
      uniforms.wedgeMeta2.x = meta.pathMinM
      uniforms.wedgeMeta2.y = meta.pathMaxM
      uniforms.wedgeMeta2.z = meta.depthMinM
      uniforms.wedgeMeta2.w = meta.depthMaxM
      uniforms.sliceInfo.x = slicePosition
      uniforms.sliceInfo.y = sliceActive ? 1 : 0
      uniforms.sliceInfo.z = sliceMode
      uniforms.sliceInfo.w = 1
      // 着色器按罗盘方位（正北 0°、顺时针）判定切面，故把应用侧方位（正东 0°、逆时针）换算后传入
      uniforms.sliceMeta.x = meta.sourceLon
      uniforms.sliceMeta.y = meta.sourceLat
      uniforms.sliceMeta.z = toCompassBearingDeg(sliceAzimuthDeg)
      uniforms.sliceMeta.w = 360
      uniforms.alphaByValue.x = valueAlpha[0]
      uniforms.alphaByValue.y = valueAlpha[1]
      uniforms.displayTuning.x = clamp(Number(density) || 3, 0.25, 8)
      uniforms.displayTuning.y = clamp(Number(contrast) || 2, 0.5, 3)
      uniforms.displayTuning.z = clamp(Number(edgeSharpness) || 1, 0.5, 4)
      uniforms.valueInfo.x = valueRange.min
      uniforms.valueInfo.y = valueRange.max
      uniforms.valueInfo.z = volume.valueMin
      uniforms.valueInfo.w = volume.valueMax
      uniforms.colorInfo.x = colorRange?.min ?? volume.valueMin
      uniforms.colorInfo.y = colorRange?.max ?? volume.valueMax
      uniforms.colorInfo.z = colorGamma ?? 0.82
      uniforms.colorInfo.w = 1
      uniforms.depthInfo.x = depthTopIndex
      uniforms.depthInfo.y = Math.min(depthBottomIndex, depthRevealMax)
      uniforms.depthInfo.z = alphaScale ?? DEFAULT_ALPHA_SCALE
      uniforms.depthInfo.w = volume.sourceDepth
      // 采样步长由体素分辨率自适应决定，不再暴露无效的手动滑杆。
      uniforms.sampleStep = 0.01
      uniforms.strictNearest = volume.strictNearest ? 1 : 0
      uniforms.hasBottomDepth = volume.hasBottomDepth ? 1 : 0
      // 近底羽化宽度：参考工程默认 160 m，浅水时按深度跨度的 25% 上限自适应缩小。
      const featherDepthSpan = Math.max(1, meta.depthMaxM - meta.depthMinM)
      uniforms.featherM = Math.max(8, Math.min(160, featherDepthSpan * 0.25))
      Cesium.Cartesian3.clone(cameraUvw, uniforms.cameraUvw)

      const uniformMap = this.ncUniformMap

      if (!this.command) {
        this.command = new Cesium.DrawCommand({
          owner: this,
          primitiveType: Cesium.PrimitiveType.TRIANGLES,
          vertexArray: this.vertexArray,
          shaderProgram: this.shaderProgram,
          renderState: activeRenderState,
          uniformMap,
          modelMatrix: volume.modelMatrix,
          // 水下真实深度模式的包围球位于椭球内部，GeoVis 会在提交绘制前把它
          // 误判为被地球完全遮挡。此时不提供包围球，交由纹理地形掩膜裁剪。
          boundingVolume: volume.displayAboveWater ? volume.worldBoundingSphere : undefined,
          pass: Cesium.Pass.TRANSLUCENT,
        })
      }

      this.command.modelMatrix = volume.modelMatrix
      this.command.boundingVolume = volume.displayAboveWater ? volume.worldBoundingSphere : undefined
      this.command.uniformMap = uniformMap
      this.command.renderState = activeRenderState
      frameState.commandList.push(this.command)
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
}

/**
 * 方位角换算：应用层统一使用「正东 0°、逆时针为正」（atan2(北, 东)，与 AzimuthPointer 一致），
 * 而着色器内的方位是「罗盘方位」：正北 0°、顺时针为正（atan2(东, 北)，∈ (-180,180]）。
 * 二者相差 90° 且旋向相反：compass = (90 − azimuth) mod 360。
 * @param {number} azimuthDeg 应用侧方位角（度，0 = 正东，逆时针为正）
 * @returns {number} 罗盘方位角（度，∈ (-180,180]）
 */
export function toCompassBearingDeg(azimuthDeg) {
  const v = Number(azimuthDeg)
  if (!Number.isFinite(v)) return 0
  let c = (((90 - v) % 360) + 360) % 360
  if (c > 180) c -= 360
  return c
}

/**
 * 沿指定切面方位侧视声场体：相机飞到与切面方位垂直的方向，便于观察切面内部。
 * @param {Cesium.Viewer} viewer - Cesium 视图
 * @param {object} volume - 已 finalize 的体对象
 * @param {number} azimuthDeg - 切面方位角（度）
 * @param {number} [duration=0.7] - 飞行时长（秒）
 */
export function flyToNcSliceView(viewer, volume, azimuthDeg, duration = 0.7) {
  const radius = Math.max(volume.worldBoundingSphere.radius, 1)
  viewer.camera.flyToBoundingSphere(volume.worldBoundingSphere, {
    duration,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(toCompassBearingDeg(azimuthDeg) + 90),
      Cesium.Math.toRadians(-12),
      radius * 2.35,
    ),
  })
}
