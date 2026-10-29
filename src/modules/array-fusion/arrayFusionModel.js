export const FUSION_DURATION_SECONDS = 120
export const BEAM_SCAN_DEGREES = 90

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function seededNoise(a, b = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

function gaussian(value, center, width) {
  const x = (value - center) / Math.max(width, 0.001)
  return Math.exp(-0.5 * x * x)
}

export function wrapBearing(value) {
  return ((Number(value) + 540) % 360) - 180
}

const TARGET_PROFILES = Object.freeze({
  alpha: { start: [21, 45], drift: [-0.22, -0.10], turnAt: 52, turn: [0.12, -0.16], wobble: [3.2, 2.2], phase: 0.2, speedKnots: 17.5 },
  bravo: { start: [42, 24], drift: [-0.30, 0.05], turnAt: 38, turn: [0.20, 0.13], wobble: [2.4, 4.4], phase: 1.5, speedKnots: 24.0 },
  charlie: { start: [-34, 52], drift: [0.34, -0.14], turnAt: 70, turn: [-0.16, 0.20], wobble: [4.8, 2.8], phase: 2.7, speedKnots: 13.0 },
})

function headingFromVelocity(east, north) {
  return (Math.atan2(east, north) * 180) / Math.PI
}

function positionAt(time, profile) {
  const t = Math.max(0, Number(time) || 0)
  const maneuverTime = Math.max(0, t - profile.turnAt)
  const maneuverBlend = 1 - Math.exp(-maneuverTime / 13)
  const maneuverDistance = maneuverTime - 13 * maneuverBlend
  const wave = t * 0.045 + profile.phase
  const eastKm = profile.start[0] + profile.drift[0] * t
    + profile.turn[0] * maneuverDistance + profile.wobble[0] * Math.sin(wave)
  const northKm = profile.start[1] + profile.drift[1] * t
    + profile.turn[1] * maneuverDistance + profile.wobble[1] * Math.sin(wave * 0.73 + profile.phase)
  return { eastKm, northKm }
}

function velocityAt(time, positionFunction) {
  const before = positionFunction(Math.max(0, time - 0.1))
  const after = positionFunction(time + 0.1)
  return {
    east: (after.eastKm - before.eastKm) / 0.2,
    north: (after.northKm - before.northKm) / 0.2,
  }
}

function interpolateRouteByDistance(route, distanceKm) {
  if (!Array.isArray(route) || !route.length) return null
  if (route.length === 1) return { ...route[0] }
  const lengths = []
  let total = 0
  for (let index = 1; index < route.length; index += 1) {
    const length = Math.hypot(
      route[index].eastKm - route[index - 1].eastKm,
      route[index].northKm - route[index - 1].northKm,
    )
    lengths.push(length)
    total += length
  }
  if (total <= 0) return { ...route[0] }
  let remaining = clamp(Number(distanceKm) || 0, 0, total)
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] > 0 ? remaining / lengths[index] : 0
      return {
        eastKm: route[index].eastKm + (route[index + 1].eastKm - route[index].eastKm) * ratio,
        northKm: route[index].northKm + (route[index + 1].northKm - route[index].northKm) * ratio,
      }
    }
    remaining -= lengths[index]
  }
  return { ...route.at(-1) }
}

