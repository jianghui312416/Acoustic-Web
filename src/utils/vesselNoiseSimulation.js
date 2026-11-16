const EARTH_RADIUS_M = 6_371_008.8
export const SELECTED_VESSEL_MAX_RANGE_NM = 1

const radians = value => Number(value) * Math.PI / 180
const degrees = value => Number(value) * 180 / Math.PI
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

export function distancePerMinuteM(speedKn) {
  const speed = Number(speedKn)
  return Number.isFinite(speed) && speed > 0 ? speed * 1852 / 60 : 0
}

export function routeDurationSeconds(samples, speedKn) {
  const totalDistanceM = Number(Array.isArray(samples) ? samples.at(-1)?.distanceM : 0)
  const speedMps = Number(speedKn) * 1852 / 3600
  return totalDistanceM > 0 && speedMps > 0 ? totalDistanceM / speedMps : 0
}

/**
 * Build the automatic signal-transmission route for a selected AIS vessel.
 * COG is the actual direction of travel, while heading is retained as a
 * fallback for feeds that do not report COG.
 */
export function buildSelectedVesselRoute(
  vessel,
  maximumRangeNm = SELECTED_VESSEL_MAX_RANGE_NM,
) {
  const lon = Number(vessel?.longitude)
  const lat = Number(vessel?.latitude)
  const cog = vessel?.cog_deg == null || vessel?.cog_deg === '' ? Number.NaN : Number(vessel.cog_deg)
  const heading = vessel?.heading_deg == null || vessel?.heading_deg === '' ? Number.NaN : Number(vessel.heading_deg)
  const course = Number.isFinite(cog) && cog >= 0 && cog < 360
    ? cog
    : Number.isFinite(heading) && heading >= 0 && heading < 360
      ? heading
      : Number.NaN
  const rangeNm = Math.max(0, Number(maximumRangeNm) || 0)
  if (
    !Number.isFinite(lon) || lon < -180 || lon > 180
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(course) || !(rangeNm > 0)
  ) return []

  const angularDistance = rangeNm * 1852 / EARTH_RADIUS_M
  const bearing = radians((course % 360 + 360) % 360)
  const latitude = radians(lat)
  const longitude = radians(lon)
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
    + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  )
  return [
    { lon, lat },
    {
      lon: ((degrees(destinationLongitude) + 540) % 360) - 180,
      lat: degrees(destinationLatitude),
    },
  ]
}

/** Resolve the JOMOPANS vessel input: AIS speed wins; otherwise use the manual menu speed. */
export function resolveVesselSimulationProfile(selectedVessel, manualSpeedKn = 10) {
  if (selectedVessel) return { ...selectedVessel, speedSource: 'ais' }
  const parsedSpeed = Number(manualSpeedKn)
  const speed = Number.isFinite(parsedSpeed) ? clamp(parsedSpeed, 0.1, 60) : 10
  return {
    vessel_name: '手动航速船舶',
    ship_type_name: '其他船舶',
    sog_kn: speed,
    length_m: 100,
    speedSource: 'manual',
  }
}

export function greatCircleDistanceM(first, second) {
  const lat1 = radians(first?.lat)
  const lat2 = radians(second?.lat)
  const deltaLat = lat2 - lat1
  const deltaLon = radians(Number(second?.lon) - Number(first?.lon))
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function initialBearingDeg(first, second) {
  const lat1 = radians(first?.lat)
  const lat2 = radians(second?.lat)
  const deltaLon = radians(Number(second?.lon) - Number(first?.lon))
  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
  return (degrees(Math.atan2(y, x)) + 360) % 360
}

function interpolateGreatCircle(first, second, ratio) {
  const t = clamp(Number(ratio) || 0, 0, 1)
  const lat1 = radians(first.lat)
  const lon1 = radians(first.lon)
  const lat2 = radians(second.lat)
  const lon2 = radians(second.lon)
  const angularDistance = greatCircleDistanceM(first, second) / EARTH_RADIUS_M
  if (!(angularDistance > 1e-12)) return { lon: Number(first.lon), lat: Number(first.lat) }
  const sinDistance = Math.sin(angularDistance)
  const a = Math.sin((1 - t) * angularDistance) / sinDistance
  const b = Math.sin(t * angularDistance) / sinDistance
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2)
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2)
  const z = a * Math.sin(lat1) + b * Math.sin(lat2)
  return {
    lon: ((degrees(Math.atan2(y, x)) + 540) % 360) - 180,
    lat: degrees(Math.atan2(z, Math.hypot(x, y))),
  }
}

