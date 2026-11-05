/**
 * azimuthPointer.js — 声源点上方「可拖拽方位指针」
 * ===================================================================
 *
 * 在声源点正上方（体顶之上的水平面）绘制一根方位指针：
 *
 *   ├ 竖直虚线（stem）：由海面引到指针平面，标示「声源点上方」
 *   ├ 刻度环（ring）+ 每个可用方位的刻度点（tick）：纯辅助装饰，可整体显隐
 *   ├ 指针主体（needle）：声源点中心 → 方位端点（tip）
 *   └ 端点标签：当前方位角度
 *
 * 交互：按住「声源点上方手柄」或「指针端点」拖拽 ⇒ 实时计算相对声源的方位角，
 * 并 **吸附到数据实际存在的方位**（azimuths），指针只能停在这些方位上；
 * 每停到一个新方位即触发 `onAzimuthChange(deg)`，由上层刷新对应方位声线剖面。
 *
 * 方位约定：0° = 正东，90° = 正北（逆时针为正），与声场体渲染
 * （volumeRayLines.bearingDegFromLonLat / wedgeMeta.angleMin~angleMax）一致。
 */
const Cesium = window.GeoVis

/** 每纬度对应米数 */
const M_PER_DEG_LAT = 110574

/** 每经度对应米数 */
function mPerDegLon(lat) {
  return Math.max(1e-6, 111320 * Math.cos((lat * Math.PI) / 180))
}

/** 方位角归一化到 [0, 360) */
export function normalizeAzimuth360(deg) {
  const n = Number(deg)
  if (!Number.isFinite(n)) return 0
  return ((n % 360) + 360) % 360
}

/** 两个方位角之间的最小夹角（0~180） */
export function azimuthDiffDeg(a, b) {
  const d = Math.abs(normalizeAzimuth360(a) - normalizeAzimuth360(b))
  return Math.min(d, 360 - d)
}

/** 相对声源点的方位角（度，0 = 正东，90 = 正北） */
export function bearingDegFromSource(sourceLon, sourceLat, lon, lat) {
  const east = (Number(lon) - Number(sourceLon)) * mPerDegLon(sourceLat)
  const north = (Number(lat) - Number(sourceLat)) * M_PER_DEG_LAT
  if (!Number.isFinite(east) || !Number.isFinite(north)) return NaN
  if (Math.hypot(east, north) < 1e-6) return NaN
  return normalizeAzimuth360((Math.atan2(north, east) * 180) / Math.PI)
}

/** 由「声源点 + 方位 + 距离」求地理坐标 */
export function offsetByAzimuthDistance(sourceLon, sourceLat, azimuthDeg, distanceM) {
  const rad = (normalizeAzimuth360(azimuthDeg) * Math.PI) / 180
  const east = Math.cos(rad) * distanceM
  const north = Math.sin(rad) * distanceM
  return {
    lon: Number(sourceLon) + east / mPerDegLon(sourceLat),
    lat: Number(sourceLat) + north / M_PER_DEG_LAT,
  }
}

/** 清洗可选方位列表：去重 + 升序 + 归一化 */
export function normalizeAzimuthList(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const raw of list) {
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const deg = normalizeAzimuth360(n)
    if (!out.some((v) => azimuthDiffDeg(v, deg) < 0.01)) out.push(deg)
  }
  return out.sort((a, b) => a - b)
}

/** 相邻方位的最小间隔（度），用于容差与 UI 步进；无数据时返回 0 */
export function minAzimuthSpacingDeg(list) {
  const arr = normalizeAzimuthList(list)
  if (arr.length === 0) return 0
  if (arr.length === 1) return 360
  let min = 360
  for (let i = 0; i < arr.length; i++) {
    const next = arr[(i + 1) % arr.length]
    const step = i === arr.length - 1 ? normalizeAzimuth360(arr[0] + 360 - arr[i]) : next - arr[i]
    if (step > 0.01) min = Math.min(min, step)
  }
  return min === 360 ? 360 : min
}

/** 相邻方位切换：dir = +1（下一方位）/ -1（上一方位） */
export function stepAzimuth(list, currentDeg, dir = 1) {
  const arr = normalizeAzimuthList(list)
  if (arr.length === 0) return normalizeAzimuth360(currentDeg)
  let idx = 0
  let bestDiff = Infinity
  for (let i = 0; i < arr.length; i++) {
    const d = azimuthDiffDeg(currentDeg, arr[i])
    if (d < bestDiff) {
      bestDiff = d
      idx = i
    }
  }
  const step = Number(dir) >= 0 ? 1 : -1
  return arr[(idx + step + arr.length) % arr.length]
}

