<!--
  SoundRayChart.vue
  ==========================================
  声线展示图（距离 - 深度）**独立组件**：单独呈现当前方位的声线轨迹，
  与「距离-深度 TL 伪彩图」并列展示，两者共用 utils/soundProfileModel.js 的数据解析。

  内容：
   - 声线轨迹（优先级）：① 当前 TL 扇面对应的 `rayData`（`Analyse2DRTRD`，
     父级按当前方位独立计算并缓存）；
     ② 其余数据源回退为沿距离列追踪 TL 极小值深度的近似声线；
   - 参考：声源位置（黄色点）、声源深度（黄色虚线）、海底（灰色虚线）；
   - 距离轴支持滚轮缩放 / 按住拖拽左右滑动，可「复位」。

  方位约定：0° = 正东、逆时针为正（与体渲染切面 / 方位指针一致）。
-->
<template>
  <div class="ray-chart">
    <div class="rc-body">
      <div class="rc-toolbar">
        <span class="rc-lbl">声线方位</span>
        <span v-if="hasPortalRays" class="rc-select rc-current-azimuth">
          {{ Math.round(displayAzimuth(selectedAzimuth)) }}°
        </span>
        <select
          v-else
          class="rc-select"
          :value="selectedAzimuth"
          :disabled="!azimuthOptions.length"
          @change="onAzimuthSelect"
        >
          <option v-for="(a, i) in azimuthOptions" :key="`${a}-${i}`" :value="a">
            {{ Math.round(displayAzimuth(a)) }}°
          </option>
        </select>
        <span class="rc-count">共 {{ rayResult.paths.length }} 条</span>
        <button
          v-if="rayFlow"
          type="button"
          class="rc-btn"
          :title="animationPlaying ? '暂停声线动画' : '播放声线动画'"
          @click="toggleAnimation"
        >
          {{ animationPlaying ? '暂停' : '播放' }}
        </button>
        <button type="button" class="rc-btn" title="恢复完整距离范围" @click="resetView">复位</button>
        <button
          type="button"
          class="rc-btn"
          :title="earthRaysVisible ? '隐藏地球剖面帘和三维声场体上的声线' : '在地球剖面帘和三维声场体上显示声线'"
          @click="emit('update:earthRaysVisible', !earthRaysVisible)"
        >
          {{ earthRaysVisible ? '声线隐藏' : '声线显示' }}
        </button>
      </div>

      <div class="rc-chart-wrap" :style="{ height }">
        <div ref="chartEl" class="rc-chart"></div>
        <RayFlowOverlay ref="rayOverlay" :flow="rayFlow" :geometry="profileGeometry" :viewport="rayViewport" :playing="animationPlaying" />
        <div v-if="!rayPaths.length && !rayFlow" class="rc-empty">
          {{ data ? '当前方位无有效声线数据' : '尚未加载声场数据' }}
        </div>
        <div v-if="hasBottomTypeBar" class="rc-bottom-strip">
          <span class="rc-bottom-strip-title">海底底质</span>
          <div class="rc-bottom-strip-track">
            <div
              v-for="seg in visibleBottomTypeSegments"
              :key="seg.key"
              class="rc-bottom-seg"
              :style="{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%`, background: seg.color }"
              :title="seg.title"
            >
              <span v-if="seg.showLabel" :style="{ color: seg.textColor }">{{ seg.label }}</span>
            </div>
            <span v-if="bottomTypeState === 'loading'" class="rc-bottom-hint">底质加载中…</span>
            <span v-else-if="bottomTypeState === 'error'" class="rc-bottom-hint">底质数据不可用</span>
            <span v-else-if="!visibleBottomTypeSegments.length" class="rc-bottom-hint">默认</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated, onBeforeUnmount, nextTick } from 'vue'
