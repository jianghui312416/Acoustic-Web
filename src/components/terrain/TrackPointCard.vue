<template>
  <section class="track-point-card" :style="position" aria-label="航迹点参数">
    <header>
      <span>📍 {{ waterLabel }} · 源深 {{ sourceDepthLabel }} m</span>
      <b>{{ routeLabel }}</b>
      <button type="button" aria-label="关闭航迹点参数" title="关闭" @click="$emit('close')">×</button>
    </header>
    <p class="coordinates">{{ coord(point.lat, 'N', 'S') }}，{{ coord(point.lon, 'E', 'W') }}</p>
    <div class="actions">
      <button type="button" class="param-button" :class="{ active: editing }" @click="editing = !editing">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 9h6" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>
        <span>{{ editing ? '收起参数' : '调整参数' }}</span>
      </button>
    </div>
    <div v-if="editing" class="params">
      <label v-if="isRouteStart">
        <span>发射时间</span>
        <input
          :value="transmitTimeDisplay"
          type="text"
          inputmode="numeric"
          placeholder="YYYY-MM-DD HH:mm:ss"
          title="可手动输入，如 2026-01-02 03:04:05"
          @change="updateTransmitTime"
        />
      </label>
      <label>
        <span>航速 (kn)</span>
        <input :value="param('speedKn')" type="number" min="0.1" max="60" step="0.1" @change="updateNumber('speedKn', $event, 0.1, 60)" />
      </label>
      <label>
        <span>Src Depth (m)</span>
        <input :value="param('sourceDepthM')" type="number" min="0" max="20000" step="1" @change="updateNumber('sourceDepthM', $event, 0, 20000)" />
      </label>
      <label>
        <span>运行频率 (Hz)</span>
        <input :value="param('frequencyHz')" type="number" min="1" max="1000000" step="1" @change="updateNumber('frequencyHz', $event, 1, 1000000)" />
      </label>
      <label>
        <span>距离 (nmi)</span>
        <input :value="param('rangeNm')" type="number" min="0.1" max="20000" step="0.1" @change="updateNumber('rangeNm', $event, 0.1, 20000)" />
      </label>
      <label>
        <span>俯角 (°)</span>
        <input :value="param('grazingAngleMin')" type="number" min="-90" max="90" step="1" @change="updateNumber('grazingAngleMin', $event, -90, 90)" />
      </label>
      <label>
        <span>仰角 (°)</span>
        <input :value="param('grazingAngleMax')" type="number" min="-90" max="90" step="1" @change="updateNumber('grazingAngleMax', $event, -90, 90)" />
      </label>
      <label>
        <span>声线数</span>
        <input :value="param('lineCount')" type="number" min="0" max="100000" step="1" @change="updateNumber('lineCount', $event, 0, 100000)" />
      </label>
      <label>
        <span>方位数</span>
        <input :value="param('sector')" type="number" min="1" max="360" step="1" @change="updateNumber('sector', $event, 1, 360)" />
      </label>
      <label>
        <span>模型</span>
        <select :value="param('model')" @change="$emit('update-params', { index: point.index, patch: { model: $event.target.value } })">
          <option value="bellhop">射线模型</option>
          <option value="ram">RAM 模型</option>
        </select>
      </label>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  formatTransmitTimeForDisplay,
  normalizeTransmitTimeInput,
} from '@/modules/acoustic/trackPointState.js'

const props = defineProps({
  point: { type: Object, required: true },
})
const emit = defineEmits(['close', 'update-params', 'update-transmit-time'])