/** 默认样式 */
export const AZIMUTH_POINTER_DEFAULTS = {
  /** 未提供可选方位列表时的吸附步长（度） */
  snapStepDeg: 1,
  /** 手柄命中半径（屏幕像素） */
  hitPixelRadius: 18,
  lineWidth: 3,
  handlePixelSize: 14,
  tipPixelSize: 13,
  tickPixelSize: 5,
  activeTickPixelSize: 10,
  ringWidth: 1,
  ringAlpha: 0.4,
  ringSampleCount: 144,
  stemWidth: 1.5,
  stemAlpha: 0.55,
  /** 指针长度 = 声源半径 × activeRatio */
  activeRatio: 0.98,
  /** 刻度环半径 = 声源半径 × ringRatio */
  ringRatio: 1.06,
  color: '#22d3ee',
  activeColor: '#fbbf24',
  tickColor: '#67e8f9',
  ringColor: '#38bdf8',
  stemColor: '#38bdf8',
  labelFont: '600 13px sans-serif',
  labelFillColor: '#e0f2fe',
  labelBackground: 'rgba(2, 6, 23, 0.72)',
}

/**
 * 声源点上方方位指针（可拖拽 / 按已有方位吸附）
 */
export class AzimuthPointer {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {object} [options]
   * @param {number} [options.sourceLon] 声源经度
   * @param {number} [options.sourceLat] 声源纬度
   * @param {number} [options.baseAltitude=0] 指针所在水平面高度（米，椭球高）
   * @param {number} [options.stemBottomAltitude=0] 竖直引线底部高度（米）
   * @param {number} [options.radiusM=10000] 指针长度（米，一般取最大传播距离）
   * @param {number[]} [options.azimuths] 允许停靠的方位（度），为空时按 snapStepDeg 吸附
   * @param {number} [options.azimuthDeg=0] 初始方位，默认 0°
   * @param {Function} [options.onAzimuthChange] 方位变化回调 (deg) => void
   * @param {object} [options.style] 样式覆盖（见 AZIMUTH_POINTER_DEFAULTS）
   * @param {boolean} [options.ringVisible=true] 是否显示刻度环 / 刻度点（隐藏不影响拖拽）
   */
  constructor(viewer, options = {}) {
    if (!viewer || viewer.isDestroyed?.()) throw new Error('AzimuthPointer: viewer 无效')
    this.viewer = viewer
    this.style = { ...AZIMUTH_POINTER_DEFAULTS, ...(options.style ?? {}) }
    this.sourceLon = Number(options.sourceLon) || 0
    this.sourceLat = Number(options.sourceLat) || 0
    this.baseAltitude = Number(options.baseAltitude) || 0
    this.stemBottomAltitude = Number(options.stemBottomAltitude) || 0
    this.radiusM = Math.max(1, Number(options.radiusM) || 10000)
    this.snapStepDeg = Math.max(0.01, Number(options.snapStepDeg ?? this.style.snapStepDeg) || 1)
    this.visible = options.visible !== false
    this.draggable = options.draggable !== false
    /** 辅助刻度环 / 刻度点是否显示（隐藏后指针主体与拖拽不受影响） */
    this.ringVisible = options.ringVisible !== false
    this.onAzimuthChange = typeof options.onAzimuthChange === 'function' ? options.onAzimuthChange : null

    this._azimuths = normalizeAzimuthList(options.azimuths)
    this._azimuthDeg = this._snapAzimuth(options.azimuthDeg ?? 0)
    this._dragging = false
    this._entities = []
    /** 辅助装饰实体（刻度环 + 刻度点 + 当前方位高亮点），可整体显隐 */
    this._ringEntities = []
    this._centerCartesian = null
    this._tipCartesian = null
    this._needleEntity = null
    this._tipEntity = null
    this._activeTickEntity = null
    this._originalCursor = viewer.canvas?.style?.cursor ?? ''

    this._rebuild()
    this._bindEvents()
  }

  /** 当前方位（度） */
  get azimuthDeg() {
    return this._azimuthDeg
  }

  /** 允许停靠的方位列表（升序，[0,360)） */
  get azimuths() {
    return [...this._azimuths]
  }

  /** 是否正在拖拽 */
  get dragging() {
    return this._dragging
  }

