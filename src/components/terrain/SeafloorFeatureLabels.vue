<template>
  <div class="seafloor-label-layer" aria-label="海底地貌地名标注">
    <svg
      v-if="seafloorFeatureState.showBoundaries && boundaries.length"
      class="seafloor-boundary-layer"
      :viewBox="`0 0 ${boundaryViewBox.width} ${boundaryViewBox.height}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g
        v-for="shape in boundaries"
        :key="shape.featureId"
        :class="{ selected: shape.selected }"
        :style="{ '--boundary-color': shape.color }"
      >
        <path
          v-for="(path, index) in shape.paths"
          :key="index"
          :d="boundaryPath(path)"
          @click.stop="selectSeafloorFeature(shape.featureId)"
        />
      </g>
    </svg>

    <button
      v-for="label in labels"
      :key="label.id"
      type="button"
      class="seafloor-label"
      :class="{ selected: label.selected }"
      :style="labelStyle(label)"
      :title="displayName(label)"
      @click.stop="selectSeafloorFeature(label.id)"
    >
      <span class="seafloor-label-dot"></span>
      <span class="seafloor-label-name">{{ fullEnglishName(label) }}</span>
      <span v-if="label.name_zh" class="seafloor-label-type">（{{ label.name_zh }}）</span>
    </button>

    <article v-if="selectedLabel" class="seafloor-feature-card" :style="cardStyle" @pointerdown.stop @click.stop>
      <header>
        <span class="seafloor-feature-swatch" :style="{ background: selectedLabel.category_color }"></span>
        <div>
          <b>{{ displayName(selectedLabel) }}</b>
          <small>{{ selectedLabel.category_label }}</small>
        </div>
        <button type="button" class="close" aria-label="关闭海底地名详情" @click="selectSeafloorFeature(selectedLabel.id)">×</button>
      </header>
      <dl>
        <div>
          <dt>坐标</dt>
          <dd>{{ formatCoord(selectedLabel.latitude, 'N', 'S') }}　{{ formatCoord(selectedLabel.longitude, 'E', 'W') }}</dd>
        </div>
        <div>
          <dt>水深范围</dt>
          <dd>{{ depthRange(selectedLabel) }}</dd>
        </div>
        <div v-if="numberOrNull(selectedLabel.total_relief_m) != null">
          <dt>高差</dt>
          <dd>{{ Math.round(selectedLabel.total_relief_m) }} m</dd>
        </div>
        <div v-if="selectedLabel.dimension">
          <dt>规模</dt>
          <dd>{{ selectedLabel.dimension }}</dd>
        </div>
        <div>
          <dt>视口高程</dt>
          <dd>{{ selectedLabel.elevation < 0 ? `水深 ${Math.round(Math.abs(selectedLabel.elevation))} m` : `高程 ${Math.round(selectedLabel.elevation)} m` }}</dd>
        </div>
      </dl>
      <p v-if="selectedLabel.origin" class="origin">{{ selectedLabel.origin }}</p>
      <footer>
        <button
          type="button"
          class="station-button"
          title="设为仿真点位"
          aria-label="设为仿真点位"
          @click="useAsStation"
        >📍</button>
      </footer>
    </article>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { fetchSeafloorFeatures } from '@/api/seafloorFeaturesApi.js'
import {
  applySeafloorFeatureResponse,
  categoryColor,
  failSeafloorFeatureResponse,
  markSeafloorFeatureLoading,
  seafloorFeatureState,
  selectSeafloorFeature,
} from '@/modules/terrain/seafloorFeatureState.js'
import { buildSeafloorBoundaries, buildSeafloorLabels } from '@/utils/seafloorFeatureLabels.js'

const props = defineProps({
  active: Boolean,
  grid: Object,
  scene: Object,
  camera: Object,
  canvasSize: Object,
})

const emit = defineEmits(['station'])

