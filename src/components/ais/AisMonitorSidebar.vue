<template>
  <div class="ais-monitor" @click.stop>
    <div class="ais-connection" :class="connectionClass">
      <span><i></i>{{ connectionLabel }}</span>
      <button v-if="state.connected" type="button" @click="disconnectAis">断开连接</button>
      <button v-else type="button" @click="connectAis">连接</button>
    </div>

    <label class="ais-display-switch">
      <span><b>监测显示</b><small>{{ state.displayEnabled ? '全球视图和缩略图已显示' : '全球视图和缩略图已隐藏' }}</small></span>
      <input v-model="state.displayEnabled" type="checkbox" aria-label="监测显示" />
      <i aria-hidden="true"><em></em></i>
    </label>

    <div class="ais-summary">
      <span>🚢 {{ matchingVessels.length }} / {{ state.vessels.length }} 艘<em v-if="state.landFilterActive" :title="state.coastlineReady ? `已按前端提取的海岸线多边形过滤（${state.coastlineRingCount} 段）` : '已按 GEBCO 陆地掩膜过滤'"> · 陆地 {{ state.landFilteredCount }} 已滤</em></span>
      <time>◷ {{ currentTimeText }}</time>
    </div>

    <div class="ais-tools">
      <div class="ais-sort" role="group" aria-label="船舶排序方式">
        <button type="button" :class="{ active: state.sortBy === 'distance' }" title="按距仿真中心排序" aria-label="按距离排序" @click="state.sortBy = 'distance'">⌖</button>
        <button type="button" :class="{ active: state.sortBy === 'name' }" title="按名称排序" aria-label="按名称排序" @click="state.sortBy = 'name'">Abc</button>
        <button type="button" :class="{ active: state.sortBy === 'speed' }" title="按航速排序" aria-label="按航速排序" @click="state.sortBy = 'speed'">⛴</button>
        <button type="button" :class="{ active: state.sortBy === 'source' }" title="按估算源级排序" aria-label="按估算源级排序" @click="state.sortBy = 'source'">🔊</button>
      </div>
      <label class="ais-speed-filter">
        <span>最小 {{ Number(state.minSpeedKn).toFixed(1) }} kn</span>
        <input v-model.number="state.minSpeedKn" type="range" min="0" max="30" step="0.5" aria-label="最小航速筛选" />
      </label>
    </div>

    <div class="ais-source-legend" aria-label="JOMOPANS-ECHO宽带源级图例">
      <span class="quiet">SL &lt; 165</span><span class="moderate">≥ 165</span><span class="loud">≥ 175</span><span class="very-loud">≥ 185 dB</span>
    </div>

    <article v-if="selected" class="ais-selected-card">
      <header>
        <span class="ais-dot" :style="{ background: sourceColor(selected.source_level_db) }"></span>
        <b>{{ displayName(selected) }}</b>
        <strong :style="{ color: sourceColor(selected.source_level_db) }">{{ selected.source_level_db }}<small>dB</small></strong>
        <button type="button" title="关闭详情" aria-label="关闭船舶详情" @click="clearSelectedAisVessel">×</button>
      </header>
      <p>{{ selected.ship_type_name || '未知船型' }}　{{ speedText(selected) }}　{{ headingText(selected) }}　{{ ageText(selected) }}</p>
      <dl>
        <dt>位置</dt><dd>{{ coordinateText(selected) }}</dd>
        <dt>状态</dt><dd>{{ trackingStatus }}</dd>
        <dt>距仿真中心</dt><dd>{{ distanceText(selected) }}</dd>
        <dt>相对方位</dt><dd>{{ bearingText(selected) }}</dd>
        <dt>船体尺寸</dt><dd>{{ dimensionsText(selected) }}</dd>
        <dt>吃水</dt><dd>{{ numberText(selected.draught_m, 1, ' m') }}</dd>
        <dt>IMO / MMSI</dt><dd>{{ selected.imo || '—' }} / {{ selected.mmsi }}</dd>
        <dt>5分钟报文</dt><dd>{{ selected.position_report_count ?? '—' }} 条</dd>
        <dt>目的地</dt><dd>{{ selected.destination || '—' }}</dd>
      </dl>
      <section class="ais-source-level">
        <span>20 Hz–20 kHz 宽带源级</span><strong>{{ selected.source_level_db }} dB</strong>
        <div class="source-scale"><i v-for="tick in 7" :key="tick"></i><b :style="{ left: sourceMarkerLeft(selected.source_level_db) }"></b></div>
        <div v-if="selected.source_spectrum_db?.length" class="source-spectrum" aria-label="20赫兹至20千赫兹频带源级">
          <i v-for="(level, index) in selected.source_spectrum_db" :key="index" :style="{ height: spectrumBarHeight(selected.source_spectrum_db, level) }"></i>
        </div>
        <div class="source-spectrum-axis"><span>20 Hz</span><span>20 kHz</span></div>
        <small>{{ selected.source_model }} · {{ selected.source_model_class_label }} · dB re 1 μPa·m<br />模型航速 {{ numberText(selected.source_model_speed_kn, 1, ' kn') }}，船长 {{ numberText(selected.source_model_length_m, 0, ' m') }}，等效单极子深度 {{ numberText(selected.source_model_depth_m, 0, ' m') }}；分频带统计不确定度约 ±{{ selected.source_level_uncertainty_db }} dB。<template v-if="selected.source_model_assumptions?.length"><br />{{ selected.source_model_assumptions.join('；') }}</template></small>
      </section>
      <div class="ais-locate-actions">
        <button type="button" @click="locate(selected, 'globe')">◎ 全球定位</button>
        <button type="button" @click="locate(selected, 'terrain')">⌖ 地形定位</button>
      </div>
    </article>

    <div class="ais-vessel-list">
      <button
        v-for="vessel in visibleVessels"
        :key="vessel.mmsi"
        type="button"
        :class="{ selected: vessel.mmsi === state.selectedMmsi }"
        @click="locate(vessel, viewMode)"
      >
        <span class="ais-dot" :style="{ background: sourceColor(vessel.source_level_db) }"></span>
        <span class="ais-vessel-main"><b>{{ displayName(vessel) }}</b><small>{{ vessel.ship_type_name || '未知船型' }}　{{ speedText(vessel) }}　{{ headingText(vessel) }}　{{ ageText(vessel) }}</small></span>
        <span class="ais-vessel-metrics"><strong :style="{ color: sourceColor(vessel.source_level_db) }">{{ vessel.source_level_db }}<small>dB</small></strong><em>{{ distanceText(vessel) }}</em></span>
      </button>
      <div v-if="!state.loading && !visibleVessels.length" class="ais-empty">{{ state.error || '当前筛选没有船舶' }}</div>
      <button v-if="filteredVessels.length > visibleLimit" type="button" class="ais-more" @click="visibleLimit += 100">再显示 100 艘</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { simulationControls } from '@/modules/acoustic/simulationControls.js'