  /**
   * 更新几何参数（声源 / 高度 / 半径 / 可选方位 / 回调等），未传入的字段保持原值
   */
  update(options = {}) {
    let geometryChanged = false
    let visibilityChanged = false
    if (options.sourceLon != null) {
      this.sourceLon = Number(options.sourceLon)
      geometryChanged = true
    }
    if (options.sourceLat != null) {
      this.sourceLat = Number(options.sourceLat)
      geometryChanged = true
    }
    if (options.baseAltitude != null) {
      this.baseAltitude = Number(options.baseAltitude)
      geometryChanged = true
    }
    if (options.stemBottomAltitude != null) {
      this.stemBottomAltitude = Number(options.stemBottomAltitude)
      geometryChanged = true
    }
    if (options.radiusM != null) {
      this.radiusM = Math.max(1, Number(options.radiusM))
      geometryChanged = true
    }
    if (options.snapStepDeg != null) this.snapStepDeg = Math.max(0.01, Number(options.snapStepDeg))
    if (options.azimuths != null) {
      this._azimuths = normalizeAzimuthList(options.azimuths)
      geometryChanged = true
    }
    if (options.style) {
      this.style = { ...this.style, ...options.style }
      geometryChanged = true
    }
    if (options.visible != null) {
      this.visible = !!options.visible
      visibilityChanged = true
    }
    if (options.ringVisible != null) {
      this.ringVisible = !!options.ringVisible
      visibilityChanged = true
    }
    if (options.draggable != null) this.draggable = !!options.draggable
    if (typeof options.onAzimuthChange === 'function') this.onAzimuthChange = options.onAzimuthChange

    if (options.azimuthDeg != null) {
      const snap = options.snap !== false
      this._azimuthDeg = snap ? this._snapAzimuth(options.azimuthDeg) : normalizeAzimuth360(options.azimuthDeg)
    } else if (this._azimuths.length) {
      this._azimuthDeg = this._snapAzimuth(this._azimuthDeg)
    }

    if (geometryChanged) {
      this._rebuild()
    } else {
      if (visibilityChanged) {
        this._applyVisibility()
        if (!this.visible) this._endDrag()
      }
      this._updatePointer()
    }
    return this._azimuthDeg
  }

  /**
   * 设置当前方位
   * @param {number} deg 目标方位
   * @param {object} [opts]
   * @param {boolean} [opts.snap=true] 是否吸附到已有方位（拖拽 / 切换方位用）
   * @param {boolean} [opts.silent=false] true 时不触发 onAzimuthChange（外部回写位置用）
   */
  setAzimuth(deg, opts = {}) {
    const target = opts.snap === false ? normalizeAzimuth360(Number(deg)) : this._snapAzimuth(Number(deg))
    const changed = azimuthDiffDeg(target, this._azimuthDeg) > 1e-6
    this._azimuthDeg = target
    if (changed) this._updatePointer()
    if (changed && !opts.silent) this.onAzimuthChange?.(target)
    return target
  }

  /** 设置可选方位列表，并把当前方位吸附到最近的合法方位 */
  setAzimuths(list) {
    this._azimuths = normalizeAzimuthList(list)
    this.setAzimuth(this._azimuthDeg, { silent: true })
    this._rebuild()
    return [...this._azimuths]
  }

  /** 显示 / 隐藏指针（隐藏后不可拖拽） */
  setVisible(visible) {
    this.visible = !!visible
    this._applyVisibility()
    if (!this.visible) this._endDrag()
    this.requestRender()
  }

  /** 是否允许拖拽 */
  setDraggable(draggable) {
    this.draggable = !!draggable
    if (!this.draggable) this._endDrag()
  }

  /**
   * 显示 / 隐藏辅助刻度环与刻度点
   * 只影响装饰实体；指针主体、端点手柄与拖拽命中判定保持不变，因此拖拽仍可用。
   * @param {boolean} visible
   */
  setRingVisible(visible) {
    this.ringVisible = !!visible
    this._applyVisibility()
    this.requestRender()
  }

  requestRender() {
    this.viewer?.scene?.requestRender()
  }

  /** 销毁实体与事件监听 */
  destroy() {
    this._endDrag()
    this._unbindEvents()
    this._removeEntities()
    this.onAzimuthChange = null
  }