const labels = computed(() => {
  if (!seafloorFeatureState.enabled) return []
  return buildSeafloorLabels({
    features: seafloorFeatureState.features,
    grid: props.grid,
    scene: props.scene,
    camera: props.camera,
    canvasSize: props.canvasSize,
    categories: seafloorFeatureState.categories,
    density: seafloorFeatureState.density,
    occlusion: seafloorFeatureState.occlusion,
    selectedId: seafloorFeatureState.selectedId,
  })
})

watch(labels, value => {
  seafloorFeatureState.visibleCount = value.length
}, { immediate: true })

const boundaryViewBox = computed(() => ({
  width: Math.max(1, Number(props.canvasSize?.width) || 1),
  height: Math.max(1, Number(props.canvasSize?.height) || 1),
}))

const boundaries = computed(() => {
  if (!seafloorFeatureState.enabled || !seafloorFeatureState.showBoundaries) return []
  return buildSeafloorBoundaries({
    features: seafloorFeatureState.features,
    grid: props.grid,
    scene: props.scene,
    camera: props.camera,
    canvasSize: props.canvasSize,
    categories: seafloorFeatureState.categories,
    density: seafloorFeatureState.density,
    selectedId: seafloorFeatureState.selectedId,
  })
})

function boundaryPath(path) {
  const commands = path.points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`)
  if (!commands.length) return ''
  return `M${commands.join('L')}${path.closed ? 'Z' : ''}`
}

const selectedLabel = computed(() => (
  labels.value.find(label => label.id === seafloorFeatureState.selectedId) || null
))

function titleCaseWords(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function fullEnglishName(label) {
  const name = String(label?.name || '').trim()
  const generic = titleCaseWords(label?.generic_term)
  return generic ? `${name} ${generic}` : name
}

function displayName(label) {
  const english = fullEnglishName(label)
  const chinese = String(label?.name_zh || '').trim()
  return chinese ? `${english}（${chinese}）` : english
}

const cardStyle = computed(() => {
  const label = selectedLabel.value
  const width = Number(props.canvasSize?.width) || 0
  const height = Number(props.canvasSize?.height) || 0
  if (!label || !width || !height) return { display: 'none' }
  const left = Math.min(Math.max(8, label.x + 18), Math.max(8, width - 310))
  const top = Math.min(Math.max(46, label.y - 16), Math.max(46, height - 250))
  return { left: `${left}px`, top: `${top}px` }
})

function labelStyle(label) {
  return {
    left: `${label.x}px`,
    top: `${label.y}px`,
    '--label-color': label.category_color || categoryColor(label.category),
  }
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatCoord(value, positive, negative) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const hemisphere = number >= 0 ? positive : negative
  return `${Math.abs(number).toFixed(4)}°${hemisphere}`
}

function depthRange(feature) {
  const min = numberOrNull(feature.min_depth_m)
  const max = numberOrNull(feature.max_depth_m)
  if (min == null && max == null) return '—'
  if (min == null) return `${Math.round(max)} m`
  if (max == null) return `${Math.round(min)} m`
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  return Math.abs(high - low) < 1 ? `${Math.round(low)} m` : `${Math.round(low)}–${Math.round(high)} m`
}

function useAsStation() {
  const label = selectedLabel.value
  if (!label) return
  emit('station', {
    lon: Number(label.longitude),
    lat: Number(label.latitude),
    elevation: Number(label.elevation),
    x: label.x,
    y: label.y,
  })
}

let fetchTimer = 0
let fetchToken = 0
let controller = null

function scheduleFetch() {
  if (fetchTimer) clearTimeout(fetchTimer)
  fetchTimer = window.setTimeout(() => {
    fetchTimer = 0
    void loadFeatures()
  }, 220)
}

async function loadFeatures() {
  const bounds = props.grid?.bounds
  if (!bounds) return
  const token = ++fetchToken
  controller?.abort()
  controller = new AbortController()
  markSeafloorFeatureLoading()
  try {
    const payload = await fetchSeafloorFeatures(bounds, {
      limit: 1000,
      signal: controller.signal,
    })
    if (token !== fetchToken) return
    applySeafloorFeatureResponse(payload, bounds)
  } catch (error) {
    if (error?.name === 'AbortError' || token !== fetchToken) return
    failSeafloorFeatureResponse(error?.message || error)
  }
}

watch(
  () => {
    const bounds = props.grid?.bounds
    if (!bounds) return ''
    return [bounds.west, bounds.south, bounds.east, bounds.north].join('|')
  },
  () => scheduleFetch(),
  { immediate: true },
)

onBeforeUnmount(() => {
  if (fetchTimer) clearTimeout(fetchTimer)
  controller?.abort()
  fetchToken += 1
})
</script>

<style scoped>
.seafloor-label-layer {
  position: absolute;
  inset: 0 0 25px;
  z-index: 5;
  overflow: hidden;
  pointer-events: none;
}

.seafloor-boundary-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.seafloor-boundary-layer path {
  fill: none;
  stroke: var(--boundary-color);
  stroke-width: 1.1;
  stroke-opacity: 0.52;
  vector-effect: non-scaling-stroke;
  pointer-events: stroke;
  cursor: pointer;
  transition: stroke-opacity 0.15s ease, stroke-width 0.15s ease;
}

.seafloor-boundary-layer path:hover {
  stroke-opacity: 1;
  stroke-width: 1.8;
}

.seafloor-boundary-layer g.selected path {
  stroke-opacity: 1;
  stroke-width: 2;
  stroke-dasharray: 6 4;
}

.seafloor-label {
  position: absolute;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 7px;
  transform: translate(-50%, calc(-100% - 13px));
  border: 1px solid var(--label-color);
  border-radius: 12px;
  background: rgba(5, 20, 33, 0.84);
  color: #e8f6ff;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.38);
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.seafloor-label::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: 1px;
  height: 13px;
  background: linear-gradient(var(--label-color), transparent);
}

.seafloor-label:hover,
.seafloor-label.selected {
  background: rgba(12, 44, 66, 0.96);
  box-shadow: 0 0 0 1px var(--label-color), 0 4px 14px rgba(0, 0, 0, 0.48);
}

.seafloor-label-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--label-color);
  box-shadow: 0 0 7px var(--label-color);
}

.seafloor-label-name {
  font-weight: 600;
}

.seafloor-label-type {
  color: #9fc3d8;
  font-size: 10px;
}

.seafloor-feature-card {
  position: absolute;
  z-index: 3;
  width: 296px;
  max-height: 236px;
  padding: 10px 12px;
  border: 1px solid #2f5a78;
  border-radius: 6px;
  background: rgba(6, 24, 39, 0.96);
  color: #cfe6f5;
  pointer-events: auto;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  overflow: auto;
}

.seafloor-feature-card header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.seafloor-feature-card header b {
  display: block;
  color: #eaf7ff;
  font-size: 13px;
}

.seafloor-feature-card header small {
  display: block;
  margin-top: 2px;
  color: #8fb8cc;
  font-size: 10px;
}

.seafloor-feature-swatch {
  flex: none;
  width: 9px;
  height: 26px;
  border-radius: 2px;
}

.seafloor-feature-card header .close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #8fb8cc;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}

.seafloor-feature-card dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 12px;
  margin: 10px 0 0;
}

.seafloor-feature-card dl div {
  min-width: 0;
}

.seafloor-feature-card dt {
  color: #7fa9c4;
  font-size: 10px;
}

.seafloor-feature-card dd {
  margin: 1px 0 0;
  color: #dceffb;
  font-size: 11px;
}

.seafloor-feature-card .origin {
  max-height: 62px;
  margin: 9px 0 0;
  padding-top: 7px;
  border-top: 1px solid #173650;
  color: #9ec2d6;
  font-size: 10px;
  line-height: 1.45;
  overflow: auto;
}

.seafloor-feature-card footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}

.station-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  padding: 0;
  border: 1px solid #3f86b8;
  border-radius: 3px;
  background: #0d3552;
  color: #c8ecff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.station-button:hover {
  background: #145079;
}
</style>