import {
  aisMonitorState as state,
  clearSelectedAisVessel,
  connectAis,
  disconnectAis,
  selectAisVessel,
  selectedAisVessel,
  selectedAisTrackState,
} from '@/modules/ais/aisMonitorStore.js'

const props = defineProps({ viewMode: { type: String, default: 'globe' } })
const emit = defineEmits(['navigate'])
const visibleLimit = ref(100)
const selected = selectedAisVessel
const trackingStatus = computed(() => {
  if (!state.connected) return '已断开'
  if (selectedAisTrackState.mmsi !== selected.value?.mmsi) return '等待地形跟踪'
  if (selectedAisTrackState.error) return '航迹同步异常'
  if (selectedAisTrackState.found === false && !selectedAisTrackState.points.length) return '等待该船 AIS 新报文'
  return `实时跟踪 · ${selectedAisTrackState.points.length} 个实测点`
})

const connectionClass = computed(() => ({ live: state.connected && !state.error, error: !!state.error, offline: !state.connected }))
const connectionLabel = computed(() => state.loading ? '正在同步' : state.error ? '连接异常' : state.connected ? '实时连接' : '已断开')
const currentTimeText = computed(() => {
  const date = state.lastUpdated || new Date()
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
})

const matchingVessels = computed(() => {
  const minimum = Number(state.minSpeedKn) || 0
  return state.vessels.filter((item) => (Number(item.sog_kn) || 0) >= minimum)
})
const filteredVessels = computed(() => {
  const decorated = matchingVessels.value.map((vessel) => ({
    vessel,
    name: displayName(vessel),
    speed: Number(vessel.sog_kn) || 0,
    source: Number(vessel.source_level_db) || 0,
    distance: state.sortBy === 'distance' ? greatCircleKm(vessel) : 0,
  }))
  decorated.sort((a, b) => {
    if (state.sortBy === 'speed') return b.speed - a.speed
    if (state.sortBy === 'source') return b.source - a.source
    if (state.sortBy === 'distance') return a.distance - b.distance
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })
  return decorated.map((item) => item.vessel)
})
const visibleVessels = computed(() => filteredVessels.value.slice(0, visibleLimit.value))

