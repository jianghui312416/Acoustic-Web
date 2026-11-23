<template>
  <aside class="app-sidebar" :class="{ collapsed }" aria-label="主导航">
    <div class="sidebar-scroll">
      <button type="button" class="run-button" title="运行示例位置的声场计算" aria-label="模拟运行" @click="$emit('run')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
        </svg>
        <span>运行</span>
      </button>

      <div class="brand-row">
        <div class="brand-lockup" title="星图深海公司研制">
          <img src="/branding/xingtu-shenhai.svg" alt="星图深海" />
        </div>
        <div class="view-switcher" role="group" aria-label="视图切换">
          <button
            type="button"
            class="view-chip"
            :class="{ active: viewMode === 'globe' }"
            title="全球视图（G）"
            aria-label="全球视图"
            @click="$emit('select-view-mode', 'globe')"
          >
            <span class="view-chip-emoji" aria-hidden="true">🌏</span>
          </button>
          <button
            type="button"
            class="view-chip"
            :class="{ active: viewMode === 'terrain' }"
            title="地形预览（M）"
            aria-label="地形预览"
            @click="$emit('select-view-mode', 'terrain')"
          >
            <span class="view-chip-emoji" aria-hidden="true">⛰️</span>
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
            <span class="view-chip-emoji" aria-hidden="true">🗺️</span>
          </button>
        </div>
      </div>

      <nav class="module-list" aria-label="业务模块">
        <section class="module-group weather-noise-module" :class="{ active: weatherNoiseOpen }">
          <button type="button" class="module-entry" :class="{ active: weatherNoiseOpen }" title="预报天气（海面10米风速、降雨、海况）与环境噪声" aria-label="天气与环境噪声" @click="weatherNoiseOpen = !weatherNoiseOpen">
            <span class="module-icon weather-module-icon" aria-hidden="true">🌊</span>
            <span class="module-label">天气与环境噪声</span>
            <span class="module-chevron" :class="{ open: weatherNoiseOpen }" aria-hidden="true">›</span>
          </button>
          <WeatherNoiseSidebar v-if="weatherNoiseOpen && viewMode === 'terrain'" @pick-on-map="$emit('select-view-mode', 'terrain')" />
          <p v-else-if="weatherNoiseOpen" class="module-mode-hint">进入地形模式（M）加载场景的预报。</p>
        </section>

        <section class="module-group ais-monitor-module" :class="{ active: aisOpen }">
          <button
            ref="aisMenuEntryRef"
            type="button"
            class="module-entry"
            :class="{ active: aisOpen }"
            title="船舶监测"
            aria-label="船舶监测"
            :aria-expanded="aisOpen"
            @click.stop="toggleAisMonitor"
          >
            <span class="module-icon ais-monitor-icon" aria-hidden="true">
              <span class="module-icon-emoji">🚢</span>
            </span>
            <span class="module-label">船舶监测</span>
            <span class="module-chevron" :class="{ open: aisOpen }" aria-hidden="true">›</span>
          </button>
          <AisMonitorSidebar v-if="aisOpen" :view-mode="viewMode" @navigate="$emit('select-view-mode', $event)" />
        </section>

        <section class="module-group signal-excess-module" :class="{ active: signalExcessOpen }">
          <button
            type="button"
            class="module-entry"
            :class="{ active: signalExcessOpen }"
            title="信号余量"
            aria-label="信号余量"
            @click="signalExcessOpen = !signalExcessOpen"
          >
            <span class="module-icon signal-excess-icon" aria-hidden="true">
              <span class="module-icon-emoji">📡</span>
            </span>
            <span class="module-label">信号余量</span>
            <span class="module-chevron" :class="{ open: signalExcessOpen }" aria-hidden="true">›</span>
          </button>
          <SignalExcessPanel v-if="signalExcessOpen && volumeControlsAvailable" />
          <p v-else-if="signalExcessOpen" class="module-mode-hint">进入地形模式并运行声场——声场体成为接收器。</p>
        </section>

        <section class="module-group" :class="{ active: sliceControlsOpen }">
          <button
            type="button"
            class="module-entry"
            :class="{ active: sliceControlsOpen }"
            title="声场体垂直切面"
            aria-label="垂直切面"
            @click="toggleSliceControls"
          >
            <span class="module-icon slice-module-icon" aria-hidden="true">
              <span class="module-icon-emoji">📐</span>
            </span>
            <span class="module-label">垂直切面</span>
            <span class="module-chevron" :class="{ open: sliceControlsOpen }" aria-hidden="true">›</span>
          </button>

          <div v-if="sliceControlsOpen" class="feature-controls vertical-slice-controls" @click.stop>
            <template v-if="volumeControlsAvailable">
              <label class="feature-switch">
                <input v-model="sliceControls.showSlice" type="checkbox" />
                <span class="switch-track"><i></i></span>
                <span>显示切面</span>
              </label>
            <label class="feature-slider">
              <span>方位角（正北 0°）<b>{{ Math.round(sliceControls.sliceAzimuthDeg) }}°</b></span>
              <input
                v-if="sliceAzimuthOptions.length"
                :value="sliceAzimuthIndex"
                type="range"
                min="0"
                :max="Math.max(0, sliceAzimuthOptions.length - 1)"
                step="1"
                :disabled="sliceAzimuthOptions.length <= 1"
                @input="onSliceAzimuthInput"
              />
              <input
                v-else
                v-model.number="sliceControls.sliceAzimuthDeg"
                type="range"
                min="0"
                max="359"
                step="1"
                @input="normalizeSliceControls"
              />
            </label>
            <p class="feature-section-title">dB 范围（与三维声场体共用）</p>
            <div class="db-control-grid">
              <span>Min</span><span>Max</span>
              <div class="stepper"><button type="button" @click="stepDb('dbMin', -1)">−</button><input v-model.number="visualControls.dbMin" type="number" min="0" max="199" @change="normalizeControls" /><em>dB</em><button type="button" @click="stepDb('dbMin', 1)">＋</button></div>
              <div class="stepper"><button type="button" @click="stepDb('dbMax', -1)">−</button><input v-model.number="visualControls.dbMax" type="number" min="1" max="200" @change="normalizeControls" /><em>dB</em><button type="button" @click="stepDb('dbMax', 1)">＋</button></div>
            </div>
            <div class="color-scale-bar" :style="{ background: sliceColorGradient }"></div>
            <p class="feature-section-title">显示</p>
            <label class="feature-switch">
              <input v-model="sliceControls.seafloorLineAndMask" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">〰️</span><span>海底掩膜线 + 海底掩膜</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.seafloorMask" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">◼️</span><span>海底掩膜</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.east90Indicator" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">🧭</span><span>方位方向线</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.clipBody" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label" title="沿方位方向线所在的竖直平面裁掉半个体，只保留一半"><span aria-hidden="true">✂</span><span>裁剪体</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.sspWindow" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">📈</span><span>声速剖面窗口</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="sliceControls.cursorReadout" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">🔎</span><span>光标读取</span></span>
            </label>
            <details class="feature-fold ray-playback-fold">
              <summary>
                <span>声线播放</span>
                <small>{{ sliceControls.dynamicRays ? '动态' : sliceControls.staticRays ? '静态' : '已关闭' }}</small>
              </summary>
              <label class="feature-switch compact-switch">
                <input v-model="sliceControls.dynamicRays" type="checkbox" />
                <span class="switch-track"><i></i></span>
                <span>动态声线</span>
              </label>
              <label class="feature-switch compact-switch">
                <input v-model="sliceControls.staticRays" type="checkbox" />
                <span class="switch-track"><i></i></span>
                <span>静态声线</span>
              </label>
              <label class="feature-slider compact-slider">
                <span>播放速度<b>{{ Number(sliceControls.raySpeed).toFixed(2) }}×</b></span>
                <input v-model.number="sliceControls.raySpeed" type="range" min="0.25" max="8" step="0.05" @input="normalizeSliceControls" />
              </label>
              <label class="feature-slider compact-slider">
                <span>播放时间<b>t ~ {{ (rayTimeMs / 1000).toFixed(2) }} s</b></span>
                <input :value="rayTimeMs" type="range" min="0" :max="sliceControls.rayTimelineMs" :step="RAY_TIME_STEP_MS" aria-label="声线播放时间" @input="onRayTimeInput" />
              </label>
            </details>
            </template>
            <template v-else>
              <div class="feature-unavailable disabled"><span aria-hidden="true">📦</span><b>切片功能已禁用</b></div>
              <p class="feature-unavailable-hint">请先进入地形模式并显示三维声场体</p>
            </template>
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
              <span v-if="moduleItem.viewKey === 'acoustic-field'" class="module-icon-emoji">🧊</span>
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
            <template v-if="volumeControlsAvailable">
              <div class="volume-state">
                <span class="volume-cube" aria-hidden="true">◆</span>
                <span>{{ visualControls.volumeVisible ? '体数据已显示' : '体数据已隐藏' }}</span>
              </div>

            <p class="feature-section-title">外观</p>
            <label class="feature-slider">
              <span>透明度 α <b>{{ formatControl(visualControls.opacity, 2) }}</b></span>
              <input v-model.number="visualControls.opacity" type="range" min="0" max="1" step="0.01" @input="normalizeControls" />
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
            <div class="color-scale-bar" :style="{ background: volumeColorGradient }"></div>

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
            </template>
            <template v-else>
              <div class="feature-unavailable"><span aria-hidden="true">📦</span><b>未加载卷</b></div>
              <p class="feature-unavailable-hint">进入地形模式并加载三维声场体</p>
            </template>
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

        <section class="module-group signal-transmission-module" :class="{ active: signalTransmissionOpen }">
          <button
            type="button"
            class="module-entry"
            :class="{ active: signalTransmissionOpen }"
            title="信号传输"
            aria-label="信号传输"
            @click="signalTransmissionOpen = !signalTransmissionOpen"
          >
            <span class="module-icon signal-transmission-icon" aria-hidden="true">
              <span class="module-icon-emoji">📶</span>
            </span>
            <span class="module-label">信号传输</span>
            <span class="module-chevron" :class="{ open: signalTransmissionOpen }" aria-hidden="true">›</span>
          </button>
          <div v-if="signalTransmissionOpen" class="feature-controls signal-transmission-controls" @click.stop>
            <SignalTransmissionControls @run="$emit('run-signal')" @stop="$emit('stop-signal')" />
          </div>
        </section>

        <section class="module-group" :class="{ active: simulation.sidebarOpen }">
          <button
            type="button"
            class="module-entry"
            :class="{ active: simulation.sidebarOpen }"
            title="仿真配置"
            aria-label="仿真配置"
            @click="toggleSimulationControls"
          >
            <span class="module-icon simulation-module-icon" aria-hidden="true">
              <span class="module-icon-emoji">⚙️</span>
            </span>
            <span class="module-label">仿真配置</span>
            <span class="module-chevron" :class="{ open: simulation.sidebarOpen }" aria-hidden="true">›</span>
          </button>

          <div v-if="simulation.sidebarOpen" class="feature-controls simulation-controls" @click.stop>
            <label class="feature-select">
              <span>仿真模型</span>
              <select v-model="simulation.model" @change="normalizeSimulationControls">
                <option v-for="item in simulationModels" :key="item.id" :value="item.id">🧠 {{ item.label }}</option>
              </select>
            </label>

            <div class="feature-select simulation-time">
              <span>仿真时间</span>
              <div class="simulation-time-field">
                <button type="button" class="simulation-time-trigger" @click="openSimulationTimePicker">
                  <span>UTC {{ simulationTimeText }}</span>
                  <svg class="simulation-time-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" />
                    <path d="M3.5 9h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                    <path d="M7.5 12.5h3M7.5 16h3M13.5 12.5h3M13.5 16h3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                  </svg>
                </button>
                <input
                  ref="simulationTimeInputRef"
                  class="simulation-time-native"
                  type="datetime-local"
                  step="60"
                  :value="simulationTimeInputValue"
                  aria-label="仿真时间"
                  @input="onSimulationTimeInput"
                />
              </div>
            </div>

            <div class="simulation-grid">
              <label>
                <span>经度</span>
                <input v-model.number="simulation.coordX" type="number" step="0.0001" min="-180" max="180" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>纬度</span>
                <input v-model.number="simulation.coordY" type="number" step="0.0001" min="-90" max="90" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>声源深度 (m)</span>
                <input v-model.number="simulation.srcDepth" type="number" step="1" min="0" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>运行频率 (Hz)</span>
                <input v-model.number="simulation.frequency" type="number" step="1" min="1" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>距离 (nmi)</span>
                <input v-model.number="simulation.range" type="number" step="0.1" min="0.1" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>俯角 (°)</span>
                <input v-model.number="simulation.grazingAngleMin" type="number" step="1" min="-90" max="90" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>仰角 (°)</span>
                <input v-model.number="simulation.grazingAngleMax" type="number" step="1" min="-90" max="90" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>方位数</span>
                <input v-model.number="simulation.sector" type="number" step="1" min="1" max="360" @change="normalizeSimulationControls" />
              </label>
              <label>
                <span>声线条数</span>
                <input v-model.number="simulation.lineCount" type="number" step="1" min="0" @change="normalizeSimulationControls" />
              </label>
            </div>

            <label class="feature-select">
              <span>相干性</span>
              <select v-model="simulation.coherent" @change="normalizeSimulationControls">
                <option :value="true">相干</option>
                <option :value="false">非相干</option>
              </select>
            </label>

            <button type="button" class="simulation-run-button" @click="$emit('run')">
              <span aria-hidden="true">▶</span>
              {{ runSimulationLabel }}
            </button>
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
              <span class="module-icon-emoji">⛰️</span>
            </span>
            <span class="module-label">地形</span>
            <span class="module-chevron" :class="{ open: terrainControlsOpen }" aria-hidden="true">›</span>
          </button>

          <div v-if="terrainControlsOpen" class="feature-controls terrain-controls" @click.stop>
            <p class="feature-section-title">显示</p>
            <label class="feature-slider">
              <span>垂直夸张 <b>{{ formatControl(visualControls.terrainExaggeration, 1) }}×</b></span>
              <input v-model.number="visualControls.terrainExaggeration" aria-label="垂直夸张倍率" type="range" min="0.5" max="50" step="0.1" @input="normalizeControls" />
            </label>
            <label class="feature-slider">
              <span>地形亮度 <b>{{ formatControl(visualControls.terrainBrightness, 2) }}×</b></span>
              <input v-model.number="visualControls.terrainBrightness" aria-label="地形整体亮度" type="range" min="0.5" max="4" step="0.05" @input="normalizeControls" />
            </label>
            <label class="feature-switch">
              <input v-model="visualControls.terrainBands" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">▤</span><span>高程色带</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="visualControls.terrainFog" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">≋</span><span>距离雾</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="visualControls.terrainContours" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">〰️</span><span>等高线</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="visualControls.terrainCoastline" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">◠</span><span>海岸线</span></span>
            </label>
            <label class="feature-switch">
              <input v-model="visualControls.terrainShadows" type="checkbox" />
              <span class="switch-track"><i></i></span>
              <span class="feature-switch-label"><span aria-hidden="true">☾</span><span>地形阴影</span></span>
            </label>

            <details class="feature-fold seafloor-feature-fold">
              <summary>
                <span>🏷️ 海底地名</span>
                <small>{{ seafloorFeatureState.enabled ? '已开启' : '已关闭' }}</small>
              </summary>
              <label class="feature-switch compact-switch">
                <input
                  :checked="seafloorFeatureState.enabled"
                  type="checkbox"
                  @change="setSeafloorFeatureEnabled($event.target.checked)"
                />
                <span class="switch-track"><i></i></span>
                <span>显示地名标注</span>
              </label>
              <label class="feature-switch compact-switch" :class="{ 'switch-disabled': !seafloorFeatureState.enabled }">
                <input
                  :checked="seafloorFeatureState.showBoundaries"
                  type="checkbox"
                  :disabled="!seafloorFeatureState.enabled"
                  @change="setSeafloorFeatureBoundaries($event.target.checked)"
                />
                <span class="switch-track"><i></i></span>
                <span>显示范围边界</span>
              </label>
            </details>
          </div>
        </section>

        <section class="module-group work-module" :class="{ active: workOpen }">
          <button type="button" class="module-entry" :class="{ active: workOpen }" title="运行记录恢复" aria-label="工作" @click="workOpen = !workOpen">
            <span class="module-icon work-module-icon" aria-hidden="true"><span class="module-icon-emoji">📁</span></span>
            <span class="module-label">工作区</span>
            <span class="work-refresh" :class="{ spinning: jobWorkspace.loading }" role="button" tabindex="0" title="刷新工作" aria-label="刷新工作" @click.stop="refreshJobWorkspace" @keydown.enter.stop="refreshJobWorkspace">↻</span>
            <span class="module-chevron" :class="{ open: workOpen }" aria-hidden="true">›</span>
          </button>
          <div v-if="workOpen" class="work-list" @click.stop>
            <p v-if="jobWorkspace.error" class="work-message error">{{ jobWorkspace.error }}</p>
            <p v-else-if="jobWorkspace.loading && !jobWorkspace.jobs.length" class="work-message">正在读取工作区项目…</p>
            <p v-else-if="!jobWorkspace.jobs.length" class="work-message">暂无可打开的三维声场历史工作项目</p>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  VOLUME_COLORMAPS,
  acousticSceneState,
  activeVolumeColorStops,
  clampVolumeRenderingControls,
  volumeRenderingControls,
} from '@/modules/acoustic/volumeRenderingControls.js'
import {
  clampVerticalSliceControls,
  verticalSliceControls,
} from '@/modules/acoustic/verticalSliceControls.js'
import {
  SIMULATION_MODELS,
  clampSimulationControls,
  simulationControls,
} from '@/modules/acoustic/simulationControls.js'
import { rayFlowTimelinePositionMs, seekRayFlowClock } from '@/utils/rayFlowClock.js'
import { deleteAcousticJob } from '@/api/jobWorkspaceApi.js'
import { jobWorkspace, refreshJobWorkspace, requestCloseJob, requestOpenJob } from '@/modules/acoustic/jobWorkspace.js'
import WeatherNoiseSidebar from '@/components/weather/WeatherNoiseSidebar.vue'
import SignalExcessPanel from '@/components/acoustic/SignalExcessPanel.vue'
import SignalTransmissionControls from '@/components/acoustic/SignalTransmissionControls.vue'
import AisMonitorSidebar from '@/components/ais/AisMonitorSidebar.vue'
import { aisMonitorState } from '@/modules/ais/aisMonitorStore.js'
import {
  seafloorFeatureState,
  setSeafloorFeatureBoundaries,
  setSeafloorFeatureEnabled,
} from '@/modules/terrain/seafloorFeatureState.js'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  modules: { type: Array, default: () => [] },
  activeModuleId: { type: String, default: '' },
  activeSubmoduleId: { type: String, default: '' },
  submoduleActive: { type: Boolean, default: false },
  viewMode: { type: String, default: 'globe' },
  thumbnailCollapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['select-module', 'select-submodule', 'select-view-mode', 'toggle-collapse', 'toggle-thumbnail', 'run', 'run-signal', 'stop-signal'])

