import { reactive, watch } from 'vue'

const STORAGE_KEY = 'acoustic-terrain-seafloor-features'

export const SEAFLOOR_FEATURE_CATEGORIES = Object.freeze([
  { key: 'strait', label: '海峡/水道', color: '#5fd4ff' },
  { key: 'trench', label: '海沟/海槽', color: '#b18cff' },
  { key: 'seamount', label: '海山/海丘', color: '#ffc65c' },
  { key: 'ridge', label: '海岭/海脊', color: '#7fe3a4' },
  { key: 'basin', label: '海盆/平原', color: '#8fa8c8' },
  { key: 'canyon', label: '海底峡谷', color: '#ff9b6a' },
  { key: 'other', label: '其他', color: '#9fb4c6' },
])

function defaultCategories() {
  return Object.fromEntries(SEAFLOOR_FEATURE_CATEGORIES.map(item => [item.key, true]))
}

function readPersisted() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const persisted = readPersisted()

export const seafloorFeatureState = reactive({
  enabled: persisted?.enabled !== false,
  occlusion: persisted?.occlusion !== false,
  showBoundaries: persisted?.showBoundaries !== false,
  density: Number.isFinite(Number(persisted?.density)) ? Number(persisted.density) : 1,
  categories: {
    ...defaultCategories(),
    ...(persisted && typeof persisted.categories === 'object' ? persisted.categories : {}),
  },
  status: 'idle',
  error: '',
  features: [],
  total: 0,
  categoryCounts: {},
  source: '',
  visibleCount: 0,
  selectedId: '',
  loadedBounds: null,
})

watch(
  () => ({
    enabled: seafloorFeatureState.enabled,
    occlusion: seafloorFeatureState.occlusion,
    showBoundaries: seafloorFeatureState.showBoundaries,
    density: seafloorFeatureState.density,
    categories: { ...seafloorFeatureState.categories },
  }),
  value => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch {}
  },
  { deep: true },
)

export function setSeafloorFeatureEnabled(value) {
  seafloorFeatureState.enabled = Boolean(value)
  if (!seafloorFeatureState.enabled) seafloorFeatureState.selectedId = ''
}

export function setSeafloorFeatureOcclusion(value) {
  seafloorFeatureState.occlusion = Boolean(value)
}

export function setSeafloorFeatureBoundaries(value) {
  seafloorFeatureState.showBoundaries = Boolean(value)
}

export function setSeafloorFeatureDensity(value) {
  const number = Number(value)
  seafloorFeatureState.density = Number.isFinite(number)
    ? Math.min(2.5, Math.max(0.4, number))
    : 1
}

export function setCategoryEnabled(key, value) {
  if (!(key in seafloorFeatureState.categories)) return
  seafloorFeatureState.categories[key] = Boolean(value)
}

export function setAllCategories(value) {
  const enabled = Boolean(value)
  for (const item of SEAFLOOR_FEATURE_CATEGORIES) {
    seafloorFeatureState.categories[item.key] = enabled
  }
}

export function categoryColor(key) {
  return SEAFLOOR_FEATURE_CATEGORIES.find(item => item.key === key)?.color || '#9fb4c6'
}

export function categoryLabel(key) {
  return SEAFLOOR_FEATURE_CATEGORIES.find(item => item.key === key)?.label || '其他'
}

export function applySeafloorFeatureResponse(payload, bounds) {
  seafloorFeatureState.features = Array.isArray(payload?.features) ? payload.features : []
  seafloorFeatureState.total = Number(payload?.total) || seafloorFeatureState.features.length
  seafloorFeatureState.source = String(payload?.source || '')
  seafloorFeatureState.categoryCounts = Object.fromEntries(
    (Array.isArray(payload?.categories) ? payload.categories : [])
      .map(item => [item?.key, Number(item?.count) || 0])
      .filter(([key]) => key),
  )
  seafloorFeatureState.loadedBounds = bounds ? { ...bounds } : null
  seafloorFeatureState.status = 'ready'
  seafloorFeatureState.error = ''
  if (seafloorFeatureState.selectedId &&
      !seafloorFeatureState.features.some(item => item.id === seafloorFeatureState.selectedId)) {
    seafloorFeatureState.selectedId = ''
  }
}

export function failSeafloorFeatureResponse(message) {
  seafloorFeatureState.status = 'error'
  seafloorFeatureState.error = String(message || '海底地名加载失败')
  seafloorFeatureState.features = []
  seafloorFeatureState.total = 0
  seafloorFeatureState.categoryCounts = {}
  seafloorFeatureState.visibleCount = 0
  seafloorFeatureState.selectedId = ''
}

export function markSeafloorFeatureLoading() {
  seafloorFeatureState.status = 'loading'
  seafloorFeatureState.error = ''
}

export function selectSeafloorFeature(id) {
  const next = String(id || '')
  seafloorFeatureState.selectedId = seafloorFeatureState.selectedId === next ? '' : next
}
