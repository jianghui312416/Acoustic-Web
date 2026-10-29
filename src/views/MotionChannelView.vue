<template>
  <section class="fusion-view" :class="{ 'module-open': sidebarOpen }">
    <ArrayFusionPlanner v-if="!missionStarted" :initial-config="missionConfig" @start="startMission" />
    <div class="fusion-toolbar">
      <div class="mission-title">
        <span class="eyebrow">TOWED ARRAY / LINKED ANALYSIS</span>
        <strong>线阵多域联动监测</strong>
      </div>

      <div class="scenario-switch" role="group" aria-label="目标场景">
        <button
          v-for="item in targets"
          :key="item.id"
          type="button"
          :class="{ active: selectedTarget === item.id }"
          @click="selectedTarget = item.id"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="toolbar-status">
        <button type="button" class="mission-settings" @click="openMissionPlanner">任务设置</button>
        <span class="status-pill" :class="connectionState">
          <i></i>{{ connectionText }}
        </span>
        <span class="status-pill detected" :class="{ active: frame.detected }">
          <i></i>{{ frame.detected ? '目标已确认' : '持续搜索' }}
        </span>
      </div>
    </div>

    <div class="fusion-grid">
      <article class="panel situation-panel">
        <header class="panel-header">
          <div>
            <span class="panel-index">01</span>
            <h2>声场态势</h2>
          </div>
          <div class="panel-actions">
            <span>{{ fieldPanelLabel }}</span>
            <button type="button" :class="{ active: fieldDisplayMode === '3d' }" @click="fieldDisplayMode = '3d'">立体</button>
            <button type="button" :class="{ active: fieldDisplayMode === '2d' }" @click="fieldDisplayMode = '2d'">剖面</button>
            <button v-if="fieldDisplayMode === '3d'" type="button" @click="volumeFieldRef?.topView()">俯视</button>
            <button v-else type="button" :class="{ active: showHistory }" @click="showHistory = !showHistory">
              航迹 {{ showHistory ? '开' : '关' }}
            </button>
          </div>
        </header>

        <div ref="fieldHost" class="field-stage">
          <ArrayFusion3DField
            v-if="fieldDisplayMode === '3d' && volumePayload && volumeSource"
            ref="volumeFieldRef"
            :payload="volumePayload"
            :source-lon="volumeSource.lon"
            :source-lat="volumeSource.lat"
            :scene-state="volumeSceneState"
            :platform-route="missionConfig?.platformRoute ?? []"
            :target-route="missionConfig?.targetRoute ?? []"
            @ready="onVolumeReady"
            @error="onVolumeError"
          />
          <canvas v-show="fieldDisplayMode === '2d' || !volumePayload" ref="fieldCanvas"></canvas>
          <div v-if="fieldDisplayMode === '2d'" class="map-north">N</div>
          <div v-if="fieldDisplayMode === '2d'" class="map-scale"><span></span>20 km</div>
          <div class="field-legend">
            <span>传播损失</span>
            <div class="legend-ramp"></div>
            <div class="legend-labels"><b>40</b><b>80</b><b>120 dB</b></div>
          </div>
          <div class="field-readout">
            <template v-if="fieldData">
              <span>Bellhop 任务</span><strong>{{ bellhopJobId }}</strong>
              <span v-if="fieldDisplayMode === '3d'">当前目标</span><strong v-if="fieldDisplayMode === '3d'">{{ currentTargetText }}</strong>
              <span>海深 / 接收深度</span><strong>{{ receiverBottomText }} / {{ arrayDepthM.toFixed(0) }} m</strong>
              <span v-if="fieldDisplayMode === '3d'">环境折点</span><strong v-if="fieldDisplayMode === '3d'">#{{ appliedWaypointIndex + 1 }} · {{ volumeSourceText }}</strong>
              <span v-if="fieldDisplayMode === '3d'">三维网格</span><strong v-if="fieldDisplayMode === '3d'">{{ volumeStats.sectorCount }} 方位 × {{ volumeStats.depthCount }} 深度层</strong>
              <template v-else><span>声速剖面 / 多途</span><strong>{{ fieldData.ssp?.depth_m?.length ?? 0 }} 层 / {{ frame.propagation?.multipath_count ?? 0 }} 条</strong></template>
            </template>
            <template v-else>
              <span>阵中心</span><strong>{{ arrayPositionText }}</strong>
              <span>{{ headingMetricLabel('平台') }} / 航速</span><strong>{{ headingText(platformHeading) }} / {{ frame.platform?.speedKnots?.toFixed(1) }} kn</strong>
              <span>声场状态</span><strong>{{ fieldStatusText }}</strong>
            </template>
          </div>
        </div>

        <div class="situation-footer">
          <div><span>目标距离</span><strong>{{ frame.rangeKm.toFixed(1) }} <small>km</small></strong></div>
          <div><span>真实方位</span><strong>{{ signed(frame.trueBearing) }}<small>°</small></strong></div>
          <div><span>估计方位</span><strong>{{ signed(frame.peakBearing) }}<small>°</small></strong></div>
          <div><span>方位误差</span><strong>{{ Math.abs(bearingError).toFixed(1) }}<small>°</small></strong></div>
        </div>
      </article>

      <div class="analysis-stack">
        <MotionSignalDomains :frame="frame" />
      </div>

      <aside class="panel telemetry-panel">
        <header class="panel-header compact">
          <div>
            <span class="panel-index">04</span>
            <h2>联动参数</h2>
          </div>
        </header>

        <div class="target-card">
          <div class="target-icon" :class="{ locked: frame.detected }">
            <span></span><span></span><span></span>
          </div>
          <div>
            <span>当前跟踪目标</span>
            <strong>{{ activeTarget.name }}</strong>
            <small>{{ activeTarget.code }}</small>
          </div>
        </div>

        <div class="metric-ring" :style="{ '--score': confidence }">
          <div><strong>{{ confidence }}</strong><span>%</span><small>检测置信度</small></div>
        </div>

        <dl class="telemetry-list">
          <div><dt>仿真帧</dt><dd>#{{ String(frame.frame).padStart(4, '0') }}</dd></div>
          <div><dt>阵元规模</dt><dd>{{ missionConfig?.nElem ?? 128 }} × {{ missionConfig?.spacingM ?? 0.75 }} m</dd></div>
          <div><dt>阵列孔径</dt><dd>{{ arrayAperture.toFixed(2) }} m</dd></div>
          <div><dt>{{ headingMetricLabel('平台') }}</dt><dd>{{ headingText(platformHeading) }}</dd></div>
          <div><dt>{{ headingMetricLabel('目标') }}</dt><dd>{{ headingText(targetHeading) }}</dd></div>
          <div><dt>实时目标方位</dt><dd>{{ headingText(relativeBearing) }}</dd></div>
          <div><dt>实时宽侧角</dt><dd>{{ signed(broadsideAngle) }}°</dd></div>
          <div><dt>目标航速</dt><dd>{{ frame.target?.speedKnots?.toFixed(1) }} kn</dd></div>
          <div><dt>径向速度</dt><dd>{{ signed(frame.radialSpeedMps) }} m/s</dd></div>
          <div><dt>多普勒频移</dt><dd>{{ signed(frame.dopplerHz) }} Hz</dd></div>
          <div class="element-selector-row"><dt>观察阵元</dt><dd><select v-model.number="observedElement" @change="onObservedElementChange"><option v-for="element in elementOptions" :key="element" :value="element">#{{ element }}</option></select></dd></div>
          <div><dt>中心频率</dt><dd>{{ centerFrequency }} Hz</dd></div>
          <div><dt>传播模型</dt><dd>{{ fieldData ? 'Bellhop 实际环境' : '解析式回退' }}</dd></div>
          <div><dt>观察阵元 TL</dt><dd>{{ selectedElementTlText }}</dd></div>
          <div><dt>观察阵元多途</dt><dd>{{ selectedElementPathCount }}</dd></div>
          <div><dt>信号强度</dt><dd>{{ sourceLevelText }}</dd></div>
          <div><dt>检测门限</dt><dd>{{ threshold.toFixed(1) }} dB</dd></div>
        </dl>

        <div class="element-shortcuts" aria-label="观察阵元快捷切换">
          <button type="button" @click="selectObservedElement(1)">首阵元</button>
          <button type="button" @click="selectObservedElement(Math.ceil(elementCount / 2))">中心</button>
          <button type="button" @click="selectObservedElement(elementCount)">尾阵元</button>
        </div>

        <div class="control-group">
          <label for="frequency">中心频率 <output>{{ centerFrequency }} Hz</output></label>
          <input id="frequency" v-model.number="centerFrequency" type="range" min="500" max="1600" step="50" />
        </div>
        <div class="control-group">
          <label for="threshold">检测门限 <output>{{ threshold.toFixed(1) }} dB</output></label>
          <input id="threshold" v-model.number="threshold" type="range" min="0" max="14" step="0.5" />
        </div>

        <div class="event-log">
          <span>事件序列</span>
          <ol>
            <li v-for="eventItem in recentEvents" :key="eventItem.time + eventItem.text">
              <time>{{ eventItem.time }}</time><b :class="eventItem.level">{{ eventItem.text }}</b>
            </li>
          </ol>
        </div>
      </aside>
    </div>

    <footer class="playback-panel">
      <button type="button" class="transport" :aria-label="playing ? '暂停' : '播放'" @click="playing = !playing">
        {{ playing ? 'Ⅱ' : '▶' }}
      </button>
      <button type="button" class="transport reset" aria-label="重置" @click="reset">↺</button>
      <time>{{ formatTime(currentTime) }}</time>
      <div class="timeline-wrap">
        <input
          v-model.number="currentTime"
          type="range"
          min="0"
          :max="duration"
          step="0.2"
          aria-label="仿真时间轴"
          @input="onTimelineInput"
        />
        <div class="timeline-events" aria-hidden="true">
          <i style="left: 21.6%"></i><i style="left: 53.3%"></i><i style="left: 81.6%"></i>
        </div>
      </div>
      <time>{{ formatTime(duration) }}</time>
      <label class="speed-control">倍速
        <select v-model.number="playbackRate">
          <option :value="0.5">0.5×</option>
          <option :value="1">1×</option>
          <option :value="2">2×</option>
          <option :value="4">4×</option>
        </select>
      </label>
    </footer>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import echarts from '@/plugins/echarts.js'