export function createScenarioState(time, targetId = 'alpha', options = {}) {
  const scenarioDuration = Math.max(10, Number(options.duration ?? FUSION_DURATION_SECONDS))
  const t = ((Number(time) % scenarioDuration) + scenarioDuration) % scenarioDuration
  const profile = TARGET_PROFILES[targetId] ?? TARGET_PROFILES.alpha
  const platformRoute = options.platformRoute
  const targetRoute = options.targetRoute ?? options.targetRoutes?.[targetId]
  const platformSpeedKnots = Number(options.platformSpeedKnots ?? (16.8 + 1.2 * Math.sin(t * 0.035)))
  const targetSpeedKnots = Number(options.targetSpeedKnots ?? profile.speedKnots)
  const platformHeadingOption = Number(options.platformHeadingDeg ?? 45)
  const targetHeadingOption = Number(options.targetHeadingDeg ?? 225)
  const motionMode = options.motionMode ?? 'route'
  const headingPosition = (origin, headingDeg, speedKnots, sampleTime) => ({
    eastKm: origin.eastKm + Math.sin((headingDeg * Math.PI) / 180) * speedKnots * 0.000514444 * sampleTime,
    northKm: origin.northKm + Math.cos((headingDeg * Math.PI) / 180) * speedKnots * 0.000514444 * sampleTime,
  })
  const platformOrigin = platformRoute?.[0] ?? { eastKm: -13, northKm: -12 }
  const targetOrigin = targetRoute?.[0] ?? { eastKm: profile.start[0], northKm: profile.start[1] }
  const platformPosition = (sampleTime) => motionMode === 'heading'
    ? headingPosition(platformOrigin, platformHeadingOption, platformSpeedKnots, sampleTime)
    : interpolateRouteByDistance(platformRoute, platformSpeedKnots * 0.000514444 * sampleTime) ?? headingPosition(platformOrigin, platformHeadingOption, platformSpeedKnots, sampleTime)
  const targetPosition = (sampleTime) => motionMode === 'heading'
    ? headingPosition(targetOrigin, targetHeadingOption, targetSpeedKnots, sampleTime)
    : interpolateRouteByDistance(targetRoute, targetSpeedKnots * 0.000514444 * sampleTime) ?? positionAt(sampleTime, profile)
  const platform = platformPosition(t)
  const target = targetPosition(t)
  const platformVelocity = velocityAt(t, platformPosition)
  const targetVelocity = velocityAt(t, targetPosition)
  const derivedPlatformHeading = headingFromVelocity(platformVelocity.east, platformVelocity.north)
  const derivedTargetHeading = headingFromVelocity(targetVelocity.east, targetVelocity.north)
  const platformHeading = motionMode === 'heading' ? platformHeadingOption : derivedPlatformHeading
  const targetHeading = motionMode === 'heading' ? targetHeadingOption : derivedTargetHeading
  const arrayHeadingMode = options.arrayHeadingMode ?? 'follow'
  const arrayHeading = arrayHeadingMode === 'fixed'
    ? Number(options.arrayHeadingDeg ?? wrapBearing(platformHeading + 180))
    : wrapBearing(platformHeading + 180)
  const towLengthKm = Math.max(0, Number(options.towLengthM ?? 300)) / 1000
  const array = {
    eastKm: platform.eastKm + Math.sin(((platformHeading + 180) * Math.PI) / 180) * towLengthKm,
    northKm: platform.northKm + Math.cos(((platformHeading + 180) * Math.PI) / 180) * towLengthKm,
    headingDeg: arrayHeading,
    towLengthM: towLengthKm * 1000,
  }
  const deltaEast = target.eastKm - array.eastKm
  const deltaNorth = target.northKm - array.northKm
  const rangeKm = Math.hypot(deltaEast, deltaNorth)
  const absoluteBearing = headingFromVelocity(deltaEast, deltaNorth)
  const arrayCurvature = 0.045 * Math.sin(t * 0.055) + 0.018 * Math.sin(t * 0.14 + 0.8)
  const arrivalBearing = wrapBearing(absoluteBearing + 180)
  let trueBearing = wrapBearing(arrivalBearing - (arrayHeading + 90))
  if (trueBearing > 90) trueBearing = 180 - trueBearing
  if (trueBearing < -90) trueBearing = -180 - trueBearing
  trueBearing = clamp(trueBearing, -BEAM_SCAN_DEGREES, BEAM_SCAN_DEGREES)
  const toVelocityMps = (heading, knots) => ({
    east: Math.sin((heading * Math.PI) / 180) * knots * 0.514444,
    north: Math.cos((heading * Math.PI) / 180) * knots * 0.514444,
  })
  const platformMps = toVelocityMps(platformHeading, platformSpeedKnots)
  const targetMps = toVelocityMps(targetHeading, targetSpeedKnots)
  const radialSpeed = rangeKm > 0
    ? ((targetMps.east - platformMps.east) * deltaEast
      + (targetMps.north - platformMps.north) * deltaNorth) / rangeKm
    : 0

  return {
    time: t,
    platform: {
      ...platform,
      headingDeg: platformHeading,
      speedKnots: platformSpeedKnots,
    },
    target: {
      ...target,
      headingDeg: targetHeading,
      speedKnots: targetSpeedKnots,
    },
    array,
    absoluteBearing,
    trueBearing,
    rangeKm,
    radialSpeedMps: radialSpeed,
    arrayHeading,
    arrayCurvature,
  }
}

