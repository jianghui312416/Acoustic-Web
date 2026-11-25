/**
 * SoundField — NC 声场体渲染门面
 *
 * 封装 NC 极坐标声场体（TL 传播损失）在 Cesium 中的完整渲染管线：
 *
 *   - 数据解码：`decodeNcPolarVolumeJson`（极坐标体 JSON）
 *   - 体渲染：`NcPolarShaderVolume3DPrimitive`（WebGL2 sampler3D ray-marching）
 *   - 切面裁切：方位角 / 深度 / 经度 / 纬度 四方向
 *   - 声线叠加：`createVolumeRayLineCollection`（与切面同步的方位剖面声线）
 *   - 视角控制：全景 / 俯视 / 侧视切面
 *
 * 该类负责 primitive / polyline 的增删与生命周期管理，屏蔽 Cesium 底层细节，
 * 使视图层（Vue/React）只需声明状态、调用 `load()` 与 `setDisplay()` 即可。
 */
import { VOLUME_TL_COLOR_MIN, VOLUME_TL_COLOR_MAX, VOLUME_TL_COLOR_STOPS } from './tlColor.js'
import {
  NcPolarShaderVolume3DPrimitive,
  VOLUME_SLICE_MODE,
  DEFAULT_ALPHA_SCALE,
  DEFAULT_VALUE_ALPHA_RANGE,
  flyToVolumeBoundingSphere,
  flyToNcSliceView,
} from './shaderVolume3D.js'
import { finalizeNcPolarVolume, NC_DEFAULT_SOURCE } from './ncVolumeBuilder.js'
import { createRayLineCollectionFromRays, groupScatterPointsByRay, computeRayBearingDeg } from './volumeRayLines.js'
import { AzimuthPointer, azimuthDiffDeg } from './azimuthPointer.js'

const Cesium = window.GeoVis

/** 默认显示参数 */
const DEFAULT_DISPLAY = {
  valueRange: { min: VOLUME_TL_COLOR_MIN, max: VOLUME_TL_COLOR_MAX },
  colorRange: { min: VOLUME_TL_COLOR_MIN, max: VOLUME_TL_COLOR_MAX },
  colorGamma: 0.82,
  alphaScale: DEFAULT_ALPHA_SCALE,
  density: 3,
  contrast: 2,
  edgeSharpness: 1,
  /** 色标透明度区间：60 dB（红）alpha=1 → 120 dB（蓝）alpha=0.15（越大的 DB 越透明） */
  valueAlphaRange: [...DEFAULT_VALUE_ALPHA_RANGE],
  sliceClip: { enabled: false, mode: VOLUME_SLICE_MODE.azimuth, position: 1, azimuthDeg: 0 },
  rayLines: {
    visible: false,
    lineWidth: 1.5,
    lineAlpha: 0.92,
    /** 仅绘制该方位的声线（null = 全部方位） */
    azimuth: null,
    /** 方位容差（度）：建议取相邻方位间隔的一半 */
    azimuthToleranceDeg: 1.5,
  },
  /** TL 色标（可运行时自定义）：[[t, [r,g,b]], ...]，t 0–1，rgb 0–255 */
  colorStops: VOLUME_TL_COLOR_STOPS,
}