import echarts from '@/plugins/echarts.js'
import {
  normalize360,
  nearestIndex,
  buildProfileModel,
  nearestAzimuthRow,
  distanceColumns,
  collectRayPaths,
  profileAxisGeometry,
  clipRayPathsByProfile,
  fmtDist,
  niceStep,
} from '@/utils/soundProfileModel.js'
import RayFlowOverlay from './RayFlowOverlay.vue'
import { resolveRayFlow, rayChartViewport } from '@/utils/rayFlow.js'
import { internalAzimuthToCompassBearing } from '@/sdk'
import { bottomTypeColor, bottomTypeLabel } from '@/utils/bottomTypeModel.js'

const props = defineProps({
  /** 声场原始数据：tlrd JSON */
  data: { type: Object, default: null },
  /**
   * 当前方位声线数据：`Analyse2DRTRD` 二维声线返回数据。
   * 父级在方位改变时传入对应方位的新结果。
  */
  rayData: { type: Object, default: null },
  /** true 时当前方位接口未返回前保持空图，不用 TL 极小值生成替代声线。 */
  portalRaysOnly: { type: Boolean, default: false },
  /** 数据源类型：'tlrd' */
  sourceId: { type: String, default: 'tlrd' },
  /** 当前方位角（度，0 = 正东，逆时针为正），支持 v-model:azimuth-deg */
  azimuthDeg: { type: Number, default: 0 },
  /** 声线方位匹配容差（度），保留兼容 */
  toleranceDeg: { type: Number, default: 1 },
  /** 最大传播距离（米，0 = 使用数据全部距离） */
  maxRadiusM: { type: Number, default: 0 },
  /** 回退模式下生成的近似声线条数 */
  rayCount: { type: Number, default: 10 },
  /** 声源深度（米）：用于绘制声源位置与深度参考线 */
  sourceDepthM: { type: Number, default: NaN },
  /** 地球上的剖面帘是否叠加声线（由「剖面隐藏/显示」按钮控制） */
  earthRaysVisible: { type: Boolean, default: true },
  /** 是否播放动态声线动画（后端动态接口 / 本地帧构建） */
  animated: { type: Boolean, default: true },
  /** 沿航线的底质分段：{ startM, endM, id, label }[] */
  bottomTypeSegments: { type: Array, default: () => [] },
  /** 底质查询状态：idle | loading | ready | error */
  bottomTypeState: { type: String, default: 'idle' },
  /** 图表高度 */
  height: { type: String, default: '230px' },
  /** 父视图从 KeepAlive 恢复时递增，用于强制重绘 */
  refreshToken: { type: Number, default: 0 },
})

const emit = defineEmits(['update:azimuthDeg', 'update:earthRaysVisible'])

const chartEl = ref(null)
const open = ref(true)
/** 当前 X 轴缩放窗口（百分比，0~100） */
const zoom = ref({ start: 0, end: 100 })
let chart = null
let resizeObserver = null
const animationPlaying = ref(true)
const rayOverlay = ref(null)
function rayViewport() {
  return rayChartViewport(chart, distAxis.value, depthAxis.value, false, hasBottomTypeBar.value ? 78 : 52)
}

/** 方位显示换算：内部「正东 0°、逆时针」→ 界面罗盘方位「正北 0°、顺时针」 */
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

// rayData：当前 TL 扇面对应的二维声线返回数据
const model = computed(() =>
  buildProfileModel(props.data, { source: props.sourceId, rayData: props.rayData })
)
const azimuthOptions = computed(() => model.value?.azimuths ?? [])
const rowIndex = computed(() => nearestAzimuthRow(model.value, props.azimuthDeg))
/** 是否使用门户按当前方位实算的真实声线 */
const hasPortalRays = computed(() => Array.isArray(model.value?.rayPaths) && model.value.rayPaths.length > 0)

/** 当前生效的方位角（吸附到数据行） */
const selectedAzimuth = computed(() => {
  const m = model.value
  return m?.azimuths?.[rowIndex.value] ?? normalize360(props.azimuthDeg)
})

