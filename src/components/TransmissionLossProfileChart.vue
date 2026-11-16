<!--
  TransmissionLossProfileChart.vue
  ==========================================
  距离 - 深度 TL 伪彩图（方位剖面），可叠加白色波前声线动画。

  展示当前方位的「距离 - 深度」剖面：
   - 主体：TL 伪彩热力图（颜色 = TL dB，60~120 dB，与体渲染色标一致）；
   - 参考线：声源深度（黄色虚线）；
   - 地形：海底地形线 + 海底以下区域着色（仅 `tlrd` 标准格式自带
     `altitudeList.pairedDataVS[row].y`，经 `model.seabedFor()` 取海深，向下为正）；
   - 右侧：TL 色标（120 dB ~ 60 dB）。

  声线轨迹由同级的「声线展示图」组件单独呈现（见 SoundRayChart.vue），
  两者共用 utils/soundProfileModel.js 的数据解析。

  数据源：`tlrd`（response_Analyse3DTLRD.json），标准三维声场格式。

  方位约定：0° = 正东、逆时针为正（与体渲染切面 / 方位指针一致）。
-->
<template>
  <div class="ray-profile">
    <header class="rp-head">
      <span class="rp-title">{{ chartTitle }}</span>
      <span
        v-if="showSeabedMask"
        class="rp-bottom-status"
        :class="bottomStatusClass"
        :title="bottomStatusTitle"
      >{{ bottomStatusText }}</span>
      <span class="rp-tag">{{ Math.round(displayAzimuth(selectedAzimuth)) }}°</span>
      <!-- <button
        type="button"
        class="rp-toggle"
        :title="open ? '收起' : '展开'"
        @click="toggleOpen"
      >
        {{ open ? '▾' : '▴' }}
      </button> -->
    </header>

    <div v-show="open" class="rp-body">
      <div class="rp-chart-wrap" :class="{ 'is-placing-receiver': receiverPlacementEnabled }" :style="{ height }">
        <div ref="chartEl" class="rp-chart"></div>
        <RayFlowOverlay ref="rayOverlay" :flow="rayFlow" :geometry="rayGeometry" :viewport="rayViewport" :playing="raysPlaying" :visible="raysVisible" :static-mode="staticRays && !animated" :show-static-tracks="staticRays" show-time />
        <div
          v-for="marker in markerReadouts"
          :key="marker.id"
          class="rp-readout-marker"
          :class="{ 'flip-left': markerPositions[marker.id]?.flip }"
          :style="markerPositions[marker.id] || { display: 'none' }"
        >
          <span class="rp-readout-cross" aria-hidden="true"></span>
          <span class="rp-readout-card">
            <span class="rp-readout-line">
              <svg class="rp-readout-pin" viewBox="0 0 24 32" aria-hidden="true">
                <path :d="READOUT_PIN_PATH" fill="currentColor" />
              </svg>
              <b>{{ marker.label }}</b>
              <strong>{{ marker.metricLabel }} {{ marker.valueText }} {{ marker.unit }}</strong>
            </span>
            <span class="rp-readout-location">{{ marker.positionText }}</span>
          </span>
        </div>
        <button
          v-if="zoomedIn"
          type="button"
          class="rp-zoom-reset"
          title="复位缩放"
          aria-label="复位缩放"
          @click="resetView"
        >
          <i aria-hidden="true">↻</i>{{ zoomFactor.toFixed(1) }}X
        </button>
        <div v-if="receiverPlacementEnabled" class="rp-placement-tip">在剖面中单击接收阵中心</div>
        <span
          v-if="receiverHandlePos && !receiverInteractive"
          class="rp-readout-marker rp-receiver-reference"
          :style="receiverHandlePos"
          aria-label="接收水听器位置"
        ><span class="rp-readout-cross" aria-hidden="true"></span></span>
        <button
          v-if="receiverHandlePos && receiverInteractive"
          type="button"
          class="rp-receiver-handle"
          :class="{ dragging: receiverDragging }"
          :style="receiverHandlePos"
          title="拖动调整接收水听器位置"
          @pointerdown="onReceiverPointerDown"
          @pointermove="onReceiverPointerMove"
          @pointerup="onReceiverPointerUp"
          @pointercancel="onReceiverPointerCancel"
        ><span class="rp-readout-cross" aria-hidden="true"></span></button>
        <div v-if="!profile.colCount" class="rp-empty">
          {{ data ? '当前方位无有效剖面数据' : '尚未加载声场数据' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated, onBeforeUnmount, nextTick } from 'vue'
import echarts from '@/plugins/echarts.js'
import { internalAzimuthToCompassBearing } from '@/sdk'
import {
  activeVolumeColorStops,
  volumeRenderingControls,
} from '@/modules/acoustic/volumeRenderingControls.js'
import {
  normalize360,
  nearestIndex,
  buildProfileModel,
  nearestAzimuthRow,
  distanceColumns,
  profileAxisGeometry,
  fmtDist,
  niceStep,
} from '@/utils/soundProfileModel.js'

const READOUT_PIN_PATH = 'M12 1C6.5 1 2 5.5 2 11c0 7.5 10 20 10 20s10-12.5 10-20C22 5.5 17.5 1 12 1Zm0 13.5A4.5 4.5 0 1 1 12 5.5a4.5 4.5 0 0 1 0 9Z'
import {
  DEFAULT_BOTTOM_ACOUSTICS,
  DEFAULT_BOTTOM_LABEL,
  bottomTypeAcousticProperties,
  bottomTypeColor,
  bottomTypeLabel,
} from '@/utils/bottomTypeModel.js'
import RayFlowOverlay from './RayFlowOverlay.vue'
import { resolveRayFlow, rayChartViewport } from '@/utils/rayFlow.js'
import { parseAnalyse2DRtrd } from '@/sdk/ncFieldModel.js'
import {
  SIGNAL_EXCESS_COLOR_STOPS,
  resolveSignalExcessDepthRange,
  resolveSignalExcessOffset,
  signalExcessValueForTl,
} from '@/utils/signalExcess.js'

const props = defineProps({
  /** 声场原始数据（tlrd JSON） */
  data: { type: Object, default: null },
  /** 当前方位的真实声线；无声线时不从 TL 场编造波前。 */
  rayData: { type: Object, default: null },
  animated: { type: Boolean, default: true },
  /** 静态声线开关：动态关闭时仍绘制完整声线路径 */
  staticRays: { type: Boolean, default: false },
  /** 数据源类型：'tlrd' */
  sourceId: { type: String, default: 'tlrd' },
  /** 当前方位角（度，0 = 正东，逆时针为正），支持 v-model:azimuth-deg */
  azimuthDeg: { type: Number, default: 0 },
  /** 最大传播距离（米，0 = 使用数据全部距离） */
  maxRadiusM: { type: Number, default: 0 },
  /** 沿航线的底质分段：{ startM, endM, id, label }[] */
  bottomTypeSegments: { type: Array, default: () => [] },
  /** 底质查询状态：idle | loading | ready | error */
  bottomTypeState: { type: String, default: 'idle' },
  /** 图表高度 */
  height: { type: String, default: '240px' },
  /** 已标注的接收阵中心：{ rangeM, depthM } */
  receiverMarker: { type: Object, default: null },
  /** 接收点是否允许在图内拖动；地形垂直切面仅显示水听器标注。 */
  receiverInteractive: { type: Boolean, default: true },
  /** 海底地形线 + 底质掩膜（Display[1]）显隐；关闭时海底以下填入 dB 最大值颜色 */
  showSeabed: { type: Boolean, default: true },
  /** 海底底质掩膜（Display[2]）显隐；关闭后下方显示 dB 最大值颜色 */
  showSeabedMask: { type: Boolean, default: true },
  /** 光标读取开关：开启后悬停显示 TL / 距离 / 深度，否则不显示 */
  readoutEnabled: { type: Boolean, default: true },
  /** 开启后点击剖面会在该位置保留 R1/R2… 读数标记（垂直切面使用）。 */
  clickMarkers: { type: Boolean, default: false },
  /** 颜色范围下限（dB），用于二维传播损失的独立色带 */
  dbMin: { type: Number, default: 60 },
  /** 颜色范围上限（dB），用于二维传播损失的独立色带 */
  dbMax: { type: Number, default: 120 },
  /** 信号余量参数；非空时剖面绘制该方位的 SE/Pd，而不是 TL。 */
  signalExcess: { type: Object, default: null },
  /** 开启后，单击剖面会回传接收阵中心 */
  receiverPlacementEnabled: { type: Boolean, default: false },
  /** 父视图从 KeepAlive 恢复时递增，用于强制重绘 */
  refreshToken: { type: Number, default: 0 },
})

const emit = defineEmits(['update:azimuthDeg', 'select-receiver'])

/** 信号余量参数：仅当 NL 有效时启用 SE/Pd 剖面。 */
const seParams = computed(() => {
  const params = props.signalExcess
  return params && Number.isFinite(Number(params.noiseLevel)) ? params : null
})
const seActive = computed(() => Boolean(seParams.value))
const sePdMode = computed(() => seParams.value?.displayMode === 'pd')
const valueLabel = computed(() => (seActive.value ? (sePdMode.value ? 'Pd' : 'SE') : 'TL'))
const valueUnit = computed(() => (seActive.value && sePdMode.value ? '%' : 'dB'))
const chartTitle = computed(() => `距离 - 深度 ${valueLabel.value} 伪彩图`)

/** 点击光标读取后保留的 R1/R2… 读数标记。 */
const readoutMarkers = ref([])
const markerPositions = ref({})
let nextMarkerId = 1
const markerReadouts = computed(() => {
  const se = seParams.value
  return readoutMarkers.value.map((marker, index) => {
    const value = se
      ? signalExcessValueForTl(marker.rawTl, se)
      : marker.rawTl
    const numeric = Number(value)
    const decimals = se && !sePdMode.value ? 1 : se ? 1 : 0
    return {
      ...marker,
      label: `R${index + 1}`,
      metricLabel: se ? valueLabel.value : 'TL',
      valueText: Number.isFinite(numeric) ? numeric.toFixed(decimals) : '—',
      unit: se ? valueUnit.value : 'dB',
      positionText: `${formatMarkerRange(marker.rangeM)}, ${Math.round(marker.depthM)}m`,
    }
  })
})

const chartEl = ref(null)
const open = ref(true)
/** 距离轴（X 轴）刻度最小单位（米，0 = 按可见范围自动） */
const tickUnitM = ref(0)
/** 可选刻度单位：自动 / 200m…100km */
const tickUnitOptions = [0, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
/** 当前 X 轴缩放窗口（百分比，0~100）：支持左右滑动 / 滚轮缩放 */
const zoom = ref({ start: 0, end: 100 })
/** 自动模式下解析出的刻度步长（米） */
const autoTickStep = ref(0)
/** 是否已放大（偏离完整距离范围），用于显示「复位缩放」回退标 */
const zoomedIn = computed(() => zoom.value.start > 0.001 || zoom.value.end < 99.999)
/** 当前放大倍数（完整范围 = 1.0X） */
const zoomFactor = computed(() => Math.max(1, 100 / Math.max(1e-6, zoom.value.end - zoom.value.start)))

let chart = null
let renderPending = true
let smoothTextureProfile = null
let smoothTextureRange = ''
let smoothTextureCanvas = null
let resizeObserver = null
const rayOverlay = ref(null)
const raysVisible = ref(true)
const raysPlaying = ref(true)
const rayFlow = computed(() => {
  if (!props.rayData || (!props.animated && !props.staticRays)) return null
  const paths = parseAnalyse2DRtrd(props.rayData)?.rays ?? []
  return resolveRayFlow(props.rayData, paths)
})
const rayGeometry = computed(() => profileAxisGeometry(model.value, rowIndex.value, props.maxRadiusM))
function rayViewport() {
  return rayChartViewport(chart, profile.value.dists, profile.value.axisDepths, true, 36, 16)
}
const receiverHandlePos = ref(null)
const receiverDragging = ref(false)
let receiverPointerId = null
let receiverEmitFrame = 0
let lastReceiverEmitAt = 0
let pendingReceiverPoint = null

/* ────────────────────────────── 通用工具 ────────────────────────────── */

/**
 * 方位显示换算：剖面模型内部使用「正东 0°、逆时针」，而界面上统一显示
 * 「正北 0°、顺时针」的罗盘方位（与地球上的剖面帘 / 参数摘要一致）。
 */
function displayAzimuth(deg) {
  return internalAzimuthToCompassBearing(Number(deg) || 0)
}

/** 深度轴刻度文案：抹掉浮点噪声（如 279.99 → 280），无小数时不留尾数 */
function fmtDepth(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  const r = Math.round(n)
  if (Math.abs(n - r) < 0.05) return String(r)
  return String(Math.round(n * 10) / 10)
}

/* ────────────────────────────── 数据模型 ────────────────────────────── */

/** 统一剖面模型（tlrd，见 utils/soundProfileModel.js） */
const model = computed(() => buildProfileModel(props.data, props.sourceId))

/** 当前方位（数据行）下标：取与目标方位最接近的一行 */
const rowIndex = computed(() => nearestAzimuthRow(model.value, props.azimuthDeg))

/** 当前生效的方位角（吸附到数据行） */
const selectedAzimuth = computed(() => {
  const m = model.value
  return m?.azimuths?.[rowIndex.value] ?? normalize360(props.azimuthDeg)
})

/**
 * 当前方位的剖面数据（仅 TL 伪彩，不含声线）：
 *   dists  每个参与渲染的 col 对应的距离（米）
 *   depths 深度轴
 *   heat   heatmap 数据 [列下标, 深度下标, TL]
 */
const profile = computed(() => {
  const m = model.value
  if (!m)
    return {
      dists: [],
      cols: [],
      depths: [],
      axisDepths: [],
      heat: [],
      seabed: [],
      hasSeabed: false,
      seabedMin: 0,
      seabedMax: 0,
      tlDepthMax: 0,
      tlDepthMaxIndex: 0,
      hasUncoveredWater: false,
      colCount: 0,
      depthMax: 0,
      maxDistanceM: 0,
      seabedDerived: false,
    }

  const row = rowIndex.value
  // 距离类目（X 轴）：该方位有效距离范围内的 col
  const colEntries = distanceColumns(m, row, props.maxRadiusM)
  const maps = new Map(colEntries.map((c, i) => [c.col, i]))
  const dists = colEntries.map((c) => Math.round(c.dist * 10) / 10)
  const geometry = profileAxisGeometry(m, row, props.maxRadiusM)

  // 伪彩：普通模式为 TL；信号余量模式按该方位 TL 换算 SE/Pd，并裁剪到目标深度区间。
  const se = seParams.value
  const seOffset = se ? resolveSignalExcessOffset(se) : NaN
  const seRange = se ? resolveSignalExcessDepthRange(se, m.depths) : null
  const heat = []
  for (let d = 0; d < m.depths.length; d++) {
    const depthValue = Number(m.depths[d])
    if (seRange && !(depthValue >= seRange.low && depthValue <= seRange.high)) continue
    for (const { col } of colEntries) {
      const tl = m.tlAt(row, d, col)
      if (!Number.isFinite(tl)) continue
      const v = se ? signalExcessValueForTl(tl, se, seOffset) : tl
      if (!Number.isFinite(v)) continue
      heat.push([maps.get(col), d, Math.round(v * 10) / 10])
    }
  }

  // 深度轴（类目）：用于声线深度定位（深度值 → 类目下标）
  const depthVals = m.depths.map((d) => (Number.isFinite(d) ? d : 0))

  // 海底地形（海深，米，向下为正）：标准格式 tlrd 由 altitudeList.pairedDataVS 提供，
  // 其余数据源 seabedFor 返回空数组。这里直接使用物理距离/深度，确保与声线图坐标完全一致。
  const seabedVals = typeof m.seabedFor === 'function' ? m.seabedFor(row) : []
  const rawSeabed = []
  let seabedDerived = false
  let seabedMin = Infinity
  let seabedMax = -Infinity
  if (Array.isArray(seabedVals) && seabedVals.length) {
    colEntries.forEach((entry, i) => {
      const depthM = Number(seabedVals[entry.col])
      if (!Number.isFinite(depthM) || depthM <= 0) return
      rawSeabed.push([i, Math.round(depthM * 10) / 10])
      if (depthM < seabedMin) seabedMin = depthM
      if (depthM > seabedMax) seabedMax = depthM
    })
  }

  // 某些三维结果不带 altitudeList，或海底数组与距离列长度不一致。此时从每一
  // 距离列最后一个有效 TL 网格推断水体下边界，使海底线和底质掩膜仍可见。
  if (rawSeabed.length < 2 && colEntries.length >= 2) {
    rawSeabed.length = 0
    seabedMin = Infinity
    seabedMax = -Infinity
    colEntries.forEach((entry, i) => {
      let deepest = -Infinity
      for (let d = 0; d < m.depths.length; d++) {
        if (!Number.isFinite(m.tlAt(row, d, entry.col))) continue
        const depthM = Number(m.depths[d])
        if (Number.isFinite(depthM) && depthM > deepest) deepest = depthM
      }
      if (!(deepest > 0)) return
      rawSeabed.push([i, Math.round(deepest * 10) / 10])
      seabedMin = Math.min(seabedMin, deepest)
      seabedMax = Math.max(seabedMax, deepest)
    })
    seabedDerived = rawSeabed.length >= 2
  }

  // 为海底掩膜保留稳定的可视厚度：深海时向深度轴下方扩展约 24%，浅海时
  // 再由自定义掩膜限制最大厚度。物理水深、TL 值和接收阵约束仍使用原始深度。
  const axisDepths = [...depthVals]
  if (axisDepths.length >= 2 && Number.isFinite(seabedMax)) {
    const positiveSteps = axisDepths.slice(1).map((value, i) => Number(value) - Number(axisDepths[i])).filter((value) => value > 0)
    const step = positiveSteps.length ? positiveSteps.reduce((sum, value) => sum + value, 0) / positiveSteps.length : 1
    const currentMax = Math.max(...axisDepths.map(Number).filter(Number.isFinite))
    const targetMax = Math.max(currentMax, seabedMax / 0.76)
    for (let depth = currentMax + step; depth <= targetMax + step * 0.5; depth += step) axisDepths.push(depth)
  }
  const seabed = rawSeabed.map(([i, depthM]) => [i, nearestIndex(axisDepths, depthM), depthM])
  const finiteTlDepths = depthVals.map(Number).filter(Number.isFinite)
  const tlDepthMax = finiteTlDepths.length ? Math.max(...finiteTlDepths) : 0
  const tlDepthMaxIndex = axisDepths.length ? nearestIndex(axisDepths, tlDepthMax) : 0
  // altitudeList 的海底深度可能大于后端 profile.z 的最大 TL 深度。该区域是
  // “水体存在但没有 TL 采样”，不是海底掩膜，也不是前端 depthBottomIndex 截断。
  const hasUncoveredWater = Number.isFinite(seabedMax) && seabedMax > tlDepthMax + 1e-6

  return {
    dists,
    cols: colEntries.map((entry) => entry.col),
    depths: depthVals,
    axisDepths,
    heat,
    seabed,
    hasSeabed: seabed.length >= 2,
    seabedMin: Number.isFinite(seabedMin) ? seabedMin : 0,
    seabedMax: Number.isFinite(seabedMax) ? seabedMax : 0,
    tlDepthMax,
    tlDepthMaxIndex,
    hasUncoveredWater,
    colCount: colEntries.length,
    depthMax: geometry.maxDepthM,
    maxDistanceM: geometry.maxDistanceM,
    seabedDerived,
  }
})

/** 当前距离列的海底深度（米）：用于阻止接收阵被拖到海底以下。 */
function seabedDepthAtIndex(index) {
  const entries = profile.value.seabed
  if (!entries.length) return Infinity
  let before = null
  let after = null
  for (const entry of entries) {
    if (entry[0] <= index && (!before || entry[0] >= before[0])) before = entry
    if (entry[0] >= index && (!after || entry[0] <= after[0])) after = entry
  }
  if (before && after && before[0] !== after[0]) {
    const ratio = (index - before[0]) / (after[0] - before[0])
    return before[2] + (after[2] - before[2]) * ratio
  }
  return (before ?? after)?.[2] ?? Infinity
}

/**
 * 把剖面下标转成接收阵位置：
 * - 距离保留 5% 余量，避免阵元展开后落到 Bellhop 场边缘之外；
 * - 深度限制在该距离的海底之上，避免通信计算报“海底以下/无有效 TL”。
 */
function receiverFromIndices(distanceIndex, depthIndex) {
  const p = profile.value
  if (!p.colCount || !p.dists.length || !p.depths.length) return null
  const last = p.dists.length - 1
  const safeLast = Math.max(0, Math.floor(last * 0.95))
  const rangeIndex = Math.max(0, Math.min(safeLast, Math.round(Number(distanceIndex))))
  let depthIdx = Math.max(0, Math.min(p.depths.length - 1, Math.round(Number(depthIndex))))
  let depthM = Number(p.depths[depthIdx])
  const seabedDepth = seabedDepthAtIndex(rangeIndex)
  if (Number.isFinite(seabedDepth) && depthM > seabedDepth - 1) {
    depthM = Math.max(0, seabedDepth - 1)
    depthIdx = nearestIndex(p.depths, depthM)
    depthM = Number(p.depths[depthIdx])
  }
  const rangeM = Number(p.dists[rangeIndex])
  if (!Number.isFinite(rangeM) || !Number.isFinite(depthM)) return null
  return {
    rangeM,
    depthM,
    azimuthDeg: Number(selectedAzimuth.value) || 0,
  }
}

/**
 * 把底质距离分段映射到当前 TL 距离列。掩膜作为 ECharts 自定义系列绘制，
 * 因而会自然跟随 dataZoom，不再额外占用图表下方空间。
 */
const bottomMaskSegments = computed(() => {
  const dists = profile.value.dists
  if (dists.length < 2) return []
  const axisMin = Number(dists[0])
  const axisMax = Number(dists[dists.length - 1])
  if (!Number.isFinite(axisMin) || !Number.isFinite(axisMax) || axisMax <= axisMin) return []
  const queried = Array.isArray(props.bottomTypeSegments) ? props.bottomTypeSegments : []
  const segments = queried.length
    ? queried
    : [{
        startM: axisMin,
        endM: axisMax,
        id: 0,
        fallback: true,
      }]
  const out = []
  for (const segment of segments) {
    const startM = Math.max(axisMin, Number(segment.startM))
    const endM = Math.min(axisMax, Number(segment.endM))
    if (!(endM > startM)) continue
    const id = Number(segment.id) || 0
    const isDefaultBottom = id <= 0 || segment.fallback
    const label = isDefaultBottom
      ? DEFAULT_BOTTOM_LABEL
      : (segment.label || bottomTypeLabel(id))
    const acoustics = isDefaultBottom
      ? {
          ...DEFAULT_BOTTOM_ACOUSTICS,
          ...Object.fromEntries(
            Object.entries(bottomTypeAcousticProperties(segment))
              .filter(([, value]) => value != null)
          ),
        }
      : bottomTypeAcousticProperties(segment)
    out.push({
      key: `${segment.startM}-${segment.endM}-${segment.id}`,
      startM,
      endM,
      startIndex: nearestIndex(dists, startM),
      endIndex: nearestIndex(dists, endM),
      id,
      label,
      color: bottomTypeColor(segment.id),
      acoustics,
      title: `${label} · ${fmtNm(startM)} ~ ${fmtNm(endM)}`,
      fallback: !!segment.fallback || isDefaultBottom,
    })
  }
  return out
})

const bottomStatusClass = computed(() => ({
  'is-loading': props.bottomTypeState === 'loading',
  'is-error': props.bottomTypeState === 'error',
  'is-fallback': !props.bottomTypeSegments?.length || profile.value.seabedDerived,
}))

const bottomStatusText = computed(() => {
  if (!profile.value.hasSeabed) return '海底边界缺测'
  if (props.bottomTypeState === 'loading') return '底质参数加载中…'
  const first = bottomMaskSegments.value[0]
  if (!first) return '底质参数缺测'
  const p = first.acoustics || {}
  const prefix = props.bottomTypeState === 'error'
    ? '底质接口失败 · 默认掩膜'
    : `${bottomMaskSegments.value.length} 段 · ${first.label}`
  return `${prefix} · Cp ${fmtBottomValue(p.cp, 0)} · αp ${fmtBottomValue(p.alphaP, 3)} · ρ ${fmtBottomValue(p.density, 1)}`
})

const bottomStatusTitle = computed(() => {
  const notes = []
  if (profile.value.seabedDerived) notes.push('结果未提供海底高程，当前边界由每列最后一个有效 TL 网格推断。')
  if (profile.value.hasUncoveredWater) {
    notes.push(
      `后端 TL 深度网格最大到 ${fmt(profile.value.tlDepthMax)} m，海底最大深度为 ${fmt(profile.value.seabedMax)} m；中间水层没有 TL 采样，当前仅按色标最大 dB 颜色补齐显示，原始 TL 数据未修改。`
    )
  }
  if (props.bottomTypeState === 'error') notes.push('底质接口请求失败，当前使用默认底质颜色。')
  const detail = bottomMaskSegments.value.map((segment) => `${segment.title}\n${bottomMaskLabel(segment)}`).join('\n\n')
  return [...notes, detail].filter(Boolean).join('\n')
})

function bottomSegmentStyle(segment) {
  const dists = profile.value.dists
  if (dists.length < 2) return { display: 'none' }
  const axisMin = Number(dists[0])
  const axisMax = Number(dists[dists.length - 1])
  const fullRange = axisMax - axisMin
  const visibleMin = axisMin + fullRange * (Number(zoom.value.start) || 0) / 100
  const visibleMax = axisMin + fullRange * (Number(zoom.value.end) || 100) / 100
  const visibleRange = Math.max(1e-6, visibleMax - visibleMin)
  const start = Math.max(visibleMin, Number(segment.startM))
  const end = Math.min(visibleMax, Number(segment.endM))
  if (!(end > start)) return { display: 'none' }
  return {
    left: `${((start - visibleMin) / visibleRange) * 100}%`,
    width: `${((end - start) / visibleRange) * 100}%`,
    background: segment.color,
  }
}

/**
 * 类目轴「整齐刻度」方案：返回抽稀间隔 k 与取整步长 step。
 * 用 `axisLabel.interval = i => i % k === 0` + `formatter` 取整成
 * 100/500/1000 这类整数，位置仍是真实数据位置（热力图不变）。
 */
function niceTickPlan(values, targetTicks) {
  const a = (Array.isArray(values) ? values : []).map(Number).filter((v) => Number.isFinite(v))
  if (a.length < 2) return { step: 1, k: 1 }
  const max = a[a.length - 1]
  const step = niceStep(max / targetTicks)
  const spacing = (max - a[0]) / (a.length - 1)
  return { step, k: Math.max(1, Math.round(step / Math.max(1e-6, spacing))) }
}

const NM_PER_M = 1 / 1852
/** 距离（米）→ 海里文案 */
function fmtNm(meters) {
  const n = Number(meters) * NM_PER_M
  if (!Number.isFinite(n)) return ''
  return `${n.toFixed(n >= 10 ? 0 : 1)} nm`
}
/** 距离（米）→ 海里数值（无单位，用于坐标刻度，与纵轴刻度形式保持一致） */
function fmtNmValue(meters) {
  const n = Number(meters) * NM_PER_M
  if (!Number.isFinite(n)) return ''
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)
}
/** 距离轴按「整海里」取步长（step 仍换算为米，用于类目抽稀定位） */
function nmTickPlan(valuesMeters, targetTicks) {
  const a = (Array.isArray(valuesMeters) ? valuesMeters : []).map(Number).filter((v) => Number.isFinite(v))
  if (a.length < 2) return { step: 1, k: 1 }
  const maxNm = a[a.length - 1] * NM_PER_M
  const step = niceStep(Math.max(maxNm, 1) / targetTicks) * 1852
  const spacing = (a[a.length - 1] - a[0]) / (a.length - 1)
  return { step, k: Math.max(1, Math.round(step / Math.max(1e-6, spacing))) }
}

/* ────────────────────────────── 图表渲染 ────────────────────────────── */

/** 垂直切面的 TL 色标类型跟随三维体绘制的色图（bellhop / viridis / jet…）。 */
const tlColorStops = computed(() => activeVolumeColorStops(volumeRenderingControls.colormap))

/** 当前色带：TL 使用与体绘制相同的色图；信号余量模式使用发散 SE/Pd 色标。 */
function valueColorStopsSource() {
  return seActive.value ? SIGNAL_EXCESS_COLOR_STOPS : tlColorStops.value
}

/** 色带 CSS 颜色列表（供 ECharts visualMap 使用）。 */
function valueColorStops() {
  return valueColorStopsSource().map(([, rgb]) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`)
}

/** 连续色标采样；直接读取已规范化的常量色标，避免在大网格热循环中反复分配。 */
function sampleDisplayTlColor(value) {
  const stops = valueColorStopsSource()
  const x = Math.max(0, Math.min(1, Number(value) || 0))
  for (let index = 0; index < stops.length - 1; index++) {
    const [start, startColor] = stops[index]
    const [end, endColor] = stops[index + 1]
    if (x > end && index < stops.length - 2) continue
    const ratio = Math.max(0, Math.min(1, (x - start) / Math.max(1e-6, end - start)))
    return [
      startColor[0] + (endColor[0] - startColor[0]) * ratio,
      startColor[1] + (endColor[1] - startColor[1]) * ratio,
      startColor[2] + (endColor[2] - startColor[2]) * ratio,
    ]
  }
  return stops[stops.length - 1][1]
}

/**
 * 把原始 TL 网格映射到离屏纹理，再由 Canvas 双线性缩放为连续伪彩表面。
 * 这里只改变显示采样；原始 TL 数组、色标范围和光标读数均保持不变。
 */
function createSmoothTlTexture(profileData) {
  const modeKey = seActive.value ? (sePdMode.value ? 'pd' : 'se') : 'tl'
  const schemeKey = seActive.value ? '' : volumeRenderingControls.colormap
  const rangeKey = `${modeKey}:${schemeKey}:${props.dbMin}:${props.dbMax}`
  if (smoothTextureCanvas && smoothTextureProfile === profileData && smoothTextureRange === rangeKey) {
    return smoothTextureCanvas
  }
  const width = profileData.dists.length
  const height = profileData.depths.length
  if (width < 1 || height < 1 || typeof document === 'undefined') return null

  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const sourceContext = source.getContext('2d')
  if (!sourceContext) return null
  const pixels = sourceContext.createImageData(width, height)
  const min = Number(props.dbMin)
  const max = Math.max(min + 1e-6, Number(props.dbMax))
  for (const point of profileData.heat) {
    const x = Number(point?.[0])
    const y = Number(point?.[1])
    const value = Number(point?.[2])
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isFinite(value)) continue
    if (x < 0 || x >= width || y < 0 || y >= height) continue
    const [r, g, b] = sampleDisplayTlColor((value - min) / (max - min))
    const offset = (y * width + x) * 4
    pixels.data[offset] = Math.round(r)
    pixels.data[offset + 1] = Math.round(g)
    pixels.data[offset + 2] = Math.round(b)
    pixels.data[offset + 3] = 255
  }
  sourceContext.putImageData(pixels, 0, 0)

  const target = document.createElement('canvas')
  target.width = Math.min(2048, Math.max(512, width * 4))
  target.height = Math.min(1024, Math.max(256, height * 4))
  const targetContext = target.getContext('2d')
  if (!targetContext) return source
  targetContext.imageSmoothingEnabled = true
  targetContext.imageSmoothingQuality = 'high'
  targetContext.clearRect(0, 0, target.width, target.height)
  targetContext.drawImage(source, 0, 0, target.width, target.height)

  smoothTextureProfile = profileData
  smoothTextureRange = rangeKey
  smoothTextureCanvas = target
  return target
}

function fmtBottomValue(value, digits = 2) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number(number.toFixed(digits)).toString()
}

function bottomMaskLabel(segment) {
  const p = segment.acoustics || {}
  const porosity = Number(p.porosity)
  const porosityPct = Number.isFinite(porosity) ? (Math.abs(porosity) <= 1.5 ? porosity * 100 : porosity) : null
  return [
    segment.label,
    `Cp=${fmtBottomValue(p.cp, 0)} m/s`,
    `Alpha_p=${fmtBottomValue(p.alphaP, 3)} dB/λ`,
    `density=${fmtBottomValue(p.density, 1)} kg/m³`,
    `porosity=${fmtBottomValue(porosityPct, 1)} %`,
    `thickness=${fmtBottomValue(p.thickness, 1)} m`,
  ].join('\n')
}

function seabedCategoryAt(profileData, index) {
  const entries = profileData.seabed
  if (!entries.length) return profileData.axisDepths.length - 1
  let before = null
  let after = null
  for (const entry of entries) {
    if (entry[0] <= index && (!before || entry[0] >= before[0])) before = entry
    if (entry[0] >= index && (!after || entry[0] <= after[0])) after = entry
  }
  if (before && after && before[0] !== after[0]) {
    const ratio = (index - before[0]) / (after[0] - before[0])
    return before[1] + (after[1] - before[1]) * ratio
  }
  return (before ?? after)?.[1] ?? profileData.axisDepths.length - 1
}

/**
 * 后端 TL 深度轴浅于独立海底高程时，TL 最深层与海底之间会露出图表背景。
 * 这里只在显示层用色标最大 dB 颜色覆盖“未采样水层”；不向 heat 写入伪数据，
 * 不影响原始 TL、色标范围、tooltip、接收阵深度或后续声学计算。
 */
function createUncoveredWaterSeries(profileData) {
  if (!profileData.hasSeabed || !profileData.hasUncoveredWater || profileData.dists.length < 2) return null
  const start = 0
  const end = profileData.dists.length - 1
  const top = Math.max(0, Number(profileData.tlDepthMaxIndex) || 0)
  const stops = valueColorStops()
  const fillColor = stops[stops.length - 1]
  return {
    name: 'TL 未覆盖水层',
    type: 'custom',
    coordinateSystem: 'cartesian2d',
    data: [[start, end]],
    silent: true,
    animation: false,
    clip: true,
    z: 0.9,
    renderItem(_params, api) {
      const topPoints = []
      const bottomPoints = []
      const step = Math.max(1, Math.ceil((end - start) / 48))
      const indices = []
      for (let i = start; i <= end; i += step) indices.push(i)
      if (indices[indices.length - 1] !== end) indices.push(end)
      for (const index of indices) {
        const bottom = Math.max(top, seabedCategoryAt(profileData, index))
        topPoints.push(api.coord([index, top]))
        bottomPoints.push(api.coord([index, bottom]))
      }
      const points = [...topPoints, ...bottomPoints.reverse()]
      if (points.length < 4) return null
      return {
        type: 'polygon',
        shape: { points },
        style: { fill: fillColor, opacity: 1, stroke: 'transparent', lineWidth: 0 },
      }
    },
  }
}

/**
 * 海底底质掩膜：沿真实海底线一直填充到图表底部，与参考图一致；深海仍通过
 * 扩展显示轴保留最小可视空间，不再在底质颜色下方留下黑色空隙。
 */
function createBottomMaskSeries(profileData) {
  const segments = bottomMaskSegments.value
  if (!profileData.hasSeabed || !segments.length) return null
  const axisLast = Math.max(1, profileData.axisDepths.length - 1)
  return {
    name: '海底底质',
    type: 'custom',
    coordinateSystem: 'cartesian2d',
    data: segments.map((segment) => ({
      value: [segment.startIndex, segment.endIndex, segment.id],
      segment,
    })),
    z: 2,
    animation: false,
    renderItem(params, api) {
      const segment = segments[params.dataIndex]
      if (!segment) return null
      const start = Math.max(0, Math.min(profileData.dists.length - 1, segment.startIndex))
      const end = Math.max(start, Math.min(profileData.dists.length - 1, segment.endIndex))
      const topPoints = []
      const bottomPoints = []
      const step = Math.max(1, Math.ceil((end - start) / 36))
      const indices = []
      for (let i = start; i <= end; i += step) indices.push(i)
      if (indices[indices.length - 1] !== end) indices.push(end)
      for (const index of indices) {
        const top = seabedCategoryAt(profileData, index)
        topPoints.push(api.coord([index, top]))
        bottomPoints.push(api.coord([index, axisLast]))
      }
      const polygonPoints = [...topPoints, ...bottomPoints.reverse()]
      if (polygonPoints.length < 4) return null
      const firstTop = topPoints[0]
      const firstBottom = bottomPoints[bottomPoints.length - 1]
      const midIndex = Math.round((start + end) / 2)
      const midTopCategory = seabedCategoryAt(profileData, midIndex)
      const midBottomCategory = axisLast
      const midTop = api.coord([midIndex, midTopCategory])
      const midBottom = api.coord([midIndex, midBottomCategory])
      const left = api.coord([start, midTopCategory])[0]
      const right = api.coord([end, midTopCategory])[0]
      const width = Math.abs(right - left)
      const height = Math.abs(midBottom[1] - midTop[1])
      const children = [
        {
          type: 'polygon',
          shape: { points: polygonPoints },
          style: { fill: segment.color, opacity: 0.96, stroke: 'rgba(3,7,10,0.42)', lineWidth: 0.7 },
        },
        {
          type: 'line',
          shape: { x1: firstTop[0], y1: firstTop[1], x2: firstBottom[0], y2: firstBottom[1] },
          style: { stroke: 'rgba(241,245,249,0.9)', lineWidth: 1.1 },
        },
      ]
      if (width >= 94 && height >= 38) {
        children.push({
          type: 'text',
          style: {
            x: midTop[0],
            y: (midTop[1] + midBottom[1]) / 2,
            text: bottomMaskLabel(segment),
            align: 'center',
            verticalAlign: 'middle',
            fill: '#f8fafc',
            stroke: 'rgba(0,0,0,0.72)',
            lineWidth: 2,
            font: '600 8px ui-monospace, SFMono-Regular, Consolas, monospace',
            lineHeight: 10,
            overflow: 'truncate',
            width: Math.max(20, width - 8),
          },
        })
      }
      return { type: 'group', children }
    },
  }
}

/**
 * 海底掩膜填充（Display[1] 关闭时）：把海底线以下原掩膜区域填成 dB 范围最大值
 * 对应的颜色（与 visualMap 上限一致），用于在隐藏海底线+掩膜时保留地形的直观示意。
 */
function createSeabedFillSeries(profileData) {
  if (!profileData.hasSeabed) return null
  const dists = profileData.dists
  if (!dists || dists.length < 2) return null
  const axisLast = Math.max(1, profileData.axisDepths.length - 1)
  const fillColor = valueColorStops()[valueColorStops().length - 1]
  return {
    name: '海底掩膜填充',
    type: 'custom',
    coordinateSystem: 'cartesian2d',
    data: [{ value: [0, dists.length - 1] }],
    z: 1.5,
    animation: false,
    renderItem(params, api) {
      const start = 0
      const end = dists.length - 1
      const topPoints = []
      const bottomPoints = []
      const step = Math.max(1, Math.ceil((end - start) / 36))
      const indices = []
      for (let i = start; i <= end; i += step) indices.push(i)
      if (indices[indices.length - 1] !== end) indices.push(end)
      for (const index of indices) {
        const top = seabedCategoryAt(profileData, index)
        topPoints.push(api.coord([index, top]))
        bottomPoints.push(api.coord([index, axisLast]))
      }
      const polygonPoints = [...topPoints, ...bottomPoints.reverse()]
      if (polygonPoints.length < 4) return null
      return {
        type: 'group',
        children: [
          {
            type: 'polygon',
            shape: { points: polygonPoints },
            style: { fill: fillColor, opacity: 1, stroke: 'rgba(3,7,10,0.42)', lineWidth: 0.7 },
          },
        ],
      }
    },
  }
}

/** 当前缩放窗口内的距离跨度（米） */
function visibleDistSpan() {
  const d = profile.value.dists
  if (!d || d.length < 2) return 0
  const last = d.length - 1
  const i0 = Math.max(0, Math.min(last, Math.floor((zoom.value.start / 100) * last)))
  const i1 = Math.max(i0, Math.min(last, Math.ceil((zoom.value.end / 100) * last)))
  return Math.max(0, d[i1] - d[i0])
}

/** X 轴刻度步长（米）：手动单位优先，否则按可见跨度自动取约 10 个刻度 */
function currentTickStep() {
  if (Number(tickUnitM.value) > 0) return Number(tickUnitM.value)
  const step = niceStep(visibleDistSpan() / 10)
  autoTickStep.value = step
  return step
}

/**
 * X 轴类目标签抽稀：每个「刻度步长」区间只保留第一个刻度。
 * 与缩放窗口无关，因此左右滑动 / 缩放后刻度依然按真实距离对齐。
 */
function makeTickInterval(dists) {
  const step = currentTickStep()
  return (idx) => {
    if (idx <= 0) return true
    const prev = dists[idx - 1]
    const cur = dists[idx]
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) return false
    return Math.floor(cur / step) > Math.floor(prev / step)
  }
}

/** 缩放 / 平移事件：同步窗口，并在自动刻度步长变化时刷新 */
function onDataZoom() {
  const dz = chart?.getOption()?.dataZoom?.[0]
  if (!dz) return
  const start = Number(dz.start)
  const end = Number(dz.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  zoom.value = { start, end }
  if (!(Number(tickUnitM.value) > 0)) {
    const step = niceStep(visibleDistSpan() / 10)
    if (step !== autoTickStep.value) {
      autoTickStep.value = step
      renderChart()
    }
  }
  updateReceiverHandlePos()
  updateMarkerPositions()
  rayOverlay.value?.repaint()
}

/** 把 ECharts 轴坐标还原为数据下标（类目轴通常返回下标，数值轴返回真实值）。 */
function axisIndexFromPixel(value, list) {
  const number = Number(value)
  if (!Number.isFinite(number) || !list.length) return -1
  const rounded = Math.round(number)
  if (rounded >= 0 && rounded < list.length && Math.abs(number - rounded) < 0.01) return rounded
  return nearestIndex(list, number)
}

/** 重新定位接收阵拖动热区；缩放 / 平移 / 标记变化后都需要更新。 */
function updateReceiverHandlePos() {
  const p = profile.value
  const marker = props.receiverMarker
  if (!chart || !p.colCount || !marker) {
    receiverHandlePos.value = null
    return
  }
  const rangeM = Number(marker.rangeM)
  const depthM = Number(marker.depthM)
  if (!Number.isFinite(rangeM) || !Number.isFinite(depthM)) {
    receiverHandlePos.value = null
    return
  }
  const distanceIndex = nearestIndex(p.dists, rangeM)
  const depthIndex = nearestIndex(p.depths, depthM)
  const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [distanceIndex, depthIndex])
  if (!Array.isArray(pixel) || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) {
    receiverHandlePos.value = null
    return
  }
  receiverHandlePos.value = { left: `${pixel[0]}px`, top: `${pixel[1]}px` }
}

/** 距离读数统一显示海里（nm）。 */
function formatMarkerRange(rangeM) {
  const value = Number(rangeM)
  if (!Number.isFinite(value)) return '—'
  const nm = value * NM_PER_M
  return `${nm.toFixed(nm >= 10 ? 0 : 1)}nm`
}

function clearReadoutMarkers() {
  if (!readoutMarkers.value.length && !Object.keys(markerPositions.value).length) return
  readoutMarkers.value = []
  markerPositions.value = {}
}

/** 缩放 / 平移 / 尺寸变化后，重新把标记换算成容器像素。 */
function updateMarkerPositions() {
  if (!chart || !chartEl.value || !readoutMarkers.value.length) {
    if (Object.keys(markerPositions.value).length) markerPositions.value = {}
    return
  }
  const width = chartEl.value.clientWidth
  const height = chartEl.value.clientHeight
  const next = {}
  for (const marker of readoutMarkers.value) {
    const pixel = chart.convertToPixel(
      { xAxisIndex: 0, yAxisIndex: 0 },
      [marker.distanceIndex, marker.depthIndex],
    )
    if (!Array.isArray(pixel) || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) continue
    if (pixel[0] < 0 || pixel[0] > width || pixel[1] < 0 || pixel[1] > height) continue
    next[marker.id] = {
      left: `${pixel[0]}px`,
      top: `${pixel[1]}px`,
      flip: pixel[0] > width - 170,
    }
  }
  markerPositions.value = next
}

/** 点击剖面内部（海底掩膜线上方）时，在该位置保留一条读数标记。 */
function addReadoutMarkerFromEvent(event) {
  if (!props.readoutEnabled || !props.clickMarkers || props.receiverPlacementEnabled) return
  if (!chart || !chartEl.value) return
  const p = profile.value
  if (!p.colCount || !p.depths.length) return
  const x = Number(event?.offsetX ?? event?.zrX)
  const y = Number(event?.offsetY ?? event?.zrY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  if (!chart.containPixel({ gridIndex: 0 }, [x, y])) return
  const pixel = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [x, y])
  if (!Array.isArray(pixel)) return
  const distanceIndex = axisIndexFromPixel(pixel[0], p.dists)
  const depthIndex = axisIndexFromPixel(pixel[1], p.depths)
  if (distanceIndex < 0 || distanceIndex >= p.dists.length) return
  if (depthIndex < 0 || depthIndex >= p.depths.length) return
  const depthM = Number(p.depths[depthIndex])
  const rangeM = Number(p.dists[distanceIndex])
  if (!Number.isFinite(depthM) || !Number.isFinite(rangeM)) return
  const seabedDepth = seabedDepthAtIndex(distanceIndex)
  if (Number.isFinite(seabedDepth) && depthM >= seabedDepth) return
  const col = p.cols?.[distanceIndex]
  const rawTl = model.value?.tlAt(rowIndex.value, depthIndex, col)
  if (!Number.isFinite(rawTl)) return
  if (readoutMarkers.value.some(marker => (
    marker.distanceIndex === distanceIndex && marker.depthIndex === depthIndex
  ))) return
  readoutMarkers.value = [...readoutMarkers.value, {
    id: nextMarkerId++,
    distanceIndex,
    depthIndex,
    rangeM,
    depthM,
    rawTl,
  }]
  updateMarkerPositions()
}

function onChartZrClick(event) {
  addReadoutMarkerFromEvent(event)
}

function receiverPointFromEvent(event) {
  if (!chart || !chartEl.value) return null
  const p = profile.value
  if (!p.colCount) return null
  const rect = chartEl.value.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return null
  const pixel = chart.convertFromPixel(
    { xAxisIndex: 0, yAxisIndex: 0 },
    [event.clientX - rect.left, event.clientY - rect.top],
  )
  if (!Array.isArray(pixel)) return null
  const distanceIndex = axisIndexFromPixel(pixel[0], p.dists)
  const depthIndex = axisIndexFromPixel(pixel[1], p.depths)
  return receiverFromIndices(distanceIndex, depthIndex)
}

function queueReceiverPoint(point, force = false) {
  if (!point) return
  pendingReceiverPoint = point
  const now = performance.now()
  if (!force && now - lastReceiverEmitAt < 90) return
  if (receiverEmitFrame) return
  receiverEmitFrame = requestAnimationFrame(() => {
    receiverEmitFrame = 0
    if (!pendingReceiverPoint) return
    lastReceiverEmitAt = performance.now()
    emit('select-receiver', pendingReceiverPoint)
    pendingReceiverPoint = null
  })
}

function onReceiverPointerDown(event) {
  if (!receiverHandlePos.value) return
  receiverDragging.value = true
  receiverPointerId = event.pointerId
  event.currentTarget.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
}

function onReceiverPointerMove(event) {
  if (!receiverDragging.value || event.pointerId !== receiverPointerId) return
  queueReceiverPoint(receiverPointFromEvent(event))
  event.preventDefault()
  event.stopPropagation()
}

function onReceiverPointerUp(event) {
  if (!receiverDragging.value || event.pointerId !== receiverPointerId) return
  receiverDragging.value = false
  receiverPointerId = null
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  queueReceiverPoint(receiverPointFromEvent(event), true)
  event.preventDefault()
  event.stopPropagation()
}

function onReceiverPointerCancel() {
  if (!receiverDragging.value) return
  receiverDragging.value = false
  receiverPointerId = null
  pendingReceiverPoint = null
}

/** 标注模式下，把 ECharts 类目坐标还原为真实距离 / 深度。 */
function onChartClick(params) {
  if (!props.receiverPlacementEnabled) return
  const value = params?.value
  if (!Array.isArray(value)) return
  const point = receiverFromIndices(value[0], value[1])
  if (point) emit('select-receiver', point)
}

/** 复位：恢复完整距离范围 + 自动刻度 */
function resetView() {
  zoom.value = { start: 0, end: 100 }
  tickUnitM.value = 0
  autoTickStep.value = 0
  renderChart()
}

async function renderChart() {
  const p = profile.value
  await nextTick()
  if (!chartEl.value) return
  if (!p.colCount) {
    chart?.clear()
    receiverHandlePos.value = null
    renderPending = false
    return
  }
  if (!chartEl.value.clientWidth || !chartEl.value.clientHeight) {
    renderPending = true
    return
  }
  if (!chart) {
    chart = echarts.init(chartEl.value)
    chart.on('datazoom', onDataZoom)
    chart.on('click', onChartClick)
    chart.getZr().on('click', onChartZrClick)
  }

  // 整齐刻度方案（抽稀间隔 + 取整步长）；距离轴按整海里取步长
  const xPlan = nmTickPlan(p.dists, 6)
  const yPlan = niceTickPlan(p.axisDepths, 6)

  // 底图保持静态；声线由独立 Canvas 叠加，避免逐帧重绘热力图。
  const smoothTlTexture = createSmoothTlTexture(p)
  const series = [
    {
      name: 'TL',
      type: 'heatmap',
      data: p.heat,
      progressive: 0,
      animation: false,
      // 原始网格仅保留命中测试和数值读取；可视颜色由下方连续纹理承担。
      itemStyle: { opacity: 0, borderWidth: 0, borderColor: 'transparent' },
      emphasis: { disabled: true },
      z: 2,
    },
  ]

  if (smoothTlTexture) {
    series.push({
      name: 'TL 连续纹理',
      type: 'custom',
      coordinateSystem: 'cartesian2d',
      data: [[0, 0]],
      silent: true,
      animation: false,
      clip: true,
      z: 1,
      renderItem(_params, api) {
        const lastX = Math.max(0, p.dists.length - 1)
        const lastY = Math.max(0, p.depths.length - 1)
        const first = api.coord([0, 0])
        const last = api.coord([lastX, lastY])
        const cellSize = api.size([1, 1])
        const halfWidth = Math.abs(Number(cellSize?.[0]) || 0) / 2
        const halfHeight = Math.abs(Number(cellSize?.[1]) || 0) / 2
        const left = Math.min(first[0], last[0]) - halfWidth
        const top = Math.min(first[1], last[1]) - halfHeight
        return {
          type: 'image',
          style: {
            image: smoothTlTexture,
            x: left,
            y: top,
            width: Math.abs(last[0] - first[0]) + halfWidth * 2,
            height: Math.abs(last[1] - first[1]) + halfHeight * 2,
          },
        }
      },
    })
  }

  const uncoveredWaterSeries = createUncoveredWaterSeries(p)
  if (uncoveredWaterSeries) series.push(uncoveredWaterSeries)

  const bottomMaskSeries = props.showSeabed && props.showSeabedMask ? createBottomMaskSeries(p) : null
  if (bottomMaskSeries) series.push(bottomMaskSeries)

  // 任一海底掩膜开关关闭时，不再显示掩膜材质；海底以下统一使用 dB 最大值颜色。
  const seabedFillSeries = !props.showSeabed || !props.showSeabedMask ? createSeabedFillSeries(p) : null
  if (seabedFillSeries) series.push(seabedFillSeries)

  // 海底地形：白色实线；其下的底质掩膜由自定义系列按稳定比例绘制。
  if (p.hasSeabed && props.showSeabed) {
    series.push({
      name: '海底地形',
      type: 'line',
      data: p.seabed,
      showSymbol: false,
      smooth: false,
      z: 3,
      lineStyle: { color: 'rgba(241,245,249,0.95)', width: 1.6 },
      itemStyle: { color: '#f1f5f9' },
      emphasis: { disabled: true },
    })
  }


  chart.setOption(
    {
      backgroundColor: '#0b2545',
      animation: false,
      tooltip: {
        show: props.readoutEnabled,
        trigger: 'item',
        backgroundColor: 'rgba(2,6,23,0.92)',
        borderColor: 'rgba(59,130,246,0.5)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params) => {
          const val = params?.value
          const az = displayAzimuth(selectedAzimuth.value)
          if (params?.seriesType === 'heatmap') {
            const [ci, di, value] = val
            return `方位 ${az.toFixed(1)}°<br/>距离 ${fmtNm(p.dists[ci] ?? 0)}<br/>深度 ${(p.depths[di] ?? 0).toFixed(2)} m<br/>${valueLabel.value} ${Number(value).toFixed(1)} ${valueUnit.value}`
          }
          if (params?.seriesName === '海底地形') {
            const [ci, , depthM] = val
            return `海底地形<br/>方位 ${az.toFixed(1)}°<br/>距离 ${fmtNm(p.dists[ci] ?? 0)}<br/>海深 ${Number(depthM).toFixed(1)} m`
          }
          if (params?.seriesName === '海底底质') {
            const segment = params?.data?.segment
            if (!segment) return ''
            return `${bottomMaskLabel(segment).replaceAll('\n', '<br/>')}<br/>距离 ${fmtNm(segment.startM)} ~ ${fmtNm(segment.endM)}`
          }
          return ''
        },
      },
      grid: { left: 62, right: 16, top: 16, bottom: 36 },
      // 热力图必须用类目轴；用 interval 抽稀 + formatter 取整，得到 100/500/1000 这类
      // 整齐刻度，位置仍是真实数据位置；声线图使用同一数值范围即可逐点对应。
      xAxis: {
        type: 'category',
        name: '距离（nm）',
        nameLocation: 'middle',
        nameGap: 26,
        data: p.dists,
        boundaryGap: true,
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 9,
          hideOverlap: true,
          interval: (index) => index % xPlan.k === 0,
          formatter: (v) => fmtNmValue(Math.round(Number(v) / xPlan.step) * xPlan.step),
        },
        splitLine: { show: false },
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
      },
      yAxis: {
        type: 'category',
        name: '深度（m）',
        nameLocation: 'middle',
        nameGap: 44,
        data: p.axisDepths.map(fmtDepth),
        boundaryGap: true,
        inverse: true,
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 9,
          hideOverlap: true,
          interval: (index) => index % yPlan.k === 0,
          formatter: (_v, index) => {
            const d = Number(p.axisDepths[index])
            return Number.isFinite(d) ? String(Math.round(d / yPlan.step) * yPlan.step) : ''
          },
        },
        splitLine: { show: false },
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
      },
      visualMap: {
        show: false,
        min: props.dbMin,
        max: props.dbMax,
        seriesIndex: 0,
        calculable: false,
        orient: 'vertical',
        right: 6,
        top: 'middle',
        itemWidth: 12,
        itemHeight: 130,
        text: [`${props.dbMax} ${valueUnit.value}`, `${props.dbMin} ${valueUnit.value}`],
        textGap: 6,
        textStyle: { color: '#cbd5e1', fontSize: 9 },
        inRange: { color: valueColorStops() },
      },
      // 距离轴缩放 / 平移：inside（滚轮缩放 + 按住拖拽平移），无底部滑块
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          start: zoom.value.start,
          end: zoom.value.end,
        },
      ],
      series,
    },
    { notMerge: true }
  )
  chart.resize()
  renderPending = false
  updateReceiverHandlePos()
  updateMarkerPositions()
  rayOverlay.value?.repaint()
}

/** 常驻窗口重新显示时只恢复尺寸；仅在隐藏期间数据有更新时补做一次渲染。 */
async function refreshLayout() {
  await nextTick()
  if (!chartEl.value?.clientWidth || !chartEl.value?.clientHeight) return
  if (!chart || renderPending) await renderChart()
  else {
    chart.resize()
    updateReceiverHandlePos()
    updateMarkerPositions()
    rayOverlay.value?.repaint()
  }
}

defineExpose({ refreshLayout })

function toggleOpen() {
  open.value = !open.value
  if (open.value) nextTick(() => renderChart())
}

watch(
  () => [
    props.data,
    props.sourceId,
    props.azimuthDeg,
    props.toleranceDeg,
    props.maxRadiusM,
    props.bottomTypeSegments,
    props.bottomTypeState,
    props.showSeabed,
    props.showSeabedMask,
    props.readoutEnabled,
    props.dbMin,
    props.dbMax,
    volumeRenderingControls.colormap,
    props.signalExcess,
    props.receiverMarker,
    props.receiverPlacementEnabled,
    props.refreshToken,
    tickUnitM.value,
  ],
  () => renderChart()
)

// 切换方位 / 声场数据时旧的读数标记已失去意义；关闭读数开关时也一并清除。
watch(
  () => [props.data, props.sourceId, props.azimuthDeg],
  () => clearReadoutMarkers()
)
watch(
  () => [props.readoutEnabled, props.clickMarkers],
  () => {
    if (!props.readoutEnabled || !props.clickMarkers) clearReadoutMarkers()
  }
)

onMounted(() => {
  renderChart()
  if (typeof ResizeObserver !== 'undefined' && chartEl.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!open.value) return
      chart?.resize()
      updateReceiverHandlePos()
      updateMarkerPositions()
      rayOverlay.value?.repaint()
    })
    resizeObserver.observe(chartEl.value)
  }
})

onActivated(async () => {
  // KeepAlive 恢复时容器从 display:none 重新显示，必须重绘并同步尺寸。
  await nextTick()
  chart?.resize()
  await renderChart()
})

onBeforeUnmount(() => {
  if (receiverEmitFrame) cancelAnimationFrame(receiverEmitFrame)
  receiverEmitFrame = 0
  receiverPointerId = null
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.ray-profile {
  display: flex;
  flex-direction: column;
  background: rgba(10, 18, 35, 0.9);
  border: 1px solid rgba(59, 130, 246, 0.45);
  /* border-radius: 10px; */
  color: #e5e7eb;
  /* 地球交互时 backdrop-filter 会让大面积图表逐帧重新模糊 WebGL 画布。 */
  backdrop-filter: none;
  overflow: hidden;
}

.rp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: linear-gradient(180deg, rgba(30, 64, 175, 0.45), rgba(15, 23, 42, 0.3));
  border-bottom: 1px solid rgba(59, 130, 246, 0.25);
}

.rp-title {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: #dbeafe;
  letter-spacing: 0.5px;
}

.rp-tag {
  flex: none;
  margin-left: auto;
  font-size: 10px;
  color: #93c5fd;
  white-space: nowrap;
}

.rp-toggle {
  flex: none;
  width: 18px;
  height: 18px;
  line-height: 1;
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 4px;
  cursor: pointer;
}

.rp-toggle:hover {
  background: rgba(51, 65, 85, 0.95);
}

.rp-body {
  padding: 6px 8px 8px;
}

.rp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rp-lbl {
  font-size: 11px;
  color: #cbd5e1;
  white-space: nowrap;
}

.rp-select {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  font-size: 11px;
  color: #e5e7eb;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 4px;
  outline: none;
}

.rp-select-sm {
  flex: 0 0 84px;
}

.rp-btn {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.rp-btn:hover {
  background: rgba(51, 65, 85, 0.95);
  color: #e5e7eb;
}

.rp-tip {
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
}

/* 海底地形图例（仅标准格式 tlrd 有地形数据时出现） */
.rp-seabed-legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #cbd5e1;
  white-space: nowrap;
}

.rp-seabed-swatch {
  flex: none;
  width: 14px;
  height: 9px;
  border-radius: 2px;
  box-sizing: border-box;
  background: rgba(100, 116, 139, 0.5);
  border-top: 2px solid rgba(241, 245, 249, 0.95);
}

.rp-bottom-status {
  flex: 1;
  min-width: 0;
  max-width: none;
  overflow: hidden;
  color: #67e8f9;
  font-size: 9px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rp-bottom-status.is-error {
  color: #fca5a5;
}

.rp-bottom-status.is-loading {
  color: #fde68a;
}

.rp-bottom-status.is-fallback:not(.is-error) {
  color: #cbd5e1;
}

.rp-chart-wrap {
  position: relative;
  width: 100%;
}

.rp-chart-wrap.is-placing-receiver .rp-chart {
  cursor: crosshair;
}

.rp-placement-tip {
  position: absolute;
  z-index: 9;
  top: 8px;
  left: 50%;
  padding: 4px 10px;
  color: #dffbff;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
  border: 1px solid rgba(32, 224, 255, 0.7);
  border-radius: 12px;
  background: rgba(4, 49, 68, 0.9);
  transform: translateX(-50%);
  box-shadow: 0 0 14px rgba(32, 224, 255, 0.25);
}

.rp-chart {
  position: absolute;
  inset: 0;
}

/* 缩放回退标：滚轮放大后出现，显示放大倍数，点击复位到完整距离范围 */
.rp-zoom-reset {
  position: absolute;
  z-index: 9;
  top: 8px;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  color: #08304a;
  font: 700 11px ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: 0.3px;
  white-space: nowrap;
  border: 1px solid rgba(125, 211, 252, 0.9);
  border-radius: 999px;
  background: #bae6fd;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(2, 6, 23, 0.35);
  transform: translateX(-50%);
}

.rp-zoom-reset i {
  font-style: normal;
  font-size: 13px;
  line-height: 1;
}

.rp-zoom-reset:hover {
  background: #d3f0ff;
  border-color: #7dd3fc;
}

/* 点击读数标记：十字准星固定在被点击位置，右侧保留 R1/R2… 信息卡 */
.rp-readout-marker {
  position: absolute;
  z-index: 7;
  width: 20px;
  height: 20px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.rp-readout-cross {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(235, 250, 255, 0.95);
  border-radius: 50%;
  background: rgba(3, 20, 35, 0.28);
  box-shadow: 0 0 8px rgba(32, 224, 255, 0.6);
}

.rp-readout-cross::before,
.rp-readout-cross::after {
  content: '';
  position: absolute;
  background: #3be6ff;
  box-shadow: 0 0 4px rgba(59, 230, 255, 0.8);
}

.rp-readout-cross::before {
  left: -5px;
  right: -5px;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
}

.rp-readout-cross::after {
  top: -5px;
  bottom: -5px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
}

.rp-readout-card {
  position: absolute;
  left: 20px;
  top: 50%;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 7px;
  white-space: nowrap;
  color: #7fa5b8;
  border: 1px solid rgba(74, 190, 220, 0.95);
  border-radius: 3px;
  background: rgba(4, 18, 32, 0.94);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
  font: 9px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace;
  transform: translateY(-50%);
}

.rp-readout-marker.flip-left .rp-readout-card {
  left: auto;
  right: 20px;
}

.rp-receiver-reference {
  z-index: 9;
}

.rp-readout-line {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rp-readout-pin {
  flex: none;
  width: 9px;
  height: 12px;
  color: #ff7ea8;
}

.rp-readout-line b,
.rp-readout-line strong {
  color: #5ce6ff;
  font-weight: 700;
}

.rp-readout-location {
  color: #7f9fb1;
}

/* 接收点拖动热区：沿用切面点击读数的十字准星，拖动后实时回传距离/深度。 */
.rp-receiver-handle {
  position: absolute;
  z-index: 8;
  width: 34px;
  height: 34px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  transform: translate(-50%, -50%);
  cursor: grab;
  touch-action: none;
}

.rp-receiver-handle .rp-readout-cross {
  inset: 7px;
}

.rp-receiver-handle.dragging {
  cursor: grabbing;
}

.rp-receiver-handle.dragging .rp-readout-cross {
  background: rgba(32, 224, 255, 0.28);
  box-shadow: 0 0 16px rgba(32, 224, 255, 0.85);
}

.rp-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #94a3b8;
}


</style>