export class SoundField {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {object} [opts]
   * @param {number} [opts.depthExaggeration=10] 深度夸张倍数
   */
  constructor(viewer, opts = {}) {
    this.viewer = viewer
    this.depthExaggeration = opts.depthExaggeration ?? 10
    // 默认按真实水深放置：最浅层贴海平面，深度夸张时向下延伸，并采用透视显示
    // （GeoVis 1.73 的 globe 不支持地下半透明）。这样加大垂向夸张时体只向下变厚，
    // 不会整体被抬到空中形成“漂浮”错觉。水域范围与海底形状仍由接口高程 +
    // 数字地球地形掩膜决定。
    // 置为 true 可退回旧的“整体抬升到海面以上”显示（仅在需要时显式开启）。
    this.displayAboveWater = opts.displayAboveWater === true

    /** @type {object|null} 解码后的原始纹理（未 finalize） */
    this.rawTexture = null
    /** @type {object|null} finalize 后的体数据（供 primitive 与声线使用） */
    this.volume = null
    /** @type {object|null} 数据边界 bounds（lon/lat/depth/value） */
    this.bounds = null
    /** @type {Array<object>} 方位剖面声线散点 */
    this.scatterPoints = []

    /** @type {NcPolarShaderVolume3DPrimitive|null} */
    this.primitive = null
    /** @type {Cesium.PolylineCollection|null} */
    this.rayLineCollection = null
    /** @type {AzimuthPointer|null} 声源点上方「可拖拽方位指针」 */
    this.pointer = null

    /** @type {{rays: Array<Array<object>>, bearings: number[]}|null} 声线分组缓存 */
    this._rayGroups = null
    /** @type {Array<object>|null} 缓存对应的散点引用（用于失效判定） */
    this._rayGroupsSource = null
    /** 声线集合重建签名：外观参数变化但签名未变时跳过重建 */
    this._rayLinesKey = ''
    this._rayLinesVolume = null
    this._rayLinesPoints = null
    /** 方位指针最近一次同步的几何参数签名 */
    this._pointerGeomKey = ''

    /** @type {object} 当前显示参数 */
    this.display = { ...DEFAULT_DISPLAY }
  }

  /** 是否已加载体数据 */
  get loaded() {
    return !!this.volume
  }

  /** 当前渲染错误（primitive 的 lastError） */
  getError() {
    return this.primitive?.getError?.() ?? null
  }

  /** 计算切面裁切参数（由 display.sliceClip 提供） */
  getSliceClipOptions() {
    return { ...this.display.sliceClip }
  }

  /**
   * 从极坐标体 JSON 解码并加载体数据
   * @param {object} raw - decodeNcPolarVolumeJson 的输入（含 texture.dataBase64）
   * @param {Function} decodeNcPolarVolumeJson - 解码函数（由调用方注入，保持本类与 builder 解耦）
   */
  setVolume(raw, decodeNcPolarVolumeJson) {
    const texture = decodeNcPolarVolumeJson(raw)
    this.rawTexture = texture
    this.bounds = raw.bounds ?? null
    this.volume = finalizeNcPolarVolume(texture, this.depthExaggeration, {
      displayAboveWater: this.displayAboveWater,
    })
    this.display.valueRange = {
      min: VOLUME_TL_COLOR_MIN,
      max: VOLUME_TL_COLOR_MAX,
    }
    return this.volume
  }

  /** 设置声线散点（由 layers JSON 解析得到） */
  setScatterPoints(points) {
    this.scatterPoints = Array.isArray(points) ? points : []
    // 散点变化 ⇒ 分组与方位缓存失效
    this._rayGroupsSource = null
  }

  /**
   * 声线分组 + 每条声线的方位缓存（拖拽方位指针频繁重建声线时避免全量重排序）
   * @returns {{rays: Array<Array<object>>, bearings: number[]}}
   */
  ensureRayGroups() {
    if (this._rayGroupsSource === this.scatterPoints && this._rayGroups) {
      return this._rayGroups
    }
    const wedge = this.volume?.wedgeMeta ?? this.rawTexture?.wedgeMeta ?? {}
    const source = { lon: wedge.sourceLon, lat: wedge.sourceLat }
    const rays = groupScatterPointsByRay(this.scatterPoints)
    this._rayGroups = {
      rays,
      bearings: rays.map((ray) => computeRayBearingDeg(ray, source)),
    }
    this._rayGroupsSource = this.scatterPoints
    return this._rayGroups
  }

  /** 重建体数据（深度夸张变化时调用） */
  refinalize(depthExaggeration) {
    if (!this.rawTexture) return null
    this.depthExaggeration = depthExaggeration
    this.volume = finalizeNcPolarVolume(this.rawTexture, depthExaggeration, {
      displayAboveWater: this.displayAboveWater,
    })
    this.syncPointerGeometry()
    return this.volume
  }

