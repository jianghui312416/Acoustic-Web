/**
 * JOMOPANS-ECHO statistical ship source spectrum model.
 *
 * Reference: MacGillivray & de Jong (2021), JMSE 9(4), 369.
 * Output bands cover 20 Hz–20 kHz in decidecade (nominal one-third-octave)
 * steps and use dB re 1 µPa·m. Published model uncertainty is about 6 dB.
 */

export const JOMOPANS_MODEL_NAME = 'JOMOPANS-ECHO'
export const JOMOPANS_REFERENCE_LENGTH_M = 100
export const JOMOPANS_UNCERTAINTY_DB = 6
export const JOMOPANS_SOURCE_DEPTH_M = 6
export const JOMOPANS_MIN_FREQUENCY_HZ = 20
export const JOMOPANS_MAX_FREQUENCY_HZ = 20_000

export const JOMOPANS_FREQUENCIES_HZ = Object.freeze(Array.from({ length: 31 }, (_, index) => (
  JOMOPANS_MIN_FREQUENCY_HZ * (10 ** (index / 10))
)))

const VESSEL_CLASSES = Object.freeze({
  fishing: { label: '渔船', referenceSpeedKn: 6.4, d: 3 },
  tug: { label: '拖船', referenceSpeedKn: 3.7, d: 3 },
  naval: { label: '军舰', referenceSpeedKn: 11.1, d: 3 },
  recreational: { label: '休闲船', referenceSpeedKn: 10.6, d: 3 },
  government: { label: '公务/科考船', referenceSpeedKn: 8.0, d: 3 },
  cruise: { label: '邮轮', referenceSpeedKn: 17.1, d: 4 },
  passenger: { label: '客船', referenceSpeedKn: 9.7, d: 3 },
  bulker: { label: '散货船', referenceSpeedKn: 13.9, d: 3, cargoLowFrequencyD: 0.8 },
  containership: { label: '集装箱船', referenceSpeedKn: 18.0, d: 3, cargoLowFrequencyD: 0.8 },
  vehicleCarrier: { label: '汽车运输船', referenceSpeedKn: 15.8, d: 3, cargoLowFrequencyD: 1.0 },
  tanker: { label: '油轮', referenceSpeedKn: 12.4, d: 3, cargoLowFrequencyD: 1.0 },
  other: { label: '其他船舶', referenceSpeedKn: 7.4, d: 3 },
  dredger: { label: '疏浚船', referenceSpeedKn: 9.5, d: 3 },
})

function finiteNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function classifyJomopansVessel(vessel = {}) {
  const type = finiteNumber(vessel.ship_type)
  const speed = Math.max(0, finiteNumber(vessel.sog_kn) || 0)
  const length = finiteNumber(vessel.length_m)
  if (type === 30) return 'fishing'
  if (type === 31 || type === 32 || type === 52) return 'tug'
  if (type === 33) return 'dredger'
  if (type === 35) return 'naval'
  if (type === 36 || type === 37) return 'recreational'
  if (type === 51 || type === 53 || type === 55) return 'government'
  if (type >= 60 && type <= 69) return length != null && length > 100 ? 'cruise' : 'passenger'
  if (type >= 71 && type <= 74) return 'containership'
  if (type === 70 || (type >= 75 && type <= 79)) return speed > 16 ? 'containership' : 'bulker'
  if (type >= 80 && type <= 89) return 'tanker'

  // Preserve useful classification before the low-rate static AIS type arrives.
  const name = String(vessel.ship_type_name || '')
  if (name.includes('渔')) return 'fishing'
  if (name.includes('拖')) return 'tug'
  if (name.includes('疏浚')) return 'dredger'
  if (name.includes('军舰')) return 'naval'
  if (name.includes('游艇') || name.includes('帆船')) return 'recreational'
  if (name.includes('搜救') || name.includes('执法') || name.includes('补给')) return 'government'
  if (name.includes('客船')) return length != null && length > 100 ? 'cruise' : 'passenger'
  if (name.includes('油轮')) return 'tanker'
  if (name.includes('货船')) return speed > 16 ? 'containership' : 'bulker'
  return 'other'
}