const clockText = ref('')
const rayTimeMs = ref(0)
const simulationTimeInputRef = ref(null)
const workOpen = ref(false)
const openingJobId = ref('')
const deletingJobId = ref('')
const terrainControlsOpen = ref(false)
const weatherNoiseOpen = ref(false)
const sliceControlsOpen = ref(false)
const signalExcessOpen = ref(false)
const signalTransmissionOpen = ref(false)
const aisOpen = ref(false)
const aisMenuEntryRef = ref(null)
// 刷新后侧边栏全部收起：不根据当前模块预展开任何下拉。
const expandedModuleIds = ref(new Set())
const visualControls = volumeRenderingControls
const sliceControls = verticalSliceControls
const simulation = simulationControls
const simulationModels = SIMULATION_MODELS
const volumeColormaps = VOLUME_COLORMAPS

function toggleAisMonitor() {
  const opening = !aisOpen.value
  aisOpen.value = opening
  if (!opening) return
  if (props.collapsed) emit('toggle-collapse')
  nextTick(() => aisMenuEntryRef.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
}

watch(() => aisMonitorState.panelRequested, (requested) => {
  if (!requested) return
  aisOpen.value = true
  if (props.collapsed) emit('toggle-collapse')
  aisMonitorState.panelRequested = false
})
const simulationTimeText = computed(() => {
  const raw = String(simulation.time || '').replace('T', ' ')
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : '2025-01-02 12:00'
})
const simulationTimeInputValue = computed(() => simulationTimeText.value.replace(' ', 'T'))
/** 运行按钮按当前仿真模型显示算法名：射线模型=Bellhop，RAM=Ram。 */
const runSimulationLabel = computed(() => {
  const model = String(simulation.model || 'bellhop').toLowerCase()
  const name = model === 'ram' ? 'Ram' : 'Bellhop'
  return `运行仿真（${name}）`
})
const volumeControlsAvailable = computed(() => props.viewMode === 'terrain' && acousticSceneState.hasTerrainVolume)
function stopsToGradient(stops) {
  return `linear-gradient(90deg, ${(stops || []).map(([t, rgb]) => `rgb(${rgb.join(',')}) ${(Number(t) * 100).toFixed(1)}%`).join(', ')})`
}
const volumeColorGradient = computed(() => stopsToGradient(activeVolumeColorStops(visualControls.colormap)))
// 垂直切面的色标类型跟随三维体绘制的色图，两者保持同一色带。
const sliceColorGradient = computed(() => stopsToGradient(activeVolumeColorStops(visualControls.colormap)))
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
let rayTimeTimer = 0
let lastRaySeekAt = 0
const RAY_TIME_STEP_MS = 50

function normalizeControls() {
  clampVolumeRenderingControls(visualControls)
}

function normalizeSliceControls() {
  clampVerticalSliceControls(sliceControls)
}

/** 方位方向线所在声场体的实际计算方位（罗盘方位，升序）。 */
const sliceAzimuthOptions = computed(() => (
  Array.isArray(acousticSceneState.sliceAzimuths)
    ? acousticSceneState.sliceAzimuths.map(Number).filter(Number.isFinite)
    : []
))
const sliceAzimuthIndex = computed(() => {
  const options = sliceAzimuthOptions.value
  if (!options.length) return 0
  const current = ((Number(sliceControls.sliceAzimuthDeg) || 0) % 360 + 360) % 360
  let best = 0
  let bestDiff = Infinity
  options.forEach((value, index) => {
    const raw = Math.abs(value - current) % 360
    const diff = Math.min(raw, 360 - raw)
    if (diff < bestDiff) {
      bestDiff = diff
      best = index
    }
  })
  return best
})

/** 侧边栏方位滑杆：只在实际计算的方位之间按索引滑动。 */
function onSliceAzimuthInput(event) {
  const index = Math.round(Number(event?.target?.value))
  const value = sliceAzimuthOptions.value[index]
  if (!Number.isFinite(value)) return
  sliceControls.sliceAzimuthDeg = value
  normalizeSliceControls()
}

function normalizeSimulationControls() {
  clampSimulationControls(simulation)
}

function openSimulationTimePicker() {
  const input = simulationTimeInputRef.value
  if (!input) return
  try {
    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }
  } catch {}
  input.focus()
  input.click()
}

