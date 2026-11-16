import { reactive } from 'vue'

export const signalTransmissionControls = reactive({
  sourceLevelDb: 105,
  frequenciesHz: [84, 126],
  frequencyHzText: '84, 126',
  navigationDepthM: 150,
  receiverDepthM: 30,
  vesselSpeedKn: 4,
  propagationModel: 'bellhop',
  arrivalBeamCount: 2001,
  surfaceEcho: true,
  bottomEcho: true,
  noiseLevelDb: 20,
  hydrophone: 'BK-8103',
  sampleRate: 48000,
  preampGainDb: 6,
  adcBits: 24,
  adcFullScaleV: 2,
  showReceiver: false,
  receiverReady: false,
  selectTrackPoints: false,
  showSourceTimeFrequency: false,
  showSourceWaveform: false,
  showTimeFrequency: false,
  showWaveform: false,
  sliceReceiverPlacement: false,
  spectrogramFrequencyScale: 'linear',
  simulationDurationS: 30,
})

export function parseFrequencyHz(value) {
  const parts = String(value ?? '').split(/[,，;；\s]+/)
  const frequencies = []
  for (const part of parts) {
    const number = Number(part)
    if (Number.isFinite(number) && number > 0) frequencies.push(number)
  }
  return [...new Set(frequencies)]
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(Math.round(left))
  let b = Math.abs(Math.round(right))
  while (b) [a, b] = [b, a % b]
  return a
}

/** 返回多频同相叠加波形指定重复周期数对应的预览时长。 */
export function combinedTonePreviewDurationS(frequencies, repeatCount = 2) {
  const scale = 1000
  const scaled = Array.from(frequencies || [], Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .map(value => Math.max(1, Math.round(value * scale)))
  if (!scaled.length) return 0.05
  const commonFrequencyScaled = scaled.reduce(greatestCommonDivisor)
  const commonFrequencyHz = commonFrequencyScaled / scale
  return Math.max(1, Number(repeatCount) || 2) / commonFrequencyHz
}

/**
 * B&K 8106 的灵敏度曲线已经包含内置前放；切换到该型号时只保留
 * 可选的外部附加增益，并默认从 0 dB 开始，避免重复计算内置增益。
 */
export function applyHydrophonePreampDefaults(
  controls,
  previousHydrophone,
  savedExternalGainDb = 6,
) {
  const nextHydrophone = controls.hydrophone
  let savedGain = Number(savedExternalGainDb)
  if (!Number.isFinite(savedGain)) savedGain = 6
  if (nextHydrophone === 'BK-8106') {
    if (previousHydrophone !== 'BK-8106') {
      const currentGain = Number(controls.preampGainDb)
      if (Number.isFinite(currentGain)) savedGain = currentGain
    }
    controls.preampGainDb = 0
  } else if (previousHydrophone === 'BK-8106') {
    controls.preampGainDb = savedGain
  }
  normalizeSignalTransmissionControls(controls)
  return savedGain
}

export function normalizeSignalTransmissionControls(controls = signalTransmissionControls) {
  const sourceLevel = Number(controls.sourceLevelDb)
  const navigationDepth = Number(controls.navigationDepthM)
  const receiverDepth = Number(controls.receiverDepthM)
  const vesselSpeed = Number(controls.vesselSpeedKn)
  const duration = Number(controls.simulationDurationS)
  const sampleRate = Number(controls.sampleRate)
  const arrivalBeamCount = Number(controls.arrivalBeamCount)
  const noiseLevel = Number(controls.noiseLevelDb)
  const preampGain = Number(controls.preampGainDb)
  const adcFullScale = Number(controls.adcFullScaleV)
  const frequencies = parseFrequencyHz(controls.frequencyHzText)
  controls.sourceLevelDb = Number.isFinite(sourceLevel) ? sourceLevel : 105
  controls.navigationDepthM = Number.isFinite(navigationDepth) ? Math.max(0, navigationDepth) : 150
  controls.receiverDepthM = Number.isFinite(receiverDepth) ? Math.max(0.01, receiverDepth) : 30
  controls.frequenciesHz = frequencies.length ? frequencies : [84, 126]
  controls.frequencyHzText = controls.frequenciesHz.join(', ')
  controls.vesselSpeedKn = Number.isFinite(vesselSpeed) ? Math.min(60, Math.max(0.1, vesselSpeed)) : 4
  controls.sampleRate = [8000, 16000, 24000, 48000, 96000].includes(sampleRate) ? sampleRate : 48000
  // 这里只控制滚动展示窗，不再用后端一次性波形采样预算截断整条实时航迹。
  controls.simulationDurationS = Number.isFinite(duration) ? Math.min(300, Math.max(0.1, duration)) : 30
  // 信号到达结构固定采用 Bellhop arrivals；声场模型由“仿真配置”独立决定。
  controls.propagationModel = 'bellhop'
  controls.arrivalBeamCount = Number.isFinite(arrivalBeamCount) ? Math.round(Math.min(100001, Math.max(1, arrivalBeamCount))) : 2001
  controls.surfaceEcho = Boolean(controls.surfaceEcho)
  controls.bottomEcho = Boolean(controls.bottomEcho)
  controls.noiseLevelDb = Number.isFinite(noiseLevel) ? noiseLevel : 20
  controls.hydrophone = ['BK-8103', 'BK-8106', 'RESON-TC4013'].includes(controls.hydrophone) ? controls.hydrophone : 'BK-8103'
  controls.preampGainDb = Number.isFinite(preampGain) ? preampGain : 6
  controls.adcBits = [16, 24, 32].includes(Number(controls.adcBits)) ? Number(controls.adcBits) : 24
  controls.adcFullScaleV = Number.isFinite(adcFullScale) ? Math.max(1e-6, adcFullScale) : 2
  controls.showReceiver = Boolean(controls.showReceiver)
  controls.receiverReady = Boolean(controls.receiverReady)
  controls.selectTrackPoints = Boolean(controls.selectTrackPoints)
  controls.showSourceTimeFrequency = Boolean(controls.showSourceTimeFrequency)
  controls.showSourceWaveform = Boolean(controls.showSourceWaveform)
  controls.showTimeFrequency = Boolean(controls.showTimeFrequency)
  controls.showWaveform = Boolean(controls.showWaveform)
  controls.sliceReceiverPlacement = Boolean(controls.sliceReceiverPlacement)
  controls.spectrogramFrequencyScale = controls.spectrogramFrequencyScale === 'log' ? 'log' : 'linear'
  return controls
}