export function createScenarioHistory(time, targetId = 'alpha', seconds = 42, step = 2, options = {}) {
  const start = Math.max(0, Number(time) - seconds)
  const rows = []
  for (let sampleTime = start; sampleTime <= Number(time) + 0.001; sampleTime += step) {
    const state = createScenarioState(sampleTime, targetId, options)
    rows.push({
      time: state.time,
      platform: state.platform,
      target: state.target,
    })
  }
  return rows
}

function numberArray(value) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []
}

export function normalizeFusionFrame(rawFrame = {}, fallbackTime = 0) {
  const time = Number(rawFrame.t ?? fallbackTime) || 0
  const trueBearing = clamp(Number(rawFrame.az_true ?? rawFrame.az ?? rawFrame.trueBearing ?? 0) || 0, -90, 90)
  const peakBearing = clamp(Number(rawFrame.az_peak ?? rawFrame.peakBearing ?? trueBearing) || 0, -90, 90)
  const rangeKm = clamp(Number(rawFrame.range_km ?? rawFrame.rangeKm ?? 45) || 45, 1, 120)
  const snr = Number(rawFrame.snr ?? 0) || 0

  const signal = rawFrame.signal && typeof rawFrame.signal === 'object' ? rawFrame.signal : {}
  const channel = rawFrame.channel && typeof rawFrame.channel === 'object' ? rawFrame.channel : {}
  const beam = rawFrame.beam && typeof rawFrame.beam === 'object' ? rawFrame.beam : {}
  const perElementTl = numberArray(channel.per_element_tl_db)
  const elementChannels = Array.isArray(channel.elements) ? channel.elements : []
  const selectedElement = Number(rawFrame.selected_element ?? channel.selected_element ?? 0) || 0
  const selectedElementChannel = elementChannels.find((item) => Number(item?.element_index) === selectedElement)
    ?? elementChannels[selectedElement]
    ?? null
  const selectedTl = Number(selectedElementChannel?.transmission_loss_db ?? perElementTl[selectedElement])
  const selectedPathCount = Number(selectedElementChannel?.path_count)
  const relative = rawFrame.kinematics?.relative ?? {}
  return {
    frame: Number(rawFrame.frame ?? Math.round(time * 5)) || 0,
    time,
    trueBearing,
    peakBearing,
    rangeKm,
    snr,
    detected: Boolean(rawFrame.detected ?? snr >= 6),
    event: Boolean(rawFrame.event),
    curve: numberArray(rawFrame.curve),
    scanAngles: numberArray(rawFrame.scan_angles_deg),
    frequencies: numberArray(rawFrame.frequencies_hz ?? rawFrame.frequencies),
    spectrum: numberArray(rawFrame.spectrum_db ?? rawFrame.spectrum),
    elementFrequencies: numberArray(signal.frequencies_hz ?? rawFrame.frequencies_hz ?? rawFrame.frequencies),
    elementSpectrum: numberArray(signal.spectrum_db ?? rawFrame.spectrum_db ?? rawFrame.spectrum),
    waveformTime: numberArray(signal.time_ms),
    waveform: numberArray(signal.waveform),
    beamOutputTime: numberArray(beam.output_time_ms),
    beamOutput: numberArray(beam.output_waveform),
    impulseResponse: Array.isArray(channel.impulse_response?.taps) ? channel.impulse_response.taps : [],
    perElementTl,
    elementChannels,
    selectedElement,
    selectedElementTl: Number.isFinite(selectedTl) ? selectedTl : null,
    selectedElementPathCount: Number.isFinite(selectedPathCount) ? selectedPathCount : null,
    radialSpeedMps: Number(rawFrame.radial_speed_mps ?? channel.radial_speed_mps ?? 0) || 0,
    dopplerHz: Number(rawFrame.doppler_hz ?? channel.doppler_hz ?? 0) || 0,
    toneFrequency: Number(rawFrame.tone_frequency_hz ?? 0) || 0,
    relativeBearing: Number(relative.arrival_bearing_deg),
    broadsideAngle: Number(relative.broadside_angle_deg),
    platformHeading: Number(rawFrame.kinematics?.platform?.heading_deg),
    targetHeading: Number(rawFrame.kinematics?.source?.heading_deg),
    kinematics: rawFrame.kinematics && typeof rawFrame.kinematics === 'object' ? rawFrame.kinematics : null,
    platform: rawFrame.platform && typeof rawFrame.platform === 'object' ? rawFrame.platform : null,
    target: rawFrame.target && typeof rawFrame.target === 'object' ? rawFrame.target : null,
    array: rawFrame.array && typeof rawFrame.array === 'object' ? rawFrame.array : null,
    arrayHeading: Number(rawFrame.arrayHeading ?? rawFrame.kinematics?.array?.heading_deg ?? 0) || 0,
    arrayCurvature: Number(rawFrame.arrayCurvature ?? rawFrame.array_curvature ?? 0) || 0,
    propagation: rawFrame.propagation && typeof rawFrame.propagation === 'object'
      ? rawFrame.propagation
      : null,
  }
}

