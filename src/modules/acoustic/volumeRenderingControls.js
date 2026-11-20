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
  opacity: 1.7,
  sampling: 0.01,
  alphaPower: 1.3,
  colormap: 'bellhop',
  /** 严格最近邻：与 bellhop_gebco 参考工程一致，方位/距离/深度均取最近节点、不插值。 */
  strictNearest: true,
  /** 参考工程 fieldColor 的 TL 映射域为 45–128 dB，默认 dB 范围与之对齐。 */
  dbMin: 45,
  dbMax: 128,
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
  controls.opacity = clamp(controls.opacity, 0.2, 5, 1.7)
  controls.sampling = clamp(controls.sampling, 0.004, 0.03, 0.01)
  controls.alphaPower = clamp(controls.alphaPower, 0.35, 3, 1.3)
  controls.strictNearest = controls.strictNearest !== false
  controls.dbMin = clamp(controls.dbMin, 0, 199, 45)
  controls.dbMax = clamp(controls.dbMax, controls.dbMin + 1, 200, 128)
  controls.rotationX = clamp(controls.rotationX, 0, 359, 0)
  controls.rotationY = clamp(controls.rotationY, 0, 359, 0)
  controls.rotationZ = clamp(controls.rotationZ, 0, 359, 0)
  controls.moveX = clamp(controls.moveX, -100000, 100000, 0)
  controls.moveY = clamp(controls.moveY, -100000, 100000, 0)
  controls.moveZ = clamp(controls.moveZ, -100000, 100000, 0)
  return controls
}
