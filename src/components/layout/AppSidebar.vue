<template>
  <aside class="app-sidebar" :class="{ collapsed }" aria-label="主导航">
    <div class="sidebar-scroll">
      <button type="button" class="run-button" title="模拟运行" aria-label="模拟运行" @click="$emit('run')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
        </svg>
        <span>模拟运行</span>
      </button>

      <div class="brand-row">
        <div class="brand-lockup" title="星图深海">
          <img src="/branding/xingtu-shenhai.svg" alt="星图深海" />
        </div>
        <div class="view-switcher" role="group" aria-label="视图切换">
          <button
            type="button"
            class="view-chip"
            :class="{ active: viewMode === 'globe' }"
            title="全球视图"
            aria-label="全球视图"
            @click="$emit('select-view-mode', 'globe')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M3.6 12h16.8M12 3.6c2.4 2.3 3.8 5.2 3.8 8.4S14.4 18.1 12 20.4C9.6 18.1 8.2 15.2 8.2 12S9.6 5.9 12 3.6Z" fill="none" stroke="currentColor" stroke-width="1.35" />
            </svg>
          </button>
          <button
            type="button"
            class="view-chip"
            :class="{ active: viewMode === 'terrain' }"
            title="地形预览"
            aria-label="地形预览"
            @click="$emit('select-view-mode', 'terrain')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m3.4 18.4 5.2-8.5 3.1 4.4 2.6-3.6 6.3 7.7H3.4Z" fill="currentColor" opacity=".9" />
              <path d="m8.4 10.3 1.8 2.6" fill="none" stroke="#062033" stroke-width="1.1" stroke-linecap="round" />
            </svg>
          </button>
          <button
            type="button"
            class="view-chip"
            :class="{ active: viewMode === 'terrain' && !thumbnailCollapsed }"
            :title="viewMode !== 'terrain' ? '显示地图缩略图' : thumbnailCollapsed ? '展开地图缩略图' : '收起地图缩略图'"
            :aria-label="viewMode !== 'terrain' ? '显示地图缩略图' : thumbnailCollapsed ? '展开地图缩略图' : '收起地图缩略图'"
            :aria-pressed="!thumbnailCollapsed"
            @click="$emit('toggle-thumbnail')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="m5.5 16 4-4 2.7 2.5 2.4-2.3 3.9 3.8M6 7.5h5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <nav class="module-list" aria-label="业务模块">
        <section class="module-group work-module" :class="{ active: workOpen }">
          <button type="button" class="module-entry" :class="{ active: workOpen }" title="工作" aria-label="工作" @click="workOpen = !workOpen">
            <span class="module-icon work-module-icon" aria-hidden="true">▤</span>
            <span class="module-label">工作</span>
            <span class="work-refresh" :class="{ spinning: jobWorkspace.loading }" role="button" tabindex="0" title="刷新工作" aria-label="刷新工作" @click.stop="refreshJobWorkspace" @keydown.enter.stop="refreshJobWorkspace">↻</span>
            <span class="module-chevron" :class="{ open: workOpen }" aria-hidden="true">›</span>
          </button>
          <div v-if="workOpen" class="work-list" @click.stop>
            <p v-if="jobWorkspace.error" class="work-message error">{{ jobWorkspace.error }}</p>
            <p v-else-if="jobWorkspace.loading && !jobWorkspace.jobs.length" class="work-message">正在读取工作…</p>
            <p v-else-if="!jobWorkspace.jobs.length" class="work-message">暂无可打开的三维声场工作</p>
            <article v-for="job in jobWorkspace.jobs" :key="job.job_id" class="work-card">
              <div class="work-card-title">
                <span>◆</span><b>{{ job.model_label || job.model || '三维声场' }}</b><i :class="job.status === 'completed' ? 'ready' : ''">{{ job.status_label || (job.openable ? '完成' : '处理中') }}</i>
              </div>
              <div class="work-card-meta">工作 {{ job.job_id }} · {{ formatJobTime(job.updated_at_ms) }}</div>
              <div class="work-card-actions">
                <button type="button" :disabled="!job.openable || openingJobId === job.job_id" @click="openJob(job)">
                  {{ openingJobId === job.job_id ? '正在打开…' : isJobOpened(job.job_id) ? '定位声场' : '打开声场' }}
                </button>
                <span v-if="isJobOpened(job.job_id)">已打开</span>
                <button type="button" class="work-delete" :disabled="deletingJobId === job.job_id" title="删除工作记录" :aria-label="`删除工作 ${job.job_id}`" @click="removeJob(job)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              </div>
            </article>
          </div>
        </section>

        <section class="module-group" :class="{ active: terrainControlsOpen }">
          <button
            type="button"
            class="module-entry"
            :class="{ active: terrainControlsOpen }"
            title="地形"
            aria-label="地形"
            @click="toggleTerrainControls"
          >
            <span class="module-icon terrain-module-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="m2.8 18.5 5.7-9.1 3.3 4.3 2.8-3.8 6.6 8.6H2.8Z" fill="currentColor" opacity=".9" />
                <path d="m8.3 9.8 1.9 2.5" fill="none" stroke="#092235" stroke-width="1.1" />
              </svg>
            </span>
            <span class="module-label">地形</span>
            <span class="module-chevron" :class="{ open: terrainControlsOpen }" aria-hidden="true">›</span>
          </button>

          <div v-if="terrainControlsOpen" class="feature-controls terrain-controls" @click.stop>
            <p class="feature-section-title">显示</p>
            <label class="feature-slider">
              <span>垂直夸张（地形 + 声场） <b>{{ formatControl(visualControls.terrainExaggeration, 1) }}×</b></span>
              <input v-model.number="visualControls.terrainExaggeration" aria-label="垂直夸张倍率" type="range" min="1" max="10" step="0.1" @input="normalizeControls" />
            </label>
            <button type="button" @click="visualControls.terrainExaggeration = 1">真实比例（1 倍）</button>
          </div>
        </section>

        <section
          v-for="moduleItem in modules"
          :key="moduleItem.id"
          class="module-group"
          :class="{ active: isModuleExpanded(moduleItem.id) }"
        >
          <button
            type="button"
            class="module-entry"
            :class="{ active: isModuleExpanded(moduleItem.id) }"
            :title="moduleItem.label"
            :aria-label="moduleItem.label"
            @click="toggleModule(moduleItem)"
          >
            <span class="module-icon" aria-hidden="true">
              <svg v-if="moduleItem.viewKey === 'acoustic-field'" viewBox="0 0 24 24">
                <path d="m12 3.2 7.6 4.2v9.2L12 20.8l-7.6-4.2V7.4L12 3.2Z" fill="none" stroke="currentColor" stroke-width="1.35" />
                <path d="m4.7 7.5 7.3 4.1 7.3-4.1M12 11.6v8.7" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".8" />
              </svg>
              <svg v-else viewBox="0 0 24 24">
                <path d="M12 3.6v4.1M12 16.3v4.1M3.6 12h4.1M16.3 12h4.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.5" />
                <circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".55" />
              </svg>
            </span>
            <span class="module-label">{{ moduleItem.label }}</span>
            <span class="module-chevron" :class="{ open: isModuleExpanded(moduleItem.id) }" aria-hidden="true">›</span>
          </button>

          <div v-if="moduleItem.viewKey === 'acoustic-field' && isModuleExpanded(moduleItem.id)" class="feature-controls volume-controls" @click.stop>
            <div class="volume-state">
              <span class="volume-cube" aria-hidden="true">◆</span>
              <span>{{ visualControls.volumeVisible ? '体数据已显示' : '体数据已隐藏' }}</span>
            </div>

            <p class="feature-section-title">外观</p>
            <label class="feature-slider">
              <span>透明度 <b>{{ formatControl(visualControls.opacity, 1) }}</b></span>
              <input v-model.number="visualControls.opacity" type="range" min="0.2" max="5" step="0.1" @input="normalizeControls" />
            </label>
            <label class="feature-slider">
              <span title="归一化纹理坐标中的最大步长；实际步长会按三维体素分辨率自适应缩小">最大采样步长 <b>{{ formatControl(visualControls.sampling, 3) }}</b></span>
              <input v-model.number="visualControls.sampling" type="range" min="0.004" max="0.03" step="0.001" title="体素分辨率自适应采样上限" @input="normalizeControls" />
            </label>
            <label class="feature-slider">
              <span>透明度指数 <b>{{ formatControl(visualControls.alphaPower, 1) }}</b></span>
              <input v-model.number="visualControls.alphaPower" type="range" min="0.35" max="3" step="0.05" @input="normalizeControls" />
            </label>

            <label class="feature-select">
              <span>色图</span>
              <select v-model="visualControls.colormap">
                <option v-for="palette in volumeColormaps" :key="palette.id" :value="palette.id">{{ palette.label }}</option>
              </select>
            </label>

            <p class="feature-section-title">dB 范围</p>
            <div class="db-control-grid">
              <span>最小值</span><span>最大值</span>
              <div class="stepper"><button type="button" @click="stepDb('dbMin', -1)">−</button><input v-model.number="visualControls.dbMin" type="number" min="0" max="199" @change="normalizeControls" /><em>dB</em><button type="button" @click="stepDb('dbMin', 1)">＋</button></div>
              <div class="stepper"><button type="button" @click="stepDb('dbMax', -1)">−</button><input v-model.number="visualControls.dbMax" type="number" min="1" max="200" @change="normalizeControls" /><em>dB</em><button type="button" @click="stepDb('dbMax', 1)">＋</button></div>
            </div>

            <details class="feature-fold">
              <summary><span>▣ 方向</span><small>旋转</small></summary>
              <label v-for="axis in rotationAxes" :key="axis.key" class="feature-slider compact-slider">
                <span>旋转 {{ axis.label }} <b>{{ Math.round(visualControls[axis.key]) }}°</b></span>
                <input v-model.number="visualControls[axis.key]" type="range" min="0" max="359" step="1" @input="normalizeControls" />
              </label>
            </details>

            <details class="feature-fold">
              <summary><span>⌖ 位置</span><small>米</small></summary>
              <label v-for="axis in moveAxes" :key="axis.key" class="move-control">
                <span>移动 {{ axis.label }}</span>
                <div class="stepper"><button type="button" @click="stepMove(axis.key, -10)">−</button><input v-model.number="visualControls[axis.key]" type="number" step="10" @change="normalizeControls" /><em>m</em><button type="button" @click="stepMove(axis.key, 10)">＋</button></div>
              </label>
            </details>

            <p class="feature-section-title">操作</p>
            <div class="feature-actions">
              <button type="button" :class="{ active: visualControls.rangeRings }" @click="visualControls.rangeRings = !visualControls.rangeRings">距离环</button>
              <button type="button" class="danger-action" @click="visualControls.volumeVisible = !visualControls.volumeVisible">{{ visualControls.volumeVisible ? '移除' : '显示' }}</button>
            </div>
          </div>

          <div v-else-if="isModuleExpanded(moduleItem.id)" class="module-children">
            <button
              v-for="child in moduleItem.children || []"
              :key="child.id"
              type="button"
              class="module-child"
              :class="{ active: child.id === activeSubmoduleId && submoduleActive }"
              @click="$emit('select-submodule', child.id)"
            >
              <span class="child-dot" aria-hidden="true"></span>
              <span>{{ child.label }}</span>
            </button>
          </div>
        </section>

        <section class="module-group" :class="{ active: sliceControlsOpen }">
          <button
            type="button"
            class="module-entry"
            :class="{ active: sliceControlsOpen }"
            title="垂直切面"
            aria-label="垂直切面"
            @click="toggleSliceControls"
          >
            <span class="module-icon slice-module-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.3" />
                <path d="m6 17 12-10" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M12 11h3.2M12 11l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.1" />
              </svg>
            </span>
            <span class="module-label">垂直切面</span>
            <span class="module-chevron" :class="{ open: sliceControlsOpen }" aria-hidden="true">›</span>
          </button>

          <div v-if="sliceControlsOpen" class="feature-controls vertical-slice-controls" @click.stop>
            <label class="feature-switch">
              <input v-model="sliceControls.showSlice" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span>显示切面（Show Slice）</span>
            </label>
            <label class="feature-slider">
              <span>方位角（正北 0°）<b>{{ Math.round(sliceControls.sliceAzimuthDeg) }}°</b></span>
              <input v-model.number="sliceControls.sliceAzimuthDeg" type="range" min="0" max="359" step="1" @input="normalizeSliceControls" />
            </label>
            <p class="feature-section-title">dB 范围</p>
            <div class="db-control-grid">
              <span>最小值</span><span>最大值</span>
              <div class="stepper"><button type="button" @click="stepSliceDb('dbMin', -1)">−</button><input v-model.number="sliceControls.dbMin" type="number" min="0" max="199" @change="normalizeSliceControls" /><em>dB</em><button type="button" @click="stepSliceDb('dbMin', 1)">＋</button></div>
              <div class="stepper"><button type="button" @click="stepSliceDb('dbMax', -1)">−</button><input v-model.number="sliceControls.dbMax" type="number" min="1" max="200" @change="normalizeSliceControls" /><em>dB</em><button type="button" @click="stepSliceDb('dbMax', 1)">＋</button></div>
            </div>
            <p class="feature-section-title">显示（Display）</p>
            <label class="feature-switch">
              <input v-model="sliceControls.seafloorLineAndMask" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span>海底掩膜线 + 海底掩膜</span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.seafloorMask" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span>海底掩膜</span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.east90Indicator" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span>方位方向线</span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.sspWindow" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span>声速剖面窗口</span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.cursorReadout" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span>光标读取</span>
            </label>
          </div>
        </section>
      </nav>
    </div>

    <footer class="sidebar-footer">
      <span class="sidebar-status"><i aria-hidden="true"></i>就绪</span>
      <time>{{ clockText }}</time>
    </footer>

    <button type="button" class="sidebar-collapse" :title="collapsed ? '展开侧边栏' : '收起侧边栏'" :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'" @click="$emit('toggle-collapse')">{{ collapsed ? '›' : '‹' }}</button>
  </aside>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  VOLUME_COLORMAPS,
  clampVolumeRenderingControls,
  volumeRenderingControls,
} from '@/modules/acoustic/volumeRenderingControls.js'
import {
  clampVerticalSliceControls,
  verticalSliceControls,
} from '@/modules/acoustic/verticalSliceControls.js'
import { deleteAcousticJob } from '@/api/jobWorkspaceApi.js'
import { jobWorkspace, refreshJobWorkspace, requestCloseJob, requestOpenJob } from '@/modules/acoustic/jobWorkspace.js'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  modules: { type: Array, default: () => [] },
  activeModuleId: { type: String, default: '' },
  activeSubmoduleId: { type: String, default: '' },
  submoduleActive: { type: Boolean, default: false },
  viewMode: { type: String, default: 'globe' },
  thumbnailCollapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['select-module', 'select-submodule', 'select-view-mode', 'toggle-collapse', 'toggle-thumbnail', 'run'])