/** Convert user-picked polyline vertices into source stations no farther than spacingM apart. */
export function resampleTrackByDistance(points, spacingM = 1000) {
  const clean = (Array.isArray(points) ? points : [])
    .map(point => ({ lon: Number(point?.lon), lat: Number(point?.lat) }))
    .filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat))
  if (clean.length === 1) return [{ ...clean[0], index: 0, distanceM: 0, distanceKm: 0 }]
  if (clean.length < 2) return []
  const spacing = Math.max(1, Number(spacingM) || 1000)
  const segments = []
  let totalDistanceM = 0
  for (let index = 0; index < clean.length - 1; index += 1) {
    const distanceM = greatCircleDistanceM(clean[index], clean[index + 1])
    if (!(distanceM > 0)) continue
    segments.push({ first: clean[index], second: clean[index + 1], startM: totalDistanceM, distanceM })
    totalDistanceM += distanceM
  }
  if (!(totalDistanceM > 0)) return []

  const targets = []
  for (let distanceM = 0; distanceM < totalDistanceM; distanceM += spacing) targets.push(distanceM)
  targets.push(totalDistanceM)
  let segmentIndex = 0
  return targets.map((distanceM, index) => {
    while (
      segmentIndex < segments.length - 1
      && distanceM > segments[segmentIndex].startM + segments[segmentIndex].distanceM
    ) segmentIndex += 1
    const segment = segments[segmentIndex]
    const ratio = (distanceM - segment.startM) / segment.distanceM
    return {
      ...interpolateGreatCircle(segment.first, segment.second, ratio),
      index,
      distanceM,
      distanceKm: distanceM / 1000,
    }
  })
}

export function routeSampleIndexAtTime(samples, timeS, durationS) {
  if (!Array.isArray(samples) || !samples.length) return -1
  const duration = Math.max(1e-6, Number(durationS) || 1)
  const targetDistance = samples[samples.length - 1].distanceM * clamp(Number(timeS) / duration, 0, 1)
  let low = 0
  let high = samples.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (samples[middle].distanceM <= targetDistance + 1e-6) low = middle
    else high = middle - 1
  }
  return low
}

function nearestIndex(values, target) {
  if (!Array.isArray(values) || !values.length) return -1
  let bestIndex = 0
  let bestDifference = Infinity
  values.forEach((value, index) => {
    const difference = Math.abs(Number(value) - target)
    if (difference < bestDifference) {
      bestDifference = difference
      bestIndex = index
    }
  })
  return bestIndex
}

/** Sample receiver TL from a parsed Analyse3DTLRD field at bearing/range/depth. */
export function sampleReceiverTlDb(field, { bearingDeg, distanceM, depthM }) {
  const grid = field?.grid
  if (!grid || typeof field.at !== 'function') return null
  const bearings = Array.isArray(grid.compassBearings) && grid.compassBearings.length === grid.sector
    ? grid.compassBearings.map(Number)
    : Array.from({ length: grid.sector }, (_, index) => index * 360 / grid.sector)
  let sectorIndex = 0
  let bearingDifference = Infinity
  bearings.forEach((bearing, index) => {
    const raw = Math.abs(((bearing - Number(bearingDeg) + 540) % 360) - 180)
    if (raw < bearingDifference) {
      bearingDifference = raw
      sectorIndex = index
    }
  })
  const distanceIndex = nearestIndex(grid.distance, Number(distanceM))
  const depthIndex = nearestIndex(grid.depth, Number(depthM))
  if (distanceIndex < 0 || depthIndex < 0) return null
  for (let radius = 0; radius <= 3; radius += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const value = Number(field.at(sectorIndex, depthIndex + dz, distanceIndex + dx))
        if (Number.isFinite(value) && value >= 0 && value < 199.5) return value
      }
    }
  }
  return null
}

