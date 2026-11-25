import { reactive } from 'vue'

export const VOLUME_COLORMAPS = Object.freeze([
  Object.freeze({
    // 与 bellhop_gebco 参考工程 fieldColor 一致的 8 段色带（45–128+ dB，红黄绿青蓝）。
    id: 'bellhop',
    label: 'custom',
    stops: Object.freeze([
      [0.0, [227, 20, 48]],
      [0.1205, [252, 54, 36]],
      [0.2169, [255, 194, 23]],
      [0.3012, [178, 235, 31]],
      [0.3976, [31, 207, 89]],
      [0.5181, [13, 171, 184]],
      [0.6867, [15, 92, 204]],
      [1.0, [6, 26, 97]],
    ]),
  }),
  Object.freeze({
    id: 'viridis',
    label: 'Viridis',
    stops: Object.freeze([
      [0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 145, 140]],
      [0.75, [94, 201, 98]], [1, [253, 231, 37]],
    ]),
  }),
  Object.freeze({
    id: 'plasma',
    label: 'Plasma',
    stops: Object.freeze([
      [0, [13, 8, 135]], [0.25, [126, 3, 168]], [0.5, [204, 71, 120]],
      [0.75, [248, 149, 64]], [1, [240, 249, 33]],
    ]),
  }),
  Object.freeze({
    id: 'magma',
    label: 'Magma',
    stops: Object.freeze([
      [0, [0, 0, 4]], [0.25, [81, 18, 124]], [0.5, [183, 55, 121]],
      [0.75, [252, 137, 97]], [1, [252, 253, 191]],
    ]),
  }),
  Object.freeze({
    id: 'inferno',
    label: 'Inferno',
    stops: Object.freeze([
      [0, [0, 0, 4]], [0.25, [87, 15, 109]], [0.5, [187, 55, 84]],
      [0.75, [249, 142, 9]], [1, [252, 255, 164]],
    ]),
  }),
  Object.freeze({
    id: 'turbo',
    label: 'Turbo',
    stops: Object.freeze([
      [0, [48, 18, 59]], [0.2, [45, 117, 220]], [0.4, [31, 207, 165]],
      [0.6, [170, 243, 52]], [0.8, [251, 153, 9]], [1, [122, 4, 3]],
    ]),
  }),
  Object.freeze({
    id: 'cool',
    label: 'Cool',
    stops: Object.freeze([
      [0, [0, 255, 255]], [0.5, [128, 128, 255]], [1, [255, 0, 255]],
    ]),
  }),
  Object.freeze({
    id: 'warm',
    label: 'Warm',
    stops: Object.freeze([
      [0, [255, 0, 255]], [0.5, [255, 128, 128]], [1, [255, 255, 0]],
    ]),
  }),
  Object.freeze({
    id: 'jet',
    label: 'Jet',
    stops: Object.freeze([
      [0, [0, 0, 128]], [0.2, [0, 128, 255]], [0.4, [0, 255, 255]],
      [0.6, [0, 255, 0]], [0.8, [255, 255, 0]], [1, [255, 0, 0]],
    ]),
  }),
  Object.freeze({
    id: 'jet-reversed',
    label: 'Jet（reversed）',
    stops: Object.freeze([
      [0, [255, 0, 0]], [0.2, [255, 255, 0]], [0.4, [0, 255, 0]],
      [0.6, [0, 255, 255]], [0.8, [0, 128, 255]], [1, [0, 0, 128]],
    ]),
  }),
])

export const volumeRenderingControls = reactive({
  terrainExaggeration: 3,
  /** 地形光照风格：分层色带、距离雾、等高线与海岸线。 */
  terrainBands: false,
  /** 地形整体亮度倍率（1 = 原始亮度）。 */
  terrainBrightness: 1,
  terrainFog: true,
  terrainContours: false,
  terrainCoastline: false,
  /** 方向光地形自阴影（跟随月亮方位）。 */
  terrainShadows: false,
  volumeVisible: true,
  /** 整体不透明度：0 = 完全不可见，1 = 完整显示。 */
  opacity: 1,
  /** 体密度：放大沿视线累计的光学密度，默认 3×。 */
  density: 3,
  /** 细节对比度：围绕色带中点拉开 TL 色彩差异，默认 2×。 */
  contrast: 2,
  /** 边缘锐度：只收紧体边缘覆盖度，不改变 TL 到颜色的映射。 */
  edgeSharpness: 1,
  colormap: 'bellhop',
  /** 体绘制固定按原始方位/距离/深度节点（最近邻）显示，不再提供插值开关。 */
  strictNearest: true,
  /** 默认 TL 映射范围。 */
  dbMin: 60,
  dbMax: 120,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  moveX: 0,
  moveY: 0,
  moveZ: 0,
  rangeRings: false,
})

