<template>
  <section class="mission-planner">
    <div ref="globeHost" class="planner-globe"></div>
    <div class="planner-shade"></div>

    <header class="planner-heading">
      <span>MISSION PLANNING / GEOVIS</span>
      <h1>线阵联动任务配置</h1>
      <p>在数字地球上选取平台、目标位置并绘制航路，完成参数设置后开始联动。</p>
    </header>

    <aside ref="plannerPanelRef" class="planner-panel" :class="{ dragging: plannerPanelDragging }" :style="plannerPanelDragStyle">
      <div class="panel-title" title="拖动参数窗口；双击恢复默认位置" @pointerdown="startPlannerPanelDrag" @dblclick="resetPlannerPanelPosition"><b>任务参数</b><span>{{ pickHint }}</span></div>
      <div class="planner-scroll">
        <div class="section-title">场景与位置</div>
        <label class="form-row"><span>跟踪目标</span>
          <select v-model="form.targetId" @change="renderFeatures">
            <option v-for="item in targets" :key="item.id" :value="item.id">{{ item.label }} · {{ item.name }}</option>
          </select>
        </label>

        <div class="coordinate-card platform">
          <div><b>拖曳平台</b><em>{{ platformRoute.length }} 个航路点</em></div>
          <div class="coords"><input v-model.number="form.platformLon" type="number" step="0.0001" @change="syncStart('platform')" /><input v-model.number="form.platformLat" type="number" step="0.0001" @change="syncStart('platform')" /></div>
          <div class="pick-actions">
            <button type="button" :class="{ active: pickMode === 'platform-start' }" @click="togglePick('platform-start')">⌖ 选起点</button>
            <button type="button" :class="{ active: pickMode === 'platform-route' }" @click="togglePick('platform-route')">＋ 绘航路</button>
            <button type="button" @click="undoRoute('platform')">撤销</button>
          </div>
        </div>

        <div class="coordinate-card target">
          <div><b>水下目标</b><em>{{ targetRoute.length }} 个航路点</em></div>
          <div class="coords"><input v-model.number="form.targetLon" type="number" step="0.0001" @change="syncStart('target')" /><input v-model.number="form.targetLat" type="number" step="0.0001" @change="syncStart('target')" /></div>
          <div class="pick-actions">
            <button type="button" :class="{ active: pickMode === 'target-start' }" @click="togglePick('target-start')">⌖ 选起点</button>
            <button type="button" :class="{ active: pickMode === 'target-route' }" @click="togglePick('target-route')">＋ 绘航路</button>
            <button type="button" @click="undoRoute('target')">撤销</button>
          </div>
        </div>

        <div class="section-title">运动参数</div>
        <label class="form-row"><span>运动方式</span>
          <select v-model="form.motionMode">
            <option value="route">按航路航行</option>
            <option value="heading">按航向直航</option>
          </select>
        </label>
        <div class="form-grid">
          <label><span>平台航速</span><div><input v-model.number="form.platformSpeedKnots" type="number" min="1" max="40" step="0.5" /><i>kn</i></div></label>
          <label><span>目标航速</span><div><input v-model.number="form.targetSpeedKnots" type="number" min="1" max="45" step="0.5" /><i>kn</i></div></label>
          <label :class="{ disabled: form.motionMode === 'route' }"><span>平台设定航向</span><div><input v-model.number="form.platformHeadingDeg" type="number" min="0" max="359.9" step="1" :disabled="form.motionMode === 'route'" /><i>°</i></div></label>
          <label :class="{ disabled: form.motionMode === 'route' }"><span>目标设定航向</span><div><input v-model.number="form.targetHeadingDeg" type="number" min="0" max="359.9" step="1" :disabled="form.motionMode === 'route'" /><i>°</i></div></label>
          <p v-if="form.motionMode === 'route'" class="route-heading-note">航路模式下，实时航向由当前航段自动计算；到达转向点后更新。</p>
          <label><span>目标深度</span><div><input v-model.number="form.targetDepthM" type="number" min="1" max="1000" step="5" /><i>m</i></div></label>
          <label><span>任务时长</span><div><input v-model.number="form.duration" type="number" min="30" max="900" step="10" /><i>s</i></div></label>
          <label><span>更新步长</span><div><input v-model.number="form.updateStepMs" type="number" min="50" max="2000" step="50" /><i>ms</i></div></label>
        </div>

        <div class="section-title">阵列与信号</div>
        <div class="form-grid">
          <label><span>阵元数量</span><div><select v-model.number="form.nElem"><option v-for="count in [32, 64, 128, 256]" :key="count" :value="count">{{ count }}</option></select></div></label>
          <label><span>阵元间距</span><div><input v-model.number="form.spacingM" type="number" min="0.1" max="5" step="0.05" /><i>m</i></div></label>
          <label><span>阵列深度</span><div><input v-model.number="form.arrayDepthM" type="number" min="1" max="1000" step="5" /><i>m</i></div></label>
          <label><span>拖缆长度</span><div><input v-model.number="form.towLengthM" type="number" min="0" max="5000" step="25" /><i>m</i></div></label>
          <label><span>阵列航向</span><div><select v-model="form.arrayHeadingMode"><option value="follow">随平台</option><option value="fixed">固定航向</option></select></div></label>
          <label v-if="form.arrayHeadingMode === 'fixed'"><span>固定航向</span><div><input v-model.number="form.arrayHeadingDeg" type="number" min="0" max="359.9" step="1" /><i>°</i></div></label>
          <label><span>初始观察阵元</span><div><select v-model.number="form.selectedElement"><option v-for="element in form.nElem" :key="element" :value="element">#{{ element }}</option></select></div></label>
          <label><span>中心频率</span><div><input v-model.number="form.centerFrequency" type="number" min="100" max="3000" step="50" /><i>Hz</i></div></label>
          <label><span>检测门限</span><div><input v-model.number="form.threshold" type="number" min="0" max="20" step="0.5" /><i>dB</i></div></label>
        </div>
      </div>

      <footer>
        <button type="button" class="reset-button" @click="resetRoutes">恢复默认</button>
        <button type="button" class="start-button" :disabled="!canStart" @click="startMission">开始联动</button>
      </footer>
    </aside>

    <div class="map-help"><b>{{ pickMode ? '单击地球完成选点' : '数字地球任务规划' }}</b><span>拖动旋转 · 滚轮缩放 · 航路模式可连续选点</span></div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Cesium, createCesiumViewer } from '@/utils/cesium.js'