import { createArrayFusionSocket } from '@/api/arrayFusionSocket.js'
import { analyse3dTLRD } from '@/api/soundFieldApi.js'
import ArrayFusionPlanner from '@/components/array-fusion/ArrayFusionPlanner.vue'
import ArrayFusion3DField from '@/components/array-fusion/ArrayFusion3DField.vue'
import MotionSignalDomains from '@/components/array-fusion/MotionSignalDomains.vue'
import {
  BEAM_SCAN_DEGREES,
  FUSION_DURATION_SECONDS,
  createDemoFrame,
  createLiveSpectrogram,
  createSpectrogram,
  mergeRemoteFrame,
} from '@/modules/array-fusion/arrayFusionModel.js'

const props = defineProps({
  activeSubmoduleId: { type: String, default: 'linked-overview' },
  sidebarOpen: { type: Boolean, default: false },
})

const missionStarted = ref(false)
const missionConfig = ref(null)
const duration = computed(() => Number(missionConfig.value?.duration ?? FUSION_DURATION_SECONDS))
const targets = Object.freeze([
  { id: 'alpha', label: '目标 A', name: '低噪声潜航器', code: 'CONTACT / A-017' },
  { id: 'bravo', label: '目标 B', name: '水下无人航行器', code: 'CONTACT / B-042' },
  { id: 'charlie', label: '目标 C', name: '远程弱目标', code: 'CONTACT / C-009' },
])

const selectedTarget = ref('alpha')
const activeTarget = computed(() => targets.find((item) => item.id === selectedTarget.value) ?? targets[0])
const playing = ref(true)
const playbackRate = ref(1)
const currentTime = ref(18)
const centerFrequency = ref(1000)
const threshold = ref(6)
const showHistory = ref(true)
const connectionState = ref('demo')
const connectionText = ref('演示数据')
const latestRemoteFrame = ref(null)
const latestRemoteAt = ref(0)
const frame = ref(createDemoFrame(currentTime.value))
const fieldData = ref(null)
const profileData = ref(null)
const bellhopJobId = ref('')
const fieldLoading = ref(false)
const fieldError = ref('')
const fieldDisplayMode = ref('3d')
const volumePayload = ref(null)
const volumeSource = ref(null)
const volumeStats = ref({ sectorCount: 0, rangeCount: 0, depthCount: 0 })
const volumeFieldRef = ref(null)
const activeWaypointIndex = ref(0)
const appliedWaypointIndex = ref(0)
const waypointFieldCache = new Map()
const waypointFieldRequests = new Map()

const fieldHost = ref(null)
const fieldCanvas = ref(null)
const spectrogramEl = ref(null)
const beamEl = ref(null)
let spectrogramChart = null
let beamChart = null
let resizeObserver = null
let timer = 0
let lastTickAt = 0
let socketClient = null
const remoteSpectrumHistory = []

const bearingError = computed(() => frame.value.peakBearing - frame.value.trueBearing)
const confidence = computed(() => Math.round(Math.max(18, Math.min(99, 50 + frame.value.snr * 3.2))))
const sourceLevelText = computed(() => (frame.value.event ? '瞬态增强' : frame.value.snr > threshold.value ? '稳定可辨' : '背景弱信号'))
const spectrogramCursor = computed(() => Math.max(1, Math.min(99, (currentTime.value / duration.value) * 100)))
const elementCount = computed(() => Math.max(1, Number(missionConfig.value?.nElem ?? 128)))
const elementOptions = computed(() => Array.from({ length: elementCount.value }, (_, index) => index + 1))
const observedElement = computed({
  get() {
    return Math.max(1, Math.min(
      elementCount.value,
      Number(missionConfig.value?.selectedElement ?? Math.ceil(elementCount.value / 2)),
    ))
  },
  set(value) {
    if (!missionConfig.value) return
    missionConfig.value.selectedElement = Math.max(1, Math.min(elementCount.value, Number(value) || 1))
  },
})
const platformHeading = computed(() => (
  Number.isFinite(frame.value.platformHeading)
    ? frame.value.platformHeading
    : Number(frame.value.platform?.headingDeg ?? 0)
))
const targetHeading = computed(() => (
  Number.isFinite(frame.value.targetHeading)
    ? frame.value.targetHeading
    : Number(frame.value.target?.headingDeg ?? 0)
))
const relativeBearing = computed(() => (
  Number.isFinite(frame.value.relativeBearing)
    ? frame.value.relativeBearing
    : Number(frame.value.absoluteBearing ?? 0)
))
const broadsideAngle = computed(() => (
  Number.isFinite(frame.value.broadsideAngle)
    ? frame.value.broadsideAngle
    : Number(frame.value.trueBearing ?? 0)
))
const selectedElementTlText = computed(() => {
  const value = Number(frame.value.selectedElementTl ?? frame.value.perElementTl?.[observedElement.value - 1])
  return Number.isFinite(value) ? `${value.toFixed(1)} dB` : '—'
})
const selectedElementPathCount = computed(() => (
  frame.value.selectedElementPathCount ?? frame.value.impulseResponse?.length ?? '—'
))
const arrayPositionText = computed(() => {
  const east = frame.value.array?.eastKm ?? frame.value.platform?.eastKm ?? 0
  const north = frame.value.array?.northKm ?? frame.value.platform?.northKm ?? 0
  const origin = missionConfig.value?.platformRoute?.[0] ?? { lon: 113.82, lat: 13.46 }
  const latitude = origin.lat + north / 111
  const longitude = origin.lon + east / (111 * Math.cos((latitude * Math.PI) / 180))
  return `${longitude.toFixed(3)}°E / ${latitude.toFixed(3)}°N`
})
const arrayAperture = computed(() => {
  const count = Number(missionConfig.value?.nElem ?? 128)
  const spacing = Number(missionConfig.value?.spacingM ?? 0.75)
  return Math.max(0, count - 1) * spacing
})
const arrayDepthM = computed(() => Number(missionConfig.value?.arrayDepthM ?? 50))
const fieldStatusText = computed(() => {
  if (fieldLoading.value) return '正在计算实际环境声场…'
  if (fieldError.value) return `回退：${fieldError.value}`
  return profileData.value?.actual_environment ? '实际 SSP 已加载，等待 Bellhop' : '解析式演示'
})
const fieldPanelLabel = computed(() => (
  volumePayload.value && fieldDisplayMode.value === '3d'
    ? fieldLoading.value && appliedWaypointIndex.value !== activeWaypointIndex.value
      ? `折点 ${activeWaypointIndex.value + 1} 计算中 · 暂用折点 ${appliedWaypointIndex.value + 1}`
      : `Bellhop 三维传播损失体 · 缓存插值 · 使用折点 ${appliedWaypointIndex.value + 1}`
    : fieldData.value ? 'Bellhop 距离—深度场 · 实际地形/SSP/多途' : fieldStatusText.value
))
const receiverBottomText = computed(() => {
  const value = Number(frame.value.propagation?.bottom_depth_m)
  return Number.isFinite(value) ? `${value.toFixed(0)} m` : '—'
})
const volumeSourceText = computed(() => {
  const source = volumeSource.value
  if (!source) return '—'
  return `${Number(source.lon).toFixed(3)}°E / ${Number(source.lat).toFixed(3)}°N`
})
const volumeSceneState = computed(() => {
  const platform = localToGeo(frame.value.platform)
  const target = localToGeo(frame.value.target)
  const array = localToGeo(frame.value.array)
  if (!platform || !target) return null
  return {
    timeS: Number(currentTime.value),
    platform: { ...platform, altitude: 1450 },
    target: { ...target, altitude: 1450 },
    array: array ? { ...array, altitude: 980 } : null,
    platformHeadingDeg: Number(frame.value.platform?.headingDeg ?? 0),
    targetHeadingDeg: Number(frame.value.target?.headingDeg ?? 0),
    arrayHeadingDeg: Number(frame.value.arrayHeading ?? 180),
    arrayApertureM: arrayAperture.value,
    arrayElementCount: Number(missionConfig.value?.nElem ?? 128),
    towLengthM: Number(missionConfig.value?.towLengthM ?? 300),
    targetDepthM: Number(missionConfig.value?.targetDepthM ?? 180),
    arrayDepthM: arrayDepthM.value,
  }
})
const currentTargetText = computed(() => {
  const target = volumeSceneState.value?.target
  return target ? `${target.lon.toFixed(3)}°E / ${target.lat.toFixed(3)}°N` : '—'
})
const recentEvents = computed(() => {
  const rows = [
    { at: 26, text: '宽带瞬态进入门限', level: 'warn' },
    { at: 64, text: '波束峰值稳定锁定', level: 'ok' },
    { at: 98, text: '目标线谱再次增强', level: 'warn' },
  ].filter((item) => item.at <= currentTime.value + 2)
  if (!rows.length) rows.push({ at: 0, text: '阵列开始连续监听', level: 'muted' })
  return rows.slice(-3).reverse().map((item) => ({ ...item, time: formatTime(item.at) }))
})