/** 声线轨迹：[[[距离m, 深度m], ...], ...] */
const rayResult = computed(() => {
  if (props.portalRaysOnly && !props.rayData) return { paths: [], real: false }
  return collectRayPaths(model.value, {
    rowIndex: rowIndex.value,
    azimuth: selectedAzimuth.value,
    toleranceDeg: props.toleranceDeg,
    maxRadiusM: props.maxRadiusM,
    rayCount: props.rayCount,
  })
})

/** 与左侧 TL 图完全相同的距离、深度和当前方位海底地形。 */
const profileGeometry = computed(() => profileAxisGeometry(model.value, rowIndex.value, props.maxRadiusM))

/** 声线在当前 TL 剖面的陆地、海底以下及共同坐标范围之外全部裁掉。 */
const rayPaths = computed(() => clipRayPathsByProfile(rayResult.value.paths, profileGeometry.value))
/** 是否为真实 Bellhop 声线（否则为近似声线） */
const realRays = computed(() => rayResult.value.real)

/** 从原始路径采样后再裁剪，不能把裁剪后各段当作新声源重新发射。 */
const rayFlow = computed(() => {
  if (!props.animated) return null
  const paths = rayResult.value.paths
  return resolveRayFlow(props.rayData, paths)
})
const displayRayPaths = computed(() => rayFlow.value ? [] : rayPaths.value)

/** 声源深度（米），无效时回落到模型自带值（静态声线取第一条声线起点深度），仍无效返回 NaN */
const srcDepth = computed(() => {
  const v = Number(props.sourceDepthM)
  if (Number.isFinite(v)) return v
  const fromModel = Number(model.value?.sourceDepthM)
  return Number.isFinite(fromModel) ? fromModel : NaN
})

/** 声线来源标签（当前方位门户声线 / 真实 Bellhop / TL 极小值近似） */
const raySourceTag = computed(() => {
  if (hasPortalRays.value) return 'Analyse2D 当前方位声线'
  return realRays.value ? 'Bellhop 真实声线' : 'TL 极小值近似声线'
})

/**
 * 声线使用**真实数值坐标**绘制（保持实际声线的平滑曲线），
 * 但轴范围与左侧 TL 伪彩图的类目轴中心对齐：
 * TL 图为类目轴时，第 i 个刻度位于 (i+0.5)/n 处；把数值轴的 min/max
 * 分别外扩「半个类目间距」，数值 d[i] 便落在相同位置。
 */
const distAxis = computed(() =>
  distanceColumns(model.value, rowIndex.value, props.maxRadiusM).map((c) => Math.round(c.dist * 10) / 10)
)
const depthAxis = computed(() =>
  (Array.isArray(model.value?.depths) ? model.value.depths : []).map((d) =>
    Number.isFinite(Number(d)) ? Number(d) : 0
  )
)
/** 数值轴取值范围：0 ~ 数据最大值（与 TL 图共用同一范围） */
function axisMax(axis) {
  const a = (Array.isArray(axis) ? axis : []).map(Number).filter(Number.isFinite)
  return Math.max(1, a.length ? a[a.length - 1] : 1)
}
const xMaxM = computed(() => axisMax(distAxis.value))
const yMaxM = computed(() => axisMax(depthAxis.value))
const NM_PER_M = 1 / 1852
/** 距离（米）→ 海里文案 */
function fmtNm(meters) {
  const n = Number(meters) * NM_PER_M
  if (!Number.isFinite(n)) return ''
  return `${n.toFixed(n >= 10 ? 0 : 1)} nm`
}
/** 距离轴按「整海里」取步长（如 5 nm/10 nm），再换算回米作为 interval */
const xTickStep = computed(() => {
  const a = distAxis.value.map(Number).filter((v) => Number.isFinite(v))
  if (a.length < 2) return undefined
  const maxNm = a[a.length - 1] * NM_PER_M
  return niceStep(Math.max(maxNm, 1) / 6) * 1852
})
/** 深度轴与 TL 图使用同一步长，保证上下两图刻度一一对应 */
const yTickStep = computed(() => {
  const a = depthAxis.value.map(Number).filter((v) => Number.isFinite(v))
  if (a.length < 2) return undefined
  return niceStep(Math.max(a[a.length - 1], 1) / 6)
})