  // ── 内部：吸附 ───────────────────────────────────────────────
  _snapAzimuth(deg) {
    const norm = normalizeAzimuth360(deg)
    if (this._azimuths.length === 0) {
      const step = this.snapStepDeg
      return normalizeAzimuth360(Math.round(norm / step) * step)
    }
    let best = this._azimuths[0]
    let bestDiff = Infinity
    for (const a of this._azimuths) {
      const d = azimuthDiffDeg(norm, a)
      if (d < bestDiff) {
        bestDiff = d
        best = a
      }
    }
    return best
  }

  // ── 内部：几何计算 ───────────────────────────────────────────
  _centerPosition() {
    return Cesium.Cartesian3.fromDegrees(this.sourceLon, this.sourceLat, this.baseAltitude)
  }

  _positionAt(azimuthDeg, distanceM) {
    const { lon, lat } = offsetByAzimuthDistance(this.sourceLon, this.sourceLat, azimuthDeg, distanceM)
    return Cesium.Cartesian3.fromDegrees(lon, lat, this.baseAltitude)
  }

  _ringPositions() {
    const count = Math.max(24, Number(this.style.ringSampleCount) || 144)
    const positions = []
    for (let i = 0; i <= count; i++) {
      positions.push(this._positionAt((i / count) * 360, this.radiusM * this.style.ringRatio))
    }
    return positions
  }