const clockText = ref('')
const workOpen = ref(true)
const openingJobId = ref('')
const deletingJobId = ref('')
const terrainControlsOpen = ref(false)
const sliceControlsOpen = ref(false)
const expandedModuleIds = ref(new Set(props.activeModuleId ? [props.activeModuleId] : []))
const visualControls = volumeRenderingControls
const sliceControls = verticalSliceControls
const volumeColormaps = VOLUME_COLORMAPS
const rotationAxes = Object.freeze([
  { key: 'rotationX', label: 'X' },
  { key: 'rotationY', label: 'Y' },
  { key: 'rotationZ', label: 'Z' },
])
const moveAxes = Object.freeze([
  { key: 'moveX', label: 'X' },
  { key: 'moveY', label: 'Y' },
  { key: 'moveZ', label: 'Z' },
])
let clockTimer = 0

function normalizeControls() {
  clampVolumeRenderingControls(visualControls)
}

function normalizeSliceControls() {
  clampVerticalSliceControls(sliceControls)
}

function formatControl(value, digits = 1) {
  return Number(value).toFixed(digits)
}

function toggleTerrainControls() {
  terrainControlsOpen.value = !terrainControlsOpen.value
  if (!terrainControlsOpen.value) return
  emit('select-view-mode', 'terrain')
}