/** 海底地形：保持物理坐标，轴外扩后与 TL 图海底线对齐 */
const terrainSeriesData = computed(() =>
  profileGeometry.value.seabedSamples.map(([distance, depth]) => [
    Number(distance),
    Number.isFinite(depth) ? Number(depth) : null,
  ])
)

/** 是否需要为底部底质条预留空间。 */
const hasBottomTypeBar = computed(() => {
  const state = String(props.bottomTypeState || '')
  return state === 'loading' || state === 'ready' || state === 'error'
})

/** 当前缩放窗口内可见的底质分段（与数值距离轴 / dataZoom 同步）。 */
const visibleBottomTypeSegments = computed(() => {
  const segments = Array.isArray(props.bottomTypeSegments) ? props.bottomTypeSegments : []
  const axisMax = Number(xMaxM.value)
  if (!segments.length || !(axisMax > 0)) return []
  const zoomStart = Math.max(0, Math.min(100, Number(zoom.value.start) || 0))
  const zoomEnd = Math.max(0, Math.min(100, Number(zoom.value.end) || 100))
  const visibleStart = (axisMax * zoomStart) / 100
  const visibleEnd = (axisMax * zoomEnd) / 100
  const span = Math.max(1e-6, visibleEnd - visibleStart)
  const out = []
  for (const segment of segments) {
    const startM = Math.max(visibleStart, Number(segment.startM))
    const endM = Math.min(visibleEnd, Number(segment.endM))
    if (!(endM > startM)) continue
    const widthPct = ((endM - startM) / span) * 100
    const label = segment.label || bottomTypeLabel(segment.id)
    out.push({
      key: `${segment.startM}-${segment.endM}-${segment.id}`,
      leftPct: ((startM - visibleStart) / span) * 100,
      widthPct,
      label,
      color: bottomTypeColor(segment.id),
      textColor: Number(segment.id) > 0 ? '#0f172a' : '#e2e8f0',
      showLabel: widthPct >= 6,
      title: `${label} · ${fmtNm(startM)} ~ ${fmtNm(endM)}`,
    })
  }
  // 缩放后只剩一个类型时，即使色块很窄也显示文字。
  if (out.length === 1) out[0].showLabel = true
  return out
})

/* ────────────────────────────── 图表渲染 ────────────────────────────── */