  // ── 内部：实体构建 ───────────────────────────────────────────
  _rebuild() {
    this._removeEntities()
    const entities = this.viewer.entities
    if (!entities) return

    /** 登记辅助装饰实体：进入 _ringEntities，便于整体显隐 */
    const addRingEntity = (opts) => {
      const entity = entities.add(opts)
      this._entities.push(entity)
      this._ringEntities.push(entity)
      return entity
    }

    const color = Cesium.Color.fromCssColorString(this.style.color).withAlpha(0.95)
    const tickColor = Cesium.Color.fromCssColorString(this.style.tickColor).withAlpha(0.85)
    const ringColor = Cesium.Color.fromCssColorString(this.style.ringColor).withAlpha(this.style.ringAlpha)
    const stemColor = Cesium.Color.fromCssColorString(this.style.stemColor).withAlpha(this.style.stemAlpha)

    // 竖直引线：声源点 → 指针平面（标示「声源点上方」）
    this._entities.push(
      entities.add({
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(this.sourceLon, this.sourceLat, this.stemBottomAltitude),
            this._centerPosition(),
          ],
          width: this.style.stemWidth,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: stemColor,
            gapColor: Cesium.Color.TRANSPARENT,
            dashLength: Math.max(8, Math.round(this.radiusM / 60)),
          }),
        },
      })
    )

    // 刻度环
    addRingEntity({
      polyline: {
        positions: this._ringPositions(),
        width: this.style.ringWidth,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.ColorMaterialProperty(ringColor),
      },
    })

    // 可用方位刻度点
    for (const az of this._azimuths) {
      addRingEntity({
        position: this._positionAt(az, this.radiusM * this.style.ringRatio),
        point: {
          pixelSize: this.style.tickPixelSize,
          color: tickColor,
          outlineColor: Cesium.Color.TRANSPARENT,
          outlineWidth: 0,
          disableDepthTestDistance: 0,
        },
      })
    }

    // 当前方位高亮刻度
    this._activeTickEntity = addRingEntity({
      position: this._positionAt(this._azimuthDeg, this.radiusM * this.style.ringRatio),
      point: {
        pixelSize: this.style.activeTickPixelSize,
        color: Cesium.Color.fromCssColorString(this.style.activeColor).withAlpha(0.95),
        outlineColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.8),
        outlineWidth: 2,
        disableDepthTestDistance: 0,
      },
    })

    // 指针主体
    this._needleEntity = entities.add({
      polyline: {
        positions: [this._centerPosition(), this._positionAt(this._azimuthDeg, this.radiusM * this.style.activeRatio)],
        width: this.style.lineWidth,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.ColorMaterialProperty(color),
      },
    })
    this._entities.push(this._needleEntity)

    // 端点（拖拽手柄）+ 方位读数
    this._tipEntity = entities.add({
      position: this._positionAt(this._azimuthDeg, this.radiusM * this.style.activeRatio),
      point: {
        pixelSize: this.style.tipPixelSize,
        color,
        outlineColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.8),
        outlineWidth: 2,
        disableDepthTestDistance: 0,
      },
      label: {
        text: this._labelText(),
        font: this.style.labelFont,
        fillColor: Cesium.Color.fromCssColorString(this.style.labelFillColor),
        backgroundColor: Cesium.Color.fromCssColorString(this.style.labelBackground),
        showBackground: true,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: 0,
      },
    })
    this._entities.push(this._tipEntity)

    // 中心手柄（声源点上方，主要拖拽入口）
    this._entities.push(
      entities.add({
        position: this._centerPosition(),
        point: {
          pixelSize: this.style.handlePixelSize,
          color,
          outlineColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.8),
          outlineWidth: 2,
          disableDepthTestDistance: 0,
        },
      })
    )

    this._applyVisibility()
    this._updatePointer()
    this.requestRender()
  }

  _labelText() {
    // 指针内部用「正东 0°、逆时针」；界面统一显示「正北 0°、顺时针」的罗盘方位，
    // 与参数摘要 / 剖面图 / 方位下拉保持一致。
    const compass = (((90 - this._azimuthDeg) % 360) + 360) % 360
    return `${compass.toFixed(1)}°`
  }

  _updatePointer() {
    const center = this._centerPosition()
    const tip = this._positionAt(this._azimuthDeg, this.radiusM * this.style.activeRatio)
    this._centerCartesian = center
    this._tipCartesian = tip

    if (this._needleEntity?.polyline) {
      this._needleEntity.polyline.positions = [center, tip]
    }
    if (this._tipEntity) {
      this._tipEntity.position = tip
      if (this._tipEntity.label) this._tipEntity.label.text = this._labelText()
    }
    if (this._activeTickEntity) {
      this._activeTickEntity.position = this._positionAt(this._azimuthDeg, this.radiusM * this.style.ringRatio)
    }
    this.requestRender()
  }

  _applyVisibility() {
    for (const entity of this._entities) {
      if (entity) entity.show = this.visible
    }
    // 辅助装饰单独叠加一层控制：整体隐藏时装饰必然隐藏
    const ringShow = this.visible && this.ringVisible
    for (const entity of this._ringEntities) {
      if (entity) entity.show = ringShow
    }
  }

  _removeEntities() {
    const entities = this.viewer?.entities
    if (entities) {
      for (const entity of this._entities) {
        entities.remove(entity)
      }
    }
    this._entities = []
    this._ringEntities = []
    this._needleEntity = null
    this._tipEntity = null
    this._activeTickEntity = null
  }

  // ── 内部：交互 ───────────────────────────────────────────────
  _bindEvents() {
    const canvas = this.viewer.canvas || this.viewer.scene?.canvas
    if (!canvas) return
    this._handler = new Cesium.ScreenSpaceEventHandler(canvas)
    this._handler.setInputAction((evt) => this._onLeftDown(evt), Cesium.ScreenSpaceEventType.LEFT_DOWN)
    this._handler.setInputAction((evt) => this._onMouseMove(evt), Cesium.ScreenSpaceEventType.MOUSE_MOVE)
    this._handler.setInputAction(() => this._endDrag(), Cesium.ScreenSpaceEventType.LEFT_UP)
    // 鼠标移出画布后松键也能安全结束拖拽
    this._onWindowMouseUp = () => this._endDrag()
    window.addEventListener('mouseup', this._onWindowMouseUp)
  }

  _unbindEvents() {
    if (this._handler && !this._handler.isDestroyed()) this._handler.destroy()
    this._handler = null
    if (this._onWindowMouseUp) {
      window.removeEventListener('mouseup', this._onWindowMouseUp)
      this._onWindowMouseUp = null
    }
  }

  /** 命中判定：中心手柄、指针端点或整根指针线，屏幕像素距离在阈值内即可拖动。 */
  _isPickable(windowPos) {
    if (!windowPos) return false
    const radius = Number(this.style.hitPixelRadius) || 18
    const center = this._toWindow(this._centerCartesian)
    const tip = this._toWindow(this._tipCartesian)
    if (center && Cesium.Cartesian2.distance(center, windowPos) <= radius) return true
    if (tip && Cesium.Cartesian2.distance(tip, windowPos) <= radius) return true
    if (center && tip) return this._distanceToSegment(windowPos, center, tip) <= radius
    return false
  }

  /** 世界坐标 → 窗口坐标（CSS 像素）。兼容不同 GeoVis/Cesium 版本的函数名。 */
  _toWindow(cartesian) {
    if (!cartesian) return null
    try {
      const transforms = Cesium.SceneTransforms
      const scene = this.viewer.scene
      // 本项目 GeoVis 提供 wgs84ToWindowCoordinates；旧版 Cesium 用 worldToWindowCoordinates。
      // 若函数名不存在，命中判定会永远失败，导致箭头看似无法拖动。
      const win =
        typeof transforms?.worldToWindowCoordinates === 'function'
          ? transforms.worldToWindowCoordinates(scene, cartesian)
          : typeof transforms?.wgs84ToWindowCoordinates === 'function'
            ? transforms.wgs84ToWindowCoordinates(scene, cartesian)
            : null
      return win ?? null
    } catch {
      return null
    }
  }

  /** 点到线段的屏幕像素距离 */
  _distanceToSegment(point, a, b) {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const apx = point.x - a.x
    const apy = point.y - a.y
    const lengthSq = abx * abx + aby * aby
    if (lengthSq <= 1e-6) return Math.hypot(point.x - a.x, point.y - a.y)
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq))
    return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t))
  }

  _onLeftDown(evt) {
    if (!this.visible || !this.draggable) return
    if (!this._isPickable(evt?.position)) return

    this._dragging = true
    const controller = this.viewer.scene?.screenSpaceCameraController
    if (controller) controller.enableInputs = false
    if (this.viewer.canvas) this.viewer.canvas.style.cursor = 'grabbing'
    this._clearSelection()
    this._setActiveStyle(true)
  }

  /** 拖拽期间清掉默认选中，避免弹出 Cesium 信息框 / 选中指示器 */
  _clearSelection() {
    try {
      if (this.viewer?.selectedEntity) this.viewer.selectedEntity = undefined
    } catch {
      /* 忽略：部分自定义 Viewer 可能不支持该 setter */
    }
  }

  _onMouseMove(evt) {
    const windowPos = evt?.endPosition
    if (!windowPos) return

    if (this._dragging) {
      const az = this._azimuthAtWindowPosition(windowPos)
      if (az != null) this.setAzimuth(az)
      return
    }
    if (!this.visible || !this.draggable || !this.viewer.canvas) return
    this.viewer.canvas.style.cursor = this._isPickable(windowPos) ? 'grab' : this._originalCursor
  }

  _endDrag() {
    if (!this._dragging) return
    this._dragging = false
    const controller = this.viewer.scene?.screenSpaceCameraController
    if (controller) controller.enableInputs = true
    if (this.viewer.canvas) this.viewer.canvas.style.cursor = this._originalCursor
    this._clearSelection()
    this._setActiveStyle(false)
  }

  _setActiveStyle(active) {
    const colorStr = active ? this.style.activeColor : this.style.color
    const color = Cesium.Color.fromCssColorString(colorStr).withAlpha(0.95)
    if (this._needleEntity?.polyline) {
      this._needleEntity.polyline.material = new Cesium.ColorMaterialProperty(color)
      this._needleEntity.polyline.width = Number(this.style.lineWidth) + (active ? 2 : 0)
    }
    if (this._tipEntity?.point) {
      this._tipEntity.point.color = color
      this._tipEntity.point.pixelSize = Number(this.style.tipPixelSize) + (active ? 6 : 0)
    }
    this.requestRender()
  }

  /** 由鼠标位置反算相对声源的方位角（射线与指针水平面求交） */
  _azimuthAtWindowPosition(windowPos) {
    const ray = this.viewer.camera?.getPickRay(windowPos)
    if (!ray) return null

    const planeOrigin = this._centerPosition()
    const normal = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.fromDegrees(this.sourceLon, this.sourceLat, 0),
      new Cesium.Cartesian3()
    )
    const plane = Cesium.Plane.fromPointNormal(planeOrigin, normal)
    const hit = Cesium.IntersectionTests.rayPlane(ray, plane, new Cesium.Cartesian3())
    if (!hit) return null

    const cart = Cesium.Cartographic.fromCartesian(hit)
    if (!cart) return null

    const east = (Cesium.Math.toDegrees(cart.longitude) - this.sourceLon) * mPerDegLon(this.sourceLat)
    const north = (Cesium.Math.toDegrees(cart.latitude) - this.sourceLat) * M_PER_DEG_LAT
    // 离声源太近时方位抖动剧烈，保持原方位
    if (Math.hypot(east, north) < Math.max(1, this.radiusM * 0.02)) return null

    return normalizeAzimuth360((Math.atan2(north, east) * 180) / Math.PI)
  }
}