export function createBeamCurve(peakBearing, time, snr, pointCount = 121) {
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = -BEAM_SCAN_DEGREES + (index / (pointCount - 1)) * BEAM_SCAN_DEGREES * 2
    const mainLobe = 31 * gaussian(angle, peakBearing, 3.4)
    const sideLobeLeft = 8 * gaussian(angle, peakBearing - 13, 5.2)
    const sideLobeRight = 7 * gaussian(angle, peakBearing + 14, 6.2)
    const floor = -39 + 1.7 * Math.sin(angle * 0.17 + time * 0.8) + seededNoise(index, time * 2) * 1.3
    return Number(clamp(floor + mainLobe + sideLobeLeft + sideLobeRight + snr * 0.18, -42, 2).toFixed(2))
  })
}

export function createDemoFrame(time, options = {}) {
  const duration = Number(options.duration ?? FUSION_DURATION_SECONDS)
  const t = ((Number(time) % duration) + duration) % duration
  const phase = (t / duration) * Math.PI * 2
  const centerFrequency = Number(options.centerFrequency ?? 1000)
  const threshold = Number(options.threshold ?? 6)
  const targetId = options.targetId ?? 'alpha'
  const scenario = createScenarioState(t, targetId, options)
  const trueBearing = scenario.trueBearing
  const eventEnvelope = Math.max(
    gaussian(t, 26, 5.5),
    gaussian(t, 64, 7),
    gaussian(t, 98, 5),
  )
  const rangeKm = scenario.rangeKm
  const snr = 3.2 + eventEnvelope * 13 + 2.1 * Math.sin(phase * 2.4) + seededNoise(t * 3.1) * 0.8
  const bearingError = seededNoise(Math.floor(t * 5), 17) * (eventEnvelope > 0.28 ? 1.1 : 3.8)
  const peakBearing = clamp(trueBearing + bearingError, -BEAM_SCAN_DEGREES, BEAM_SCAN_DEGREES)
  const event = eventEnvelope > 0.42
  const detected = snr >= threshold
  const dopplerHz = -centerFrequency * scenario.radialSpeedMps / 1500
  const toneFrequency = centerFrequency + dopplerHz
  const nElem = Math.max(2, Math.round(Number(options.nElem ?? 128)))
  const selectedElement = clamp(Math.round(Number(options.selectedElement ?? 1)) - 1, 0, nElem - 1)
  const elementSpacingM = Math.max(0.001, Number(options.elementSpacingM ?? 0.75))
  const elementOffsetM = (selectedElement - (nElem - 1) / 2) * elementSpacingM
  const directElementDelayS = elementOffsetM * Math.sin(trueBearing * Math.PI / 180) / 1500
  const absolutePhase = 2 * Math.PI * toneFrequency * t
  const waveformTime = Array.from({ length: 128 }, (_, index) => Number((index * 1000 / 8000).toFixed(4)))
  const waveform = waveformTime.map((timeMs, index) => Number((
    Math.cos(absolutePhase + 2 * Math.PI * toneFrequency * (timeMs / 1000 - directElementDelayS))
    + 0.18 * seededNoise(index + selectedElement * 131, t)
  ).toFixed(5)))
  const beamAmplitude = clamp(0.42 + snr / 28 + eventEnvelope * 0.22, 0.18, 1.25)
  const beamOutput = waveformTime.map((timeMs) => Number((
    beamAmplitude * Math.cos(absolutePhase + 2 * Math.PI * toneFrequency * timeMs / 1000 + 0.12)
      + 0.03 * seededNoise(timeMs, t + 41)
  ).toFixed(5)))
  const frequencies = Array.from({ length: 72 }, (_, index) => 100 + index * (2900 / 71))
  const spectrum = frequencies.map((frequency) => Number(clamp(
    -80 + 50 * gaussian(frequency, toneFrequency, 38)
      + 30 * gaussian(frequency, toneFrequency * 1.5, 55),
    -82, -30,
  ).toFixed(3)))
  const elementSpectrumShape = frequencies.map((frequency) => (
    50 * gaussian(frequency, toneFrequency, 38)
      + 30 * gaussian(frequency, toneFrequency * 1.5, 55)
      + 6.5 * Math.cos(2 * Math.PI * frequency * (0.0048 + selectedElement * 0.000013))
        * gaussian(frequency, toneFrequency * 1.2, 520)
  ))
  const elementSpectrumPeak = Math.max(...elementSpectrumShape)
  const elementSpectrum = elementSpectrumShape.map((value) => Number(
    clamp(-30 + value - elementSpectrumPeak, -82, -30).toFixed(3),
  ))
  const sourceDepthKm = Math.max(0.001, Number(options.targetDepthM ?? 180) / 1000)
  const receiverDepthKm = Math.max(0.001, Number(options.arrayDepthM ?? 50) / 1000)
  const bottomDepthKm = Math.max(1, sourceDepthKm + receiverDepthKm + 0.5)
  const pathLengthsKm = [
    Math.hypot(rangeKm, sourceDepthKm - receiverDepthKm),
    Math.hypot(rangeKm, sourceDepthKm + receiverDepthKm),
    Math.hypot(rangeKm, 2 * bottomDepthKm - sourceDepthKm - receiverDepthKm),
  ]
  const referenceDelayS = pathLengthsKm[0] / 1.5
  const impulseResponse = pathLengthsKm.map((pathLengthKm, index) => {
    const pathArrivalOffsetDeg = [0, 8, -13][index]
    const elementPathDelayS = elementOffsetM
      * Math.sin((trueBearing + pathArrivalOffsetDeg) * Math.PI / 180) / 1500
    const delayS = pathLengthKm / 1.5 + elementPathDelayS
    const magnitude = [1, 0.46, 0.24][index] * (1 + 0.08 * Math.sin(t * 0.17 + index))
    const tapPhase = -2 * Math.PI * toneFrequency * delayS + 2 * Math.PI * dopplerHz * t
    return {
      excess_delay_ms: Number(((delayS - referenceDelayS) * 1000).toFixed(5)),
      delay_s: Number(delayS.toFixed(9)),
      magnitude: Number(magnitude.toFixed(6)),
      gain_real: Number((magnitude * Math.cos(tapPhase)).toFixed(6)),
      gain_imag: Number((magnitude * Math.sin(tapPhase)).toFixed(6)),
    }
  })
  const curve = createBeamCurve(peakBearing, t, snr)
  const scanAngles = Array.from({ length: curve.length }, (_, index) => -90 + index * 180 / (curve.length - 1))

  return {
    frame: Math.round(t * 5),
    time: Number(t.toFixed(2)),
    trueBearing: Number(trueBearing.toFixed(2)),
    peakBearing: Number(peakBearing.toFixed(2)),
    rangeKm: Number(rangeKm.toFixed(2)),
    snr: Number(snr.toFixed(2)),
    detected,
    event,
    centerFrequency,
    toneFrequency,
    sourceLevel: 0.35 + eventEnvelope * 0.65,
    platform: scenario.platform,
    target: scenario.target,
    array: scenario.array,
    absoluteBearing: scenario.absoluteBearing,
    radialSpeedMps: scenario.radialSpeedMps,
    dopplerHz: Number(dopplerHz.toFixed(4)),
    arrayHeading: scenario.arrayHeading,
    arrayCurvature: scenario.arrayCurvature,
    history: createScenarioHistory(t, targetId, 42, 2, options),
    waveformTime,
    waveform,
    frequencies,
    spectrum,
    elementFrequencies: frequencies,
    elementSpectrum,
    beamOutputTime: waveformTime,
    beamOutput,
    impulseResponse,
    selectedElement,
    scanAngles,
    curve,
  }
}