function toggleSliceControls() {
  sliceControlsOpen.value = !sliceControlsOpen.value
}

function isModuleExpanded(moduleId) {
  return expandedModuleIds.value.has(moduleId)
}

function toggleModule(moduleItem) {
  const next = new Set(expandedModuleIds.value)
  if (next.has(moduleItem.id)) next.delete(moduleItem.id)
  else next.add(moduleItem.id)
  expandedModuleIds.value = next
  emit('select-module', moduleItem.id)
}

function stepDb(key, delta) {
  visualControls[key] = Number(visualControls[key]) + delta
  normalizeControls()
}

function stepSliceDb(key, delta) {
  sliceControls[key] = Number(sliceControls[key]) + delta
  normalizeSliceControls()
}

function stepMove(key, delta) {
  visualControls[key] = Number(visualControls[key]) + delta
  normalizeControls()
}

function formatClock(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatJobTime(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return '时间未知'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function isJobOpened(jobId) {
  return jobWorkspace.openedIds.includes(String(jobId))
}

function openJob(job) {
  if (!job?.openable) return
  openingJobId.value = job.job_id
  requestOpenJob(job.job_id)
  emit('select-view-mode', 'terrain')
  window.setTimeout(() => {
    if (openingJobId.value === job.job_id) openingJobId.value = ''
  }, 900)
}

async function removeJob(job) {
  if (!job?.job_id || !window.confirm(`确定删除工作 ${job.job_id}？删除后无法恢复。`)) return
  deletingJobId.value = job.job_id
  try {
    await deleteAcousticJob(job.job_id)
    requestCloseJob(job.job_id)
    await refreshJobWorkspace()
  } catch (error) {
    jobWorkspace.error = error?.message || String(error)
  } finally {
    deletingJobId.value = ''
  }
}

onMounted(() => {
  clockText.value = formatClock()
  clockTimer = window.setInterval(() => {
    clockText.value = formatClock()
  }, 1000)
  refreshJobWorkspace()
})

watch(() => props.activeModuleId, (moduleId) => {
  if (!moduleId || expandedModuleIds.value.has(moduleId)) return
  expandedModuleIds.value = new Set([...expandedModuleIds.value, moduleId])
})

onBeforeUnmount(() => window.clearInterval(clockTimer))
</script>

<style scoped>
.app-sidebar {
  position: relative;
  z-index: 20;
  flex: none;
  width: 264px;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #d7ecf6;
  border-right: 1px solid rgba(70, 154, 189, 0.42);
  background:
    radial-gradient(120% 70% at 0% 0%, rgba(16, 83, 117, 0.35), transparent 58%),
    linear-gradient(180deg, #071d2c 0%, #05121f 100%);
  box-shadow: 10px 0 30px rgba(0, 6, 16, 0.42);
}

.sidebar-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 12px 14px;
  scrollbar-width: thin;
  scrollbar-color: rgba(86, 177, 212, 0.3) transparent;
}

.sidebar-scroll::-webkit-scrollbar {
  width: 5px;
}

.sidebar-scroll::-webkit-scrollbar-thumb {
  border-radius: 8px;
  background: rgba(86, 177, 212, 0.3);
}

.run-button {
  width: 100%;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #d8fff1;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 3px;
  border: 1px solid rgba(53, 205, 163, 0.55);
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(7, 74, 58, 0.9), rgba(5, 46, 44, 0.82));
  box-shadow: inset 0 0 18px rgba(22, 190, 143, 0.14);
  cursor: pointer;
  transition: 0.18s ease;
}

.run-button svg {
  width: 16px;
  height: 16px;
}

.run-button:hover {
  color: #ffffff;
  border-color: rgba(59, 229, 180, 0.9);
  background: linear-gradient(180deg, rgba(8, 105, 78, 0.95), rgba(6, 63, 57, 0.9));
  box-shadow: 0 0 18px rgba(34, 211, 164, 0.18);
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  padding: 7px 8px;
  border: 1px solid rgba(78, 166, 198, 0.28);
  border-radius: 7px;
  background: rgba(3, 21, 32, 0.66);
}

.brand-lockup {
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 5px;
  background: #f7fbff;
  box-shadow: 0 4px 14px rgba(0, 8, 18, 0.28);
}

.brand-lockup img {
  display: block;
  width: 142px;
  height: auto;
}

.view-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
}