function signed(value) {
  const number = Number(value) || 0
  return `${number >= 0 ? '+' : ''}${number.toFixed(1)}`
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  return `${String(minutes).padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`
}

function headingText(value) {
  const heading = ((Number(value) % 360) + 360) % 360
  return `${heading.toFixed(1)}°`
}

function headingMetricLabel(subject) {
  return `${subject}${missionConfig.value?.motionMode === 'heading' ? '设定' : '实时'}航向`
}

function currentDemoFrame() {
  const routes = localizedMissionRoutes()
  return createDemoFrame(currentTime.value, {
    duration: duration.value,
    targetId: selectedTarget.value,
    platformRoute: routes.platform,
    targetRoute: routes.target,
    platformSpeedKnots: missionConfig.value?.platformSpeedKnots,
    targetSpeedKnots: missionConfig.value?.targetSpeedKnots,
    targetDepthM: missionConfig.value?.targetDepthM,
    arrayDepthM: missionConfig.value?.arrayDepthM,
    motionMode: missionConfig.value?.motionMode,
    platformHeadingDeg: missionConfig.value?.platformHeadingDeg,
    targetHeadingDeg: missionConfig.value?.targetHeadingDeg,
    towLengthM: missionConfig.value?.towLengthM,
    arrayHeadingMode: missionConfig.value?.arrayHeadingMode,
    arrayHeadingDeg: missionConfig.value?.arrayHeadingDeg,
    selectedElement: missionConfig.value?.selectedElement,
    nElem: missionConfig.value?.nElem,
    elementSpacingM: missionConfig.value?.spacingM,
    centerFrequency: centerFrequency.value,
    threshold: threshold.value,
  })
}

function localizedMissionRoutes() {
  const config = missionConfig.value
  const origin = config?.platformRoute?.[0]
  if (!origin) return { platform: null, target: null }
  const convert = (route) => route?.map((point) => ({
    eastKm: (point.lon - origin.lon) * 111 * Math.cos((origin.lat * Math.PI) / 180),
    northKm: (point.lat - origin.lat) * 111,
  }))
  return { platform: convert(config.platformRoute), target: convert(config.targetRoute) }
}

function localToGeo(position) {
  const origin = missionConfig.value?.platformRoute?.[0]
  if (!origin || !position) return null
  const latitude = Number(origin.lat) + Number(position.northKm ?? 0) / 111
  const longitude = Number(origin.lon) + Number(position.eastKm ?? 0)
    / (111 * Math.cos((latitude * Math.PI) / 180))
  return { lon: longitude, lat: latitude }
}

function geoToLocal(position) {
  const origin = missionConfig.value?.platformRoute?.[0]
  if (!origin || !position) return null
  const latitude = Number(position.lat)
  return {
    eastKm: (Number(position.lon) - Number(origin.lon)) * 111 * Math.cos((latitude * Math.PI) / 180),
    northKm: (latitude - Number(origin.lat)) * 111,
    headingDeg: Number(position.heading_deg ?? position.headingDeg ?? 0),
    speedKnots: Number(position.speed_knots ?? position.speedKnots ?? 0),
  }
}

function motionConfiguration(config = missionConfig.value) {
  const source = config?.targetRoute?.[0]
  const platform = config?.platformRoute?.[0]
  if (!source || !platform) return null
  return {
    source: {
      lon: Number(source.lon), lat: Number(source.lat), depth_m: Number(config.targetDepthM),
      speed_knots: Number(config.targetSpeedKnots), heading_deg: Number(config.targetHeadingDeg),
    },
    platform: {
      lon: Number(platform.lon), lat: Number(platform.lat), depth_m: 0,
      speed_knots: Number(config.platformSpeedKnots), heading_deg: Number(config.platformHeadingDeg),
    },
    array: {
      tow_length_m: Number(config.towLengthM), heading_mode: config.arrayHeadingMode,
      heading_deg: Number(config.arrayHeadingDeg),
    },
    duration_s: Number(config.duration), frame_step_s: Number(config.updateStepMs) / 1000,
    selected_element: Math.max(0, Math.min(Number(config.nElem) - 1, Number(config.selectedElement) - 1)),
  }
}

async function startMission(config) {
  missionConfig.value = config
  selectedTarget.value = config.targetId
  centerFrequency.value = Number(config.centerFrequency)
  threshold.value = Number(config.threshold)
  currentTime.value = 0
  remoteSpectrumHistory.length = 0
  latestRemoteFrame.value = null
  missionStarted.value = true
  playing.value = true
  fieldData.value = null
  volumePayload.value = null
  volumeSource.value = null
  volumeStats.value = { sectorCount: 0, rangeCount: 0, depthCount: 0 }
  activeWaypointIndex.value = 0
  appliedWaypointIndex.value = 0
  waypointFieldCache.clear()
  waypointFieldRequests.clear()
  profileData.value = null
  bellhopJobId.value = ''
  fieldError.value = ''
  socketClient?.sendConfig({
    n_elem: Number(config.nElem), d: Number(config.spacingM),
    f0: Number(config.centerFrequency), depth: Number(config.arrayDepthM),
    threshold: Number(config.threshold),
  })
  const motionConfig = motionConfiguration(config)
  if (motionConfig) socketClient?.sendMotionConfig(motionConfig)
  socketClient?.requestProfile({
    lon: Number(config.targetRoute?.[0]?.lon),
    lat: Number(config.targetRoute?.[0]?.lat),
    time: '2025-01-02 12:00:00',
  })
  void activateWaypointField(0, config)
  await nextTick()
  spectrogramChart?.resize()
  beamChart?.resize()
  refreshAll()
}

function routeGeometry(source, receiver) {
  const toRadians = (value) => Number(value) * Math.PI / 180
  const lon1 = toRadians(source.lon)
  const lat1 = toRadians(source.lat)
  const lon2 = toRadians(receiver.lon)
  const lat2 = toRadians(receiver.lat)
  const dLon = lon2 - lon1
  const dLat = lat2 - lat1
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const distanceM = 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return {
    distanceNm: distanceM / 1852,
    bearingDeg: ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360,
  }
}

function missionMaximumRangeNm(config) {
  const sources = Array.isArray(config.targetRoute) ? config.targetRoute : []
  const receivers = Array.isArray(config.platformRoute) ? config.platformRoute : []
  let maximum = 0.1
  for (const source of sources) {
    for (const receiver of receivers) {
      maximum = Math.max(maximum, routeGeometry(source, receiver).distanceNm)
    }
  }
  return maximum
}

async function calculateWaypointField(config, waypointIndex) {
  const source = config.targetRoute?.[waypointIndex]
  const receiver = volumeSceneState.value?.platform ?? config.platformRoute?.[0]
  if (!source || !receiver) {
    throw new Error('任务缺少目标折点或阵列位置')
  }
  const frequency = Number(config.centerFrequency)
  const environmentTime = '2025-01-02 12:00:00'
  const response = await analyse3dTLRD({
      coordX: Number(source.lon),
      coordY: Number(source.lat),
      dataSource: 'EnvReanalysis',
      dataType: 'DT_ENV_SOUND',
      time: environmentTime,
      timeRes: 0,
      rdataSource: 'EnvReanalysis',
      rtime: environmentTime,
      rtimeRes: 0,
      srcDepth: Number(config.targetDepthM),
      range: Math.max(0.1, missionMaximumRangeNm(config) * 1.08),
      minFreq: frequency,
      maxFreq: frequency,
      grazingAngle: 0,
      beamWidth: 180,
      seaState: 3,
      coherent: false,
      isWaterChanged: true,
      sector: 12,
      row: 96,
      col: 160,
  })
  const jobId = String(response?.Data?.TaskId || '').trim()
  if (!jobId) throw new Error('Bellhop 响应没有返回任务号')
  return {
    response,
    jobId,
    source: { lon: Number(source.lon), lat: Number(source.lat) },
    waypointIndex,
  }
}