function logInterpolate(x, xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || !xs.length || xs.length !== ys.length) return null
  const target = Math.log10(Math.max(1e-9, Number(x)))
  if (x <= xs[0]) return Number(ys[0])
  if (x >= xs[xs.length - 1]) return Number(ys[ys.length - 1])
  let upper = 1
  while (upper < xs.length && Number(xs[upper]) < x) upper += 1
  const lower = Math.max(0, upper - 1)
  const x0 = Math.log10(Math.max(1e-9, Number(xs[lower])))
  const x1 = Math.log10(Math.max(1e-9, Number(xs[upper])))
  const ratio = x1 === x0 ? 0 : (target - x0) / (x1 - x0)
  const y0 = Number(ys[lower])
  const y1 = Number(ys[upper])
  return Number.isFinite(y0) && Number.isFinite(y1) ? y0 + (y1 - y0) * ratio : null
}

function powerSumDb(first, second) {
  if (!Number.isFinite(first)) return Number.isFinite(second) ? second : null
  if (!Number.isFinite(second)) return first
  const maximum = Math.max(first, second)
  return maximum + 10 * Math.log10(10 ** ((first - maximum) / 10) + 10 ** ((second - maximum) / 10))
}

function powerSumManyDb(levels) {
  return (Array.isArray(levels) ? levels : []).reduce(
    (total, level) => powerSumDb(total, level),
    null,
  )
}

function unitRandom(first, second, seed = 0) {
  const value = Math.sin((Number(first) + 1) * 12.9898
    + (Number(second) + 1) * 78.233
    + Number(seed) * 37.719) * 43758.5453
  return value - Math.floor(value)
}

function gaussianRandom(first, second, seed = 0) {
  let total = 0
  for (let index = 0; index < 4; index += 1) {
    total += unitRandom(first + index * 17, second + index * 29, seed + index * 43)
  }
  return (total - 2) * Math.sqrt(3)
}

function smoothNoise(position, lane, seed = 0) {
  const start = Math.floor(Number(position) || 0)
  const ratio = clamp((Number(position) || 0) - start, 0, 1)
  const blend = ratio * ratio * (3 - 2 * ratio)
  const first = gaussianRandom(start, lane, seed)
  const second = gaussianRandom(start + 1, lane, seed)
  return first + (second - first) * blend
}

function gaussianLogBand(frequencyHz, centreHz, widthOctaves) {
  const octaves = Math.log2(Math.max(1e-9, frequencyHz) / centreHz)
  return Math.exp(-0.5 * (octaves / widthOctaves) ** 2)
}

const ACOUSTIC_SIGNATURES = Object.freeze({
  tanker: Object.freeze({ shaftRangeHz: [1, 1.5], cavitationPeakHz: 400, cavitationRolloffDbOct: 6 }),
  cargo: Object.freeze({ shaftRangeHz: [1.5, 2.5], cavitationPeakHz: 600, cavitationRolloffDbOct: 5 }),
  fishing: Object.freeze({ shaftRangeHz: [4, 8], cavitationPeakHz: 1500, cavitationRolloffDbOct: 4 }),
  smallCraft: Object.freeze({ shaftRangeHz: [15, 30], cavitationPeakHz: 5000, cavitationRolloffDbOct: 3 }),
})

function signatureFamily(vesselClass, speedKn) {
  if (['tanker', 'bulker', 'vehicleCarrier'].includes(vesselClass)) return 'tanker'
  if (['containership', 'cruise', 'passenger'].includes(vesselClass)) return 'cargo'
  if (['fishing', 'tug', 'dredger'].includes(vesselClass)) return 'fishing'
  if (vesselClass === 'recreational') return 'smallCraft'
  return Number(speedKn) >= 14 ? 'smallCraft' : Number(speedKn) >= 7 ? 'cargo' : 'fishing'
}

/**
 * Build one stable synthetic machinery signature for a simulation run.
 *
 * This is an independent browser implementation informed by the component
 * structure documented by MUSAS and Underwater Acoustic Synthetic Dataset V5:
 * PSD-shaped broadband noise, shaft/BPF harmonics, auxiliary machinery,
 * structural resonances, and blade-gated cavitation with a slow swell envelope.
 */