function onDataZoom() {
  const dz = chart?.getOption()?.dataZoom?.[0]
  if (!dz) return
  const start = Number(dz.start)
  const end = Number(dz.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  zoom.value = { start, end }
  rayOverlay.value?.repaint()
}

/** 复位：恢复完整距离范围 */
function resetView() {
  zoom.value = { start: 0, end: 100 }
  renderChart()
}

/** 多条声线合并成一个 line series，用 null 断开，动画时只更新一条 series。 */
function pathsToSeriesData(paths) {
  const data = []
  for (const path of paths) {
    if (!Array.isArray(path) || path.length < 2) continue
    if (data.length) data.push(null)
    for (const point of path) data.push([Number(point[0]), Number(point[1])])
  }
  return data
}

function currentRaySeries() {
  return {
    id: 'rays',
    name: '声线',
    type: 'line',
    data: pathsToSeriesData(displayRayPaths.value),
    showSymbol: false,
    connectNulls: false,
    smooth: false,
    lineStyle: {
      width: 1.6,
      color: '#e8f7ff',
      opacity: 1,
      shadowColor: 'rgba(200,235,255,0.35)',
      shadowBlur: 4,
    },
    emphasis: { lineStyle: { width: 2.4 } },
    z: 3,
    markLine: {
      silent: true,
      symbol: 'none',
      data: Number.isFinite(srcDepth.value)
        ? [
            {
              yAxis: srcDepth.value,
              label: { formatter: '声源', color: '#fbbf24', fontSize: 9, position: 'insideEndTop' },
              lineStyle: { color: 'rgba(251,191,36,0.8)', type: 'dashed', width: 1.2 },
            },
          ]
        : [],
    },
  }
}

async function renderChart() {
  const paths = displayRayPaths.value
  await nextTick()
  if (!chartEl.value) return
  if (!paths.length && !rayFlow.value) {
    chart?.clear()
    return
  }
  if (!chartEl.value.clientWidth || !chartEl.value.clientHeight) return
  if (!chart) {
    chart = echarts.init(chartEl.value)
    chart.on('datazoom', onDataZoom)
  }

  // 声线轨迹：每条一个 series（颜色循环），直接用物理坐标绘制，保持真实声线曲线
const raySeries = [currentRaySeries()]

  // 声源位置
  const sourceSeries = Number.isFinite(srcDepth.value)
    ? [
        {
          name: '声源',
          type: 'scatter',
          data: [[0, srcDepth.value]],
          symbolSize: 9,
          itemStyle: { color: '#fbbf24', borderColor: '#fff7ed', borderWidth: 1 },
          label: { show: true, formatter: '声源', color: '#fbbf24', fontSize: 9, position: 'right' },
          z: 5,
        },
      ]
    : []

  const terrainSeries = terrainSeriesData.value.length
    ? [
        {
          name: '海底地形',
          type: 'line',
          data: terrainSeriesData.value,
          connectNulls: false,
          showSymbol: false,
          smooth: false,
          silent: true,
          lineStyle: { color: 'rgba(241,245,249,0.95)', width: 1.6 },
          areaStyle: { color: 'rgba(100,116,139,0.5)', origin: 'end' },
          z: 1,
        },
      ]
    : []

  chart.setOption(
    {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(2,6,23,0.92)',
        borderColor: 'rgba(59,130,246,0.5)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params) => {
          const val = params?.value
          if (!Array.isArray(val)) return ''
          const [d, dep] = val
          const depthText = Number.isFinite(Number(dep)) ? `${Number(dep).toFixed(2)} m` : '-'
          return `${params.seriesName}<br/>距离 ${fmtNm(Number(d))}<br/>深度 ${depthText}`
        },
      },
      // 网格与 TL 伪彩图一致；距离单位用海里(nm)，与数据范围/刻度一一对应
      grid: { left: 62, right: 54, top: 16, bottom: hasBottomTypeBar.value ? 78 : 52 },
      xAxis: {
        type: 'value',
        name: '距离(nm)',
        nameLocation: 'middle',
        nameGap: 26,
        min: 0,
        max: xMaxM.value,
        interval: xTickStep.value,
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: { color: '#94a3b8', fontSize: 9, formatter: (v) => fmtNm(v), hideOverlap: true },
        splitLine: { show: true, lineStyle: { color: 'rgba(148,163,184,0.12)' } },
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: '深度(m)',
        nameLocation: 'middle',
        nameGap: 44,
        min: 0,
        max: yMaxM.value,
        interval: yTickStep.value,
        inverse: true,
        axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: { color: '#94a3b8', fontSize: 9, hideOverlap: true, formatter: (v) => String(Math.round(v)) },
        splitLine: { show: true, lineStyle: { color: 'rgba(148,163,184,0.12)' } },
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
      },
      // 距离轴左右滑动 / 缩放：inside（滚轮缩放 + 按住拖拽平移）+ 底部滑块
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
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'none',
          start: zoom.value.start,
          end: zoom.value.end,
          height: 12,
          bottom: 3,
          borderColor: 'rgba(148,163,184,0.3)',
          backgroundColor: 'rgba(15,23,42,0.6)',
          fillerColor: 'rgba(59,130,246,0.22)',
          handleSize: '90%',
          handleStyle: { color: 'rgba(96,165,250,0.85)', borderColor: '#93c5fd' },
          moveHandleSize: 3,
          brushSelect: false,
          labelFormatter: () => '',
          textStyle: { color: '#94a3b8', fontSize: 9 },
        },
      ],
      series: [...terrainSeries, ...raySeries, ...sourceSeries],
    },
    { notMerge: true }
  )
  chart.resize()
  rayOverlay.value?.repaint()
}

