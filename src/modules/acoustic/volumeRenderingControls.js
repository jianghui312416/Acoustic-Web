import { reactive } from 'vue'

export const VOLUME_COLORMAPS = Object.freeze([
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
  volumeVisible: true,
  opacity: 1.7,
  sampling: 0.01,
  alphaPower: 1.3,
  colormap: 'jet-reversed',
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

export function activeVolumeColorStops(id = volumeRenderingControls.colormap) {
  const palette = VOLUME_COLORMAPS.find((item) => item.id === id) ?? VOLUME_COLORMAPS[0]
  return palette.stops.map(([position, rgb]) => [position, [...rgb]])
}

export function clampVolumeRenderingControls(controls = volumeRenderingControls) {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value)
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback))
  }
  controls.terrainExaggeration = clamp(controls.terrainExaggeration, 1, 30, 3)
  controls.opacity = clamp(controls.opacity, 0.2, 5, 1.7)
  controls.sampling = clamp(controls.sampling, 0.004, 0.03, 0.01)
  controls.alphaPower = clamp(controls.alphaPower, 0.35, 3, 1.3)
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