  /** 由当前体数据推导方位指针的默认几何参数（声源 / 抬升高度 / 指针长度） */
  getPointerGeometry() {
    const wedge = this.volume?.wedgeMeta ?? this.rawTexture?.wedgeMeta ?? {}
    const visiblePathMaxM = Number(this.volume?.visiblePathMaxM ?? this.rawTexture?.visiblePathMaxM)
    const radiusM = Math.max(
      1,
      (Number.isFinite(visiblePathMaxM) && visiblePathMaxM > 0
        ? visiblePathMaxM
        : Number(wedge.pathMaxM)) || 10000
    )
    const srcLon = Number(wedge.sourceLon)
    const srcLat = Number(wedge.sourceLat)
    // 指针平面抬到体顶之上：便于抓取，也不被体渲染遮挡
    const aboveTopM = Math.max(1000, (Number(this.volume?.localHalfWidth) || radiusM) * 0.08)
    return {
      sourceLon: Number.isFinite(srcLon) ? srcLon : NC_DEFAULT_SOURCE.lon,
      sourceLat: Number.isFinite(srcLat) ? srcLat : NC_DEFAULT_SOURCE.lat,
      radiusM,
      aboveTopM,
      baseAltitude: (Number(this.volume?.topAltitude) || 0) + aboveTopM,
      // 竖向引线：由体顶（提升后即海面）连到指针平面
      stemBottomAltitude: Number(this.volume?.topAltitude) || 0,
    }
  }

  /**
   * 创建 / 更新声源点上方「可拖拽方位指针」
   *
   * 指针默认指向 0°（正东），拖拽时吸附到 `azimuths` 中的已有方位，
   * 停靠后通过 `onAzimuthChange(deg)` 通知上层切换对应方位的声线剖面。
   *
   * @param {object} [options]
   * @param {number[]} [options.azimuths] 允许停靠的方位列表（度，0 = 正东）
   * @param {number} [options.azimuthDeg=0] 初始方位，缺省 0°
   * @param {boolean} [options.visible=true] 是否显示
   * @param {boolean} [options.draggable=true] 是否可拖拽
   * @param {boolean} [options.ringVisible=true] 是否显示辅助刻度环 / 刻度点（隐藏不影响拖拽）
   * @param {Function} [options.onAzimuthChange] 方位变化回调
   * @param {number} [options.sourceLon] 覆盖默认声源经度
   * @param {number} [options.sourceLat] 覆盖默认声源纬度
   * @param {number} [options.baseAltitude] 覆盖默认指针平面高度（米）
   * @param {number} [options.radiusM] 覆盖默认指针长度（米）
   * @param {object} [options.style] 指针样式
   * @returns {AzimuthPointer|null}
   */
  setAzimuthPointer(options = {}) {
    if (!this.viewer || this.viewer.isDestroyed?.()) return null

    this._pointerOptions = { ...(this._pointerOptions ?? {}), ...options }
    const geo = this.getPointerGeometry()
    const cfg = {
      sourceLon: options.sourceLon ?? geo.sourceLon,
      sourceLat: options.sourceLat ?? geo.sourceLat,
      baseAltitude: options.baseAltitude ?? geo.baseAltitude,
      radiusM: options.radiusM ?? geo.radiusM,
      stemBottomAltitude: options.stemBottomAltitude ?? geo.stemBottomAltitude,
      azimuths: options.azimuths ?? this._pointerOptions.azimuths ?? [],
      azimuthDeg: options.azimuthDeg ?? 0,
      visible: options.visible !== false,
      draggable: options.draggable !== false,
      ringVisible: options.ringVisible ?? this._pointerOptions?.ringVisible !== false,
      style: options.style,
      onAzimuthChange: options.onAzimuthChange ?? this._pointerOptions.onAzimuthChange,
    }

    if (this.pointer) {
      this.pointer.update(cfg)
      return this.pointer
    }
    this.pointer = new AzimuthPointer(this.viewer, cfg)
    return this.pointer
  }