.view-chip {
  width: 29px;
  height: 29px;
  display: grid;
  place-items: center;
  padding: 0;
  color: #6c9eb3;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition: 0.16s ease;
}

.view-chip svg {
  width: 18px;
  height: 18px;
}

.view-chip:hover {
  color: #bdefff;
  background: rgba(21, 116, 150, 0.24);
}

.view-chip.active {
  color: #5fe4ff;
  border-color: rgba(64, 210, 245, 0.45);
  background: rgba(14, 105, 137, 0.32);
  box-shadow: 0 0 14px rgba(36, 194, 238, 0.16);
}

.module-list {
  display: grid;
  gap: 7px;
  margin-top: 14px;
}

.module-group {
  border-radius: 6px;
}

.module-entry {
  width: 100%;
  min-height: 42px;
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  color: #b7d3df;
  text-align: left;
  border: 1px solid rgba(68, 148, 180, 0.22);
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(9, 38, 54, 0.84), rgba(6, 24, 36, 0.66));
  cursor: pointer;
  transition: 0.16s ease;
}

.module-entry:hover {
  color: #e8fbff;
  border-color: rgba(81, 179, 214, 0.42);
  background: linear-gradient(90deg, rgba(12, 64, 86, 0.9), rgba(7, 31, 46, 0.74));
}