import { applyGlobeCamera, captureGlobeCamera, registerGlobeViewer, sharedGlobeCamera } from '@/modules/array-fusion/globeCameraState.js'
import { useDraggablePanel } from '@/composables/useDraggablePanel.js'

const emit = defineEmits(['start'])
const props = defineProps({ initialConfig: { type: Object, default: null } })
const targets = Object.freeze([
  { id: 'alpha', label: '目标 A', name: '低噪声潜航器' },
  { id: 'bravo', label: '目标 B', name: '水下无人航行器' },
  { id: 'charlie', label: '目标 C', name: '远程弱目标' },
])

const DEFAULT_PLATFORM_ROUTE = Object.freeze([
  { lon: 113.82, lat: 13.46 }, { lon: 113.91, lat: 13.54 }, { lon: 114.03, lat: 13.60 },
])
const DEFAULT_TARGET_ROUTE = Object.freeze([
  { lon: 114.24, lat: 14.01 }, { lon: 114.12, lat: 13.92 }, { lon: 113.98, lat: 13.76 },
])

const initialElementCount = Number(props.initialConfig?.nElem ?? 128)
const globeHost = ref(null)
const {
  panelRef: plannerPanelRef,
  dragging: plannerPanelDragging,
  dragStyle: plannerPanelDragStyle,
  startDragging: startPlannerPanelDrag,
  resetPanelPosition: resetPlannerPanelPosition,
} = useDraggablePanel()
const pickMode = ref('')
const platformRoute = ref((props.initialConfig?.platformRoute ?? DEFAULT_PLATFORM_ROUTE).map((item) => ({ ...item })))
const targetRoute = ref((props.initialConfig?.targetRoute ?? DEFAULT_TARGET_ROUTE).map((item) => ({ ...item })))
const form = reactive({
  targetId: props.initialConfig?.targetId ?? 'alpha',
  platformLon: platformRoute.value[0]?.lon ?? 113.82, platformLat: platformRoute.value[0]?.lat ?? 13.46,
  targetLon: targetRoute.value[0]?.lon ?? 114.24, targetLat: targetRoute.value[0]?.lat ?? 14.01,
  platformSpeedKnots: props.initialConfig?.platformSpeedKnots ?? 17,
  targetSpeedKnots: props.initialConfig?.targetSpeedKnots ?? 15,
  motionMode: props.initialConfig?.motionMode ?? 'route',
  platformHeadingDeg: props.initialConfig?.platformHeadingDeg ?? 45,
  targetHeadingDeg: props.initialConfig?.targetHeadingDeg ?? 225,
  targetDepthM: props.initialConfig?.targetDepthM ?? 180,
  duration: props.initialConfig?.duration ?? 120,
  updateStepMs: props.initialConfig?.updateStepMs ?? 200,
  nElem: props.initialConfig?.nElem ?? 128,
  spacingM: props.initialConfig?.spacingM ?? 0.75,
  arrayDepthM: props.initialConfig?.arrayDepthM ?? 50,
  towLengthM: props.initialConfig?.towLengthM ?? 300,
  arrayHeadingMode: props.initialConfig?.arrayHeadingMode ?? 'follow',
  arrayHeadingDeg: props.initialConfig?.arrayHeadingDeg ?? 225,
  selectedElement: props.initialConfig?.selectedElement ?? Math.ceil(initialElementCount / 2),
  centerFrequency: props.initialConfig?.centerFrequency ?? 1000,
  threshold: props.initialConfig?.threshold ?? 6,
})