function buildHydrophoneSignature(sourceSpectrum, seed) {
  const vesselClass = String(sourceSpectrum?.vesselClass || 'other')
  const modelSpeedKn = Number(sourceSpectrum?.modelSpeedKn) || 10
  const referenceSpeedKn = Math.max(0.1, Number(sourceSpectrum?.referenceSpeedKn) || modelSpeedKn)
  const family = signatureFamily(vesselClass, modelSpeedKn)
  const definition = ACOUSTIC_SIGNATURES[family]
  const speedRatio = clamp(modelSpeedKn / referenceSpeedKn, 0.35, 1.8)
  const [minimumShaftHz, maximumShaftHz] = definition.shaftRangeHz
  const randomShaftHz = minimumShaftHz
    + (maximumShaftHz - minimumShaftHz) * unitRandom(11, 3, seed)
  const shaftRateHz = randomShaftHz * clamp(0.78 + 0.22 * Math.sqrt(speedRatio), 0.7, 1.25)
  const bladeCount = 3 + Math.floor(unitRandom(19, 7, seed) * 3)
  const bladePassFrequencyHz = shaftRateHz * bladeCount
  const generatorFrequencyHz = unitRandom(23, 13, seed) > 0.38 ? 50 : 0
  const equipmentFrequencyHz = unitRandom(29, 17, seed) > 0.28
    ? (unitRandom(31, 19, seed) > 0.5 ? 25 : 30)
    : 0
  const resonanceFrequenciesHz = [
    50 + 100 * unitRandom(37, 23, seed),
    100 + 200 * unitRandom(41, 29, seed),
    200 + 300 * unitRandom(43, 31, seed),
  ]
  const cavitationIntensity = clamp(
    0.18 + 0.62 * (speedRatio - 0.35) / 1.45 + 0.16 * unitRandom(47, 37, seed),
    0.12,
    1,
  )
  const swellFrequencyHz = 0.05 + 0.1 * unitRandom(53, 41, seed)
  const tones = []
  const addHarmonics = (baseHz, count, peakDb, decayDb, kind, widthOctaves) => {
    if (!(baseHz > 0)) return
    for (let harmonic = 1; harmonic <= count; harmonic += 1) {
      tones.push({
        frequencyHz: baseHz * harmonic,
        boostDb: peakDb - decayDb * (harmonic - 1),
        widthOctaves,
        driftFraction: kind === 'resonance' ? 0.002 : 0.006,
        kind,
        lane: tones.length + 1,
      })
    }
  }
  addHarmonics(shaftRateHz, 12, 9, 3, 'shaft', 0.045)
  addHarmonics(bladePassFrequencyHz, 8, 14, 4, 'blade', 0.05)
  addHarmonics(generatorFrequencyHz, 4, 6, 5, 'generator', 0.04)
  addHarmonics(equipmentFrequencyHz, 6, 7, 4, 'equipment', 0.045)
  resonanceFrequenciesHz.forEach((frequencyHz, index) => {
    tones.push({
      frequencyHz,
      boostDb: 8 - index,
      widthOctaves: 0.065,
      driftFraction: 0.003,
      kind: 'resonance',
      lane: tones.length + 1,
    })
  })
  return Object.freeze({
    family,
    shaftRateHz,
    bladeCount,
    bladePassFrequencyHz,
    generatorFrequencyHz,
    equipmentFrequencyHz,
    resonanceFrequenciesHz: Object.freeze(resonanceFrequenciesHz),
    cavitationPeakHz: definition.cavitationPeakHz,
    cavitationRolloffDbOct: definition.cavitationRolloffDbOct,
    cavitationIntensity,
    swellFrequencyHz,
    tones: Object.freeze(tones),
  })
}

function machineryToneRelativeDb(frequencyHz, signature) {
  let relativePower = 0
  for (const tone of signature.tones) {
    if (tone.boostDb < -24) continue
    const shape = gaussianLogBand(frequencyHz, tone.frequencyHz, tone.widthOctaves)
    if (shape < 1e-7) continue
    relativePower += 10 ** (tone.boostDb / 10) * shape
  }
  return relativePower > 1e-8
    ? 10 * Math.log10(relativePower)
    : null
}