  /** 体数据几何变化后同步指针位置（如深度夸张调整） */
  syncPointerGeometry() {
    if (!this.pointer) return
    const opts = this._pointerOptions ?? {}
    const geo = this.getPointerGeometry()
    const cfg = {
      sourceLon: opts.sourceLon ?? geo.sourceLon,
      sourceLat: opts.sourceLat ?? geo.sourceLat,
      baseAltitude: opts.baseAltitude ?? geo.baseAltitude,
      radiusM: opts.radiusM ?? geo.radiusM,
      stemBottomAltitude: opts.stemBottomAltitude ?? geo.stemBottomAltitude,
    }
    const key = [
      cfg.sourceLon,
      cfg.sourceLat,
      cfg.baseAltitude,
      cfg.radiusM,
      cfg.stemBottomAltitude,
    ].join('|')
    if (key === this._pointerGeomKey) return
    this._pointerGeomKey = key
    this.pointer.update(cfg)
  }

  /** 显示 / 隐藏方位指针 */
  setAzimuthPointerVisible(visible) {
    if (this._pointerOptions) this._pointerOptions.visible = !!visible
    this.pointer?.setVisible(visible)
  }

  /** 显示 / 隐藏方位指针的辅助刻度环与刻度点（不影响拖拽） */
  setAzimuthPointerRingVisible(visible) {
    if (this._pointerOptions) this._pointerOptions.ringVisible = !!visible
    this.pointer?.setRingVisible(visible)
  }

  /** 移除方位指针 */
  removeAzimuthPointer() {
    if (this.pointer) {
      this.pointer.destroy()
      this.pointer = null
    }
    this._pointerOptions = null
    this._pointerGeomKey = ''
  }

  /** 更新显示参数并同步 primitive / 声线 */
  setDisplay(patch = {}, syncOptions = {}) {
    this.display = {
      ...this.display,
      ...patch,
      valueRange: { ...this.display.valueRange, ...(patch.valueRange ?? {}) },
      colorRange: { ...this.display.colorRange, ...(patch.colorRange ?? {}) },
      sliceClip: { ...this.display.sliceClip, ...(patch.sliceClip ?? {}) },
      rayLines: { ...this.display.rayLines, ...(patch.rayLines ?? {}) },
      colorStops: patch.colorStops ?? this.display.colorStops,
      valueAlphaRange: patch.valueAlphaRange ?? this.display.valueAlphaRange,
    }
    this.sync(syncOptions)
  }

  /** 构建 primitive options 并同步到场景 */
  sync(syncOptions = {}) {
    if (!this.viewer || this.viewer.isDestroyed() || !this.volume) return

    const vol = this.volume
    const d = this.display
    const options = {
      volume: vol,
      valueRange: d.valueRange,
      colorRange: d.colorRange,
      colorGamma: d.colorGamma,
      depthTopIndex: 0,
      depthBottomIndex: Math.max(0, vol.sourceDepth - 1),
      depthRevealMax: Math.max(0, vol.sourceDepth - 1),
      alphaScale: d.alphaScale,
      density: d.density,
      contrast: d.contrast,
      edgeSharpness: d.edgeSharpness,
      valueAlphaRange: d.valueAlphaRange,
      sliceClip: d.sliceClip,
      colorStops: d.colorStops,
    }

    if (!this.primitive) {
      this.primitive = new NcPolarShaderVolume3DPrimitive(options)
      this.viewer.scene.primitives.add(this.primitive)
    } else {
      this.primitive.updateOptions(options)
    }

    if (!syncOptions.skipRayLines) this.syncRayLines()
    this.syncPointerGeometry()
    // 确保体渲染 uniform（含 colorStops）变化后立即重绘，而非等待下一次渲染循环
    this.requestRender()
  }