export function createSpectrogram(time, options = {}) {
  const columns = Number(options.columns ?? 56)
  const rows = Number(options.rows ?? 36)
  const spanSeconds = Number(options.spanSeconds ?? 28)
  const minFrequency = Number(options.minFrequency ?? 200)
  const maxFrequency = Number(options.maxFrequency ?? 2200)
  const centerFrequency = Number(options.centerFrequency ?? 1000)
  const data = []

  for (let column = 0; column < columns; column += 1) {
    const sampleTime = Math.max(0, time - spanSeconds + (column / Math.max(columns - 1, 1)) * spanSeconds)
    const sampleFrame = createDemoFrame(sampleTime, { ...options, centerFrequency })
    for (let row = 0; row < rows; row += 1) {
      const frequency = minFrequency + (row / Math.max(rows - 1, 1)) * (maxFrequency - minFrequency)
      const tonal = 34 * gaussian(frequency, sampleFrame.toneFrequency, 58)
      const harmonic = 15 * gaussian(frequency, sampleFrame.toneFrequency * 1.52, 78)
      const lowBand = 8 * gaussian(frequency, 410 + 25 * Math.sin(sampleTime * 0.12), 130)
      const eventBand = sampleFrame.event ? 10 * gaussian(frequency, centerFrequency + 360, 260) : 0
      const noise = seededNoise(column * 9 + row, sampleTime * 0.5) * 2.2
      const power = clamp(-78 + tonal + harmonic + lowBand + eventBand + noise, -82, -28)
      data.push([column, row, Number(power.toFixed(1))])
    }
  }

  return {
    data,
    times: Array.from({ length: columns }, (_, index) =>
      Number(Math.max(0, time - spanSeconds + (index / Math.max(columns - 1, 1)) * spanSeconds).toFixed(1))),
    frequencies: Array.from({ length: rows }, (_, index) =>
      Math.round(minFrequency + (index / Math.max(rows - 1, 1)) * (maxFrequency - minFrequency))),
  }
}