function propulsionEnvelopeDb(timeS, signature, seed) {
  const shaftPhase = 2 * Math.PI * signature.shaftRateHz * timeS
  const bladePhase = 2 * Math.PI * signature.bladePassFrequencyHz * timeS
  const swellPhase = 2 * Math.PI * signature.swellFrequencyHz * timeS
    + 2 * Math.PI * unitRandom(61, 43, seed)
  const bladeGate = Math.max(0, Math.cos(bladePhase)) ** 2.4
  const shaftWobble = 0.5 + 0.5 * Math.cos(shaftPhase + 0.35 * Math.sin(bladePhase))
  const swell = 0.82 + 0.18 * Math.sin(swellPhase)
  const burstJitter = Math.max(0.45, 1 + 0.18 * smoothNoise(timeS * 2.2, 5, seed + 727))
  const envelope = Math.max(0.12, swell * burstJitter * (0.62 + 0.28 * bladeGate + 0.1 * shaftWobble))
  return 20 * Math.log10(envelope)
}

function cavitationRelativeDb(frequencyHz, signature) {
  const peakShape = gaussianLogBand(frequencyHz, signature.cavitationPeakHz, 1.05)
  const highFrequencyTail = frequencyHz > signature.cavitationPeakHz
    ? (frequencyHz / signature.cavitationPeakHz) ** (-signature.cavitationRolloffDbOct / 3.0103)
    : 0
  const spectralPower = signature.cavitationIntensity * (peakShape + 0.18 * highFrequencyTail)
  if (!(spectralPower > 1e-8)) return null
  return 7 + 10 * Math.log10(spectralPower)
}

function fallbackAmbientSpectrumDb(frequencyHz) {
  const frequency = Math.max(20, Number(frequencyHz) || 20)
  return 72 - 17 * Math.log10(frequency / 100)
    + 4 * gaussianLogBand(frequency, 80, 0.32)
}

function percentile(values, ratio) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1)
  return sorted[index]
}

function nearestKnownLoss(losses, index) {
  if (!Array.isArray(losses)) return null
  if (losses[index] != null && Number.isFinite(Number(losses[index]))) return Number(losses[index])
  for (let offset = 1; offset < losses.length; offset += 1) {
    const beforeRaw = losses[index - offset]
    const afterRaw = losses[index + offset]
    const before = Number(beforeRaw)
    const after = Number(afterRaw)
    if (beforeRaw != null && Number.isFinite(before)) return before
    if (afterRaw != null && Number.isFinite(after)) return after
  }
  return null
}

function thorpAbsorptionDbPerKm(frequencyHz) {
  const khz = Math.max(0.001, Number(frequencyHz) / 1000)
  const square = khz * khz
  return 0.11 * square / (1 + square)
    + 44 * square / (4100 + square)
    + 2.75e-4 * square
    + 0.003
}