let viewer = null
let unregisterGlobeViewer = () => {}
let mapFeatures = []
const canStart = computed(() => platformRoute.value.length >= 2 && targetRoute.value.length >= 2)
const pickHint = computed(() => ({
  'platform-start': '请单击地球选取平台起点', 'platform-route': '连续单击添加平台航路点',
  'target-start': '请单击地球选取目标起点', 'target-route': '连续单击添加目标航路点',
})[pickMode.value] ?? '等待任务设置')

watch(() => form.nElem, (nextCount, previousCount) => {
  const next = Math.max(1, Number(nextCount) || 1)
  const previous = Math.max(1, Number(previousCount) || next)
  const previousCenter = Math.ceil(previous / 2)
  form.selectedElement = Number(form.selectedElement) === previousCenter
    ? Math.ceil(next / 2)
    : Math.max(1, Math.min(next, Number(form.selectedElement) || 1))
})

function togglePick(mode) { pickMode.value = pickMode.value === mode ? '' : mode }

function addFeature(feature) {
  if (!feature || !viewer?.features) return
  try { mapFeatures.push(feature.addTo(viewer.features) || feature) } catch {}
}

function clearFeatures() {
  if (viewer?.features) mapFeatures.forEach((feature) => { try { viewer.features.remove(feature) } catch {} })
  mapFeatures = []
}

function renderRoute(route, color) {
  if (route.length < 2) return
  addFeature(new Cesium.Polyline(route.map((point) => [point.lon, point.lat, 500]), { colors: [color.withAlpha(0.92)], width: 3 }))
}

function renderFeatures() {
  if (!viewer?.features) return
  clearFeatures()
  const cyan = Cesium.Color.fromCssColorString('#39d9ff')
  const amber = Cesium.Color.fromCssColorString('#ffc65c')
  platformRoute.value.forEach((point, index) => addFeature(new Cesium.Point([point.lon, point.lat, 650], {
    color: cyan, pixelSize: index ? 9 : 15, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
  })))
  targetRoute.value.forEach((point, index) => addFeature(new Cesium.Point([point.lon, point.lat, 650], {
    color: amber, pixelSize: index ? 9 : 15, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
  })))
  renderRoute(platformRoute.value, cyan)
  renderRoute(targetRoute.value, amber)
  viewer.scene?.requestRender?.()
}

function syncStart(kind) {
  if (kind === 'platform') platformRoute.value[0] = { lon: Number(form.platformLon), lat: Number(form.platformLat) }
  else targetRoute.value[0] = { lon: Number(form.targetLon), lat: Number(form.targetLat) }
  renderFeatures()
}