.module-entry.active {
  color: #effcff;
  border-color: rgba(71, 197, 234, 0.6);
  background: linear-gradient(90deg, rgba(14, 90, 119, 0.88), rgba(8, 39, 55, 0.8));
  box-shadow: inset 3px 0 0 #2cd2f5;
}

.work-module .module-entry { grid-template-columns: 24px 1fr 24px auto; }
.work-module-icon { color: #a8d7ec; font-size: 16px; text-align: center; }
.work-refresh { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid rgba(58,183,223,.52); border-radius: 5px; color: #72e4ff; font: 16px/1 monospace; cursor: pointer; }
.work-refresh:hover { background: rgba(35,170,214,.2); }
.work-refresh.spinning { animation: work-spin .8s linear infinite; }
.work-list { display: grid; gap: 6px; max-height: 300px; overflow: auto; margin-top: 5px; padding: 6px; border: 1px solid rgba(55,135,168,.22); border-radius: 6px; background: rgba(3,18,29,.7); }
.work-card { padding: 8px; border: 1px solid rgba(48,143,180,.35); border-radius: 7px; background: linear-gradient(145deg,rgba(9,39,57,.95),rgba(5,25,39,.96)); }
.work-card-title { display: flex; align-items: center; gap: 5px; min-width: 0; }
.work-card-title > span { color: #c899ff; font-size: 10px; }
.work-card-title b { min-width: 0; flex: 1; overflow: hidden; color: #cce5f0; font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }
.work-card-title i { padding: 2px 5px; border-radius: 9px; color: #f0c47d; background: rgba(127,80,13,.35); font: normal 9px sans-serif; }
.work-card-title i.ready { color: #62efa0; background: rgba(16,112,62,.4); }
.work-card-meta { margin: 5px 0 7px; color: #7399ad; font: 9px/1.4 monospace; overflow: hidden; text-overflow: ellipsis; }
.work-card-actions { display: flex; align-items: center; justify-content: space-between; }
.work-card-actions button { padding: 4px 9px; border: 1px solid #168ec1; border-radius: 5px; color: #dff8ff; background: #075780; font-size: 10px; cursor: pointer; }
.work-card-actions button:disabled { opacity: .45; cursor: default; }
.work-card-actions span { color: #3de6b1; font-size: 9px; }
.work-card-actions .work-delete { width: 25px; padding: 0; margin-left: auto; color: #9cdae7; border-color: #27627a; background: #0b3146; }
.work-card-actions .work-delete:hover { color: #ff8999; border-color: #8d4350; background: #472632; }
.work-delete svg { width: 14px; height: 14px; vertical-align: middle; }
.work-message { margin: 5px; color: #789bad; font-size: 10px; line-height: 1.5; }
.work-message.error { color: #f0ae88; }
@keyframes work-spin { to { transform: rotate(360deg); } }

.module-icon {
  display: grid;
  place-items: center;
  color: #5bc6e8;
}

.module-icon svg {
  width: 21px;
  height: 21px;
}

.module-label {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-chevron {
  color: #6b9eb3;
  font-size: 18px;
  line-height: 1;
  transform: rotate(0deg);
  transition: 0.16s ease;
}

.module-group.active .module-chevron {
  color: #67e1ff;
}

.module-children {
  display: grid;
  gap: 2px;
  margin: 5px 0 2px 16px;
  padding-left: 10px;
  border-left: 1px solid rgba(70, 164, 198, 0.28);
}

.module-child {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  color: #8fb4c5;
  font-size: 12px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  transition: 0.15s ease;
}

.module-child:hover {
  color: #dff8ff;
  background: rgba(24, 100, 130, 0.22);
}

.module-child.active {
  color: #eaffff;
  border-color: rgba(68, 194, 231, 0.28);
  background: linear-gradient(90deg, rgba(17, 118, 151, 0.46), rgba(9, 49, 67, 0.2));
}

.child-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: #476f80;
}

.module-child.active .child-dot {
  background: #48dcff;
  box-shadow: 0 0 8px rgba(72, 220, 255, 0.8);
}

.sidebar-footer {
  flex: none;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 15px;
  color: #7fa9ba;
  font-size: 10px;
  border-top: 1px solid rgba(59, 137, 167, 0.28);
  background: rgba(3, 16, 26, 0.7);
}

.sidebar-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sidebar-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22d3a5;
  box-shadow: 0 0 8px rgba(34, 211, 165, 0.8);
}

.sidebar-footer time {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}

.sidebar-collapse {
  position: absolute;
  top: 50%;
  right: -13px;
  z-index: 2;
  width: 26px;
  height: 48px;
  display: grid;
  place-items: center;
  padding: 0;
  color: #9fd9ed;
  font-size: 18px;
  border: 1px solid rgba(72, 163, 196, 0.45);
  border-left: 0;
  border-radius: 0 7px 7px 0;
  background: rgba(6, 32, 47, 0.92);
  transform: translateY(-50%);
  cursor: pointer;
  transition: 0.16s ease;
}

.sidebar-collapse:hover {
  color: #ffffff;
  border-color: rgba(76, 206, 242, 0.8);
  background: rgba(10, 63, 84, 0.96);
}

@media (max-width: 1100px) {
  .app-sidebar {
    width: 232px;
  }

  .brand-lockup img {
    width: 122px;
  }
}
</style>

<style scoped>
.app-sidebar { width: 300px; background: linear-gradient(#101d2e, #0b1420); box-shadow: none; }
.sidebar-scroll { padding: 4px 7px 12px; flex: 1; }
.run-button { height: 28px; font-size: 12px; letter-spacing: 0; color: #00d4b5; background: #10373c; box-shadow: none; }
.brand-row { margin: 8px -7px 0; padding: 10px 8px; border: 0; border-bottom: 1px solid #203348; border-radius: 0; background: #0e1b2c; }
.brand-lockup { padding: 2px 4px; border-radius: 0; box-shadow: none; }
.brand-lockup img { width: 88px; height: 24px; object-fit: contain; }
.view-chip { width: 36px; height: 27px; background: #182a40; color: #98c9e4; }
.view-chip svg { width: 16px; height: 16px; }
.module-list { margin-top: 8px; }
.module-entry { min-height: 46px; background: #132133; border-color: #20364b; border-radius: 9px; }
.module-icon svg { width: 17px; height: 17px; }
.module-entry.active { background: #1b3248; box-shadow: none; }
.module-chevron.open { transform: rotate(90deg); color: #67e1ff; }
.terrain-module-icon { color: #80cdb9; }
.slice-module-icon { color: #7f9fe8; }
.feature-controls { margin: 5px 0 3px; padding: 9px 10px 11px; border: 1px solid #20384c; border-radius: 7px; background: #101f30; box-shadow: inset 0 1px #223b50; }
.feature-controls, .feature-controls * { box-sizing: border-box; }
.feature-section-title { display: flex; align-items: center; gap: 7px; margin: 8px 0 7px; color: #5f849c; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }
.feature-section-title::after { content: ''; height: 1px; flex: 1; background: #274257; }
.feature-slider { display: grid; gap: 5px; margin: 0 0 10px; color: #8eb0c4; font-size: 10px; }
.feature-slider span { display: flex; justify-content: space-between; align-items: center; }
.feature-slider b { color: #7bd9f3; font: 10px ui-monospace, monospace; }
.feature-slider input[type='range'] { width: 100%; height: 3px; margin: 0; accent-color: #24d2bf; cursor: pointer; }
.feature-select { display: grid; gap: 5px; margin: 1px 0 10px; color: #789db1; font-size: 9px; }
.feature-select select { width: 100%; height: 28px; padding: 0 8px; color: #c5e1ec; border: 1px solid #28465f; border-radius: 5px; background: #182e43; outline: none; }
.feature-switch { position: relative; width: 100%; min-height: 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 6px; color: #a9c1cf; font-size: 10px; cursor: pointer; }
/* 让可聚焦的原生控件始终与当前可见行重合，避免浏览器为 1px 绝对定位焦点自动滚动页面。 */
.feature-switch input { position: absolute; z-index: 2; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.feature-switch > span:last-child { min-width: 0; order: 1; }
.feature-switch .switch-track { position: relative; order: 2; flex: 0 0 auto; width: 38px; height: 20px; border-radius: 999px; border: 1px solid #365875; background: #223a55; transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; box-sizing: border-box; }
.feature-switch .switch-track i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #819fbe; box-shadow: 0 1px 3px rgba(0, 7, 17, 0.48); transition: transform 0.18s ease, background 0.18s ease; }
.feature-switch input:focus-visible + .switch-track { outline: 2px solid rgba(83, 207, 242, 0.72); outline-offset: 2px; }
.feature-switch input:checked + .switch-track { background: #12649a; border-color: #3f9fe2; box-shadow: inset 0 0 8px rgba(59, 174, 255, 0.2); }
.feature-switch input:checked + .switch-track i { transform: translateX(18px); background: #55b5ff; }
.volume-state { min-height: 29px; display: flex; align-items: center; gap: 8px; padding: 0 9px; color: #98bacb; font: 9px ui-monospace, monospace; border: 1px solid #28536a; border-radius: 5px; background: #153346; }
.volume-cube { color: #dc807f; font-size: 11px; }
.db-control-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px; color: #7f9eaf; font-size: 9px; }
.stepper { min-width: 0; height: 27px; display: grid; grid-template-columns: 26px minmax(0, 1fr) auto 26px; align-items: center; border: 1px solid #2b4960; border-radius: 4px; overflow: hidden; background: #172b40; }
.stepper button { height: 100%; padding: 0; color: #75bee0; border: 0; background: #203d57; cursor: pointer; }
.stepper input { min-width: 0; width: 100%; height: 100%; padding: 0 2px; color: #d5ebf3; text-align: center; border: 0; background: transparent; outline: 0; font: 10px ui-monospace, monospace; appearance: textfield; }
.stepper input::-webkit-inner-spin-button { appearance: none; }
.stepper em { color: #6f90a4; font-size: 8px; font-style: normal; }
.feature-fold { margin-top: 9px; border: 1px solid #243d51; border-radius: 5px; background: #14283a; }
.feature-fold summary { height: 30px; display: flex; align-items: center; justify-content: space-between; padding: 0 9px; color: #a1bdcb; font-size: 10px; cursor: pointer; list-style: none; }
.feature-fold summary::-webkit-details-marker { display: none; }
.feature-fold summary small { color: #587c91; font-size: 8px; }
.feature-fold[open] summary { margin-bottom: 8px; border-bottom: 1px solid #253e52; }
.compact-slider { margin: 0 9px 10px; }
.move-control { display: grid; gap: 4px; margin: 0 9px 8px; color: #7599ac; font-size: 9px; }
.feature-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.feature-actions button { height: 29px; color: #a9c8d6; border: 1px solid #2d4b60; border-radius: 5px; background: #182e42; cursor: pointer; font-size: 9px; }
.feature-actions button.active { color: #55e7cd; border-color: #218b84; background: #153b40; }
.feature-actions .danger-action { color: #e7a8b0; border-color: #6a3e50; background: #402735; }
.terrain-controls { padding-top: 5px; }
.vertical-slice-controls { padding-top: 5px; }
.app-sidebar.collapsed { width: 52px; }
.collapsed .sidebar-scroll { padding: 4px 5px; overflow-x: hidden; }
.collapsed .run-button span, .collapsed .brand-lockup, .collapsed .module-label, .collapsed .module-chevron,
.collapsed .module-children, .collapsed .feature-controls, .collapsed .work-list, .collapsed .work-refresh, .collapsed .sidebar-footer { display: none; }
.collapsed .brand-row { margin: 8px 0; padding: 8px 0; }
.collapsed .view-switcher { flex-direction: column; width: 100%; gap: 7px; }
.collapsed .module-entry { grid-template-columns: 1fr; padding: 0; min-height: 36px; }
.sidebar-collapse { width: 22px; right: -22px; }
@media (max-width: 1100px) { .app-sidebar { width: 260px; } }
</style>