function referenceSpectralDensityDb(frequencyHz, vesselClass) {
  const definition = VESSEL_CLASSES[vesselClass] || VESSEL_CLASSES.other
  const frequency = Math.max(Number.EPSILON, Number(frequencyHz))
  if (definition.cargoLowFrequencyD != null && frequency < 100) {
    const firstPeakHz = 600 / definition.referenceSpeedKn
    const resonance = (1 - (frequency / firstPeakHz) ** 2) ** 2
      + definition.cargoLowFrequencyD ** 2
    return 208
      - 40 * Math.log10(firstPeakHz)
      + 10 * Math.log10(frequency)
      - 10 * Math.log10(resonance)
  }
  const firstPeakHz = 480 / definition.referenceSpeedKn
  return 191
    - 20 * Math.log10(firstPeakHz)
    - 10 * Math.log10((1 - frequency / firstPeakHz) ** 2 + definition.d ** 2)
}

function energeticSumDb(levels) {
  const maximum = Math.max(...levels)
  if (!Number.isFinite(maximum)) return null
  const relativePower = levels.reduce((sum, level) => sum + 10 ** ((level - maximum) / 10), 0)
  return maximum + 10 * Math.log10(relativePower)
}

export function estimateJomopansEchoSpectrum(vessel = {}) {
  const vesselClass = classifyJomopansVessel(vessel)
  const definition = VESSEL_CLASSES[vesselClass] || VESSEL_CLASSES.other
  const reportedSpeed = finiteNumber(vessel.sog_kn)
  const reportedLength = finiteNumber(vessel.length_m)
  const assumptions = []

  let modelSpeedKn
  if (vesselClass === 'dredger' && reportedSpeed != null && reportedSpeed < 3) {
    modelSpeedKn = 14
    assumptions.push('低速疏浚按14 kn等效源级')
  } else if (reportedSpeed == null) {
    modelSpeedKn = definition.referenceSpeedKn
    assumptions.push('航速缺失，采用船型参考航速')
  } else if (reportedSpeed <= 0) {
    modelSpeedKn = 1
    assumptions.push('零航速按1 kn低速外推')
  } else {
    modelSpeedKn = reportedSpeed
  }

  const modelLengthM = reportedLength != null && reportedLength > 0
    ? reportedLength
    : JOMOPANS_REFERENCE_LENGTH_M
  if (!(reportedLength != null && reportedLength > 0)) assumptions.push('船长缺失，采用100 m参考船长')

  const speedCorrectionDb = 60 * Math.log10(modelSpeedKn / definition.referenceSpeedKn)
  const lengthCorrectionDb = 20 * Math.log10(modelLengthM / JOMOPANS_REFERENCE_LENGTH_M)
  const spectralDensityDb = []
  const bandLevelsDb = []
  for (const frequencyHz of JOMOPANS_FREQUENCIES_HZ) {
    const density = referenceSpectralDensityDb(frequencyHz, vesselClass)
      + speedCorrectionDb
      + lengthCorrectionDb
    spectralDensityDb.push(density)
    bandLevelsDb.push(density + 10 * Math.log10(0.231 * frequencyHz))
  }

  return {
    model: JOMOPANS_MODEL_NAME,
    vesselClass,
    vesselClassLabel: definition.label,
    referenceSpeedKn: definition.referenceSpeedKn,
    modelSpeedKn,
    modelLengthM,
    uncertaintyDb: JOMOPANS_UNCERTAINTY_DB,
    sourceDepthM: JOMOPANS_SOURCE_DEPTH_M,
    assumptions: Object.freeze(assumptions),
    frequenciesHz: JOMOPANS_FREQUENCIES_HZ,
    spectralDensityDb: Object.freeze(spectralDensityDb),
    bandLevelsDb: Object.freeze(bandLevelsDb),
    broadbandSourceLevelDb: energeticSumDb(bandLevelsDb),
  }
}

export function estimateJomopansEchoSourceLevel(vessel = {}) {
  return estimateJomopansEchoSpectrum(vessel).broadbandSourceLevelDb
}