function displayName(vessel) { return vessel.vessel_name || `MMSI ${vessel.mmsi}` }
function numberText(value, digits = 1, suffix = '') { const n = Number(value); return Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : '—' }
function speedText(vessel) { return numberText(vessel.sog_kn, 1, ' kn') }
function headingText(vessel) { return numberText(vessel.heading_deg ?? vessel.cog_deg, 0, '°') }
function dimensionsText(vessel) { return vessel.length_m == null && vessel.width_m == null ? '—' : `${vessel.length_m ?? '—'} m × ${vessel.width_m ?? '—'} m` }
function coordinateText(vessel) {
  const lat = Number(vessel.latitude)
  const lon = Number(vessel.longitude)
  return `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`
}
function ageText(vessel) {
  const time = new Date(vessel.data_time_utc || vessel.last_seen_utc || 0).getTime()
  if (!Number.isFinite(time) || !time) return '时间未知'
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  return seconds < 60 ? `${seconds}秒前` : `${Math.floor(seconds / 60)}分钟前`
}
function sourceColor(level) { return level >= 185 ? '#ff4e55' : level >= 175 ? '#ffb72e' : level >= 165 ? '#f3da25' : '#24d99b' }
function sourceMarkerLeft(level) { return `${Math.max(0, Math.min(100, ((Number(level) - 140) / 60) * 100))}%` }
function spectrumBarHeight(spectrum, level) {
  const values = Array.isArray(spectrum) ? spectrum.filter(Number.isFinite) : []
  if (!values.length) return '8%'
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const ratio = maximum > minimum ? (Number(level) - minimum) / (maximum - minimum) : 0.5
  return `${Math.round(12 + Math.max(0, Math.min(1, ratio)) * 88)}%`
}