/** Build the hydrophone receive spectrogram from JOMOPANS source PSD, Bellhop TL and weather noise PSD. */
export function buildVesselReceiveSpectrogram({
  samples = [],
  durationS = 30,
  windowStartS = 0,
  windowDurationS = durationS,
  routeDurationS = durationS,
  preRollS = 0,
  sourceSpectrum,
  receiverTlDb = [],
  receiverDistancesM = [],
  referenceFrequencyHz = 100,
  backgroundFrequencyHz = [],
  backgroundSpectrumDb = [],
  minimumFrequencyHz = null,
  maximumFrequencyHz = null,
  timeCount = 361,
  frequencyCount = 96,
  textureSeed = 20261106,
} = {}) {
  const sourceFrequencies = Array.from(sourceSpectrum?.frequenciesHz || [], Number)
  const sourcePsd = Array.from(sourceSpectrum?.spectralDensityDb || [], Number)
  if (!sourceFrequencies.length || sourceFrequencies.length !== sourcePsd.length || !samples.length) {
    return { times: [], frequencies: [], data: [], minDb: 0, maxDb: 1, calculatedCount: 0 }
  }
  const count = clamp(Math.round(Number(timeCount) || 361), 2, 900)
  const bandCount = clamp(Math.round(Number(frequencyCount) || 96), 32, 160)
  const requestedMinimum = Number(minimumFrequencyHz)
  const requestedMaximum = Number(maximumFrequencyHz)
  const minimumFrequency = Number.isFinite(requestedMinimum) && requestedMinimum > 0
    ? requestedMinimum
    : Math.max(1, sourceFrequencies[0])
  const maximumFrequency = Number.isFinite(requestedMaximum) && requestedMaximum > minimumFrequency
    ? requestedMaximum
    : Math.max(minimumFrequency, sourceFrequencies[sourceFrequencies.length - 1])
  const frequencies = Array.from({ length: bandCount }, (_, index) => (
    minimumFrequency * (maximumFrequency / minimumFrequency) ** (index / Math.max(1, bandCount - 1))
  ))
  const duration = Math.max(1, Number(durationS) || 30)
  const routeDuration = Math.max(1, Number(routeDurationS) || duration)
  const preRoll = clamp(Number(preRollS) || 0, 0, duration)
  const windowStart = clamp(Number(windowStartS) || 0, 0, duration)
  const windowEnd = clamp(windowStart + Math.max(1, Number(windowDurationS) || duration), windowStart, duration)
  const windowSpan = Math.max(1e-6, windowEnd - windowStart)
  const times = Array.from({ length: count }, (_, index) => windowStart + windowSpan * index / (count - 1))
  const data = []
  const levels = []
  const backgroundFrequencies = Array.from(backgroundFrequencyHz || [], Number)
  const backgroundLevels = Array.from(backgroundSpectrumDb || [], Number)
  const signature = buildHydrophoneSignature(sourceSpectrum, Number(textureSeed) || 20261106)
  const sourceLevelsDb = frequencies.map(frequencyHz => {
    if (!sourceSpectrum?.narrowband) return logInterpolate(frequencyHz, sourceFrequencies, sourcePsd)
    const components = sourceFrequencies.map((centreHz, index) => {
      const shape = gaussianLogBand(frequencyHz, centreHz, 0.035)
      return shape > 1e-8 && Number.isFinite(sourcePsd[index])
        ? sourcePsd[index] + 10 * Math.log10(shape)
        : null
    })
    return powerSumManyDb(components)
  })
  const absorptionDbPerKm = frequencies.map(frequencyHz => (
    thorpAbsorptionDbPerKm(frequencyHz) - thorpAbsorptionDbPerKm(referenceFrequencyHz)
  ))
  const backgroundBaseLevelsDb = frequencies.map(frequencyHz => {
    const interpolated = logInterpolate(frequencyHz, backgroundFrequencies, backgroundLevels)
    return Number.isFinite(interpolated) ? interpolated : fallbackAmbientSpectrumDb(frequencyHz)
  })
  const machineryRelativeLevelsDb = frequencies.map(frequencyHz => (
    machineryToneRelativeDb(frequencyHz, signature)
  ))
  const cavitationRelativeLevelsDb = frequencies.map(frequencyHz => (
    cavitationRelativeDb(frequencyHz, signature)
  ))
  times.forEach((timeS, timeIndex) => {
    const absoluteTimeBin = Math.round(timeS * 10)
    const vesselActive = timeS >= preRoll
    const routeTimeS = Math.max(0, timeS - preRoll)
    const sampleIndex = routeSampleIndexAtTime(samples, routeTimeS, routeDuration)
    const baseTl = nearestKnownLoss(receiverTlDb, sampleIndex)
    const distanceKm = Math.max(0, Number(receiverDistancesM[sampleIndex]) || 0) / 1000
    const propulsionDb = propulsionEnvelopeDb(timeS, signature, textureSeed)
    frequencies.forEach((frequencyHz, frequencyIndex) => {
      const sourceLevelDb = sourceLevelsDb[frequencyIndex]
      const absorptionDelta = distanceKm * absorptionDbPerKm[frequencyIndex]
      const shipBroadbandDb = Number.isFinite(sourceLevelDb)
        ? sourceLevelDb
          + 1.9 * gaussianRandom(absoluteTimeBin, frequencyIndex, textureSeed + 101)
          + 1.1 * smoothNoise(timeS * 1.35, Math.floor(frequencyIndex / 3), textureSeed + 109)
          + 0.55 * smoothNoise(timeS * 3.1, 0, textureSeed + 113)
          + 0.35 * propulsionDb
        : null
      const machineryRelativeDb = machineryRelativeLevelsDb[frequencyIndex]
      const machineryDb = Number.isFinite(sourceLevelDb) && Number.isFinite(machineryRelativeDb)
        ? sourceLevelDb + machineryRelativeDb
          + 0.7 * smoothNoise(timeS * 0.45, frequencyIndex, textureSeed + 709)
        : null
      const cavitationRelativeLevelDb = cavitationRelativeLevelsDb[frequencyIndex]
      const cavitationDb = Number.isFinite(sourceLevelDb) && Number.isFinite(cavitationRelativeLevelDb)
        ? sourceLevelDb + cavitationRelativeLevelDb + propulsionDb
          + 2.2 * gaussianRandom(absoluteTimeBin, frequencyIndex, textureSeed + 733)
        : null
      const shipSourceDb = powerSumManyDb([shipBroadbandDb, machineryDb, cavitationDb])
      const receivedShipDb = vesselActive && Number.isFinite(baseTl) && Number.isFinite(shipSourceDb)
        ? shipSourceDb - baseTl - absorptionDelta
        : null
      const backgroundRandomDb = 2.1 * gaussianRandom(absoluteTimeBin, frequencyIndex, textureSeed + 211)
        + 1.15 * smoothNoise(timeS * 1.1, Math.floor(frequencyIndex / 4), textureSeed + 223)
        + 0.7 * smoothNoise(timeS * 2.6, 0, textureSeed + 227)
      const backgroundDb = backgroundBaseLevelsDb[frequencyIndex] + backgroundRandomDb
      const totalDb = powerSumDb(receivedShipDb, backgroundDb)
      if (!Number.isFinite(totalDb)) return
      const rounded = Math.round(totalDb * 10) / 10
      levels.push(rounded)
      data.push([timeIndex, frequencyIndex, rounded])
    })
  })
  const low = percentile(levels, 0.02)
  const high = percentile(levels, 0.985)
  return {
    times,
    frequencies,
    data,
    minDb: Number.isFinite(low) ? Math.floor((low - 3) / 5) * 5 : 0,
    maxDb: Number.isFinite(high) ? Math.ceil((high + 5) / 5) * 5 : 1,
    preRollS: preRoll,
    acousticProfile: signature,
    calculatedCount: receiverTlDb.filter(value => value != null && Number.isFinite(Number(value))).length,
  }
}