function applyMapPoint(lon, lat) {
  const point = { lon: Number(lon.toFixed(5)), lat: Number(lat.toFixed(5)) }
  if (pickMode.value === 'platform-start') {
    form.platformLon = point.lon; form.platformLat = point.lat; platformRoute.value = [point]; pickMode.value = 'platform-route'
  } else if (pickMode.value === 'target-start') {
    form.targetLon = point.lon; form.targetLat = point.lat; targetRoute.value = [point]; pickMode.value = 'target-route'
  } else if (pickMode.value === 'platform-route') platformRoute.value.push(point)
  else if (pickMode.value === 'target-route') targetRoute.value.push(point)
  renderFeatures()
}

function undoRoute(kind) {
  const route = kind === 'platform' ? platformRoute.value : targetRoute.value
  if (route.length > 1) route.pop()
  renderFeatures()
}

function resetRoutes() {
  platformRoute.value = DEFAULT_PLATFORM_ROUTE.map((item) => ({ ...item }))
  targetRoute.value = DEFAULT_TARGET_ROUTE.map((item) => ({ ...item }))
  Object.assign(form, {
    platformLon: 113.82, platformLat: 13.46, targetLon: 114.24, targetLat: 14.01,
    platformSpeedKnots: 17, targetSpeedKnots: 15, platformHeadingDeg: 45, targetHeadingDeg: 225,
    motionMode: 'route', targetDepthM: 180, duration: 120, updateStepMs: 200,
    nElem: 128, spacingM: 0.75, arrayDepthM: 50, towLengthM: 300,
    arrayHeadingMode: 'follow', arrayHeadingDeg: 225, selectedElement: 64,
    centerFrequency: 1000, threshold: 6,
  })
  pickMode.value = ''
  renderFeatures()
}

function startMission() {
  if (!canStart.value) return
  emit('start', { ...form, platformRoute: platformRoute.value.map((point) => ({ ...point })), targetRoute: targetRoute.value.map((point) => ({ ...point })) })
}