export function createLiveSpectrogram(history, maxColumns = 56) {
  const rows = (Array.isArray(history) ? history : [])
    .filter((item) => item?.frequencies?.length && item.frequencies.length === item.spectrum?.length)
    .slice(-maxColumns)
  if (!rows.length) return null
  const frequencies = rows.at(-1).frequencies
  const usableRows = rows.filter((item) => item.frequencies.length === frequencies.length)
  const data = []
  usableRows.forEach((item, column) => {
    item.spectrum.forEach((power, row) => data.push([column, row, Number(power)]))
  })
  return {
    data,
    times: usableRows.map((item) => Number(item.time.toFixed(2))),
    frequencies,
  }
}

export function mergeRemoteFrame(rawFrame, fallbackFrame) {
  const normalized = normalizeFusionFrame(rawFrame, fallbackFrame.time)
  return {
    ...fallbackFrame,
    ...normalized,
    centerFrequency: fallbackFrame.centerFrequency,
    toneFrequency: normalized.toneFrequency || fallbackFrame.toneFrequency,
    sourceLevel: normalized.event ? 1 : fallbackFrame.sourceLevel,
    platform: normalized.platform ?? fallbackFrame.platform,
    target: normalized.target ?? fallbackFrame.target,
    array: normalized.array ?? fallbackFrame.array,
    arrayHeading: normalized.arrayHeading || fallbackFrame.arrayHeading,
    arrayCurvature: normalized.arrayCurvature || fallbackFrame.arrayCurvature,
    curve: normalized.curve.length ? normalized.curve : fallbackFrame.curve,
    scanAngles: normalized.scanAngles.length ? normalized.scanAngles : fallbackFrame.scanAngles,
    frequencies: normalized.frequencies.length ? normalized.frequencies : fallbackFrame.frequencies,
    spectrum: normalized.spectrum.length ? normalized.spectrum : fallbackFrame.spectrum,
    elementFrequencies: normalized.elementFrequencies.length
      ? normalized.elementFrequencies
      : fallbackFrame.elementFrequencies,
    elementSpectrum: normalized.elementSpectrum.length
      ? normalized.elementSpectrum
      : fallbackFrame.elementSpectrum,
    waveformTime: normalized.waveformTime.length ? normalized.waveformTime : fallbackFrame.waveformTime,
    waveform: normalized.waveform.length ? normalized.waveform : fallbackFrame.waveform,
    beamOutputTime: normalized.beamOutputTime.length ? normalized.beamOutputTime : fallbackFrame.beamOutputTime,
    beamOutput: normalized.beamOutput.length ? normalized.beamOutput : fallbackFrame.beamOutput,
    impulseResponse: normalized.impulseResponse.length ? normalized.impulseResponse : fallbackFrame.impulseResponse,
    perElementTl: normalized.perElementTl.length ? normalized.perElementTl : (fallbackFrame.perElementTl ?? []),
  }
}