  /** 移除声线集合 */
  removeRayLines() {
    if (this.rayLineCollection && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.rayLineCollection)
    }
    this.rayLineCollection = null
    this._rayLinesKey = ''
    this._rayLinesVolume = null
    this._rayLinesPoints = null
  }

  /** 与声线几何/颜色相关的签名：FOM、透明度等纯 uniform 变化不会触发重建 */
  getRayLinesKey() {
    const rl = this.display.rayLines ?? {}
    const slice = this.display.sliceClip ?? {}
    const stops = this.display.colorStops ?? []
    const stopKey = stops.map(([t, c]) => `${t}:${c?.join(',')}`).join(';')
    return [
      rl.visible ? 1 : 0,
      rl.azimuth ?? '',
      rl.azimuthToleranceDeg ?? '',
      rl.lineWidth ?? '',
      rl.lineAlpha ?? '',
      rl.colorMode?.fixed ?? '',
      rl.colorMode?.blue ? 1 : 0,
      rl.colorMode?.blueAlpha ?? '',
      slice.enabled ? 1 : 0,
      slice.mode ?? '',
      slice.position ?? '',
      slice.azimuthDeg ?? '',
      stopKey,
    ].join('|')
  }

  /** 重建与切面同步的声线集合（几何未变时复用现有集合） */
  syncRayLines(force = false) {
    if (!this.viewer || this.viewer.isDestroyed() || !this.volume) return

    const key = this.getRayLinesKey()
    if (
      !force &&
      this._rayLinesKey === key &&
      this._rayLinesVolume === this.volume &&
      this._rayLinesPoints === this.scatterPoints
    ) {
      this.requestRender()
      return
    }
    this.removeRayLines()
    this._rayLinesKey = key
    this._rayLinesVolume = this.volume
    this._rayLinesPoints = this.scatterPoints

    const rl = this.display.rayLines
    if (!rl.visible || !this.scatterPoints.length) {
      this.requestRender()
      return
    }

    // 选中某个方位时只绘制该方位的声线（方位声线剖面）；否则绘制全部声线
    const { rays, bearings } = this.ensureRayGroups()
    const selected = Number.isFinite(Number(rl.azimuth))
      ? rays.filter((_, i) => Number.isFinite(bearings[i]) && azimuthDiffDeg(bearings[i], Number(rl.azimuth)) <= (rl.azimuthToleranceDeg ?? 1.5))
      : rays

    this.rayLineCollection = createRayLineCollectionFromRays(selected, this.volume, {
      sliceClip: this.display.sliceClip,
      lineWidth: rl.lineWidth,
      lineAlpha: rl.lineAlpha,
      colorMode: rl.colorMode,
      colorStops: this.display.colorStops,
    })

    if (this.rayLineCollection.length > 0) {
      this.viewer.scene.primitives.add(this.rayLineCollection)
    } else {
      this.removeRayLines()
    }

    this.requestRender()
  }

  requestRender() {
    this.viewer?.scene?.requestRender()
  }

  /** 全景视角 */
  flyToOverview(duration = 0.7) {
    if (this.viewer && this.volume) {
      flyToVolumeBoundingSphere(this.viewer, this.volume, 'overview', duration)
    }
  }

  /** 俯视视角 */
  flyToTop(duration = 0.6) {
    if (this.viewer && this.volume) {
      flyToVolumeBoundingSphere(this.viewer, this.volume, 'top', duration)
    }
  }

  /** 沿切面方位侧视 */
  flyToSliceView(azimuthDeg, duration = 0.7) {
    if (this.viewer && this.volume) {
      flyToNcSliceView(this.viewer, this.volume, azimuthDeg, duration)
    }
  }

  /** 只释放 GPU / 场景资源，保留 CPU 体数据，供视图切换后快速重建。 */
  releaseRenderer() {
    this.removeRayLines()
    this.removeAzimuthPointer()
    if (this.primitive && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.primitive)
      if (!this.primitive.isDestroyed?.()) this.primitive.destroy()
    }
    this.primitive = null
  }

  /** 清理 primitive / 声线 / 方位指针与 CPU 数据引用。 */
  destroy() {
    this.releaseRenderer()
    this.volume = null
    this.rawTexture = null
    this.scatterPoints = []
    this._rayGroups = null
    this._rayGroupsSource = null
    this._rayLinesKey = ''
    this._rayLinesVolume = null
    this._rayLinesPoints = null
    this._pointerGeomKey = ''
  }
}