function applyWaypointField(record) {
  appliedWaypointIndex.value = record.waypointIndex
  bellhopJobId.value = record.jobId
  volumeSource.value = record.source
  volumePayload.value = record.response
  if (!socketClient?.bindBellhop(record.jobId)) fieldError.value = '等待实时连接绑定 Bellhop 结果'
}

async function activateWaypointField(waypointIndex, config = missionConfig.value) {
  if (!config) return
  const cached = waypointFieldCache.get(waypointIndex)
  if (cached) {
    applyWaypointField(cached)
    fieldLoading.value = false
    fieldError.value = ''
    return
  }
  fieldLoading.value = true
  fieldError.value = ''
  let request = waypointFieldRequests.get(waypointIndex)
  if (!request) {
    request = calculateWaypointField(config, waypointIndex)
    waypointFieldRequests.set(waypointIndex, request)
  }
  try {
    const record = await request
    waypointFieldCache.set(waypointIndex, record)
    if (activeWaypointIndex.value === waypointIndex) applyWaypointField(record)
  } catch (error) {
    if (activeWaypointIndex.value === waypointIndex) fieldError.value = error?.message || String(error)
    console.error(`[ArrayFusion/Bellhop waypoint ${waypointIndex + 1}]`, error)
  } finally {
    waypointFieldRequests.delete(waypointIndex)
    if (activeWaypointIndex.value === waypointIndex) fieldLoading.value = false
    drawField()
  }
}

function routeWaypointIndex(route, timeS, totalDuration, speedKnots = 0) {
  if (!Array.isArray(route) || route.length < 2) return 0
  const lengths = route.slice(0, -1).map((point, index) => routeGeometry(point, route[index + 1]).distanceNm)
  const total = lengths.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return 0
  const speedDistanceNm = Math.max(0, Number(speedKnots)) * Number(timeS) / 3600
  const durationProgress = Math.max(0, Math.min(0.999999, Number(timeS) / Math.max(1, Number(totalDuration))))
  const traveled = speedKnots > 0 ? Math.min(total * 0.999999, speedDistanceNm) : durationProgress * total
  let cumulative = 0
  for (let index = 0; index < lengths.length; index += 1) {
    cumulative += lengths[index]
    if (traveled < cumulative - 1e-8) return index
  }
  return Math.max(0, route.length - 2)
}

function syncWaypointField() {
  const route = missionConfig.value?.targetRoute
  const nextIndex = routeWaypointIndex(route, currentTime.value, duration.value, missionConfig.value?.targetSpeedKnots)
  if (nextIndex !== activeWaypointIndex.value) {
    activeWaypointIndex.value = nextIndex
    void activateWaypointField(nextIndex)
  }
  const prefetchIndex = Math.min((route?.length ?? 1) - 1, nextIndex + 1)
  if (prefetchIndex !== nextIndex && !waypointFieldCache.has(prefetchIndex) && !waypointFieldRequests.has(prefetchIndex)) {
    const request = calculateWaypointField(missionConfig.value, prefetchIndex)
      .then((record) => waypointFieldCache.set(prefetchIndex, record))
      .catch((error) => console.warn(`[ArrayFusion/Bellhop prefetch ${prefetchIndex + 1}]`, error))
      .finally(() => waypointFieldRequests.delete(prefetchIndex))
    waypointFieldRequests.set(prefetchIndex, request)
  }
}

function sendCurrentMotionFrame(requestFrame = currentDemoFrame()) {
  const platformGeo = localToGeo(requestFrame.platform)
  const targetGeo = localToGeo(requestFrame.target)
  return socketClient?.sendMotionFrame({
    frame: requestFrame.frame,
    t: requestFrame.time,
    bellhop_job_id: bellhopJobId.value || undefined,
    array_curvature: requestFrame.arrayCurvature,
    selected_element: observedElement.value - 1,
    platform_state: platformGeo ? {
      ...platformGeo,
      speed_knots: Number(requestFrame.platform.speedKnots),
      heading_deg: Number(requestFrame.platform.headingDeg),
      depth_m: 0,
    } : undefined,
    source_state: targetGeo ? {
      ...targetGeo,
      speed_knots: Number(requestFrame.target.speedKnots),
      heading_deg: Number(requestFrame.target.headingDeg),
      depth_m: Number(missionConfig.value?.targetDepthM ?? 180),
    } : undefined,
  }) ?? false
}

function onObservedElementChange() {
  const usingLiveChannel = connectionState.value === 'live'
  frame.value = usingLiveChannel
    ? {
        ...frame.value,
        selectedElement: observedElement.value - 1,
        selectedElementTl: null,
        selectedElementPathCount: null,
      }
    : currentDemoFrame()
  const sent = sendCurrentMotionFrame()
  if (usingLiveChannel && !sent) frame.value = currentDemoFrame()
}

function selectObservedElement(value) {
  observedElement.value = value
  onObservedElementChange()
}

function onVolumeReady(stats) {
  volumeStats.value = stats
  fieldError.value = ''
}

function onVolumeError(message) {
  fieldError.value = `三维体渲染失败：${message}`
}

function openMissionPlanner() {
  playing.value = false
  missionStarted.value = false
}

function refreshAll() {
  const fallback = currentDemoFrame()
  const remoteIsFresh = hasFreshRemote()
  frame.value = remoteIsFresh ? mergeRemoteFrame(latestRemoteFrame.value, fallback) : fallback
  drawField()
  renderSpectrogram()
  renderBeam()
}

function hasFreshRemote() {
  return Boolean(latestRemoteFrame.value && performance.now() - latestRemoteAt.value < 1500)
}

function reset() {
  currentTime.value = 0
  playing.value = false
  refreshAll()
  syncWaypointField()
}

function onTimelineInput() {
  refreshAll()
  syncWaypointField()
}

const FIELD_BOUNDS = Object.freeze({ minEast: -46, maxEast: 58, minNorth: -22, maxNorth: 68 })

function toCanvasWorld(eastKm, northKm, width, height) {
  const padding = 24
  return {
    x: padding + ((eastKm - FIELD_BOUNDS.minEast) / (FIELD_BOUNDS.maxEast - FIELD_BOUNDS.minEast)) * (width - padding * 2),
    y: height - padding - ((northKm - FIELD_BOUNDS.minNorth) / (FIELD_BOUNDS.maxNorth - FIELD_BOUNDS.minNorth)) * (height - padding * 2),
  }
}

function pointFromBearing(origin, bearing, rangeKm, width, height) {
  const radians = (bearing * Math.PI) / 180
  return toCanvasWorld(
    origin.eastKm + Math.sin(radians) * rangeKm,
    origin.northKm + Math.cos(radians) * rangeKm,
    width,
    height,
  )
}

function drawShip(ctx, x, y, heading) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((heading * Math.PI) / 180)
  ctx.beginPath()
  ctx.moveTo(0, -15)
  ctx.lineTo(8, 9)
  ctx.lineTo(0, 6)
  ctx.lineTo(-8, 9)
  ctx.closePath()
  ctx.fillStyle = '#d9fbff'
  ctx.shadowColor = '#4bd5ff'
  ctx.shadowBlur = 14
  ctx.fill()
  ctx.restore()
}

function drawTarget(ctx, point, detected) {
  ctx.save()
  ctx.translate(point.x, point.y)
  ctx.rotate(Math.PI / 3)
  ctx.strokeStyle = detected ? '#ffcc66' : '#78b8c8'
  ctx.lineWidth = 1.5
  ctx.shadowColor = detected ? '#ffb84a' : '#4bd5ff'
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.moveTo(-12, 0)
  ctx.lineTo(12, 0)
  ctx.moveTo(-7, -4)
  ctx.lineTo(7, -4)
  ctx.moveTo(-4, 4)
  ctx.lineTo(5, 4)
  ctx.stroke()
  ctx.restore()
}