function toggleAnimation() {
  animationPlaying.value = !animationPlaying.value
}

/** 下拉切换方位：回传给父组件（3D 指针 / 切面同步） */
function onAzimuthSelect(e) {
  const v = Number(e.target.value)
  if (Number.isFinite(v)) emit('update:azimuthDeg', v)
}

function toggleOpen() {
  open.value = !open.value
  if (open.value) nextTick(() => renderChart())
}

watch(
  () => [
    props.data,
    props.rayData,
    props.portalRaysOnly,
    props.sourceId,
    props.azimuthDeg,
    props.toleranceDeg,
    props.maxRadiusM,
    props.rayCount,
    props.sourceDepthM,
    props.bottomTypeSegments,
    props.bottomTypeState,
    props.animated,
    props.refreshToken,
  ],
  () => {
    renderChart()
  }
)

onMounted(() => {
  renderChart()
  if (typeof ResizeObserver !== 'undefined' && chartEl.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!open.value) return
      chart?.resize()
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
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.ray-chart {
  display: flex;
  flex-direction: column;
  background: rgba(10, 18, 35, 0.9);
  border: 1px solid rgba(59, 130, 246, 0.45);
  /* border-radius: 10px; */
  color: #e5e7eb;
  /* 保持深色面板，但避免相机移动时逐帧重算背景模糊。 */
  backdrop-filter: none;
  overflow: hidden;
}

.rc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: linear-gradient(180deg, rgba(30, 64, 175, 0.45), rgba(15, 23, 42, 0.3));
  border-bottom: 1px solid rgba(59, 130, 246, 0.25);
}

.rc-title {
  font-size: 12px;
  font-weight: 600;
  color: #dbeafe;
  letter-spacing: 0.5px;
}

.rc-tag {
  margin-left: auto;
  font-size: 10px;
  color: #93c5fd;
  white-space: nowrap;
}

.rc-toggle {
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

.rc-toggle:hover {
  background: rgba(51, 65, 85, 0.95);
}

.rc-body {
  padding: 6px 8px 8px;
}

.rc-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rc-lbl {
  font-size: 11px;
  color: #cbd5e1;
  white-space: nowrap;
}

.rc-select {
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

.rc-current-azimuth {
  display: flex;
  align-items: center;
}

.rc-count {
  font-size: 11px;
  color: #93c5fd;
  white-space: nowrap;
}

.rc-btn {
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

.rc-btn:hover {
  background: rgba(51, 65, 85, 0.95);
  color: #e5e7eb;
}

.rc-tip {
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
}

.rc-chart-wrap {
  position: relative;
  width: 100%;
}

.rc-chart {
  position: absolute;
  inset: 0;
}

.rc-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #94a3b8;
}

/* ── 底部底质类型条（与距离轴 / dataZoom 同步） ── */
.rc-bottom-strip {
  position: absolute;
  left: 4px;
  right: 54px;
  bottom: 18px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 14px;
  pointer-events: none;
}

.rc-bottom-strip-title {
  flex: 0 0 54px;
  font-size: 9px;
  color: #94a3b8;
  text-align: right;
  white-space: nowrap;
}

.rc-bottom-strip-track {
  position: relative;
  flex: 1;
  height: 100%;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.3);
  box-sizing: border-box;
}

.rc-bottom-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-right: 1px solid rgba(2, 6, 23, 0.55);
  box-sizing: border-box;
  pointer-events: auto;
}

.rc-bottom-seg span {
  padding: 0 3px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-bottom-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: #94a3b8;
  pointer-events: none;
}
</style>