onMounted(async () => {
  await nextTick()
  viewer = createCesiumViewer(globeHost.value, { requestWebgl2: false })
  viewer.scene.globe.depthTestAgainstTerrain = false
  unregisterGlobeViewer = registerGlobeViewer('communication', viewer)
  // 任务规划沿用当前数字地球视角，进入通信模块时不重新定位。
  applyGlobeCamera(viewer)
  viewer.on?.('click', (event) => {
    if (!pickMode.value || !Array.isArray(event?.lonlat)) return
    const lon = Number(event.lonlat[0]); const lat = Number(event.lonlat[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) applyMapPoint(lon, lat)
  })
  renderFeatures()
})

onBeforeUnmount(() => {
  unregisterGlobeViewer()
  if (viewer && !viewer.isDestroyed?.()) captureGlobeCamera(viewer)
  clearFeatures()
  if (viewer && !viewer.isDestroyed?.()) viewer.destroy()
  viewer = null
})

watch(sharedGlobeCamera, () => {
  if (viewer && !viewer.isDestroyed?.()) applyGlobeCamera(viewer)
})
</script>

<style scoped>
.mission-planner { position: absolute; inset: 0; z-index: 10; overflow: hidden; color: #d9f7ff; background: #020b15; }
.planner-globe { position: absolute; inset: 0; }.planner-globe :deep(.cesium-widget), .planner-globe :deep(canvas) { width: 100%; height: 100%; }
.planner-shade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(1, 11, 20, .16) 35%, rgba(1, 11, 20, .72) 72%, rgba(1, 11, 20, .94)); }
.planner-heading { position: absolute; top: 34px; left: 38px; pointer-events: none; text-shadow: 0 2px 12px #000; }.planner-heading span { color: #48cbea; font: 10px Consolas, monospace; letter-spacing: 2.6px; }.planner-heading h1 { margin: 8px 0 7px; font-size: 26px; font-weight: 500; letter-spacing: 4px; }.planner-heading p { margin: 0; color: #88aeb9; font-size: 12px; }
.planner-panel { position: absolute; top: 18px; right: 20px; bottom: 18px; width: 390px; display: grid; grid-template-rows: 48px minmax(0, 1fr) 58px; border: 1px solid rgba(66, 190, 221, .38); background: rgba(2, 21, 34, .94); box-shadow: 0 18px 55px rgba(0, 0, 0, .45); }.panel-title { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 1px solid rgba(67, 166, 193, .22); background: linear-gradient(90deg, rgba(21, 103, 129, .35), transparent); }.panel-title b { font-size: 15px; letter-spacing: 2px; }.panel-title span { color: #5dcde8; font-size: 9px; }
.planner-panel { bottom: auto; height: min(740px, calc(100% - 36px)); }
.panel-title { cursor: grab; touch-action: none; user-select: none; }
.planner-panel.dragging { z-index: 30; box-shadow: 0 22px 58px rgba(0, 0, 0, .62); }
.planner-panel.dragging .panel-title { cursor: grabbing; }
.planner-scroll { padding: 4px 16px 16px; overflow-y: auto; scrollbar-color: #245f73 #061a28; scrollbar-width: thin; }.planner-scroll::-webkit-scrollbar { width: 7px; }.planner-scroll::-webkit-scrollbar-track { background: #061a28; }.planner-scroll::-webkit-scrollbar-thumb { background: #245f73; }.section-title { margin: 14px 0 9px; padding-left: 8px; border-left: 2px solid #36cbe9; color: #8fc5d2; font-size: 11px; letter-spacing: 1px; }.form-row { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 10px; color: #7198a3; font-size: 10px; }
input, select { min-width: 0; height: 28px; padding: 0 8px; border: 1px solid rgba(71, 155, 179, .28); border-radius: 0; color: #d4f3f8; outline: none; background: #061d2b; box-sizing: border-box; } input:focus, select:focus { border-color: #3ac7e5; }
.coordinate-card { margin-top: 10px; padding: 10px; border: 1px solid rgba(69, 152, 176, .2); background: rgba(7, 43, 59, .48); }.coordinate-card.platform { border-left: 2px solid #39d9ff; }.coordinate-card.target { border-left: 2px solid #ffc65c; }.coordinate-card > div:first-child { display: flex; justify-content: space-between; }.coordinate-card b { font-size: 11px; }.coordinate-card em { color: #648b96; font-size: 9px; font-style: normal; }
.coords { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 8px; }.pick-actions { display: flex; gap: 6px; margin-top: 7px; }.pick-actions button { flex: 1; padding: 5px; border: 1px solid rgba(70, 159, 183, .3); color: #7daab5; font-size: 9px; background: rgba(4, 28, 40, .8); cursor: pointer; }.pick-actions button.active { color: #d9fbff; border-color: #41cae8; background: rgba(32, 139, 166, .35); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }.form-grid label > span { display: block; margin-bottom: 5px; color: #7198a3; font-size: 9px; }.form-grid label > div { display: flex; align-items: center; }.form-grid input, .form-grid select { width: 100%; }.form-grid i { width: 28px; color: #5f8a96; font-size: 9px; font-style: normal; text-align: right; }
.form-grid label.disabled { opacity: .55; }.route-heading-note { grid-column: 1 / -1; margin: -2px 0 0; color: #638e9a; font-size: 9px; line-height: 1.45; }
footer { display: flex; align-items: center; justify-content: flex-end; gap: 9px; padding: 0 16px; border-top: 1px solid rgba(67, 166, 193, .22); }.reset-button, .start-button { height: 34px; padding: 0 18px; border: 1px solid rgba(76, 163, 187, .35); cursor: pointer; }.reset-button { color: #789ca5; background: transparent; }.start-button { min-width: 130px; color: #e6fbff; border-color: #3bd0ef; background: linear-gradient(180deg, #1687a5, #0b5871); box-shadow: 0 0 18px rgba(52, 201, 232, .18); }.start-button:disabled { opacity: .4; cursor: not-allowed; }
.map-help { position: absolute; bottom: 24px; left: 38px; display: flex; flex-direction: column; gap: 4px; padding: 10px 13px; border-left: 2px solid #43cde9; background: rgba(1, 17, 28, .76); }.map-help b { font-size: 11px; }.map-help span { color: #7198a4; font-size: 9px; }
</style>
