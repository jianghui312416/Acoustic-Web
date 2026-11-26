<template>
  <div ref="rootEl" class="tl-volume-root" :class="{ 'module-open': sidebarOpen, 'terrain-mode': viewMode === 'terrain', 'terrain-leaving': terrainLeaving }">
    <div id="earthContainer" ref="cesiumContainer" class="cesium-container"></div>

    <TerrainGlobeSelector
      v-if="viewerReady"
      :active="viewMode === 'globe' && !terrainLeaving"
      :viewer="activeViewer"
      :selection-bounds="globeSelection"
      :return-active="terrainReturnAvailable"
      @load="loadGlobeTerrain"
      @return="returnToTerrain"
      @select="clearTerrainReturn"
    />

    <AisGlobalOverlay
      v-if="viewerReady && aisMonitorState.displayEnabled"
      :active="viewMode === 'globe' && !terrainLeaving"
      :viewer="activeViewer"
    />

    <TerrainPreviewMode
      ref="terrainPreviewRef"
      v-show="viewMode === 'terrain'"
      :active="viewMode === 'terrain'"
      :dataset="calcParams.dataset" :time="calcParams.time" :running="loading"
      @station-run="runAtTerrainStation" @station-parameters="loadTerrainStationParameters"
      @station-pick="syncSimulationLocationFromTerrain"
      @receiver-pick="pickHydrophoneLocation"
      @load-terrain="syncSimulationSourceToBoundsCenter"
      :viewer="activeViewer"
      :initial-center="{ lon: calcParams.coordX, lat: calcParams.coordY }"
      :field="terrainRunVisible ? terrainRenderField : null"
      :fields="terrainRenderFields"
      :texture="terrainTexture"
      :source="terrainRunVisible ? terrainSource : null"
      :receiver="receiverArrayMarker"
      :receiver-placed="hydrophoneReceiverReady"
      :radius-km="terrainRadiusKm"
      :ray-data="profileTerrainRayData"
      :ray-source="selectedProfileLayer ? selectedProfileLayer.source : null"
      :ray-azimuth-deg="profileAzimuthDeg"
      :rays-visible="profileTerrainRaysVisible"
      :rays-static="profileTerrainRaysStatic"
      :rays-animated="profileTerrainRaysAnimated"
      :direction-line-visible="verticalSliceControls.east90Indicator"
      :direction-line-layer-id="profileDirectionLayerId"
      :clip-body="verticalSliceControls.clipBody"
      :signal-excess-params="signalExcessParams"
      @arrow-azimuth="onTerrainArrowAzimuth"
      :initial-bounds="globeSelection"
      :initial-bounds-token="globeSelectionToken"
      :thumbnail-collapsed="thumbnailCollapsed"
      :station-parameters-open="stationPositionOpen"
      :style="{
        opacity: terrainLeaving ? 0 : 1,
        transition: 'opacity 0.32s ease',
      }"
      @anchor="terrainAnchor = $event"
      @layer-anchors="terrainJobAnchors = $event"
      @bounds-change="syncGlobeSelection"
      @request-globe="leaveTerrainForGlobe"
      @update:view-mode="emitViewMode"
      @update:thumbnail-collapsed="$emit('update:thumbnailCollapsed', $event)"
      @noise="openNoiseFromStation"
    />

    <AcousticRunPanel v-if="viewMode === 'terrain' && terrainRunVisible && runSettingsHiddenPanelId !== CURRENT_RUN_PANEL_ID" :minimized="terrainRunMinimized"
      :busy="loading" :ray-busy="dynamicRayLoading" :ready="!!terrainField" :failed="!!errorText" :source="terrainSource" :anchor="terrainAnchor" :time="terrainRunTime"
      :dock-index="runPanelDockIndex(CURRENT_RUN_PANEL_ID)" :dock-count="minimizedRunPanelCount"
      :slice-open="terrainSliceOpen"
      :style="{ opacity: terrainLeaving ? 0 : 1, transition: 'opacity 0.32s ease', pointerEvents: terrainLeaving ? 'none' : 'auto' }"
      @run="runTerrainField" @slice="toggleTerrainSlice" @settings="openCurrentRunSettings"
      @run-at="runCurrentRunAt"
      @minimize="minimizeTerrainRun" @restore="restoreTerrainRun" @close="closeTerrainRun" />

    <StationPositionCard
      v-if="viewMode === 'terrain' && stationPositionOpen && stationPositionPoint"
      :point="stationPositionPoint"
      :time="stationPositionTime"
      :busy="loading"
      :has-run="stationPositionHasRun"
      @run="runStationPositionCard"
      @close="closeStationPositionCard"
      @settings="toggleTerrainSettings"
    />

    <template v-if="viewMode === 'terrain'">
      <AcousticRunPanel v-for="layer in visibleRunHistoryPanels" :key="layer.id"
        :minimized="layer.panelMinimized" ready historical :ray-busy="layer.rayLoading" :layer-visible="layer.visible" :source="layer.source"
        :anchor="terrainJobAnchors[layer.id] || layer.anchor" :time="layer.time" :accent="layer.accent"
        :dock-index="runPanelDockIndex(layer.id)" :dock-count="minimizedRunPanelCount"
        :style="{ opacity: terrainLeaving ? 0 : 1, transition: 'opacity 0.32s ease', pointerEvents: terrainLeaving ? 'none' : 'auto' }"
        @run="runRunHistoryLayer(layer.id)" @slice="showHistoryLayerProfile(layer.id)" @settings="openHistoryRunSettings(layer.id)"
        @run-at="runHistoryAt(layer.id, $event)"
        @minimize="minimizeRunHistoryPanel(layer.id)" @restore="restoreRunHistoryPanel(layer.id)" @close="closeRunHistoryLayer(layer.id)" />
    </template>

    <section v-show="viewMode === 'terrain' && terrainSliceOpen && !terrainSliceMinimized" ref="terrainSliceRef" class="terrain-slice-window" :style="terrainSliceStyle" aria-label="垂直切面">
      <header class="terrain-window-title" @pointerdown="startTerrainSliceDrag">
        <span>📐 垂直切面 · {{ terrainSliceAngleLabel }}</span>
        <span class="terrain-window-actions" @pointerdown.stop>
          <button type="button" title="最小化垂直切面" aria-label="最小化垂直切面" @click="minimizeTerrainWindow('slice')">−</button>
          <button type="button" title="关闭垂直切面" aria-label="关闭垂直切面" @click="closeTerrainWindow('slice')">×</button>
        </span>
      </header>
      <TransmissionLossProfileChart ref="terrainLossChartRef" :data="profileData" :ray-data="profileRayData" :animated="profileAnimated" :static-rays="verticalSliceControls.staticRays"
        source-id="tlrd" :azimuth-deg="profileAzimuthDeg" :max-radius-m="profileMaxRadiusM"
        :bottom-type-segments="profileBottomTypeSegments" :bottom-type-state="profileBottomTypeState" :refresh-token="chartRefreshToken"
        :show-seabed="verticalSliceControls.seafloorLineAndMask" :show-seabed-mask="verticalSliceControls.seafloorMask"
        :readout-enabled="verticalSliceControls.cursorReadout" :click-markers="verticalSliceControls.cursorReadout"
        :receiver-marker="receiverArrayMarker" :receiver-interactive="sliceReceiverPlacementActive"
        :receiver-placement-enabled="sliceReceiverPlacementActive"
        :db-min="profileDbRange.min" :db-max="profileDbRange.max"
        :signal-excess="signalExcessParams"
        height="280px" @update:azimuth-deg="onProfileAzimuthChange" @select-receiver="onSignalSliceReceiverSelected" />
    </section>
    <section v-show="viewMode === 'terrain' && terrainProfileOpen && !terrainProfileMinimized" ref="terrainProfileRef" class="terrain-profile-window" :style="terrainProfileStyle" aria-label="声速剖面">
      <header class="terrain-window-title" @pointerdown="startTerrainProfileDrag">
        <span>📈 声速剖面</span>
        <span class="terrain-window-actions" @pointerdown.stop>
          <button type="button" title="最小化声速剖面" aria-label="最小化声速剖面" @click="minimizeTerrainWindow('profile')">−</button>
          <button type="button" title="关闭声速剖面" aria-label="关闭声速剖面" @click="closeTerrainWindow('profile')">×</button>
        </span>
      </header>
      <SoundSpeedProfile
        :profile="profileSoundProfile"
        :readout-enabled="verticalSliceControls.cursorReadout"
        :source-lon="profileSourceLon"
        :source-lat="profileSourceLat"
        :seabed-depth="profileSeabedDepth"
        :coordinate-format="simulationControls.coordFormat"
        :bottom-type-segments="profileBottomTypeSegments"
        :bottom-type-state="profileBottomTypeState"
      />
    </section>
    <AmbientNoiseProbe v-show="viewMode === 'terrain' && noiseProbeState.open && !terrainNoiseMinimized"
      @minimize="minimizeTerrainWindow('noise')" @close="closeTerrainWindow('noise')" />

    <VesselNoisePlaybackPanel
      :active="receiverPlaybackPanelActive"
      :simulation-active="vesselPlaybackOpen"
      :signal-mode="backendSignalPlotMode"
      signal-channel="receiver"
      window-role="receiver"
      :audio-url="signalReceiverAudioUrl"
      :backend-clip-path="signalTransmissionSession.result?.files?.receiver_monitor_wav || ''"
      :waveform="signalReceiverWaveform"
      :show-waveform="signalTransmissionControls.showWaveform"
      :waveform-minimized="vesselWaveformMinimized"
      :spectrogram="receiverDisplaySpectrogram"
      :frequency-scale="signalTransmissionControls.spectrogramFrequencyScale"
      :show-spectrogram="signalTransmissionControls.showTimeFrequency"
      :spectrogram-minimized="vesselSpectrogramMinimized"
      :current-time="vesselPlaybackTimeS"
      :duration="hydrophoneDisplayDurationS"
      :window-duration="vesselTimeFrequencyWindowS"
      :pre-roll-duration="vesselPlaybackPreRollS"
      :playing="vesselPlaybackPlaying"
      :rate="vesselPlaybackRate"
      :current-index="vesselPlaybackSampleIndex"
      :total-samples="vesselRouteSamples.length"
      :calculated-count="vesselCalculatedFieldCount"
      :busy="vesselPlaybackBusy"
      :status-text="vesselPlaybackStatus"
      :error-text="vesselPlaybackError"
      :receiver-metrics="signalTransmissionSession.result?.metrics"
      :vessel="vesselPlaybackVessel"
      :source-spectrum="vesselPlaybackSpectrum"
      :propagation-model="vesselPlaybackModel"
      @update:time="setVesselPlaybackTime"
      @update:playing="setVesselPlaybackPlaying"
      @update:rate="vesselPlaybackRate = $event"
      @minimize-waveform="minimizeTerrainWindow('waveform')"
      @close-waveform="closeTerrainWindow('waveform')"
      @minimize-spectrogram="minimizeTerrainWindow('spectrogram')"
      @close-spectrogram="closeTerrainWindow('spectrogram')"
      @close="closeVesselPlayback"
    />

    <VesselNoisePlaybackPanel
      :active="sourcePlaybackPanelActive"
      :simulation-active="vesselPlaybackOpen"
      :signal-mode="true"
      signal-channel="source"
      window-role="source"
      :audio-url="signalSourceAudioUrl"
      :backend-clip-path="signalTransmissionSession.result?.files?.source_monitor_wav || ''"
      :waveform="signalSourceWaveform"
      :show-waveform="signalTransmissionControls.showSourceWaveform"
      :waveform-minimized="sourceWaveformMinimized"
      :spectrogram="signalSourceSpectrogram"
      :frequency-scale="signalTransmissionControls.spectrogramFrequencyScale"
      :show-spectrogram="signalTransmissionControls.showSourceTimeFrequency"
      :spectrogram-minimized="sourceSpectrogramMinimized"
      :current-time="vesselPlaybackTimeS"
      :duration="hydrophoneDisplayDurationS"
      :window-duration="vesselTimeFrequencyWindowS"
      :pre-roll-duration="vesselPlaybackPreRollS"
      :playing="vesselPlaybackPlaying"
      :rate="vesselPlaybackRate"
      :current-index="vesselPlaybackSampleIndex"
      :total-samples="vesselRouteSamples.length"
      :calculated-count="vesselCalculatedFieldCount"
      :busy="vesselPlaybackBusy"
      :status-text="vesselPlaybackStatus"
      :error-text="vesselPlaybackError"
      :vessel="vesselPlaybackVessel"
      :source-spectrum="liveSignalSourceProfile"
      :propagation-model="vesselPlaybackModel"
      @update:time="setVesselPlaybackTime"
      @update:playing="setVesselPlaybackPlaying"
      @update:rate="vesselPlaybackRate = $event"
      @minimize-waveform="minimizeTerrainWindow('source-waveform')"
      @close-waveform="closeTerrainWindow('source-waveform')"
      @minimize-spectrogram="minimizeTerrainWindow('source-spectrogram')"
      @close-spectrogram="closeTerrainWindow('source-spectrogram')"
    />

    <nav v-if="viewMode === 'terrain' && minimizedTerrainWindows.length" class="terrain-window-dock" aria-label="已最小化窗口">
      <div v-for="windowId in minimizedTerrainWindows" :key="windowId" class="terrain-window-dock-item">
        <button type="button" class="terrain-window-dock-restore" :title="`恢复${terrainWindowTitle(windowId)}`" @click="restoreTerrainWindow(windowId)">
          <span>{{ windowId === 'slice' ? '📐' : windowId === 'profile' ? '📈' : windowId.includes('waveform') ? '〰' : windowId.includes('spectrogram') ? '▥' : '♫' }}</span>
          <b>{{ terrainWindowTitle(windowId) }}</b>
          <i aria-hidden="true">▴</i>
        </button>
        <button type="button" class="terrain-window-dock-close" :title="`关闭${terrainWindowTitle(windowId)}`" :aria-label="`关闭${terrainWindowTitle(windowId)}`" @click="closeTerrainWindow(windowId)">×</button>
      </div>
    </nav>

    <div v-if="timePickerOpen" class="time-backdrop" @click="timePickerOpen = false"></div>
    <div
      v-if="timePickerOpen"
      class="time-popover"
      :style="{ top: `${timePickerPos.top}px`, left: `${timePickerPos.left}px` }"
      @click.stop
    >
      <div class="cal-head">
        <button type="button" @click="shiftPickerMonth(-1)">‹</button>
        <span>{{ pickerYear }} 年 {{ pickerMonth }} 月</span>
        <button type="button" @click="shiftPickerMonth(1)">›</button>
      </div>
      <div class="cal-week">
        <span v-for="w in ['日', '一', '二', '三', '四', '五', '六']" :key="w">{{ w }}</span>
      </div>
      <div class="cal-grid">
        <template v-for="(cell, i) in calendarCells" :key="i">
          <span v-if="!cell" class="cal-cell empty"></span>
          <button
            v-else
            type="button"
            class="cal-cell"
            :class="{ active: cell.iso === pickerDate, available: cell.hasData }"
            @click="selectPickerDate(cell.iso)"
          >
            {{ cell.day }}
          </button>
        </template>
      </div>
      <div class="cal-times-wrap">
        <div class="cal-times-title">可选时次</div>
        <div class="cal-times">
          <button
            v-for="t in pickerTimes"
            :key="t"
            type="button"
            class="cal-time"
            :class="{ active: t === calcParams.time }"
            @click="selectPickerTime(t)"
          >
            {{ t.slice(11, 16) }}
          </button>
          <span v-if="!pickerTimes.length" class="cal-time-empty">该日无数据</span>
        </div>
      </div>
    </div>

    <aside v-if="viewMode === 'terrain' && parameterPanelOpen && !isNoiseMode" ref="parameterPanelRef" class="parameter-window" :class="{ dragging: parameterPanelDragging }" :style="parameterPanelDragStyle">
      <header class="window-titlebar" title="拖动参数窗口；双击恢复默认位置" @pointerdown="startParameterPanelDrag" @dblclick="resetParameterPanelPosition">
        <span>{{ analysisMode === '2d' ? '二维声场分析参数' : '三维声场分析参数' }}</span>
        <i aria-hidden="true">❯❯❯</i>
        <button v-if="viewMode === 'terrain'" type="button" title="最小化声场菜单" aria-label="最小化声场菜单" @click="minimizeTerrainRun">−</button>
        <button type="button" title="收起参数窗口" @click="parameterPanelOpen = false">×</button>
      </header>

      <div class="parameter-scroll">
        <div class="form-row">
          <label>查询时间</label>
          <button ref="timeTriggerEl" type="button" class="time-trigger" @click.stop="openTimePicker('calc')">
            <span>{{ displayQueryTime }}</span>
            <i aria-hidden="true">▾</i>
          </button>
        </div>
        <div class="form-row radio-row">
          <label>数据类型</label>
          <div class="radio-group">
            <label><input v-model="calcParams.regionType" value="normal" type="radio" /> 非冰区</label>
            <label><input v-model="calcParams.regionType" value="ice" type="radio" /> 冰区</label>
          </div>
        </div>

        <div class="signal-transmission-card">
          <div class="signal-transmission-title">信号传输</div>
          <SignalTransmissionControls @run="runSignalTransmission" @stop="stopSignalTransmission" />
        </div>

        <div class="section-caption"><span>声源与接收</span></div>
        <div class="form-row position-row">
          <label>声源点位置</label>
          <div class="position-control">
            <input v-model.number="calcParams.coordX" type="number" step="0.0001" aria-label="声源经度" />
            <input v-model.number="calcParams.coordY" type="number" step="0.0001" aria-label="声源纬度" />
            <button :class="{ active: activeMapPick === 'source' }" type="button" title="在地球上选取声源" @click="toggleMapPick('source')">⌖</button>
          </div>
        </div>
        <div class="form-row">
          <label>声源深度(m)</label>
          <input v-model.number="calcParams.srcDepth" type="number" min="0" step="1" />
        </div>
        <div class="form-row">
          <label>俯角 / 仰角(°)</label>
          <div class="range-control">
            <input v-model.number="calcParams.grazingAngleMin" type="number" step="1" aria-label="俯角" />
            <span>~</span>
            <input v-model.number="calcParams.grazingAngleMax" type="number" step="1" aria-label="仰角" />
            <em>°</em>
          </div>
        </div>
        <div v-if="analysisMode === '2d'" class="form-row position-row">
          <label>接收点位置</label>
          <div class="position-control">
            <input v-model.number="calcParams.receiverX" type="number" step="0.0001" aria-label="接收点经度" />
            <input v-model.number="calcParams.receiverY" type="number" step="0.0001" aria-label="接收点纬度" />
            <button :class="{ active: activeMapPick === 'receiver' }" type="button" title="在地球上选取接收点" @click="toggleMapPick('receiver')">⌖</button>
          </div>
        </div>

        <div class="section-caption"><span>频率参数</span></div>
        <div class="form-row">
          <label>频率范围(Hz)</label>
          <div class="range-control">
            <input v-model.number="calcParams.minFreq" type="number" min="1" step="1" />
            <span>~</span>
            <input v-model.number="calcParams.maxFreq" type="number" min="1" step="1" />
            <em>Hz</em>
          </div>
        </div>

        <div class="section-caption"><span>模型选择</span></div>
        <div class="form-row">
          <label>计算模型</label>
          <select v-model="calcParams.model">
            <option value="bellhop">射线模型</option>
            <option value="ram">RAM 模型</option>
            <option value="kraken">KRAKEN 模型</option>
          </select>
        </div>

        <div class="section-caption"><span>计算参数</span></div>
        <div class="form-row">
          <label>传播距离(nmi)</label>
          <input v-if="analysisMode === '3d'" v-model.number="calcParams.range" type="number" min="0.1" step="0.1" />
          <div v-else class="readonly-value">{{ routeDistanceNm.toFixed(2) }}</div>
        </div>
        <div class="form-row">
          <label>方位(°)</label>
          <input v-if="analysisMode === '3d'" v-model.number="calcParams.azimuth" type="number" min="0" max="359" step="1" />
          <div v-else class="readonly-value">{{ routeBearingDeg.toFixed(1) }}</div>
        </div>
        <div v-if="isRayModel" class="form-row">
          <label>声线条数</label>
          <input v-model.number="calcParams.lineCount" type="number" min="0" step="1" />
        </div>
        <div v-if="isRayModel" class="form-row">
          <label>声线接口</label>
          <select v-model="calcParams.rayInterface">
            <option value="dynamic">动态声线</option>
            <option value="static">静态声线</option>
          </select>
        </div>
        <div class="form-row radio-row">
          <label>相干性</label>
          <div class="radio-group">
            <label><input v-model="calcParams.coherent" :value="true" type="radio" /> 相干</label>
            <label><input v-model="calcParams.coherent" :value="false" type="radio" /> 非相干</label>
          </div>
        </div>
        <div v-if="analysisMode === '3d'" class="form-row">
          <label>扇面数</label>
          <select v-model.number="calcParams.sector">
            <option v-for="count in [4, 8, 12, 24]" :key="count" :value="count">{{ count }}</option>
          </select>
        </div>
      </div>

      <footer class="parameter-footer">
        <div class="form-actions">
          <button class="calculate-btn" type="button" :disabled="loading" @click="submitCalculation">
            {{ loading ? '计算中…' : '计算' }}
          </button>
          <button class="reset-btn" type="button" :disabled="loading" @click="resetParameters">重置</button>
        </div>
        <button
          v-if="raySourceData || volumeData"
          type="button"
          class="result-restore-btn"
          @click="restoreResultPanel"
        >
          查看上次{{ analysisMode === '2d' ? '二维' : '三维' }}声场结果
        </button>
        <!-- <p>
          协议接口：{{ activePortalPlugins }}
          <br />结果图层：{{ resultLayerLabel }}
        </p> -->
      </footer>
    </aside>

    <aside v-if="false" ref="parameterPanelRef" class="parameter-window" :class="{ dragging: parameterPanelDragging }" :style="parameterPanelDragStyle">
      <header class="window-titlebar" title="拖动参数窗口；双击恢复默认位置" @pointerdown="startParameterPanelDrag" @dblclick="resetParameterPanelPosition">
        <span>环境噪声分析</span>
        <i aria-hidden="true">❯❯❯</i>
        <button type="button" title="收起参数窗口" @click="parameterPanelOpen = false">×</button>
      </header>

      <div class="parameter-scroll">
        <div class="form-row">
          <label>查询时间</label>
          <button ref="noiseTimeTriggerEl" type="button" class="time-trigger" @click.stop="openTimePicker('noise')">
            <span>{{ displayNoiseQueryTime }}</span>
            <i aria-hidden="true">▾</i>
          </button>
        </div>

        <div class="section-caption"><span>接收点</span></div>
        <p class="noise-hint linked-noise-hint">默认跟随二维传播损失结果的接收阵中心；重新标注接收阵后自动更新。</p>
        <p v-if="noiseResultOutdated" class="noise-hint stale-noise-hint">接收阵位置已改变，请重新计算环境噪声后再用于阵列信道。</p>
        <div class="form-row position-row">
          <label>接收点位置</label>
          <div class="position-control">
            <input v-model.number="noiseParams.receiverX" type="number" step="0.0001" aria-label="接收点经度" @change="invalidateEnvironmentNoiseLink" />
            <input v-model.number="noiseParams.receiverY" type="number" step="0.0001" aria-label="接收点纬度" @change="invalidateEnvironmentNoiseLink" />
            <button :class="{ active: activeMapPick === 'receiver' }" type="button" title="在地球上选取接收点" @click="toggleMapPick('receiver')">⌖</button>
            <button type="button" title="取消取点" @click="activeMapPick = ''">×</button>
          </div>
        </div>
        <div class="form-row">
          <label>工作深度(m)</label>
          <input v-model.number="noiseParams.depth" type="number" min="1" step="1" @change="invalidateEnvironmentNoiseLink" />
        </div>

        <div class="section-caption"><span>计算参数</span></div>
        <div class="form-row">
          <label>航运等级</label>
          <input v-model.number="noiseParams.shipDensityLevel" type="number" min="1" max="5" step="1" />
        </div>
        <div class="form-row">
          <label>海况等级</label>
          <input v-model.number="noiseParams.windSpeed" type="number" min="0" max="12" step="1" />
        </div>
        <div class="form-row">
          <label>降雨等级</label>
          <input v-model.number="noiseParams.rainIntensity" type="number" min="0" max="6" step="1" />
        </div>
        <div class="form-row">
          <label>频率范围(Hz)</label>
          <div class="range-control">
            <input v-model.number="noiseParams.minFreq" type="number" min="1" step="1" />
            <span>~</span>
            <input v-model.number="noiseParams.maxFreq" type="number" min="1" step="1" />
            <em>Hz</em>
          </div>
        </div>
        <div class="form-row">
          <label>频率采样点数</label>
          <input v-model.number="noiseParams.numPoints" type="number" min="2" step="1" />
        </div>

        <div class="section-caption"><span>时频合成场景</span></div>
        <div class="form-row">
          <label>仿真时长(s)</label>
          <input v-model.number="noiseParams.timeFrequencyScenario.durationS" type="number" min="1" max="3600" step="1" />
        </div>
        <div class="form-row">
          <label>时间步长(s)</label>
          <input v-model.number="noiseParams.timeFrequencyScenario.stepS" type="number" min="0.05" max="10" step="0.05" />
        </div>
        <div class="form-row">
          <label>时间轴</label>
          <select v-model="noiseParams.timeFrequencyScenario.timeAxis">
            <option value="relative">相对时间</option>
            <option value="absolute">从查询时间开始</option>
          </select>
        </div>
        <div class="form-row">
          <label>随机种子</label>
          <input v-model.number="noiseParams.timeFrequencyScenario.seed" type="number" step="1" />
        </div>
        <div class="form-row">
          <label>风速扰动(%)</label>
          <input v-model.number="noiseParams.timeFrequencyScenario.windJitterPercent" type="number" min="0" max="50" step="1" />
        </div>

        <div class="scenario-editor">
          <div class="scenario-editor-head">
            <span>风速控制点</span>
            <button type="button" @click="addWindControlPoint">＋ 添加</button>
          </div>
          <div class="scenario-grid scenario-grid-wind scenario-grid-labels">
            <span>时刻(s)</span><span>风级</span><span></span>
          </div>
          <div
            v-for="(point, index) in noiseParams.timeFrequencyScenario.windControlPoints"
            :key="`wind-${index}`"
            class="scenario-grid scenario-grid-wind"
          >
            <input v-model.number="point.timeS" type="number" min="0" :max="noiseParams.timeFrequencyScenario.durationS" step="0.5" />
            <input v-model.number="point.level" type="number" min="0" max="12" step="1" />
            <button type="button" class="scenario-remove" title="删除风速控制点" @click="removeScenarioItem('windControlPoints', index)">×</button>
          </div>
        </div>

        <div class="scenario-editor">
          <div class="scenario-editor-head">
            <span>降雨区间</span>
            <button type="button" @click="addRainEvent">＋ 添加</button>
          </div>
          <div class="scenario-grid scenario-grid-event scenario-grid-labels">
            <span>开始(s)</span><span>结束(s)</span><span>雨级</span><span></span>
          </div>
          <div
            v-for="(event, index) in noiseParams.timeFrequencyScenario.rainEvents"
            :key="`rain-${index}`"
            class="scenario-grid scenario-grid-event"
          >
            <input v-model.number="event.startS" type="number" min="0" :max="noiseParams.timeFrequencyScenario.durationS" step="0.5" />
            <input v-model.number="event.endS" type="number" min="0" :max="noiseParams.timeFrequencyScenario.durationS" step="0.5" />
            <input v-model.number="event.level" type="number" min="0" max="6" step="1" />
            <button type="button" class="scenario-remove" title="删除降雨事件" @click="removeScenarioItem('rainEvents', index)">×</button>
          </div>
          <p v-if="!noiseParams.timeFrequencyScenario.rainEvents.length" class="scenario-empty">没有降雨事件</p>
        </div>

        <div class="scenario-editor">
          <div class="scenario-editor-head">
            <span>船舶经过区间</span>
            <button type="button" @click="addShipEvent">＋ 添加</button>
          </div>
          <div class="scenario-grid scenario-grid-ship scenario-grid-labels">
            <span>开始</span><span>结束</span><span>等级</span><span>基频</span><span>谐波</span><span></span>
          </div>
          <div
            v-for="(event, index) in noiseParams.timeFrequencyScenario.shipEvents"
            :key="`ship-${index}`"
            class="scenario-grid scenario-grid-ship"
          >
            <input v-model.number="event.startS" type="number" min="0" :max="noiseParams.timeFrequencyScenario.durationS" step="0.5" title="开始时间(s)" />
            <input v-model.number="event.endS" type="number" min="0" :max="noiseParams.timeFrequencyScenario.durationS" step="0.5" title="结束时间(s)" />
            <input v-model.number="event.level" type="number" min="1" max="5" step="1" title="船舶等级" />
            <input v-model.number="event.fundamentalHz" type="number" min="1" max="5000" step="1" title="机械基频(Hz)" />
            <input v-model.number="event.harmonicCount" type="number" min="0" max="12" step="1" title="谐波数量" />
            <button type="button" class="scenario-remove" title="删除船舶事件" @click="removeScenarioItem('shipEvents', index)">×</button>
          </div>
          <p v-if="!noiseParams.timeFrequencyScenario.shipEvents.length" class="scenario-empty">没有船舶经过事件</p>
        </div>

        <div class="scenario-actions">
          <button type="button" @click="resetNoiseScenario">恢复默认场景</button>
          <button type="button" @click="clearNoiseScenarioEvents">清空事件</button>
        </div>
        <p class="noise-hint">环境噪声接口采用航运、海况和降雨等级模型。</p>
        <p class="noise-hint">时频图由以上前端场景合成，不代表连续环境预报；后端谱图仍对应所选查询时次。</p>
      </div>

      <footer class="parameter-footer">
        <div class="form-actions">
          <button class="calculate-btn" type="button" :disabled="loading" @click="submitNoiseCalculation">
            {{ loading ? '计算中…' : '计算' }}
          </button>
          <button class="reset-btn" type="button" :disabled="loading" @click="resetNoiseParameters">重置</button>
        </div>
        <button v-if="noiseResult" type="button" class="result-restore-btn" @click="restoreResultPanel">
          查看上次环境噪声结果
        </button>
      </footer>
    </aside>

    <aside v-if="volumeData && renderControlsOpen" class="display-window">
      <header>
        <span>体渲染工具</span>
        <span class="display-head-right">
          <!-- <small>计算 {{ calculatedSectorCount }} 面 · 纹理 {{ texWidth }}×{{ texHeight }}×{{ texDepth }}</small> -->
          <button type="button" class="display-close" title="关闭" @click="renderControlsOpen = false">×</button>
        </span>
      </header> 
      <div class="display-body">
        <div class="mini-control">
          <span>FOM <b>{{ fomValue }}</b></span>
          <input v-model.number="fomValue" type="range" min="0" max="200" step="1" @input="syncSoundField" />
        </div>
        <div class="display-buttons">
          <button type="button" @click="resetView">全景</button>
          <button type="button" @click="topView">俯视</button>
          <button type="button" :disabled="!sliceEnabled" @click="viewSliceFromSide">侧视</button>
        </div>
        <label class="toggle-line"><input v-model="volumeVisible" type="checkbox" @change="toggleVolumeVisible" /> 三维声场体</label>
        <!-- <label class="toggle-line"><input v-model="omni2dVisible" type="checkbox" @change="onOmni2dVisibleChange" /> 海面二维投影</label> -->
        <div class="mini-control">
          <span>垂直夸张（地形 + 声场） <b>{{ depthExaggeration }}×</b></span>
          <input v-model.number="depthExaggeration" type="range" min="0.5" max="50" step="0.1" @input="onDepthExagChange" />
        </div>
        <div class="mini-control">
          <span>透明度 α <b>{{ fmt(volumeOpacity, 2) }}</b></span>
          <input v-model.number="volumeOpacity" type="range" min="0" max="1" step="0.01" @input="onVolumeOpacityInput" />
        </div>
        <label class="toggle-line">
          <input v-model="singleSliceEnabled" type="checkbox" @change="onSliceToggle" />
          启用单方位切面
        </label>
        <label class="toggle-line">
          <input v-model="multiSliceEnabled" type="checkbox" @change="onSliceToggle" />
          启用多方位切面
          <small v-if="multiSliceEnabled">（{{ availableAzimuths.length }} 个方位）</small>
        </label>
        <!-- <div class="mini-control">
          <span>方位 <b>{{ Math.round(displayAzimuth(sliceAzimuthDeg)) }}°</b></span>
          <input v-model.number="sliceAzimuthDeg" type="range" min="0" max="359" step="1" :disabled="!sliceEnabled" @input="onAzimuthUiChange" />
        </div> -->
      </div>
    </aside>

    <div v-if="statusText || errorText || runtimeError || activeMapPick" class="portal-status" :class="{ error: errorText || runtimeError }">
      {{ errorText || runtimeError || (activeMapPick ? `请在数字地球上单击选取${activeMapPick === 'source' ? '声源' : '接收点'}位置` : statusText) }}
    </div>

    <!-- <div v-if="analysisMode === '2d' && raySourceData" class="map-interaction-hint">
      <span class="map-hint-swatch"></span>
      地球上的竖直剖面帘为方位剖面 TL{{ isRayModel ? '（含声线轨迹）' : '' }}；在空白地图区域拖拽旋转、滚轮缩放
      <button type="button" @click="focus2dField">定位结果</button>
    </div> -->

    <aside
      v-if="resultPanelOpen && !isNoiseMode && (raySourceData || volumeData)"
      class="result-window"
      :style="{ left: resultWindowLeft }"
    >
      <header class="result-titlebar">
        <span>{{ analysisMode === '2d' ? '二维声场分析结果' : '三维声场分析结果' }}</span>
        <i aria-hidden="true">❯❯❯</i>
        <button type="button" title="收起结果窗口" @click="resultPanelOpen = false">×</button>
      </header>
      <div class="result-body">
        <div class="result-toolbar">
          <div class="result-toolbar-actions">
            <button type="button" class="result-back" @click="backToConfig">← 返回计算</button>
            <button
              v-if="analysisMode === '2d'"
              type="button"
              class="result-back receiver-mark-btn"
              :class="{ active: receiverPlacementEnabled }"
              @click="toggleReceiverPlacement"
            >
              ⌖ {{ receiverPlacementEnabled ? '请在图中点选' : '标注接收阵' }}
            </button>
          </div>
          <button
            v-if="analysisMode === '3d'"
            type="button"
            class="result-back result-render-btn"
            @click="renderControlsOpen = !renderControlsOpen"
          >
            体渲染
          </button>
        </div>
        <p class="result-meta">{{ resultMetaText }}</p>
        <TransmissionLossProfileChart
          class="result-card"
          :data="raySourceData"
          :ray-data="isRayModel ? staticRayData : null"
          :animated="useDynamicRays && verticalSliceControls.dynamicRays"
          :static-rays="verticalSliceControls.staticRays"
          source-id="tlrd"
          :azimuth-deg="sliceAzimuthDeg"
          :max-radius-m="sourceRadiusKm * 1000"
          :bottom-type-segments="bottomTypeSegments"
          :bottom-type-state="bottomTypeState"
          :receiver-marker="receiverArrayMarker"
          :receiver-placement-enabled="receiverPlacementEnabled"
          :refresh-token="chartRefreshToken"
          height="250px"
          @update:azimuth-deg="onProfileAzimuthChange"
          @select-receiver="onReceiverArraySelected"
        />
        <SoundRayChart
          v-if="isRayModel"
          class="result-card"
          :data="raySourceData"
          :ray-data="verticalSliceControls.dynamicRays || verticalSliceControls.staticRays ? staticRayData : null"
          :portal-rays-only="analysisMode === '3d'"
          source-id="tlrd"
          :azimuth-deg="sliceAzimuthDeg"
          :max-radius-m="sourceRadiusKm * 1000"
          :source-depth-m="staticRaySourceDepthM || Number(sourcePoint?.depth_m)"
          :ray-count="calcParams.lineCount"
          :earth-rays-visible="earthRaysVisible"
          :animated="useDynamicRays && verticalSliceControls.dynamicRays"
          :bottom-type-segments="bottomTypeSegments"
          :bottom-type-state="bottomTypeState"
          :refresh-token="chartRefreshToken"
          height="250px"
          @update:azimuth-deg="onProfileAzimuthChange"
          @update:earth-rays-visible="setEarthRaysVisible"
        />
        <!-- <div v-else class="model-result-note">
          <strong>{{ selectedModelLabel }}</strong>
          <span>该模型输出传播损失场，不生成 Bellhop 几何声线路径。</span>
        </div> -->
      </div>
    </aside>

    <aside v-if="resultPanelOpen && isNoiseMode && noiseResult" class="result-window" :style="{ left: resultWindowLeft }">
      <header class="result-titlebar">
        <span>环境噪声分析结果</span>
        <i aria-hidden="true">❯❯❯</i>
        <button type="button" title="收起结果窗口" @click="resultPanelOpen = false">×</button>
      </header>
      <div class="result-body">
        <div class="result-toolbar">
          <button type="button" class="result-back" @click="backToConfig">← 返回计算</button>
          <span class="noise-result-tag">{{ noiseResultLabel }}</span>
        </div>
        <p class="result-meta">{{ noiseResultMeta }}</p>
        <EnvironmentNoiseResult :data="noiseResult" variant="normal" :params="noiseResultParams || noiseParams" />
      </div>
    </aside>

    <div v-if="volumeData && !cleanGlobeView" class="legend-corner">
      <div class="legend-bar" :style="{ background: colorGradient }"></div>
      <div class="legend-labels"><span>{{ volumeLegend.inRangeMin }} {{ volumeLegend.unit }}</span><span>{{ volumeLegend.inRangeMax }} {{ volumeLegend.unit }}</span></div>
    </div>

    <div v-if="loading" class="loading-mask">
      <div class="loading-spinner"></div>
      <strong>{{ loadingMessage || '正在计算声场…' }}</strong>
      <small>门户接口为同步计算，请稍候</small>
    </div>

    <!-- 底部状态栏：鼠标经纬度 / 高程（水下为负）/ 层级 -->
    <div class="coord-status">
      <div class="coord-metrics">
        <span>经度：<b>{{ coordStatus.lon }}</b></span>
        <span>纬度：<b>{{ coordStatus.lat }}</b></span>
        <span>高度：<b>{{ coordStatus.height }}</b></span>
        <span>层级：<b>{{ coordStatus.level }}</b></span>
      </div>
      <UserMenu inline />
    </div>

    <!-- 旧布局保留在源码中作为兼容参考，不参与渲染。 -->
    <template v-if="false">

    <!-- 加载遮罩 -->
    <div v-if="loading" class="loading-mask">
      <div>{{ loadingMessage }}</div>
      <div v-if="buildProgress > 0" class="progress-bar">
        <div class="progress-fill" :style="{ width: `${buildProgress}%` }"></div>
      </div>
    </div>

    <!-- 顶部工具栏 -->
    <header class="top-toolbar">
      <div class="toolbar-left">
        <span class="toolbar-title">NC 声场体渲染</span>
        <select v-model="dataSource" class="select-input source-select" :disabled="loading">
          <option value="tlrd">标准三维声场</option>
        </select>
        <button type="button" class="btn btn-primary" :disabled="loading" @click="loadData">
          {{ loading ? '计算中…' : '提交计算' }}
        </button>
      </div>
      <div class="toolbar-right">
        <button type="button" class="btn" :disabled="!volumeData" @click="resetView">全景</button>
        <button type="button" class="btn" :disabled="!volumeData" @click="topView">俯视</button>
        <button
          type="button"
          class="btn"
          :disabled="!volumeData || !sliceEnabled || sliceMode !== 'azimuth'"
          @click="viewSliceFromSide"
        >
          侧视切面
        </button>
      </div>
    </header>

    <!-- 状态 / 错误提示 -->
    <div v-if="statusText || errorText || runtimeError" class="status-strip">
      <span v-if="statusText" class="status-ok">{{ statusText }}</span>
      <span v-if="errorText" class="status-error">{{ errorText }}</span>
      <span v-if="runtimeError" class="status-error">{{ runtimeError }}</span>
    </div>

    <!-- 左侧控制面板（可折叠分组） -->
    <aside class="control-panel">
      <section class="panel accordion">
        <button type="button" class="accordion-head" @click="toggleSection('calc')">
          <span class="accordion-title">计算参数</span>
          <span class="accordion-meta">
            <span class="accordion-badge">{{ calcParams.coordX }}°E, {{ calcParams.coordY }}°N · {{ calcParams.sector }} 扇区</span>
            <span class="accordion-arrow" :class="{ open: isOpen('calc') }">▾</span>
          </span>
        </button>
        <div v-show="isOpen('calc')" class="accordion-body">
          <div class="field">
            <span class="field-label">声源位置</span>
            <div class="db-range-inputs">
              <label class="db-range-input">
                <span>经度 coordX</span>
                <input v-model.number="calcParams.coordX" type="number" step="0.001" />
              </label>
              <label class="db-range-input">
                <span>纬度 coordY</span>
                <input v-model.number="calcParams.coordY" type="number" step="0.001" />
              </label>
            </div>
          </div>

          <div class="field">
            <span class="field-label">声学参数</span>
            <div class="db-range-inputs">
              <label class="db-range-input">
                <span>声源深度 (m)</span>
                <input v-model.number="calcParams.srcDepth" type="number" step="1" min="0" />
              </label>
              <label class="db-range-input">
                <span>传播距离 (km)</span>
                <input v-model.number="calcParams.range" type="number" step="1" min="0" />
              </label>
            </div>
          </div>

          <div class="field">
            <div class="db-range-inputs">
              <label class="db-range-input">
                <span>频率 (Hz)</span>
                <input v-model.number="calcParams.freq" type="number" step="1" min="0" />
              </label>
              <label class="db-range-input">
                <span>扇面数 sector</span>
                <select v-model.number="calcParams.sector" class="select-input">
                  <option :value="4">4</option>
                  <option :value="8">8</option>
                  <option :value="12">12</option>
                  <option :value="24">24</option>
                </select>
              </label>
            </div>
          </div>

          <div class="field">
            <span class="field-label">二维声线（静态声线展示）</span>
            <div class="db-range-inputs">
              <label class="db-range-input">
                <span>方位角 °</span>
                <input v-model.number="calcParams.azimuth" type="number" step="1" />
              </label>
              <label class="db-range-input">
                <span>声线条数</span>
                <input v-model.number="calcParams.lineCount" type="number" step="1" min="0" />
              </label>
            </div>
          </div>

          <p class="hint">点击顶部「提交计算」即调用 Analyse3DTLRD / Analyse2DRTRD 接口同步计算并渲染。</p>
        </div>
      </section>

      <section v-if="bounds" class="panel accordion">
        <button type="button" class="accordion-head" @click="toggleSection('info')">
          <span class="accordion-title">数据信息</span>
          <span class="accordion-meta">
            <span class="accordion-badge">计算 {{ calculatedSectorCount }} 面 · 纹理 {{ texWidth }}×{{ texHeight }}×{{ texDepth }}</span>
            <span class="accordion-arrow" :class="{ open: isOpen('info') }">▾</span>
          </span>
        </button>
        <div v-show="isOpen('info')" class="accordion-body">
          <div class="info-grid">
            <template v-if="sourcePoint">
              <span class="info-k">声源点</span>
              <span class="info-v">
                {{ fmt(sourcePoint.lon, 4) }}°E, {{ fmt(sourcePoint.lat, 4) }}°N,
                {{ fmt(sourcePoint.depth_m, 1) }} m
              </span>
            </template>
            <span class="info-k">接口计算</span>
            <span class="info-v">{{ calculatedSectorCount }} 个扇面</span>
            <span class="info-k">渲染纹理</span>
            <span class="info-v">{{ texWidth }} 距离 × {{ texHeight }} 方位插值 × {{ texDepth }} 深度</span>
            <span class="info-k">角向插值</span>
            <span class="info-v">最多 {{ calculatedSectorCount }} × {{ TLRD_ANGLE_INTERP }} + 1，按内存预算实际 {{ texHeight }} 行</span>
            <span class="info-k">有效体素</span>
            <span class="info-v">{{ validVoxelPct }}%</span>
            <span class="info-k">声线</span>
            <span class="info-v">{{ rayCount }} 条</span>
            <span class="info-k">声源半径</span>
            <span class="info-v">{{ fmt(sourceRadiusKm, 2) }} km</span>
          </div>

          <div class="info-grid info-grid-ranges">
            <span class="info-k">经度</span>
            <span class="info-v">{{ fmt(bounds.lon.min, 4) }} ~ {{ fmt(bounds.lon.max, 4) }}</span>
            <span class="info-k">纬度</span>
            <span class="info-v">{{ fmt(bounds.lat.min, 4) }} ~ {{ fmt(bounds.lat.max, 4) }}</span>
            <span class="info-k">深度</span>
            <span class="info-v">{{ fmt(bounds.depth.min, 1) }} ~ {{ fmt(bounds.depth.max, 1) }} m</span>
            <span class="info-k">TL</span>
            <span class="info-v">{{ fmt(bounds.value.min, 2) }} ~ {{ fmt(bounds.value.max, 2) }} dB</span>
          </div>
        </div>
      </section>

      <section v-if="volumeData" class="panel accordion">
        <button type="button" class="accordion-head" @click="toggleSection('display')">
          <span class="accordion-title">显示控制</span>
          <span class="accordion-meta">
            <span class="accordion-badge">{{ fmt(colorRange.min, 0) }}~{{ fmt(colorRange.max, 0) }} dB</span>
            <span class="accordion-arrow" :class="{ open: isOpen('display') }">▾</span>
          </span>
        </button>
        <div v-show="isOpen('display')" class="accordion-body">
          <div class="switch-group">
            <label class="switch-row">
              <input v-model="volumeVisible" type="checkbox" @change="toggleVolumeVisible" />
              <span class="switch-text">声场体三维显示</span>
            </label>
            <label class="switch-row">
              <input v-model="omni2dVisible" type="checkbox" @change="onOmni2dVisibleChange" />
              <span class="switch-text">二维声场（球面）</span>
            </label>
          </div>

          <div v-if="omni2dDepthOptions.length" class="field">
            <span class="field-label">二维声场图层深度</span>
            <select
              v-model.number="omni2dDepthIndex"
              class="select-input"
              :disabled="!omni2dVisible"
              @change="syncOmni2dLayer"
            >
              <option v-for="(d, i) in omni2dDepthOptions" :key="i" :value="i">
                第{{ i }}层 · {{ fmt(d, 1) }} m{{ i === 0 ? '（海面）' : '' }}
              </option>
            </select>
          </div>

          <div v-if="omni2dDepthOptions.length" class="field">
            <span class="field-label">二维声场样式</span>
            <select
              v-model="omni2dStyle"
              class="select-input"
              :disabled="!omni2dVisible"
              @change="syncOmni2dLayer"
            >
              <option value="sonar">声呐预测（射线 + 距离圈）</option>
              <option value="heatmap">传播损失（色阶热力图）</option>
            </select>
            <p class="hint">
              二维声场以影像图层贴在球面：<span v-if="omni2dVisible">当前 {{ omni2dDepthLabel }} · {{ omni2dStyle === 'sonar' ? '射线沿数据实测点位连线 · 颜色取色标 · 实线为等距离圈' : '按数据实测经纬度逐点着色 · 虚线为等距离线' }}</span>
              <span v-else>未显示</span>
            </p>
            <p v-if="omni2dVisible && omni2dStyle === 'sonar'" class="hint omni-legend">
              <span class="lg-bar" :style="{ background: omniColorGradient }" />
              <span>{{ fmt(colorRange.min, 0) }} ~ {{ fmt(colorRange.max, 0) }} dB（与右侧色标一致）</span>
            </p>
          </div>

          <div class="field">
            <div class="slider-row">
              <span class="slider-label">垂直夸张（地形 + 声场）</span>
              <span class="slider-value">{{ depthExaggeration }}×</span>
            </div>
            <input
              v-model.number="depthExaggeration"
              type="range"
              min="0.5"
              max="50"
              step="0.1"
              @input="onDepthExagChange"
            />
          </div>

          <div class="field">
            <div class="slider-row">
              <span class="slider-label">TL 范围 (dB)</span>
              <span class="slider-value">{{ fmt(valueRange.min, 1) }} ~ {{ fmt(valueRange.max, 1) }}</span>
            </div>
            <input
              v-model.number="valueRange.min"
              type="range"
              :min="bounds?.value.min"
              :max="bounds?.value.max"
              :step="valueStep"
              @input="onValueRangeChange"
            />
            <input
              v-model.number="valueRange.max"
              type="range"
              :min="bounds?.value.min"
              :max="bounds?.value.max"
              :step="valueStep"
              @input="onValueRangeChange"
            />
            <p class="hint">数据筛选：仅该 dB 区间内的体素参与渲染。</p>
          </div>

          <div class="field">
            <div class="slider-row">
              <span class="slider-label">色标范围 (dB)</span>
              <span class="slider-value">{{ fmt(colorRange.min, 1) }} ~ {{ fmt(colorRange.max, 1) }}</span>
            </div>
            <input
              v-model.number="colorRange.min"
              type="range"
              :min="dbRangeMin"
              :max="dbRangeMax"
              :step="colorStep"
              @input="onColorRangeChange"
            />
            <input
              v-model.number="colorRange.max"
              type="range"
              :min="dbRangeMin"
              :max="dbRangeMax"
              :step="colorStep"
              @input="onColorRangeChange"
            />
            <div class="db-range-inputs">
              <label class="db-range-input">
                <span>下限</span>
                <input v-model.number="colorRange.min" type="number" step="1" @change="onColorRangeChange" />
              </label>
              <label class="db-range-input">
                <span>上限</span>
                <input v-model.number="colorRange.max" type="number" step="1" @change="onColorRangeChange" />
              </label>
            </div>
            <p class="hint">色标映射：下限为红、上限为蓝，红→蓝渐变方式不变。</p>
          </div>

          <div class="field">
            <div class="slider-row">
              <span class="slider-label">色标透明度区间</span>
              <span class="slider-value">
                {{ fmt(valueAlphaRange.min, 2) }} → {{ fmt(valueAlphaRange.max, 2) }}
              </span>
            </div>
            <div class="db-range-inputs">
              <label class="db-range-input">
                <span>红端 α</span>
                <input
                  v-model.number="valueAlphaRange.min"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  @input="onAlphaRangeChange"
                  @change="onAlphaRangeChange"
                />
              </label>
              <label class="db-range-input">
                <span>蓝端 α</span>
                <input
                  v-model.number="valueAlphaRange.max"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  @input="onAlphaRangeChange"
                  @change="onAlphaRangeChange"
                />
              </label>
            </div>
            <p class="hint">手动输入 0~1：红端（色标下限）越接近 1 越实，蓝端（色标上限）越小越透明。</p>
          </div>
        </div>
      </section>

      <section v-if="volumeData" class="panel accordion">
        <button type="button" class="accordion-head" @click="toggleSection('slice')">
          <span class="accordion-title">切面工具</span>
          <span class="accordion-meta">
            <span class="accordion-badge">
              {{ sliceEnabled ? `${sliceModeLabel}${sliceMode === 'azimuth' ? ` ${sliceAzimuthDeg}°` : ''}` : '未启用' }}
            </span>
            <span class="accordion-arrow" :class="{ open: isOpen('slice') }">▾</span>
          </span>
        </button>
        <div v-show="isOpen('slice')" class="accordion-body">
          <label class="switch-row">
            <input v-model="singleSliceEnabled" type="checkbox" @change="syncSoundField" />
            <span class="switch-text">启用切面裁切</span>
          </label>

          <div class="field">
            <span class="field-label">切面方向</span>
            <select v-model="sliceMode" class="select-input" :disabled="!sliceEnabled" @change="syncSoundField">
              <option value="azimuth">方位角（旋转切蛋糕）</option>
              <option value="depth">深度（水平层）</option>
              <option value="lon">经度</option>
              <option value="lat">纬度</option>
            </select>
          </div>

          <div v-if="sliceEnabled && sliceMode === 'azimuth'" class="field">
            <div class="slider-row">
              <span class="slider-label">切面方位角</span>
              <span class="slider-value">{{ sliceAzimuthDeg }}°</span>
            </div>
            <input
              v-if="sliceAzimuthOptions.length"
              :value="sliceAzimuthSliderIndex"
              type="range"
              min="0"
              :max="Math.max(0, sliceAzimuthOptions.length - 1)"
              step="1"
              :disabled="sliceAzimuthOptions.length <= 1"
              @input="onSliceAzimuthSliderInput"
            />
            <input
              v-else
              v-model.number="sliceAzimuthDeg"
              type="range"
              min="0"
              max="359"
              step="1"
              @input="onAzimuthUiChange"
            />
          </div>

          <div class="field">
            <div class="slider-row">
              <span class="slider-label">切面展开</span>
              <span class="slider-value">{{ slicePercent }}%</span>
            </div>
            <input
              v-model.number="slicePercent"
              type="range"
              min="1"
              max="100"
              step="1"
              :disabled="!sliceEnabled"
              @input="syncSoundField"
            />
            <p class="hint">
              {{
                sliceEnabled
                  ? sliceMode === 'azimuth'
                    ? '保留该方位起顺时针扇区'
                    : '保留从起始到该位置的体块'
                  : '关闭时显示完整体'
              }}
            </p>
          </div>
        </div>
      </section>
      <section v-if="volumeData" class="panel accordion">
        <button type="button" class="accordion-head" @click="toggleSection('pointer')">
          <span class="accordion-title">方位指针</span>
          <span class="accordion-meta">
            <span class="accordion-badge">{{ fmt(sliceAzimuthDeg, 1) }}° · {{ availableAzimuths.length }} 方位</span>
            <span class="accordion-arrow" :class="{ open: isOpen('pointer') }">▾</span>
          </span>
        </button>
        <div v-show="isOpen('pointer')" class="accordion-body">
          <div class="switch-group">
            <label class="switch-row">
              <input v-model="pointerEnabled" type="checkbox" @change="toggleAzimuthPointer" />
              <span class="switch-text">声源点上方方位指针（可拖拽）</span>
            </label>
            <label class="switch-row switch-row-sub" :class="{ 'is-disabled': !pointerEnabled }">
              <input
                v-model="pointerRingVisible"
                type="checkbox"
                :disabled="!pointerEnabled"
                @change="toggleAzimuthRing"
              />
              <span class="switch-text">外围辅助圈与刻度点</span>
            </label>
          </div>

          <div class="field">
            <div class="slider-row">
              <span class="slider-label">当前方位</span>
              <span class="slider-value">{{ fmt(sliceAzimuthDeg, 1) }}°</span>
            </div>
            <div class="pointer-nav">
              <button
                type="button"
                class="btn btn-mini"
                :disabled="!availableAzimuths.length"
                @click="stepPointerAzimuth(-1)"
              >
                ◀
              </button>
              <select
                v-model.number="sliceAzimuthDeg"
                class="select-input"
                :disabled="!availableAzimuths.length"
                @change="onAzimuthUiChange"
              >
                <option v-for="az in availableAzimuths" :key="az" :value="az">{{ fmt(az, 1) }}°</option>
              </select>
              <button
                type="button"
                class="btn btn-mini"
                :disabled="!availableAzimuths.length"
                @click="stepPointerAzimuth(1)"
              >
                ▶
              </button>
            </div>
          </div>

          <p class="hint hint-block">
            按住声源点上方（或指针端点）的手柄拖拽即可切换方位，指针只能停在
            {{ availableAzimuths.length ? `数据已有的 ${availableAzimuths.length} 个方位` : '合法方位' }}上，
            默认指向 0°；底部「距离-深度 TL 伪彩图」与「声线展示图」同步显示该方位的 TL 剖面与声线轨迹。
          </p>
        </div>
      </section>
    </aside>

    <!-- 底部：距离-深度 TL 伪彩图 + 声线展示图（两个独立组件，随方位指针实时切换） -->
    <div v-if="raySourceData && !cleanGlobeView" class="ray-profile-dock">
      <TransmissionLossProfileChart
        class="dock-card"
        :data="raySourceData"
        :ray-data="isRayModel ? staticRayData : null"
        :animated="useDynamicRays && verticalSliceControls.dynamicRays"
        :static-rays="verticalSliceControls.staticRays"
        :source-id="dataSource"
        :azimuth-deg="sliceAzimuthDeg"
        :max-radius-m="sourceRadiusKm * 1000"
        height="230px"
        @update:azimuth-deg="onProfileAzimuthChange"
      />
      <!-- 当前 TL 扇面对应的 Analyse2DRTRD 声线；切换方位时按罗盘方位重新获取并缓存。 -->
      <SoundRayChart
        class="dock-card"
        :data="raySourceData"
        :ray-data="useStaticRays && (verticalSliceControls.dynamicRays || verticalSliceControls.staticRays) ? staticRayData : null"
        :portal-rays-only="analysisMode === '3d'"
        :source-id="dataSource"
        :azimuth-deg="sliceAzimuthDeg"
        :tolerance-deg="Math.min(azimuthToleranceDeg, 5)"
        :max-radius-m="sourceRadiusKm * 1000"
        :source-depth-m="useStaticRays ? staticRaySourceDepthM : Number(sourcePoint?.depth_m)"
        :ray-count="10"
        :animated="useDynamicRays && verticalSliceControls.dynamicRays"
        height="230px"
        @update:azimuth-deg="onProfileAzimuthChange"
      />
    </div>

    <!-- 右下角图例 -->
    <div v-if="volumeData && !cleanGlobeView" class="legend-corner">
      <div class="legend-bar" :style="{ background: colorGradient }"></div>
      <div class="legend-labels">
        <span>{{ volumeLegend.inRangeMin }} {{ volumeLegend.unit }}</span>
        <span>{{ volumeLegend.inRangeMax }} {{ volumeLegend.unit }}</span>
      </div>
      <p class="legend-out-range">
        <span class="legend-swatch"></span>
        {{ volumeLegend.outOfRangeLabel }}
      </p>
    </div>

    <!-- 空态 / 错误提示 -->
    <div v-if="webgl2Supported === false" class="runtime-error">当前环境不支持 WebGL2 sampler3D 体渲染</div>
    <div v-if="!loading && !volumeData && viewerReady" class="empty-hint">填写「计算参数」后点击「提交计算」调用接口计算声场</div>
    </template>
  </div>
</template>

<script setup>
import { ref, shallowRef, shallowReactive, computed, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, nextTick } from 'vue'
import { Cesium, createCesiumViewer } from '@/utils/cesium.js'
import {
  SoundField,
  VOLUME_TL_COLOR_MIN,
  VOLUME_TL_COLOR_MAX,
  VOLUME_TL_LEGEND,
  VOLUME_TL_COLOR_STOPS,
  buildTlGradient,
  VOLUME_SLICE_MODE,
  DEFAULT_ALPHA_SCALE,
  DEFAULT_VALUE_ALPHA_RANGE,
  colorByTlRedBlue,
  parseAnalyse3DTlrd,
  parseAnalyse2DRtrd,
  decodeTlrdPolarVolume,
  ShaderVolume3DPrimitive,
  buildProfileModel,
  nearestAzimuthRow,
  normalizeAzimuth360,
  compassBearingToInternalAzimuth,
  internalAzimuthToCompassBearing,
  tlrdSectorAzimuths,
  minAzimuthSpacingDeg,
  stepAzimuth,
  resolveDynamicRayFrames,
} from '@/sdk'
// 距离-深度 TL 伪彩图 + 声线展示图：两个独立组件，共用 utils/soundProfileModel.js 解析
import TransmissionLossProfileChart from '@/components/TransmissionLossProfileChart.vue'
import SoundRayChart from '@/components/SoundRayChart.vue'
import { resolveRayFlow, sampleRayFlow } from '@/utils/rayFlow.js'
import { rayFlowClockElapsedMs, seekRayFlowClock, setRayFlowPaused, setRayFlowSpeed } from '@/utils/rayFlowClock.js'
import { createCurtainRayFlow } from '@/sdk/curtainRayFlow.js'
import { profileAxisGeometry } from '@/sdk/ncFieldModel.js'
import EnvironmentNoiseResult from '@/components/EnvironmentNoiseResult.vue'
import TerrainPreviewMode from '@/components/terrain/TerrainPreviewMode.vue'
import TerrainGlobeSelector from '@/components/terrain/TerrainGlobeSelector.vue'
import AisGlobalOverlay from '@/components/ais/AisGlobalOverlay.vue'
import AcousticRunPanel from '@/components/terrain/AcousticRunPanel.vue'
import StationPositionCard from '@/components/terrain/StationPositionCard.vue'
import UserMenu from '@/components/layout/UserMenu.vue'
import SoundSpeedProfile from '@/components/terrain/SoundSpeedProfile.vue'
import AmbientNoiseProbe from '@/components/terrain/AmbientNoiseProbe.vue'
import SignalTransmissionControls from '@/components/acoustic/SignalTransmissionControls.vue'
import VesselNoisePlaybackPanel from '@/components/acoustic/VesselNoisePlaybackPanel.vue'
import { normalizeSignalTransmissionControls, signalTransmissionControls } from '@/modules/acoustic/signalTransmissionControls.js'
import {
  runSignalTransmissionSession,
  signalTransmissionSession,
  stopSignalTransmissionSession,
} from '@/modules/acoustic/signalTransmissionSession.js'
import {
  backendWaveformSeries,
  backendSpectrogramMatrix,
  rollingBackendSpectrogramMatrix,
  rollingBackendWaveformSeries,
} from '@/modules/acoustic/signalTransmissionNoise.js'
import {
  clearTrackPoints,
  resetTrackPoints,
  restoreTrackPoints,
  trackFieldRunState,
  trackPointDrawing,
  trackPointState,
} from '@/modules/acoustic/trackPointState.js'
import {
  closeNoiseProbe,
  currentWeatherNoiseCurves,
  forecastNoiseSummary,
  noiseProbeState,
  openNoiseProbe,
  setWeatherNoisePoint,
  weatherNoiseState,
} from '@/modules/weather/weatherNoiseStore.js'
import { aisMonitorState, selectedAisVessel } from '@/modules/ais/aisMonitorStore.js'
import { estimateJomopansEchoSpectrum } from '@/utils/jomopansEcho.js'
import {
  buildVesselReceiveSpectrogram,
  buildSelectedVesselRoute,
  distancePerMinuteM,
  greatCircleDistanceM,
  initialBearingDeg,
  resampleTrackByDistance,
  resolveVesselSimulationProfile,
  routeDurationSeconds,
  routeSampleIndexAtTime,
  sampleReceiverTlDb,
  SELECTED_VESSEL_MAX_RANGE_NM,
} from '@/utils/vesselNoiseSimulation.js'
import { signalExcessState } from '@/modules/acoustic/signalExcessState.js'
import {
  buildDetectionClassGradient,
  createSignalExcessField,
  SIGNAL_EXCESS_COLOR_STOPS,
} from '@/utils/signalExcess.js'
import { normalizeLongitude, normalizeTerrainBounds } from '@/utils/terrainPreview.js'
import {
  acousticSceneState,
  activeVolumeColorStops,
  contrastedVolumeColorStops,
  opacityControlToAlphaScale,
  volumeRenderingControls,
} from '@/modules/acoustic/volumeRenderingControls.js'
import { verticalSliceControls } from '@/modules/acoustic/verticalSliceControls.js'
import { simulationControls } from '@/modules/acoustic/simulationControls.js'
import {
  annotatePropagationReceiver,
  publishPropagationLink,
} from '@/modules/array-fusion/propagationLinkState.js'
import { applyGlobeCamera, captureGlobeCamera } from '@/modules/array-fusion/globeCameraState.js'
import {
  clearEnvironmentNoise,
  publishEnvironmentNoise,
} from '@/modules/array-fusion/environmentNoiseState.js'
// 二维声场：栅格化为影像图层贴在 Cesium 球面（不再是小窗口图表）
import { buildOmniField } from '@/utils/omniFieldModel.js'
import { buildOmniFieldImage } from '@/utils/omniFieldImage.js'
import {
  canSampleTerrain,
  maskVolumeByTerrain,
  sampleTerrainProfile,
} from '@/sdk/terrainVolumeMask.js'
import { acousticTerrainBounds } from '@/utils/bathymetry.js'
import { loadAcousticJob, loadAcousticJobParams, loadAcousticJobResult } from '@/api/jobWorkspaceApi.js'
import {
  activateWorkspace,
  attachJobToActiveWorkspace,
  jobWorkspace,
  markJobClosed,
  markJobOpened,
  saveWorkspaceDraft,
  workspaceRecordById,
} from '@/modules/acoustic/jobWorkspace.js'
import { createDefaultNoiseScenario, validateNoiseScenario } from '@/utils/noiseTimeFrequency.js'
import { useDraggablePanel } from '@/composables/useDraggablePanel.js'
import {
  BOTTOM_ACOUSTIC_DATA_TYPES,
  BOTTOM_TYPE_DATA_TYPE,
  buildRoutePoints,
  buildBottomTypeSegments,
  enrichBottomTypeSegments,
} from '@/utils/bottomTypeModel.js'
// 声场计算接口：提交参数后直接调用后端 portal 同步计算（不再读取静态 JSON）
import {
  analyse3dTLRDByModel,
  analyse2dTLRDByModel,
  analyse2dRTRD,
  analyseIce2dRTRD,
  analyse2dDynamicRTRD,
  analyseIce2dDynamicRTRD,
  analyse3dDynamicRTRD,
  analyseIce3dDynamicRTRD,
  portalPluginForModel,
  getDatasetTimeList,
  getEnvDataRoute,
  getEnvDataRegion,
  analyseEnvironmentNoise,
} from '@/api/soundFieldApi.js'
import { adapt3dRayResponseToAzimuths } from '@/utils/threeDRayAdapter.js'

const props = defineProps({
  activeSubmoduleId: { type: String, default: '3d' },
  sidebarOpen: { type: Boolean, default: false },
  submoduleSelectionVersion: { type: Number, default: 0 },
  viewMode: { type: String, default: 'globe' },
  runToken: { type: Number, default: 0 },
  signalRunToken: { type: Number, default: 0 },
  signalStopToken: { type: Number, default: 0 },
  thumbnailCollapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['update:view-mode', 'update:thumbnailCollapsed'])

function emitViewMode(mode) {
  emit('update:view-mode', mode === 'terrain' ? 'terrain' : 'globe')
}

const rootEl = ref(null)
const cesiumContainer = ref(null)
const {
  panelRef: parameterPanelRef,
  dragging: parameterPanelDragging,
  dragStyle: parameterPanelDragStyle,
  startDragging: startParameterPanelDrag,
  resetPanelPosition: resetParameterPanelPosition,
} = useDraggablePanel()
const dataSource = ref('tlrd')
const analysisMode = ref(
  props.activeSubmoduleId === 'noise' ? 'noise' : props.activeSubmoduleId === '2d' ? '2d' : '3d'
)
const isNoiseMode = computed(() => analysisMode.value === 'noise')
// 进入页面默认不展开任何参数配置窗口；由顶部「水声」模块入口按需打开。
const parameterPanelOpen = ref(false)
const terrainRunVisible = ref(false)
const terrainRunMinimized = ref(false)
const terrainRunTime = ref('')
const stationPositionOpen = ref(false)
const stationPositionPoint = ref(null)
const stationPositionTime = ref('')
const stationPositionHasRun = ref(false)
/** 参数卡片打开期间被临时替换的声场运行面板 id。 */
const runSettingsHiddenPanelId = ref('')
const terrainAnchor = ref(null)
const terrainPreviewRef = ref(null)
const terrainSliceOpen = ref(false)
const terrainLossChartRef = ref(null)
const terrainProfileOpen = ref(false)
const terrainSliceMinimized = ref(false)
const terrainProfileMinimized = ref(false)
const vesselWaveformMinimized = ref(false)
const vesselSpectrogramMinimized = ref(false)
const sourceWaveformMinimized = ref(false)
const sourceSpectrogramMinimized = ref(false)
/** 按最小化发生的先后顺序排列；恢复后移出，再次最小化时追加到队尾。 */
const terrainWindowDockOrder = ref([])
const terrainNoiseMinimized = ref(false)
const terrainSource = ref({ lon: 116, lat: 16, depth: 150 })
/** 默认地形框边长 100 km×100 km；acousticTerrainBounds 按 6× 半径展开。 */
const DEFAULT_TERRAIN_SPAN_KM = 100
/** 到达结构保持 50 m 精度；三维声场体每 500 m 更新一次，避免重复重算。 */
const SIGNAL_ARRIVAL_WAYPOINT_SPACING_M = 50
/** 后端有四个独立声场进程；航迹点按四个一组提交，避免结果无限堆积在浏览器内存。 */
const TRACK_FIELD_CONCURRENCY = 4
const terrainRadiusKm = ref(DEFAULT_TERRAIN_SPAN_KM / 6)
/** 历史声场与工作区声场共用同一套胶囊 / 垂直切面 / 动态声线数据。 */
const runHistoryLayers = shallowRef([])
/** 当前新计算结果对应的后端工作号；归档后转移到历史图层。 */
const currentJobId = ref('')
/** 当前垂直切面 / 动态声线所展示的历史声场；空表示当前运行结果。 */
const selectedProfileLayerId = ref('')
/**
 * 工作区结果引用：二维声场、环境噪声、信号链等不进入三维图层的任务。
 * 与 snapshot 一起保存到后端；打开工作区时按 kind 逐个恢复。
 */
const workspaceResultRefs = ref([])
let restoringWorkspaceResults = false
/** 最近一次提交的信号链请求；工作区恢复时可据此重放连续链路结果。 */
let lastSignalRequest = null
const selectedProfileLayer = computed(() => (
  runHistoryLayers.value.find(layer => layer.id === selectedProfileLayerId.value) || null
))
const CURRENT_RUN_PANEL_ID = 'current-run'
/** 当前声场与历史声场共用一个按最小化先后排序的顶部任务条。 */
const runPanelDockOrder = ref([])
const openingJobIds = ref([])
const terrainJobAnchors = ref({})
const JOB_LAYER_ACCENTS = Object.freeze(['#bb62ff', '#39e6d1', '#ff9d5c', '#65a8ff', '#f06fa9'])
const terrainJobFields = computed(() => runHistoryLayers.value.map(layer => ({
  id: layer.id,
  field: layer.field,
  // 历史声场同样携带自己的 GPU 体纹理，供地形 WebGL 多体渲染。
  texture: layer.texture || null,
  source: layer.source,
  visible: layer.visible,
  accent: layer.accent,
})))
const visibleRunHistoryPanels = computed(() => runHistoryLayers.value.filter(
  layer => layer.panelVisible !== false && layer.id !== runSettingsHiddenPanelId.value
))
const minimizedRunPanelIds = computed(() => runPanelDockOrder.value.filter((id) => {
  if (id === CURRENT_RUN_PANEL_ID) return terrainRunVisible.value && terrainRunMinimized.value
  const layer = runHistoryLayers.value.find(item => item.id === id)
  return !!layer && layer.panelVisible !== false && layer.panelMinimized
}))
const minimizedRunPanelCount = computed(() => Math.max(1, minimizedRunPanelIds.value.length))
function runPanelDockIndex(id) {
  const index = minimizedRunPanelIds.value.indexOf(id)
  return index < 0 ? 0 : index
}
/** 全球视图红框选择的区域：加载后作为地形模式的初始区域。 */
const defaultGlobeSelection = acousticTerrainBounds(
  { lon: 116, lat: 16 },
  DEFAULT_TERRAIN_SPAN_KM / 6
)
const globeSelection = ref(normalizeTerrainBounds(defaultGlobeSelection))
/** 每次从全球视图点击“加载”都递增，地形模式据此重新加载选区。 */
const globeSelectionToken = ref(0)
/** 地形缩放到最小时，先淡出地形并在数字地球上继续缩小，再回到全球视图。 */
const terrainLeaving = ref(false)
/** 缩回全球视图后暂时隐藏结果窗口/体渲染，保持与首次进入时一致的干净全球视图。 */
const cleanGlobeView = ref(false)
/**
 * 缩回全球后不立即弹出“返回刚才地形”的红框，保持与首次进入一致的干净全球视图；
 * 用户继续放大到阈值后，选框才出现在刚才的区域中心（由 TerrainGlobeSelector 控制）。
 */
const terrainReturnAvailable = ref(false)
let terrainLeaveTimer = 0
let terrainWheelBlocker = null
function setTerrainWheelBlocker(active) {
  const canvas = viewer?.canvas
  if (!canvas) return
  if (active) {
    if (terrainWheelBlocker) return
    terrainWheelBlocker = (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    canvas.addEventListener('wheel', terrainWheelBlocker, { capture: true, passive: false })
    return
  }
  if (!terrainWheelBlocker) return
  canvas.removeEventListener('wheel', terrainWheelBlocker, { capture: true })
  terrainWheelBlocker = null
}
function clearTerrainReturn() {
  terrainReturnAvailable.value = false
}
function returnToTerrain() {
  clearTerrainReturn()
  emitViewMode('terrain')
}
/**
 * 缩回全球时恢复“刚进入网页”的状态：关闭结果窗口，隐藏三维体、二维投影、
 * 剖面帘、声线、方位指针和图例/剖面图；保留已算出的数据供再次进入地形使用。
 */
function enterCleanGlobeView({ skipRendererSync = false } = {}) {
  cleanGlobeView.value = true
  resultPanelOpen.value = false
  renderControlsOpen.value = false
  parameterPanelOpen.value = false
  activeMapPick.value = ''
  statusText.value = ''
  volumeVisible.value = false
  applyVolumeVisible(false)
  omni2dVisible.value = false
  clearOmni2dLayer()
  if (earthRaysVisibleBeforeGlobe === null) {
    earthRaysVisibleBeforeGlobe = earthRaysVisible.value
  }
  if (skipRendererSync) {
    // 侧栏直接切换时，全球端的体渲染器已在进入地形模式时释放。
    // 此处只同步显隐状态，不能再调用 syncSoundField() 把 GPU 资源重建回来。
    earthRaysVisible.value = false
    twoDRayFlowRenderer?.setVisible(false)
    stopVolumeRayAnimation()
    stopSliceRayAnimation()
  } else {
    setEarthRaysVisible(false)
  }
  pointerEnabled.value = false
  applyPointerVisibility()
  sliceDisplayMode.value = 'off'
  removeSliceCurtain()
  removeCurtainPrimitive()
  clearTwoDMapFeatures()
  refreshPickMarkers()
  viewer?.scene?.requestRender?.()
}
function syncGlobeSelection(bounds) {
  if (!bounds) return
  globeSelection.value = normalizeTerrainBounds(bounds)
}
/** 框选区域进入地形时，把仿真配置的声源定位到框选中心。 */
function syncSimulationSourceToBoundsCenter(bounds) {
  if (!bounds) return
  const target = normalizeTerrainBounds(bounds)
  const lon = normalizeLongitude((Number(target.west) + Number(target.east)) / 2)
  const lat = (Number(target.south) + Number(target.north)) / 2
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  calcParams.value.coordX = Number(lon.toFixed(6))
  calcParams.value.coordY = Number(lat.toFixed(6))
}
function loadGlobeTerrain(bounds) {
  globeSelection.value = normalizeTerrainBounds(bounds)
  syncSimulationSourceToBoundsCenter(bounds)
  globeSelectionToken.value += 1
  emitViewMode('terrain')
}
function leaveTerrainForGlobe(payload) {
  if (terrainLeaving.value) return
  const target = normalizeTerrainBounds(payload?.bounds || globeSelection.value || {
    west: Number(calcParams.value.coordX) - 0.6,
    east: Number(calcParams.value.coordX) + 0.6,
    south: Number(calcParams.value.coordY) - 0.6,
    north: Number(calcParams.value.coordY) + 0.6,
  })
  terrainLeaving.value = true
  setTerrainWheelBlocker(true)
  clearTerrainReturn()
  // 记住所选区域，供缩回全球后的红框和“返回刚才地形”使用。
  globeSelection.value = target
  enterCleanGlobeView()

  const centerLon = normalizeLongitude((target.west + target.east) / 2)
  const centerLat = (target.south + target.north) / 2
  if (viewer && !viewer.isDestroyed?.()) {
    const spanLatM = Math.max(0.5, target.north - target.south) * 110574
    const spanLonM = Math.max(0.5, target.east - target.west) * 111320 *
      Math.cos(centerLat * Math.PI / 180)
    const spanM = Math.max(spanLatM, spanLonM)
    const altitude = Math.min(6000000, Math.max(40000, spanM * 1.8))
    try {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, altitude),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      })
      nextTick(() => viewer?.scene?.requestRender?.())
    } catch {}
  }

  clearTimeout(terrainLeaveTimer)
  terrainLeaveTimer = window.setTimeout(() => {
    terrainLeaveTimer = 0
    emitViewMode('globe')
    nextTick(() => {
      if (!terrainLeaving.value) return
      if (!viewer || viewer.isDestroyed?.()) {
        terrainLeaving.value = false
        return
      }
      if (typeof viewer.resize === 'function') viewer.resize()
      viewer.scene?.requestRender?.()
      const finish = () => {
        clearTimeout(terrainLeaveTimer)
        terrainLeaveTimer = 0
        setTerrainWheelBlocker(false)
        terrainLeaving.value = false
        clearTerrainReturn()
      }
      // 兜底：即使相机飞行被第三方打断且没有回调，也恢复选框/工具。
      terrainLeaveTimer = window.setTimeout(finish, 3000)
      try {
        if (typeof viewer.camera.flyTo === 'function') {
          viewer.camera.flyTo({
            // 缩回后仍以刚才的区域为中心，用户在同一位置继续放大到一定高度时，
            // 选框正好落回刚才的地形区域，而不是出现在极区大框。
            destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 18000000),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
            duration: 1.8,
            complete: finish,
            cancel: finish,
          })
        } else {
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 18000000),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          })
          finish()
        }
      } catch {
        try {
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 18000000),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          })
        } catch {}
        finish()
      }
    })
  }, 360)
}
// 地形预览的 GPU 体纹理；必须早于 immediate 监听声明，避免 setup 时的暂时性死区。
const terrainTexture = shallowRef(null)
const terrainField = computed(() => {
  // 地形预览使用自己解码并上传到 WebGL 的 terrainTexture；全球视图才依赖
  // Cesium 的 volumeData。因此只要有一份可渲染的体数据即可，不能强制要求
  // volumeData，否则地形模式会一直显示“无计算结果”。
  if (analysisMode.value !== '3d' || !raySourceData.value || loading.value) return null
  if (!volumeData.value && !terrainTexture.value) return null
  try { return parseAnalyse3DTlrd(raySourceData.value) } catch { return null }
})
const hasTerrainVolume = computed(() => Boolean(terrainField.value) || terrainJobFields.value.some(
  layer => layer.visible !== false && Boolean(layer.field)
))

/** 信号余量 NL：天气与环境噪声当前选定频带的环境噪声（WENZ）总噪声级。 */
const signalExcessNoiseLevel = computed(() => {
  const level = Number(forecastNoiseSummary.value?.bandLevelDb)
  return Number.isFinite(level) ? level : null
})
/** 打开信号余量且 NL 可用时的 SE 参数；否则返回 null（保持原场渲染）。 */
const signalExcessParams = computed(() => {
  const noiseLevel = signalExcessNoiseLevel.value
  if (!signalExcessState.enabled || !Number.isFinite(noiseLevel)) return null
  return {
    sourceLevel: signalExcessState.sourceLevel,
    noiseLevel,
    detectionThreshold: signalExcessState.detectionThreshold,
    arrayGain: signalExcessState.arrayGain,
    minDepth: signalExcessState.minDepth,
    maxDepth: signalExcessState.maxDepth,
    fullDepth: signalExcessState.fullDepth,
    sigma: signalExcessState.sigma,
    displayMode: signalExcessState.displayMode,
    threeColor: signalExcessState.threeColor,
  }
})
/** 把单个 TL 场包成 SE 场；未启用或参数无效时原样返回。 */
function wrapSignalExcess(field) {
  const params = signalExcessParams.value
  if (!params || !field) return field
  return createSignalExcessField(field, params) || field
}
/** 打开信号余量时用 SE 体替换主声场体；历史/工作图层同样替换，确保当前可见的声场都变成 SE。 */
const terrainRenderField = computed(() => wrapSignalExcess(terrainField.value))
const terrainRenderFields = computed(() => terrainJobFields.value.map(layer => (
  layer.field ? { ...layer, field: wrapSignalExcess(layer.field) } : layer
)))

/** 工作记录只归档了结果与少量元数据，按结果网格和记录元数据补全计算参数。 */
function jobCalculationParams(job = {}, field = null) {
  const source = job.source || {}
  const grid = field?.grid || {}
  const stored = job.params || job.calculation_params || job.calc_params || job.request || {}
  // 任务目录中的 params.json 同时保存了门户请求原文，优先使用其中的精确参数。
  const portal = stored.portal_request && typeof stored.portal_request === 'object'
    ? stored.portal_request
    : {}
  const reference = { ...stored, ...portal }
  const params = { ...JSON.parse(JSON.stringify(calcParams.value)), ...reference }
  const distanceMaxKm = (Array.isArray(grid.distance) ? grid.distance : [])
    .map(Number)
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0) / 1000
  const radiusKm = Math.max(
    0.1,
    Number(job.radius_km) || Number(stored.radius_km) || distanceMaxKm || Number(portal.range) * 1.852 || 20
  )
  const frequency = Number(job.frequency_hz) || Number(field?.meta?.frequencyHz)
    || Number(reference.minFreq ?? reference.freq_hz) || 100
  const centerAngle = Number(portal.grazingAngle ?? reference.grazingAngle)
  const beamWidth = Number(portal.beamWidth ?? reference.beamWidth)
  const hasBeam = Number.isFinite(centerAngle) && Number.isFinite(beamWidth)
  const model = ['bellhop', 'ram', 'kraken'].includes(String(stored.acoustic_model || job.model || params.model || '').toLowerCase())
    ? String(stored.acoustic_model || job.model || params.model).toLowerCase()
    : 'bellhop'
  const rawTime = String(portal.time || stored.environment_time || params.time || '2025-01-02T12:00:00').replace(' ', 'T')
  const lon = Number(source.lon ?? portal.coordX ?? stored.center_lon ?? params.coordX)
  const lat = Number(source.lat ?? portal.coordY ?? stored.center_lat ?? params.coordY)
  const depth = Number(source.depth_m ?? portal.srcDepth ?? stored.source_depth_m ?? params.srcDepth)
  return {
    ...params,
    dataset: 'HYCOM',
    time: rawTime,
    regionType: stored.region_type || (/ice|冰/i.test(String(job.model_label || '') + String(portal.dataType || stored.data_type || '')) ? 'ice' : 'normal'),
    coordX: Number.isFinite(lon) ? lon : Number(params.coordX),
    coordY: Number.isFinite(lat) ? lat : Number(params.coordY),
    srcDepth: Number.isFinite(depth) ? depth : Number(params.srcDepth),
    range: radiusKm / 1.852,
    minFreq: frequency,
    maxFreq: frequency,
    model,
    sector: Math.max(1, Number(grid.sector) || Number(portal.sector) || Number(stored.section_count) || Number(params.sector) || 1),
    lineCount: Math.max(0, Number(portal.lineCount ?? reference.lineCount ?? params.lineCount) || 10),
    grazingAngleMin: hasBeam ? centerAngle - beamWidth / 2 : Number(params.grazingAngleMin),
    grazingAngleMax: hasBeam ? centerAngle + beamWidth / 2 : Number(params.grazingAngleMax),
    rayInterface: 'dynamic',
    coherent: Boolean(reference.coherent ?? params.coherent),
  }
}

async function openWorkspaceJob(jobId, { activate = true, skipWorkspaceRecord = false } = {}) {
  const id = String(jobId || '')
  if (!id) return
  const workspaceRecord = skipWorkspaceRecord ? null : workspaceRecordById(id)
  if (workspaceRecord) {
    if (workspaceRecord.snapshot) await applyWorkspaceSnapshot(workspaceRecord.snapshot)
    activateWorkspace(id)
    const childJobIds = [...new Set((workspaceRecord.job_ids || workspaceRecord.jobIds || (workspaceRecord.jobId ? [workspaceRecord.jobId] : [])).map(String).filter(Boolean))]
    for (const childJobId of childJobIds) {
      await openWorkspaceJob(childJobId, { activate: false, skipWorkspaceRecord: true })
    }
    const resultRefs = Array.isArray(workspaceRecord.snapshot?.resultRefs) ? workspaceRecord.snapshot.resultRefs : []
    if (resultRefs.length) await restoreWorkspaceResults(resultRefs)
    markJobOpened(id)
    if (activate) {
      emitViewMode('terrain')
      const lastLayer = [...runHistoryLayers.value].reverse().find(layer => childJobIds.includes(String(layer.jobId)))
      // 新版工作区以保存的地形边界为准；仅兼容没有现场快照的旧记录时，
      // 才退回到最后一个声场的声源范围。
      if (!workspaceRecord.snapshot?.globeSelection && lastLayer) {
        focusRunHistoryLayer(lastLayer.id, DEFAULT_TERRAIN_SPAN_KM)
      }
    }
    return true
  }
  if (currentJobId.value === id && terrainRunVisible.value) {
    markJobOpened(id)
    if (activate) emitViewMode('terrain')
    return true
  }
  const existing = runHistoryLayers.value.find(layer => layer.jobId === id)
  if (existing) {
    existing.visible = true
    existing.panelVisible = true
    existing.panelMinimized = false
    if (runSettingsHiddenPanelId.value === existing.id) runSettingsHiddenPanelId.value = ''
    removeRunPanelFromDock(existing.id)
    refreshRunHistoryLayers()
    markJobOpened(id)
    if (activate) {
      emitViewMode('terrain')
      focusRunHistoryLayer(existing.id, DEFAULT_TERRAIN_SPAN_KM)
    }
    return true
  }
  if (openingJobIds.value.includes(id)) return
  openingJobIds.value = [...openingJobIds.value, id]
  try {
    const [payload, storedParams] = await Promise.all([
      loadAcousticJob(id),
      loadAcousticJobParams(id).catch(() => null),
    ])
    const parsed = parseAnalyse3DTlrd(payload?.result ?? payload)
    const job = { ...(payload?.job || {}) }
    if (storedParams) job.params = storedParams
    const source = {
      lon: Number(job.source?.lon),
      lat: Number(job.source?.lat),
      depth: Number(job.source?.depth_m) || 0,
    }
    if (!Number.isFinite(source.lon) || !Number.isFinite(source.lat)) throw new Error('工作记录缺少有效声源坐标')
    const distanceMaxKm = Math.max(...parsed.grid.distance.map(Number).filter(Number.isFinite), 0) / 1000
    const radiusKm = Math.max(0.1, Number(job.radius_km) || distanceMaxKm || 20)
    const initialAzimuth = compassBearingToInternalAzimuth(Number(parsed.grid.compassBearings?.[0]) || 0)
    // 工作记录同样构建一份 GPU 体纹理，使历史声场也用光线步进而非 Canvas 面片。
    let texture = null
    try {
      const strictNearest = volumeRenderingControls.strictNearest === true
      texture = decodeTlrdPolarVolume(parsed, {
        sourceLon: source.lon,
        sourceLat: source.lat,
        angleInterp: strictNearest ? 1 : TLRD_ANGLE_INTERP,
        strictNearest,
      })
      try {
        await maskVolumeByTerrain(texture, viewer?.scene?.terrainProvider)
      } catch (error) {
        console.warn('[工作声场地形掩膜] 保留接口海底裁剪：', error?.message ?? error)
      }
    } catch (error) {
      console.warn('[工作声场 GPU 纹理] 构建失败，将回退到 Canvas：', error?.message ?? error)
      texture = null
    }
    const layer = shallowReactive({
      id,
      jobId: id,
      origin: 'workspace',
      field: parsed,
      texture,
      source,
      radiusKm,
      visible: true,
      accent: JOB_LAYER_ACCENTS[runHistoryLayers.value.length % JOB_LAYER_ACCENTS.length],
      panelVisible: true,
      panelMinimized: false,
      // 胶囊与声场胶囊一致，仅把运行时间替换为工作记录 ID。
      time: id,
      anchor: null,
      params: jobCalculationParams(job, parsed),
      rayInterface: 'dynamic',
      rayData: null,
      rayAzimuthDeg: initialAzimuth,
      sliceAzimuthDeg: initialAzimuth,
      sourceRadiusKm: radiusKm,
      sourceDepthM: Number(source.depth) || 0,
      bottomTypeSegments: [],
      bottomTypeState: 'idle',
    })
    runHistoryLayers.value = [...runHistoryLayers.value, layer]
    markJobOpened(id)
    if (activate) {
      emitViewMode('terrain')
      focusRunHistoryLayer(id, DEFAULT_TERRAIN_SPAN_KM)
    }
    return true
  } catch (error) {
    console.error('[工作声场] 打开失败：', error)
    runtimeError.value = `工作 ${id} 打开失败：${error?.message || error}`
    return false
  } finally {
    openingJobIds.value = openingJobIds.value.filter(value => value !== id)
  }
}

watch(() => jobWorkspace.openRequestToken, () => {
  openWorkspaceJob(jobWorkspace.requestedJobId)
})
watch(() => jobWorkspace.closeRequestToken, () => {
  for (const jobId of jobWorkspace.closeRequestedJobIds) {
    const layer = runHistoryLayers.value.find(item => item.jobId === jobId)
    if (layer) closeRunHistoryLayer(layer.id)
    else if (currentJobId.value === jobId) closeTerrainRun()
    else markJobClosed(jobId)
  }
})
watch(() => jobWorkspace.saveRequestToken, () => {
  void saveWorkspaceDraft(captureWorkspaceSnapshot())
})
// 信号链在 WebSocket 结束后登记进工作区；恢复重放不重复登记。
watch(() => signalTransmissionSession.state, (state) => {
  if (state !== 'complete' || restoringWorkspaceResults) return
  const result = signalTransmissionSession.result
  const request = lastSignalRequest
  if (!result || !request) return
  const jobId = String(result.job_id || '').trim()
  if (!jobId) return
  lastSignalRequest = null
  const stream = String(request.channel_mode || '') === 'waypoint'
  void attachResultToActiveWorkspace({
    kind: stream ? 'signal_stream' : 'signal',
    jobId,
    request: cloneWorkspacePlain(request),
    label: '信号链工作区',
  })
}, { flush: 'post' })
const { panelRef: terrainSliceRef, dragStyle: terrainSliceStyle, startDragging: startTerrainSliceDrag } = useDraggablePanel()
const { panelRef: terrainProfileRef, dragStyle: terrainProfileStyle, startDragging: startTerrainProfileDrag } = useDraggablePanel()
const terrainSliceAngleLabel = computed(() => {
  const layer = selectedProfileLayer.value
  const azimuth = layer ? Number(layer.sliceAzimuthDeg) || 0 : Number(sliceAzimuthDeg.value) || 0
  const compass = ((Math.round(internalAzimuthToCompassBearing(azimuth)) % 360) + 360) % 360
  const cardinal = compass === 0 ? 'N' : compass === 90 ? 'E' : compass === 180 ? 'S' : compass === 270 ? 'W' : ''
  return `${compass}°${cardinal ? ` ${cardinal}` : ''}`
})
const minimizedTerrainWindows = computed(() => terrainWindowDockOrder.value.filter((id) => {
  if (id === 'slice') return terrainSliceOpen.value && terrainSliceMinimized.value
  if (id === 'profile') return terrainProfileOpen.value && terrainProfileMinimized.value
  if (id === 'waveform') return signalTransmissionControls.showWaveform && vesselWaveformMinimized.value
  if (id === 'spectrogram') return signalTransmissionControls.showTimeFrequency && vesselSpectrogramMinimized.value
  if (id === 'source-waveform') return signalTransmissionControls.showSourceWaveform && sourceWaveformMinimized.value
  if (id === 'source-spectrogram') return signalTransmissionControls.showSourceTimeFrequency && sourceSpectrogramMinimized.value
  return noiseProbeState.open && terrainNoiseMinimized.value
}))
function terrainWindowTitle(id) {
  if (id === 'slice') return `垂直切面 · ${terrainSliceAngleLabel.value}`
  if (id === 'profile') return '声速剖面'
  if (id === 'waveform') return '水听器时域波形'
  if (id === 'spectrogram') return '水听器时频图'
  if (id === 'source-waveform') return '航迹声源时域波形'
  if (id === 'source-spectrogram') return '航迹声源时频图'
  return '环境噪声'
}
function removeTerrainWindowFromDock(id) {
  terrainWindowDockOrder.value = terrainWindowDockOrder.value.filter((item) => item !== id)
}
function minimizeTerrainWindow(id) {
  if (id === 'slice') {
    terrainSliceOpen.value = true
    terrainSliceMinimized.value = true
  } else if (id === 'profile') {
    terrainProfileOpen.value = true
    terrainProfileMinimized.value = true
  } else if (id === 'waveform') {
    vesselWaveformMinimized.value = true
  } else if (id === 'spectrogram') {
    vesselSpectrogramMinimized.value = true
  } else if (id === 'source-waveform') {
    sourceWaveformMinimized.value = true
  } else if (id === 'source-spectrogram') {
    sourceSpectrogramMinimized.value = true
  } else {
    terrainNoiseMinimized.value = true
  }
  // 已在任务条中的窗口重新最小化时也排到最后。
  terrainWindowDockOrder.value = [...terrainWindowDockOrder.value.filter((item) => item !== id), id]
}
function restoreTerrainWindow(id) {
  if (id === 'slice') {
    terrainSliceMinimized.value = false
    nextTick(() => terrainLossChartRef.value?.refreshLayout?.())
  } else if (id === 'profile') {
    terrainProfileMinimized.value = false
  } else if (id === 'waveform') {
    vesselWaveformMinimized.value = false
  } else if (id === 'spectrogram') {
    vesselSpectrogramMinimized.value = false
  } else if (id === 'source-waveform') {
    sourceWaveformMinimized.value = false
  } else if (id === 'source-spectrogram') {
    sourceSpectrogramMinimized.value = false
  } else {
    terrainNoiseMinimized.value = false
  }
  removeTerrainWindowFromDock(id)
}
function closeTerrainWindow(id) {
  if (id === 'slice') {
    terrainSliceOpen.value = false
    terrainSliceMinimized.value = false
    // 关闭窗口不改变活动声场：方向方位线仍跟随当前选中的（可能是归档的原始）声场。
  } else if (id === 'profile') {
    terrainProfileOpen.value = false
    terrainProfileMinimized.value = false
  } else if (id === 'waveform') {
    signalTransmissionControls.showWaveform = false
    vesselWaveformMinimized.value = false
  } else if (id === 'spectrogram') {
    signalTransmissionControls.showTimeFrequency = false
    vesselSpectrogramMinimized.value = false
  } else if (id === 'source-waveform') {
    signalTransmissionControls.showSourceWaveform = false
    sourceWaveformMinimized.value = false
  } else if (id === 'source-spectrogram') {
    signalTransmissionControls.showSourceTimeFrequency = false
    sourceSpectrogramMinimized.value = false
  } else {
    closeNoiseProbe()
    terrainNoiseMinimized.value = false
  }
  removeTerrainWindowFromDock(id)
}
function appendRunPanelToDock(id) {
  runPanelDockOrder.value = [...runPanelDockOrder.value.filter(item => item !== id), id]
}
function removeRunPanelFromDock(id) {
  runPanelDockOrder.value = runPanelDockOrder.value.filter(item => item !== id)
}
function refreshRunHistoryLayers() {
  runHistoryLayers.value = [...runHistoryLayers.value]
}
function minimizeTerrainRun() {
  terrainRunVisible.value = true
  terrainRunMinimized.value = true
  appendRunPanelToDock(CURRENT_RUN_PANEL_ID)
  parameterPanelOpen.value = false
  timePickerOpen.value = false
}
function restoreTerrainRun() {
  terrainRunMinimized.value = false
  removeRunPanelFromDock(CURRENT_RUN_PANEL_ID)
  parameterPanelOpen.value = false
}
function minimizeRunHistoryPanel(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  layer.panelMinimized = true
  appendRunPanelToDock(id)
  refreshRunHistoryLayers()
}
function restoreRunHistoryPanel(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  layer.panelMinimized = false
  removeRunPanelFromDock(id)
  refreshRunHistoryLayers()
}
function toggleRunHistoryLayer(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  layer.visible = !layer.visible
  try {
    if (layer.renderer?.primitive) layer.renderer.primitive.show = layer.visible && volumeVisible.value
  } catch {}
  refreshRunHistoryLayers()
  viewer?.scene?.requestRender?.()
}
function focusRunHistoryLayer(id, spanKm = 0) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  if (!layer.visible) {
    layer.visible = true
    refreshRunHistoryLayers()
  }
  // 工作区记录默认使用固定 100 km 区域，并把声源放在地形中心；
  // 不传 span 时沿用该声场自身的传播半径。
  const span = Number(spanKm) > 0 ? Number(spanKm) : Number(layer.radiusKm) * 6
  globeSelection.value = acousticTerrainBounds(layer.source, Math.max(0.1, span / 6))
  // 两条路径都触发：直接调用避免视图切换时序竞争，token 作为组件尚未就绪时的兜底。
  if (Number(spanKm) > 0) terrainPreviewRef.value?.focusBounds?.(globeSelection.value)
  globeSelectionToken.value += 1
}
/** 历史声场胶囊「模拟运行」：恢复该次参数并重新计算。 */
function runRunHistoryLayer(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer?.params || loading.value) return
  if (analysisMode.value !== '3d') switchMode('3d')
  Object.assign(calcParams.value, JSON.parse(JSON.stringify(layer.params)))
  runTerrainField()
}
/** 历史声场的动态声线请求，按图层去重，避免重复点击时并发调用接口。 */
const historyRayRequests = new Map()
/** 方位拖动时延迟补算历史 / 工作声场的动态声线。 */
let historyRayTimer = 0
/**
 * 历史声场按归档时的参数补算当前方位的动态声线。
 * 归档时若尚未点过「二维传播损失」，rayData 为空；此时按该次声源 / 方位补算，
 * 保证切面与三维体上都能显示动态声线。
 */
function azimuthDeltaDeg(a, b) {
  return Math.abs((((Number(a) - Number(b)) % 360) + 540) % 360 - 180)
}
/** 动态声线接口只支持 Bellhop；缺失模型时按 Bellhop 处理。 */
function isHistoryRayCapable(layer) {
  if (!layer?.params) return false
  const model = String(layer.params.model || '').trim().toLowerCase()
  return !model || model === 'bellhop'
}
async function ensureHistoryLayerDynamicRays(layer) {
  if (!isHistoryRayCapable(layer)) {
    if (layer) layer.rayLoading = false
    return null
  }
  const desiredAzimuth = normalizeAzimuth360(Number(layer.sliceAzimuthDeg) || 0)
  const cachedAzimuth = Number(layer.rayAzimuthDeg ?? layer.sliceAzimuthDeg)
  const matchesAzimuth = azimuthDeltaDeg(cachedAzimuth, desiredAzimuth) < 1e-6
  if (layer.rayData && layer.rayInterface === 'dynamic' && matchesAzimuth) return layer.rayData

  const requestKey = `${layer.id}:${desiredAzimuth.toFixed(4)}`
  if (historyRayRequests.has(requestKey)) return historyRayRequests.get(requestKey)

  const params = layer.params
  const request = (async () => {
    // 历史声场同样默认调用二维动态声线：只请求当前切面对应方位。
    const portalBearing = internalAzimuthToCompassBearing(desiredAzimuth)
    const payload = portalParamsFor(params, {
      range: Number(params.range),
      lineCount: Number(params.lineCount),
      azimuth: portalBearing,
      rtimeRes: 0,
    })
    await attachRayTerrainProfile(payload, params, portalBearing, Number(params.range))
    const ice = params.regionType === 'ice'
    const rayData = ice
      ? await analyseIce2dDynamicRTRD(payload)
      : await analyse2dDynamicRTRD(payload)
    if (!rayData) return null
    // 方位已变化时丢弃过期结果，避免把旧方位的声线画到新切面上。
    if (azimuthDeltaDeg(layer.sliceAzimuthDeg, desiredAzimuth) > 1e-6) {
      return rayData
    }
    layer.rayData = rayData
    layer.rayInterface = 'dynamic'
    layer.rayAzimuthDeg = desiredAzimuth
    refreshRunHistoryLayers()
    if (selectedProfileLayerId.value === layer.id) viewer?.scene?.requestRender?.()
    return rayData
  })()
  historyRayRequests.set(requestKey, request)
  layer.rayLoading = true
  refreshRunHistoryLayers()
  try {
    return await request
  } catch (error) {
    console.warn('[历史声场动态声线]', error?.message ?? error)
    if (selectedProfileLayerId.value === layer.id) {
      errorText.value = `动态声线计算失败：${error?.message ?? error}`
    }
    return null
  } finally {
    historyRayRequests.delete(requestKey)
    layer.rayLoading = false
    refreshRunHistoryLayers()
  }
}
/** 方位拖动时先撤掉旧方位声线，停止拖动后再按新方位补算。 */
function scheduleHistoryLayerDynamicRays(layer, delay = 320) {
  if (!isHistoryRayCapable(layer)) {
    if (layer) layer.rayLoading = false
    return
  }
  clearTimeout(historyRayTimer)
  layer.rayData = null
  layer.rayLoading = true
  refreshRunHistoryLayers()
  historyRayTimer = window.setTimeout(() => {
    historyRayTimer = 0
    if (!runHistoryLayers.value.some(item => item.id === layer.id)) return
    void ensureHistoryLayerDynamicRays(layer)
  }, Math.max(0, Number(delay) || 0))
}
/** 历史声场胶囊「二维传播损失」：打开该次声场的垂直切面。 */
function showHistoryLayerProfile(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  if (!layer.field) {
    focusRunHistoryLayer(id)
    return
  }
  if (!layer.visible) {
    layer.visible = true
    try {
      if (layer.renderer?.primitive) layer.renderer.primitive.show = volumeVisible.value
    } catch {}
    refreshRunHistoryLayers()
  }
  selectedProfileLayerId.value = id
  terrainSliceOpen.value = true
  terrainSliceMinimized.value = false
  terrainProfileOpen.value = true
  terrainProfileMinimized.value = false
  removeTerrainWindowFromDock('slice')
  removeTerrainWindowFromDock('profile')
  // 「二维传播损失」胶囊入口本身就代表要查看动态声线。
  verticalSliceControls.dynamicRays = true
  // 三维体上的声线受「声线显示/隐藏」开关控制，垂直切面不受该开关约束。
  // 关闭当前运行面板会把该开关置为 false，这里显式恢复，保证切面与三维体声线一致。
  earthRaysVisible.value = true
  void ensureHistoryLayerDynamicRays(layer).then((data) => {
    if (!data || selectedProfileLayerId.value !== layer.id) return
    chartRefreshToken.value += 1
    viewer?.scene?.requestRender?.()
  })
  nextTick(() => {
    terrainLossChartRef.value?.refreshLayout?.()
    chartRefreshToken.value += 1
  })
  viewer?.scene?.requestRender?.()
}
/** 关闭当前正在展示该声场的垂直切面与声速剖面窗口。 */
function closeProfileWindowsForLayer(id) {
  if (selectedProfileLayerId.value !== id) return
  selectedProfileLayerId.value = ''
  terrainSliceOpen.value = false
  terrainSliceMinimized.value = false
  terrainProfileOpen.value = false
  terrainProfileMinimized.value = false
  removeTerrainWindowFromDock('slice')
  removeTerrainWindowFromDock('profile')
}
function closeRunHistoryLayer(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  try { layer.renderer?.destroy?.() } catch {}
  if (layer.jobId) markJobClosed(layer.jobId)
  closeProfileWindowsForLayer(id)
  if (runSettingsHiddenPanelId.value === id) runSettingsHiddenPanelId.value = ''
  runHistoryLayers.value = runHistoryLayers.value.filter(item => item.id !== id)
  removeRunPanelFromDock(id)
  viewer?.scene?.requestRender?.()
}
function closeTerrainRun() {
  if (currentJobId.value) markJobClosed(currentJobId.value)
  currentJobId.value = ''
  terrainRunVisible.value = false
  terrainRunMinimized.value = false
  removeRunPanelFromDock(CURRENT_RUN_PANEL_ID)
  parameterPanelOpen.value = false
  timePickerOpen.value = false
  terrainSliceOpen.value = false
  terrainProfileOpen.value = false
  try { soundField?.destroy?.() } catch {}
  soundField = viewer ? new SoundField(viewer, { depthExaggeration: depthExaggeration.value }) : null
  volumeData.value = null
  raySourceData.value = null
  currentVolumeTexture = null
  terrainTexture.value = null
  soundResultCache['3d'] = null
  if (!runHistoryLayers.value.length) {
    volumeVisible.value = false
    volumeRenderingControls.volumeVisible = false
  }
  omni2dVisible.value = false
  clearOmni2dLayer()
  setEarthRaysVisible(false)
}
function toggleTerrainSettings() {
  if (analysisMode.value !== '3d') switchMode('3d')
  parameterPanelOpen.value = false
  simulationControls.sidebarOpen = !simulationControls.sidebarOpen
}
function toggleTerrainSlice() {
  const alreadyCurrent = !selectedProfileLayerId.value
  selectedProfileLayerId.value = ''
  // 正在查看其它声场时，点击当前运行面板的「二维切面」应切到当前声场并打开切面，
  // 而不是把已打开的切面窗口直接关掉。
  const open = !(alreadyCurrent && terrainSliceOpen.value && terrainProfileOpen.value)
  terrainSliceOpen.value = open; terrainProfileOpen.value = open
  if (open) void activateDynamicRaysForCurrentAzimuth()
}
function runTerrainField() {
  if (loading.value) return
  pendingRun = true
  executeRunRequest()
}
/** 地形上单击取点后，同步侧边栏「仿真配置」的经纬度。 */
function dismissSignalPlaybackForFieldRun() {
  const hasOpenPlayback = vesselPlaybackOpen.value
    || routePlaybackKind.value === 'signal'
    || signalTransmissionSession.playbackActive
  if (hasOpenPlayback) {
    closeVesselPlayback(false)
    signalTransmissionControls.showTimeFrequency = false
    signalTransmissionControls.showWaveform = false
    signalTransmissionControls.showSourceTimeFrequency = false
    signalTransmissionControls.showSourceWaveform = false
  }
  // 只要本次会话跑过完整链路，航迹点就不能把下一次普通地形计算劫持成航迹仿真。
  if (hasOpenPlayback || signalTransmissionSession.result) skipVesselSimulationOnce = true
}
function syncSimulationLocationFromTerrain(point) {
  const lon = Number(point?.lon)
  const lat = Number(point?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  dismissSignalPlaybackForFieldRun()
  calcParams.value.coordX = Number(lon.toFixed(6))
  calcParams.value.coordY = Number(lat.toFixed(6))
}

function setSimulationCoordinates(coords) {
  const lon = Number(coords?.lon)
  const lat = Number(coords?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  calcParams.value.coordX = Number(lon.toFixed(6))
  calcParams.value.coordY = Number(lat.toFixed(6))
  return true
}
/** 当前运行面板中修改经纬度后直接运行。 */
function runCurrentRunAt(coords) {
  if (loading.value || !setSimulationCoordinates(coords)) return
  runTerrainField()
}
/** 历史声场面板中修改经纬度后按该次参数运行。 */
function runHistoryAt(id, coords) {
  if (loading.value) return
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (layer?.params) Object.assign(calcParams.value, JSON.parse(JSON.stringify(layer.params)))
  if (!setSimulationCoordinates(coords)) return
  runTerrainField()
}

function loadTerrainStationParameters(point) {
  if (loading.value) return
  if (analysisMode.value !== '3d') switchMode('3d')
  calcParams.value.coordX = Number(point.lon.toFixed(6))
  calcParams.value.coordY = Number(point.lat.toFixed(6))
  stationPositionPoint.value = { ...point }
  // 已有运行结果时沿用当前运行时间；没有运行时保持黄色点与空白时间。
  const hasCurrentRun = Boolean(terrainRunVisible.value && terrainRunTime.value)
  stationPositionHasRun.value = hasCurrentRun
  stationPositionTime.value = hasCurrentRun ? terrainRunTime.value : ''
  stationPositionOpen.value = true
  // 站点参数使用紧凑的「声场」位置卡片展示；完整参数仍可从卡片进入。
  // 不改变已有声场运行窗口的最小化状态。
  parameterPanelOpen.value = false
}
function closeStationPositionCard() {
  stationPositionOpen.value = false
  stationPositionPoint.value = null
  stationPositionTime.value = ''
  stationPositionHasRun.value = false
  // 关闭后恢复被临时替换的声场运行面板。
  runSettingsHiddenPanelId.value = ''
}
function bottomDepthAtSource(field, azimuthDeg) {
  try {
    if (!field || typeof field.seabedFor !== 'function') return NaN
    const row = nearestAzimuthRow(field, azimuthDeg)
    const depths = field.seabedFor(row)
    const value = Number(depths?.[0])
    return Number.isFinite(value) ? value : NaN
  } catch {
    return NaN
  }
}
function runSettingsCardPoint(source, field, azimuthDeg, anchor, fallbackDepth) {
  const lon = Number(source?.lon)
  const lat = Number(source?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  const sourceDepth = Number(source?.depth ?? source?.depth_m ?? fallbackDepth)
  const bottomDepth = bottomDepthAtSource(field, azimuthDeg)
  const point = {
    lon,
    lat,
    elevation: Number.isFinite(bottomDepth) ? -bottomDepth : -sourceDepth,
  }
  if (anchor && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
    point.x = Number(anchor.x)
    point.y = Number(anchor.y)
  }
  return point
}
/** 当前运行面板「参数设置」：用参数卡片替换运行面板。 */
function openCurrentRunSettings() {
  if (!terrainRunVisible.value) return
  const source = terrainSource.value || sourcePoint.value
  const point = runSettingsCardPoint(
    source, terrainField.value, sliceAzimuthDeg.value, terrainAnchor.value, calcParams.value.srcDepth
  )
  if (!point) return
  stationPositionPoint.value = point
  stationPositionTime.value = terrainRunTime.value
  stationPositionHasRun.value = true
  stationPositionOpen.value = true
  runSettingsHiddenPanelId.value = CURRENT_RUN_PANEL_ID
  parameterPanelOpen.value = false
}
/** 历史声场面板「参数设置」：载入该次参数并用参数卡片替换原面板。 */
function openHistoryRunSettings(id) {
  const layer = runHistoryLayers.value.find(item => item.id === id)
  if (!layer) return
  if (layer.params) Object.assign(calcParams.value, JSON.parse(JSON.stringify(layer.params)))
  const anchor = terrainJobAnchors.value[layer.id] || layer.anchor
  const point = runSettingsCardPoint(
    layer.source, layer.field, Number(layer.sliceAzimuthDeg) || 0, anchor, layer.params?.srcDepth
  )
  if (!point) return
  stationPositionPoint.value = point
  stationPositionTime.value = layer.time || ''
  stationPositionHasRun.value = true
  stationPositionOpen.value = true
  runSettingsHiddenPanelId.value = id
  parameterPanelOpen.value = false
}
function runStationPositionCard() {
  if (loading.value) return
  const hiddenId = runSettingsHiddenPanelId.value
  const historicalLayer = hiddenId && hiddenId !== CURRENT_RUN_PANEL_ID
    ? runHistoryLayers.value.find(item => item.id === hiddenId)
    : null
  if (hiddenId) closeStationPositionCard()
  if (historicalLayer) {
    // 参数卡片中的修改已同步到 calcParams，直接按当前值运行。
    runTerrainField()
    return
  }
  stationPositionHasRun.value = true
  stationPositionTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  runTerrainField()
}
function runAtTerrainStation(point) {
  if (loading.value) return
  if (analysisMode.value !== '3d') switchMode('3d')
  // 直接运行参数卡/替换当前声场；面板运行时使用声源坐标。
  syncSimulationLocationFromTerrain(point)
  runTerrainField()
}

function applyTrackPointParams(target, point, index) {
  const params = trackPointState.params[index] || {}
  const sourceDepth = Number(params.sourceDepthM)
  const frequency = Number(params.frequencyHz)
  const range = Number(params.rangeNm)
  const grazingMin = Number(params.grazingAngleMin)
  const grazingMax = Number(params.grazingAngleMax)
  const lineCount = Number(params.lineCount)
  const sector = Number(params.sector)
  target.coordX = Number(normalizeLongitude(Number(point.lon)).toFixed(6))
  target.coordY = Number(Number(point.lat).toFixed(6))
  if (Number.isFinite(sourceDepth)) target.srcDepth = Math.max(0, sourceDepth)
  if (Number.isFinite(frequency) && frequency > 0) {
    target.minFreq = frequency
    target.maxFreq = frequency
  }
  if (Number.isFinite(range) && range > 0) target.range = range
  if (Number.isFinite(grazingMin)) target.grazingAngleMin = Math.max(-90, Math.min(90, grazingMin))
  if (Number.isFinite(grazingMax)) target.grazingAngleMax = Math.max(-90, Math.min(90, grazingMax))
  if (Number.isFinite(lineCount)) target.lineCount = Math.max(0, Math.round(lineCount))
  if (Number.isFinite(sector)) target.sector = Math.max(1, Math.min(360, Math.round(sector)))
  if (params.model === 'bellhop' || params.model === 'ram') target.model = params.model
  return target
}

function trackPointCalculationParams(base, point, index) {
  return applyTrackPointParams(JSON.parse(JSON.stringify(base)), point, index)
}

async function requestTrackPointField(params, index) {
  await validateSourceDepthAgainstTerrain(params)
  params.regionType = await detectSeaIceRegion(params)
  const payload = portalParamsFor(params, {
    range: Number(params.range),
    minFreq: Number(params.minFreq),
    maxFreq: Number(params.maxFreq),
    sector: Number(params.sector),
  })
  const response = await analyse3dTLRDByModel(
    payload,
    params.model,
    params.regionType === 'ice',
  )
  return { index, params, response }
}

async function runTrackPointFields() {
  if (loading.value || trackFieldRunState.running) return
  const points = trackPointState.points.map((point, index) => ({
    ...point,
    index,
    params: trackPointState.params[index] || {},
  }))
  if (!points.length) {
    trackFieldRunState.error = '请先选择航迹点'
    return
  }
  if (analysisMode.value !== '3d') switchMode('3d')
  const original = JSON.parse(JSON.stringify(calcParams.value))
  trackFieldRunState.running = true
  loading.value = true
  trackFieldRunState.error = ''
  trackFieldRunState.completedCount = 0
  trackFieldRunState.message = `准备计算 ${points.length} 个航迹点声场…`
  const failures = []
  let completedCount = 0
  try {
    archiveCurrent3dRun()
    const jobs = points.map((point, index) => ({
      point,
      index,
      params: trackPointCalculationParams(original, point, index),
    }))
    for (let batchStart = 0; batchStart < jobs.length; batchStart += TRACK_FIELD_CONCURRENCY) {
      const batch = jobs.slice(batchStart, batchStart + TRACK_FIELD_CONCURRENCY)
      const batchEnd = batchStart + batch.length
      trackFieldRunState.message = `并行计算航迹点 ${batchStart + 1}–${batchEnd}/${points.length}…`
      const results = await Promise.allSettled(
        batch.map(job => requestTrackPointField(job.params, job.index))
      )
      for (let offset = 0; offset < results.length; offset += 1) {
        const result = results[offset]
        const index = batch[offset].index
        if (result.status === 'rejected') {
          failures.push({
            index,
            message: result.reason?.message || String(result.reason),
          })
          trackFieldRunState.error = `航迹点 ${index + 1} 声场计算失败：${failures.at(-1).message}`
          continue
        }
        const record = result.value
        try {
          Object.assign(calcParams.value, record.params)
          detectedSeaIce.value = record.params.regionType === 'ice'
          terrainRunVisible.value = true
          terrainRunMinimized.value = false
          terrainRunTime.value = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 航迹点 ${index + 1}`
          terrainSource.value = {
            lon: Number(record.params.coordX),
            lat: Number(record.params.coordY),
            depth: Number(record.params.srcDepth),
          }
          terrainRadiusKm.value = Math.max(0.1, Number(record.params.range) * 1.852)
          errorText.value = ''
          trackFieldRunState.message = `装载航迹点 ${index + 1}/${points.length} 声场…`
          await loadData({ response: record.response, regionType: record.params.regionType })
          if (errorText.value || !soundField?.loaded || !raySourceData.value) {
            throw new Error(errorText.value || `航迹点 ${index + 1} 声场装载失败`)
          }
          const layerCount = runHistoryLayers.value.length
          archiveCurrent3dRun()
          if (runHistoryLayers.value.length <= layerCount) {
            throw new Error(`航迹点 ${index + 1} 声场归档失败`)
          }
          const archivedLayer = runHistoryLayers.value.at(-1)
          if (archivedLayer) archivedLayer.trackPointIndex = index
          completedCount += 1
          trackFieldRunState.completedCount = completedCount

          // 归档层已经持有解析结果与体纹理。立即清空临时 current 引用，避免后续点
          // 失败并结束 loading 后，最后一个成功点同时以 current 和历史层出现：GPU
          // 去重会把它登记为 current，Canvas 随后又按历史层 ID 重复绘制。
          terrainRunVisible.value = false
          volumeData.value = null
          raySourceData.value = null
          currentVolumeTexture = null
          terrainTexture.value = null
        } catch (error) {
          failures.push({ index, message: error?.message || String(error) })
          trackFieldRunState.error = `航迹点 ${index + 1} 处理失败：${failures.at(-1).message}`
        } finally {
          record.response = null
        }
        // loadData 会在单个结果装载完毕后清除 loading；航线任务尚未结束时
        // 立即恢复整体忙状态，防止其他入口插入一次共享场景计算。
        loading.value = true
        await nextTick()
      }
    }
    terrainRunVisible.value = false
    if (failures.length) {
      const failedPoints = failures.map(item => item.index + 1).join('、')
      trackFieldRunState.error = `航迹点 ${failedPoints} 计算失败，其余声场已继续完成`
      trackFieldRunState.message = `已完成 ${completedCount}/${points.length} 个航迹点声场`
    } else {
      trackFieldRunState.error = ''
      trackFieldRunState.message = `已完成 ${points.length} 个航迹点声场`
    }
  } catch (error) {
    trackFieldRunState.error = error?.message || String(error)
  } finally {
    trackFieldRunState.running = false
    loading.value = false
    Object.assign(calcParams.value, original)
  }
}
// 任何入口触发运行时，以实际运行时间为准刷新站点参数卡片状态。
watch(terrainRunTime, (time) => {
  if (!stationPositionOpen.value || !time) return
  stationPositionHasRun.value = true
  stationPositionTime.value = time
})
function openNoiseFromStation(point) {
  if (point) setWeatherNoisePoint(point)
  openNoiseProbe({ picking: false })
  terrainNoiseMinimized.value = false
  removeTerrainWindowFromDock('noise')
}
/** 分析结果窗口：计算成功后自动展开，可在右上角关闭 */
const resultPanelOpen = ref(false)
const activeMapPick = ref('')
const receiverPlacementEnabled = ref(false)
const receiverArrayMarker = ref(null)
const hydrophonePlaced = ref(false)
const hydrophoneReceiverReady = computed(() => {
  const receiver = receiverArrayMarker.value
  const lon = Number(receiver?.lon)
  const lat = Number(receiver?.lat)
  return Number.isFinite(lon) && Number.isFinite(lat)
    && lon >= -180 && lon <= 180
    && lat >= -90 && lat <= 90
})
const vesselPlaybackOpen = ref(false)
const vesselPlaybackPlaying = ref(false)
const vesselPlaybackRate = ref(1)
const vesselPlaybackTimeS = ref(0)
const vesselPlaybackDurationS = ref(30)
const vesselRouteDurationS = ref(1)
const vesselPlaybackPreRollS = ref(30)
const vesselTimeFrequencyWindowS = ref(30)
const vesselSpectrogramWindowStartS = ref(0)
const vesselSpectrogramSeed = ref(20261106)
const vesselPlaybackSampleIndex = ref(0)
const vesselAppliedSampleIndex = ref(0)
const vesselPlaybackBusy = ref(false)
const vesselPlaybackStatus = ref('')
const vesselPlaybackError = ref('')
const vesselPlaybackVessel = shallowRef(null)
const vesselPlaybackSpectrum = shallowRef(null)
const vesselPlaybackModel = ref('bellhop')
const routePlaybackKind = ref('preview')
const vesselRouteSamples = ref([])
const vesselReceiverTlDb = ref([])
const vesselReceiverDistancesM = ref([])
const vesselFieldCache = new Map()
const vesselFieldRequests = new Map()
const REALTIME_PREVIEW_DURATION_S = 24 * 60 * 60
let vesselPlaybackGeneration = 0
let vesselPlaybackRaf = 0
let vesselPlaybackLastFrameAt = 0
/** 从信号/航迹播放切回普通地形声场时，下一次计算不要再次进入船舶航迹仿真。 */
let skipVesselSimulationOnce = false
const signalPlaybackMode = computed(() => Boolean(
  routePlaybackKind.value === 'signal'
))
const backendSignalPlotMode = computed(() => routePlaybackKind.value !== 'vessel')
const selectedVesselRoute = computed(() => buildSelectedVesselRoute(
  selectedAisVessel.value,
  SELECTED_VESSEL_MAX_RANGE_NM,
))
const configuredSignalRoutePoints = computed(() => (
  selectedAisVessel.value ? selectedVesselRoute.value : trackPointState.points
))
const configuredSignalRouteReady = computed(() => Boolean(
  selectedAisVessel.value
    ? selectedVesselRoute.value.length >= 2
    : trackPointState.points.length > 0 && trackPointState.finished
))
const staticSignalChannelReady = computed(() => Boolean(
  !selectedAisVessel.value && trackPointState.finished && trackPointState.points.length === 1,
))
const sliceReceiverPlacementActive = computed(() => Boolean(
  staticSignalChannelReady.value && signalTransmissionControls.sliceReceiverPlacement,
))
const configuredSignalSpeedKn = computed(() => {
  const speed = Number(selectedAisVessel.value?.sog_kn ?? signalTransmissionControls.vesselSpeedKn)
  return Number.isFinite(speed) && speed > 0 ? speed : 0
})
const liveSignalSourceProfile = computed(() => {
  if (selectedAisVessel.value) return estimateJomopansEchoSpectrum(selectedAisVessel.value)
  const frequencies = [...signalTransmissionControls.frequenciesHz]
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  const safeFrequencies = frequencies.length ? frequencies : [84, 126]
  const sourceLevelDb = Number(signalTransmissionControls.sourceLevelDb) || 105
  const perFrequencyLevelDb = sourceLevelDb - 10 * Math.log10(Math.max(1, safeFrequencies.length))
  return {
    vesselClassLabel: '航迹信号源',
    sourceDepthM: Math.max(0.01, Number(signalTransmissionControls.navigationDepthM) || 1),
    broadbandSourceLevelDb: sourceLevelDb,
    narrowband: true,
    frequenciesHz: safeFrequencies,
    bandLevelsDb: safeFrequencies.map(() => perFrequencyLevelDb),
    spectralDensityDb: safeFrequencies.map(() => perFrequencyLevelDb),
  }
})
const previewSignalRouteSamples = computed(() => {
  if (!configuredSignalRouteReady.value || !(configuredSignalSpeedKn.value > 0)) return []
  return resampleTrackByDistance(
    configuredSignalRoutePoints.value,
    distancePerMinuteM(configuredSignalSpeedKn.value),
  )
})
const activeSignalSamples = computed(() => (
  signalPlaybackMode.value && vesselRouteSamples.value.length
    ? vesselRouteSamples.value
    : previewSignalRouteSamples.value
))
const previewSignalRouteDurationS = computed(() => {
  if (previewSignalRouteSamples.value.length < 2) return REALTIME_PREVIEW_DURATION_S
  return Math.max(1, routeDurationSeconds(
    previewSignalRouteSamples.value,
    configuredSignalSpeedKn.value,
  ))
})
const spectrogramFrequencyBounds = computed(() => ({
  minimumHz: 20,
  maximumHz: Math.max(20, Number(signalTransmissionControls.sampleRate) / 2 || 24000),
}))
// 完整传输链路的四个图只消费后端结果；前端负责格式转换和绘制。
const sourceBackendMatrix = computed(() => backendSpectrogramMatrix(signalTransmissionSession.result?.spectrograms?.source_pressure))
const receiverBackendMatrix = computed(() => backendSpectrogramMatrix(signalTransmissionSession.result?.spectrograms?.adc_calibrated_pressure))
const signalSourceSpectrogramData = computed(() => rollingBackendSpectrogramMatrix(
  sourceBackendMatrix.value,
  vesselPlaybackTimeS.value,
  vesselTimeFrequencyWindowS.value,
))
const adcCalibratedReceiverSpectrogramData = computed(() => rollingBackendSpectrogramMatrix(
  receiverBackendMatrix.value,
  vesselPlaybackTimeS.value,
  vesselTimeFrequencyWindowS.value,
))
const signalSourceWaveform = computed(() => rollingBackendWaveformSeries(
  backendWaveformSeries(signalTransmissionSession.result?.waveforms?.source_pressure_pa),
  vesselPlaybackTimeS.value,
  vesselTimeFrequencyWindowS.value,
))
const signalReceiverWaveform = computed(() => rollingBackendWaveformSeries(
  backendWaveformSeries(signalTransmissionSession.result?.waveforms?.adc_calibrated_pressure_pa),
  vesselPlaybackTimeS.value,
  vesselTimeFrequencyWindowS.value,
))
const signalSourceAudioUrl = computed(() => '')
const signalReceiverAudioUrl = computed(() => '')
const receiverPlaybackPanelActive = computed(() => (
  props.viewMode === 'terrain' && hydrophoneReceiverReady.value && (
    vesselPlaybackOpen.value
    || signalTransmissionControls.showTimeFrequency
    || signalTransmissionControls.showWaveform
  )
))
const sourcePlaybackPanelActive = computed(() => (
  props.viewMode === 'terrain' && configuredSignalRouteReady.value && (
    signalTransmissionControls.showSourceTimeFrequency
    || signalTransmissionControls.showSourceWaveform
  )
))
const hydrophonePlaybackPanelActive = computed(() => (
  receiverPlaybackPanelActive.value || sourcePlaybackPanelActive.value || vesselPlaybackOpen.value
))
const hydrophoneDisplayDurationS = computed(() => (
  vesselPlaybackOpen.value
    ? vesselPlaybackDurationS.value
    : sourcePlaybackPanelActive.value
      ? previewSignalRouteDurationS.value
      : REALTIME_PREVIEW_DURATION_S
))
const vesselCalculatedFieldCount = computed(() => vesselReceiverTlDb.value.filter(value => value != null && Number.isFinite(Number(value))).length)
const vesselPlaybackReferenceFrequencyHz = computed(() => {
  const frequencies = vesselPlaybackSpectrum.value?.frequenciesHz || []
  const levels = vesselPlaybackSpectrum.value?.bandLevelsDb || []
  if (!frequencies.length || frequencies.length !== levels.length) return 100
  let bestIndex = 0
  levels.forEach((level, index) => {
    if (Number(level) > Number(levels[bestIndex])) bestIndex = index
  })
  return Math.max(20, Math.min(1000, Number(frequencies[bestIndex]) || 100))
})
const vesselPlaybackSpectrogramData = computed(() => buildVesselReceiveSpectrogram({
  samples: vesselRouteSamples.value,
  durationS: vesselPlaybackDurationS.value,
  windowStartS: vesselSpectrogramWindowStartS.value,
  windowDurationS: vesselTimeFrequencyWindowS.value,
  routeDurationS: vesselRouteDurationS.value,
  preRollS: vesselPlaybackPreRollS.value,
  sourceSpectrum: vesselPlaybackSpectrum.value,
  receiverTlDb: vesselReceiverTlDb.value,
  receiverDistancesM: vesselReceiverDistancesM.value,
  referenceFrequencyHz: vesselPlaybackReferenceFrequencyHz.value,
  backgroundFrequencyHz: weatherNoiseState.result?.frequency_hz || [],
  backgroundSpectrumDb: currentWeatherNoiseCurves.value.total || [],
  minimumFrequencyHz: spectrogramFrequencyBounds.value.minimumHz,
  maximumFrequencyHz: spectrogramFrequencyBounds.value.maximumHz,
  timeCount: 301,
  frequencyCount: 112,
  textureSeed: vesselSpectrogramSeed.value,
}))
const receiverSpectrogramData = computed(() => (
  routePlaybackKind.value === 'vessel' && vesselPlaybackOpen.value
    ? vesselPlaybackSpectrogramData.value
    : adcCalibratedReceiverSpectrogramData.value
))
// 声源/接收两个时频图（含运行前的实时预览）统一使用固定的 50–110 dB 色标范围。
const SIGNAL_SPECTROGRAM_COLOR_RANGE = Object.freeze({ minDb: 50, maxDb: 110 })
const signalSpectrogramColorRange = computed(() => (
  backendSignalPlotMode.value ? SIGNAL_SPECTROGRAM_COLOR_RANGE : null
))
function withSpectrogramColorRange(matrix, range) {
  if (!matrix || !range) return matrix
  return { ...matrix, minDb: range.minDb, maxDb: range.maxDb }
}
const signalSourceSpectrogram = computed(() => (
  withSpectrogramColorRange(signalSourceSpectrogramData.value, SIGNAL_SPECTROGRAM_COLOR_RANGE)
))
const receiverDisplaySpectrogram = computed(() => (
  withSpectrogramColorRange(receiverSpectrogramData.value, signalSpectrogramColorRange.value)
))
/** KeepAlive 恢复后让结果图重新布局/绘制（嵌套图表不一定收到 activated 钩子）。 */
const chartRefreshToken = ref(0)

/** 底部状态栏：鼠标所在经纬度 / 高程(水下为负) / 层级 */
const coordStatus = ref({ lon: '-', lat: '-', height: '-', level: '-' })
let coordHandler = null
let coordRaf = 0

function updateCoordStatus(screenPos) {
  if (!viewer || viewer.isDestroyed?.() || !screenPos) return
  const scene = viewer.scene
  const ellipsoid = scene?.globe?.ellipsoid || Cesium.Ellipsoid?.WGS84
  const cartesian = viewer.camera.pickEllipsoid(screenPos, ellipsoid)
  if (!cartesian) {
    coordStatus.value = { lon: '-', lat: '-', height: '-', level: '-' }
    return
  }
  const carto = Cesium.Cartographic.fromCartesian(cartesian)
  const lon = Cesium.Math.toDegrees(carto.longitude)
  const lat = Cesium.Math.toDegrees(carto.latitude)
  let height = scene?.globe?.getHeight ? scene.globe.getHeight(carto) : undefined
  if (!Number.isFinite(height)) height = carto.height
  // 层级：按透视相机的“米/像素”换算成瓦片级数（与地图下拉的 12/13 级同口径）
  const fovy = viewer.camera.frustum?.fovy ?? Math.PI / 3
  const canvasH = (scene?.canvas?.clientHeight || viewer.canvas?.clientHeight || 1) || 1
  const dist = Cesium.Cartesian3.distance(viewer.camera.positionWC, cartesian)
  const metersPerPixel = (2 * dist * Math.tan(fovy / 2)) / canvasH
  const levelRaw = metersPerPixel > 0
    ? Math.log2((156543.03392 * Math.cos(Cesium.Math.toRadians(lat))) / metersPerPixel)
    : NaN
  coordStatus.value = {
    lon: lon.toFixed(4),
    lat: lat.toFixed(4),
    height: Number(height).toFixed(2),
    level: Number.isFinite(levelRaw) ? Math.max(0, Math.min(22, Math.round(levelRaw))) : '-',
  }
}

const timeOptions = ref(['2025-01-02T12:00:00'])
const hycomTimeMeta = ref({ defaultTime: '', forecastStartTime: '' })

/* ── 查询时间：日历弹层（先选年/月/日，再选时次；本地已有数据仅作提示） ── */
const timePickerOpen = ref(false)
const timeTriggerEl = ref(null)
const noiseTimeTriggerEl = ref(null)
const timePickerTarget = ref('calc')
const timePickerPos = ref({ top: 0, left: 0 })
const pickerYear = ref(new Date().getFullYear())
const pickerMonth = ref(new Date().getMonth() + 1)
const pickerDate = ref('')
const pad2 = (n) => String(n).padStart(2, '0')
const displayQueryTime = computed(() => String(calcParams.value.time || '').replace('T', ' '))
const displayNoiseQueryTime = computed(() => String(noiseParams.value.time || '').replace('T', ' '))
const activeTimeParams = computed(() => (timePickerTarget.value === 'noise' ? noiseParams : calcParams))
/** 当前本地文件已确认可用的日期集合（仅用于提示）。 */
const timeDateSet = computed(() => new Set(timeOptions.value.map((t) => String(t).slice(0, 10))))
/** 日期 → 该日可选时次列表 */
const timesByDate = computed(() => {
  const map = new Map()
  for (const t of timeOptions.value) {
    const key = String(t).slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return map
})
/** 当月日历格：允许选择任意日期，文件是否存在由后端在计算时校验。 */
const calendarCells = computed(() => {
  const y = pickerYear.value
  const m = pickerMonth.value
  const startWeekday = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${pad2(m)}-${pad2(d)}`
    cells.push({ day: d, iso, hasData: timeDateSet.value.has(iso), selectable: true })
  }
  return cells
})
const pickerTimes = computed(() => {
  const date = String(pickerDate.value || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  // 本地 HYCOM 温盐为 3 小时步长。即使当前没有对应文件也允许选择，
  // 后端 file 模式会返回明确的“该时次没有本地文件”错误。
  return Array.from({ length: 8 }, (_, index) => `${date}T${pad2(index * 3)}:00:00`)
})

function openTimePicker(kind = 'calc') {
  timePickerTarget.value = kind === 'noise' ? 'noise' : 'calc'
  const cur = String(activeTimeParams.value.time || '') || timeOptions.value[0] || ''
  const curDate = cur.slice(0, 10)
  const firstDate = String(timeOptions.value[0] || '').slice(0, 10)
  const target = /^\d{4}-\d{2}-\d{2}$/.test(curDate) ? curDate : firstDate
  pickerDate.value = target
  const [y, m] = target.split('-').map(Number)
  pickerYear.value = Number.isFinite(y) ? y : new Date().getFullYear()
  pickerMonth.value = Number.isFinite(m) ? m : new Date().getMonth() + 1
  timePickerOpen.value = true
  // 紧挨「查询时间」输入框右侧弹出；空间不足时回退到左侧 / 上移
  const el = timePickerTarget.value === 'noise' ? noiseTimeTriggerEl.value : timeTriggerEl.value
  if (el && typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect()
    const POP_W = 300
    const POP_H = 360
    let left = r.right + 8
    if (left + POP_W > window.innerWidth - 8) {
      left = Math.max(8, r.left - POP_W - 8)
    }
    let top = r.top
    if (top + POP_H > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - POP_H - 8)
    }
    timePickerPos.value = { top: Math.round(top), left: Math.round(left) }
  }
}

function shiftPickerMonth(delta) {
  let y = pickerYear.value
  let m = pickerMonth.value + delta
  if (m < 1) {
    m = 12
    y -= 1
  } else if (m > 12) {
    m = 1
    y += 1
  }
  pickerYear.value = y
  pickerMonth.value = m
}

/** 选日期：允许任意日期；本地文件是否存在由后端校验。 */
function selectPickerDate(iso) {
  if (!iso) return
  pickerDate.value = iso
}

/** 选时次：写回参数并关闭 */
function selectPickerTime(t) {
  activeTimeParams.value.time = t
  timePickerOpen.value = false
}
/**
 * 声场计算参数：提交后调用后端 Analyse3DTLRD / Analyse2DRTRD 接口同步计算。
 * coordX/coordY 同时作为声源经纬度（三维体渲染的解码原点）。
 */
const calcParams = ref({
  dataset: 'HYCOM',
  time: '2025-01-02T12:00:00',
  regionType: 'normal',
  // 默认声源放在南海海域。
  coordX: 116,
  coordY: 16,
  receiverX: 116.1,
  receiverY: 16,
  srcDepth: 150,
  grazingAngleMin: -25,
  grazingAngleMax: 25,
  range: 10,
  minFreq: 100,
  maxFreq: 100,
  model: 'bellhop',
  sector: 4,
  azimuth: 0,
  lineCount: 10,
  rayInterface: 'dynamic',
  coherent: false,
})

/** 侧边栏「仿真配置」与计算参数共享的字段。 */
const SIMULATION_FIELD_KEYS = Object.freeze([
  'model', 'time', 'coordX', 'coordY', 'srcDepth',
  'grazingAngleMin', 'grazingAngleMax',
  'range', 'sector', 'lineCount', 'coherent',
])
let syncingSimulationControls = false
watch(simulationControls, () => {
  if (syncingSimulationControls) return
  syncingSimulationControls = true
  for (const key of SIMULATION_FIELD_KEYS) calcParams.value[key] = simulationControls[key]
  // 单值运行频率同时写入上下限，保持现有门户请求字段不变。
  const frequency = Math.max(1, Number(simulationControls.frequency) || 100)
  calcParams.value.minFreq = frequency
  calcParams.value.maxFreq = frequency
  syncingSimulationControls = false
}, { deep: true, flush: 'sync' })
watch(
  () => [
    ...SIMULATION_FIELD_KEYS.map((key) => calcParams.value[key]),
    calcParams.value.minFreq,
    calcParams.value.maxFreq,
  ],
  (values) => {
    if (syncingSimulationControls) return
    syncingSimulationControls = true
    SIMULATION_FIELD_KEYS.forEach((key, index) => { simulationControls[key] = values[index] })
    simulationControls.frequency = values.at(-2)
    syncingSimulationControls = false
  },
  { immediate: true, flush: 'sync' }
)
/** 环境噪声参数：只调用 AnalyseEnvironmentNoise。 */
const noiseParams = ref({
  dataset: 'HYCOM',
  time: '2025-01-02T12:00:00',
  regionType: 'normal',
  receiverX: 132.5135,
  receiverY: 83.275,
  depth: 30,
  shipDensityLevel: 3,
  windSpeed: 4,
  rainIntensity: 2,
  minFreq: 10,
  maxFreq: 1000,
  numPoints: 100,
  timeFrequencyScenario: createDefaultNoiseScenario(4, 3, 'normal'),
})

function captureWorkspaceSnapshot() {
  return {
    globeSelection: globeSelection.value,
    calcParams: calcParams.value,
    noiseParams: noiseParams.value,
    receiverArrayMarker: receiverArrayMarker.value,
    hydrophonePlaced: hydrophonePlaced.value,
    signalControls: Object.fromEntries(
      Object.keys(signalTransmissionControls).filter(key => key !== 'receiverReady')
        .map(key => [key, signalTransmissionControls[key]])
    ),
    track: {
      points: trackPointState.points,
      params: trackPointState.params,
      finished: trackPointState.finished,
    },
    // 二维声场 / 环境噪声 / 信号链等非三维结果的任务引用，随现场一起持久化。
    resultRefs: workspaceResultRefs.value.map(ref => ({ ...ref })),
    ui: {
      analysisMode: analysisMode.value,
      resultPanelOpen: resultPanelOpen.value,
      parameterPanelOpen: parameterPanelOpen.value,
      sliceAzimuthDeg: sliceAzimuthDeg.value,
      selectedProfileLayerId: selectedProfileLayerId.value,
      cleanGlobeView: cleanGlobeView.value,
    },
  }
}

async function applyWorkspaceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false
  workspaceResultRefs.value = Array.isArray(snapshot.resultRefs)
    ? snapshot.resultRefs
        .filter(ref => ref && typeof ref === 'object' && (ref.jobId || ref.job_id))
        .map(ref => ({ ...ref, jobId: String(ref.jobId || ref.job_id || '') }))
        .filter(ref => ref.jobId)
    : []
  lastSignalRequest = null
  const ui = snapshot.ui && typeof snapshot.ui === 'object' ? snapshot.ui : null
  if (ui) {
    if (['2d', '3d', 'noise'].includes(ui.analysisMode)) analysisMode.value = ui.analysisMode
    if (Number.isFinite(Number(ui.sliceAzimuthDeg))) sliceAzimuthDeg.value = Number(ui.sliceAzimuthDeg)
    if (typeof ui.selectedProfileLayerId === 'string') selectedProfileLayerId.value = ui.selectedProfileLayerId
    if (typeof ui.parameterPanelOpen === 'boolean') parameterPanelOpen.value = ui.parameterPanelOpen
    if (typeof ui.resultPanelOpen === 'boolean') resultPanelOpen.value = ui.resultPanelOpen
    if (typeof ui.cleanGlobeView === 'boolean') cleanGlobeView.value = ui.cleanGlobeView
  }
  if (snapshot.globeSelection) {
    globeSelection.value = normalizeTerrainBounds(snapshot.globeSelection)
    globeSelectionToken.value += 1
  }
  if (snapshot.calcParams && typeof snapshot.calcParams === 'object') {
    Object.assign(calcParams.value, snapshot.calcParams)
  }
  if (snapshot.noiseParams && typeof snapshot.noiseParams === 'object') {
    Object.assign(noiseParams.value, snapshot.noiseParams)
  }
  receiverArrayMarker.value = snapshot.receiverArrayMarker || null
  hydrophonePlaced.value = Boolean(snapshot.hydrophonePlaced && receiverArrayMarker.value)
  if (snapshot.signalControls && typeof snapshot.signalControls === 'object') {
    for (const key of Object.keys(signalTransmissionControls)) {
      if (key !== 'receiverReady' && Object.hasOwn(snapshot.signalControls, key)) {
        signalTransmissionControls[key] = snapshot.signalControls[key]
      }
    }
  }
  // 先让“航迹点选择”开关的现有 watcher 完成清理，再写入记录中的权威航迹。
  await nextTick()
  restoreTrackPoints(snapshot.track)
  return true
}

function cloneWorkspacePlain(value) {
  try {
    return value == null ? value : JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function workspaceResultRefKey(ref) {
  return `${ref?.kind || ''}:${ref?.jobId || ''}`
}

function workspaceResultBaseKind(ref) {
  const kind = String(ref?.kind || '')
  return kind.startsWith('signal') ? 'signal' : kind
}

function upsertWorkspaceResultRef(ref) {
  if (!ref || !ref.kind || !ref.jobId) return
  const key = workspaceResultRefKey(ref)
  const baseKind = workspaceResultBaseKind(ref)
  // 二维 / 噪声 / 信号链在工作区里只保留最近一次结果；三维声场仍由 job_ids 累积。
  workspaceResultRefs.value = [
    ...workspaceResultRefs.value.filter(item =>
      workspaceResultBaseKind(item) !== baseKind && workspaceResultRefKey(item) !== key),
    { ...ref },
  ]
}

/** 把一次二维/噪声/信号结果登记进当前工作区，并连同现场快照保存到后端。 */
async function attachResultToActiveWorkspace(ref) {
  if (!ref?.kind || !ref?.jobId) return ''
  upsertWorkspaceResultRef(ref)
  const snapshot = captureWorkspaceSnapshot()
  const label = ref.label || '声场工作区'
  // 三维结果继续走 job_ids；其它类型只进入 snapshot.resultRefs。
  if (ref.kind === '3d') return attachJobToActiveWorkspace(ref.jobId, snapshot, label)
  return saveWorkspaceDraft(snapshot)
}

async function restoreWorkspaceResults(refs) {
  const list = Array.isArray(refs) ? refs : []
  if (!list.length) return
  restoringWorkspaceResults = true
  try {
    for (const ref of list) {
      try {
        if (ref.kind === '2d') await restoreWorkspace2dResult(ref)
        else if (ref.kind === 'noise') await restoreWorkspaceNoiseResult(ref)
        else if (ref.kind === 'signal' || ref.kind === 'signal_stream') await restoreWorkspaceSignalResult(ref)
      } catch (error) {
        console.warn('[工作区恢复] 结果恢复失败：', ref?.kind, ref?.jobId, error?.message ?? error)
      }
    }
  } finally {
    restoringWorkspaceResults = false
  }
}

/** 从后端已保存的二维传播损失（及声线）响应重建二维声场并缓存。 */
async function restoreWorkspace2dResult(ref) {
  if (!ref?.jobId) return
  const payload = await loadAcousticJobResult(ref.jobId)
  const tlJson = payload?.result
  if (!tlJson) return
  const params = ref.params && typeof ref.params === 'object'
    ? cloneWorkspacePlain(ref.params)
    : cloneWorkspacePlain(calcParams.value)
  const azimuth = Number.isFinite(Number(ref.azimuth)) ? Number(ref.azimuth) : Number(params.azimuth) || 0
  const raySource = adapt2dTlResponse(tlJson, azimuth)
  let rayJson = null
  if (ref.rayJobId) {
    try {
      const rayPayload = await loadAcousticJobResult(ref.rayJobId)
      rayJson = rayPayload?.result || null
    } catch (error) {
      console.warn('[工作区恢复] 二维声线获取失败：', error?.message ?? error)
    }
  }
  let distanceMaxKm = 0
  try {
    const parsed = parseAnalyse3DTlrd(raySource)
    distanceMaxKm = Math.max(...parsed.grid.distance.map(Number).filter(Number.isFinite), 0) / 1000
  } catch {}
  const receiver = ref.receiver && typeof ref.receiver === 'object'
    ? cloneWorkspacePlain(ref.receiver)
    : {
        lon: Number(params.receiverX),
        lat: Number(params.receiverY),
        depthM: Number(noiseParams.value.depth),
        rangeM: 0,
        bearingDeg: azimuth,
      }
  soundResultCache['2d'] = {
    calcParams: params,
    raySourceData: raySource,
    staticRayData: rayJson,
    sourcePoint: {
      lon: Number(params.coordX),
      lat: Number(params.coordY),
      depth_m: Number(params.srcDepth) || 0,
    },
    sourceRadiusKm: Math.max(0.1, distanceMaxKm || Number(params.range) * 1.852 || 20),
    sliceAzimuthDeg: azimuth,
    availableAzimuths: [azimuth],
    bottomTypeSegments: [],
    bottomTypeState: 'idle',
    rayDataByAzimuth: new Map(),
    bottomTypeByAzimuth: new Map(),
    receiverArrayMarker: receiver,
    volumeData: null,
  }
  if (analysisMode.value === '2d') {
    restoreSoundResult('2d')
    focus2dField()
  }
}

/** 从后端已保存的环境噪声响应重建噪声结果与全局噪声场。 */
async function restoreWorkspaceNoiseResult(ref) {
  if (!ref?.jobId) return
  const payload = await loadAcousticJobResult(ref.jobId)
  const response = portalUnitResponse(payload?.result) ?? payload?.result
  if (!response) return
  const params = ref.params && typeof ref.params === 'object'
    ? cloneWorkspacePlain(ref.params)
    : cloneNoiseParameters(noiseParams.value)
  noiseResult.value = response
  noiseResultParams.value = params
  noiseResultOutdated.value = false
  publishEnvironmentNoise(response, params, 'normal')
  cleanGlobeView.value = false
  if (isNoiseMode.value) {
    parameterPanelOpen.value = false
    resultPanelOpen.value = true
  }
}

/** 恢复信号链：连续链路按保存的请求重放，固定链路直接读取已保存结果。 */
async function restoreWorkspaceSignalResult(ref) {
  const request = ref?.request && typeof ref.request === 'object'
    ? cloneWorkspacePlain(ref.request)
    : null
  if (request) {
    // 恢复重放不应再次登记为新的工作区结果。
    lastSignalRequest = null
    runSignalTransmissionSession({ ...request })
    return
  }
  if (!ref?.jobId) return
  const payload = await loadAcousticJobResult(ref.jobId)
  if (payload?.kind === 'signal' && payload.result) {
    signalTransmissionSession.result = payload.result
    signalTransmissionSession.state = 'complete'
    signalTransmissionSession.phase = 'complete'
    signalTransmissionSession.percent = 100
    signalTransmissionSession.message = '已恢复保存的信号链结果'
  }
}
const noiseResult = shallowRef(null)
const noiseResultParams = ref(null)
const noiseResultOutdated = ref(false)
const noiseResultLabel = computed(() => '环境噪声')
const noiseResultMeta = computed(() => {
  const p = noiseResultParams.value || noiseParams.value
  const freq = Number(p.minFreq) === Number(p.maxFreq) ? `${p.minFreq} Hz` : `${p.minFreq}~${p.maxFreq} Hz`
  const location = `接收点 ${Number(p.receiverX).toFixed(4)}°, ${Number(p.receiverY).toFixed(4)}° · 深度 ${p.depth} m`
  return `${noiseResultLabel.value} · ${location} · 频率 ${freq} · 采样 ${p.numPoints} 点 · 航运 ${p.shipDensityLevel} 级 · 海况 ${p.windSpeed} 级 · 降雨 ${p.rainIntensity} 级`
})

const viewerReady = ref(false)
const webgl2Supported = ref(null)
const loading = ref(false)
const loadingMessage = ref('')
const buildProgress = ref(0)
const statusText = ref('')
const errorText = ref('')
const runtimeError = ref('')

const bounds = ref(null)
const sourcePoint = ref(null)
const volumeData = ref(null)
/**
 * 声场剖面数据：三维结果使用解析后的紧凑模型，二维结果保留接口结构。
 *
 * 用 shallowRef：数据十万级体素，既不需要深层响应式（避免遍历时的 Proxy 开销），
 * 也保证各消费方（体解码 / 二维声场 / 剖面图）复用同一个对象引用。
 */
const raySourceData = shallowRef(null)
// 必须在 volumeData / raySourceData 初始化之后启动立即监听；否则 setup 阶段会
// 访问处于暂时性死区的变量，导致整个数字地球视图无法挂载。
watch(hasTerrainVolume, value => {
  acousticSceneState.hasTerrainVolume = value
}, { immediate: true })
const texWidth = ref(0)
const texHeight = ref(0)
const texDepth = ref(0)
/** 门户实际计算的方位扇面数；与前端插值后的纹理高度严格区分 */
const calculatedSectorCount = ref(0)
/** 每两个接口扇面之间的前端角向插值密度；末尾另加一行闭合 0°/360° 接缝 */
const TLRD_ANGLE_INTERP = 8
const validVoxelPct = ref('0')
/** 声线条数（唯一 rayId 数量） */
const rayCount = ref(0)
/** 声源半径（最大传播距离，km） */
const sourceRadiusKm = ref(0)

/**
 * 沿航线的海底底质类型标注（按距离分段）。
 * 每项：{ startM, endM, id, label }；id <= 0 时 label 为「默认」。
 */
const bottomTypeSegments = ref([])
/** 底质查询状态：idle | loading | ready | error */
const bottomTypeState = ref('idle')
/** 同一结果内按方位缓存，指针来回切换时不重复请求。 */
const bottomTypeByAzimuth = new Map()
let bottomTypeToken = 0
let bottomTypeTimer = 0
/** 每次航线查询的采样点数；后端上限 10000，180 足够刻画分段。 */
const BOTTOM_TYPE_ROUTE_SAMPLE_COUNT = 180

/**
 * 当前传播损失扇面对应的 Analyse2DRTRD 声线数据。
 * 指针切换扇面后按该扇面的真实罗盘方位重新计算；已访问方位使用内存缓存。
 */
const staticRayData = shallowRef(null)
const rayDataByAzimuth = new Map()
/** 三维动态声线缓存：保留给可选模式；当前默认走二维动态声线。 */
const ray3dByAzimuth = { static: new Map(), dynamic: new Map() }
let ray3dRequest = null
let ray3dToken = 0
/** 本次射线模型运行是否检测到海冰（自动决定是否走冰区接口）。 */
const detectedSeaIce = ref(false)
/**
 * 三维传播损失完成后不自动请求声线。只有用户点击「二维传播损失」后才激活
 * 动态声线工作流；激活后方位变化会继续按需请求对应扇面的动态声线。
 */
const dynamicRaysActivated = ref(false)
const dynamicRayLoading = ref(false)
const rayRequestByKey = new Map()
// 二维声线响应包含每条射线的完整轨迹，单个方位就可能很大。三维计算只需要
// 当前切面对应的声线；限制为最近两个方位，避免遍历所有扇面后累积数 GB。
const MAX_CACHED_RAY_AZIMUTHS = 2
let rayLoadToken = 0
let rayLoadTimer = 0

/**
 * 移动声源切换声场站位时，旧声线的声源位置/深度已经失效。
 * 同时递增令牌，使仍在返回途中的旧二维/三维声线响应不能重新写回缓存。
 */
function invalidateMovingSourceRayData() {
  clearTimeout(rayLoadTimer)
  rayLoadTimer = 0
  rayLoadToken += 1
  ray3dToken += 1
  ray3dRequest = null
  rayRequestByKey.clear()
  rayDataByAzimuth.clear()
  ray3dByAzimuth.static.clear()
  ray3dByAzimuth.dynamic.clear()
  staticRayData.value = null
  stopVolumeRayAnimation()
  stopSliceRayAnimation()
}

function rememberRayData(key, value) {
  if (rayDataByAzimuth.has(key)) rayDataByAzimuth.delete(key)
  rayDataByAzimuth.set(key, value)
  while (rayDataByAzimuth.size > MAX_CACHED_RAY_AZIMUTHS) {
    const oldestKey = rayDataByAzimuth.keys().next().value
    if (oldestKey == null) break
    rayDataByAzimuth.delete(oldestKey)
  }
}
/** 静态声线剖面模型（含真实声线 `rayPaths` / 声源深度 / 最大距离） */
const staticRayModel = computed(() => (staticRayData.value ? buildProfileModel(staticRayData.value, 'rtrd') : null))
/** 静态声线是否可用（标准三维声场 + 二维声线数据已加载） */
const useStaticRays = computed(
  () =>
    dataSource.value === 'tlrd' &&
    Array.isArray(staticRayModel.value?.rayPaths) &&
    staticRayModel.value.rayPaths.length > 0
)
/** 静态声线的最大传播距离（米）：距离轴按声线实际范围显示，避免声线压成一团 */
const staticRayMaxDistM = computed(() => Number(staticRayModel.value?.maxDistM) || 0)
/** 静态声线的声源深度（米） */
const staticRaySourceDepthM = computed(() => Number(staticRayModel.value?.sourceDepthM))

// 唯一垂直夸张倍率：与侧边栏 terrainExaggeration 双向同步，同时作用于
// 地形、三维声场、声源、声线与垂直切面。1× 保持真实物理比例。
const depthExaggeration = ref(3)
const volumeOpacity = ref(opacityControlToAlphaScale(volumeRenderingControls.opacity))
/** 数据筛选范围（dB）：决定哪些体素参与渲染 */
const valueRange = ref({ min: VOLUME_TL_COLOR_MIN, max: VOLUME_TL_COLOR_MAX })
/** 色标映射范围（dB）：决定红（下限）→蓝（上限）的取值映射，与数据筛选无关 */
const colorRange = ref({ min: VOLUME_TL_COLOR_MIN, max: VOLUME_TL_COLOR_MAX })
/** 色标透明度区间：min = 红端（色标下限）alpha，max = 蓝端（色标上限）alpha */
const valueAlphaRange = ref({
  min: DEFAULT_VALUE_ALPHA_RANGE[0] ?? 1,
  max: DEFAULT_VALUE_ALPHA_RANGE[1] ?? 0,
})
/** 三维声场体是否显示（默认打开）：关闭时把 primitive 移出场景，指针 / 图表不受影响 */
const volumeVisible = ref(true)
/** 二维声场俯视图是否显示（默认打开）：以影像图层形式贴在 Cesium 球面 */
const omni2dVisible = ref(true)
/** 二维声场展示的深度层：默认第 0 层（海面） */
const omni2dDepthIndex = ref(0)
/** 二维声场渲染样式：'sonar' 声呐预测（射线 + 距离圈，参考装备显示） / 'heatmap' 色阶热力图 */
const omni2dStyle = ref('sonar')
/** 声呐风格射线方位数（数据方位不足时按角向插值加密） */
const OMNI_RAY_COUNT = 72
/** 二维声场影像图层（SingleTileImageryProvider） */
let omni2dLayer = null
/** 色标 / 筛选范围拖动时延迟重建二维图层，避免频繁栅格化 */
let omni2dTimer = 0
/** 二维图层异步就绪令牌：避免旧图层在图片加载完成后回插场景 */
let omni2dLayerToken = 0
/** 当前三维极坐标纹理；海面投影复用其 A 通道，保证与体渲染采用同一地形掩膜 */
let currentVolumeTexture = null
/** 三维切面显示模式：off | single | multi */
const sliceDisplayMode = ref('off')
/** 是否启用了任意切面（单方位 / 多方位） */
const sliceEnabled = computed(() => sliceDisplayMode.value !== 'off')
/** 启用单方位切面：只显示当前方位剖面帘 */
const singleSliceEnabled = computed({
  get: () => sliceDisplayMode.value === 'single',
  set: (value) => {
    if (value) sliceDisplayMode.value = 'single'
    else if (sliceDisplayMode.value === 'single') sliceDisplayMode.value = 'off'
  },
})
/** 启用多方位切面：同时显示所有计算扇面的剖面帘 */
const multiSliceEnabled = computed({
  get: () => sliceDisplayMode.value === 'multi',
  set: (value) => {
    if (value) sliceDisplayMode.value = 'multi'
    else if (sliceDisplayMode.value === 'multi') sliceDisplayMode.value = 'off'
  },
})
const isMultiSlice = computed(() => sliceDisplayMode.value === 'multi')
const sliceMode = ref('azimuth')
const slicePercent = ref(100)
/** 切面方向中文名：折叠徽标用 */
const sliceModeLabel = computed(
  () => ({ azimuth: '方位', depth: '深度', lon: '经度', lat: '纬度' })[sliceMode.value] ?? '方位'
)
/**
 * 切面 / 指针的内部方位角（0°=正东、逆时针）。侧边栏只暴露罗盘方位
 * （0°=正北、顺时针），避免同一方向在二维菜单和三维场景中显示成两个角度。
 */
const sliceAzimuthDeg = ref(compassBearingToInternalAzimuth(verticalSliceControls.sliceAzimuthDeg))

/* ── 垂直切面 / 动态声线使用的数据（当前结果或选中的历史声场） ── */
const profileData = computed(() => selectedProfileLayer.value?.field || raySourceData.value)
/** 垂直切面颜色范围：普通 TL 与三维声场体共用同一 dB 色标；信号余量模式下使用 SE/Pd 自身的色标范围。 */
const profileDbRange = computed(() => {
  const params = signalExcessParams.value
  if (!params) {
    return { min: Number(volumeRenderingControls.dbMin), max: Number(volumeRenderingControls.dbMax) }
  }
  if (params.displayMode === 'pd') {
    const rawMin = Number(signalExcessState.pdMin)
    const rawMax = Number(signalExcessState.pdMax)
    const min = Math.min(99, Math.max(0, Number.isFinite(rawMin) ? rawMin : 0))
    const max = Math.min(100, Math.max(min + 1, Number.isFinite(rawMax) ? rawMax : 100))
    return { min, max }
  }
  const min = Number(signalExcessState.dbMin)
  const max = Number(signalExcessState.dbMax)
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) return { min, max }
  return { min: -60, max: 60 }
})
/** 信号余量开启时垂直切面只显示该方位的 SE/Pd，不再叠加动态声线。 */
const profileRayData = computed(() => {
  if (signalExcessState.enabled) return null
  return selectedProfileLayer.value ? selectedProfileLayer.value.rayData : staticRayData.value
})
const profileAnimated = computed(() => {
  const layer = selectedProfileLayer.value
  const interfaceTag = layer ? layer.rayInterface : calcParams.value.rayInterface
  return interfaceTag === 'dynamic' && verticalSliceControls.dynamicRays
})
const profileAzimuthDeg = computed(() => (
  selectedProfileLayer.value
    ? Number(selectedProfileLayer.value.sliceAzimuthDeg) || 0
    : sliceAzimuthDeg.value
))
const profileMaxRadiusM = computed(() => {
  const layer = selectedProfileLayer.value
  if (layer) return (Number(layer.sourceRadiusKm || layer.radiusKm) || 0) * 1000
  return sourceRadiusKm.value * 1000
})
const profileBottomTypeSegments = computed(() => (
  selectedProfileLayer.value ? (selectedProfileLayer.value.bottomTypeSegments || []) : bottomTypeSegments.value
))
const profileBottomTypeState = computed(() => (
  selectedProfileLayer.value ? (selectedProfileLayer.value.bottomTypeState || 'idle') : bottomTypeState.value
))
const profileTerrainRayData = computed(() => {
  if (signalExcessState.enabled) return null
  const layer = selectedProfileLayer.value
  if (!(verticalSliceControls.dynamicRays || verticalSliceControls.staticRays)) return null
  return layer ? layer.rayData : staticRayData.value
})
const profileTerrainRaysVisible = computed(() => (
  earthRaysVisible.value &&
  !signalExcessState.enabled &&
  (verticalSliceControls.dynamicRays || verticalSliceControls.staticRays) &&
  (selectedProfileLayer.value ? !!selectedProfileLayer.value.rayData : true)
))
const profileTerrainRaysStatic = computed(() => !!verticalSliceControls.staticRays)
const profileTerrainRaysAnimated = computed(() => {
  const layer = selectedProfileLayer.value
  if (layer) return verticalSliceControls.dynamicRays && layer.rayInterface === 'dynamic'
  return !!verticalSliceControls.dynamicRays
})
/** 方向方位线 / 声速剖面所属声场体（选中历史声场时跟随该体）。 */
const profileDirectionLayerId = computed(() => selectedProfileLayer.value?.id || 'current')
const profileSoundProfile = computed(() => (
  selectedProfileLayer.value?.field?.soundProfile || terrainField.value?.soundProfile || null
))
const profileSourceLon = computed(() => Number(
  selectedProfileLayer.value?.source?.lon ?? sourcePoint.value?.lon ?? terrainSource.value?.lon ?? calcParams.value.coordX
))
const profileSourceLat = computed(() => Number(
  selectedProfileLayer.value?.source?.lat ?? sourcePoint.value?.lat ?? terrainSource.value?.lat ?? calcParams.value.coordY
))
const profileSeabedDepth = computed(() => {
  const field = selectedProfileLayer.value?.field || terrainField.value
  if (!field || typeof field.seabedDepthAt !== 'function') return NaN
  const sectorCount = Math.max(1, Number(field.grid?.sector) || 1)
  const bearings = field.grid?.compassBearings
  let sectorIndex = 0
  if (Array.isArray(bearings) && bearings.length) {
    const target = internalAzimuthToCompassBearing(Number(profileAzimuthDeg.value) || 0)
    let bestDiff = Infinity
    for (let index = 0; index < Math.min(sectorCount, bearings.length); index += 1) {
      const raw = Number(bearings[index])
      if (!Number.isFinite(raw)) continue
      const diff = Math.abs((((raw - target) % 360) + 540) % 360 - 180)
      if (diff < bestDiff) {
        bestDiff = diff
        sectorIndex = index
      }
    }
  }
  const depth = Number(field.seabedDepthAt(sectorIndex, 0))
  return Number.isFinite(depth) && depth > 0 ? depth : NaN
})

/* ── 侧边栏「垂直切面」控件 ↔ 本地状态双向同步 ── */
watch(() => verticalSliceControls.showSlice, (val) => {
  terrainSliceOpen.value = !!val
  // 图层常驻：开关只改显隐，不销毁 ECharts 或三维剖面 primitive。
  applySliceCurtainVisibility()
})
watch(staticSignalChannelReady, (ready) => {
  if (!ready) signalTransmissionControls.sliceReceiverPlacement = false
})
watch(sliceReceiverPlacementActive, (active) => {
  if (!active) return
  verticalSliceControls.showSlice = true
  terrainSliceOpen.value = true
  terrainSliceMinimized.value = false
  removeTerrainWindowFromDock('slice')
  nextTick(() => terrainLossChartRef.value?.refreshLayout?.())
})
watch(() => verticalSliceControls.sspWindow, (val) => {
  terrainProfileOpen.value = !!val
})
watch(() => verticalSliceControls.sliceAzimuthDeg, (val) => {
  const compass = normalizeAzimuth360(Number(val) || 0)
  const v = compassBearingToInternalAzimuth(compass)
  const layer = selectedProfileLayer.value
  if (layer) {
    if (Math.abs((Number(layer.sliceAzimuthDeg) || 0) - v) < 1e-6) return
    onProfileAzimuthChange(v)
    return
  }
  if (Math.abs(sliceAzimuthDeg.value - v) < 1e-6) return
  sliceAzimuthDeg.value = v
  onAzimuthUiChange()
})
watch(() => terrainSliceOpen.value, (val) => {
  if (verticalSliceControls.showSlice !== !!val) verticalSliceControls.showSlice = !!val
  if (val) {
    // 垂直切面刚打开时从 0s 开始播放声线。
    seekRayFlowClock(0)
    nextTick(() => terrainLossChartRef.value?.refreshLayout?.())
  } else {
    signalTransmissionControls.sliceReceiverPlacement = false
    terrainSliceMinimized.value = false
    removeTerrainWindowFromDock('slice')
  }
})
// 三维体上的方位切面刚启用时同样从 0s 开始。
watch(sliceEnabled, (enabled, previous) => {
  if (enabled && !previous) seekRayFlowClock(0)
})
// 裁剪体开关：开启时恢复上次裁剪方向并显示可拖拽箭头；关闭时恢复完整声场。
watch(() => verticalSliceControls.clipBody, (enabled) => {
  if (enabled) {
    if (Number.isFinite(lastClipAzimuthDeg)) sliceAzimuthDeg.value = lastClipAzimuthDeg
    else lastClipAzimuthDeg = Number(sliceAzimuthDeg.value) || 0
  }
  setupAzimuthPointer()
  applyPointerVisibility()
  syncSoundField()
  viewer?.scene?.requestRender?.()
})
// 方位方向线开关：开启时体上的箭头可拖动切换方位，关闭时按指针自身开关决定显隐。
watch(() => verticalSliceControls.east90Indicator, () => {
  setupAzimuthPointer()
  applyPointerVisibility()
  viewer?.scene?.requestRender?.()
})
watch(() => terrainProfileOpen.value, (val) => {
  if (verticalSliceControls.sspWindow !== !!val) verticalSliceControls.sspWindow = !!val
  if (!val) {
    terrainProfileMinimized.value = false
    removeTerrainWindowFromDock('profile')
  }
})
watch(() => profileAzimuthDeg.value, (val) => {
  const v = normalizeAzimuth360(internalAzimuthToCompassBearing(Number(val) || 0))
  if (Math.abs(verticalSliceControls.sliceAzimuthDeg - v) > 1e-6) verticalSliceControls.sliceAzimuthDeg = v
})
/* ── 侧边栏「声线播放」控件 → 传播时钟 / 声线显隐 ── */
watch(() => verticalSliceControls.raySpeed, (value) => setRayFlowSpeed(value), { immediate: true })
watch(staticRayData, (data) => {
  if (!data) {
    verticalSliceControls.rayTimelineMs = 8000
    return
  }
  const flow = resolveRayFlow(data, parseAnalyse2DRtrd(data)?.rays ?? [])
  const duration = Number(flow?.durationMs)
  verticalSliceControls.rayTimelineMs = Number.isFinite(duration) && duration > 0 ? duration : 8000
}, { flush: 'post' })
watch(
  () => [verticalSliceControls.dynamicRays, verticalSliceControls.staticRays],
  ([dynamic, staticRays], [prevDynamic, prevStatic]) => {
    if ((dynamic && !prevDynamic) || (staticRays && !prevStatic)) requestRayDataForPlayback()
    applyRayPlaybackVisibility()
  }
)

/** 打开声线播放但尚无当前方位数据时，按当前接口补算一次。 */
function requestRayDataForPlayback() {
  if (!isRayModel.value || analysisMode.value !== '3d' || !raySourceData.value || !availableAzimuths.value.length) return
  if (staticRayData.value && getCachedRayResponse(sliceAzimuthDeg.value)) return
  ensureRayDataForAzimuth(sliceAzimuthDeg.value).catch((error) => {
    console.warn('[声线播放] 当前方位声线不可用：', error?.message ?? error)
  })
}

/**
 * 动态 / 静态声线开关变化后统一刷新三维体、剖面帘与二维声场。
 * 动态关闭即停止行进动画；静态开启保留完整路径。
 */
function applyRayPlaybackVisibility() {
  const dynamic = !!verticalSliceControls.dynamicRays
  const staticRays = !!verticalSliceControls.staticRays
  // 只有动态声线推进播放时间；仅静态（或全部关闭）时归零并暂停，
  // 重新打开动态后从 0s 继续行进。
  if (dynamic) {
    setRayFlowPaused(false)
  } else {
    seekRayFlowClock(0)
    setRayFlowPaused(true)
  }
  twoDRayFlowRenderer?.setVisible(earthRaysVisible.value && dynamic)
  if (analysisMode.value === '3d') {
    refreshVolumeRayScatterPoints()
    syncSoundField()
    if (earthRaysVisible.value && dynamic) startVolumeRayAnimation()
    else stopVolumeRayAnimation()
    if (sliceEnabled.value) startSliceRayAnimation()
    else stopSliceRayAnimation()
  } else if (analysisMode.value === '2d' && raySourceData.value) {
    render2dFieldOnEarth(raySourceData.value)
  }
  if (!dynamic && !staticRays) stopTwoDRayAnimation()
  viewer?.scene?.requestRender?.()
}

/** 三维「体渲染」控制窗是否展开（由结果窗「体渲染」按钮控制） */
const renderControlsOpen = ref(false)
/** FOM 门限（dB）：三维体中 TL 高于该值的体素变透明、不再显示；默认 200 = 全部显示 */
const fomValue = ref(200)
/** 启切面时绘制的二维传播损失剖面帘（多方位切面对应多个 primitive） */
let sliceCurtainPrimitives = []
/** 各剖面帘的局部坐标信息，用于在其上叠加动态声线 */
let sliceCurtainMetaList = []
/** 剖面帘上的动态声线图元 */
let sliceRayFeatures = []
/** 剖面帘上预绘的完整声线图元（白色浅色、固定整条路径） */
let sliceStaticRayFeatures = []
/** 剖面帘声线动画定时器 */
let sliceRayAnimationTimer = 0
/** 方位拖动时延迟重建剖面帘，避免每帧重建 */
let sliceCurtainTimer = 0
/** 深度夸张拖动：逐帧合并体几何更新，停止后延迟重建声线与剖面帘 */
let depthExagSyncRaf = 0
let depthExagSyncTimer = 0

/** 声源点上方方位指针（可拖拽，默认 0°） */
const pointerEnabled = ref(true)
/** 指针外围辅助刻度环 / 刻度点是否显示（隐藏后仍可拖拽） */
const pointerRingVisible = ref(true)
/** 数据实际存在的方位列表（度）：指针只能停靠在这些方位上 */
const availableAzimuths = ref([])
/** 当前方位方向线所依附声场体的实际计算方位（内部方位：正东 0°、逆时针）。 */
const activeSliceAzimuths = computed(() => {
  const grid = selectedProfileLayer.value?.field?.grid
  if (grid && Number(grid.sector) > 0) {
    return tlrdSectorAzimuths(grid.sector, grid.compassBearings)
  }
  return availableAzimuths.value
})
/** 控制面板切面方位滑杆的候选方位（内部方位，按罗盘方位排序）。 */
const sliceAzimuthOptions = computed(() => {
  const unique = []
  for (const raw of availableAzimuths.value) {
    const number = Number(raw)
    if (!Number.isFinite(number)) continue
    const value = normalizeAzimuth360(number)
    if (!unique.some((item) => Math.abs(item - value) < 1e-6)) unique.push(value)
  }
  return unique.sort((a, b) => internalAzimuthToCompassBearing(a) - internalAzimuthToCompassBearing(b))
})
const sliceAzimuthSliderIndex = computed(() => {
  const options = sliceAzimuthOptions.value
  if (!options.length) return 0
  const current = nearestAvailableAzimuth(Number(sliceAzimuthDeg.value))
  let best = 0
  let bestDiff = Infinity
  options.forEach((value, index) => {
    const diff = Math.abs(value - current)
    if (diff < bestDiff) {
      bestDiff = diff
      best = index
    }
  })
  return best
})
/** 侧边栏方位滑杆候选方位（罗盘方位，升序）。 */
const sidebarSliceAzimuthOptions = computed(() => {
  const unique = []
  for (const raw of activeSliceAzimuths.value) {
    const number = Number(raw)
    if (!Number.isFinite(number)) continue
    const value = normalizeAzimuth360(internalAzimuthToCompassBearing(number))
    if (!unique.some((item) => Math.abs(item - value) < 1e-6)) unique.push(value)
  }
  return unique.sort((a, b) => a - b)
})
watch(sidebarSliceAzimuthOptions, (options) => {
  acousticSceneState.sliceAzimuths = options
}, { immediate: true })

// TL 色标（归一化 0–1 → RGB 0–255）：固定红→蓝 6 段，按自定义 dB 范围映射
const colorStops = ref(
  VOLUME_TL_COLOR_STOPS.map(([t, c]) => ({ t, color: `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` }))
)

/** 图例：随自定义 dB 范围实时刷新（下限=红，上限=蓝） */
const volumeLegend = computed(() => ({
  ...VOLUME_TL_LEGEND,
  gradient: colorGradient.value,
  inRangeMin: fmt(signalExcessParams.value ? profileDbRange.value.min : colorRange.value.min, 1),
  inRangeMax: fmt(signalExcessParams.value ? profileDbRange.value.max : colorRange.value.max, 1),
  unit: signalExcessParams.value?.displayMode === 'pd' ? '%' : 'dB',
  outOfRangeLabel: signalExcessParams.value?.threeColor
    ? 'Pd < 25% 或目标深度范围外（透明）'
    : signalExcessParams.value ? '目标深度范围外（透明）' : VOLUME_TL_LEGEND.outOfRangeLabel,
}))

// 面板折叠状态：默认展开「计算参数」与「显示控制」
const collapsedSections = ref({ calc: false, info: true, display: false, slice: true, pointer: false })

/** 相邻方位间隔（度），0 表示数据未提供方位列表 */
const azimuthStepDeg = computed(() => minAzimuthSpacingDeg(availableAzimuths.value))
/** 声线方位筛选容差（度）：取相邻方位间隔的一半，保证一次只命中一个方位 */
const azimuthToleranceDeg = computed(() => Math.max(0.5, azimuthStepDeg.value / 2))

/* ────────────────── 二维声场俯视图（贴在 Cesium 球面） ────────────────── */
/** 二维声场统一模型（随数据源变化才重建） */
const omni2dModel = computed(() => buildOmniField(raySourceData.value, dataSource.value))
/** 可选深度层（米） */
const omni2dDepthOptions = computed(() => omni2dModel.value?.depths ?? [])
/** 当前深度层文案（第 0 层标注海面） */
const omni2dDepthLabel = computed(() => {
  const list = omni2dDepthOptions.value
  if (!list.length) return '—'
  const i = Math.max(0, Math.min(list.length - 1, omni2dDepthIndex.value))
  return `第${i}层 · ${fmt(list[i], 1)} m${i === 0 ? '（海面）' : ''}`
})

let viewer = null
/** 地形预览需要读取 Cesium 实例，用 shallowRef 暴露给子组件而不产生深层响应式代理。 */
const activeViewer = shallowRef(null)
let soundField = null
/** 二维结果挂到 GeoVis 地球上的传播带、路径和端点。 */
let twoDMapFeatures = []
/** 地球剖面帘上叠加的声线图元（可单独隐藏 / 显示）。 */
let twoDRayFeatures = []
/** 地球剖面帘声线动画定时器 */
let twoDRayFlowRenderer = null
/** 全球 Cesium 三维体上的动态声线（区域地形模式由 Canvas 直接绘制） */
let volumeRayFlowRenderer = null
/** 二维彩色传播带使用单张透明影像，绕开旧版 GeoVis Primitive 的崩溃路径。 */
let twoDMapLayer = null
/** 二维竖直剖面帘：矩形直角体 primitive（沿大圆方向的旋转包围盒） */
let curtainPrimitive = null
/** 地球剖面帘 / 三维声场体上是否叠加声线（「声线隐藏 / 声线显示」按钮控制） */
const earthRaysVisible = ref(true)
/** 进入全球干净视图前用户设置的声线显隐，返回地形时恢复。 */
let earthRaysVisibleBeforeGlobe = null

/** 显示 / 隐藏地球剖面帘和三维体上的声线（不移除剖面帘本身） */
function setEarthRaysVisible(visible) {
  earthRaysVisible.value = visible !== false
  twoDRayFlowRenderer?.setVisible(earthRaysVisible.value && verticalSliceControls.dynamicRays)
  if (analysisMode.value === '3d') {
    refreshVolumeRayScatterPoints()
    syncSoundField()
    if (earthRaysVisible.value && verticalSliceControls.dynamicRays) startVolumeRayAnimation()
    else stopVolumeRayAnimation()
    if (sliceEnabled.value) {
      if (earthRaysVisible.value) startSliceRayAnimation()
      else stopSliceRayAnimation()
    }
  }
  if (!viewer?.features) return
  for (const feature of twoDRayFeatures) {
    try {
      if (earthRaysVisible.value) feature.addTo(viewer.features)
      else viewer.features.remove(feature)
    } catch {}
  }
  viewer.scene?.requestRender?.()
}

/** 移除二维剖面帘 primitive */
function removeCurtainPrimitive() {
  if (curtainPrimitive && viewer && !viewer.isDestroyed?.()) {
    try {
      viewer.scene?.primitives?.remove(curtainPrimitive)
    } catch {}
    try {
      curtainPrimitive.destroy()
    } catch {}
  }
  curtainPrimitive = null
}
/** 容器尺寸监听（外层窗口最大化 / 还原、浏览器窗口缩放时同步 Cesium 画布） */
let rootResizeObserver = null
/** 尺寸变化后延迟一帧 resize，等布局稳定再刷新画布 */
let resizeRaf = 0
/** 色标范围可选区间（保证默认 60–120 dB 始终可选） */
const dbRangeMin = computed(() => Math.min(VOLUME_TL_COLOR_MIN, bounds.value?.value?.min ?? VOLUME_TL_COLOR_MIN))
const dbRangeMax = computed(() => Math.max(VOLUME_TL_COLOR_MAX, bounds.value?.value?.max ?? VOLUME_TL_COLOR_MAX))

// 数据筛选范围滑块步长（按数据实际 TL 范围）
const valueStep = computed(() => {
  const b = bounds.value
  if (!b) return 0.1
  return Math.max(0.001, (b.value.max - b.value.min) / 200)
})

// 色标范围滑块步长
const colorStep = computed(() => Math.max(0.001, (dbRangeMax.value - dbRangeMin.value) / 200))

const fmt = (v, d = 4) => (v != null && Number.isFinite(v) ? v.toFixed(d) : '-')

/** 内部方位（正东 0°、逆时针）→ 界面罗盘方位（正北 0°、顺时针） */
const displayAzimuth = (deg) => internalAzimuthToCompassBearing(Number(deg) || 0)

function normalizePortalTime(value) {
  const text = String(value || '').trim().replace('T', ' ')
  return text.length === 16 ? `${text}:00` : text
}

function portalUnitResponse(json) {
  return json?.Data?.Units?.[0]?.Response
}

async function loadDatasetTimes(target = calcParams) {
  try {
    const response = portalUnitResponse(await getDatasetTimeList(target.value.dataset)) ?? {}
    const list = Array.isArray(response.standardTimeList) ? response.standardTimeList : response.displayList
    if (!Array.isArray(list) || !list.length) return
    timeOptions.value = list.map((item) => String(item).replace(' ', 'T'))
    hycomTimeMeta.value = {
      defaultTime: String(response.defaultTime || '').replace(' ', 'T'),
      forecastStartTime: String(response.forecastStartTime || '').replace(' ', 'T'),
    }
    if (!timeOptions.value.includes(target.value.time)) {
      target.value.time = timeOptions.value.includes(hycomTimeMeta.value.defaultTime)
        ? hycomTimeMeta.value.defaultTime
        : timeOptions.value[timeOptions.value.length - 1]
    }
  } catch (err) {
    console.warn('[HYCOM] 可用时次加载失败，继续使用默认值：', err?.message ?? err)
  }
}

async function loadCatalogOptions() {
  await loadDatasetTimes()
}

function greatCircle(sourceLon, sourceLat, targetLon, targetLat) {
  const lon1 = Cesium.Math.toRadians(Number(sourceLon) || 0)
  const lat1 = Cesium.Math.toRadians(Number(sourceLat) || 0)
  const lon2 = Cesium.Math.toRadians(Number(targetLon) || 0)
  const lat2 = Cesium.Math.toRadians(Number(targetLat) || 0)
  const dLon = lon2 - lon1
  const dLat = lat2 - lat1
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  const distanceM = 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const bearing = (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360
  return { distanceNm: distanceM / 1852, bearing }
}

const routeGeometry = computed(() =>
  greatCircle(calcParams.value.coordX, calcParams.value.coordY, calcParams.value.receiverX, calcParams.value.receiverY)
)
const routeDistanceNm = computed(() => routeGeometry.value.distanceNm)
const routeBearingDeg = computed(() => routeGeometry.value.bearing)
const isRayModel = computed(() => calcParams.value.model === 'bellhop')
/** 是否使用后端动态声线接口 */
const useDynamicRays = computed(() => calcParams.value.rayInterface === 'dynamic')
/**
 * 当前计算声场默认使用二维动态声线接口：按当前方位独立请求声线，
 * 避免三维动态声线接口一次返回全部扇面造成的大请求与额外等待。
 * 三维声线实现仍保留，需要时把该开关改为 true 即可恢复。
 */
const USE_3D_RAY_INTERFACE = false
const use3dRays = computed(() => USE_3D_RAY_INTERFACE)
const selectedModelLabel = computed(() => ({
  bellhop: '射线模型',
  ram: 'RAM 模型',
  kraken: 'KRAKEN 模型',
})[calcParams.value.model] ?? calcParams.value.model)
const activePortalPlugins = computed(() => {
  const ice = calcParams.value.regionType === 'ice'
  const tlPlugin = portalPluginForModel(calcParams.value.model, analysisMode.value, ice).plugin
  if (analysisMode.value === '3d' || !isRayModel.value) return tlPlugin
  const rayPlugin = useDynamicRays.value
    ? (ice ? 'AnalyseIce2DRTRDDynamic' : 'Analyse2DRTRDDynamic')
    : (ice ? 'AnalyseIce2DRTRD' : 'Analyse2DRTRD')
  return `${tlPlugin} + ${rayPlugin}`
})
const resultLayerLabel = computed(() => {
  if (analysisMode.value === '3d') return 'GeoVis 三维体渲染'
  return isRayModel.value ? '距离—深度 TL 与声线剖面' : '距离—深度 TL 剖面'
})
/** 结果窗口顶部参数摘要（与图3/图4 一致的信息行） */
const resultMetaText = computed(() => {
  const p = calcParams.value
  const freq = Number(p.minFreq) === Number(p.maxFreq) ? `${p.minFreq} Hz` : `${p.minFreq}~${p.maxFreq} Hz`
  const az = analysisMode.value === '2d' ? routeBearingDeg.value : Number(p.azimuth)
  const range = analysisMode.value === '2d' ? routeDistanceNm.value : Number(p.range)
  const angles = launchAngleParams()
  const angleText = `${angles.grazingAngle - angles.beamWidth / 2}~${angles.grazingAngle + angles.beamWidth / 2}°`
  return `${selectedModelLabel.value} · 方位 ${Number(az).toFixed(1)}° · 距离 ${Number(range).toFixed(2)} nmi · 频率 ${freq} · 声源深度 ${Number(p.srcDepth)} m · 俯仰 ${angleText}`
})
/** 结果窗口左偏移：紧贴左侧水声模块区域右缘（无间隙） */
const resultWindowLeft = computed(() => (props.sidebarOpen ? '200px' : '0px'))

/** 俯角 / 仰角 → 门户的中心掠射角 + 波束宽度。 */
function launchAngleParams() {
  const first = Number(calcParams.value.grazingAngleMin)
  const second = Number(calcParams.value.grazingAngleMax)
  const a = Number.isFinite(first) ? first : -45
  const b = Number.isFinite(second) ? second : 45
  const minAngle = Math.min(a, b)
  const maxAngle = Math.max(a, b)
  return {
    grazingAngle: (minAngle + maxAngle) / 2,
    beamWidth: maxAngle - minAngle,
  }
}

function portalParamsFor(sourceParams = calcParams.value, extra = {}) {
  const p = sourceParams
  const first = Number(p.grazingAngleMin)
  const second = Number(p.grazingAngleMax)
  const a = Number.isFinite(first) ? first : -45
  const b = Number.isFinite(second) ? second : 45
  const minAngle = Math.min(a, b)
  const maxAngle = Math.max(a, b)
  return {
    coordX: Number(p.coordX),
    coordY: Number(p.coordY),
    dataSource: p.dataset,
    dataType: 'DT_ENV_SOUND',
    time: normalizePortalTime(p.time),
    timeRes: 0,
    rdataSource: p.dataset,
    rtime: normalizePortalTime(p.time),
    srcDepth: Number(p.srcDepth),
    minFreq: Number(p.minFreq),
    maxFreq: Number(p.maxFreq),
    grazingAngle: (minAngle + maxAngle) / 2,
    beamWidth: maxAngle - minAngle,
    isWaterChanged: true,
    coherent: Boolean(p.coherent),
    ...extra,
  }
}

function commonPortalParams(extra = {}) {
  return portalParamsFor(calcParams.value, extra)
}

/** 按切面箭头方位重新采样当前数字地球地形，并附到二维声线请求。 */
async function attachRayTerrainProfile(payload, sourceParams, bearingDeg, rangeNm) {
  try {
    const terrainProfile = await sampleTerrainProfile(viewer?.scene?.terrainProvider, {
      sourceLon: Number(sourceParams?.coordX),
      sourceLat: Number(sourceParams?.coordY),
      bearingDeg: Number(bearingDeg),
      rangeM: Number(rangeNm) * 1852,
      spacingM: 500,
      minSamples: 32,
      maxSamples: 512,
    })
    if (terrainProfile) payload.terrainProfile = terrainProfile
  } catch (error) {
    // 地形瓦片暂不可用时保留后端原有环境地形兜底，不阻断二维声线计算。
    console.warn('[二维声线地形采样]', error?.message ?? error)
  }
  return payload
}

const soundResultCache = {
  '2d': null,
  '3d': null,
}
let restoringSoundResult = false

function cacheSoundResult(mode = analysisMode.value) {
  if (mode !== '2d' && mode !== '3d') return
  const hasResult = mode === '2d' ? Boolean(raySourceData.value) : Boolean(volumeData.value)
  if (!hasResult) return
  soundResultCache[mode] = {
    calcParams: JSON.parse(JSON.stringify(calcParams.value)),
    raySourceData: raySourceData.value,
    staticRayData: staticRayData.value,
    sourcePoint: sourcePoint.value ? { ...sourcePoint.value } : null,
    sourceRadiusKm: sourceRadiusKm.value,
    sliceAzimuthDeg: sliceAzimuthDeg.value,
    availableAzimuths: [...availableAzimuths.value],
    bottomTypeSegments: [...bottomTypeSegments.value],
    bottomTypeState: bottomTypeState.value,
    rayDataByAzimuth: new Map(rayDataByAzimuth),
    bottomTypeByAzimuth: new Map(bottomTypeByAzimuth),
    receiverArrayMarker: receiverArrayMarker.value ? { ...receiverArrayMarker.value } : null,
    volumeData: volumeData.value,
  }
}

function hideSoundResult(mode) {
  if (mode === '2d') {
    clearOmni2dLayer()
    clearTwoDMapFeatures()
    removeCurtainPrimitive()
  } else if (mode === '3d') {
    applyVolumeVisible(false)
    removeSliceCurtain()
  }
  raySourceData.value = null
  staticRayData.value = null
  volumeData.value = null
  bottomTypeSegments.value = []
  bottomTypeState.value = 'idle'
}

function restoreSoundResult(mode) {
  const cached = soundResultCache[mode]
  if (!cached) return false
  restoringSoundResult = true
  calcParams.value = JSON.parse(JSON.stringify(cached.calcParams))
  raySourceData.value = cached.raySourceData
  staticRayData.value = cached.staticRayData
  sourcePoint.value = cached.sourcePoint ? { ...cached.sourcePoint } : null
  sourceRadiusKm.value = cached.sourceRadiusKm
  sliceAzimuthDeg.value = cached.sliceAzimuthDeg
  availableAzimuths.value = [...cached.availableAzimuths]
  bottomTypeSegments.value = [...cached.bottomTypeSegments]
  bottomTypeState.value = cached.bottomTypeState
  receiverArrayMarker.value = cached.receiverArrayMarker ? { ...cached.receiverArrayMarker } : null
  rayDataByAzimuth.clear()
  cached.rayDataByAzimuth.forEach((value, key) => rayDataByAzimuth.set(key, value))
  bottomTypeByAzimuth.clear()
  cached.bottomTypeByAzimuth.forEach((value, key) => bottomTypeByAzimuth.set(key, value))
  if (mode === '3d') {
    if (cached.sourcePoint) {
      terrainSource.value = {
        lon: Number(cached.sourcePoint.lon),
        lat: Number(cached.sourcePoint.lat),
        depth: Number(cached.sourcePoint.depth_m ?? cached.sourcePoint.depth ?? calcParams.value.srcDepth),
      }
    }
    volumeData.value = soundField?.volume || cached.volumeData
    volumeVisible.value = true
    applyVolumeVisible(true)
    syncSoundField()
    updateSliceCurtain()
  } else {
    volumeData.value = null
    nextTick(() => {
      if (analysisMode.value !== '2d' || !raySourceData.value) return
      render2dFieldOnEarth(raySourceData.value)
    })
  }
  nextTick(() => { restoringSoundResult = false })
  return true
}

function switchMode(mode) {
  if (analysisMode.value === mode) return
  const previousMode = analysisMode.value
  cacheSoundResult(previousMode)
  hideSoundResult(previousMode)
  analysisMode.value = mode
  // 三维模式默认只显示真正的体；海面投影可手动打开，但不再默认盖在体顶造成“面状”错觉。
  omni2dVisible.value = mode !== '3d'
  activeMapPick.value = ''
  errorText.value = ''
  statusText.value = ''
  restoreSoundResult(mode)
}

/** 当前维度是否已有可展示的结果（包含本次结果与切换维度后的缓存）。 */
function hasSoundResult(mode) {
  if (mode === '2d') return Boolean(raySourceData.value || soundResultCache['2d'])
  if (mode === '3d') return Boolean(volumeData.value || soundResultCache['3d'])
  return false
}

/** 点击水声模块内的「二维声场 / 三维声场」：切换维度并打开对应参数配置。 */
function selectWaterMode(mode) {
  const source = props.viewMode === 'terrain' ? { coordX: calcParams.value.coordX, coordY: calcParams.value.coordY } : null
  switchMode(mode)
  if (source) Object.assign(calcParams.value, source)
  // 返回水声传播时优先展示二维传播损失结果，便于直接在剖面上拖动接收阵。
  if (mode === '2d' && hasSoundResult('2d')) {
    ensureReceiverMarker()
    parameterPanelOpen.value = false
    receiverPlacementEnabled.value = false
    resultPanelOpen.value = true
    return
  }
  resultPanelOpen.value = false
  parameterPanelOpen.value = true
}

// 应用外壳负责模块导航；业务视图只响应选中的子模块。
watch(
  () => [props.submoduleSelectionVersion, props.activeSubmoduleId],
  (next, previous) => {
    if (next[0] === previous?.[0] && next[1] === previous?.[1]) return
    if (['2d', '3d', 'noise'].includes(props.activeSubmoduleId)) selectWaterMode(props.activeSubmoduleId)
  }
)

watch(
  () => [
    volumeRenderingControls.dbMin,
    volumeRenderingControls.dbMax,
    volumeRenderingControls.opacity,
    volumeRenderingControls.density,
    volumeRenderingControls.contrast,
    volumeRenderingControls.edgeSharpness,
    volumeRenderingControls.colormap,
  ],
  () => {
    const controls = volumeRenderingControls
    const rawMin = Number(controls.dbMin)
    const rawMax = Number(controls.dbMax)
    const min = Number.isFinite(rawMin) ? rawMin : VOLUME_TL_COLOR_MIN
    const max = Number.isFinite(rawMax) ? Math.max(min + 1, rawMax) : VOLUME_TL_COLOR_MAX
    colorRange.value = { min, max }
    volumeOpacity.value = opacityControlToAlphaScale(controls.opacity)
    syncSoundField()
    scheduleOmni2dLayer()
  },
  { immediate: true }
)

// 侧边栏只保留一个垂直夸张参数；Cesium 声场和区域地形预览共用同一数值。
watch(
  () => volumeRenderingControls.terrainExaggeration,
  (value) => {
    const next = Math.min(50, Math.max(0.5, Number(value) || 3))
    if (Math.abs(Number(depthExaggeration.value) - next) < 1e-6) return
    depthExaggeration.value = next
    onDepthExagChange()
  },
  { immediate: true }
)

watch(depthExaggeration, (value) => {
  const next = Math.min(50, Math.max(0.5, Number(value) || 3))
  if (Math.abs(Number(depthExaggeration.value) - next) >= 1e-6) depthExaggeration.value = next
  if (Math.abs(Number(volumeRenderingControls.terrainExaggeration) - next) >= 1e-6) {
    volumeRenderingControls.terrainExaggeration = next
  }
})

// 插值开关切换时重建三维体纹理：默认使用与二维 TL 图一致的连续采样；
// 仅在用户主动开启“检查原始节点”时使用严格最近邻。
// 仅重建纹理与几何，不动声线等状态。
watch(
  () => volumeRenderingControls.strictNearest,
  async (strictNearest) => {
    if (!raySourceData.value || !soundField) return
    try {
      const parsed = parseAnalyse3DTlrd(raySourceData.value)
      const texture = decodeTlrdPolarVolume(parsed, {
        sourceLon: Number(calcParams.value.coordX),
        sourceLat: Number(calcParams.value.coordY),
        angleInterp: strictNearest === true ? 1 : TLRD_ANGLE_INTERP,
        strictNearest: strictNearest === true,
      })
      try {
        await maskVolumeByTerrain(texture, viewer?.scene?.terrainProvider)
      } catch (e) {
        console.warn('[三维声场地形掩膜] 地形采样不可用，保留接口海底掩膜：', e?.message ?? e)
      }
      currentVolumeTexture = texture
      terrainTexture.value = texture
      soundField.depthExaggeration = depthExaggeration.value
      soundField.setVolume(texture, (raw) => raw)
      const wedge = texture.wedgeMeta ?? {}
      bounds.value = {
        lon: { min: texture.lonMin, max: texture.lonMax },
        lat: { min: texture.latMin, max: texture.latMax },
        depth: { min: texture.depthMin, max: texture.depthMax },
        value: { min: texture.valueMin, max: texture.valueMax },
      }
      texWidth.value = texture.width
      texHeight.value = texture.height
      texDepth.value = texture.depth
      validVoxelPct.value = ((texture.validVoxelRatio ?? 0) * 100).toFixed(1)
      syncSoundField()
    } catch (e) {
      console.warn('[三维声场严格最近邻] 重建纹理失败：', e?.message ?? e)
    }
  }
)

// 显隐是独立图层状态：不进入 setDisplay，不更新体纹理、几何或相机。
watch(
  () => volumeRenderingControls.volumeVisible,
  (visible) => {
    volumeVisible.value = visible !== false
    applyVolumeVisible(volumeVisible.value)
  },
  { immediate: true }
)

watch(
  () => props.sidebarOpen,
  (open) => {
    if (!open) parameterPanelOpen.value = false
  }
)

// 顶部“运行”：按约定进入三维声场并使用当前默认参数直接提交计算。
let pendingRun = false
function executeRunRequest() {
  if (!pendingRun || !viewerReady.value) return
  pendingRun = false
  const source = props.viewMode === 'terrain' ? { coordX: calcParams.value.coordX, coordY: calcParams.value.coordY } : null
  if (analysisMode.value !== '3d') switchMode('3d')
  if (source) Object.assign(calcParams.value, source)
  parameterPanelOpen.value = false
  resultPanelOpen.value = false
  nextTick(() => {
    if (loading.value) return
    submitCalculation()
  })
}

watch(
  () => props.runToken,
  (token, previous) => {
    if (!token || token === previous) return
    pendingRun = true
    executeRunRequest()
  },
  { immediate: true }
)

let pendingSignalRun = false
function executeSignalRunRequest() {
  if (!pendingSignalRun || !viewerReady.value) return
  pendingSignalRun = false
  nextTick(() => runSignalTransmission())
}

watch(
  () => props.signalRunToken,
  (token, previous) => {
    if (!token || token === previous) return
    pendingSignalRun = true
    executeSignalRunRequest()
  },
  { immediate: true },
)

watch(
  () => props.signalStopToken,
  (token, previous) => {
    if (!token || token === previous) return
    stopSignalTransmission()
  }
)

watch(viewerReady, (ready) => {
  if (ready) {
    executeRunRequest()
    executeSignalRunRequest()
  }
})

// 从地形预览返回全球视图时恢复画布尺寸并触发一次重绘。
watch(
  () => props.viewMode,
  (mode, previousMode) => {
    if (mode === 'terrain') {
      // 过渡途中重新进入地形时取消尚未完成的全球缩放，避免视口被淡出。
      clearTimeout(terrainLeaveTimer)
      terrainLeaveTimer = 0
      clearTerrainReturn()
      if (terrainLeaving.value) {
        try { viewer?.camera?.cancelFlight?.() } catch {}
        setTerrainWheelBlocker(false)
        terrainLeaving.value = false
      }
      // 从全球干净视图返回时恢复声线显隐：离开时被强制隐藏，否则地形上的
      // 声场体动态声线不会再出现（垂直切面由独立渲染器绘制，故仍可见）。
      if (earthRaysVisibleBeforeGlobe !== null) {
        earthRaysVisible.value = earthRaysVisibleBeforeGlobe
        earthRaysVisibleBeforeGlobe = null
      }
      soundField?.releaseRenderer()
      for (const layer of runHistoryLayers.value) layer.renderer?.releaseRenderer?.()
      stopVolumeRayAnimation()
      // 区域 Canvas 地形不消费 Cesium 声线散点；这些逐点对象远大于原始轨迹。
      soundField?.setScatterPoints([])
      rayCount.value = 0
      return
    }
    if (!viewer || viewer.isDestroyed?.()) return
    const directTerrainExit = previousMode === 'terrain' && !terrainLeaving.value
    if (directTerrainExit && !cleanGlobeView.value) {
      // 侧栏“全球视图”与滚轮缩出使用同一干净全球状态；全球端渲染资源保持释放，
      // 避免切换瞬间重建三维纹理、历史声场和声线对象。
      enterCleanGlobeView({ skipRendererSync: true })
    }
    nextTick(() => {
      // 地形→全球的过渡已在起飞前 resize；避免动画开始后再次 resize 造成顿挫。
      if (!terrainLeaving.value && typeof viewer.resize === 'function') viewer.resize()
      // 回到“干净全球视图”时三维体/声线仍处于隐藏状态，无需立即重建
      // GPU 纹理与 primitive；等用户重新计算或打开结果时再同步，避免切换卡顿。
      if (!cleanGlobeView.value) {
        onDepthExagChange()
        refreshVolumeRayScatterPoints()
        syncSoundField()
        setupAzimuthPointer()
        startVolumeRayAnimation()
      }
      if (directTerrainExit && props.viewMode === 'globe') clearTerrainReturn()
      viewer.scene?.requestRender?.()
    })
  }
)

// 切换静态 / 动态声线接口后清空旧缓存；三维结果按当前方位重新获取声线。
watch(
  () => calcParams.value.rayInterface,
  () => {
    if (restoringSoundResult) return
    rayDataByAzimuth.clear()
    ray3dByAzimuth.static.clear()
    ray3dByAzimuth.dynamic.clear()
    ray3dRequest = null
    ray3dToken++
    staticRayData.value = null
    stopVolumeRayAnimation()
    rayLoadToken++
    clearTimeout(rayLoadTimer)
    rayLoadTimer = 0
    if (dynamicRaysActivated.value && analysisMode.value === '3d' && raySourceData.value) {
      scheduleRayDataForAzimuth(sliceAzimuthDeg.value, 0)
    } else if (verticalSliceControls.dynamicRays || verticalSliceControls.staticRays) {
      requestRayDataForPlayback()
    }
  }
)

// 冰区 / 非冰区切换后，三维动态声线需要按对应门户重新获取。
watch(
  () => calcParams.value.regionType,
  () => {
    if (loading.value || restoringSoundResult) return
    ray3dByAzimuth.static.clear()
    ray3dByAzimuth.dynamic.clear()
    ray3dRequest = null
    ray3dToken++
    staticRayData.value = null
    stopVolumeRayAnimation()
    if (dynamicRaysActivated.value && analysisMode.value === '3d' && raySourceData.value) {
      scheduleRayDataForAzimuth(sliceAzimuthDeg.value, 0)
    } else if (verticalSliceControls.dynamicRays || verticalSliceControls.staticRays) {
      requestRayDataForPlayback()
    }
  }
)

/** 结果窗口「返回计算」：收起结果，回到参数配置页。 */
function backToConfig() {
  receiverPlacementEnabled.value = false
  resultPanelOpen.value = false
  parameterPanelOpen.value = true
}

function restoreResultPanel() {
  receiverPlacementEnabled.value = false
  parameterPanelOpen.value = false
  resultPanelOpen.value = true
}

/** 旧结果或首次展示时，用当前接收点参数补一个可拖动的接收阵标记。 */
function ensureReceiverMarker() {
  if (receiverArrayMarker.value) return
  if (analysisMode.value !== '2d' || !raySourceData.value) return
  receiverArrayMarker.value = {
    lon: Number(calcParams.value.receiverX),
    lat: Number(calcParams.value.receiverY),
    depthM: Number(noiseParams.value.depth),
    rangeM: Math.max(0, Number(routeDistanceNm.value) * 1852),
    bearingDeg: Number(routeBearingDeg.value),
  }
}

function toggleReceiverPlacement() {
  receiverPlacementEnabled.value = !receiverPlacementEnabled.value
  statusText.value = receiverPlacementEnabled.value
    ? '请在距离–深度 TL 图中单击接收阵中心位置'
    : ''
}

function onReceiverArraySelected(point) {
  const rangeM = Number(point?.rangeM)
  const depthM = Number(point?.depthM)
  if (!Number.isFinite(rangeM) || !Number.isFinite(depthM)) return
  const destination = destinationLonLat(
    Number(calcParams.value.coordX),
    Number(calcParams.value.coordY),
    routeBearingDeg.value,
    rangeM
  )
  const receiver = {
    lon: Number(destination.lon.toFixed(6)),
    lat: Number(destination.lat.toFixed(6)),
    depthM: Number(depthM.toFixed(2)),
    rangeM: Number(rangeM.toFixed(2)),
    bearingDeg: Number(routeBearingDeg.value.toFixed(3)),
  }
  receiverArrayMarker.value = receiver
  calcParams.value.receiverX = receiver.lon
  calcParams.value.receiverY = receiver.lat
  annotatePropagationReceiver(receiver)
  syncEnvironmentNoiseReceiver(receiver)
  receiverPlacementEnabled.value = false
  statusText.value = `接收阵中心已标注：${(rangeM / 1000).toFixed(2)} km，深度 ${depthM.toFixed(1)} m；切换到水声通信可直接计算静态信道。`
}

/** 单航迹点静态信道：把垂直切面的距离/深度换算成水听器经纬度并同步到完整链路。 */
function onSignalSliceReceiverSelected(point) {
  if (!sliceReceiverPlacementActive.value) return
  const source = configuredSignalRoutePoints.value[0]
  const sourceLon = Number(source?.lon)
  const sourceLat = Number(source?.lat)
  const rangeM = Number(point?.rangeM)
  const depthM = Number(point?.depthM)
  const internalAzimuth = Number(point?.azimuthDeg ?? profileAzimuthDeg.value)
  if (![sourceLon, sourceLat, rangeM, depthM, internalAzimuth].every(Number.isFinite)) return
  const bearingDeg = internalAzimuthToCompassBearing(internalAzimuth)
  const destination = destinationLonLat(sourceLon, sourceLat, bearingDeg, rangeM)
  const receiver = {
    lon: Number(destination.lon.toFixed(6)),
    lat: Number(destination.lat.toFixed(6)),
    depthM: Number(Math.max(0.01, depthM).toFixed(2)),
    rangeM: Number(Math.max(0, rangeM).toFixed(2)),
    bearingDeg: Number(bearingDeg.toFixed(3)),
  }
  receiverArrayMarker.value = receiver
  hydrophonePlaced.value = true
  signalTransmissionControls.receiverDepthM = receiver.depthM
  calcParams.value.receiverX = receiver.lon
  calcParams.value.receiverY = receiver.lat
  annotatePropagationReceiver(receiver)
  syncEnvironmentNoiseReceiver(receiver)
  refreshPickMarkers()
  viewer?.scene?.requestRender?.()
  syncHydrophonePreviewPlayback()
  errorText.value = ''
}

function cloneNoiseParameters(source) {
  return JSON.parse(JSON.stringify(source))
}

function invalidateEnvironmentNoiseLink() {
  clearEnvironmentNoise()
  noiseResultOutdated.value = Boolean(noiseResult.value)
}

function syncEnvironmentNoiseReceiver(receiver) {
  if (!receiver) return
  const nextLon = Number(receiver.lon)
  const nextLat = Number(receiver.lat)
  const nextDepth = Number(receiver.depthM)
  const changed = Math.abs(Number(noiseParams.value.receiverX) - nextLon) > 1e-7
    || Math.abs(Number(noiseParams.value.receiverY) - nextLat) > 1e-7
    || (Number.isFinite(nextDepth) && Math.abs(Number(noiseParams.value.depth) - nextDepth) > 1e-4)
  noiseParams.value.receiverX = nextLon
  noiseParams.value.receiverY = nextLat
  if (Number.isFinite(nextDepth) && nextDepth > 0) noiseParams.value.depth = nextDepth
  if (changed) invalidateEnvironmentNoiseLink()
}

function resetParameters() {
  calcParams.value = {
    dataset: 'HYCOM',
    time: timeOptions.value[0] || '2025-01-02T12:00:00',
    regionType: 'normal',
    coordX: 40,
    coordY: 75,
    receiverX: 40.68,
    receiverY: 75,
    srcDepth: 150,
    grazingAngleMin: -45,
    grazingAngleMax: 45,
    range: 39.6,
    minFreq: 100,
    maxFreq: 100,
    model: 'bellhop',
    sector: 4,
    azimuth: 0,
    lineCount: 10,
    rayInterface: 'dynamic',
    coherent: false,
  }
  activeMapPick.value = ''
}

function toggleMapPick(kind) {
  activeMapPick.value = activeMapPick.value === kind ? '' : kind
  refreshPickMarkers()
}

/* ── 声源点 / 接收点标定标识：点击后在地球上保留彩色点，便于回看位置 ── */
let sourcePickMarker = null
let receiverPickMarker = null

function removePickMarker(kind) {
  const marker = kind === 'source' ? sourcePickMarker : receiverPickMarker
  if (marker && viewer?.features) {
    try {
      viewer.features.remove(marker)
    } catch {}
  }
  if (kind === 'source') sourcePickMarker = null
  else receiverPickMarker = null
}

function upsertPickMarker(kind, lon, lat, color) {
  if (!viewer?.features) return
  removePickMarker(kind)
  const marker = new Cesium.Point([Number(lon), Number(lat), 360], {
    color: Cesium.Color.fromCssColorString(color),
    pixelSize: 15,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 2.5,
  })
  try {
    const added = marker.addTo(viewer.features)
    const ref = added || marker
    if (kind === 'source') sourcePickMarker = ref
    else receiverPickMarker = ref
  } catch (err) {
    console.warn('[点位标注] 添加失败：', err?.message ?? err)
  }
}

/** 按当前参数与交互状态刷新声源 / 接收点标识（配置或取点状态下常显） */
function refreshPickMarkers() {
  if (!viewer?.features) return
  // 环境噪声只标注接收点，不显示声源点。
  if (isNoiseMode.value) {
    const showNoise = hydrophonePlaced.value
      ? !signalTransmissionControls.showReceiver
      : (
        signalTransmissionControls.showReceiver || parameterPanelOpen.value ||
        resultPanelOpen.value || activeMapPick.value === 'receiver'
      )
    const nx = Number(noiseParams.value.receiverX)
    const ny = Number(noiseParams.value.receiverY)
    removePickMarker('source')
    if (showNoise && Number.isFinite(nx) && Number.isFinite(ny)) {
      upsertPickMarker('receiver', nx, ny, '#49e68b')
    } else {
      removePickMarker('receiver')
    }
    viewer.scene?.requestRender?.()
    return
  }
  // 二维结果已在地球上绘制了自身的声源 / 接收端点，配置面板再叠加取点标识会变成
  // 两组共四个点，因此有二维结果时不再重复绘制取点标识。
  const has2dResult = analysisMode.value === '2d' && !!raySourceData.value
  const show = (parameterPanelOpen.value || !!activeMapPick.value) && !has2dResult
  const sx = Number(calcParams.value.coordX)
  const sy = Number(calcParams.value.coordY)
  if (show && Number.isFinite(sx) && Number.isFinite(sy)) upsertPickMarker('source', sx, sy, '#ff5757')
  else removePickMarker('source')

  const rx = Number(calcParams.value.receiverX)
  const ry = Number(calcParams.value.receiverY)
  const showReceiver = !has2dResult && (
    hydrophonePlaced.value
      ? !signalTransmissionControls.showReceiver
      : (signalTransmissionControls.showReceiver || (show && analysisMode.value === '2d'))
  )
  if (showReceiver && Number.isFinite(rx) && Number.isFinite(ry)) {
    upsertPickMarker('receiver', rx, ry, '#49e68b')
  } else {
    removePickMarker('receiver')
  }
  viewer.scene?.requestRender?.()
}

function ensureDefaultHydrophoneMarker() {
  if (hydrophonePlaced.value || receiverArrayMarker.value) return
  const source = isNoiseMode.value ? noiseParams.value : calcParams.value
  const lon = Number(source.receiverX)
  const lat = Number(source.receiverY)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
  const depth = Number(noiseParams.value.depth)
  receiverArrayMarker.value = {
    lon,
    lat,
    depthM: Number.isFinite(depth) ? Math.max(0, depth) : 30,
    rangeM: Math.max(0, Number(routeDistanceNm.value) * 1852),
    bearingDeg: Number(routeBearingDeg.value) || 0,
  }
}

function applyHydrophoneLocation(lon, lat) {  const nextLon = Number(lon)
  const nextLat = Number(lat)
  if (!Number.isFinite(nextLon) || !Number.isFinite(nextLat)) return false
  if (isNoiseMode.value) {
    noiseParams.value.receiverX = Number(nextLon.toFixed(4))
    noiseParams.value.receiverY = Number(nextLat.toFixed(4))
    invalidateEnvironmentNoiseLink()
  } else {
    calcParams.value.receiverX = Number(nextLon.toFixed(4))
    calcParams.value.receiverY = Number(nextLat.toFixed(4))
  }
  const depth = Number(noiseParams.value.depth)
  receiverArrayMarker.value = {
    lon: Number(nextLon.toFixed(6)),
    lat: Number(nextLat.toFixed(6)),
    depthM: Number.isFinite(depth) ? Math.max(0, depth) : 30,
    rangeM: Math.max(0, Number(routeDistanceNm.value) * 1852),
    bearingDeg: Number(routeBearingDeg.value) || 0,
  }
  hydrophonePlaced.value = true
  refreshPickMarkers()
  viewer?.scene?.requestRender?.()
  return true
}

function pickHydrophoneLocation(point) {
  if (!signalTransmissionControls.showReceiver || !point) return
  if (Number(point.elevation) >= 0) return
  if (applyHydrophoneLocation(point.lon ?? point.longitude, point.lat ?? point.latitude)) {
    signalTransmissionControls.showReceiver = false
  }
}

/* ── 航迹点选择：全球视图在海洋区域单击落点，双击结束 ── */
const TRACK_POINT_ALTITUDE_M = 320
let trackPointFeatures = []

function clearTrackPointFeatures() {
  if (viewer?.features) {
    for (const feature of trackPointFeatures) {
      try { viewer.features.remove(feature) } catch {}
    }
  }
  trackPointFeatures = []
}

function addTrackPointFeature(feature) {
  if (!feature || !viewer?.features) return
  try { trackPointFeatures.push(feature.addTo(viewer.features) || feature) } catch {}
}

function renderTrackPointFeatures() {
  if (!viewer?.features) return
  clearTrackPointFeatures()
  // 选中 AIS 船舶时自动生成的 1 海里信号航线只参与计算，不在地球上显示航迹点/航线。
  if (selectedAisVessel.value) {
    viewer.scene?.requestRender?.()
    return
  }
  const points = configuredSignalRoutePoints.value
  if (!points.length) {
    viewer.scene?.requestRender?.()
    return
  }
  const color = Cesium.Color.fromCssColorString('#38d6ff')
  for (const point of points) {
    addTrackPointFeature(new Cesium.Point(
      [point.lon, point.lat, TRACK_POINT_ALTITUDE_M],
      {
        color,
        pixelSize: 12,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      }
    ))
  }
  if (points.length >= 2) {
    addTrackPointFeature(new Cesium.Polyline(
      points.map((point) => [point.lon, point.lat, TRACK_POINT_ALTITUDE_M]),
      {
        colors: [color.withAlpha(0.92)],
        width: 3,
        followSurface: false,
        onTerrain: false,
      }
    ))
  }
  viewer.scene?.requestRender?.()
}

watch(
  () => signalTransmissionControls.selectTrackPoints,
  (enabled) => {
    if (enabled && !selectedAisVessel.value) resetTrackPoints()
    else if (!trackPointState.finished) clearTrackPoints()
    renderTrackPointFeatures()
  }
)

watch(
  () => [selectedAisVessel.value?.mmsi, selectedAisVessel.value?.longitude, selectedAisVessel.value?.latitude,
    selectedAisVessel.value?.cog_deg, selectedAisVessel.value?.heading_deg],
  () => {
    signalTransmissionControls.selectTrackPoints = false
    renderTrackPointFeatures()
    syncHydrophonePreviewPlayback()
  },
)

watch(
  () => signalTransmissionControls.showTimeFrequency,
  (visible) => {
    if (!visible) {
      vesselSpectrogramMinimized.value = false
      removeTerrainWindowFromDock('spectrogram')
    }
    syncHydrophonePreviewPlayback()
  },
)

watch(
  () => signalTransmissionControls.showWaveform,
  (visible) => {
    if (!visible) {
      vesselWaveformMinimized.value = false
      removeTerrainWindowFromDock('waveform')
    }
    syncHydrophonePreviewPlayback()
  },
)

watch(
  () => signalTransmissionControls.showSourceTimeFrequency,
  (visible) => {
    if (visible) {
      sourceSpectrogramMinimized.value = false
      removeTerrainWindowFromDock('source-spectrogram')
    } else {
      sourceSpectrogramMinimized.value = false
      removeTerrainWindowFromDock('source-spectrogram')
    }
    syncHydrophonePreviewPlayback()
  },
)

watch(
  () => signalTransmissionControls.showSourceWaveform,
  (visible) => {
    if (visible) {
      sourceWaveformMinimized.value = false
      removeTerrainWindowFromDock('source-waveform')
    } else {
      sourceWaveformMinimized.value = false
      removeTerrainWindowFromDock('source-waveform')
    }
    syncHydrophonePreviewPlayback()
  },
)

watch(
  () => signalTransmissionControls.simulationDurationS,
  () => syncHydrophonePreviewPlayback(),
)

watch(hydrophoneReceiverReady, (ready) => {
  signalTransmissionControls.receiverReady = Boolean(ready)
  if (!ready) {
    signalTransmissionControls.showTimeFrequency = false
    signalTransmissionControls.showWaveform = false
  }
  syncHydrophonePreviewPlayback()
}, { immediate: true })

watch(() => trackPointState.revision, () => {
  renderTrackPointFeatures()
  if (!configuredSignalRouteReady.value) {
    signalTransmissionControls.showSourceTimeFrequency = false
    signalTransmissionControls.showSourceWaveform = false
  }
  syncHydrophonePreviewPlayback()
})

watch(() => trackFieldRunState.requestToken, () => {
  void runTrackPointFields()
})

async function runSignalTransmission() {
  skipVesselSimulationOnce = false
  normalizeSignalTransmissionControls(signalTransmissionControls)
  if (!configuredSignalRouteReady.value) {
    if (selectedAisVessel.value) {
      errorText.value = '所选 AIS 船舶缺少有效位置或航向，无法生成 1 海里自动航迹。'
      return false
    }
    errorText.value = '请在地形区域单击至少一个发射航迹点，并双击结束选择。双击位置不会计入航迹。'
    return false
  }
  if (!hydrophoneReceiverReady.value) {
    errorText.value = '请先打开“接收位置”，在海域选择水听器位置后再运行完整传输链路。'
    return false
  }
  const receiver = receiverArrayMarker.value
  const routePoints = configuredSignalRoutePoints.value
  if (!selectedAisVessel.value) {
    const missingFields = routePoints
      .map((point, index) => reusableTrackFieldLayer(point, index) ? -1 : index + 1)
      .filter(index => index > 0)
    if (missingFields.length) {
      errorText.value = `航迹点 ${missingFields.join('、')} 尚无可复用声场，请先完成“航线声场计算”。`
      return false
    }
  }
  const sourceLon = Number(routePoints[0]?.lon)
  const sourceLat = Number(routePoints[0]?.lat)
  const receiverLon = Number(receiver.lon)
  const receiverLat = Number(receiver.lat)
  if (![sourceLon, sourceLat, receiverLon, receiverLat].every(Number.isFinite)) {
    errorText.value = '发射位置或水听器位置无效。'
    return false
  }
  const sourceProfile = liveSignalSourceProfile.value
  const sourceDepth = Math.max(0.01, Number(sourceProfile.sourceDepthM) || Number(signalTransmissionControls.navigationDepthM) || Number(calcParams.value.srcDepth) || 1)
  const speedKn = configuredSignalSpeedKn.value
  if (!(speedKn > 0)) {
    errorText.value = selectedAisVessel.value
      ? '所选 AIS 船舶缺少有效航速，无法按原航速生成航迹。'
      : '请填写有效的手动船舶航速。'
    return false
  }
  const receiverDepth = Math.max(0.01, Number(signalTransmissionControls.receiverDepthM) || Number(receiver.depthM) || 30)
  const waterDepth = Math.max(1000, sourceDepth + 100, receiverDepth + 100)
  const depression = Math.min(90, Math.abs(Number(calcParams.value.grazingAngleMin) || 45))
  const elevation = Math.min(90, Math.abs(Number(calcParams.value.grazingAngleMax) || 45))
  const requestId = `signal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  errorText.value = ''
  parameterPanelOpen.value = false
  receiverArrayMarker.value = { ...receiver, depthM: receiverDepth }
  const sourceBands = [...sourceProfile.frequenciesHz]
    .map((frequency, index) => ({
      frequency: Number(frequency),
      level: Number(sourceProfile.bandLevelsDb?.[index]),
    }))
    .filter(item => Number.isFinite(item.frequency) && item.frequency > 0
      && item.frequency < signalTransmissionControls.sampleRate / 2
      && Number.isFinite(item.level))
  const signalRequest = {
    channel_mode: 'waypoint',
    waypoint_spacing_m: SIGNAL_ARRIVAL_WAYPOINT_SPACING_M,
    vessel_speed_kn: speedKn,
    request_id: requestId,
    frequencies_hz: sourceBands.map(item => item.frequency),
    source_band_levels_db: sourceBands.map(item => item.level),
    source_level_db: sourceProfile.broadbandSourceLevelDb,
    sample_rate: signalTransmissionControls.sampleRate,
    // 固定声源时长；移动源由后端按完整航迹、航速确定发射时长。
    duration_s: Math.min(
      signalTransmissionControls.simulationDurationS,
      2400000 / signalTransmissionControls.sampleRate,
    ),
    source_lon: sourceLon,
    source_lat: sourceLat,
    source_depth_m: sourceDepth,
    // 提交整条航迹；后端到达结构保持 50 m Waypoint 精度。
    source_route: routePoints.map(point => ({ lon: Number(point.lon), lat: Number(point.lat), depth_m: sourceDepth })),
    receiver_lon: receiverLon,
    receiver_lat: receiverLat,
    receiver_depth_m: receiverDepth,
    water_depth_m: waterDepth,
    depression_angle_deg: depression,
    elevation_angle_deg: elevation,
    // 到达结构固定使用 Bellhop；三维声场模型由 simulationControls.model 控制。
    propagation_model: 'bellhop',
    arrival_beam_count: signalTransmissionControls.arrivalBeamCount,
    surface_echo: signalTransmissionControls.surfaceEcho,
    bottom_echo: signalTransmissionControls.bottomEcho,
    noise_enabled: true,
    // AIS、气象和 Wenz 频谱均由链路后端获取并合成，前端只显示返回波形与时频图。
    noise_model: 'wenz',
    hydrophone: signalTransmissionControls.hydrophone,
    preamp_gain_db: signalTransmissionControls.preampGainDb,
    adc_bits: signalTransmissionControls.adcBits,
    adc_full_scale_v: signalTransmissionControls.adcFullScaleV,
    dataSource: 'HYCOM',
    dataType: 'DT_ENV_SOUND',
    time: calcParams.value.time,
    timeRes: 0,
  }
  lastSignalRequest = cloneWorkspacePlain(signalRequest)
  runSignalTransmissionSession(signalRequest)
  lastSignalFieldRequestId = requestId
  void startSignalRouteFieldPlayback({ request_id: requestId })
  return true
}

/** 停止完整传输链路：取消后续计算，并让船舶冻结在最后完成的声场站位。 */
function stopSignalTransmission() {
  stopSignalTransmissionSession({ preserveResult: true })
  signalTransmissionSession.playbackActive = false
  // 下一次普通运行不应因残留的航迹点重新进入船舶航迹仿真。
  skipVesselSimulationOnce = true
  vesselPlaybackPlaying.value = false
  vesselPlaybackBusy.value = false
  vesselPlaybackGeneration += 1
  vesselFieldRequests.clear()
  if (vesselPlaybackRaf) cancelAnimationFrame(vesselPlaybackRaf)
  vesselPlaybackRaf = 0
  vesselPlaybackLastFrameAt = 0
  if (vesselPlaybackOpen.value && vesselRouteSamples.value.length) {
    const frozenIndex = Math.max(0, Math.min(
      vesselRouteSamples.value.length - 1,
      vesselAppliedSampleIndex.value,
    ))
    vesselPlaybackSampleIndex.value = frozenIndex
    const sample = vesselRouteSamples.value[frozenIndex]
    const totalDistance = Number(vesselRouteSamples.value.at(-1)?.distanceM) || 0
    if (sample && totalDistance > 0) {
      vesselPlaybackTimeS.value = vesselPlaybackPreRollS.value
        + vesselRouteDurationS.value * (Number(sample.distanceM) || 0) / totalDistance
    }
    vesselPlaybackStatus.value = `已停止 · 船舶停在站位 ${frozenIndex + 1}/${vesselRouteSamples.value.length}`
  }
  errorText.value = ''
}

function validateVesselSimulationSelections() {
  if (!hydrophoneReceiverReady.value) return '请先打开“接收位置”并在海域选择水听器位置。'
  if (trackPointState.points.length < 2 || !trackPointState.finished) return '请至少选择两个航迹点，并双击结束航迹选择。'
  if (!selectedAisVessel.value && !(Number(signalTransmissionControls.vesselSpeedKn) > 0)) {
    return '未选择 AIS 船舶时，请先填写有效的手动船舶航速。'
  }
  if (selectedAisVessel.value && !(Number(selectedAisVessel.value.sog_kn) > 0)) {
    return '所选 AIS 船舶缺少有效航速，请选择有航速数据的船舶，或取消选择后手动填写。'
  }
  return ''
}

function syncHydrophonePreviewPlayback() {
  if (vesselPlaybackOpen.value) return
  const receiverVisible = hydrophoneReceiverReady.value && (
    signalTransmissionControls.showTimeFrequency || signalTransmissionControls.showWaveform
  )
  const sourceVisible = configuredSignalRouteReady.value && (
    signalTransmissionControls.showSourceTimeFrequency || signalTransmissionControls.showSourceWaveform
  )
  const visible = receiverVisible || sourceVisible
  const windowDurationS = Math.max(1, Number(signalTransmissionControls.simulationDurationS) || 30)
  const playbackDurationS = sourceVisible
    ? previewSignalRouteDurationS.value
    : REALTIME_PREVIEW_DURATION_S
  vesselTimeFrequencyWindowS.value = windowDurationS
  vesselPlaybackDurationS.value = playbackDurationS
  vesselRouteDurationS.value = playbackDurationS
  vesselPlaybackPreRollS.value = 0
  if (!visible) {
    vesselPlaybackPlaying.value = false
    if (vesselPlaybackRaf) cancelAnimationFrame(vesselPlaybackRaf)
    vesselPlaybackRaf = 0
    vesselPlaybackLastFrameAt = 0
    return
  }
  if (vesselPlaybackTimeS.value >= playbackDurationS) vesselPlaybackTimeS.value = 0
  vesselPlaybackPlaying.value = true
  vesselPlaybackLastFrameAt = 0
  ensureVesselPlaybackClock()
}

function setVesselPlaybackTime(value) {
  const available = signalPlaybackMode.value
    ? Number(signalTransmissionSession.result?.available_until_s) || 0
    : hydrophoneDisplayDurationS.value
  const availableFrom = signalPlaybackMode.value ? Number(signalTransmissionSession.result?.available_from_s) || 0 : 0
  const next = Math.max(availableFrom, Math.min(hydrophoneDisplayDurationS.value, available, Number(value) || 0))
  vesselPlaybackTimeS.value = next
  if (signalPlaybackMode.value) signalTransmissionSession.playbackTimeS = next
  const nextWindowStart = next <= vesselTimeFrequencyWindowS.value
    ? 0
    : Math.floor((next - vesselTimeFrequencyWindowS.value) * 2) / 2
  if (Math.abs(nextWindowStart - vesselSpectrogramWindowStartS.value) >= 0.49) {
    vesselSpectrogramWindowStartS.value = nextWindowStart
  }
  if (!vesselPlaybackOpen.value) return
  const routeTimeS = Math.max(0, next - vesselPlaybackPreRollS.value)
  const index = routeSampleIndexAtTime(vesselRouteSamples.value, routeTimeS, vesselRouteDurationS.value)
  if (index >= 0 && index !== vesselPlaybackSampleIndex.value) void activateVesselRouteSample(index)
  if (!vesselPlaybackBusy.value && !vesselPlaybackError.value) {
    vesselPlaybackStatus.value = next < vesselPlaybackPreRollS.value
      ? `环境噪声预播放 · ${Math.ceil(vesselPlaybackPreRollS.value - next)} s 后船舶开始运动`
      : `${signalPlaybackMode.value ? 'Waypoint' : '分钟站位'} ${index + 1}/${vesselRouteSamples.value.length}`
  }
}

function vesselPlaybackFrame(timestamp) {
  if (!hydrophonePlaybackPanelActive.value) {
    vesselPlaybackRaf = 0
    return
  }
  if (vesselPlaybackPlaying.value) {
    if (!vesselPlaybackLastFrameAt) vesselPlaybackLastFrameAt = timestamp
    const deltaS = Math.max(0, Math.min(0.25, (timestamp - vesselPlaybackLastFrameAt) / 1000))
    const next = vesselPlaybackTimeS.value + deltaS * vesselPlaybackRate.value
    if (next >= hydrophoneDisplayDurationS.value) {
      if (vesselPlaybackOpen.value) {
        setVesselPlaybackTime(hydrophoneDisplayDurationS.value)
        vesselPlaybackPlaying.value = false
      } else {
        setVesselPlaybackTime(0)
      }
    } else {
      setVesselPlaybackTime(next)
    }
  }
  vesselPlaybackLastFrameAt = timestamp
  vesselPlaybackRaf = requestAnimationFrame(vesselPlaybackFrame)
}

function ensureVesselPlaybackClock() {
  if (!vesselPlaybackRaf && hydrophonePlaybackPanelActive.value) {
    vesselPlaybackLastFrameAt = 0
    vesselPlaybackRaf = requestAnimationFrame(vesselPlaybackFrame)
  }
}

function setVesselPlaybackPlaying(value) {
  if (!hydrophonePlaybackPanelActive.value) return
  if (value && vesselPlaybackTimeS.value >= hydrophoneDisplayDurationS.value) setVesselPlaybackTime(0)
  vesselPlaybackPlaying.value = Boolean(value)
  vesselPlaybackLastFrameAt = 0
  ensureVesselPlaybackClock()
}

function closeVesselPlayback(resumePreview = true) {
  const wasOpen = vesselPlaybackOpen.value
  vesselPlaybackPlaying.value = false
  vesselPlaybackOpen.value = false
  routePlaybackKind.value = 'preview'
  signalTransmissionSession.playbackActive = false
  vesselWaveformMinimized.value = false
  vesselSpectrogramMinimized.value = false
  sourceWaveformMinimized.value = false
  sourceSpectrogramMinimized.value = false
  removeTerrainWindowFromDock('waveform')
  removeTerrainWindowFromDock('spectrogram')
  removeTerrainWindowFromDock('source-waveform')
  removeTerrainWindowFromDock('source-spectrogram')
  vesselPlaybackStatus.value = ''
  vesselPlaybackError.value = ''
  vesselPlaybackGeneration += 1
  if (vesselPlaybackRaf) cancelAnimationFrame(vesselPlaybackRaf)
  vesselPlaybackRaf = 0
  vesselPlaybackLastFrameAt = 0
  if (wasOpen) terrainSliceOpen.value = false
  if (resumePreview) syncHydrophonePreviewPlayback()
}

async function calculateVesselFieldSample(index, generation = vesselPlaybackGeneration) {
  const sample = vesselRouteSamples.value[index]
  const receiver = receiverArrayMarker.value
  if (!sample || !receiver) throw new Error('航迹站位或接收位置不可用。')
  const distanceM = greatCircleDistanceM(sample, receiver)
  const bearingDeg = initialBearingDeg(sample, receiver)
  const rangeNm = Math.max(Number(calcParams.value.range) || 1, distanceM / 1852 * 1.08 + 0.1)
  const frequencyHz = vesselPlaybackReferenceFrequencyHz.value
  const sourceParams = {
    ...calcParams.value,
    coordX: sample.lon,
    coordY: sample.lat,
    srcDepth: vesselPlaybackSpectrum.value?.sourceDepthM || 6,
    minFreq: frequencyHz,
    maxFreq: frequencyHz,
  }
  const payload = portalParamsFor(sourceParams, {
    range: rangeNm,
    sector: 24,
  })
  const ice = calcParams.value.regionType === 'ice'
  const model = vesselPlaybackModel.value
  const response = await analyse3dTLRDByModel(payload, model, ice)
  if (generation !== vesselPlaybackGeneration) throw new Error('本次播放任务已取消。')
  const parsed = parseAnalyse3DTlrd(response)
  const strictNearest = volumeRenderingControls.strictNearest === true
  const texture = decodeTlrdPolarVolume(parsed, {
    sourceLon: sample.lon,
    sourceLat: sample.lat,
    angleInterp: strictNearest ? 1 : TLRD_ANGLE_INTERP,
    strictNearest,
  })
  try {
    await maskVolumeByTerrain(texture, viewer?.scene?.terrainProvider)
  } catch (error) {
    console.warn('[船舶噪声声场] 地形掩膜不可用，保留接口海底掩膜：', error?.message ?? error)
  }
  const receiverTl = sampleReceiverTlDb(parsed, {
    bearingDeg,
    distanceM,
    depthM: receiver.depthM,
  })
  return {
    index,
    sample,
    parsed,
    texture,
    receiverTl,
    distanceM,
    bearingDeg,
    rangeNm,
    frequencyHz,
    model,
  }
}

function rememberVesselReceiverResult(record) {
  const losses = [...vesselReceiverTlDb.value]
  const distances = [...vesselReceiverDistancesM.value]
  losses[record.index] = record.receiverTl
  distances[record.index] = record.distanceM
  vesselReceiverTlDb.value = losses
  vesselReceiverDistancesM.value = distances
}

function requestVesselFieldSample(index) {
  if (vesselFieldCache.has(index)) return Promise.resolve(vesselFieldCache.get(index))
  if (vesselFieldRequests.has(index)) return vesselFieldRequests.get(index)
  const generation = vesselPlaybackGeneration
  const request = calculateVesselFieldSample(index, generation)
    .then(record => {
      if (generation !== vesselPlaybackGeneration) return null
      vesselFieldCache.set(index, record)
      rememberVesselReceiverResult(record)
      return record
    })
    .finally(() => {
      // 航迹被后端权威 Waypoint 替换时可能立即为同一索引创建新请求；
      // 旧 Promise 完成后不能误删新请求。
      if (vesselFieldRequests.get(index) === request) vesselFieldRequests.delete(index)
    })
  vesselFieldRequests.set(index, request)
  return request
}

function applyVesselFieldRecord(record) {
  if (!record || !viewer) return
  vesselAppliedSampleIndex.value = record.index
  invalidateMovingSourceRayData()
  if (soundField?.loaded) soundField.destroy()
  soundField = new SoundField(viewer, { depthExaggeration: depthExaggeration.value })
  soundField.displayAboveWater = false
  soundField.setVolume(record.texture, raw => raw)
  raySourceData.value = record.parsed
  currentVolumeTexture = record.texture
  terrainTexture.value = record.texture
  volumeData.value = soundField.volume
  availableAzimuths.value = tlrdSectorAzimuths(
    record.parsed.grid.sector,
    record.parsed.grid.compassBearings,
  )
  const directionAzimuth = compassBearingToInternalAzimuth(record.bearingDeg)
  sliceAzimuthDeg.value = nearestAvailableAzimuth(directionAzimuth)
  sourcePoint.value = {
    lon: record.sample.lon,
    lat: record.sample.lat,
    depth_m: vesselPlaybackSpectrum.value?.sourceDepthM || 6,
  }
  sourceRadiusKm.value = record.rangeNm * 1.852
  terrainSource.value = {
    lon: record.sample.lon,
    lat: record.sample.lat,
    depth: vesselPlaybackSpectrum.value?.sourceDepthM || 6,
  }
  terrainRadiusKm.value = sourceRadiusKm.value
  terrainRunVisible.value = true
  receiverArrayMarker.value = {
    ...receiverArrayMarker.value,
    rangeM: record.distanceM,
    bearingDeg: record.bearingDeg,
  }
  calcParams.value.coordX = Number(record.sample.lon.toFixed(6))
  calcParams.value.coordY = Number(record.sample.lat.toFixed(6))
  calcParams.value.srcDepth = vesselPlaybackSpectrum.value?.sourceDepthM || 6
  calcParams.value.minFreq = record.frequencyHz
  calcParams.value.maxFreq = record.frequencyHz
  calcParams.value.range = record.rangeNm
  calcParams.value.model = record.model
  if (routePlaybackKind.value === 'signal' && record.model === 'bellhop') {
    calcParams.value.rayInterface = 'dynamic'
  }
  calculatedSectorCount.value = record.parsed.grid.sector
  texWidth.value = record.texture.width
  texHeight.value = record.texture.height
  texDepth.value = record.texture.depth
  volumeVisible.value = true
  volumeRenderingControls.volumeVisible = true
  cleanGlobeView.value = false
  resultPanelOpen.value = false
  parameterPanelOpen.value = false
  syncSoundField()
  setupAzimuthPointer()
  applyPointerVisibility()
  soundField.requestRender()
  if (
    routePlaybackKind.value === 'signal'
    && record.model === 'bellhop'
    && (verticalSliceControls.dynamicRays || verticalSliceControls.staticRays)
  ) {
    dynamicRaysActivated.value = true
    scheduleRayDataForAzimuth(sliceAzimuthDeg.value, 0)
  }
}

async function activateVesselRouteSample(index) {
  if (!vesselPlaybackOpen.value || index < 0 || index >= vesselRouteSamples.value.length) return
  const stationLabel = signalPlaybackMode.value ? 'Waypoint' : '分钟站位'
  vesselPlaybackSampleIndex.value = index
  vesselPlaybackBusy.value = !vesselFieldCache.has(index)
  vesselPlaybackError.value = ''
  vesselPlaybackStatus.value = vesselPlaybackBusy.value
    ? `计算 ${stationLabel} ${index + 1}/${vesselRouteSamples.value.length}`
    : `${stationLabel} ${index + 1}/${vesselRouteSamples.value.length}`
  try {
    const record = await requestVesselFieldSample(index)
    if (!record || !vesselPlaybackOpen.value || vesselPlaybackSampleIndex.value !== index) return
    applyVesselFieldRecord(record)
    if (routePlaybackKind.value === 'signal') {
      const tlText = Number.isFinite(record.receiverTl) ? `接收点 TL ${record.receiverTl.toFixed(1)} dB` : '3D 声场就绪'
      const fieldSource = record.reusedTrackField ? '复用航迹点声场' : `${record.model.toUpperCase()} 声场`
      vesselPlaybackStatus.value = `Waypoint ${index + 1}/${vesselRouteSamples.value.length} · ${fieldSource} · ${tlText}`
    } else {
      vesselPlaybackStatus.value = `站位 ${index + 1}/${vesselRouteSamples.value.length} · ${record.frequencyHz.toFixed(0)} Hz 代表频率`
    }
    const nextIndex = index + 1
    if (
      nextIndex < vesselRouteSamples.value.length
      && !vesselFieldCache.has(nextIndex)
      && !vesselFieldRequests.has(nextIndex)
    ) {
      void requestVesselFieldSample(nextIndex).catch(error => {
        if (error?.message !== '本次播放任务已取消。') {
          console.warn(`[航迹声场] 预取站位 ${nextIndex + 1} 失败：`, error?.message ?? error)
        }
      })
    }
  } catch (error) {
    if (!vesselPlaybackOpen.value || error?.message === '本次播放任务已取消。') return
    vesselPlaybackError.value = error?.message || String(error)
    vesselPlaybackPlaying.value = false
    if (routePlaybackKind.value === 'signal') {
      signalTransmissionSession.error = `完整传输已完成，但航迹声场显示失败：${vesselPlaybackError.value}`
      signalTransmissionSession.message = '航迹声场计算失败'
    }
  } finally {
    if (vesselPlaybackSampleIndex.value === index) vesselPlaybackBusy.value = false
  }
}

async function startVesselNoiseSimulation() {
  skipVesselSimulationOnce = false
  const selectionError = validateVesselSimulationSelections()
  if (selectionError) {
    errorText.value = selectionError
    return
  }
  const vessel = resolveVesselSimulationProfile(
    selectedAisVessel.value,
    signalTransmissionControls.vesselSpeedKn,
  )
  const speedKn = Number(vessel.sog_kn)
  const selectedModel = ['bellhop', 'ram', 'kraken'].includes(String(simulationControls.model).toLowerCase())
    ? String(simulationControls.model).toLowerCase()
    : 'bellhop'
  const oneMinuteDistanceM = distancePerMinuteM(speedKn)
  const samples = resampleTrackByDistance(trackPointState.points, oneMinuteDistanceM)
  if (samples.length < 2) {
    errorText.value = '所选航迹长度不足，无法生成每分钟声场站位。'
    return
  }
  closeVesselPlayback(false)
  routePlaybackKind.value = 'vessel'
  vesselPlaybackGeneration += 1
  vesselSpectrogramSeed.value = Math.floor(Math.random() * 2_147_483_646) + 1
  vesselFieldCache.clear()
  vesselFieldRequests.clear()
  vesselRouteSamples.value = samples
  vesselPlaybackVessel.value = vessel
  vesselPlaybackModel.value = selectedModel
  vesselPlaybackSpectrum.value = estimateJomopansEchoSpectrum(vesselPlaybackVessel.value)
  vesselReceiverTlDb.value = Array(samples.length).fill(null)
  vesselReceiverDistancesM.value = samples.map(sample => greatCircleDistanceM(sample, receiverArrayMarker.value))
  vesselTimeFrequencyWindowS.value = Math.max(1, Number(signalTransmissionControls.simulationDurationS) || 30)
  vesselPlaybackPreRollS.value = 0
  vesselRouteDurationS.value = Math.max(1, routeDurationSeconds(samples, speedKn))
  vesselPlaybackDurationS.value = vesselRouteDurationS.value
  vesselPlaybackTimeS.value = 0
  vesselSpectrogramWindowStartS.value = 0
  vesselPlaybackSampleIndex.value = 0
  vesselAppliedSampleIndex.value = 0
  vesselPlaybackRate.value = 1
  vesselPlaybackOpen.value = true
  vesselWaveformMinimized.value = false
  vesselSpectrogramMinimized.value = false
  sourceWaveformMinimized.value = false
  sourceSpectrogramMinimized.value = false
  vesselPlaybackPlaying.value = false
  vesselPlaybackBusy.value = true
  vesselPlaybackError.value = ''
  signalTransmissionControls.showTimeFrequency = true
  removeTerrainWindowFromDock('waveform')
  removeTerrainWindowFromDock('spectrogram')
  removeTerrainWindowFromDock('source-waveform')
  removeTerrainWindowFromDock('source-spectrogram')
  signalTransmissionControls.sourceLevelDb = Number(vesselPlaybackSpectrum.value.broadbandSourceLevelDb.toFixed(1))
  volumeRenderingControls.colormap = 'jet'
  terrainSliceOpen.value = true
  terrainSliceMinimized.value = false
  removeTerrainWindowFromDock('slice')
  analysisMode.value = '3d'
  calcParams.value.model = selectedModel
  calcParams.value.sector = 24
  calcParams.value.srcDepth = vesselPlaybackSpectrum.value.sourceDepthM
  errorText.value = ''
  runtimeError.value = ''
  void setWeatherNoisePoint({
    lon: receiverArrayMarker.value.lon,
    lat: receiverArrayMarker.value.lat,
    elevation: -Math.abs(Number(receiverArrayMarker.value.depthM) || 30),
  })
  ensureVesselPlaybackClock()
  await activateVesselRouteSample(0)
  if (vesselPlaybackOpen.value && !vesselPlaybackError.value) setVesselPlaybackPlaying(true)
}

/** 保留用户选择的航迹点，只补充播放时按路程定位所需的累计距离。 */
function routeWaypointSamples(points) {
  let distanceM = 0
  return (Array.isArray(points) ? points : []).map((point, index, source) => {
    if (index > 0) distanceM += greatCircleDistanceM(source[index - 1], point)
    return {
      ...point,
      lon: Number(point?.lon),
      lat: Number(point?.lat),
      distanceM,
    }
  })
}

/** 查找航线声场计算归档；优先使用明确的航迹点编号，坐标匹配兼容旧结果。 */
function reusableTrackFieldLayer(point, index) {
  const lon = Number(point?.lon)
  const lat = Number(point?.lat)
  const currentSource = sourcePoint.value || terrainSource.value
  const currentMatches = terrainField.value && currentVolumeTexture
    && Math.abs(Number(currentSource?.lon) - lon) < 1e-5
    && Math.abs(Number(currentSource?.lat) - lat) < 1e-5
  if (currentMatches) {
    return {
      field: terrainField.value,
      texture: currentVolumeTexture,
      source: currentSource,
      radiusKm: Number(sourceRadiusKm.value) || Number(terrainRadiusKm.value),
      params: calcParams.value,
      trackPointIndex: index,
    }
  }
  const layers = [...runHistoryLayers.value].reverse()
  const coordinateMatches = layer => {
    if (!layer?.field || !layer?.texture) return false
    return Math.abs(Number(layer.source?.lon) - lon) < 1e-5
      && Math.abs(Number(layer.source?.lat) - lat) < 1e-5
  }
  return layers.find(layer => Number(layer.trackPointIndex) === index && coordinateMatches(layer))
    || layers.find(coordinateMatches)
    || null
}

/** 将天气与环境噪声阶段已完成的三维声场放入播放缓存，避免完整链路重复计算。 */
function primeSignalWaypointFieldCache(samples, receiver) {
  let reused = 0
  const losses = Array(samples.length).fill(null)
  const distances = samples.map(sample => greatCircleDistanceM(sample, receiver))
  samples.forEach((sample, index) => {
    const layer = reusableTrackFieldLayer(sample, index)
    if (!layer) return
    const distanceM = distances[index]
    const bearingDeg = initialBearingDeg(sample, receiver)
    const params = layer.params || {}
    const record = {
      index,
      sample,
      parsed: layer.field,
      texture: layer.texture,
      receiverTl: sampleReceiverTlDb(layer.field, {
        bearingDeg,
        distanceM,
        depthM: receiver.depthM,
      }),
      distanceM,
      bearingDeg,
      rangeNm: Math.max(0.1, Number(layer.radiusKm) / 1.852 || Number(params.range) || 1),
      frequencyHz: (Number(params.minFreq) + Number(params.maxFreq)) / 2 || 100,
      model: String(params.model || 'bellhop').toLowerCase(),
      reusedTrackField: true,
    }
    vesselFieldCache.set(index, record)
    losses[index] = record.receiverTl
    reused += 1
  })
  vesselReceiverTlDb.value = losses
  vesselReceiverDistancesM.value = distances
  return reused
}

async function startSignalRouteFieldPlayback(result) {
  if (!configuredSignalRouteReady.value || !hydrophoneReceiverReady.value) return
  const speedKn = configuredSignalSpeedKn.value
  if (!(speedKn > 0)) return
  const samples = routeWaypointSamples(configuredSignalRoutePoints.value)
  if (!samples.length) {
    vesselPlaybackError.value = '无法从当前航迹生成声场站位。'
    return
  }
  const signalProfile = liveSignalSourceProfile.value
  const selectedModel = ['bellhop', 'ram', 'kraken'].includes(String(simulationControls.model).toLowerCase())
    ? String(simulationControls.model).toLowerCase()
    : 'bellhop'
  closeVesselPlayback(false)
  routePlaybackKind.value = 'signal'
  signalTransmissionSession.playbackActive = true
  vesselPlaybackGeneration += 1
  invalidateMovingSourceRayData()
  vesselFieldCache.clear()
  vesselFieldRequests.clear()
  vesselRouteSamples.value = samples
  vesselPlaybackVessel.value = resolveVesselSimulationProfile(selectedAisVessel.value, speedKn)
  vesselPlaybackModel.value = selectedModel
  vesselPlaybackSpectrum.value = signalProfile
  const reusedFieldCount = primeSignalWaypointFieldCache(samples, receiverArrayMarker.value)
  vesselTimeFrequencyWindowS.value = Math.max(1, Number(signalTransmissionControls.simulationDurationS) || 30)
  vesselPlaybackPreRollS.value = 0
  const routeDuration = routeDurationSeconds(samples, speedKn)
  vesselRouteDurationS.value = Math.max(1, routeDuration)
  vesselPlaybackDurationS.value = samples.length > 1
    ? vesselRouteDurationS.value
    : REALTIME_PREVIEW_DURATION_S
  vesselPlaybackTimeS.value = 0
  vesselSpectrogramWindowStartS.value = 0
  vesselPlaybackSampleIndex.value = 0
  vesselAppliedSampleIndex.value = 0
  vesselPlaybackRate.value = 1
  vesselPlaybackOpen.value = true
  vesselWaveformMinimized.value = false
  vesselSpectrogramMinimized.value = false
  vesselPlaybackPlaying.value = false
  vesselPlaybackBusy.value = true
  vesselPlaybackError.value = ''
  vesselPlaybackStatus.value = reusedFieldCount
    ? `已复用 ${reusedFieldCount}/${samples.length} 个航迹点声场 · 正在准备 Waypoint 1`
    : `连续仿真已启动 · 正在准备 Waypoint 1/${samples.length}`
  removeTerrainWindowFromDock('waveform')
  removeTerrainWindowFromDock('spectrogram')
  // 完整传输链路默认沿用体绘制的 custom 色标。
  volumeRenderingControls.colormap = 'bellhop'
  analysisMode.value = '3d'
  calcParams.value.model = selectedModel
  calcParams.value.sector = 24
  calcParams.value.srcDepth = signalProfile.sourceDepthM
  runtimeError.value = ''
  ensureVesselPlaybackClock()
  setVesselPlaybackPlaying(true)
  await activateVesselRouteSample(0)
  if (!vesselPlaybackError.value) {
    signalTransmissionSession.error = ''
    signalTransmissionSession.message = samples.length > 1
      ? `连续传输中；到达结构每50米计算，声场体按 ${samples.length} 个航迹点移动`
      : `固定发射位置实时传输中；${selectedModel.toUpperCase()} 声场与 Bellhop 到达结构持续更新`
  }
}

let lastSignalFieldRequestId = ''
watch(
  () => signalTransmissionSession.result,
  (result) => {
    const requestId = String(result?.request_id || '')
    if (!requestId || requestId !== lastSignalFieldRequestId) return
    if (result?.continuous) {
      vesselPlaybackDurationS.value = result.duration_s
      // result.waypoints 是 50 m 到达结构节点，不能覆盖前端独立的 500 m
      // 三维声场站位；否则声场体仍会每 50 m 重算和移动。
      return
    }
    signalTransmissionSession.message = '链路后台结果已就绪；实时航迹播放继续运行'
  },
)

/** 只清理剖面帘上的声线图元，保留传播带 / 端点 / 路径。 */
function clearTwoDRayFeatures() {
  if (viewer?.features) {
    for (const feature of twoDRayFeatures) {
      try {
        viewer.features.remove(feature)
      } catch {}
    }
  }
  twoDRayFeatures = []
}

function stopTwoDRayAnimation() {
  twoDRayFlowRenderer?.destroy()
  twoDRayFlowRenderer = null
}

function clearTwoDMapFeatures() {
  stopTwoDRayAnimation()
  if (twoDMapLayer && viewer?.imageryLayers) {
    try {
      viewer.imageryLayers.remove(twoDMapLayer)
    } catch {}
  }
  twoDMapLayer = null
  if (viewer?.features) {
    for (const feature of [...twoDMapFeatures, ...twoDRayFeatures]) {
      try {
        viewer.features.remove(feature)
      } catch {}
    }
  }
  twoDMapFeatures = []
  twoDRayFeatures = []
}

function addTwoDMapFeature(feature) {
  if (!feature || !viewer?.features) return null
  try {
    const added = feature.addTo(viewer.features)
    twoDMapFeatures.push(added || feature)
    return added || feature
  } catch (err) {
    console.warn('[2D Map] 图元添加失败：', err?.message ?? err)
    return null
  }
}

/** 添加地球剖面帘上的声线图元（可被「剖面隐藏」按钮整体移除 / 恢复） */
function addTwoDRayFeature(feature) {
  if (!feature || !viewer?.features) return null
  try {
    const added = feature.addTo(viewer.features)
    const ref = added || feature
    twoDRayFeatures.push(ref)
    if (!earthRaysVisible.value) viewer.features.remove(ref)
    return ref
  } catch (err) {
    console.warn('[2D 声线] 图元添加失败：', err?.message ?? err)
    return null
  }
}

/** 动态接口帧驱动的白色短尾迹；与 TL 图使用同一采样及裁剪逻辑。 */
function startTwoDRayAnimation({ flow, curtainWorld, depthAltitude, geometry }) {
  stopTwoDRayAnimation()
  if (!flow) return
  twoDRayFlowRenderer = createCurtainRayFlow({
    viewer, flow, geometry,
    visible: earthRaysVisible.value && verticalSliceControls.dynamicRays,
    project: ([distance, depth]) => curtainWorld(distance, depthAltitude(depth)),
  })
}

function destinationLonLat(lonDeg, latDeg, bearingDeg, distanceM) {
  const radius = 6371008.8
  const angular = Number(distanceM) / radius
  const bearing = Cesium.Math.toRadians(Number(bearingDeg))
  const lon1 = Cesium.Math.toRadians(Number(lonDeg))
  const lat1 = Cesium.Math.toRadians(Number(latDeg))
  const sinLat2 = Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)))
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  )
  return { lon: ((Cesium.Math.toDegrees(lon2) + 540) % 360) - 180, lat: Cesium.Math.toDegrees(lat2) }
}

function enableEarthInteraction() {
  const controller = viewer?.scene?.screenSpaceCameraController
  if (controller) {
    controller.enableInputs = true
    controller.enableZoom = true
    controller.enableRotate = true
    controller.enableTilt = true
    controller.enableLook = true
    controller.enableTranslate = true
  }
  if (viewer?.canvas) {
    viewer.canvas.style.pointerEvents = 'auto'
    viewer.canvas.style.cursor = 'grab'
  }
}

/**
 * 由二维「距离—深度」剖面构建**矩形直角体**：沿声源→接收大圆方向旋转的包围盒，
 * 交给基础体渲染管线绘制成一条**等宽矩形竖直剖面帘**（颜色 = TL）。
 *
 * 与三维极坐标体不同，这里 cross 轴只保留 1 层，深度轴按剖面深度排列，
 * 因此得到的是图1 那种等宽矩形剖面，而不是从声源发散的扇形。
 * @returns {{volume: object, exaggeration: number, depthMin:number, depthMax:number,
 *            topAltitude:number, bottomAltitude:number}|null}
 */
function build2dCurtainVolume({
  parsed,
  sectorIndex = 0,
  sourceLon,
  sourceLat,
  receiverLon,
  receiverLat,
  colorMin,
  colorMax,
  exaggeration,
  belowWater = false,
}) {
  const grid = parsed?.grid
  const col = Number(grid?.col) || 0
  const row = Number(grid?.row) || 0
  const sector = Math.max(0, Math.floor(Number(sectorIndex) || 0))
  if (!grid || col < 2 || row < 1) return null
  const distances = (grid.distance || []).slice(0, col).map(Number)
  const depths = (grid.depth || []).slice(0, row).map(Number)

  // 取值与剖面图使用**完全相同的口径**（parseAnalyse3DTlrd：9999 与海底以下剔除为 NaN；
  // 200 水体未覆盖保留为有限值，并在下方钳制到色标上限，等同显示为色标最大值）。
  // 关键：把超出色标范围（默认 60–120 dB）的值**钳制**到端点，而不是让体渲染跳过它们，
  // 否则地球剖面帘上会出现一片片空洞（左侧高 TL 区尤其明显）。
  const cMin = Number.isFinite(Number(colorMin)) ? Number(colorMin) : VOLUME_TL_COLOR_MIN
  const cMaxRaw = Number.isFinite(Number(colorMax)) ? Number(colorMax) : VOLUME_TL_COLOR_MAX
  const cMax = cMaxRaw > cMin ? cMaxRaw : cMin + 1

  const height = 1
  const data = new Uint8Array(col * height * row * 4)
  const normScale = 255 / Math.max(1e-6, cMax - cMin)
  let valid = 0
  for (let iz = 0; iz < row; iz++) {
    for (let ix = 0; ix < col; ix++) {
      const n = parsed.at(sector, iz, ix)
      const o = (iz * height * col + ix) * 4
      if (Number.isFinite(n)) {
        const v = Math.min(cMax, Math.max(cMin, n))
        let nn = ((v - cMin) * normScale + 0.5) | 0
        if (nn < 0) nn = 0
        else if (nn > 255) nn = 255
        data[o] = nn
        data[o + 1] = nn
        data[o + 2] = nn
        data[o + 3] = 255
        valid++
      }
    }
  }

  const distanceMin = Number(distances[0]) || 0
  const distanceMax = Math.max(distanceMin + 1, Number(distances[col - 1]) || distanceMin + 1)
  const boxLength = Math.max(1, distanceMax - distanceMin)
  const centerDist = (distanceMin + distanceMax) / 2
  const depthMinM = Number(depths[0]) || 0
  const depthMaxM = Number(depths[row - 1]) || depthMinM + 1
  const span = Math.max(1, depthMaxM - depthMinM)
  const exag =
    Number.isFinite(Number(exaggeration)) && Number(exaggeration) > 0
      ? Math.max(0.5, Math.min(200, Number(exaggeration)))
      : Math.max(0.5, Math.min(80, Math.round((boxLength * 0.18) / span)))

  let topAltitude
  let bottomAltitude
  if (belowWater) {
    // 真实水深：与三维体一致（海面为 0，向下为负），最浅层在帘顶、海底在帘底。
    topAltitude = -depthMinM * exag
    bottomAltitude = -depthMaxM * exag
  } else {
    // 抬升显示：海面（最浅层）在帘顶、海底在帘底，整体略高于海面，避免被海水/地形遮挡
    const surfaceMarginM = 30
    topAltitude = span * exag + surfaceMarginM
    bottomAltitude = surfaceMarginM
  }

  // 用「声源 → 接收」的弦方向构造包围盒：局部 +x 精确沿弦，两端正好落在声源/接收点。
  const originECEF = Cesium.Cartesian3.fromDegrees(sourceLon, sourceLat, 0)
  const endECEF = Cesium.Cartesian3.fromDegrees(receiverLon, receiverLat, 0)
  const dir = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(endECEF, originECEF, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  )
  const midECEF = Cesium.Cartesian3.add(
    originECEF,
    Cesium.Cartesian3.multiplyByScalar(dir, centerDist, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  )
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(midECEF)
  const enu3 = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3())
  const eastDir = Cesium.Matrix3.getColumn(enu3, 0, new Cesium.Cartesian3())
  const northDir = Cesium.Matrix3.getColumn(enu3, 1, new Cesium.Cartesian3())
  const yaw = Math.atan2(Cesium.Cartesian3.dot(dir, northDir), Cesium.Cartesian3.dot(dir, eastDir))
  const modelMatrix = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.multiply(enu3, Cesium.Matrix3.fromRotationZ(yaw), new Cesium.Matrix3()),
    midECEF,
    new Cesium.Matrix4()
  )
  const localHalfWidth = boxLength / 2
  // 帘厚：稍厚一些，保证 ray-marching 在薄板上稳定采样，避免出现条纹/空洞
  const localHalfHeight = Math.max(120, Math.min(600, boxLength * 0.02)) / 2
  const cornerAt = (x, alt) =>
    Cesium.Matrix4.multiplyByPoint(modelMatrix, new Cesium.Cartesian3(x, 0, alt), new Cesium.Cartesian3())
  const worldBoundingSphere = Cesium.BoundingSphere.fromPoints([
    cornerAt(-localHalfWidth, bottomAltitude),
    cornerAt(localHalfWidth, bottomAltitude),
    cornerAt(-localHalfWidth, topAltitude),
    cornerAt(localHalfWidth, topAltitude),
  ])

  const volume = {
    width: col,
    height,
    depth: row,
    data,
    valueMin: cMin,
    valueMax: cMax,
    lonMin: sourceLon,
    lonMax: receiverLon,
    latMin: sourceLat,
    latMax: receiverLat,
    depthMin: depthMinM,
    depthMax: depthMaxM,
    depthValues: depths.slice(),
    sourceWidth: col,
    sourceHeight: height,
    sourceDepth: row,
    topAltitude,
    bottomAltitude,
    localHalfWidth,
    localHalfHeight,
    modelMatrix,
    worldBoundingSphere,
    validVoxelRatio: valid / Math.max(1, col * height * row),
    // TL 数值保持原始精度口径；GPU 采样使用线性过滤消除网格接缝与块状边界。
    textureFilter: 'linear',
    depthExaggeration: exag,
    // 抬升显示=true（对 globe 做深度遮挡）；真实水深=false（水下透视，并禁用包围球剔除）
    displayAboveWater: !belowWater,
  }
  return {
    volume,
    exaggeration: exag,
    depthMin: depthMinM,
    depthMax: depthMaxM,
    topAltitude,
    bottomAltitude,
    modelMatrix,
    localHalfWidth,
    centerDist,
    distanceMin,
    distanceMax,
  }
}

/**
 * 二维距离—深度结果在地球上的呈现：沿声源→接收大圆建立**竖直剖面帘**
 * （TL 伪彩 + 声线轨迹叠加），替代原来的贴地彩色传播带。
 */
function render2dFieldOnEarth(profileJson) {
  clearTwoDMapFeatures()
  if (!viewer?.features || !viewer?.imageryLayers) return
  let parsed = null
  try {
    parsed = parseAnalyse3DTlrd(profileJson)
  } catch (err) {
    console.warn('[2D Curtain] 二维剖面解析失败：', err?.message ?? err)
  }
  if (!parsed?.grid || parsed.grid.col < 2 || parsed.grid.row < 1) return

  const sourceLon = Number(calcParams.value.coordX)
  const sourceLat = Number(calcParams.value.coordY)
  const bearing = routeBearingDeg.value
  const routeM = Math.max(1, routeDistanceNm.value * 1852)
  const receiver = destinationLonLat(sourceLon, sourceLat, bearing, routeM)

  // 1) 竖直剖面帘：矩形直角体（沿声源→接收弦方向旋转包围盒）→ 基础体渲染管线。
  //    抬升到海面以上显示，带包围球 + 深度测试，保证清晰可见且不被海水/地形冲淡；
  //    与三维体的“真实水深”模式相互独立。
  let exag = 1
  let depthMap = null
  let curtainMeta = null
  try {
    const curtain = build2dCurtainVolume({
      parsed,
      sourceLon,
      sourceLat,
      receiverLon: receiver.lon,
      receiverLat: receiver.lat,
      colorMin: colorRange.value.min,
      colorMax: colorRange.value.max,
    })
    if (curtain && viewer?.scene?.primitives) {
      exag = curtain.exaggeration
      depthExaggeration.value = exag
      const vol = curtain.volume
      depthMap = { min: curtain.depthMin, max: curtain.depthMax, top: curtain.topAltitude, bottom: curtain.bottomAltitude }
      curtainMeta = { modelMatrix: curtain.modelMatrix, centerDist: curtain.centerDist, distanceMax: curtain.distanceMax }
      removeCurtainPrimitive()
      // 纹理已把 TL 钳制到色标 60–120，值域/色标都取同一范围，体渲染不再跳过任何体素
      curtainPrimitive = new ShaderVolume3DPrimitive({
        volume: vol,
        valueRange: { min: vol.valueMin, max: vol.valueMax },
        colorRange: { min: vol.valueMin, max: vol.valueMax },
        colorGamma: 0.82,
        depthTopIndex: 0,
        depthBottomIndex: vol.depth - 1,
        depthRevealMax: vol.depth - 1,
        alphaScale: 0.9,
        sliceClip: { enabled: false },
        colorStops: colorStopsToSdk(),
      })
      viewer.scene.primitives.add(curtainPrimitive)
    }
  } catch (err) {
    console.warn('[2D Curtain] 竖直剖面帘构建失败，仅显示声线与路径：', err?.message ?? err)
    errorText.value = `二维剖面帘渲染失败：${err?.message ?? err}`
  }

  // 2) 声线轨迹：直接使用剖面帘的**局部坐标系**定位（局部 x = 距离、z = 海拔），
  //    因此声线与 TL 剖面严格落在同一张竖直平面上，不会因大圆弯曲而错开。
  const depthAltitude = (dep) => {
    if (!depthMap) return -dep * exag
    const span = (depthMap.max - depthMap.min) || 1
    const t = Math.min(1, Math.max(0, (dep - depthMap.min) / span))
    return depthMap.top + t * (depthMap.bottom - depthMap.top)
  }
  const toLonLatAlt = (cart) => {
    const carto = Cesium.Cartographic.fromCartesian(cart)
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude), carto.height]
  }
  const curtainWorld = (distM, altitudeM) => {
    if (!curtainMeta) {
      const pt = destinationLonLat(sourceLon, sourceLat, bearing, distM)
      return Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, altitudeM)
    }
    return Cesium.Matrix4.multiplyByPoint(
      curtainMeta.modelMatrix,
      new Cesium.Cartesian3(distM - curtainMeta.centerDist, 0, altitudeM),
      new Cesium.Cartesian3()
    )
  }
  const curtainLimitM = curtainMeta ? curtainMeta.distanceMax : routeM * 1.02
  const dynamicRays = useDynamicRays.value && verticalSliceControls.dynamicRays
    ? resolveRayFlow(staticRayData.value, staticRayModel.value?.rayPaths ?? []) : null
  const staticRays = !dynamicRays && verticalSliceControls.staticRays
  if (dynamicRays) {
    startTwoDRayAnimation({
      flow: dynamicRays,
      curtainWorld,
      depthAltitude,
      geometry: profileAxisGeometry(buildProfileModel(profileJson, 'tlrd'), 0, curtainLimitM),
    })
  } else if (staticRays) {
    const rays = staticRayModel.value?.rayPaths ?? []
    const rayColor = Cesium.Color.fromCssColorString('#e8f7ff')
    for (const path of rays) {
      const positions = []
      for (const [distM, depthM] of path) {
        const d = Number(distM)
        const dep = Number(depthM)
        if (!Number.isFinite(d) || !Number.isFinite(dep) || d < 0 || d > curtainLimitM) continue
        positions.push(toLonLatAlt(curtainWorld(d, depthAltitude(dep))))
      }
      if (positions.length >= 2) {
        addTwoDRayFeature(
          new Cesium.Polyline(positions, {
            colors: [rayColor.withAlpha(0.92)],
            width: 1.8,
            followSurface: false,
            onTerrain: false,
          })
        )
      }
    }
  }

  // 声源 / 接收端点与海面路径同样使用剖面帘坐标，保证与剖面帘顶部完全重合
  const surfaceAlt = (depthMap ? depthMap.top : 260) + 40
  addTwoDMapFeature(
    new Cesium.Polyline(
      [
        toLonLatAlt(curtainWorld(0, surfaceAlt)),
        toLonLatAlt(curtainWorld(curtainLimitM, surfaceAlt)),
      ],
      {
        colors: [Cesium.Color.WHITE.withAlpha(0.92)],
        width: 2.2,
        followSurface: false,
        onTerrain: false,
      }
    )
  )
  addTwoDMapFeature(
    new Cesium.Point(toLonLatAlt(curtainWorld(0, surfaceAlt)), {
      color: Cesium.Color.fromCssColorString('#ff5757'),
      pixelSize: 15,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    })
  )
  addTwoDMapFeature(
    new Cesium.Point(toLonLatAlt(curtainWorld(curtainLimitM, surfaceAlt)), {
      color: Cesium.Color.fromCssColorString('#49e68b'),
      pixelSize: 13,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    })
  )

  enableEarthInteraction()
  viewer.scene?.requestRender?.()
}

function focus2dField() {
  if (!viewer?.camera) return
  const source = Cesium.Cartesian3.fromDegrees(Number(calcParams.value.coordX), Number(calcParams.value.coordY), 0)
  const receiver = Cesium.Cartesian3.fromDegrees(Number(calcParams.value.receiverX), Number(calcParams.value.receiverY), 0)
  const sphere = Cesium.BoundingSphere.fromPoints([source, receiver])
  // 侧视剖面帘：方位垂直于传播方向，压低俯仰角，得到类似正面看剖面的横条效果
  const range = Math.max(90000, sphere.radius * 3.6)
  const offset = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(routeBearingDeg.value - 90),
    Cesium.Math.toRadians(-24),
    range
  )
  enableEarthInteraction()
  if (typeof viewer.camera.flyToBoundingSphere === 'function') {
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 0.8,
      offset,
      complete: enableEarthInteraction,
      cancel: enableEarthInteraction,
    })
  }
}

function clearResultLayers({ preserveVolume = false } = {}) {
  clearOmni2dLayer()
  clearTwoDMapFeatures()
  removeCurtainPrimitive()
  removeSliceCurtain()
  clearTimeout(sliceCurtainTimer)
  sliceCurtainTimer = 0
  resultPanelOpen.value = false
  receiverPlacementEnabled.value = false
  receiverArrayMarker.value = null
  if (!preserveVolume && soundField?.loaded) {
    soundField.destroy()
    soundField = viewer ? new SoundField(viewer, { depthExaggeration: depthExaggeration.value }) : null
  }
  volumeData.value = null
  if (!preserveVolume) {
    currentVolumeTexture = null
    terrainTexture.value = null
  }
  raySourceData.value = null
  staticRayData.value = null
  rayDataByAzimuth.clear()
  ray3dByAzimuth.static.clear()
  ray3dByAzimuth.dynamic.clear()
  ray3dRequest = null
  ray3dToken++
  rayLoadToken++
  clearTimeout(rayLoadTimer)
  rayLoadTimer = 0
  bottomTypeByAzimuth.clear()
  bottomTypeToken++
  clearTimeout(bottomTypeTimer)
  bottomTypeTimer = 0
  bottomTypeSegments.value = []
  bottomTypeState.value = 'idle'
  bounds.value = null
  sourcePoint.value = null
  availableAzimuths.value = []
  calculatedSectorCount.value = 0
  // 结果已清空，若配置面板仍开着则恢复取点标识
  refreshPickMarkers()
}

/** 将二维门户返回整理成现有剖面组件可直接消费的单方位 TLRD 结构。 */
function adapt2dTlResponse(tlJson, azimuthDeg) {
  const sourceUnit = tlJson?.Data?.Units?.[0]
  const response = sourceUnit?.Response ?? {}
  const rawProfile = response?.transLossData?.transmissionLossVS?.profile
  const rawRow = Math.max(0, Number(response?.transLossData?.size) || Number(rawProfile?.z?.length) || 0)
  const rawCol = Math.max(0, Number(rawProfile?.x?.length) || 0)
  if (!rawProfile?.data || rawRow < 1 || rawCol < 1) throw new Error('二维传播损失结果缺少有效剖面数据')

  // 门户默认可返回 1001×3001 网格。图表不需要逐像素保留三百万点，
  // 这里等间隔抽样到约 18 万点，显著降低浏览器内存和首次绘制时间。
  const sampleIndices = (size, limit) => {
    if (size <= limit) return Array.from({ length: size }, (_, index) => index)
    return Array.from({ length: limit }, (_, index) => Math.round((index * (size - 1)) / (limit - 1)))
  }
  const rowIndices = sampleIndices(rawRow, 260)
  const colIndices = sampleIndices(rawCol, 700)
  const profile = {
    x: colIndices.map((index) => rawProfile.x[index]),
    z: rowIndices.map((index) => rawProfile.z[index]),
    data: rowIndices.map((rowIndex) => {
      const line = Array.isArray(rawProfile.data[rowIndex]) ? rawProfile.data[rowIndex] : []
      return colIndices.map((colIndex) => line[colIndex])
    }),
  }
  const row = rowIndices.length
  const col = colIndices.length
  const rawAlt = response.altList
  const altitude = rawAlt
    ? {
        ...rawAlt,
        size: col,
        x: colIndices.map((index) => rawAlt.x?.[index]),
        y: colIndices.map((index) => rawAlt.y?.[index]),
      }
    : null
  return {
    'Technical Support': tlJson?.['Technical Support'] || 'XWOcean',
    Data: {
      SN: tlJson?.Data?.SN,
      TaskId: tlJson?.Data?.TaskId || '',
      SelfOrder: tlJson?.Data?.SelfOrder || 0,
      Units: [
        {
          Plugin: 'Analyse3DTLRD',
          ResultCode: Number(sourceUnit?.ResultCode) || 0,
          Response: {
            calcFrequency: response.calcFrequency,
            altitudeList: { size: altitude ? 1 : 0, pairedDataVS: altitude ? [altitude] : [] },
            reconstructDataVS: { size: row, x: profile.z, y: new Array(row).fill(null) },
            loadingTlv: {
              row,
              col,
              sector: 1,
              size: row,
              azimuths: [Number(azimuthDeg) || 0],
              profile,
            },
          },
        },
      ],
    },
  }
}

/** 将 UI 色标（{t, color: '#rrggbb'}）转换为 SDK 色标数组 [[t, [r,g,b]], ...] */
function colorStopsToSdk() {
  return activeVolumeColorStops(volumeRenderingControls.colormap)
}

/** CPU 图层与图例使用 GPU 同款对比度变换后的色标。 */
function displayedTlColorStopsToSdk() {
  return contrastedVolumeColorStops(colorStopsToSdk(), volumeRenderingControls.contrast)
}

/** 当前体模式的显示色标：TL、SE 和 Pd 均与 GPU 对比度公式一致。 */
function activeDisplayedColorStopsToSdk() {
  if (signalExcessParams.value) {
    return contrastedVolumeColorStops(SIGNAL_EXCESS_COLOR_STOPS, volumeRenderingControls.contrast)
  }
  return displayedTlColorStopsToSdk()
}

/** 当前色标对应的 CSS 渐变（图例实时预览） */
const colorGradient = computed(() => {
  const params = signalExcessParams.value
  if (params?.threeColor) {
    return buildDetectionClassGradient(
      profileDbRange.value.min,
      profileDbRange.value.max,
      params.displayMode,
      params.sigma,
    )
  }
  return buildTlGradient(activeDisplayedColorStopsToSdk())
})
/** 二维 TL 俯视图始终解释原始 TL，不随 SE/Pd 模式切换色带。 */
const omniColorGradient = computed(() => buildTlGradient(displayedTlColorStopsToSdk()))

function isOpen(key) {
  return !collapsedSections.value[key]
}

function toggleSection(key) {
  collapsedSections.value[key] = !collapsedSections.value[key]
}

function getWebGL2(context) {
  const gl = context?._gl || context?.gl
  if (!gl || typeof gl.TEXTURE_3D !== 'number') return null
  return gl
}

/** 根据当前 UI 状态组装切面裁切参数 */
function getSliceClipOptions() {
  // 裁剪体：沿方向方位线所在的竖直平面裁掉半个体，只保留另一半。
  if (verticalSliceControls.clipBody) {
    return {
      enabled: true,
      mode: VOLUME_SLICE_MODE.azimuth,
      position: 0.5,
      azimuthDeg: sliceAzimuthDeg.value,
    }
  }
  return {
    enabled: sliceEnabled.value,
    mode: VOLUME_SLICE_MODE[sliceMode.value] ?? VOLUME_SLICE_MODE.azimuth,
    position: slicePercent.value / 100,
    azimuthDeg: sliceAzimuthDeg.value,
  }
}

/**
 * 声场体显隐：设置 primitive 的 `show` 标记（`update` 内据此跳过本帧绘制），
 * 保持在图元集合中不动，避免「移除后再 add 不生效」的问题。
 */
function applyVolumeVisible(visible) {
  const prim = soundField?.primitive
  if (prim) prim.show = visible !== false
  for (const layer of runHistoryLayers.value) {
    if (layer.renderer?.primitive) layer.renderer.primitive.show = visible !== false && layer.visible !== false
  }
  viewer?.scene?.requestRender?.()
}

/** 声场体显隐开关 */
function toggleVolumeVisible() {
  applyVolumeVisible(volumeVisible.value)
  if (volumeRenderingControls.volumeVisible !== volumeVisible.value) {
    volumeRenderingControls.volumeVisible = volumeVisible.value
  }
}

/**
 * 移除二维声场影像图层（存在即先清掉，再按新状态重建）。
 * @returns {boolean} 是否确实移除了旧图层
 */
function clearOmni2dLayer() {
  omni2dLayerToken += 1
  if (!omni2dLayer) return false
  if (viewer && !viewer.isDestroyed()) viewer.imageryLayers.remove(omni2dLayer)
  omni2dLayer = null
  return true
}

/**
 * 海面投影点是否落在三维体仍有效的极坐标列上。
 * 直接读取地形裁剪后的纹理 A 通道，避免二维投影重新把陆地或陆后区域画回来。
 */
function isCurrentVolumePointVisible(lon, lat) {
  const texture = currentVolumeTexture
  if (!texture?.data || analysisMode.value !== '3d') return true
  const meta = texture.wedgeMeta ?? {}
  const sourceLon = Number(meta.sourceLon)
  const sourceLat = Number(meta.sourceLat)
  const pointLon = Number(lon)
  const pointLat = Number(lat)
  if (![sourceLon, sourceLat, pointLon, pointLat].every(Number.isFinite)) return false

  const eastM = (pointLon - sourceLon) * 111320 * Math.cos((sourceLat * Math.PI) / 180)
  const northM = (pointLat - sourceLat) * 110574
  const pathM = Math.hypot(eastM, northM)
  const pathMin = Number(meta.pathMinM) || 0
  const pathMax = Number(meta.pathMaxM) || pathMin + 1
  const pathT = (pathM - pathMin) / Math.max(1, pathMax - pathMin)
  if (pathT < 0 || pathT > 1) return false

  const bearing = ((Math.atan2(eastM, northM) * 180) / Math.PI + 360) % 360
  const angleMin = Number(meta.angleMin) || 0
  const angleMax = Number(meta.angleMax) || 360
  const angleSpan = Math.max(0.001, angleMax - angleMin)
  const angleT = (((bearing - angleMin) % 360) + 360) % 360 / angleSpan
  const x = Math.max(0, Math.min(texture.width - 1, Math.round(pathT * (texture.width - 1))))
  // 严格最近邻纹理每行对应一个原始扇区，按着色器的最近扇区规则取行（含 0°/360° 环绕）。
  const y = texture.strictNearest
    ? Math.floor(angleT * texture.height + 0.5) % Math.max(1, texture.height)
    : Math.max(0, Math.min(texture.height - 1, Math.round(angleT * (texture.height - 1))))
  const z = Math.max(0, Math.min(texture.depth - 1, Number(omni2dDepthIndex.value) || 0))
  return texture.data[(((z * texture.height + y) * texture.width + x) * 4) + 3] > 0
}

/**
 * 二维声场俯视图：把当前深度层栅格化为 PNG（声呐射线 / 色阶热力图两种样式），
 * 用 SingleTileImageryProvider 作为影像图层贴在 Cesium 球面（不再使用小窗口图表）。
 */
function syncOmni2dLayer() {
  if (!viewer || viewer.isDestroyed()) return
  clearTimeout(omni2dTimer)
  omni2dTimer = 0
  clearOmni2dLayer()
  const token = omni2dLayerToken
  if (!omni2dVisible.value || !omni2dModel.value) return

  const img = buildOmniFieldImage({
    model: omni2dModel.value,
    style: omni2dStyle.value,
    depthIndex: omni2dDepthIndex.value,
    maxRadiusM: sourceRadiusKm.value * 1000,
    // 与三维体保持一致的筛选 / 色标口径：声呐风格下该范围同时作为射线分级范围
    valueRange: { min: valueRange.value.min, max: valueRange.value.max },
    colorRange: { min: colorRange.value.min, max: colorRange.value.max },
    stops: displayedTlColorStopsToSdk(),
    rayCount: OMNI_RAY_COUNT,
    pointVisible: isCurrentVolumePointVisible,
  })
  if (!img) return

  // Cesium 1.141 运行时强制校验 tileWidth / tileHeight（类型声明虽标可选，实际必填）
  const provider = new Cesium.SingleTileImageryProvider({
    url: img.url,
    tileWidth: img.width,
    tileHeight: img.height,
    rectangle: Cesium.Rectangle.fromDegrees(img.west, img.south, img.east, img.north),
    credit: '二维声场俯视图',
  })

  // GeoVis 的 SingleTileImageryProvider 在图片加载完成前读取 tileWidth 会抛错并中断
  // 整个体渲染流程；必须等 readyPromise 完成后再挂到影像图层集合。
  const attach = () => {
    if (token !== omni2dLayerToken || !viewer || viewer.isDestroyed()) return
    if (!omni2dVisible.value) return
    omni2dLayer = viewer.imageryLayers.addImageryProvider(provider)
    // 热力图不透明会糊住底图 ⇒ 略微透明；声呐风格本身背景透明，可用全不透明保证射线清晰
    omni2dLayer.alpha = omni2dStyle.value === 'sonar' ? 1 : 0.9
    viewer.scene.requestRender?.()
  }

  if (provider.ready === true) {
    attach()
  } else if (provider.readyPromise?.then) {
    // GeoVis 使用 when 风格 Promise，没有 .catch()，失败回调需作为 then 的第二个参数。
    provider.readyPromise.then(attach, (err) => {
      console.warn('[二维声场] 俯视贴图加载失败：', err?.message ?? err)
    })
  } else {
    attach()
  }
}

/** 二维声场显隐开关 */
function onOmni2dVisibleChange() {
  syncOmni2dLayer()
}

/** 浮动显示窗与侧边栏共用同一个 0–1 不透明度。 */
function onVolumeOpacityInput() {
  const next = opacityControlToAlphaScale(volumeOpacity.value)
  volumeOpacity.value = next
  if (volumeRenderingControls.opacity !== next) volumeRenderingControls.opacity = next
  else syncSoundField()
}

/** 色标 / 筛选范围变化时合并重建二维图层（栅格化较重，避免拖动时卡顿） */
function scheduleOmni2dLayer() {
  if (!omni2dVisible.value) return
  clearTimeout(omni2dTimer)
  omni2dTimer = setTimeout(() => {
    omni2dTimer = 0
    syncOmni2dLayer()
  }, 240)
}

/** 将 UI 状态同步到 SoundField 并触发重渲染 */
function syncHistoricalSoundFields() {
  for (const layer of runHistoryLayers.value) {
    const renderer = layer.renderer
    if (!renderer?.loaded) continue
    if (props.viewMode === 'terrain') {
      renderer.releaseRenderer()
      continue
    }
    renderer.displayAboveWater = false
    renderer.setDisplay({
      valueRange: { min: valueRange.value.min, max: Number(fomValue.value) },
      colorRange: { min: colorRange.value.min, max: colorRange.value.max },
      density: Number(volumeRenderingControls.density),
      contrast: Number(volumeRenderingControls.contrast),
      edgeSharpness: Number(volumeRenderingControls.edgeSharpness),
      alphaScale: volumeOpacity.value,
      valueAlphaRange: [valueAlphaRange.value.min, valueAlphaRange.value.max],
      sliceClip: { enabled: false },
      rayLines: { visible: false },
      colorStops: colorStopsToSdk(),
    })
    renderer.setAzimuthPointerVisible(false)
    if (renderer.primitive) renderer.primitive.show = volumeVisible.value && layer.visible !== false
  }
}

function syncSoundField(options = {}) {
  // 地形沙盘使用自己的 WebGL 上下文显示同一声场。全球画布隐藏期间释放其
  // 3D 纹理，避免计算完成后双份 GPU 体纹理一直常驻。
  if (props.viewMode === 'terrain') {
    soundField?.releaseRenderer()
    syncHistoricalSoundFields()
    return
  }
  if (!soundField) {
    syncHistoricalSoundFields()
    return
  }
  soundField.setDisplay({
    // FOM 门限：TL 高于 FOM 的体素不显示（值域上限即硬截断）
    valueRange: { min: valueRange.value.min, max: Number(fomValue.value) },
    // 色标按自定义 dB 范围映射：下限=红，上限=蓝（红→蓝渐变方式不变）
    colorRange: { min: colorRange.value.min, max: colorRange.value.max },
    density: Number(volumeRenderingControls.density),
    contrast: Number(volumeRenderingControls.contrast),
    edgeSharpness: Number(volumeRenderingControls.edgeSharpness),
    alphaScale: volumeOpacity.value,
    valueAlphaRange: [valueAlphaRange.value.min, valueAlphaRange.value.max],
    sliceClip: getSliceClipOptions(),
    // 三维体上的声线：由侧边栏「声线播放」的静态声线开关控制；
    // 动态声线由独立的行进动画渲染，二者可同时显示。
    rayLines: {
      visible:
        analysisMode.value === '3d' &&
        isRayModel.value &&
        earthRaysVisible.value &&
        verticalSliceControls.staticRays,
      azimuth: null,
      azimuthToleranceDeg: Math.max(1, azimuthToleranceDeg.value),
      lineWidth: 1.8,
      lineAlpha: 0.95,
      colorMode: { fixed: '#ff2d55' },
    },
    colorStops: colorStopsToSdk(),
  }, { skipRayLines: options.skipRayLines === true })
  // 切面滑块 / 下拉框改写方位时，回写 3D 指针位置（不吸附、不回调，避免循环）
  soundField.pointer?.setAzimuth(Number(sliceAzimuthDeg.value), { snap: false, silent: true })
  // 每次重绘后按当前开关状态校正图元是否挂在场景中（setDisplay 会重新 primitive）
  applyVolumeVisible(volumeVisible.value)
  syncHistoricalSoundFields()
  runtimeError.value = soundField.getError()?.message || ''
}

let azimuthSyncTimer = null
/** 最近一次「裁剪体」方向（内部角，正东 0°、逆时针），关闭再开启时恢复该裁剪效果。 */
let lastClipAzimuthDeg = null

/** 创建 / 更新声源点上方「可拖拽方位指针」 */
function setupAzimuthPointer() {
  if (!soundField?.loaded) return
  const clipMode = verticalSliceControls.clipBody
  const directionLine = verticalSliceControls.east90Indicator
  // 裁剪模式或方位方向线开启时，方位指针也需要可拖动，用于调整切面方位。
  const interactive = pointerEnabled.value || clipMode || directionLine
  soundField.setAzimuthPointer({
    azimuths: clipMode ? [] : availableAzimuths.value,
    snapStepDeg: 1,
    azimuthDeg: Number(sliceAzimuthDeg.value),
    visible: interactive && (!sliceEnabled.value || clipMode || directionLine),
    draggable: interactive,
    // 仅方位方向线驱动时只显示箭头/杆，不显示辅助圈，避免默认多出一整圈刻度。
    ringVisible: pointerRingVisible.value && (pointerEnabled.value || clipMode),
    // 拖拽停靠到某个方位后刷新该方位的声线剖面
    onAzimuthChange: (deg) => {
      sliceAzimuthDeg.value = deg
      if (clipMode) {
        // 裁剪体：先即时更新体裁剪与方向线；声线 / 底质接口在停顿后再补算，
        // 避免连续拖拽频繁请求门户，同时保证半声场体与动态声线方位一致。
        lastClipAzimuthDeg = deg
        clearTimeout(azimuthSyncTimer)
        azimuthSyncTimer = setTimeout(() => {
          azimuthSyncTimer = null
          syncSoundField()
          scheduleRayDataForAzimuth(deg)
          scheduleBottomTypesForAzimuth(deg)
        }, 30)
        return
      }
      // 声线重建较重，快速拖拽时做一次节流合并
      clearTimeout(azimuthSyncTimer)
      azimuthSyncTimer = setTimeout(() => {
        azimuthSyncTimer = null
        syncSoundField()
        scheduleSliceCurtain()
        scheduleRayDataForAzimuth(deg)
        scheduleBottomTypesForAzimuth(deg)
      }, 60)
    },
  })
}

/** 指针显隐：方位方向线 / 裁剪体开启时保留箭头，可拖拽切换方位。 */
function applyPointerVisibility() {
  const clipMode = verticalSliceControls.clipBody
  const directionLine = verticalSliceControls.east90Indicator
  const interactive = pointerEnabled.value || clipMode || directionLine
  const show = interactive && (!sliceEnabled.value || clipMode || directionLine)
  soundField?.setAzimuthPointerVisible(show)
  soundField?.pointer?.setDraggable(interactive)
  soundField?.setAzimuthPointerRingVisible(pointerRingVisible.value && (pointerEnabled.value || clipMode))
}

/** 方位指针开关 */
function toggleAzimuthPointer() {
  applyPointerVisibility()
  syncSoundField()
}

/* ── 方位剖面：在所选方位上绘制二维传播损失剖面帘（替代三维体上的方向指针） ── */
function clearSliceRayFeatures() {
  if (viewer?.features) {
    for (const feature of sliceRayFeatures) {
      try {
        viewer.features.remove(feature)
      } catch {}
    }
  }
  sliceRayFeatures = []
}

function clearSliceStaticRayFeatures() {
  if (viewer?.features) {
    for (const feature of sliceStaticRayFeatures) {
      try {
        viewer.features.remove(feature)
      } catch {}
    }
  }
  sliceStaticRayFeatures = []
}

function stopSliceRayAnimation() {
  if (sliceRayAnimationTimer) window.clearInterval(sliceRayAnimationTimer)
  sliceRayAnimationTimer = 0
  clearSliceRayFeatures()
  clearSliceStaticRayFeatures()
}

function addSliceRayFeature(feature) {
  if (!feature || !viewer?.features) return null
  try {
    const added = feature.addTo(viewer.features)
    const ref = added || feature
    sliceRayFeatures.push(ref)
    if (!earthRaysVisible.value) viewer.features.remove(ref)
    return ref
  } catch (err) {
    console.warn('[三维切面声线] 图元添加失败：', err?.message ?? err)
    return null
  }
}

function addSliceStaticRayFeature(feature) {
  if (!feature || !viewer?.features) return null
  try {
    const added = feature.addTo(viewer.features)
    const ref = added || feature
    sliceStaticRayFeatures.push(ref)
    if (!earthRaysVisible.value) viewer.features.remove(ref)
    return ref
  } catch (err) {
    console.warn('[三维切面声线] 预绘图元添加失败：', err?.message ?? err)
    return null
  }
}

function sliceDepthAltitude(meta, depthM) {
  const span = (meta.depthMax - meta.depthMin) || 1
  const t = Math.min(1, Math.max(0, (Number(depthM) - meta.depthMin) / span))
  return meta.topAltitude + t * (meta.bottomAltitude - meta.topAltitude)
}

/**
 * 在单 / 多方位剖面帘上播放动态声线。
 * 先在帘上预绘每条声线的完整路径（白色浅色、低透明），再叠加沿路径推进的动态头部。
 */
function startSliceRayAnimation() {
  stopSliceRayAnimation()
  const dynamic = !!verticalSliceControls.dynamicRays
  const staticRays = !!verticalSliceControls.staticRays
  if (!sliceEnabled.value || !earthRaysVisible.value || analysisMode.value !== '3d') return
  if (!dynamic && !staticRays) return
  if (!viewer || viewer.isDestroyed?.() || !sliceCurtainMetaList.length) return

  const items = []
  const currentAzimuth = nearestAvailableAzimuth(sliceAzimuthDeg.value)
  for (const meta of sliceCurtainMetaList) {
    // 剖面帘在最近的扇面行上构建；声线缓存也按吸附后的方位存取，避免自由滑块
    // 方位（未吸附）与缓存 key 对不上而无法命中。
    const azimuth = nearestAvailableAzimuth(Number(meta.azimuth))
    const response =
      getCachedRayResponse(azimuth) ??
      (Math.abs(azimuth - currentAzimuth) < 1e-6 ? staticRayData.value : null)
    if (!response) continue
    const parsedRays = parseAnalyse2DRtrd(response)
    const flow = resolveRayFlow(response, parsedRays?.rays ?? [])
    if (!flow) continue
    items.push({ meta, flow })
  }
  if (!items.length) return

  // 三维体上的声线：白色浅色。
  const rayColor = Cesium.Color.fromCssColorString('#eaf6ff')

  const toPositions = (meta, points) => {
    const positions = []
    for (const point of points) {
      const distance = Number(point[0])
      const depth = Number(point[1])
      if (!Number.isFinite(distance) || !Number.isFinite(depth)) continue
      if (distance < 0 || distance > meta.distanceMax) continue
      const altitude = sliceDepthAltitude(meta, depth)
      const world = Cesium.Matrix4.multiplyByPoint(
        meta.modelMatrix,
        new Cesium.Cartesian3(distance - meta.centerDist, 0, altitude),
        new Cesium.Cartesian3()
      )
      const cartographic = Cesium.Cartographic.fromCartesian(world)
      positions.push([
        Cesium.Math.toDegrees(cartographic.longitude),
        Cesium.Math.toDegrees(cartographic.latitude),
        cartographic.height,
      ])
    }
    return positions
  }

  // 预先绘制全部声线：动态播放时作为淡显轨道，纯静态模式时作为唯一显示。
  const staticAlpha = dynamic ? 0.14 : 0.38
  for (const { meta, flow } of items) {
    for (const track of flow?.tracks ?? []) {
      const positions = toPositions(meta, track.points)
      if (positions.length >= 2) {
        addSliceStaticRayFeature(
          new Cesium.Polyline(positions, {
            colors: [rayColor.withAlpha(staticAlpha)],
            width: dynamic ? 1.1 : 1.3,
            followSurface: false,
            onTerrain: false,
          })
        )
      }
    }
  }
  if (!dynamic) {
    viewer.scene?.requestRender?.()
    return
  }

  const drawFrame = () => {
    if (!earthRaysVisible.value || !sliceEnabled.value || !viewer || viewer.isDestroyed?.()) {
      stopSliceRayAnimation()
      return
    }
    if (!verticalSliceControls.dynamicRays) {
      if (sliceRayAnimationTimer) window.clearInterval(sliceRayAnimationTimer)
      sliceRayAnimationTimer = 0
      clearSliceRayFeatures()
      viewer.scene?.requestRender?.()
      return
    }
    // 与二维剖面窗的 RayFlowOverlay 共用同一传播时钟，保证相位一致。
    const elapsed = rayFlowClockElapsedMs()
    clearSliceRayFeatures()

    for (const { meta, flow } of items) {
      for (const trail of sampleRayFlow(flow, elapsed)) {
        const positions = toPositions(meta, trail.map((segment) => segment.point))
        if (positions.length >= 2) {
          addSliceRayFeature(
            new Cesium.Polyline(positions, {
              colors: [rayColor.withAlpha(0.95)],
              width: 1.8,
              followSurface: false,
              onTerrain: false,
            })
          )
        }
      }
    }
    viewer.scene?.requestRender?.()
  }

  drawFrame()
  sliceRayAnimationTimer = window.setInterval(drawFrame, 80)
}

function removeSliceCurtain() {
  stopSliceRayAnimation()
  if (viewer && !viewer.isDestroyed?.()) {
    for (const primitive of sliceCurtainPrimitives) {
      try {
        viewer.scene?.primitives?.remove(primitive)
      } catch {}
      try {
        primitive.destroy()
      } catch {}
    }
  }
  sliceCurtainPrimitives = []
  sliceCurtainMetaList = []
}

/**
 * 垂直切面显隐只更新常驻图层的 show 状态，不移除或重新初始化场景图元。
 * 传播损失剖面因此可以在同一渲染帧内平滑切换，并保留相机与 GPU 纹理状态。
 */
function applySliceCurtainVisibility() {
  const visible = sliceEnabled.value && verticalSliceControls.showSlice && analysisMode.value === '3d'
  for (const primitive of sliceCurtainPrimitives) primitive.show = visible
  viewer?.scene?.requestRender?.()
}

/**
 * 按切面模式重建「二维传播损失剖面帘」：
 *  - 单方位：只显示当前方位；
 *  - 多方位：同时显示三维 TL 的全部计算扇面。
 */
function updateSliceCurtain() {
  removeSliceCurtain()
  if (!sliceEnabled.value || analysisMode.value !== '3d') return
  if (!volumeData.value || !raySourceData.value || !viewer?.scene?.primitives) return
  let parsed = null
  try {
    parsed = parseAnalyse3DTlrd(raySourceData.value)
  } catch {
    return
  }
  const model = buildProfileModel(raySourceData.value, 'tlrd')
  const sourceLon = Number(calcParams.value.coordX)
  const sourceLat = Number(calcParams.value.coordY)
  const distList = parsed.grid.distance || []
  const distLast = Math.max(1, Number(distList[distList.length - 1]) || 0)
  const azimuths = isMultiSlice.value
    ? [...new Set(availableAzimuths.value)]
    : [Number(sliceAzimuthDeg.value)]

  for (const azimuth of azimuths) {
    if (!Number.isFinite(azimuth)) continue
    const rowIndex = nearestAzimuthRow(model, azimuth)
    if (!Number.isFinite(rowIndex) || rowIndex < 0) continue
    const bearing = internalAzimuthToCompassBearing(azimuth)
    const receiver = destinationLonLat(sourceLon, sourceLat, bearing, distLast)
    const curtain = build2dCurtainVolume({
      parsed,
      sectorIndex: rowIndex,
      sourceLon,
      sourceLat,
      receiverLon: receiver.lon,
      receiverLat: receiver.lat,
      colorMin: colorRange.value.min,
      colorMax: colorRange.value.max,
      // 与三维体同一水深基准与同一深度夸张，剖面帘贴在水下、与体对齐
      exaggeration: Number(soundField?.depthExaggeration) || depthExaggeration.value,
      belowWater: true,
    })
    if (!curtain) continue
    const primitive = new ShaderVolume3DPrimitive({
      volume: curtain.volume,
      valueRange: { min: curtain.volume.valueMin, max: curtain.volume.valueMax },
      colorRange: { min: curtain.volume.valueMin, max: curtain.volume.valueMax },
      colorGamma: 0.82,
      depthTopIndex: 0,
      depthBottomIndex: curtain.volume.depth - 1,
      depthRevealMax: curtain.volume.depth - 1,
      alphaScale: 0.9,
      contrast: Number(volumeRenderingControls.contrast),
      sliceClip: { enabled: false },
      colorStops: colorStopsToSdk(),
    })
    primitive.show = verticalSliceControls.showSlice
    viewer.scene.primitives.add(primitive)
    sliceCurtainPrimitives.push(primitive)
    sliceCurtainMetaList.push({
      azimuth,
      modelMatrix: curtain.modelMatrix,
      centerDist: curtain.centerDist,
      distanceMax: curtain.distanceMax,
      depthMin: curtain.depthMin,
      depthMax: curtain.depthMax,
      topAltitude: curtain.topAltitude,
      bottomAltitude: curtain.bottomAltitude,
    })
  }
  startSliceRayAnimation()
  viewer.scene.requestRender?.()
}

/** 拖动方位时延迟重建剖面帘，避免每帧重建 */
function scheduleSliceCurtain() {
  if (!sliceEnabled.value || analysisMode.value !== '3d') return
  clearTimeout(sliceCurtainTimer)
  sliceCurtainTimer = setTimeout(() => {
    sliceCurtainTimer = 0
    updateSliceCurtain()
  }, 120)
}

/** 启用 / 关闭方位切面 */
function onSliceToggle() {
  syncSoundField()
  applyPointerVisibility()
  updateSliceCurtain()
}

/** 指针外围辅助圈 / 刻度点开关：仅隐藏装饰，拖拽与命中判定不受影响 */
function toggleAzimuthRing() {
  soundField?.setAzimuthPointerRingVisible(pointerRingVisible.value)
}

/** 上一 / 下一方位（dir = -1 / +1） */
function stepPointerAzimuth(dir) {
  sliceAzimuthDeg.value = stepAzimuth(availableAzimuths.value, Number(sliceAzimuthDeg.value), dir)
  syncSoundField()
  scheduleSliceCurtain()
  scheduleRayDataForAzimuth(sliceAzimuthDeg.value, 0)
  scheduleBottomTypesForAzimuth(sliceAzimuthDeg.value, 0)
}

/** 声线轨迹组件下拉切换方位：同步 3D 指针与切面 */
function onProfileAzimuthChange(deg) {
  const v = Number(deg)
  if (!Number.isFinite(v)) return
  const layer = selectedProfileLayer.value
  if (layer) {
    layer.sliceAzimuthDeg = v
    refreshRunHistoryLayers()
    scheduleHistoryLayerDynamicRays(layer, 0)
    return
  }
  sliceAzimuthDeg.value = v
  syncSoundField()
  // 分析结果窗内的方位下拉也要同步体上的方位剖面帘
  scheduleSliceCurtain()
  scheduleRayDataForAzimuth(v, 0)
  scheduleBottomTypesForAzimuth(v, 0)
}

/**
 * 地形模式拖动方向方位线箭头：裁剪体开启时只更新裁剪方位（保留上次裁剪角度），
 * 关闭时按普通切换方位处理，刷新剖面与声线。
 */
function onTerrainArrowAzimuth(deg) {
  const v = normalizeAzimuth360(Number(deg) || 0)
  const layer = selectedProfileLayer.value
  if (layer) {
    if (Math.abs((Number(layer.sliceAzimuthDeg) || 0) - v) < 1e-6) return
    layer.sliceAzimuthDeg = v
    if (verticalSliceControls.clipBody) {
      // 裁剪体：拖拽时先更新体裁剪；停顿后再按新方位补算动态声线。
      lastClipAzimuthDeg = v
      scheduleHistoryLayerDynamicRays(layer, 240)
      return
    }
    scheduleHistoryLayerDynamicRays(layer, 0)
    return
  }
  if (Math.abs(sliceAzimuthDeg.value - v) < 1e-6) return
  sliceAzimuthDeg.value = v
  if (verticalSliceControls.clipBody) {
    // 裁剪体：拖拽时先更新体裁剪；停顿后再按新方位补算动态声线与底质。
    lastClipAzimuthDeg = v
    scheduleRayDataForAzimuth(v)
    scheduleBottomTypesForAzimuth(v)
    return
  }
  onAzimuthUiChange()
}

/** 滑块/下拉改变切面方位：体渲染立即响应，声线接口在停止操作后再调用。 */
function onAzimuthUiChange() {
  const layer = selectedProfileLayer.value
  if (layer) {
    const next = normalizeAzimuth360(Number(sliceAzimuthDeg.value) || 0)
    if (azimuthDeltaDeg(layer.sliceAzimuthDeg, next) > 1e-6) {
      layer.sliceAzimuthDeg = next
      refreshRunHistoryLayers()
      scheduleHistoryLayerDynamicRays(layer)
    }
    viewer?.scene?.requestRender?.()
    return
  }
  syncSoundField()
  scheduleSliceCurtain()
  scheduleRayDataForAzimuth(sliceAzimuthDeg.value)
  scheduleBottomTypesForAzimuth(sliceAzimuthDeg.value)
}

/** 控制面板切面方位滑杆：只在实际计算的方位之间按索引滑动。 */
function onSliceAzimuthSliderInput(event) {
  const index = Math.round(Number(event?.target?.value))
  const value = sliceAzimuthOptions.value[index]
  if (!Number.isFinite(value)) return
  if (Math.abs(sliceAzimuthDeg.value - value) < 1e-6) return
  sliceAzimuthDeg.value = value
  onAzimuthUiChange()
}

/** 数据筛选范围变化：限制在数据 TL 范围内并保证下限 < 上限 */
function onValueRangeChange() {
  const b = bounds.value
  const rawMin = Number(valueRange.value.min)
  const rawMax = Number(valueRange.value.max)
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return

  const lo0 = b ? Math.max(b.value.min, rawMin) : rawMin
  const hi0 = b ? Math.min(b.value.max, rawMax) : rawMax
  const lo = Math.min(lo0, hi0 - 1)
  const hi = Math.max(hi0, lo0 + 1)
  valueRange.value = { min: lo, max: hi }
  syncSoundField()
  scheduleOmni2dLayer()
}

/** 色标透明度区间手动输入：限制在 0~1，非法输入回落默认值 */
function onAlphaRangeChange() {
  const clamp01 = (v, fallback) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(1, Math.max(0, n))
  }
  valueAlphaRange.value = {
    min: clamp01(valueAlphaRange.value.min, DEFAULT_VALUE_ALPHA_RANGE[0] ?? 1),
    max: clamp01(valueAlphaRange.value.max, DEFAULT_VALUE_ALPHA_RANGE[1] ?? 0),
  }
  syncSoundField()
}

/** 色标范围变化：下限为红、上限为蓝，并保证下限 < 上限且不超出可选区间 */
function onColorRangeChange() {
  const rawMin = Number(colorRange.value.min)
  const rawMax = Number(colorRange.value.max)
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return

  const lo = Math.max(dbRangeMin.value, Math.min(Math.min(rawMin, rawMax - 1), dbRangeMax.value - 1))
  const hi = Math.min(dbRangeMax.value, Math.max(Math.max(rawMax, rawMin + 1), dbRangeMin.value + 1))
  colorRange.value = { min: lo, max: hi }
  // 主面板、侧边栏、区域地形体与垂直切面共用同一组色标范围。
  // 上面的 controls watcher 负责重绘三维体和二维全向层；profileDbRange
  // 则会让垂直切面用相同范围重新生成纹理。
  volumeRenderingControls.dbMin = lo
  volumeRenderingControls.dbMax = hi
}

function onDepthExagChange() {
  const next = Math.min(50, Math.max(0.5, Number(depthExaggeration.value) || 3))
  depthExaggeration.value = next
  if (Math.abs(Number(volumeRenderingControls.terrainExaggeration) - next) >= 1e-6) {
    volumeRenderingControls.terrainExaggeration = next
  }
  // The regional scene shares one display projection. Do not rebuild the hidden
  // globe's textures, rays or curtains on a terrain slider event.
  if (props.viewMode === 'terrain') return
  if (!soundField?.loaded || depthExagSyncRaf) return
  depthExagSyncRaf = requestAnimationFrame(() => {
    depthExagSyncRaf = 0
    if (!soundField?.loaded || props.viewMode === 'terrain') return
    volumeData.value = soundField.refinalize(Number(depthExaggeration.value))
    for (const layer of runHistoryLayers.value) {
      if (layer.renderer?.loaded) layer.renderer.refinalize(Number(depthExaggeration.value))
    }
    // 拖动过程中只更新体几何，声线/剖面帘依赖体几何，停止拖动后再统一重建。
    syncSoundField({ skipRayLines: true })
    clearTimeout(depthExagSyncTimer)
    depthExagSyncTimer = window.setTimeout(() => {
      depthExagSyncTimer = 0
      if (!soundField?.loaded || props.viewMode === 'terrain') return
      syncSoundField()
      scheduleSliceCurtain()
    }, 180)
  })
}

/**
 * 开始下一次三维计算前，把当前结果转成独立常驻图层。
 * 旧 SoundField 实例及其原始 TL 纹理继续保留；新计算使用新的实例，因此不会
 * 因 setVolume/destroy 覆盖上一声场，也不会重新执行旧任务。
 */
function archiveCurrent3dRun() {
  if (!soundField?.loaded || !raySourceData.value || !volumeData.value) return
  let field = null
  try { field = parseAnalyse3DTlrd(raySourceData.value) } catch { return }
  const rawSource = sourcePoint.value || terrainSource.value
  const source = {
    lon: Number(rawSource?.lon),
    lat: Number(rawSource?.lat),
    depth: Number(rawSource?.depth_m ?? rawSource?.depth) || 0,
  }
  if (!Number.isFinite(source.lon) || !Number.isFinite(source.lat)) return
  const id = `run-${Date.now()}-${runHistoryLayers.value.length + 1}`
  try {
    soundField.setAzimuthPointerVisible(false)
    soundField.setScatterPoints([])
    if (props.viewMode === 'terrain') soundField.releaseRenderer()
  } catch {}
  const layer = shallowReactive({
    id,
    jobId: currentJobId.value || undefined,
    field,
    // 保留本次声场的 GPU 体纹理，归档后仍由 GPU 光线步进渲染，不再退回 Canvas 面片。
    texture: currentVolumeTexture || null,
    source,
    radiusKm: Math.max(.1, Number(sourceRadiusKm.value) || Number(terrainRadiusKm.value) || 20),
    visible: true,
    accent: JOB_LAYER_ACCENTS[runHistoryLayers.value.length % JOB_LAYER_ACCENTS.length],
    renderer: soundField,
    panelVisible: true,
    panelMinimized: terrainRunMinimized.value,
    time: terrainRunTime.value,
    anchor: terrainAnchor.value ? { ...terrainAnchor.value } : null,
    // 供历史声场胶囊重新运行与查看二维传播损失。
    params: JSON.parse(JSON.stringify(calcParams.value)),
    rayInterface: calcParams.value.rayInterface,
    rayData: staticRayData.value,
    rayAzimuthDeg: sliceAzimuthDeg.value,
    sliceAzimuthDeg: sliceAzimuthDeg.value,
    sourceRadiusKm: sourceRadiusKm.value,
    sourceDepthM: Number(sourcePoint.value?.depth_m ?? calcParams.value.srcDepth),
    bottomTypeSegments: [...bottomTypeSegments.value],
    bottomTypeState: bottomTypeState.value,
  })
  if (terrainRunMinimized.value) {
    runPanelDockOrder.value = runPanelDockOrder.value.map(item => item === CURRENT_RUN_PANEL_ID ? id : item)
  } else {
    removeRunPanelFromDock(CURRENT_RUN_PANEL_ID)
  }
  // 用户未主动关闭前始终保留；不按数量自动淘汰状态窗口或对应声场。
  runHistoryLayers.value = [...runHistoryLayers.value, layer]
  currentJobId.value = ''
  // 再次计算后保持原声场为活动对象：方向方位线 / 剖切继续落在刚归档的声场上，
  // 新结果作为独立图层显示；只有点击该图层的「二维切面」按钮才切到新声场。
  if (!selectedProfileLayerId.value) {
    selectedProfileLayerId.value = id
  }
  soundField = viewer ? new SoundField(viewer, { depthExaggeration: depthExaggeration.value }) : null
}

function submitCalculation() {
  activeMapPick.value = ''
  if (analysisMode.value === '3d') archiveCurrent3dRun()
  currentJobId.value = ''
  if (props.viewMode === 'terrain' && analysisMode.value === '3d') {
    terrainRunVisible.value = true
    terrainRunMinimized.value = false
    removeRunPanelFromDock(CURRENT_RUN_PANEL_ID)
    terrainAnchor.value = null
    terrainRunTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    terrainSource.value = { lon: Number(calcParams.value.coordX), lat: Number(calcParams.value.coordY), depth: Number(calcParams.value.srcDepth) }
    terrainRadiusKm.value = Number(calcParams.value.range) * 1.852
    parameterPanelOpen.value = false
  }
  return analysisMode.value === '3d' ? loadData() : load2dData()
}

function scenarioDuration() {
  return Math.max(1, Number(noiseParams.value.timeFrequencyScenario?.durationS) || 60)
}

function nextScenarioWindow(items, width = 8) {
  const duration = scenarioDuration()
  const lastEnd = Array.isArray(items) && items.length ? Number(items[items.length - 1]?.endS) : 0
  const startS = Math.min(Math.max(0, Number.isFinite(lastEnd) ? lastEnd + 2 : 0), Math.max(0, duration - width))
  return { startS, endS: Math.min(duration, startS + width) }
}

function addWindControlPoint() {
  const scenario = noiseParams.value.timeFrequencyScenario
  const points = scenario.windControlPoints
  const last = points.length ? points[points.length - 1] : null
  points.push({
    timeS: Math.min(scenarioDuration(), (Number(last?.timeS) || 0) + 10),
    level: Math.max(0, Math.min(12, Math.round(Number(last?.level) || Number(noiseParams.value.windSpeed) || 4))),
  })
}

function addRainEvent() {
  const events = noiseParams.value.timeFrequencyScenario.rainEvents
  events.push({ ...nextScenarioWindow(events), level: Math.max(0, Math.min(6, Math.round(Number(noiseParams.value.rainIntensity) || 2))) })
}

function addShipEvent() {
  const events = noiseParams.value.timeFrequencyScenario.shipEvents
  events.push({
    ...nextScenarioWindow(events, 12),
    level: Math.max(1, Math.min(5, Math.round(Number(noiseParams.value.shipDensityLevel) || 3))),
    fundamentalHz: 81,
    harmonicCount: 4,
  })
}

function removeScenarioItem(collection, index) {
  const items = noiseParams.value.timeFrequencyScenario?.[collection]
  if (Array.isArray(items)) items.splice(index, 1)
}

function resetNoiseScenario() {
  noiseParams.value.timeFrequencyScenario = createDefaultNoiseScenario(
    noiseParams.value.windSpeed,
    noiseParams.value.shipDensityLevel,
    'normal'
  )
}

function clearNoiseScenarioEvents() {
  const scenario = noiseParams.value.timeFrequencyScenario
  scenario.rainEvents = []
  scenario.shipEvents = []
  scenario.iceCrackEvents = []
}

function noisePortalPayload() {
  const p = noiseParams.value
  const minFreq = Number(p.minFreq)
  const maxFreq = Number(p.maxFreq)
  if (!(minFreq > 0) || !(maxFreq > minFreq)) {
    throw new Error('频率范围无效：最大频率必须大于最小频率，且最小频率大于 0 Hz')
  }
  const levels = {
    shipDensityLevel: Math.round(Number(p.shipDensityLevel)),
    windSpeed: Math.round(Number(p.windSpeed)),
    rainIntensity: Math.round(Number(p.rainIntensity)),
    minFreq,
    maxFreq,
    numPoints: Math.max(2, Math.round(Number(p.numPoints) || 2)),
    timeFrequency: p.timeFrequencyScenario,
  }
  return levels
}

/** 提交非冰区环境噪声计算。 */
async function submitNoiseCalculation() {
  activeMapPick.value = ''
  loading.value = true
  loadingMessage.value = '正在调用环境噪声门户接口…'
  errorText.value = ''
  runtimeError.value = ''
  statusText.value = ''

  try {
    const scenarioErrors = validateNoiseScenario(noiseParams.value.timeFrequencyScenario, 'normal')
    if (scenarioErrors.length) throw new Error(`时频合成参数无效：${scenarioErrors[0]}`)
    const json = await analyseEnvironmentNoise(noisePortalPayload())
    const response = portalUnitResponse(json)
    if (!response || (!Array.isArray(response.freq) && !response.noiseSpectrum && !response.depthProfile)) {
      throw new Error('环境噪声接口返回格式无效')
    }
    noiseResult.value = response
    noiseResultParams.value = cloneNoiseParameters(noiseParams.value)
    noiseResultOutdated.value = false
    publishEnvironmentNoise(response, noiseParams.value, 'normal')
    cleanGlobeView.value = false
    parameterPanelOpen.value = false
    resultPanelOpen.value = true
    refreshPickMarkers()
    const noiseJobId = String(json?.Data?.TaskId || '').trim()
    if (noiseJobId) {
      void attachResultToActiveWorkspace({
        kind: 'noise',
        jobId: noiseJobId,
        params: cloneNoiseParameters(noiseParams.value),
        label: '环境噪声工作区',
      })
    }
  } catch (err) {
    console.error('[Environment Noise]', err)
    errorText.value = err?.message || String(err)
  } finally {
    loading.value = false
    loadingMessage.value = ''
  }
}

function resetNoiseParameters() {
  noiseParams.value = {
    dataset: 'HYCOM',
    time: timeOptions.value[0] || '2025-01-02T12:00:00',
    regionType: 'normal',
    receiverX: 132.5135,
    receiverY: 83.275,
    depth: 30,
    shipDensityLevel: 3,
    windSpeed: 4,
    rainIntensity: 2,
    minFreq: 10,
    maxFreq: 1000,
    numPoints: 100,
    timeFrequencyScenario: createDefaultNoiseScenario(4, 3, 'normal'),
  }
  noiseResultOutdated.value = Boolean(noiseResult.value)
  clearEnvironmentNoise()
  activeMapPick.value = ''
  refreshPickMarkers()
}

/** 按参数面板的选择调用静态 / 动态二维声线接口。请求体完全一致。 */
function request2dRay(payload, ice) {
  if (useDynamicRays.value) {
    return ice ? analyseIce2dDynamicRTRD(payload) : analyse2dDynamicRTRD(payload)
  }
  return ice ? analyseIce2dRTRD(payload) : analyse2dRTRD(payload)
}

async function load2dData() {
  loading.value = true
  loadingMessage.value = '正在调用二维传播损失与声线门户接口…'
  errorText.value = ''
  runtimeError.value = ''
  statusText.value = ''
  clearResultLayers({ preserveVolume: true })

  try {
    const azimuth = routeBearingDeg.value
    const receiverRangeNm = Math.max(0.1, routeDistanceNm.value)
    // 接收阵位于航路终点。计算范围留 8% 余量，避免阵元横向展开后落到
    // Bellhop TL 场边缘之外（通信静态信道会复用该任务）。
    const fieldRangeNm = Math.max(receiverRangeNm * 1.08, receiverRangeNm + 0.1)
    const payload = commonPortalParams({
      range: fieldRangeNm,
      azimuth,
      lineCount: Number(calcParams.value.lineCount),
      rtimeRes: 0,
    })
    const ice = calcParams.value.regionType === 'ice'
    const tlJson = await analyse2dTLRDByModel(payload, calcParams.value.model, ice)
    let rayJson = null
    if (isRayModel.value) {
      const rayPayload = { ...payload }
      await attachRayTerrainProfile(rayPayload, calcParams.value, azimuth, fieldRangeNm)
      rayJson = await request2dRay(rayPayload, ice)
    }

    raySourceData.value = adapt2dTlResponse(tlJson, azimuth)
    staticRayData.value = rayJson
    sourcePoint.value = {
      lon: Number(calcParams.value.coordX),
      lat: Number(calcParams.value.coordY),
      depth_m: Number(calcParams.value.srcDepth),
    }
    sourceRadiusKm.value = fieldRangeNm * 1.852
    sliceAzimuthDeg.value = azimuth
    availableAzimuths.value = [azimuth]
    const defaultReceiver = {
      lon: Number(calcParams.value.receiverX),
      lat: Number(calcParams.value.receiverY),
      depthM: Number(noiseParams.value.depth),
      rangeM: receiverRangeNm * 1852,
      bearingDeg: azimuth,
    }
    receiverArrayMarker.value = { ...defaultReceiver }
    syncEnvironmentNoiseReceiver(defaultReceiver)
    publishPropagationLink({
      bellhopJobId: isRayModel.value ? String(tlJson?.Data?.TaskId || '').trim() : '',
      rayJobId: isRayModel.value ? String(rayJson?.Data?.TaskId || '').trim() : '',
      rayInterface: calcParams.value.rayInterface,
      reusable: isRayModel.value,
      model: calcParams.value.model,
      ice,
      source: {
        lon: Number(calcParams.value.coordX),
        lat: Number(calcParams.value.coordY),
        depthM: Number(calcParams.value.srcDepth),
      },
      receiver: defaultReceiver,
      frequencyHz: Number(calcParams.value.minFreq),
      maxRangeM: fieldRangeNm * 1852,
      bearingDeg: azimuth,
      portalParams: payload,
    })
    void loadBottomTypesForRoute({ bearingDeg: azimuth, distanceM: fieldRangeNm * 1852 })
    statusText.value = ``
    render2dFieldOnEarth(raySourceData.value)
    focus2dField()
    cleanGlobeView.value = false
    parameterPanelOpen.value = false
    resultPanelOpen.value = true
    const tlJobId = String(tlJson?.Data?.TaskId || '').trim()
    const rayJobId = String(rayJson?.Data?.TaskId || '').trim()
    if (tlJobId) {
      void attachResultToActiveWorkspace({
        kind: '2d',
        jobId: tlJobId,
        rayJobId: rayJobId || undefined,
        azimuth: Number(azimuth) || routeBearingDeg.value,
        params: cloneWorkspacePlain(calcParams.value),
        receiver: { ...defaultReceiver },
        label: `${selectedModelLabel.value}二维声场工作区`,
      })
    }
  } catch (err) {
    console.error('[2D SoundField]', err)
    errorText.value = err?.message || String(err)
    clearResultLayers({ preserveVolume: true })
  } finally {
    loading.value = false
    loadingMessage.value = ''
  }
}

/** 构造覆盖声源传播半径的区域查询边界。 */
function seaIceQueryBounds(lonDeg, latDeg, rangeNm) {
  const radiusM = Math.max(1, Number(rangeNm) || 0) * 1852
  const latSpan = radiusM / 111320
  const lonSpan = latSpan / Math.max(0.05, Math.cos(Number(latDeg) * Math.PI / 180))
  const west = Math.max(-180, Number(lonDeg) - lonSpan)
  const east = Math.min(180, Number(lonDeg) + lonSpan)
  const south = Math.max(-89.9, Number(latDeg) - latSpan)
  const north = Math.min(89.9, Number(latDeg) + latSpan)
  if (!(east > west && north > south)) return null
  return {
    bottomLeftX: west,
    bottomLeftY: south,
    topRightX: east,
    topRightY: north,
  }
}

/**
 * 三维声场运行前查询声源及半径覆盖范围内的海冰厚度。
 * 非陆地值（9999 为陆地/缺测）中存在 >0 的冰厚即按冰区计算。
 * 海区判定与声学模型无关：RAM/KRAKEN 也必须在点选位置后切换到
 * 各自的冰区 / 非冰区三维 Plugin。
 */
async function detectSeaIceRegion(params) {
  const lon = Number(params.coordX)
  const lat = Number(params.coordY)
  const rangeNm = Number(params.range)
  if (![lon, lat, rangeNm].every(Number.isFinite) || rangeNm <= 0) {
    return params.regionType === 'ice' ? 'ice' : 'normal'
  }
  const bounds = seaIceQueryBounds(lon, lat, rangeNm)
  if (!bounds) return params.regionType === 'ice' ? 'ice' : 'normal'
  try {
    const response = await getEnvDataRegion({
      dataSource: params.dataset,
      dataType: 'DT_ENV_ICE_THICKNESS',
      time: normalizePortalTime(params.time),
      timeRes: 0,
      z: 0,
      ...bounds,
    })
    const grid = response?.Data?.Units?.[0]?.Response?.data
    let hasSeaIce = false
    for (const row of Array.isArray(grid) ? grid : []) {
      for (const value of Array.isArray(row) ? row : []) {
        const thickness = Number(value)
        if (Number.isFinite(thickness) && Math.abs(thickness - 9999) > 1e-9 && thickness > 0) {
          hasSeaIce = true
          break
        }
      }
      if (hasSeaIce) break
    }
    return hasSeaIce ? 'ice' : 'normal'
  } catch (error) {
    console.warn('[海冰检测] 区域冰厚查询失败，沿用当前海区设置：', error?.message ?? error)
    return params.regionType === 'ice' ? 'ice' : 'normal'
  }
}

async function detectModelSeaIce() {
  calcParams.value.regionType = await detectSeaIceRegion(calcParams.value)
  detectedSeaIce.value = calcParams.value.regionType === 'ice'
}

async function loadData(precomputed = null) {
  loading.value = true
  errorText.value = ''
  runtimeError.value = ''
  buildProgress.value = 0
  // 重新加载前先撤掉旧的二维声场贴图，并清空上次的静态声线（改用新参数重新计算）
  clearOmni2dLayer()
  clearTwoDMapFeatures()
  staticRayData.value = null
  dynamicRaysActivated.value = false
  dynamicRayLoading.value = false
  stopVolumeRayAnimation()
  rayDataByAzimuth.clear()
  ray3dByAzimuth.static.clear()
  ray3dByAzimuth.dynamic.clear()
  ray3dRequest = null
  ray3dToken++
  rayRequestByKey.clear()
  rayLoadToken++
  clearTimeout(rayLoadTimer)
  rayLoadTimer = 0
  bottomTypeToken++
  clearTimeout(bottomTypeTimer)
  bottomTypeTimer = 0
  bottomTypeSegments.value = []
  bottomTypeState.value = 'idle'
  if (precomputed?.response) {
    calcParams.value.regionType = precomputed.regionType === 'ice' ? 'ice' : 'normal'
    detectedSeaIce.value = calcParams.value.regionType === 'ice'
  } else {
    loadingMessage.value = '检查声源区域海冰覆盖…'
    await detectModelSeaIce()
  }
  loadingMessage.value = '调用声场计算接口…'

  if (!soundField) {
    errorText.value = 'Cesium 未就绪，请稍后重试'
    loading.value = false
    return
  }

  // 三维体使用「真实水深」模式（不抬升），与二维剖面帘的抬升显示相互独立
  soundField.displayAboveWater = false

  try {
    // 重新加载前先清理旧的体渲染 primitive 与声线，
    // 确保 db=0/null 等无效值裁剪后能彻底重建纹理并重新渲染。
    if (soundField.loaded) {
      soundField.destroy()
      soundField = new SoundField(viewer, { depthExaggeration: depthExaggeration.value })
    }
    // 新计算不再保留上一组三维结果。否则旧的原始/解析数据、RGBA 纹理和缓存
    // 会一直活到下一次维度切换，并与本次解码峰值叠加。
    soundResultCache['3d'] = null
    volumeData.value = null
    raySourceData.value = null
    currentVolumeTexture = null
    terrainTexture.value = null

    await loadTlrdData(precomputed?.response || null)

    volumeData.value = soundField.volume
    valueRange.value = { min: VOLUME_TL_COLOR_MIN, max: VOLUME_TL_COLOR_MAX }
    colorRange.value = {
      min: Number(volumeRenderingControls.dbMin),
      max: Number(volumeRenderingControls.dbMax),
    }
    valueAlphaRange.value = {
      min: DEFAULT_VALUE_ALPHA_RANGE[0] ?? 1,
      max: DEFAULT_VALUE_ALPHA_RANGE[1] ?? 0,
    }
    // FOM 门限恢复为 200（全部显示）
    fomValue.value = 200
    volumeRenderingControls.volumeVisible = true
    volumeVisible.value = true
    cleanGlobeView.value = false
    earthRaysVisible.value = true
    earthRaysVisibleBeforeGlobe = null
    pointerEnabled.value = true

    syncSoundField()
    // 按当前单 / 多方位切面状态重建剖面帘
    updateSliceCurtain()
    // 数据就绪后再挂声源点上方方位指针（依赖 volume 的顶点高度与传播半径）
    setupAzimuthPointer()
    applyPointerVisibility()
    // 二维声场：回到默认第 0 层（海面）并贴到球面
    omni2dDepthIndex.value = 0
    syncOmni2dLayer()
    // 地形沙盘在标注位置运行时保持当前取景，不飞全球相机（全球画布隐藏，无需飞行）。
    if (props.viewMode !== 'terrain') soundField.flyToOverview(0.9)
    soundField.requestRender()
    cleanGlobeView.value = false
    parameterPanelOpen.value = false
    resultPanelOpen.value = true
  } catch (err) {
    console.error('[NcVolume]', err)
    errorText.value = err?.message || String(err)
    soundField?.destroy()
    volumeData.value = null
    raySourceData.value = null
    currentVolumeTexture = null
    terrainTexture.value = null
  } finally {
    loading.value = false
    buildProgress.value = 0
    loadingMessage.value = ''
  }
}

function nearestAvailableAzimuth(value) {
  const target = normalizeAzimuth360(Number(value) || 0)
  if (!availableAzimuths.value.length) return target
  return availableAzimuths.value.reduce((best, candidate) => {
    const diff = Math.abs(normalizeAzimuth360(candidate) - target)
    const bestDiff = Math.abs(normalizeAzimuth360(best) - target)
    return Math.min(diff, 360 - diff) < Math.min(bestDiff, 360 - bestDiff) ? candidate : best
  }, availableAzimuths.value[0])
}

/**
 * 读取当前传播损失扇面的声线响应。非三维声线路径按扇面独立请求并缓存，
 * 避免把一个固定方位的声线错误地复用到所有 TL 剖面上。
 */
/** 按方位读取缓存的声线响应（三维动态声线优先）。 */
function getCachedRayResponse(azimuthDeg, interfaceTag = calcParams.value.rayInterface) {
  const matched = nearestAvailableAzimuth(azimuthDeg)
  const key = matched.toFixed(4)
  if (use3dRays.value) {
    const bucket = ray3dByAzimuth[interfaceTag === 'static' ? 'static' : 'dynamic']
    return bucket?.get(key) ?? null
  }
  return rayDataByAzimuth.get(`${key}:${interfaceTag}`) ?? null
}

/** 一次调用三维动态声线接口（冰区 / 非冰区），返回全部扇面的静态与动态声线。 */
async function ensure3dRayData() {
  if (!use3dRays.value) return false
  if (ray3dByAzimuth.static.size && ray3dByAzimuth.dynamic.size) return true
  if (ray3dRequest) {
    try {
      await ray3dRequest
    } catch {}
    return ray3dByAzimuth.dynamic.size > 0
  }
  const requestToken = ++ray3dToken
  const payload = commonPortalParams({
    range: Number(calcParams.value.range),
    minFreq: Number(calcParams.value.minFreq),
    maxFreq: Number(calcParams.value.maxFreq),
    sector: Number(calcParams.value.sector),
    lineCount: Number(calcParams.value.lineCount),
  })
  const ice = calcParams.value.regionType === 'ice'
  ray3dRequest = ice ? analyseIce3dDynamicRTRD(payload) : analyse3dDynamicRTRD(payload)
  try {
    const response = await ray3dRequest
    if (requestToken !== ray3dToken) return false
    const adapted = adapt3dRayResponseToAzimuths(response)
    if (!adapted?.byAzimuth?.size) return false
    ray3dByAzimuth.static.clear()
    ray3dByAzimuth.dynamic.clear()
    for (const [portalAzimuth, entry] of adapted.byAzimuth) {
      const internalAzimuth = nearestAvailableAzimuth(
        compassBearingToInternalAzimuth(portalAzimuth)
      )
      const key = internalAzimuth.toFixed(4)
      ray3dByAzimuth.static.set(key, entry.staticResponse)
      ray3dByAzimuth.dynamic.set(key, entry.dynamicResponse)
    }
    return true
  } finally {
    ray3dRequest = null
  }
}

async function ensureRayDataForAzimuth(azimuthDeg) {
  if (!isRayModel.value) {
    staticRayData.value = null
    return null
  }
  if (use3dRays.value) {
    const loaded = await ensure3dRayData()
    if (!loaded) {
      staticRayData.value = null
      return null
    }
    const matchedAzimuth = nearestAvailableAzimuth(azimuthDeg)
    const result = getCachedRayResponse(matchedAzimuth)
    staticRayData.value = result
    if (analysisMode.value === '3d' && soundField?.volume) {
      refreshVolumeRayScatterPoints()
      soundField.syncRayLines()
      startVolumeRayAnimation()
    }
    if (analysisMode.value === '3d' && sliceEnabled.value) {
      startSliceRayAnimation()
    }
    return result
  }
  const matchedAzimuth = nearestAvailableAzimuth(azimuthDeg)
  const key = `${matchedAzimuth.toFixed(4)}:${calcParams.value.rayInterface}`
  if (rayDataByAzimuth.has(key)) {
    const cached = rayDataByAzimuth.get(key)
    rememberRayData(key, cached)
    staticRayData.value = cached
    return staticRayData.value
  }

  if (rayRequestByKey.has(key)) {
    const pending = await rayRequestByKey.get(key)
    staticRayData.value = pending
    return pending
  }

  const requestToken = ++rayLoadToken
  const portalBearing = internalAzimuthToCompassBearing(matchedAzimuth)
  const payload = commonPortalParams({
    range: Number(calcParams.value.range),
    minFreq: Number(calcParams.value.minFreq),
    maxFreq: Number(calcParams.value.maxFreq),
    azimuth: portalBearing,
    lineCount: Number(calcParams.value.lineCount),
    rtimeRes: 0,
  })
  const pendingRequest = (async () => {
    await attachRayTerrainProfile(
      payload,
      calcParams.value,
      portalBearing,
      Number(calcParams.value.range)
    )
    return request2dRay(payload, calcParams.value.regionType === 'ice')
  })()
  rayRequestByKey.set(key, pendingRequest)
  let result
  try {
    result = await pendingRequest
  } finally {
    if (rayRequestByKey.get(key) === pendingRequest) rayRequestByKey.delete(key)
  }
  if (requestToken !== rayLoadToken) return null
  rememberRayData(key, result)
  const currentKey = `${nearestAvailableAzimuth(sliceAzimuthDeg.value).toFixed(4)}:${calcParams.value.rayInterface}`
  if (requestToken === rayLoadToken && currentKey === key) {
    staticRayData.value = result
  }
  // 三维体上的声线随新完成的扇面同步更新。
  if (analysisMode.value === '3d' && soundField?.volume) {
    refreshVolumeRayScatterPoints()
    soundField.syncRayLines()
    startVolumeRayAnimation()
  }
  // 剖面帘上的动态声线也随新数据重建（切面已启用时）。
  if (analysisMode.value === '3d' && sliceEnabled.value) {
    startSliceRayAnimation()
  }
  return result
}

function scheduleRayDataForAzimuth(azimuthDeg, delay = 320) {
  if (!(dynamicRaysActivated.value || verticalSliceControls.staticRays)) return
  if (!isRayModel.value || analysisMode.value !== '3d' || !raySourceData.value || !availableAzimuths.value.length) return
  clearTimeout(rayLoadTimer)
  const matched = nearestAvailableAzimuth(azimuthDeg)
  const cached = getCachedRayResponse(matched)
  // 切换到未计算方位时先清空旧声线，避免等待接口期间把上一方位误标成当前方位。
  staticRayData.value = cached ?? null
  stopVolumeRayAnimation()
  if (cached) startVolumeRayAnimation()
  rayLoadTimer = setTimeout(async () => {
    rayLoadTimer = 0
    try {
      await ensureRayDataForAzimuth(matched)
    } catch (error) {
      console.warn('[声线展示图] 当前方位声线不可用：', error?.message ?? error)
      staticRayData.value = null
    }
  }, Math.max(0, Number(delay) || 0))
}

/**
 * 「二维传播损失」按钮的声线计算入口。这个流程固定使用动态声线
 * 接口，计算结果同时驱动三维体与二维方位剖面的同相位动画。
 */
async function activateDynamicRaysForCurrentAzimuth() {
  if (!isRayModel.value || analysisMode.value !== '3d' || !raySourceData.value) return
  dynamicRaysActivated.value = true
  if (calcParams.value.rayInterface !== 'dynamic') calcParams.value.rayInterface = 'dynamic'
  dynamicRayLoading.value = true
  errorText.value = ''
  statusText.value = ''
  try {
    const result = await ensureRayDataForAzimuth(sliceAzimuthDeg.value)
    staticRayData.value = result
    startVolumeRayAnimation()
    statusText.value = ''
    chartRefreshToken.value += 1
  } catch (error) {
    console.warn('[动态声线]', error?.message ?? error)
    errorText.value = `动态声线计算失败：${error?.message ?? error}`
    staticRayData.value = null
  } finally {
    dynamicRayLoading.value = false
  }
}

/** 底质缓存必须绑定声源、方位、距离、数据集和时间，避免换位置后复用旧分段。 */
function bottomTypeCacheKey(bearingDeg, distanceM) {
  const bearing = ((((Number(bearingDeg) || 0) % 360) + 360) % 360).toFixed(2)
  const lon = Number(calcParams.value.coordX)
  const lat = Number(calcParams.value.coordY)
  const range = Math.round(Math.max(0, Number(distanceM) || 0))
  return [
    bearing,
    lon.toFixed(6),
    lat.toFixed(6),
    range,
    calcParams.value.dataset,
    calcParams.value.time,
  ].join('|')
}

/** 当前结果沿航线的最大距离（米）。 */
function currentBottomTypeRangeM() {
  const radiusM = Number(sourceRadiusKm.value) * 1000
  if (Number.isFinite(radiusM) && radiusM > 0) return radiusM
  const rangeNm =
    analysisMode.value === '2d' ? routeDistanceNm.value : Number(calcParams.value.range)
  return Math.max(0, Number(rangeNm) || 0) * 1852
}

/**
 * 查询航线上的底质类型（DT_ENV_GEOACOUSTIC_CLASSID），并转换为距离分段。
 * 查询失败不影响主声场结果，只把标注状态置为 error。
 */
async function loadBottomTypesForRoute({ bearingDeg, distanceM } = {}) {
  const sourceLon = Number(calcParams.value.coordX)
  const sourceLat = Number(calcParams.value.coordY)
  const totalM = Math.max(0, Number(distanceM) || 0)
  if (![sourceLon, sourceLat].every(Number.isFinite) || !(totalM > 0)) {
    bottomTypeSegments.value = []
    bottomTypeState.value = 'idle'
    return []
  }

  const bearing = (((Number(bearingDeg) || 0) % 360) + 360) % 360
  const cacheKey = bottomTypeCacheKey(bearing, totalM)
  const cached = bottomTypeByAzimuth.get(cacheKey)
  if (cached) {
    bottomTypeToken++
    bottomTypeSegments.value = cached
    bottomTypeState.value = 'ready'
    return cached
  }

  const token = ++bottomTypeToken
  bottomTypeState.value = 'loading'
  const routePoints = buildRoutePoints(
    sourceLon,
    sourceLat,
    bearing,
    totalM,
    BOTTOM_TYPE_ROUTE_SAMPLE_COUNT
  )
  try {
    const json = await getEnvDataRoute({
      dataSource: calcParams.value.dataset,
      dataType: BOTTOM_TYPE_DATA_TYPE,
      time: normalizePortalTime(calcParams.value.time),
      timeRes: 0,
      points: routePoints,
    })
    const segments = buildBottomTypeSegments(json, {
      fallbackDistanceM: totalM,
      routePoints,
    })
    const propertyEntries = Object.entries(BOTTOM_ACOUSTIC_DATA_TYPES)
    const propertyResults = await Promise.allSettled(
      propertyEntries.map(([, dataType]) => getEnvDataRoute({
        dataSource: calcParams.value.dataset,
        dataType,
        time: normalizePortalTime(calcParams.value.time),
        timeRes: 0,
        points: routePoints,
      }))
    )
    const propertyPayloads = {}
    propertyResults.forEach((result, index) => {
      if (result.status === 'fulfilled') propertyPayloads[propertyEntries[index][0]] = result.value
    })
    const enrichedSegments = enrichBottomTypeSegments(segments, propertyPayloads, {
      fallbackDistanceM: totalM,
      routePoints,
    })
    if (token !== bottomTypeToken) return enrichedSegments
    bottomTypeByAzimuth.set(cacheKey, enrichedSegments)
    bottomTypeSegments.value = enrichedSegments
    bottomTypeState.value = 'ready'
    return enrichedSegments
  } catch (error) {
    if (token !== bottomTypeToken) return []
    console.warn('[底质标注] 航线底质类型查询失败：', error?.message ?? error)
    bottomTypeSegments.value = []
    bottomTypeState.value = 'error'
    return []
  }
}

/** 三维剖面切换方位后，按新方位重新查询底质分段（带缓存与节流）。 */
function scheduleBottomTypesForAzimuth(azimuthDeg, delay = 260) {
  if (analysisMode.value !== '3d' || !raySourceData.value) return
  clearTimeout(bottomTypeTimer)
  const bearing = internalAzimuthToCompassBearing(Number(azimuthDeg) || 0)
  const distanceM = currentBottomTypeRangeM()
  const cacheKey = bottomTypeCacheKey(bearing, distanceM)
  const cached = bottomTypeByAzimuth.get(cacheKey)
  if (cached) {
    bottomTypeToken++
    bottomTypeSegments.value = cached
    bottomTypeState.value = 'ready'
    return
  }
  // 方位、声源或距离已经改变，旧标注不再适用；先清空并提示加载中。
  bottomTypeToken++
  bottomTypeSegments.value = []
  bottomTypeState.value = 'loading'
  bottomTypeTimer = setTimeout(() => {
    bottomTypeTimer = 0
    void loadBottomTypesForRoute({ bearingDeg: bearing, distanceM })
  }, Math.max(0, Number(delay) || 0))
}

/**
 * 提交门户前用当前数字地球地形校验声源位置和水深。
 * 这类参数错误原本会被门户包装成 HTTP 500；在本地即可确定时直接拦截，
 * 同时保留门户校验作为地形不可用或两套环境数据存在差异时的最终兜底。
 */
async function validateSourceDepthAgainstTerrain(params = calcParams.value) {
  const provider = viewer?.scene?.terrainProvider
  // 椭球地形或没有瓦片可用性的提供器无法做 sampleTerrainMostDetailed，
  // 直接交给门户校验，避免每次计算都打印警告。
  if (!canSampleTerrain(provider)) return

  const lon = Number(params.coordX)
  const lat = Number(params.coordY)
  const sourceDepth = Number(params.srcDepth)
  if (![lon, lat, sourceDepth].every(Number.isFinite)) return

  try {
    const positions = [Cesium.Cartographic.fromDegrees(lon, lat)]
    const sampled = await Cesium.sampleTerrainMostDetailed(provider, positions)
    const terrainHeight = Number(sampled?.[0]?.height)
    if (!Number.isFinite(terrainHeight)) return
    // 部分海域在瓦片尚无海底高程时会返回 0 m，不能据此判成陆地。
    if (terrainHeight > 1) {
      throw new Error(`声源位置位于陆地（地形高程 ${terrainHeight.toFixed(1)} m），请调整到海域。`)
    }
    // -1~1 m 视为“只有海面、暂无可靠海底高程”，此时不能拿 0 m 当当地水深。
    if (terrainHeight >= -1) return
    const waterDepth = -terrainHeight
    if (sourceDepth >= waterDepth) {
      const suggested = Math.max(1, Math.floor(waterDepth * 0.9))
      throw new Error(
        `声源深度 ${sourceDepth.toFixed(1)} m 不小于当前位置水深 ${waterDepth.toFixed(1)} m，请设为小于水深的数值（建议不超过 ${suggested} m）。`
      )
    }
  } catch (error) {
    // 业务校验错误需要交给页面显示；地形瓦片网络/解析失败则由门户继续兜底。
    if (/声源位置位于陆地|声源深度/.test(error?.message ?? '')) throw error
    console.warn('[声源水深预检] 数字地球地形不可用，改由门户校验：', error?.message ?? error)
  }
}

/** 按当前模型与海区调用对应接口，计算「标准格式」三维声场。 */
async function loadTlrdData(precomputedResponse = null) {
  let tlrdJson = precomputedResponse
  if (!tlrdJson) {
    loadingMessage.value = '校验声源位置与当地水深…'
    await validateSourceDepthAgainstTerrain()
    const payload = commonPortalParams({
      range: Number(calcParams.value.range),
      minFreq: Number(calcParams.value.minFreq),
      maxFreq: Number(calcParams.value.maxFreq),
      sector: Number(calcParams.value.sector),
    })
    const ice = calcParams.value.regionType === 'ice'
    tlrdJson = await analyse3dTLRDByModel(payload, calcParams.value.model, ice)
  }
  const completedJobId = String(tlrdJson?.Data?.TaskId || '').trim()
  const parsed = parseAnalyse3DTlrd(tlrdJson)
  // 图表与切面均可直接消费解析后的紧凑模型。尽早断开原始多层数组引用，避免
  // 它在后续地形采样和声线请求期间与 Float32/RGBA 体同时占用数 GB 内存。
  raySourceData.value = parsed
  tlrdJson = null
  // 可用方位是三维 TL 各扇区中心。内部约定为正东 0°、逆时针；
  // 表单的门户罗盘方位先转换后吸附到最近扇面，确保 TL 与声线选中同一方向。
  availableAzimuths.value = tlrdSectorAzimuths(parsed.grid.sector, parsed.grid.compassBearings)
  sliceAzimuthDeg.value = nearestAvailableAzimuth(
    compassBearingToInternalAzimuth(Number(calcParams.value.azimuth))
  )
  // 声源经纬度使用表单输入的 coordX / coordY
  // 默认连续采样以匹配二维 TL 伪彩图；仅在检查原始节点时禁用插值。
  const strictNearest = volumeRenderingControls.strictNearest === true
  const texture = decodeTlrdPolarVolume(parsed, {
    sourceLon: Number(calcParams.value.coordX),
    sourceLat: Number(calcParams.value.coordY),
    angleInterp: strictNearest ? 1 : TLRD_ANGLE_INTERP,
    strictNearest,
  })

  // 后端 altitudeList 负责海底裁剪；数字地球地形再负责扇区之间的真实陆地/岸线裁剪。
  let terrainMask = null
  try {
    loadingMessage.value = '依据数字地球地形裁剪陆地与海底…'
    terrainMask = await maskVolumeByTerrain(texture, viewer?.scene?.terrainProvider)
  } catch (e) {
    console.warn('[三维声场地形掩膜] 地形采样不可用，保留接口海底掩膜：', e?.message ?? e)
  }
  currentVolumeTexture = texture
  terrainTexture.value = texture
  // 地形、声场、声源、声线和切面共用侧边栏的唯一垂直夸张倍率。
  // 不再根据水深自动改写倍率，因此 1× 始终代表真实物理比例。
  depthExaggeration.value = Math.min(50, Math.max(0.5, Number(volumeRenderingControls.terrainExaggeration) || 3))
  soundField.depthExaggeration = depthExaggeration.value
  // 地形预览使用自己的 WebGL GPU 体渲染；全球视图的 Cesium 体渲染器在
  // 地形模式下由 syncSoundField() 释放，不会常驻 GPU。这里仍保留 CPU 侧的
  // 体对象，供 UI 就绪状态、切面和返回全球视图时复用。
  soundField.setVolume(texture, (raw) => raw)

  // 模拟运行阶段只计算三维传播损失。动态声线延迟到用户点击
  // 「二维传播损失」后再请求，避免三维体还未显示就触发第二个门户任务。
  if (terrainMask?.sourceOnLand) {
    raySourceData.value = null
    staticRayData.value = null
  }

  const wedge = texture.wedgeMeta ?? {}
  bounds.value = {
    lon: { min: texture.lonMin, max: texture.lonMax },
    lat: { min: texture.latMin, max: texture.latMax },
    depth: { min: texture.depthMin, max: texture.depthMax },
    value: { min: texture.valueMin, max: texture.valueMax },
  }
  sourcePoint.value = {
    lon: wedge.sourceLon,
    lat: wedge.sourceLat,
    depth_m: Number(calcParams.value.srcDepth) || 0,
  }
  const skipped = parsed.stats.invalidWaterCount + parsed.stats.invalidSubstrateCount
  const terrainText = terrainMask?.supported
    ? terrainMask.sourceOnLand
      ? ' · 声源位于陆地，水域声场已隐藏'
      : ` · 地形裁剪 ${terrainMask.landColumns} 个陆地列，阻断陆后 ${terrainMask.blockedColumns} 列/${terrainMask.maskedVoxels} 个体素 · 可见水域至 ${fmt(terrainMask.visiblePathMaxM ?? 0, 0)} m`
    : ' · 已按接口海底高程裁剪'
  statusText.value = ``

  texWidth.value = texture.width
  texHeight.value = texture.height
  texDepth.value = texture.depth
  calculatedSectorCount.value = parsed.grid.sector
  validVoxelPct.value = ((texture.validVoxelRatio ?? 0) * 100).toFixed(1)

  applyScatterPoints([], wedge.pathMaxM)
  scheduleBottomTypesForAzimuth(sliceAzimuthDeg.value, 0)
  if (completedJobId) {
    currentJobId.value = completedJobId
    markJobOpened(completedJobId)
    await attachJobToActiveWorkspace(
      completedJobId,
      captureWorkspaceSnapshot(),
      `${selectedModelLabel.value}声场工作区`,
    )
  }
}

/**
 * 把已缓存的各扇面二维声线（距离—深度）转换为三维体声线散点。
 * 经度 / 纬度按扇面罗盘方位和水平距离换算，depthM 保持向下为正。
 */
function buildVolumeRayScatterPoints() {
  const sourceLon = Number(calcParams.value.coordX)
  const sourceLat = Number(calcParams.value.coordY)
  if (![sourceLon, sourceLat].every(Number.isFinite)) return []
  const points = []
  const interfaceTag = calcParams.value.rayInterface
  const entries = []
  if (use3dRays.value) {
    const bucket = ray3dByAzimuth[interfaceTag === 'static' ? 'static' : 'dynamic']
    for (const [key, response] of bucket.entries()) {
      const azimuth = Number(key)
      if (Number.isFinite(azimuth)) entries.push([azimuth, response])
    }
  } else {
    for (const [key, response] of rayDataByAzimuth.entries()) {
      if (!key.endsWith(`:${interfaceTag}`)) continue
      const azimuth = Number(key.split(':')[0])
      if (Number.isFinite(azimuth)) entries.push([azimuth, response])
    }
  }
  for (const [azimuth, response] of entries) {
    const parsed = parseAnalyse2DRtrd(response)
    if (!parsed) continue
    const bearing = internalAzimuthToCompassBearing(azimuth)
    parsed.rays.forEach((path, rayIndex) => {
      const rayId = `${azimuth.toFixed(4)}:${rayIndex}`
      for (const [distM, depthM] of path) {
        const distance = Number(distM)
        const depth = Number(depthM)
        if (!Number.isFinite(distance) || !Number.isFinite(depth) || distance < 0) continue
        const location = destinationLonLat(sourceLon, sourceLat, bearing, distance)
        points.push({
          rayId,
          bearingDeg: azimuth,
          longitude: location.lon,
          latitude: location.lat,
          depthM: depth,
          pathDistM: distance,
          tlDb: NaN,
        })
      }
    })
  }
  return points
}

function stopVolumeRayAnimation() {
  volumeRayFlowRenderer?.destroy?.()
  volumeRayFlowRenderer = null
}

/**
 * 在 Cesium 三维体上播放当前方位的动态声线。PolylineCollection 由渲染器
 * 复用，每帧只改位置和透明度，不反复创建/删除大量实体。
 */
function startVolumeRayAnimation() {
  stopVolumeRayAnimation()
  if (
    props.viewMode === 'terrain' ||
    !verticalSliceControls.dynamicRays ||
    !earthRaysVisible.value ||
    analysisMode.value !== '3d' ||
    !viewer || viewer.isDestroyed?.() ||
    !soundField?.volume ||
    !staticRayData.value
  ) return

  const parsed = parseAnalyse2DRtrd(staticRayData.value)
  const flow = resolveRayFlow(staticRayData.value, parsed?.rays ?? [])
  if (!flow) return
  const sourceLon = Number(sourcePoint.value?.lon ?? calcParams.value.coordX)
  const sourceLat = Number(sourcePoint.value?.lat ?? calcParams.value.coordY)
  if (![sourceLon, sourceLat].every(Number.isFinite)) return
  const bearing = internalAzimuthToCompassBearing(nearestAvailableAzimuth(sliceAzimuthDeg.value))
  const volume = soundField.volume
  volumeRayFlowRenderer = createCurtainRayFlow({
    viewer,
    flow,
    visible: true,
    project: ([distanceM, depthM]) => {
      const point = destinationLonLat(sourceLon, sourceLat, bearing, Number(distanceM) || 0)
      const altitude = -(Number(depthM) || 0) * Math.max(0.5, Number(volume.depthExaggeration) || 1)
        + (Number(volume.displayAltitudeOffset) || 0)
      return Cesium.Cartesian3.fromDegrees(point.lon, point.lat, altitude)
    },
  })
}

/**
 * 逐点经纬度声线仅供全球 Cesium 三维体使用。区域地形和二维切面直接消费
 * 原始声线路径，不构建这份对象化副本，避免数十万至数百万点膨胀为数 GB。
 */
function refreshVolumeRayScatterPoints(pathMaxM) {
  if (!soundField) return
  const shouldBuild =
    props.viewMode !== 'terrain' &&
    analysisMode.value === '3d' &&
    isRayModel.value &&
    earthRaysVisible.value &&
    verticalSliceControls.staticRays
  const radiusM = Number(pathMaxM ?? soundField.rawTexture?.wedgeMeta?.pathMaxM)
  applyScatterPoints(shouldBuild ? buildVolumeRayScatterPoints() : [], radiusM)
}

/** 注入声线散点并统计声线条数 / 声源半径（最大传播距离） */
function applyScatterPoints(points, pathMaxM) {
  soundField.setScatterPoints(points)
  rayCount.value = new Set((points ?? []).map((p) => p.rayId)).size
  const radiusM = Number(pathMaxM)
  sourceRadiusKm.value = Number.isFinite(radiusM) ? radiusM / 1000 : 0
}

function resetView() {
  soundField?.flyToOverview(0.7)
  soundField?.requestRender()
}

function topView() {
  soundField?.flyToTop(0.6)
  soundField?.requestRender()
}

function viewSliceFromSide() {
  if (!sliceEnabled.value) return
  soundField?.flyToSliceView(sliceAzimuthDeg.value, 0.7)
  soundField?.requestRender()
}

onMounted(() => {
  viewer = createCesiumViewer(cesiumContainer.value)
  if (!viewer) {
    errorText.value = 'Cesium 初始化失败'
    return
  }
  activeViewer.value = viewer

  viewer.scene.globe.depthTestAgainstTerrain = false
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#020617')
  // 声场体渲染（512 步 ray-marching）只应在画面变化时执行：
  // 关闭默认连续渲染循环，避免静止时仍持续占用 GPU/CPU。
  viewer.scene.requestRenderMode = true
  viewer.scene.maximumRenderTimeChange = Infinity
  viewer.scene.requestRender?.()
  webgl2Supported.value = !!getWebGL2(viewer.scene.context)

  soundField = new SoundField(viewer, { depthExaggeration: depthExaggeration.value })
  enableEarthInteraction()
  viewerReady.value = true
  loadCatalogOptions()
  // 底部状态栏：跟踪鼠标经纬度 / 高程 / 层级
  if (Cesium.ScreenSpaceEventHandler && Cesium.ScreenSpaceEventType) {
    coordHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas || viewer.scene?.canvas)
    coordHandler.setInputAction(
      (movement) => {
        if (coordRaf) return
        const pos = movement?.endPosition
        if (!pos) return
        coordRaf = requestAnimationFrame(() => {
          coordRaf = 0
          updateCoordStatus(pos)
        })
      },
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    )
  }

  // GeoVis.Earth 提供经纬度点击事件；点位按钮或接收位置开关激活时写回参数。
  viewer.on?.('click', (event) => {
    if (trackPointDrawing.value) return
    if (!Array.isArray(event?.lonlat)) return
    const lon = Number(event.lonlat[0])
    const lat = Number(event.lonlat[1])
    const elevation = Number(event.lonlat[2])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    if (!activeMapPick.value) {
      if (signalTransmissionControls.showReceiver) {
        if (Number.isFinite(elevation) && elevation > 0) return
        if (applyHydrophoneLocation(lon, lat)) signalTransmissionControls.showReceiver = false
      }
      return
    }
    if (activeMapPick.value === 'source') {
      calcParams.value.coordX = Number(lon.toFixed(4))
      calcParams.value.coordY = Number(lat.toFixed(4))
    } else {
      if (applyHydrophoneLocation(lon, lat) && signalTransmissionControls.showReceiver) {
        signalTransmissionControls.showReceiver = false
      }
    }
    activeMapPick.value = ''
    refreshPickMarkers()
    viewer.scene?.requestRender?.()
  })

  // 参数变化 / 面板开关 / 模式切换时同步声源与接收点标识
  watch(
    () => [
      calcParams.value.coordX,
      calcParams.value.coordY,
      calcParams.value.receiverX,
      calcParams.value.receiverY,
      noiseParams.value.receiverX,
      noiseParams.value.receiverY,
      parameterPanelOpen.value,
      resultPanelOpen.value,
      activeMapPick.value,
      analysisMode.value,
      signalTransmissionControls.showReceiver,
    ],
    () => {
      if (signalTransmissionControls.showReceiver && !hydrophonePlaced.value) {
        ensureDefaultHydrophoneMarker()
      }
      refreshPickMarkers()
    }
  )

  // 外层浮动窗口最大化 / 还原时容器尺寸变化，需显式同步 Cesium 画布尺寸
  if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
    rootResizeObserver = new ResizeObserver(() => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0
        // GeoVis.Earth（Widget）没有 Cesium.Viewer 的 resize() 方法，需先判断是否存在
        if (viewer && !viewer.isDestroyed() && typeof viewer.resize === 'function') viewer.resize()
        viewer?.scene?.requestRender?.()
      })
    })
    rootResizeObserver.observe(rootEl.value)
  }
})

onActivated(async () => {
  twoDRayFlowRenderer?.setSuspended(false)
  await nextTick()
  if (viewer && !viewer.isDestroyed?.()) {
    if (typeof viewer.resize === 'function') viewer.resize()
    // 从水声通信返回时恢复离开前的数字地球视角，避免重新跳到默认视角。
    applyGlobeCamera(viewer)
    chartRefreshToken.value += 1
    startVolumeRayAnimation()
    viewer.scene?.requestRender?.()
  }
})

onDeactivated(() => {
  twoDRayFlowRenderer?.setSuspended(true)
  stopVolumeRayAnimation()
  vesselPlaybackPlaying.value = false
  if (viewer && !viewer.isDestroyed?.()) captureGlobeCamera(viewer)
})

onBeforeUnmount(() => {
  closeVesselPlayback(false)
  for (const layer of runHistoryLayers.value) {
    if (layer.jobId) markJobClosed(layer.jobId)
    try { layer.renderer?.destroy?.() } catch {}
  }
  runHistoryLayers.value = []
  runPanelDockOrder.value = []
  if (viewer && !viewer.isDestroyed?.()) captureGlobeCamera(viewer)
  if (coordRaf) cancelAnimationFrame(coordRaf)
  coordRaf = 0
  clearTimeout(terrainLeaveTimer)
  terrainLeaveTimer = 0
  setTerrainWheelBlocker(false)
  clearTerrainReturn()
  terrainLeaving.value = false
  try {
    coordHandler?.destroy?.()
  } catch {}
  coordHandler = null
  if (resizeRaf) cancelAnimationFrame(resizeRaf)
  resizeRaf = 0
  rootResizeObserver?.disconnect()
  rootResizeObserver = null
  clearTimeout(azimuthSyncTimer)
  azimuthSyncTimer = null
  clearTimeout(omni2dTimer)
  omni2dTimer = 0
  clearTimeout(historyRayTimer)
  historyRayTimer = 0
  clearTimeout(sliceCurtainTimer)
  sliceCurtainTimer = 0
  if (depthExagSyncRaf) cancelAnimationFrame(depthExagSyncRaf)
  depthExagSyncRaf = 0
  clearTimeout(depthExagSyncTimer)
  depthExagSyncTimer = 0
  clearOmni2dLayer()
  stopVolumeRayAnimation()
  clearTwoDMapFeatures()
  removeCurtainPrimitive()
  removeSliceCurtain()
  removePickMarker('source')
  removePickMarker('receiver')
  clearTrackPointFeatures()
  clearTrackPoints()
  soundField?.destroy()
  soundField = null
  if (viewer && !viewer.isDestroyed()) {
    viewer.destroy()
  }
  viewer = null
  activeViewer.value = null
  viewerReady.value = false
})
</script>

<style scoped>
.tl-volume-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #020617;
}

.cesium-container {
  width: 100%;
  height: 100%;
}

.cesium-container :deep(.cesium-viewer),
.cesium-container :deep(.cesium-widget) {
  width: 100%;
  height: 100%;
}

/* 地形预览模式：保留地球实例但隐藏画面，避免销毁后重复初始化；同时收起声场业务浮窗。 */
.tl-volume-root.terrain-mode .cesium-container {
  visibility: hidden;
}

.tl-volume-root.terrain-mode .result-window,
.tl-volume-root.terrain-mode .display-window,
.tl-volume-root.terrain-mode .legend-corner,
.tl-volume-root.terrain-mode .ray-profile-dock,
.tl-volume-root.terrain-mode .coord-status,
.tl-volume-root.terrain-mode .math-popover,
.tl-volume-root.terrain-mode .loading-mask {
  display: none !important;
}

/* 地形 → 全球：地形整体淡出，底下的数字地球先定位到同一区域，再飞回全球视角。 */
.tl-volume-root.terrain-leaving .cesium-container {
  visibility: visible;
}

.tl-volume-root.terrain-leaving .globe-selector {
  display: none;
}

.tl-volume-root.terrain-leaving :deep(.run-panel),
.tl-volume-root.terrain-leaving :deep(.run-pill),
.tl-volume-root.terrain-leaving .terrain-slice-window,
.tl-volume-root.terrain-leaving .terrain-profile-window,
.tl-volume-root.terrain-leaving .terrain-window-dock {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.32s ease;
}

/* ── 顶部工具栏 ── */
.top-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: linear-gradient(180deg, rgba(2, 6, 23, 0.92), rgba(2, 6, 23, 0.55));
  backdrop-filter: blur(8px);
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.toolbar-title {
  font-size: 14px;
  font-weight: 600;
  color: #93c5fd;
  margin-right: 4px;
}

/* ── 状态条 ── */
.status-strip {
  position: absolute;
  top: 52px;
  /* 让开左侧控制面板（left 8 + width 300），避免多行状态遮住分组标题 */
  left: 316px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(460px, calc(100% - 340px));
  pointer-events: none;
}

.status-ok {
  font-size: 11px;
  color: #93c5fd;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
}

.status-error {
  font-size: 11px;
  color: #fca5a5;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.72);
}

/* ── 左侧控制面板 ── */
.control-panel {
  position: absolute;
  top: 92px;
  left: 8px;
  bottom: 8px;
  z-index: 4;
  width: 300px;
  max-width: calc(100% - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.35) transparent;
}

.control-panel::-webkit-scrollbar {
  width: 6px;
}

.control-panel::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.32);
  border-radius: 3px;
}

.control-panel::-webkit-scrollbar-track {
  background: transparent;
}

.panel {
  padding: 0;
  background: rgba(15, 23, 42, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  color: #e5e7eb;
  backdrop-filter: blur(8px);
  overflow: hidden;
  /* 关键：禁止被 flex 压缩（否则同时展开多组时内容会被裁切、互相挤压），
     高度超出时由 .control-panel 的 overflow-y: auto 滚动 */
  flex: 0 0 auto;
}

/* ── 手风琴分组 ── */
.accordion-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: #93c5fd;
  cursor: pointer;
  text-align: left;
}

.accordion-head:hover {
  background: rgba(148, 163, 184, 0.08);
}

.accordion-title {
  font-size: 13px;
  font-weight: 600;
}

.accordion-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 折叠后仍可见的关键值 */
.accordion-badge {
  padding: 1px 7px;
  font-size: 10px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.14);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.accordion-arrow {
  font-size: 12px;
  color: #94a3b8;
  transition: transform 0.2s ease;
}

.accordion-arrow.open {
  transform: rotate(180deg);
}

.accordion-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.15);
}

/* ── 字段分组：组间用虚线分隔 ── */
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field + .field {
  padding-top: 10px;
  border-top: 1px dashed rgba(148, 163, 184, 0.16);
}

/* ── 开关行 ── */
.switch-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  font-size: 12px;
  color: #e2e8f0;
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.switch-row:hover {
  background: rgba(148, 163, 184, 0.15);
}

.switch-row-sub {
  margin-left: 14px;
  font-size: 11px;
  color: #cbd5e1;
}

.switch-row.is-disabled {
  opacity: 0.5;
}

.switch-row.is-disabled:hover {
  background: rgba(148, 163, 184, 0.08);
}

.switch-text {
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}

/* ── 数据信息：键值网格 ── */
.info-grid {
  display: grid;
  grid-template-columns: 62px 1fr;
  gap: 5px 8px;
  align-items: baseline;
}

.info-grid-ranges {
  padding-top: 8px;
  border-top: 1px dashed rgba(148, 163, 184, 0.16);
}

.info-k {
  font-size: 11px;
  color: #94a3b8;
}

.info-v {
  font-size: 12px;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}

/* ── 滑块行 ── */
.slider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
}

.slider-label {
  font-size: 12px;
  color: #cbd5e1;
}

.slider-value {
  font-size: 11px;
  color: #93c5fd;
  font-variant-numeric: tabular-nums;
}

input[type='range'] {
  width: 100%;
  margin: 0;
  accent-color: #38bdf8;
  cursor: pointer;
}

input[type='range']:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── 自定义 dB 范围输入 ── */
.db-range-inputs {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.db-range-input {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #94a3b8;
}

.db-range-input input {
  flex: 1;
  min-width: 0;
  padding: 2px 4px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #e2e8f0;
}

.field-label {
  display: block;
  font-size: 12px;
  color: #cbd5e1;
  margin: 0;
}

.hint,
.meta {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: #8697ad;
}

.hint-block {
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.07);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

/* ── 二维声场色标图例 ── */
.omni-legend {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lg-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}

.lg-bar {
  display: inline-block;
  width: 72px;
  height: 9px;
  border-radius: 2px;
  flex: none;
}

/* ── 按钮 ── */
.btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid #475569;
  border-radius: 6px;
  background: #1e293b;
  color: #e2e8f0;
  cursor: pointer;
}

.btn:hover {
  background: #334155;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-primary {
  background: #1e40af;
  border-color: #3b82f6;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

/* ── 方位指针步进 ── */
.pointer-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pointer-nav .select-input {
  flex: 1;
  min-width: 0;
}

.btn-mini {
  padding: 2px 8px;
  flex-shrink: 0;
  font-size: 12px;
}

.select-input {
  width: 100%;
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #e2e8f0;
}

.select-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.source-select {
  width: auto;
  min-width: 160px;
}

/* ── 色标自定义 ── */
.color-gradient-preview {
  height: 14px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  margin: 4px 0 10px;
}

.color-stop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}

.color-stop-index {
  width: 34px;
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex-shrink: 0;
}

.color-stop-range {
  flex: 1;
  min-width: 0;
}

.color-stop-picker {
  width: 34px;
  height: 24px;
  padding: 0;
  border: 1px solid #475569;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.color-stop-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

/* ── 底部：TL 伪彩图 + 声线图并排 ── */
.ray-profile-dock {
  position: absolute;
  left: 316px;
  right: 224px;
  bottom: 12px;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.dock-card {
  flex: 1 1 0;
  min-width: 0;
}

@media (max-width: 1280px) {
  .ray-profile-dock {
    left: 316px;
    right: 12px;
    bottom: 96px;
  }
}

.legend-corner {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 4;
  width: 200px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.3);
  backdrop-filter: blur(8px);
}

.legend-bar {
  height: 12px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.legend-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #94a3b8;
  margin-top: 4px;
}

.legend-out-range {
  margin: 6px 0 0;
  font-size: 10px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: #fff;
  border: 1px solid rgba(148, 163, 184, 0.35);
}

/* ── 遮罩 / 空态 / 错误 ── */
.loading-mask,
.empty-hint {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #e5e7eb;
  background: rgba(2, 6, 23, 0.6);
  font-size: 14px;
  pointer-events: none;
}

.progress-bar {
  width: 220px;
  height: 6px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.25);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #22d3ee);
  transition: width 0.15s ease;
}

.runtime-error {
  position: absolute;
  right: 12px;
  top: 56px;
  z-index: 5;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.9);
  color: #fecaca;
  font-size: 13px;
}

/* ── 门户版布局：参数窗仿照业务系统样式，结果控件与参数解耦 ── */
.portal-header {
  position: absolute;
  inset: 0 0 auto;
  z-index: 12;
  height: 54px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 18px;
  box-sizing: border-box;
  color: #e8fbff;
  border-bottom: 1px solid rgba(91, 194, 232, 0.35);
  background: linear-gradient(180deg, rgba(4, 26, 45, 0.97), rgba(5, 25, 43, 0.84));
  box-shadow: 0 8px 30px rgba(0, 7, 18, 0.34);
  backdrop-filter: none;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.brand-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  color: #4bd5ff;
  border: 1px solid rgba(75, 213, 255, 0.55);
  transform: rotate(45deg);
  box-shadow: inset 0 0 16px rgba(20, 166, 211, 0.22), 0 0 14px rgba(20, 166, 211, 0.14);
}

.brand-mark::first-letter { transform: rotate(-45deg); }
.brand-block strong { display: block; font-size: 18px; letter-spacing: 2px; }
.brand-block small { display: block; margin-top: 2px; font-size: 8px; color: #6794aa; letter-spacing: 1.3px; }

/* 顶部大模块选项：仿参考的标签页 —— 选中亮青字 + 底部亮条，未选中暗字 */
.mode-tabs {
  display: flex;
  align-items: stretch;
  height: 54px;
  padding: 0;
  gap: 6px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.mode-tabs button,
.header-btn {
  min-width: 120px;
  padding: 0 22px;
  border: 0;
  border-radius: 0;
  color: #9fb6c4;
  font-size: 18px;
  letter-spacing: 1px;
  background: transparent;
  cursor: pointer;
  transition: 0.18s ease;
}

.mode-tabs button {
  position: relative;
}

.mode-tabs button:hover {
  color: #d9f5ff;
}

.mode-tabs button.active {
  color: #4bd5ff;
  font-weight: 700;
  background: transparent;
  box-shadow: none;
}

/* 选中态下的底部亮条 */
.mode-tabs button.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 3px;
  border-radius: 2px;
  background: #29c3f0;
  box-shadow: 0 0 10px rgba(41, 195, 240, 0.75);
}

.header-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
}

.header-clock {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #bfe3f0;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.header-clock-icon {
  color: #67bddb;
  font-size: 13px;
}

.header-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #d9edf5;
  font-size: 18px;
  white-space: nowrap;
}

.header-avatar {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #d9f5ff;
  font-size: 12px;
  border-radius: 50%;
  border: 1px solid rgba(75, 213, 255, 0.55);
  background: rgba(10, 92, 128, 0.35);
}

.header-btn {
  min-width: auto;
  height: 28px;
  color: #caeffb;
  border: 1px solid rgba(70, 168, 207, 0.42);
  background: rgba(11, 78, 111, 0.46);
}

/* ── 左侧水声模块区域：贴页面左缘、贴页头下沿，右上角关闭 ── */
.water-module {
  position: absolute;
  z-index: 10;
  top: 54px;
  left: 0;
  bottom: 0;
  width: 200px;
  display: flex;
  flex-direction: column;
  color: #d9edf5;
  border-right: 1px solid rgba(66, 154, 189, 0.52);
  background: linear-gradient(180deg, rgba(9, 40, 60, 0.96), rgba(5, 24, 38, 0.94));
  box-shadow: 6px 0 24px rgba(0, 8, 20, 0.4);
  backdrop-filter: none;
}

.water-module-titlebar {
  flex: none;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 8px 0 14px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  border-bottom: 2px solid rgba(81, 183, 220, 0.55);
  background: linear-gradient(90deg, rgba(24, 91, 121, 0.72), rgba(12, 44, 65, 0.35));
}

.water-module-titlebar button {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  color: #e8fbff;
  font-size: 25px;
  font-weight: 200;
  line-height: 24px;
  background: transparent;
  cursor: pointer;
}

/* 左侧子模块：仿照参考系统的扁平竖排列表 */
.water-module-body {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.water-module-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 16px;
  text-align: left;
  color: #b9d3de;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  transition: 0.16s ease;
}

.water-module-item + .water-module-item {
  border-top: 1px solid rgba(67, 151, 184, 0.14);
}

.water-module-item:hover {
  color: #eafbff;
  background: rgba(31, 100, 132, 0.28);
}

.water-module-item.active {
  color: #eafbff;
  border-left-color: #22c3f0;
  background: linear-gradient(90deg, rgba(12, 135, 189, 0.55), rgba(12, 135, 189, 0.04));
}

.water-module-item strong {
  font-size: 13px;
  font-weight: 600;
}

.water-module-item small {
  font-size: 10px;
  color: #7fa8bb;
}

.water-module-item.active small {
  color: #cdeaf5;
}

/* 水声模块展开时，把参数窗让开左侧模块区域 */
.tl-volume-root.module-open .parameter-window {
  left: 216px;
}

.parameter-window {
  position: absolute;
  z-index: 10;
  top: 70px;
  left: 18px;
  width: 324px;
  max-height: calc(100% - 96px);
  display: flex;
  flex-direction: column;
  color: #d9edf5;
  border: 1px solid rgba(66, 154, 189, 0.52);
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(22, 61, 83, 0.95), rgba(10, 40, 60, 0.94));
  box-shadow: 0 0 0 3px rgba(20, 72, 98, 0.22), 0 15px 40px rgba(0, 8, 20, 0.42);
  backdrop-filter: none;
  overflow: hidden;
}

.parameter-window.dragging {
  z-index: 30;
  box-shadow: 0 0 0 3px rgba(20, 72, 98, 0.28), 0 20px 52px rgba(0, 8, 20, 0.58);
}

/* ── 左侧「分析结果」窗口：紧贴水声模块右缘，占满其下方高度 ── */
.result-window {
  position: absolute;
  z-index: 10;
  top: 54px;
  bottom: 26px;
  /* 分析结果窗口宽度：调大即可让下方两张剖面图变宽 */
  width: 600px;
  max-width: calc(100% - 200px);
  display: flex;
  flex-direction: column;
  color: #d9edf5;
  border-right: 1px solid rgba(66, 154, 189, 0.52);
  border-radius: 0;
  background: linear-gradient(180deg, rgba(22, 61, 83, 0.96), rgba(10, 40, 60, 0.95));
  box-shadow: 6px 0 24px rgba(0, 8, 20, 0.4);
  backdrop-filter: none;
  overflow: hidden;
}

.result-body {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(84, 170, 204, 0.6) transparent;
}

.result-back {
  align-self: flex-start;
  padding: 5px 12px;
  color: #d9f5ff;
  font-size: 12px;
  border: 1px solid rgba(82, 197, 235, 0.5);
  border-radius: 3px;
  background: linear-gradient(180deg, #0c87bd, #086692);
  cursor: pointer;
}

.result-back:hover {
  background: linear-gradient(180deg, #129bd6, #0a7aa8);
}

/* 「返回计算」与右侧「体渲染」按钮同排，右按钮留出与窗口边界的间距 */
.result-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}

.result-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.receiver-mark-btn {
  color: #c7f8ff;
  border-color: rgba(46, 215, 244, 0.62);
  background: rgba(8, 82, 107, 0.86);
}

.receiver-mark-btn.active {
  color: #04202a;
  background: #4be3f5;
  box-shadow: 0 0 14px rgba(75, 227, 245, 0.35);
}

.display-head-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.display-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  color: #e8fbff;
  font-size: 20px;
  font-weight: 200;
  line-height: 20px;
  background: transparent;
  cursor: pointer;
}

.result-card {
  flex: 0 0 auto;
}

/* 上下两张剖面图相接（去掉中间间隙与上圆角），便于对照同一距离轴 */
.result-body .result-card + .result-card {
  margin-top: -10px;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.result-meta {
  margin: 0;
  padding: 6px 9px;
  font-size: 11px;
  color: #8fb6c8;
  border: 1px solid rgba(67, 151, 184, 0.25);
  border-radius: 4px;
  background: rgba(31, 79, 105, 0.3);
}

.window-titlebar,
.result-titlebar {
  flex: none;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 12px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  border-bottom: 2px solid rgba(81, 183, 220, 0.55);
  background: linear-gradient(90deg, rgba(24, 91, 121, 0.72), rgba(12, 44, 65, 0.35));
}

.window-titlebar {
  cursor: move;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.parameter-window.dragging .window-titlebar { cursor: grabbing; }

.result-titlebar span { flex: 1; min-width: 0; }
.window-titlebar i,
.result-titlebar i { color: #e7b24c; font-size: 12px; letter-spacing: -5px; font-style: normal; }
.window-titlebar button,
.result-titlebar button {
  margin-left: auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  color: #e8fbff;
  font-size: 25px;
  font-weight: 200;
  line-height: 24px;
  background: transparent;
  cursor: pointer;
}

.parameter-scroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(84, 170, 204, 0.6) transparent;
}

.form-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  min-height: 34px;
  gap: 8px;
  margin-bottom: 4px;
}

.form-row > label { font-size: 12px; color: #b5cfdb; }
.form-row input[type='number'],
.form-row input[type='datetime-local'],
.form-row select,
.readonly-value {
  width: 100%;
  min-width: 0;
  height: 28px;
  box-sizing: border-box;
  padding: 0 10px;
  color: #dceff6;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  border: 1px solid rgba(95, 158, 184, 0.28);
  border-radius: 3px;
  outline: none;
  background: rgba(104, 144, 165, 0.25);
}

.form-row input:focus,
.form-row select:focus { border-color: #2fc4f1; box-shadow: 0 0 0 2px rgba(47, 196, 241, 0.12); }
.readonly-value { display: flex; align-items: center; color: #7dd9f3; background: rgba(30, 92, 119, 0.26); }

/* 原生下拉的选项列表也用深色（支持的浏览器会生效），避免白色弹出层 */
.form-row select option,
.select-input option {
  color: #dceff6;
  background-color: #0f172a;
}

/* ── 查询时间触发按钮 + 日历弹层 ── */
.time-trigger {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  box-sizing: border-box;
  padding: 0 10px;
  color: #dceff6;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  border: 1px solid rgba(95, 158, 184, 0.28);
  border-radius: 3px;
  outline: none;
  background: rgba(104, 144, 165, 0.25);
  cursor: pointer;
}
.time-trigger i { color: #7dd9f3; font-style: normal; font-size: 11px; }

.time-backdrop {
  position: absolute;
  inset: 0;
  z-index: 39;
}

.time-popover {
  position: fixed;
  z-index: 40;
  width: 300px;
  padding: 10px;
  color: #d9edf5;
  border: 1px solid rgba(66, 154, 189, 0.6);
  border-radius: 4px;
  background: linear-gradient(180deg, rgba(22, 61, 83, 0.99), rgba(10, 40, 60, 0.99));
  box-shadow: 0 16px 44px rgba(0, 8, 20, 0.6);
}

.cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: #bfe6f5;
}
.cal-head button {
  width: 26px;
  height: 26px;
  padding: 0;
  color: #9fe0f5;
  font-size: 16px;
  line-height: 24px;
  border: 1px solid rgba(70, 168, 207, 0.35);
  border-radius: 3px;
  background: rgba(11, 78, 111, 0.4);
  cursor: pointer;
}

.cal-week,
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-week span {
  text-align: center;
  font-size: 10px;
  color: #7fa8bb;
  padding-bottom: 2px;
}
.cal-cell {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #d9edf5;
  border: 0;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
}
.cal-cell.empty { cursor: default; }
.cal-cell:hover { background: rgba(41, 195, 240, 0.22); }
.cal-cell.available { color: #a5f3fc; }
.cal-cell.active { color: #04101f; font-weight: 700; background: #29c3f0; }

.cal-times-wrap {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(66, 154, 189, 0.25);
}
.cal-times-title { font-size: 11px; color: #7fa8bb; margin-bottom: 5px; }
.cal-times {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  max-height: 128px;
  overflow-y: auto;
}
.cal-time {
  height: 26px;
  font-size: 11px;
  color: #cfeaf5;
  border: 1px solid rgba(70, 168, 207, 0.3);
  border-radius: 3px;
  background: rgba(11, 78, 111, 0.3);
  cursor: pointer;
}
.cal-time:hover { background: rgba(41, 195, 240, 0.28); }
.cal-time.active { color: #04101f; background: #29c3f0; border-color: #29c3f0; }
.cal-time-empty { grid-column: 1 / -1; padding: 8px 0; font-size: 11px; color: #7fa8bb; text-align: center; }

.radio-group { display: flex; align-items: center; gap: 18px; font-size: 12px; }
.radio-group label { display: flex; align-items: center; gap: 5px; white-space: nowrap; cursor: pointer; }
.radio-group input { accent-color: #17c5f4; }

.section-caption {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  margin: 2px 0 4px;
  color: #25c9f7;
  font-size: 12px;
  font-weight: 700;
}

.section-caption::before,
.section-caption::after { content: ''; height: 1px; flex: 1; background: rgba(65, 153, 188, 0.35); }
.section-caption span { padding: 0 10px; }

.signal-transmission-card {
  margin: 6px 0 4px;
  padding: 9px 10px 10px;
  border: 1px solid rgba(65, 153, 188, 0.35);
  border-radius: 6px;
  background: rgba(10, 44, 66, 0.55);
}

.signal-transmission-title {
  margin-bottom: 7px;
  color: #25c9f7;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.terrain-mode .parameter-window .signal-transmission-card {
  margin: 6px 0 5px;
  padding: 8px;
}

.position-control,
.range-control { display: flex; align-items: center; gap: 5px; min-width: 0; }
.position-control input { flex: 1; width: 0 !important; padding: 0 6px !important; }
.position-control button {
  flex: none;
  width: 31px;
  height: 28px;
  padding: 0;
  color: #74dcfa;
  border: 1px solid rgba(33, 168, 214, 0.3);
  border-radius: 3px;
  background: rgba(10, 125, 169, 0.42);
  cursor: pointer;
}
.position-control button.active { color: white; background: #098fc2; box-shadow: 0 0 12px rgba(34, 203, 255, 0.42); }
.range-control input { flex: 1; width: 0 !important; }
.range-control span { color: #7ca1b1; }
.range-control em { color: #7ca1b1; font-size: 11px; font-style: normal; }

.noise-hint {
  margin: 4px 0 8px;
  color: #78a8bc;
  font-size: 10px;
  line-height: 1.5;
}

.scenario-editor {
  margin: 6px 0;
  padding: 7px;
  border: 1px solid rgba(67, 151, 184, 0.24);
  border-radius: 3px;
  background: rgba(4, 28, 44, 0.28);
}

.scenario-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
  color: #bfe6f5;
  font-size: 11px;
  font-weight: 600;
}

.scenario-editor-head button,
.scenario-actions button {
  min-height: 24px;
  padding: 0 7px;
  color: #8de4fb;
  font: inherit;
  font-size: 10px;
  border: 1px solid rgba(47, 196, 241, 0.32);
  border-radius: 3px;
  background: rgba(10, 125, 169, 0.25);
  cursor: pointer;
}

.scenario-grid {
  display: grid;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.scenario-grid-wind { grid-template-columns: 1fr 1fr 24px; }
.scenario-grid-event { grid-template-columns: 1fr 1fr 0.8fr 24px; }
.scenario-grid-ship { grid-template-columns: repeat(5, minmax(0, 1fr)) 24px; }
.scenario-grid-crack { grid-template-columns: 1fr 1fr 0.8fr 24px; }
.scenario-grid-labels {
  color: #6f9caf;
  font-size: 9px;
  text-align: center;
}
.scenario-grid input {
  width: 100%;
  min-width: 0;
  height: 25px;
  box-sizing: border-box;
  padding: 0 4px;
  color: #dceff6;
  font: inherit;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  border: 1px solid rgba(95, 158, 184, 0.28);
  border-radius: 3px;
  outline: none;
  background: rgba(104, 144, 165, 0.2);
}
.scenario-grid input:focus { border-color: #2fc4f1; }
.scenario-remove {
  width: 24px;
  height: 24px;
  padding: 0;
  color: #f4a6a6;
  font-size: 15px;
  line-height: 20px;
  border: 1px solid rgba(239, 115, 115, 0.28);
  border-radius: 3px;
  background: rgba(122, 35, 35, 0.22);
  cursor: pointer;
}
.scenario-empty {
  margin: 6px 0 2px;
  color: #668b9c;
  font-size: 10px;
  text-align: center;
}
.scenario-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 7px 0;
}

.noise-result-tag {
  color: #25c9f7;
  font-size: 11px;
}

.parameter-footer { flex: none; padding: 8px 14px 11px; border-top: 1px solid rgba(69, 150, 181, 0.28); }
.form-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-actions button,
.display-buttons button {
  height: 31px;
  color: #cce7f1;
  border: 1px solid rgba(67, 151, 184, 0.48);
  border-radius: 3px;
  background: rgba(31, 79, 105, 0.55);
  cursor: pointer;
}
.form-actions button:disabled { opacity: 0.5; cursor: wait; }
.result-restore-btn {
  width: 100%;
  height: 30px;
  margin-top: 8px;
  color: #8deaff;
  border: 1px solid rgba(58, 197, 229, 0.45);
  border-radius: 3px;
  background: rgba(10, 78, 103, 0.42);
  cursor: pointer;
}
.result-restore-btn:hover { color: #e9fdff; background: rgba(15, 108, 139, 0.62); }

/* .model-result-note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  color: #9fc7d8;
  font-size: 12px;
  border: 1px solid rgba(65, 153, 188, 0.35);
  border-radius: 4px;
  background: rgba(9, 38, 57, 0.72);
} */
.model-result-note strong { color: #32c9f3; font-size: 13px; }
.form-actions .calculate-btn { color: white; border-color: rgba(23, 171, 221, 0.72); background: linear-gradient(180deg, #0c87bd, #086692); }
.parameter-footer p { margin: 8px 0 0; color: #78a8bc; font-size: 10px; line-height: 1.45; }

.display-window {
  position: absolute;
  z-index: 9;
  top: 70px;
  right: 18px;
  width: 230px;
  color: #d9edf5;
  border: 1px solid rgba(66, 154, 189, 0.45);
  border-radius: 4px;
  background: rgba(9, 38, 57, 0.9);
  box-shadow: 0 15px 36px rgba(0, 8, 20, 0.34);
  backdrop-filter: none;
  overflow: hidden;
}
.display-window > header { display: flex; justify-content: space-between; padding: 10px 12px; color: #6ed7f5; font-size: 12px; border-bottom: 1px solid rgba(66,154,189,.28); }
.display-window > header small { color: #789aaa; }
.display-body { display: grid; gap: 10px; padding: 11px 12px 13px; }
.display-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.display-buttons button { height: 27px; font-size: 11px; }
.toggle-line { display: flex; align-items: center; gap: 7px; font-size: 11px; color: #b9d3de; }
.toggle-line input { accent-color: #19c5f3; }
.mini-control span { display: flex; justify-content: space-between; margin-bottom: 5px; color: #9dbbc8; font-size: 11px; }
.mini-control b { color: #65d7f7; font-weight: 500; }

.portal-status {
  position: absolute;
  z-index: 11;
  top: 65px;
  left: auto;
  right: 260px;
  max-width: min(560px, calc(100% - 1240px));
  padding: 7px 13px;
  color: #bfeeff;
  font-size: 11px;
  text-align: center;
  border: 1px solid rgba(53, 165, 208, 0.4);
  border-radius: 4px;
  background: rgba(5, 47, 68, 0.84);
  backdrop-filter: none;
}
.portal-status.error { color: #ffd3d3; border-color: rgba(239, 105, 105, 0.45); background: rgba(91, 27, 34, 0.9); }

.map-interaction-hint {
  position: absolute;
  z-index: 7;
  top: 106px;
  left: auto;
  right: 18px;
  max-width: 560px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 11px;
  color: #bfe9f7;
  font-size: 10px;
  border: 1px solid rgba(77, 184, 221, 0.3);
  border-radius: 999px;
  background: rgba(4, 34, 52, 0.72);
  backdrop-filter: none;
}
.map-hint-swatch {
  width: 34px;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #ff2800, #ffe628, #00dc5a, #00dcff, #0050ff, #00007f);
}
.map-interaction-hint button {
  height: 22px;
  padding: 0 8px;
  color: #d9f5ff;
  font-size: 10px;
  border: 1px solid rgba(82, 197, 235, 0.42);
  border-radius: 999px;
  background: rgba(17, 113, 150, 0.52);
  cursor: pointer;
}
.map-interaction-hint button:hover { background: rgba(20, 147, 193, 0.72); }

.loading-mask { z-index: 30; background: rgba(2, 14, 25, 0.86); backdrop-filter: none; }
.loading-mask small { color: #7fa2b1; }
.loading-spinner { width: 34px; height: 34px; border: 3px solid rgba(76, 189, 229, 0.22); border-top-color: #3cd0ff; border-radius: 50%; animation: portal-spin .8s linear infinite; }
@keyframes portal-spin { to { transform: rotate(360deg); } }

.legend-corner { right: 18px; bottom: 34px; z-index: 8; width: 205px; }

/* ── 底部状态栏：鼠标经纬度 / 高程 / 层级 ── */
.coord-status {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 13;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 12px 0 16px;
  box-sizing: border-box;
  color: #cfe3f0;
  font-size: 13px;
  letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 3px rgba(0, 10, 20, 0.75);
  background: linear-gradient(180deg, rgba(8, 26, 46, 0) 0%, rgba(8, 26, 46, 0.9) 60%);
  pointer-events: none;
  white-space: nowrap;
  overflow: visible;
}

.coord-metrics {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 26px;
  overflow: hidden;
}
.coord-status span { color: #cfe3f0; }
.coord-status b { color: #ffffff; font-weight: 500; }

@media (max-width: 1050px) {
  .parameter-window { top: 110px; }
  .display-window { top: 110px; }
  .portal-status { top: 106px; max-width: 280px; }
}

@media (max-width: 760px) {
  .parameter-window { left: 8px; width: min(324px, calc(100% - 16px)); }
  .result-window { left: 0 !important; width: min(434px, 100%); }
  .display-window { display: none; }
  .portal-status { display: none; }
}
</style>

<style scoped>
.terrain-mode .parameter-window { z-index: 17; left: calc(50% - 150px); top: 18px; width: 300px; max-height: min(480px, calc(100% - 80px)); border: 1px solid #00dda0; border-radius: 8px; background: #0e1d2ef8; box-shadow: 0 10px 32px #06172570; }
.terrain-mode .parameter-window .window-titlebar { background: #102536; color: #afc9de; height: 34px; min-height: 34px; font-size: 11px; }
.terrain-mode .parameter-scroll { padding: 10px 12px; }
.terrain-mode .parameter-window .form-row { margin-bottom: 7px; }.terrain-mode .parameter-window .form-row > label { font-size: 10px; }
.terrain-mode .parameter-window .section-caption { margin: 12px 0 8px; font-size: 10px; }
.terrain-mode .portal-status { z-index: 24; max-width: min(600px, calc(100% - 48px)); }
.terrain-slice-window,.terrain-profile-window { position: absolute; z-index: 15; background: #051321; border: 1px solid #267089; border-radius: 7px; overflow: hidden; box-shadow: 0 14px 30px #00101d60; }
.terrain-slice-window { top: 60px; right: 24px; width: min(620px, 49%); }
.terrain-profile-window { right: 18px; top: 390px; width: min(310px, 32%); max-height: calc(100% - 425px); overflow-y: auto; z-index: 16; }
.terrain-window-title { display: flex; justify-content: space-between; align-items: center; height: 31px; padding: 0 6px 0 10px; background: #002434; color: #03cfc6; font: 11px 'Microsoft YaHei',sans-serif; cursor: move; touch-action: none; }
.terrain-window-actions { display: flex; align-items: center; gap: 2px; }
.terrain-window-title button { width: 25px; height: 25px; padding: 0; border: 0; color: #9ab3c8; background: transparent; cursor: pointer; font-size: 18px; line-height: 1; }
.terrain-window-title button:hover { color: #55e7dc; background: #12384a; border-radius: 4px; }
.terrain-window-dock { position: absolute; z-index: 28; left: 50%; bottom: 31px; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; max-width: calc(100% - 80px); transform: translateX(-50%); }
.terrain-window-dock-item { display: flex; align-items: stretch; min-width: 220px; height: 30px; overflow: hidden; color: #03d9cf; border: 1px solid #176d80; border-radius: 7px; background: #082131; box-shadow: 0 7px 18px #00101d73; }
.terrain-window-dock-restore { min-width: 0; flex: 1; display: flex; align-items: center; gap: 7px; padding: 0 8px; color: inherit; border: 0; background: transparent; cursor: pointer; }
.terrain-window-dock-restore b { min-width: 0; flex: 1; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; font: 10px 'Microsoft YaHei',sans-serif; }
.terrain-window-dock-restore i { display: grid; place-items: center; width: 13px; height: 13px; color: #d7edff; background: #478ac2; border-radius: 1px; font-size: 8px; font-style: normal; }
.terrain-window-dock-close { width: 27px; padding: 0; color: #e55c70; border: 0; background: transparent; cursor: pointer; font-size: 17px; }
.terrain-window-dock button:hover { background: #12384a; }
.terrain-tl-legend { display: flex; gap: 10px; padding: 8px 18px; font: 10px monospace; color: #9ac5d7; align-items: center; }.terrain-tl-legend i { flex: 1; height: 5px; background: linear-gradient(90deg,#ff2800,#ffe628,#00dc5a,#00dcff,#0050ff,#00007f); }
.terrain-slice-window :deep(.rp-head) { display: none; }.terrain-slice-window :deep(.ray-profile) { border: 0; border-radius: 0; }
@media(max-height: 780px) { .terrain-profile-window { top: 340px; max-height: calc(100% - 375px); } }
@media(max-width: 1050px) { .terrain-slice-window { right: 10px; width: min(540px, 66%); }.terrain-profile-window { right: 10px; width: 240px; }.terrain-window-dock-item { min-width: 180px; } }
</style>

<style scoped>
.terrain-profile-window { scrollbar-width: thin; scrollbar-color: #34576c #081a2a; }
.terrain-mode .parameter-window .form-row input:not([type='radio']), .terrain-mode .parameter-window .form-row select, .terrain-mode .parameter-window .time-trigger { min-height: 23px; height: 23px; font-size: 11px; }
.terrain-mode .parameter-window .form-row { min-height: 26px; }
.terrain-mode .parameter-window .parameter-footer { padding: 8px 12px; }
.terrain-mode .parameter-window .form-actions button { min-height: 28px; height: 28px; font-size: 11px; }
.terrain-mode .parameter-window .result-restore-btn { display: none; }
</style>