/** Integrate PSD bins (dB re 1 µPa²/Hz) into broadband RMS sound pressure in Pa. */
export function spectrogramPressureSeries(spectrogram = {}) {
  const times = Array.from(spectrogram?.times || [], Number)
  const frequencies = Array.from(spectrogram?.frequencies || [], Number)
  if (!times.length || !frequencies.length) return { times: [], rmsPa: [] }
  const edges = Array(frequencies.length + 1)
  edges[0] = frequencies[0]
  for (let index = 1; index < frequencies.length; index += 1) {
    const lower = Math.max(1e-9, frequencies[index - 1])
    const upper = Math.max(lower, frequencies[index])
    edges[index] = Math.sqrt(lower * upper)
  }
  edges[frequencies.length] = frequencies[frequencies.length - 1]
  const bandwidthHz = frequencies.map((_, index) => Math.max(1e-9, edges[index + 1] - edges[index]))
  const pressureSquaredMicroPa = Array(times.length).fill(0)
  for (const [timeIndexRaw, frequencyIndexRaw, levelRaw] of spectrogram?.data || []) {
    const timeIndex = Number(timeIndexRaw)
    const frequencyIndex = Number(frequencyIndexRaw)
    const levelDb = Number(levelRaw)
    if (!Number.isInteger(timeIndex) || !Number.isInteger(frequencyIndex) || !Number.isFinite(levelDb)) continue
    if (timeIndex < 0 || timeIndex >= times.length || frequencyIndex < 0 || frequencyIndex >= frequencies.length) continue
    pressureSquaredMicroPa[timeIndex] += (10 ** (levelDb / 10)) * bandwidthHz[frequencyIndex]
  }
  return {
    times,
    rmsPa: pressureSquaredMicroPa.map(value => Math.sqrt(Math.max(0, value)) * 1e-6),
  }
}