const editing = ref(false)
const params = computed(() => props.point.params || {})
const pointIndex = computed(() => {
  const value = Number(props.point.pointIndex ?? props.point.index)
  return Number.isFinite(value) && value >= 0 ? value : 0
})
const routeIndex = computed(() => {
  const value = Number(props.point.routeIndex)
  return Number.isFinite(value) && value >= 0 ? value : -1
})
const isRouteStart = computed(() => props.point.isRouteStart === true || pointIndex.value === 0)
const transmitTime = computed(() => String(props.point.transmitTime || ''))
const transmitTimeDisplay = computed(() => formatTransmitTimeForDisplay(transmitTime.value))
const routeLabel = computed(() => (
  routeIndex.value >= 0
    ? `航线 ${routeIndex.value + 1} · 航迹点 ${pointIndex.value + 1}`
    : `航迹点 ${pointIndex.value + 1}`
))
const waterLabel = computed(() => (
  Number(props.point.elevation) < 0
    ? `${Math.round(Math.abs(Number(props.point.elevation)))}米水深`
    : `${Math.round(Number(props.point.elevation) || 0)}米高程`
))
const sourceDepthLabel = computed(() => Math.round(Number(params.value.sourceDepthM) || 0))
const position = computed(() => ({
  left: `clamp(8px, ${Number(props.point.x) + 18}px, calc(100% - 326px))`,
  top: `clamp(8px, ${Number(props.point.y) - 54}px, calc(100% - ${editing.value ? 400 : 120}px))`,
}))

function coord(value, positive, negative) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${Math.abs(number).toFixed(5)}°${number >= 0 ? positive : negative}`
}

function param(key) {
  const value = params.value[key]
  return value == null ? '' : value
}

function updateNumber(key, event, min, max) {
  const number = Number(event.target.value)
  if (!Number.isFinite(number)) return
  const clamped = Math.min(max, Math.max(min, number))
  event.target.value = String(clamped)
  emit('update-params', { index: props.point.index, patch: { [key]: clamped } })
}

function updateTransmitTime(event) {
  const normalized = normalizeTransmitTimeInput(event.target.value)
  if (!normalized) {
    // 输入无法解析时恢复原值，避免写入非法时间。
    event.target.value = transmitTimeDisplay.value
    return
  }
  event.target.value = formatTransmitTimeForDisplay(normalized)
  emit('update-transmit-time', {
    routeId: props.point.routeId || '',
    value: normalized,
  })
}
</script>

<style scoped>
.track-point-card {
  position: absolute;
  z-index: 15;
  width: 310px;
  max-width: calc(100% - 16px);
  max-height: calc(100% - 42px);
  overflow: auto;
  padding: 8px;
  border: 1px solid #3c819d;
  border-radius: 8px;
  background: #071827f4;
  color: #b6cfdd;
  box-shadow: 0 9px 24px #00132666;
  font: 10px/1.35 'Microsoft YaHei', sans-serif;
}

.track-point-card * {
  box-sizing: border-box;
}

.track-point-card button {
  color: #9edbec;
  border: 1px solid #35677f;
  border-radius: 5px;
  background: #122f40;
  cursor: pointer;
}

.track-point-card button:disabled {
  opacity: 0.45;
  cursor: default;
}

header {
  display: flex;
  align-items: center;
  gap: 5px;
}

header span {
  color: #91bbd2;
}

header b {
  margin-left: auto;
  color: #7195ab;
  font-size: 9px;
  font-weight: 400;
}

header button {
  border: 0;
  background: none;
  padding: 0 3px;
  font-size: 16px;
}

.coordinates {
  margin: 4px 0 7px;
  color: #8aa9bc;
  font: 9px ui-monospace, monospace;
}

.actions {
  display: flex;
}

.param-button {
  width: 100%;
  height: 27px;
  background: #15465a;
}

.param-button span {
  margin-left: 5px;
}

svg {
  width: 14px;
  height: 14px;
  vertical-align: middle;
}

.param-button.active {
  border-color: #5ed8f4;
  background: #175168;
}

.params {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding-top: 9px;
  border-top: 1px solid #294355;
}

.params label {
  display: grid;
  grid-template-columns: 1fr minmax(120px, 160px);
  align-items: center;
  gap: 8px;
  color: #7f9fb1;
}

.params input,
.params select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 9px;
  color: #d9f4f5;
  border: 1px solid #35677f;
  border-radius: 5px;
  background: #0d2638;
  font-size: 12px;
}

.params input:focus,
.params select:focus {
  outline: none;
  border-color: #5ed8f4;
  box-shadow: 0 0 0 2px rgba(94, 216, 244, 0.18);
}
</style>