function onSimulationTimeInput(event) {
  const value = String(event?.target?.value || '')
  if (!value) return
  simulation.time = value.length === 16 ? `${value}:00` : value
}

function syncRayTimePosition() {
  if (!sliceControlsOpen.value) return
  if (performance.now() - lastRaySeekAt < 600) return
  const position = rayFlowTimelinePositionMs(sliceControls.rayTimelineMs)
  rayTimeMs.value = Math.round(position / RAY_TIME_STEP_MS) * RAY_TIME_STEP_MS
}

function onRayTimeInput(event) {
  const value = Number(event?.target?.value)
  rayTimeMs.value = Number.isFinite(value) ? value : 0
  lastRaySeekAt = performance.now()
  seekRayFlowClock(rayTimeMs.value)
}

function formatControl(value, digits = 1) {
  return Number(value).toFixed(digits)
}

function toggleTerrainControls() {
  terrainControlsOpen.value = !terrainControlsOpen.value
  if (!terrainControlsOpen.value) return
  emit('select-view-mode', 'terrain')
}

function toggleSimulationControls() {
  simulation.sidebarOpen = !simulation.sidebarOpen
}

function toggleSliceControls() {
  sliceControlsOpen.value = !sliceControlsOpen.value
  if (sliceControlsOpen.value) {
    lastRaySeekAt = 0
    syncRayTimePosition()
  }
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
  syncRayTimePosition()
  rayTimeTimer = window.setInterval(syncRayTimePosition, 100)
  refreshJobWorkspace()
})

