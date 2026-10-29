import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOTTOM_TYPE_DATA_TYPE,
  BOTTOM_ACOUSTIC_DATA_TYPES,
  bottomTypeAcousticProperties,
  bottomTypeColor,
  bottomTypeLabel,
  buildBottomTypeSegments,
  enrichBottomTypeSegments,
  buildRoutePoints,
  normalizeBottomTypeId,
} from '../src/utils/bottomTypeModel.js'

function fullPortalResponse(response) {
  return {
    'Technical Support': 'XWOcean',
    Data: {
      SN: 110,
      Units: [{ Plugin: 'GetEnvDataRoute', Response: response, ResultCode: 0 }],
    },
  }
}

test('uses the documented geoacoustic class-id data type', () => {
  assert.equal(BOTTOM_TYPE_DATA_TYPE, 'DT_ENV_GEOACOUSTIC_CLASSID')
  assert.equal(BOTTOM_ACOUSTIC_DATA_TYPES.cp, 'DT_ENV_GEOACOUSTIC_CP')
  assert.equal(BOTTOM_ACOUSTIC_DATA_TYPES.alphaP, 'DT_ENV_GEOACOUSTIC_ALPHA_P')
  assert.equal(BOTTOM_ACOUSTIC_DATA_TYPES.density, 'DT_ENV_GEOACOUSTIC_DENSITY')
  assert.equal(BOTTOM_ACOUSTIC_DATA_TYPES.porosity, 'DT_ENV_GEOACOUSTIC_POROSITY')
})

test('enriches class segments with real route acoustic values', () => {
  const routePoints = buildRoutePoints(115, 16, 90, 2000, 3)
  const valueResponse = (values) => fullPortalResponse({
    SamplingPoints: { size: 3, x: routePoints.map((p) => p.x), y: routePoints.map((p) => p.y) },
    ProfileData: { size: 3, data: values.map((value) => ({ size: 1, x: [0], y: [value] })) },
  })
  const enriched = enrichBottomTypeSegments(
    [{ startM: 0, endM: 2000, id: 4, label: '类型4' }],
    {
      cp: valueResponse([1470, 1480, 1490]),
      alphaP: valueResponse([0.1, 0.2, 0.3]),
      density: valueResponse([1300, 1400, 1500]),
      porosity: valueResponse([0.7, 0.6, 0.5]),
    },
    { fallbackDistanceM: 2000, routePoints }
  )
  assert.equal(enriched.length, 1)
  assert.ok(Math.abs(enriched[0].acoustics.cp - 1480) < 0.01)
  assert.ok(Math.abs(enriched[0].acoustics.alphaP - 0.2) < 0.001)
  assert.ok(Math.abs(enriched[0].acoustics.density - 1400) < 0.01)
  assert.ok(Math.abs(enriched[0].acoustics.porosity - 0.6) < 0.001)
  assert.equal(enriched[0].acoustics.thickness, null)
})

test('normalises class ids and labels invalid values as default', () => {
  assert.equal(normalizeBottomTypeId(4), 4)
  assert.equal(normalizeBottomTypeId('3'), 3)
  assert.equal(normalizeBottomTypeId(0), 0)
  assert.equal(normalizeBottomTypeId(-1), 0)
  assert.equal(normalizeBottomTypeId(null), 0)
  assert.equal(normalizeBottomTypeId(Number.NaN), 0)
  assert.equal(bottomTypeLabel(2), '类型2')
  assert.equal(bottomTypeLabel(3), '类型3')
  assert.equal(bottomTypeLabel(0), '默认')
  assert.notEqual(bottomTypeColor(2), bottomTypeColor(3))
})

test('normalises optional geoacoustic properties without inventing missing values', () => {
  assert.deepEqual(bottomTypeAcousticProperties({ Cp: 1680, Alpha_p: 0.45, density: 1.72 }), {
    cp: 1680,
    alphaP: 0.45,
    density: 1.72,
    porosity: null,
    thickness: null,
  })
  assert.deepEqual(bottomTypeAcousticProperties({}), {
    cp: null,
    alphaP: null,
    density: null,
    porosity: null,
    thickness: null,
  })
})

test('builds an evenly sampled route from source to the requested range', () => {
  const points = buildRoutePoints(115, 16, 90, 2000, 3)
  assert.equal(points.length, 3)
  assert.ok(Math.abs(points[0].x - 115) < 1e-6)
  assert.ok(Math.abs(points[0].y - 16) < 1e-6)
  assert.ok(points[1].x > points[0].x)
  assert.ok(points[2].x > points[1].x)
})

test('parses the live route response, merges adjacent types and fills gaps', () => {
  const routePoints = buildRoutePoints(115, 16, 90, 3000, 4)
  const response = fullPortalResponse({
    SamplingPoints: { size: 4, x: routePoints.map((p) => p.x), y: routePoints.map((p) => p.y) },
    ProfileData: {
      size: 4,
      data: [
        { size: 1, x: [0], y: [2] },
        { size: 1, x: [0], y: [2] },
        { size: 1, x: [0], y: [3] },
        { size: 1, x: [0], y: [3] },
      ],
    },
  })

  const segments = buildBottomTypeSegments(response, {
    fallbackDistanceM: 3000,
    routePoints,
  })
  assert.equal(segments.length, 2)
  assert.deepEqual(
    segments.map((s) => [s.id, s.label, Math.round(s.startM), Math.round(s.endM)]),
    [
      [2, '类型2', 0, 1500],
      [3, '类型3', 1500, 3000],
    ]
  )
})

test('labels missing or invalid class ids as one default segment', () => {
  const routePoints = buildRoutePoints(115, 16, 90, 5000, 3)
  const response = fullPortalResponse({
    SamplingPoints: { size: 3, x: routePoints.map((p) => p.x), y: routePoints.map((p) => p.y) },
    ProfileData: {
      size: 3,
      data: [
        { size: 1, x: [0], y: [0] },
        { size: 1, x: [0], y: [null] },
        { size: 1, x: [0], y: [-1] },
      ],
    },
  })

  const segments = buildBottomTypeSegments(response, {
    fallbackDistanceM: 5000,
    routePoints,
  })
  assert.equal(segments.length, 1)
  assert.equal(segments[0].id, 0)
  assert.equal(segments[0].label, '默认')
  assert.equal(segments[0].startM, 0)
  assert.equal(segments[0].endM, 5000)
})

test('falls back to default when the response has no class ids', () => {
  const segments = buildBottomTypeSegments(
    fullPortalResponse({ SamplingPoints: { size: 0, x: [], y: [] } }),
    { fallbackDistanceM: 1200 }
  )
  assert.deepEqual(segments, [{ startM: 0, endM: 1200, id: 0, label: '默认' }])
})

test('supports class id arrays directly under SamplingPoints', () => {
  const response = {
    Response: {
      SamplingPoints: {
        size: 3,
        x: [115, 115.1, 115.2],
        y: [16, 16, 16],
        lithology_class_id: [2, 2, 4],
      },
    },
  }
  const segments = buildBottomTypeSegments(response, {
    fallbackDistanceM: 2000,
    routePoints: [
      { x: 115, y: 16 },
      { x: 115.1, y: 16 },
      { x: 115.2, y: 16 },
    ],
  })
  assert.equal(segments.length, 2)
  assert.equal(segments[0].label, '类型2')
  assert.equal(segments[1].label, '类型4')
})