function greatCircleKm(vessel) {
  const lat1 = Number(simulationControls.coordY) * Math.PI / 180
  const lat2 = Number(vessel.latitude) * Math.PI / 180
  const dLat = lat2 - lat1
  const dLon = (Number(vessel.longitude) - Number(simulationControls.coordX)) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function distanceText(vessel) {
  const km = greatCircleKm(vessel)
  return Number.isFinite(km) ? (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`) : '—'
}
function bearingText(vessel) {
  const lat1 = Number(simulationControls.coordY) * Math.PI / 180
  const lat2 = Number(vessel.latitude) * Math.PI / 180
  const dLon = (Number(vessel.longitude) - Number(simulationControls.coordX)) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
  return Number.isFinite(bearing) ? `${Math.round(bearing)}°` : '—'
}
function locate(vessel, mode) {
  const targetMode = mode === 'terrain' ? 'terrain' : 'globe'
  selectAisVessel(vessel, targetMode)
  if (targetMode !== props.viewMode) emit('navigate', targetMode)
}

</script>

<style scoped>
.ais-monitor { margin: 5px 0 3px; padding: 8px; color: #b9d1df; border: 1px solid #20384c; border-radius: 7px; background: #0b1a2a; font: 10px 'Microsoft YaHei', sans-serif; }
.ais-connection { height: 35px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; border: 1px solid #365069; border-radius: 6px; background: #102538; }.ais-connection span { display: flex; align-items: center; gap: 7px; font-weight: 700; letter-spacing: .6px; }.ais-connection i,.ais-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; }.ais-connection.live { color: #d9f7eb; border-color: #08745e; background: #10352f; }.ais-connection.live i { background: #17df92; box-shadow: 0 0 8px #17df92; }.ais-connection.offline i { background: #718497; }.ais-connection.error i { background: #ffbd41; }.ais-connection button { height: 23px; padding: 0 9px; color: #b8d6e8; border: 1px solid #39647e; border-radius: 4px; background: #16344a; cursor: pointer; }
.ais-display-switch { position: relative; min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 7px; padding: 0 8px; color: #b9d1df; border: 1px solid #28465c; border-radius: 6px; background: #102337; cursor: pointer; }.ais-display-switch > span { display: grid; gap: 2px; }.ais-display-switch b { color: #c9e2ed; font-size: 9px; }.ais-display-switch small { color: #66899d; font-size: 7px; }.ais-display-switch input { position: absolute; opacity: 0; pointer-events: none; }.ais-display-switch > i { position: relative; width: 36px; height: 19px; flex: none; border: 1px solid #365875; border-radius: 999px; background: #223a55; }.ais-display-switch > i em { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #819fbe; transition: transform .18s ease, background .18s ease; }.ais-display-switch input:checked + i { border-color: #2aa97d; background: #12664d; }.ais-display-switch input:checked + i em { transform: translateX(17px); background: #41e3a6; }.ais-display-switch input:focus-visible + i { outline: 2px solid #55d9f4; outline-offset: 2px; }
.ais-summary { height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0 4px; color: #7798ac; }.ais-summary em { margin-left: 4px; color: #5f9bb2; font-size: 8px; font-style: normal; }.ais-summary time { font: 9px ui-monospace, monospace; }
.ais-tools { display: flex; align-items: center; gap: 8px; }.ais-sort { display: flex; gap: 5px; }.ais-sort button { min-width: 31px; height: 25px; padding: 0 6px; color: #82a7bc; border: 1px solid #2b4860; border-radius: 4px; background: #142a3e; cursor: pointer; font-size: 9px; }.ais-sort button.active { color: #9cecff; border-color: #4383a4; background: #23435b; box-shadow: inset 0 -2px #4ad2ed; }.ais-speed-filter { min-width: 0; flex: 1; display: flex; align-items: center; gap: 6px; }.ais-speed-filter span { flex: none; color: #718ea0; font-size: 8px; }.ais-speed-filter input { min-width: 55px; width: 100%; height: 3px; margin: 0; accent-color: #46a9d4; }
.ais-source-legend { display: flex; gap: 7px; padding: 8px 3px 6px; font: 7px ui-monospace, monospace; }.ais-source-legend .quiet { color: #24d99b; }.ais-source-legend .moderate { color: #f3da25; }.ais-source-legend .loud { color: #ffb72e; }.ais-source-legend .very-loud { color: #ff4e55; }
.ais-selected-card { margin: 2px 0 7px; padding: 8px; border: 1px solid #2a536e; border-radius: 6px; background: #10263d; box-shadow: inset 2px 0 #4ea7d2; }.ais-selected-card header { display: flex; align-items: center; gap: 7px; }.ais-selected-card header b { min-width: 0; flex: 1; overflow: hidden; color: #e1eff6; text-overflow: ellipsis; white-space: nowrap; }.ais-selected-card header strong { font: 700 12px ui-monospace, monospace; }.ais-selected-card header strong small { margin-left: 2px; color: #7f9aaa; font-size: 7px; }.ais-selected-card header button { color: #7794a6; border: 0; background: transparent; cursor: pointer; }.ais-selected-card > p { margin: 5px 0 8px; padding-bottom: 7px; color: #7191a5; border-bottom: 1px solid #254158; font-size: 8px; }.ais-selected-card dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; margin: 0; font-size: 8px; }.ais-selected-card dt { color: #63849a; }.ais-selected-card dd { margin: 0; overflow: hidden; color: #b9d0dc; text-align: right; text-overflow: ellipsis; white-space: nowrap; }.ais-source-level { margin-top: 9px; padding: 8px; border-radius: 4px; background: #091d31; }.ais-source-level > span { color: #7595a9; }.ais-source-level > strong { float: right; color: #50d696; font: 700 13px ui-monospace, monospace; }.ais-source-level > small { display: block; margin-top: 6px; color: #627d8f; line-height: 1.4; }.source-scale { position: relative; height: 22px; display: flex; align-items: end; justify-content: space-between; margin-top: 8px; border-bottom: 1px solid #31536a; }.source-scale i { width: 9%; height: 3px; background: #3ec997; }.source-scale i:nth-child(n+4) { background: #e0b83c; }.source-scale i:nth-child(n+6) { background: #e36357; }.source-scale b { position: absolute; bottom: -3px; width: 2px; height: 20px; background: #eaf9ff; transform: translateX(-50%); }.ais-locate-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }.ais-locate-actions button { height: 26px; color: #a9d9e8; border: 1px solid #316079; border-radius: 4px; background: #15354b; cursor: pointer; }
.source-spectrum { height: 34px; display: flex; align-items: end; gap: 1px; margin-top: 8px; padding: 3px 2px 0; border-bottom: 1px solid #31536a; background: linear-gradient(180deg,#15304744,#08182622); }.source-spectrum i { min-width: 1px; flex: 1; border-radius: 1px 1px 0 0; background: linear-gradient(180deg,#57d7eb,#2d8bc0); }.source-spectrum-axis { display: flex; justify-content: space-between; margin-top: 2px; color: #4f7185; font: 7px ui-monospace,monospace; }
.ais-vessel-list { max-height: 360px; overflow-y: auto; padding-right: 2px; scrollbar-width: thin; scrollbar-color: #2f5c75 transparent; }.ais-vessel-list > button:not(.ais-more) { width: 100%; min-height: 54px; display: flex; align-items: flex-start; gap: 7px; padding: 8px 7px; text-align: left; color: inherit; border: 1px solid #1d3850; border-radius: 5px; background: #0e2033; cursor: pointer; }.ais-vessel-list > button + button { margin-top: 5px; }.ais-vessel-list > button:hover,.ais-vessel-list > button.selected { border-color: #316883; background: #132b42; }.ais-vessel-list > button > .ais-dot { margin-top: 3px; }.ais-vessel-main { min-width: 0; flex: 1; }.ais-vessel-main b,.ais-vessel-main small { display: block; }.ais-vessel-main b { overflow: hidden; color: #d7e8f0; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.ais-vessel-main small { margin-top: 7px; color: #64849a; font-size: 8px; white-space: nowrap; }.ais-vessel-metrics { flex: none; text-align: right; }.ais-vessel-metrics strong,.ais-vessel-metrics em { display: block; }.ais-vessel-metrics strong { font: 700 10px ui-monospace, monospace; }.ais-vessel-metrics strong small { margin-left: 1px; color: #6e8998; font-size: 7px; }.ais-vessel-metrics em { margin-top: 8px; color: #49b5e2; font: 700 9px ui-monospace, monospace; font-style: normal; }.ais-empty { padding: 24px 8px; color: #7893a2; text-align: center; }.ais-more { width: 100%; height: 27px; margin-top: 6px; color: #6facc6; border: 1px solid #23475c; border-radius: 4px; background: #10283a; cursor: pointer; }
</style>