function drawTrack(ctx, history, key, width, height, color) {
  if (!history?.length) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  history.forEach((item, index) => {
    const state = item[key]
    const point = toCanvasWorld(state.eastKm, state.northKm, width, height)
    if (index === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.stroke()
  ctx.restore()
}

function drawPropagationField(ctx, source, receiver, width, height) {
  const sourcePoint = toCanvasWorld(source.eastKm, source.northKm, width, height)
  const receiverPoint = toCanvasWorld(receiver.eastKm, receiver.northKm, width, height)
  const dx = receiverPoint.x - sourcePoint.x
  const dy = receiverPoint.y - sourcePoint.y
  const distance = Math.hypot(dx, dy)
  const intensity = Math.max(0.18, Math.min(0.9, (frame.value.snr + 4) / 22))
  const fieldRadius = Math.max(85, Math.min(Math.max(width, height) * 0.72, distance * 1.35))

  const fieldGradient = ctx.createRadialGradient(sourcePoint.x, sourcePoint.y, 3, sourcePoint.x, sourcePoint.y, fieldRadius)
  fieldGradient.addColorStop(0, `rgba(255, 220, 82, ${0.40 * intensity})`)
  fieldGradient.addColorStop(0.24, `rgba(73, 218, 190, ${0.28 * intensity})`)
  fieldGradient.addColorStop(0.60, `rgba(20, 133, 189, ${0.18 * intensity})`)
  fieldGradient.addColorStop(1, 'rgba(15, 62, 120, 0)')
  ctx.fillStyle = fieldGradient
  ctx.beginPath(); ctx.arc(sourcePoint.x, sourcePoint.y, fieldRadius, 0, Math.PI * 2); ctx.fill()

  const phase = (currentTime.value * (centerFrequency.value / 1000) * 0.55) % 1
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  for (let ring = 0; ring < 7; ring += 1) {
    const radius = ((ring + phase) / 7) * fieldRadius
    ctx.strokeStyle = `rgba(89, 222, 224, ${Math.max(0.03, (1 - radius / fieldRadius) * 0.15 * intensity)})`
    ctx.lineWidth = ring % 2 ? 1 : 1.5
    ctx.beginPath(); ctx.arc(sourcePoint.x, sourcePoint.y, radius, 0, Math.PI * 2); ctx.stroke()
  }
  const corridor = ctx.createLinearGradient(sourcePoint.x, sourcePoint.y, receiverPoint.x, receiverPoint.y)
  corridor.addColorStop(0, 'rgba(255, 212, 91, .08)')
  corridor.addColorStop(0.65, `rgba(85, 221, 205, ${0.20 * intensity})`)
  corridor.addColorStop(1, `rgba(109, 240, 255, ${0.42 * intensity})`)
  ctx.strokeStyle = corridor
  ctx.lineWidth = 9 + intensity * 10
  ctx.beginPath(); ctx.moveTo(sourcePoint.x, sourcePoint.y); ctx.lineTo(receiverPoint.x, receiverPoint.y); ctx.stroke()
  ctx.restore()
}

function drawTowedArray(ctx, platform, width, height) {
  const platformPoint = toCanvasWorld(platform.eastKm, platform.northKm, width, height)
  const arrayHeading = ((frame.value.arrayHeading ?? platform.headingDeg + 180) * Math.PI) / 180
  const sideHeading = arrayHeading + Math.PI / 2
  const towLengthKm = Math.max(0, Number(missionConfig.value?.towLengthM ?? 300)) / 1000
  const apertureKm = arrayAperture.value / 1000
  const arrayCenter = frame.value.array ?? {
    eastKm: platform.eastKm + Math.sin(arrayHeading) * towLengthKm,
    northKm: platform.northKm + Math.cos(arrayHeading) * towLengthKm,
  }
  const points = Array.from({ length: 17 }, (_, index) => {
    const fraction = index / 16
    const offsetKm = (fraction - 0.5) * apertureKm
    const crossTrack = (frame.value.arrayCurvature ?? 0) * apertureKm * 0.25 * Math.sin(Math.PI * fraction)
    return toCanvasWorld(
      arrayCenter.eastKm + Math.sin(arrayHeading) * offsetKm + Math.sin(sideHeading) * crossTrack,
      arrayCenter.northKm + Math.cos(arrayHeading) * offsetKm + Math.cos(sideHeading) * crossTrack,
      width,
      height,
    )
  })
  ctx.save()
  ctx.strokeStyle = 'rgba(75, 213, 255, .82)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(platformPoint.x, platformPoint.y)
  points.forEach((point) => ctx.lineTo(point.x, point.y))
  ctx.stroke()
  points.forEach((point, index) => {
    ctx.fillStyle = index === 8 ? '#ffe66b' : '#68ddf2'
    ctx.beginPath(); ctx.arc(point.x, point.y, index === 8 ? 2.8 : 1.4, 0, Math.PI * 2); ctx.fill()
  })
  ctx.restore()
}

function tlColor(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'rgba(2, 17, 29, .92)'
  const stops = [
    [40, [255, 223, 87]], [60, [76, 214, 182]], [80, [31, 145, 175]],
    [100, [24, 83, 139]], [120, [10, 35, 70]],
  ]
  const tl = Math.max(stops[0][0], Math.min(stops.at(-1)[0], Number(value)))
  let upper = 1
  while (upper < stops.length && tl > stops[upper][0]) upper += 1
  const lower = Math.max(0, upper - 1)
  upper = Math.min(stops.length - 1, upper)
  const span = Math.max(1, stops[upper][0] - stops[lower][0])
  const ratio = (tl - stops[lower][0]) / span
  const rgb = stops[lower][1].map((channel, index) => Math.round(
    channel + (stops[upper][1][index] - channel) * ratio,
  ))
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

function drawBellhopField(ctx, width, height) {
  const field = fieldData.value
  const ranges = field?.range_km ?? []
  const depths = field?.depth_m ?? []
  const values = field?.tl_db ?? []
  if (ranges.length < 2 || depths.length < 2 || !values.length) return false

  ctx.fillStyle = '#021321'
  ctx.fillRect(0, 0, width, height)
  const plot = { left: 54, top: 26, right: width - 24, bottom: height - 42 }
  const plotWidth = Math.max(1, plot.right - plot.left)
  const plotHeight = Math.max(1, plot.bottom - plot.top)
  const rangeMax = Math.max(...ranges.map(Number).filter(Number.isFinite), 1)
  const depthMax = Math.max(...depths.map(Number).filter(Number.isFinite), 1)
  const xAt = (rangeKm) => plot.left + (Number(rangeKm) / rangeMax) * plotWidth
  const yAt = (depthM) => plot.top + (Number(depthM) / depthMax) * plotHeight

  const cellWidth = plotWidth / ranges.length + 1
  const cellHeight = plotHeight / depths.length + 1
  for (let iz = 0; iz < depths.length; iz += 1) {
    for (let ir = 0; ir < ranges.length; ir += 1) {
      ctx.fillStyle = tlColor(values[iz]?.[ir])
      ctx.fillRect(xAt(ranges[ir]) - 0.5, yAt(depths[iz]) - 0.5, cellWidth, cellHeight)
    }
  }

  const bathyRange = field.bathymetry?.range_m ?? []
  const bathyDepth = field.bathymetry?.bottom_depth_m ?? []
  if (bathyRange.length > 1 && bathyRange.length === bathyDepth.length) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(xAt(Number(bathyRange[0]) / 1000), plot.bottom)
    bathyRange.forEach((rangeM, index) => ctx.lineTo(
      xAt(Number(rangeM) / 1000), yAt(Number(bathyDepth[index])),
    ))
    ctx.lineTo(xAt(Number(bathyRange.at(-1)) / 1000), plot.bottom)
    ctx.closePath()
    const bottomGradient = ctx.createLinearGradient(0, plot.top, 0, plot.bottom)
    bottomGradient.addColorStop(0, 'rgba(52, 58, 53, .78)')
    bottomGradient.addColorStop(1, 'rgba(14, 17, 20, .98)')
    ctx.fillStyle = bottomGradient
    ctx.fill()
    ctx.strokeStyle = '#b1a16d'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  for (const ray of field.rays ?? []) {
    const rayRange = ray.range_km ?? []
    const rayDepth = ray.depth_m ?? []
    if (rayRange.length < 2 || rayRange.length !== rayDepth.length) continue
    ctx.beginPath()
    rayRange.forEach((rangeKm, index) => {
      const x = xAt(rangeKm)
      const y = yAt(rayDepth[index])
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = 'rgba(234, 252, 255, .22)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(133, 204, 222, .42)'
  ctx.lineWidth = 1
  ctx.strokeRect(plot.left, plot.top, plotWidth, plotHeight)
  ctx.fillStyle = '#81a8b5'
  ctx.font = '10px Consolas, monospace'
  for (let index = 0; index <= 4; index += 1) {
    const x = plot.left + (plotWidth * index) / 4
    const y = plot.top + (plotHeight * index) / 4
    ctx.fillText(`${(rangeMax * index / 4).toFixed(1)} km`, x - 13, plot.bottom + 18)
    ctx.fillText(`${Math.round(depthMax * index / 4)} m`, 7, y + 3)
  }

  const sourceDepth = Number(field.source?.depth_m ?? 0)
  ctx.fillStyle = '#ffe16b'
  ctx.beginPath(); ctx.arc(xAt(0), yAt(sourceDepth), 4, 0, Math.PI * 2); ctx.fill()
  const receiverRange = Math.min(rangeMax, Number(frame.value.rangeKm) || 0)
  const receiverDepth = Math.min(depthMax, arrayDepthM.value)
  ctx.strokeStyle = '#ff665f'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(xAt(receiverRange), yAt(receiverDepth), 6, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(xAt(receiverRange) - 9, yAt(receiverDepth)); ctx.lineTo(xAt(receiverRange) + 9, yAt(receiverDepth)); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(xAt(receiverRange), yAt(receiverDepth) - 9); ctx.lineTo(xAt(receiverRange), yAt(receiverDepth) + 9); ctx.stroke()

  const sspDepth = field.ssp?.depth_m ?? []
  const sspSpeed = field.ssp?.sound_speed_mps ?? []
  if (sspDepth.length > 1 && sspDepth.length === sspSpeed.length) {
    const inset = { left: width - 150, top: 36, width: 112, height: 104 }
    const speeds = sspSpeed.map(Number).filter(Number.isFinite)
    const speedMin = Math.min(...speeds)
    const speedMax = Math.max(...speeds)
    ctx.fillStyle = 'rgba(2, 16, 27, .82)'
    ctx.fillRect(inset.left - 8, inset.top - 18, inset.width + 16, inset.height + 28)
    ctx.fillStyle = '#9ed4df'; ctx.font = '9px "Microsoft YaHei", sans-serif'
    ctx.fillText(`实际 SSP ${speedMin.toFixed(0)}–${speedMax.toFixed(0)} m/s`, inset.left, inset.top - 5)
    ctx.beginPath()
    sspDepth.forEach((depth, index) => {
      const x = inset.left + ((Number(sspSpeed[index]) - speedMin) / Math.max(1, speedMax - speedMin)) * inset.width
      const y = inset.top + (Number(depth) / Math.max(1, Math.max(...sspDepth.map(Number)))) * inset.height
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = '#67efbd'; ctx.lineWidth = 1.5; ctx.stroke()
  }
  return true
}

function drawField() {
  const canvas = fieldCanvas.value
  const host = fieldHost.value
  if (!canvas || !host) return
  const rect = host.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const width = rect.width
  const height = rect.height

  if (fieldData.value && drawBellhopField(ctx, width, height)) return

  const background = ctx.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#062337')
  background.addColorStop(0.55, '#031c31')
  background.addColorStop(1, '#021321')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = 'rgba(73, 190, 221, 0.08)'
  ctx.lineWidth = 1
  const grid = 44
  for (let x = -grid; x < width + grid; x += grid) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height * 0.22, height); ctx.stroke()
  }
  for (let y = 0; y < height; y += grid) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(55, 143, 167, 0.12)'
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath()
    for (let x = 0; x <= width; x += 8) {
      const y = height * (0.18 + i * 0.17) + Math.sin(x * 0.018 + i * 1.8) * (12 + i * 3)
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  const platform = frame.value.platform ?? { eastKm: 0, northKm: 0, headingDeg: 0 }
  const target = frame.value.target ?? { eastKm: 0, northKm: frame.value.rangeKm }
  const platformPoint = toCanvasWorld(platform.eastKm, platform.northKm, width, height)
  const targetPoint = toCanvasWorld(target.eastKm, target.northKm, width, height)
  const estimatePoint = pointFromBearing(
    platform,
    (platform.headingDeg ?? 0) + frame.value.peakBearing,
    frame.value.rangeKm,
    width,
    height,
  )

  drawPropagationField(ctx, target, platform, width, height)
  if (showHistory.value) {
    drawTrack(ctx, frame.value.history, 'platform', width, height, 'rgba(91, 196, 219, .44)')
    drawTrack(ctx, frame.value.history, 'target', width, height, 'rgba(255, 190, 91, .52)')
  }

  ctx.strokeStyle = 'rgba(255, 100, 92, 0.75)'
  ctx.setLineDash([6, 5])
  ctx.beginPath(); ctx.moveTo(platformPoint.x, platformPoint.y); ctx.lineTo(targetPoint.x, targetPoint.y); ctx.stroke()
  ctx.strokeStyle = 'rgba(96, 243, 177, 0.95)'
  ctx.setLineDash([])
  ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.moveTo(platformPoint.x, platformPoint.y); ctx.lineTo(estimatePoint.x, estimatePoint.y); ctx.stroke()

  drawTowedArray(ctx, platform, width, height)
  drawShip(ctx, platformPoint.x, platformPoint.y, platform.headingDeg ?? 0)
  drawTarget(ctx, targetPoint, frame.value.detected)

  ctx.font = '12px "Microsoft YaHei", sans-serif'
  ctx.fillStyle = '#d8f8ff'
  ctx.fillText('拖曳线阵平台', platformPoint.x + 15, platformPoint.y - 7)
  ctx.fillStyle = frame.value.detected ? '#ffd071' : '#8fc3cf'
  ctx.fillText(activeTarget.value.code, targetPoint.x + 14, targetPoint.y - 9)
}

function axisLabelEvery(values, index, divisor = 5) {
  const step = Math.max(1, Math.round(values.length / divisor))
  return index % step === 0 || index === values.length - 1
}

function renderSpectrogram() {
  if (!spectrogramChart) return
  const liveSpec = hasFreshRemote() ? createLiveSpectrogram(remoteSpectrumHistory) : null
  const routes = localizedMissionRoutes()
  const spec = liveSpec || createSpectrogram(currentTime.value, {
    targetId: selectedTarget.value,
    platformRoute: routes.platform,
    targetRoute: routes.target,
    duration: duration.value,
    platformSpeedKnots: missionConfig.value?.platformSpeedKnots,
    targetSpeedKnots: missionConfig.value?.targetSpeedKnots,
    centerFrequency: centerFrequency.value,
    threshold: threshold.value,
  })
  spectrogramChart.setOption({
    animation: false,
    grid: { left: 56, right: 26, top: 12, bottom: 34 },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(2, 21, 34, .94)',
      borderColor: '#257a96',
      textStyle: { color: '#d8f8ff', fontSize: 11 },
      formatter: ({ value }) => `${spec.times[value[0]]} s<br>${spec.frequencies[value[1]]} Hz<br>${value[2]} dB`,
    },
    xAxis: {
      type: 'category', data: spec.times,
      axisLine: { lineStyle: { color: '#2b6073' } },
      axisTick: { show: false },
      axisLabel: { color: '#7da7b6', fontSize: 10, formatter: (value, index) => axisLabelEvery(spec.times, index) ? value : '' },
      splitLine: { show: false },
      name: '时间 / s', nameTextStyle: { color: '#7095a4', fontSize: 10 },
    },
    yAxis: {
      type: 'category', data: spec.frequencies,
      axisLine: { lineStyle: { color: '#2b6073' } },
      axisTick: { show: false },
      axisLabel: { color: '#7da7b6', fontSize: 10, formatter: (value, index) => axisLabelEvery(spec.frequencies, index, 4) ? value : '' },
      name: 'Hz', nameTextStyle: { color: '#7095a4', fontSize: 10 },
    },
    visualMap: {
      show: false, min: -82, max: -28,
      inRange: { color: ['#07182d', '#164d79', '#1b8c9f', '#56c982', '#d4dd49', '#ff9f43', '#ff4f57'] },
    },
    series: [{ type: 'heatmap', data: spec.data, progressive: 0, emphasis: { disabled: true } }],
  }, { notMerge: true })
}

function renderBeam() {
  if (!beamChart) return
  const values = frame.value.curve.map((power, index) => [
    -BEAM_SCAN_DEGREES + (index / Math.max(frame.value.curve.length - 1, 1)) * BEAM_SCAN_DEGREES * 2,
    power,
  ])
  beamChart.setOption({
    animation: false,
    grid: { left: 53, right: 24, top: 12, bottom: 37 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(2, 21, 34, .94)',
      borderColor: '#257a96',
      textStyle: { color: '#d8f8ff', fontSize: 11 },
      formatter: (items) => `${Number(items[0].value[0]).toFixed(1)}°<br>${Number(items[0].value[1]).toFixed(1)} dB`,
    },
    xAxis: {
      type: 'value', min: -90, max: 90, interval: 30,
      axisLine: { lineStyle: { color: '#2b6073' } },
      axisTick: { show: false }, axisLabel: { color: '#7da7b6', fontSize: 10, formatter: '{value}°' },
      splitLine: { lineStyle: { color: 'rgba(67, 145, 169, .13)' } },
      name: '相对方位', nameTextStyle: { color: '#7095a4', fontSize: 10 },
    },
    yAxis: {
      type: 'value', min: -42, max: 2, interval: 10,
      axisLine: { lineStyle: { color: '#2b6073' } },
      axisTick: { show: false }, axisLabel: { color: '#7da7b6', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(67, 145, 169, .13)' } },
      name: 'dB', nameTextStyle: { color: '#7095a4', fontSize: 10 },
    },
    series: [{
      type: 'line', data: values, showSymbol: false, smooth: true,
      lineStyle: { color: '#ffd166', width: 2 },
      areaStyle: { color: 'rgba(255, 187, 65, .08)' },
      markLine: {
        symbol: 'none', silent: true,
        label: { color: '#b9e7ed', fontSize: 10, formatter: ({ name }) => name },
        data: [
          { name: '真实', xAxis: frame.value.trueBearing, lineStyle: { color: '#ff655f', type: 'dashed', width: 1.2 } },
          { name: '峰值', xAxis: frame.value.peakBearing, lineStyle: { color: '#61efb5', type: 'dotted', width: 1.5 } },
        ],
      },
    }],
  }, { notMerge: true })
}

watch(selectedTarget, () => {
  remoteSpectrumHistory.length = 0
  refreshAll()
})
watch([centerFrequency, threshold], () => {
  socketClient?.sendConfig({ f0: centerFrequency.value, threshold: threshold.value })
  refreshAll()
})
watch(showHistory, () => drawField())

onMounted(async () => {
  await nextTick()
  if (spectrogramEl.value) spectrogramChart = echarts.init(spectrogramEl.value)
  if (beamEl.value) beamChart = echarts.init(beamEl.value)
  resizeObserver = new ResizeObserver(() => {
    spectrogramChart?.resize()
    beamChart?.resize()
    drawField()
  })
  resizeObserver.observe(document.querySelector('.fusion-view'))

  socketClient = createArrayFusionSocket({
    onFrame(remoteFrame) {
      // 用户切换阵元时，忽略切换前已经在途的旧阵元回帧，避免界面被旧选择覆盖。
      if (remoteFrame.selectedElement !== observedElement.value - 1) return
      const kinematics = remoteFrame.kinematics
      if (kinematics) {
        remoteFrame.platform = geoToLocal(kinematics.platform)
        remoteFrame.target = geoToLocal(kinematics.source)
        remoteFrame.array = geoToLocal(kinematics.array)
        remoteFrame.arrayHeading = Number(kinematics.array?.heading_deg ?? remoteFrame.arrayHeading)
      }
      latestRemoteFrame.value = remoteFrame
      latestRemoteAt.value = performance.now()
      if (remoteFrame.frequencies.length && remoteFrame.frequencies.length === remoteFrame.spectrum.length) {
        remoteSpectrumHistory.push(remoteFrame)
        if (remoteSpectrumHistory.length > 56) remoteSpectrumHistory.shift()
      }
      // 在线回帧即刻驱动六域图表；暂停状态下没有定时 tick，不能只缓存回帧。
      refreshAll()
    },
    onField(remoteField) {
      fieldData.value = remoteField
      fieldLoading.value = false
      fieldError.value = ''
      const solvedFrequency = Number(remoteField?.source?.frequency_hz)
      if (Number.isFinite(solvedFrequency) && solvedFrequency > 0) centerFrequency.value = solvedFrequency
      drawField()
    },
    onProfile(remoteProfile) {
      profileData.value = remoteProfile
      drawField()
    },
    onError(payload) {
      fieldError.value = payload?.message || '声场实时数据处理失败'
      drawField()
    },
    onStatus(status) {
      connectionState.value = status.state
      connectionText.value = status.message
      if (status.state === 'live') {
        socketClient?.sendConfig({
          n_elem: Number(missionConfig.value?.nElem ?? 128),
          d: Number(missionConfig.value?.spacingM ?? 0.75),
          depth: arrayDepthM.value,
          f0: centerFrequency.value,
          threshold: threshold.value,
        })
        const motionConfig = motionConfiguration()
        if (motionConfig) socketClient?.sendMotionConfig(motionConfig)
        if (bellhopJobId.value) socketClient?.bindBellhop(bellhopJobId.value)
        else if (missionConfig.value?.targetRoute?.[0]) {
          socketClient?.requestProfile({
            lon: Number(missionConfig.value.targetRoute[0].lon),
            lat: Number(missionConfig.value.targetRoute[0].lat),
            time: '2025-01-02 12:00:00',
          })
        }
      }
    },
  })

  refreshAll()
  const tick = () => {
    if (!missionStarted.value || !playing.value) return
    const now = performance.now()
    const requestedStepMs = Math.max(50, Number(missionConfig.value?.updateStepMs ?? 200))
    if (now - lastTickAt < requestedStepMs - 5) return
    lastTickAt = now
    const stepSeconds = Number(missionConfig.value?.updateStepMs ?? 200) / 1000
    currentTime.value += stepSeconds * playbackRate.value
    if (currentTime.value >= duration.value) currentTime.value = 0
    const requestFrame = currentDemoFrame()
    sendCurrentMotionFrame(requestFrame)
    refreshAll()
    syncWaypointField()
  }
  timer = window.setInterval(tick, 50)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
  resizeObserver?.disconnect()
  socketClient?.close()
  spectrogramChart?.dispose()
  beamChart?.dispose()
})
</script>

<style scoped>
.fusion-view {
  --line: rgba(69, 174, 205, 0.26);
  --panel: rgba(3, 24, 39, 0.92);
  position: absolute;
  inset: 54px 0 0;
  min-width: 980px;
  overflow: hidden;
  color: #d9f7ff;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 36% 38%, rgba(16, 101, 130, 0.15), transparent 38%),
    linear-gradient(135deg, #020d18, #041827 58%, #020c16);
}

.fusion-view.module-open {
  left: 200px;
}

.fusion-view::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.17;
  background-image: linear-gradient(rgba(98, 196, 222, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(98, 196, 222, 0.05) 1px, transparent 1px);
  background-size: 32px 32px;
}

button, input, select { font: inherit; }
button { color: inherit; }

.fusion-toolbar {
  position: relative;
  z-index: 2;
  height: 64px;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto minmax(260px, 1fr);
  align-items: center;
  gap: 18px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(2, 17, 29, 0.88);
}

.mission-title { display: flex; flex-direction: column; }
.mission-title strong { font-size: 18px; letter-spacing: 2px; }
.eyebrow { color: #4ec8e7; font-size: 9px; letter-spacing: 2.2px; }
.scenario-switch { display: flex; padding: 3px; border: 1px solid rgba(77, 182, 211, .25); background: rgba(1, 14, 24, .78); }
.scenario-switch button { min-width: 88px; padding: 7px 14px; border: 0; color: #718f9a; font-size: 12px; background: transparent; cursor: pointer; }
.scenario-switch button.active { color: #d9fbff; background: linear-gradient(180deg, rgba(28, 148, 181, .38), rgba(20, 91, 113, .3)); box-shadow: inset 0 -2px #42cbed; }
.toolbar-status { display: flex; justify-content: flex-end; gap: 8px; }
.mission-settings { padding: 6px 10px; border: 1px solid rgba(64, 190, 222, .38); color: #78d9ec; font-size: 10px; background: rgba(11, 70, 90, .3); cursor: pointer; }
.status-pill { display: inline-flex; align-items: center; gap: 7px; padding: 6px 9px; border: 1px solid rgba(111, 169, 184, .24); color: #8aa8b1; font-size: 11px; background: rgba(2, 20, 32, .7); }
.status-pill i { width: 6px; height: 6px; border-radius: 50%; background: #78909a; }
.status-pill.live i, .status-pill.detected.active i { background: #5ce7a6; box-shadow: 0 0 8px #5ce7a6; }
.status-pill.connecting i { background: #ffd166; box-shadow: 0 0 8px #ffd166; }
.status-pill.error i { background: #ff6868; }
.status-pill.detected.active { color: #c8f7dd; border-color: rgba(92, 231, 166, .35); }

.fusion-grid {
  position: absolute;
  inset: 76px 14px 72px;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(480px, 1.35fr) minmax(350px, .9fr) 268px;
  gap: 10px;
}

.panel { min-height: 0; border: 1px solid var(--line); background: var(--panel); box-shadow: inset 0 0 30px rgba(11, 73, 94, .08), 0 10px 30px rgba(0, 5, 12, .22); }
.panel-header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid rgba(67, 161, 187, .18); background: linear-gradient(90deg, rgba(16, 69, 88, .26), transparent); box-sizing: border-box; }
.panel-header > div { display: flex; align-items: center; gap: 9px; }
.panel-header h2 { margin: 0; font-size: 14px; font-weight: 500; letter-spacing: 1.5px; }
.panel-index { color: #3fc3e7; font-size: 10px; font-family: Consolas, monospace; }
.panel-header.compact { height: 42px; }
.panel-actions { color: #6d96a4; font-size: 10px; }
.panel-actions button { padding: 4px 8px; border: 1px solid rgba(76, 177, 205, .28); color: #6d96a4; font-size: 10px; background: rgba(3, 28, 43, .8); cursor: pointer; }
.panel-actions button.active { color: #59d7ef; border-color: rgba(67, 200, 231, .55); }

.situation-panel { display: grid; grid-template-rows: 48px minmax(0, 1fr) 70px; }
.field-stage { position: relative; min-height: 0; overflow: hidden; }
.field-stage canvas { display: block; width: 100%; height: 100%; }
.map-north { position: absolute; top: 18px; right: 18px; width: 28px; height: 28px; display: grid; place-items: center; color: #7bdff1; font: 700 12px Georgia, serif; border: 1px solid rgba(83, 196, 220, .4); border-radius: 50%; }
.map-north::before { content: ''; position: absolute; top: -7px; border: 4px solid transparent; border-bottom-color: #7bdff1; }
.map-scale { position: absolute; right: 20px; bottom: 18px; color: #7b9fab; font-size: 10px; }
.map-scale span { display: inline-block; width: 54px; margin-right: 7px; border-top: 2px solid #86bfcf; box-shadow: -1px 4px 0 -3px #86bfcf, 1px 4px 0 -3px #86bfcf; vertical-align: middle; }
.field-legend { position: absolute; z-index: 3; left: 15px; bottom: 16px; width: 150px; color: #7f9faa; font-size: 9px; }
.legend-ramp { height: 6px; margin: 5px 0 3px; background: linear-gradient(90deg, #ffdf57, #45d8bd, #2377b5, rgba(24, 54, 98, .2)); }
.legend-labels { display: flex; justify-content: space-between; }
.legend-labels b { font-weight: 400; }
.field-readout { position: absolute; z-index: 3; top: 15px; left: 15px; display: grid; grid-template-columns: auto auto; gap: 4px 10px; padding: 8px 10px; color: #6e97a4; font-size: 9px; border-left: 2px solid #39bddf; background: rgba(2, 18, 29, .68); }
.field-readout strong { color: #b8dfe8; font-weight: 500; font-family: Consolas, monospace; }
.situation-footer { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid rgba(67, 161, 187, .18); background: rgba(2, 16, 27, .72); }
.situation-footer div { display: flex; flex-direction: column; justify-content: center; padding-left: 15px; border-right: 1px solid rgba(67, 161, 187, .13); }
.situation-footer span { color: #6d909c; font-size: 10px; }
.situation-footer strong { margin-top: 3px; color: #e1f8fc; font: 500 19px Consolas, monospace; }
.situation-footer small { margin-left: 3px; color: #628e9b; font-size: 10px; }

.analysis-stack { min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); }
.chart-panel { position: relative; display: grid; grid-template-rows: 42px minmax(0, 1fr); }
.chart-host { min-height: 0; }
.chart-note, .beam-summary { color: #668d99; font-size: 9px; }
.chart-note i { width: 6px; height: 6px; border-radius: 50%; }
.chart-note .cyan { background: #48d2e9; }.chart-note .amber { background: #ffbf54; }
.beam-summary b { color: #c8edf3; font: 500 11px Consolas, monospace; }
.chart-crosshair { position: absolute; top: 48px; bottom: 33px; width: 1px; pointer-events: none; background: rgba(255, 255, 255, .22); box-shadow: 0 0 7px rgba(255, 255, 255, .35); }

.telemetry-panel { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.target-card { display: flex; align-items: center; gap: 12px; margin: 13px 13px 0; padding: 11px; border: 1px solid rgba(65, 166, 192, .16); background: rgba(6, 39, 54, .38); }
.target-card > div:last-child { display: flex; min-width: 0; flex-direction: column; }
.target-card span, .target-card small { color: #6e98a5; font-size: 9px; }
.target-card strong { margin: 3px 0; overflow: hidden; color: #d8f4f8; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.target-icon { position: relative; width: 38px; height: 38px; flex: 0 0 38px; border: 1px solid rgba(74, 190, 216, .35); border-radius: 50%; }
.target-icon span { position: absolute; inset: 6px; border: 1px solid rgba(74, 190, 216, .25); border-radius: 50%; }
.target-icon span:nth-child(2) { inset: 12px; background: #4dc7de; box-shadow: 0 0 10px #4dc7de; }
.target-icon span:nth-child(3) { top: 18px; right: -5px; bottom: auto; left: 18px; border: 0; border-top: 1px solid #6dd9ea; border-radius: 0; transform: rotate(-35deg); transform-origin: left; }
.target-icon.locked { border-color: rgba(92, 231, 166, .55); }
.metric-ring { --score: 60; width: 108px; height: 108px; margin: 14px auto 10px; display: grid; place-items: center; border-radius: 50%; background: conic-gradient(#4fe3a7 calc(var(--score) * 1%), rgba(50, 91, 102, .22) 0); box-shadow: 0 0 24px rgba(40, 197, 151, .10); }
.metric-ring::before { content: ''; position: absolute; width: 95px; height: 95px; border-radius: 50%; background: #052032; }
.metric-ring > div { position: relative; z-index: 1; text-align: center; }
.metric-ring strong { color: #dffbf1; font: 500 26px Consolas, monospace; }.metric-ring span { color: #57dbaa; font-size: 11px; }.metric-ring small { display: block; color: #70949e; font-size: 9px; }
.telemetry-list { margin: 0 13px; }
.telemetry-list div { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(64, 139, 158, .11); }
.telemetry-list dt { color: #668b97; font-size: 10px; }.telemetry-list dd { margin: 0; color: #b9dce3; font: 10px Consolas, monospace; }
.element-selector-row select { min-width: 76px; padding: 2px 5px; border: 1px solid rgba(67, 155, 178, .35); color: #bfe5eb; font: 10px Consolas, monospace; background: #071e2c; }
.element-shortcuts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 8px 13px 0; }.element-shortcuts button { padding: 5px 3px; border: 1px solid rgba(67, 155, 178, .28); color: #80aab5; font-size: 9px; background: rgba(7, 30, 44, .75); cursor: pointer; }.element-shortcuts button:hover { color: #d9f8ff; border-color: #39c8e7; }
.control-group { margin: 10px 13px 0; }
.control-group label { display: flex; justify-content: space-between; color: #7397a1; font-size: 9px; }
.control-group output { color: #65cee5; font-family: Consolas, monospace; }
.control-group input { width: 100%; height: 2px; accent-color: #36c3e5; cursor: pointer; }
.event-log { min-height: 0; margin: 12px 13px 0; padding-top: 9px; border-top: 1px solid rgba(65, 163, 190, .16); overflow: hidden; }
.event-log > span { color: #7da4af; font-size: 9px; letter-spacing: 1px; }
.event-log ol { margin: 7px 0 0; padding: 0; list-style: none; }
.event-log li { display: grid; grid-template-columns: 42px 1fr; gap: 8px; padding: 4px 0; font-size: 9px; }
.event-log time { color: #537987; font-family: Consolas, monospace; }.event-log b { overflow: hidden; color: #7698a2; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }.event-log b.ok { color: #5edda8; }.event-log b.warn { color: #eabf67; }

.playback-panel { position: absolute; right: 14px; bottom: 10px; left: 14px; z-index: 2; height: 50px; display: flex; align-items: center; gap: 10px; padding: 0 14px; border: 1px solid var(--line); background: rgba(3, 23, 37, .94); box-sizing: border-box; }
.transport { width: 28px; height: 28px; padding: 0; border: 1px solid rgba(64, 190, 222, .45); color: #70def3; background: rgba(11, 70, 90, .35); cursor: pointer; }
.transport.reset { color: #85aab4; border-color: rgba(86, 137, 149, .3); }
.playback-panel time { width: 48px; color: #8bb4bf; font: 10px Consolas, monospace; text-align: center; }
.timeline-wrap { position: relative; flex: 1; }
.timeline-wrap input { position: relative; z-index: 2; width: 100%; height: 3px; margin: 0; accent-color: #43cee9; cursor: pointer; }
.timeline-events { position: absolute; inset: 50% 5px auto; z-index: 1; }
.timeline-events i { position: absolute; top: -4px; width: 2px; height: 9px; background: #f2b557; box-shadow: 0 0 6px rgba(242, 181, 87, .6); }
.speed-control { display: flex; align-items: center; gap: 6px; color: #7196a0; font-size: 10px; }
.speed-control select { padding: 3px 5px; border: 1px solid rgba(67, 155, 178, .28); color: #bfe5eb; font-size: 10px; background: #071e2c; }

@media (max-width: 1280px) {
  .fusion-grid { grid-template-columns: minmax(460px, 1.35fr) minmax(330px, 1fr) 235px; }
  .target-card { padding: 8px; }
  .metric-ring { width: 90px; height: 90px; margin: 10px auto 6px; }
  .metric-ring::before { width: 78px; height: 78px; }
  .metric-ring strong { font-size: 22px; }
}

@media (max-height: 760px) {
  .fusion-toolbar { height: 52px; }
  .fusion-grid { inset: 62px 12px 66px; }
  .target-card { margin-top: 8px; }
  .metric-ring { width: 76px; height: 76px; margin: 7px auto 4px; }
  .metric-ring::before { width: 65px; height: 65px; }
  .metric-ring strong { font-size: 19px; }
  .telemetry-list div { padding: 4px 0; }
  .control-group { margin-top: 7px; }
  .event-log { margin-top: 7px; }
}
.panel-header h2{font-size:15px;font-weight:600;letter-spacing:.5px}
</style>