watch(() => props.activeModuleId, (moduleId) => {
  if (!moduleId || expandedModuleIds.value.has(moduleId)) return
  expandedModuleIds.value = new Set([...expandedModuleIds.value, moduleId])
})

onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.clearInterval(rayTimeTimer)
})
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

.view-chip-emoji {
  font-size: 16px;
  line-height: 1;
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

.module-icon-emoji {
  font-size: 18px;
  line-height: 1;
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
.app-sidebar { width: 320px; background: linear-gradient(#101d2e, #0b1420); box-shadow: none; }
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
.signal-excess-icon { color: #5ad7ea; }
.signal-transmission-icon { color: #7ec8ff; }
.ais-monitor-icon { color: #4fdaef; }
.signal-transmission-controls { padding-top: 5px; }
.feature-controls { margin: 5px 0 3px; padding: 9px 10px 11px; border: 1px solid #20384c; border-radius: 7px; background: #101f30; box-shadow: inset 0 1px #223b50; }
.feature-controls, .feature-controls * { box-sizing: border-box; }
.feature-unavailable { min-height: 45px; display: flex; align-items: center; gap: 8px; padding: 0 11px; color: #a9c5d3; border: 1px solid #29465d; border-radius: 6px; background: #182b40; font-size: 10px; }
.feature-unavailable span { color: #ef7894; font-size: 13px; }
.feature-unavailable b { font-weight: 500; }
.feature-unavailable.disabled { min-height: 34px; }
.feature-unavailable-hint,.module-mode-hint { margin: 8px 3px 1px; color: #6f8da0; text-align: center; font-size: 9px; line-height: 1.5; }
.module-mode-hint { margin: 5px 0 3px; padding: 9px 8px 10px; border: 1px solid #20384c; border-radius: 7px; background: #101f30; }
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
.feature-switch > .feature-switch-label { min-width: 0; flex: 1; order: 1; display: flex; align-items: center; gap: 5px; }
.feature-switch-label > span:first-child { flex: 0 0 1.5em; width: 1.5em; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; line-height: 1; }
.feature-switch-label > span:last-child { min-width: 0; }
.feature-switch .switch-track { position: relative; order: 2; flex: 0 0 auto; width: 38px; height: 20px; border-radius: 999px; border: 1px solid #365875; background: #223a55; transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; box-sizing: border-box; }
.feature-switch .switch-track i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #819fbe; box-shadow: 0 1px 3px rgba(0, 7, 17, 0.48); transition: transform 0.18s ease, background 0.18s ease; }
.feature-switch input:focus-visible + .switch-track { outline: 2px solid rgba(83, 207, 242, 0.72); outline-offset: 2px; }
.feature-switch input:checked + .switch-track { background: #12649a; border-color: #3f9fe2; box-shadow: inset 0 0 8px rgba(59, 174, 255, 0.2); }
.feature-switch input:checked + .switch-track i { transform: translateX(18px); background: #55b5ff; }
.feature-switch.switch-disabled { opacity: 0.45; cursor: not-allowed; }
.feature-switch.switch-disabled input { cursor: not-allowed; }
.volume-state { min-height: 29px; display: flex; align-items: center; gap: 8px; padding: 0 9px; color: #98bacb; font: 9px ui-monospace, monospace; border: 1px solid #28536a; border-radius: 5px; background: #153346; }
.volume-cube { color: #dc807f; font-size: 11px; }
.db-control-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px; color: #7f9eaf; font-size: 9px; }
.color-scale-bar { height: 7px; margin: 6px 0 2px; border-radius: 3px; border: 1px solid #274257; }
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
.simulation-module-icon { color: #e0b36a; }
.simulation-controls { padding-top: 5px; }
.simulation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 8px; margin: 2px 0 10px; }
.simulation-grid label { display: grid; gap: 4px; min-width: 0; color: #7f9eaf; font-size: 9px; }
.simulation-grid input { width: 100%; min-width: 0; height: 27px; padding: 0 7px; color: #d5ebf3; border: 1px solid #2b4960; border-radius: 4px; background: #172b40; outline: none; font: 10px ui-monospace, monospace; appearance: textfield; }
.simulation-grid input::-webkit-inner-spin-button { appearance: none; }
.simulation-grid input:focus { border-color: #3d7895; box-shadow: 0 0 0 1px rgba(61, 120, 149, 0.35); }
.simulation-time-field { position: relative; width: 100%; height: 28px; }
.simulation-time-trigger { width: 100%; height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 8px; color: #c5e1ec; border: 1px solid #28465f; border-radius: 5px; background: #182e43; cursor: pointer; font: 10px ui-monospace, monospace; }
.simulation-time-trigger:hover { border-color: #3d7895; background: #1c3a50; }
.simulation-time-icon { width: 15px; height: 15px; flex: none; color: #7bd9f3; }
.simulation-time-native { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; pointer-events: none; }
.simulation-run-button { width: 100%; height: 30px; display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 2px; color: #65f0d2; border: 1px solid #218b84; border-radius: 5px; background: #153b40; cursor: pointer; font-size: 10px; letter-spacing: 1px; }
.simulation-run-button:hover { color: #eaffff; border-color: #37b8aa; background: #1a4b50; }
.vertical-slice-controls { padding-top: 5px; }
.ray-playback-fold { margin-top: 7px; }
.ray-playback-fold .compact-switch { margin: 0 0 5px; padding: 0 9px; }
.seafloor-feature-fold .compact-switch { margin: 0 0 5px; padding: 0 9px; }
.ray-playback-fold .compact-slider { margin: 3px 9px 8px; }
.ray-playback-fold .compact-slider:last-child { margin-bottom: 9px; }
.app-sidebar.collapsed { width: 52px; }
.collapsed .sidebar-scroll { padding: 4px 5px; overflow-x: hidden; }
.collapsed .run-button span, .collapsed .brand-lockup, .collapsed .module-label, .collapsed .module-chevron,
.collapsed .module-children, .collapsed .feature-controls, .collapsed .work-list, .collapsed .work-refresh, .collapsed .sidebar-footer, .collapsed .wn-panel, .collapsed .ais-monitor { display: none; }
.collapsed .brand-row { margin: 8px 0; padding: 8px 0; }
.collapsed .view-switcher { flex-direction: column; width: 100%; gap: 7px; }
.collapsed .module-entry { grid-template-columns: 1fr; padding: 0; min-height: 36px; }
.sidebar-collapse { width: 22px; right: -22px; }
@media (max-width: 1100px) { .app-sidebar { width: 260px; } }
</style>