/** 声场视图向侧边栏同步的只读运行状态。 */
export const acousticSceneState = reactive({
  hasTerrainVolume: false,
  /** 方位方向线所在声场体的实际计算方位（罗盘方位，升序）。 */
  sliceAzimuths: [],
})

export function activeVolumeColorStops(id = volumeRenderingControls.colormap) {
  const palette = VOLUME_COLORMAPS.find((item) => item.id === id) ?? VOLUME_COLORMAPS[0]
  return palette.stops.map(([position, rgb]) => [position, [...rgb]])
}

/**
 * 生成与体渲染“细节对比度”完全一致的显示色标。
 *
 * 色标位置仍表示线性的原始 TL 值；颜色采样位置使用 GPU 同款公式：
 * `clamp((t - 0.5) * contrast + 0.5, 0, 1)`。
 * 因此图例、二维俯视图和垂直切面可以准确解释体渲染中的颜色。
 */
export function contrastedVolumeColorStops(
  stops = activeVolumeColorStops(),
  contrast = volumeRenderingControls.contrast,
) {
  const source = (Array.isArray(stops) ? stops : [])
    .filter(([position, rgb]) => Number.isFinite(Number(position)) && Array.isArray(rgb) && rgb.length >= 3)
    .map(([position, rgb]) => [
      Math.min(1, Math.max(0, Number(position))),
      rgb.slice(0, 3).map((channel) => Math.min(255, Math.max(0, Number(channel) || 0))),
    ])
    .sort((left, right) => left[0] - right[0])
  if (source.length < 2) return activeVolumeColorStops()

  const factorNumber = Number(contrast)
  const factor = Math.min(3, Math.max(0.5, Number.isFinite(factorNumber) ? factorNumber : 2))
  const sample = (position) => {
    const x = Math.min(1, Math.max(0, position))
    for (let index = 0; index < source.length - 1; index += 1) {
      const [start, startColor] = source[index]
      const [end, endColor] = source[index + 1]
      if (x > end && index < source.length - 2) continue
      const ratio = Math.min(1, Math.max(0, (x - start) / Math.max(1e-6, end - start)))
      return startColor.map((channel, channelIndex) =>
        Math.round(channel + (endColor[channelIndex] - channel) * ratio))
    }
    return source[source.length - 1][1].map(Math.round)
  }

  // 原色带的每个折点反算到线性 TL 轴；再补首尾即可精确表达分段线性变换。
  const positions = [0, 1]
  for (const [sourcePosition] of source) {
    const displayPosition = (sourcePosition - 0.5) / factor + 0.5
    if (displayPosition > 0 && displayPosition < 1) positions.push(displayPosition)
  }
  positions.sort((left, right) => left - right)
  return positions
    .filter((position, index) => index === 0 || Math.abs(position - positions[index - 1]) > 1e-8)
    .map((position) => [
      position,
      sample(Math.min(1, Math.max(0, (position - 0.5) * factor + 0.5))),
    ])
}

/** 将 UI 的 0–1 不透明度原样传给 GPU。 */
export function opacityControlToAlphaScale(value) {
  const number = Number(value)
  return Math.min(1, Math.max(0, Number.isFinite(number) ? number : 1))
}

export function clampVolumeRenderingControls(controls = volumeRenderingControls) {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value)
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback))
  }
  controls.terrainExaggeration = clamp(controls.terrainExaggeration, 0.5, 50, 3)
  controls.terrainBands = controls.terrainBands === true
  controls.terrainBrightness = clamp(controls.terrainBrightness, 0.5, 4, 1)
  controls.terrainFog = controls.terrainFog !== false
  controls.terrainContours = controls.terrainContours === true
  controls.terrainCoastline = controls.terrainCoastline === true
  controls.terrainShadows = controls.terrainShadows === true
  controls.opacity = clamp(controls.opacity, 0, 1, 1)
  controls.density = clamp(controls.density, 0.25, 8, 3)
  controls.contrast = clamp(controls.contrast, 0.5, 3, 2)
  controls.edgeSharpness = clamp(controls.edgeSharpness, 0.5, 4, 1)
  // 最近邻为固定行为（接口已移除开关），这里强制保持，避免旧设置残留为插值模式。
  controls.strictNearest = true
  controls.dbMin = clamp(controls.dbMin, 0, 199, 60)
  controls.dbMax = clamp(controls.dbMax, controls.dbMin + 1, 200, 120)
  controls.rotationX = clamp(controls.rotationX, 0, 359, 0)
  controls.rotationY = clamp(controls.rotationY, 0, 359, 0)
  controls.rotationZ = clamp(controls.rotationZ, 0, 359, 0)
  controls.moveX = clamp(controls.moveX, -100000, 100000, 0)
  controls.moveY = clamp(controls.moveY, -100000, 100000, 0)
  controls.moveZ = clamp(controls.moveZ, -100000, 100000, 0)
  return controls
}
