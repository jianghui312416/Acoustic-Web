import test from 'node:test'
import assert from 'node:assert/strict'

const {
  portalPluginForModel,
  analyse2dTLRDByModel,
  analyse3dTLRDByModel,
  analyse2dRTRD,
  analyseIce2dRTRD,
  analyse2dDynamicRTRD,
  analyseIce2dDynamicRTRD,
  analyse3dDynamicRTRD,
  analyseIce3dDynamicRTRD,
  analyseEnvironmentNoise,
  getDatasetList,
  getDatasetTimeList,
} = await import('../src/api/soundFieldApi.js')

test('routes every model, dimension and region to the api_endpoints registry contract', () => {
  const expected = {
    bellhop: {
      normal: { '2d': [16, 'Analyse2DTLRD'], '3d': [16, 'Analyse3DTLRD'] },
      ice: { '2d': [16, 'AnalyseIce2DTLRD'], '3d': [16, 'AnalyseIce3DTLRD'] },
    },
    kraken: {
      normal: { '2d': [14, 'AnalyseKraken2DTLRD'], '3d': [15, 'AnalyseKraken3DTLRD'] },
      ice: { '2d': [16, 'AnalyseIceKraken2DTLRD'], '3d': [17, 'AnalyseIceKraken3DTLRD'] },
    },
    ram: {
      normal: { '2d': [16, 'Analyse2DTLRDPE'], '3d': [19, 'AnalyseRam3DTLRD'] },
      ice: { '2d': [16, 'AnalyseIce2DTLRDPE'], '3d': [21, 'AnalyseIceRam3DTLRD'] },
    },
  }

  for (const [model, regions] of Object.entries(expected)) {
    for (const [region, dimensions] of Object.entries(regions)) {
      for (const [dimension, [sn, plugin]] of Object.entries(dimensions)) {
        assert.deepEqual(portalPluginForModel(model, dimension, region === 'ice'), { sn, plugin })
      }
    }
  }
})

test('rejects unknown acoustic models and dimensions', () => {
  assert.throws(() => portalPluginForModel('unknown', '2d'), /不支持的声学模型/)
  assert.throws(() => portalPluginForModel('ram', '4d'), /不支持的声场维度/)
})

test('sends selected model SN and Plugin in the portal request', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    return {
      ok: true,
      async json() {
        return {
          Data: {
            Units: [{
              Plugin: request.Data.Units[0].Plugin,
              Response: { loadingTlv: {} },
              ResultCode: 0,
            }],
          },
        }
      },
    }
  }

  try {
    await analyse2dTLRDByModel({ lineCount: 12 }, 'ram', false)
    await analyse3dTLRDByModel({ sector: 8, lineCount: 12 }, 'kraken', true)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requests[0].Data.SN, 16)
  assert.equal(requests[0].Data.Units[0].Plugin, 'Analyse2DTLRDPE')
  assert.equal(requests[0].Data.Units[0].Request.lineCount, undefined, '二维 TL 请求不能携带 lineCount')
  assert.equal(requests[1].Data.SN, 17)
  assert.equal(requests[1].Data.Units[0].Plugin, 'AnalyseIceKraken3DTLRD')
  assert.equal(requests[1].Data.Units[0].Request.lineCount, undefined)
  assert.equal(requests[1].Data.Units[0].Request.grazingAngle, undefined)
  assert.equal(requests[1].Data.Units[0].Request.beamWidth, undefined)
})

test('routes RAM terrain runs to its non-ice and ice 3D field plugins', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    return {
      ok: true,
      async json() {
        return {
          Data: {
            Units: [{
              Plugin: request.Data.Units[0].Plugin,
              Response: { loadingTlv: {} },
              ResultCode: 0,
            }],
          },
        }
      },
    }
  }

  try {
    const params = { range: 10, sector: 8, lineCount: 12, azimuth: 45 }
    await analyse3dTLRDByModel(params, 'ram', false)
    await analyse3dTLRDByModel(params, 'ram', true)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map(({ Data }) => [Data.SN, Data.Units[0].Plugin]),
    [
      [19, 'AnalyseRam3DTLRD'],
      [21, 'AnalyseIceRam3DTLRD'],
    ]
  )
  for (const request of requests) {
    assert.equal(request.Data.Units[0].Request.lineCount, undefined)
    assert.equal(request.Data.Units[0].Request.azimuth, undefined)
  }
})

test('uses the current registry SNs for ray and dataset requests', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    return {
      ok: true,
      async json() {
        return {
          Data: {
            Units: [{
              Plugin: request.Data.Units[0].Plugin,
              Response: {},
              ResultCode: 0,
            }],
          },
        }
      },
    }
  }

  try {
    await analyse2dRTRD({ azimuth: 30, lineCount: 0 })
    await analyseIce2dRTRD({ azimuth: 30 })
    await analyse2dDynamicRTRD({ azimuth: 30, lineCount: 0 })
    await analyseIce2dDynamicRTRD({ azimuth: 30 })
    await analyse3dDynamicRTRD({ sector: 4, lineCount: 10 })
    await analyseIce3dDynamicRTRD({ sector: 4, lineCount: 10 })
    await getDatasetList()
    await getDatasetTimeList('EnvReanalysis')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map(({ Data }) => [Data.SN, Data.Units[0].Plugin]),
    [
      [19, 'Analyse2DRTRD'],
      [19, 'AnalyseIce2DRTRD'],
      [19, 'Analyse2DRTRDDynamic'],
      [19, 'AnalyseIce2DRTRDDynamic'],
      [19, 'Analyse3DRTRDDynamic'],
      [19, 'AnalyseIce3DRTRDDynamic'],
      [1, 'GetEnvDataSourceList'],
      [2, 'FetchTimeToList'],
    ]
  )
  assert.equal(requests[0].Data.Units[0].Request.lineCount, 0)
  assert.deepEqual(
    requests[2].Data.Units[0].Request,
    requests[0].Data.Units[0].Request,
    '动态声线请求体必须与静态二维声线接口一致'
  )
})

test('routes non-ice and ice environment noise to their registered plugins', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    return {
      ok: true,
      async json() {
        return {
          Data: {
            Units: [{
              Plugin: request.Data.Units[0].Plugin,
              Response: {},
              ResultCode: 0,
            }],
          },
        }
      },
    }
  }

  const levels = {
    shipDensityLevel: 3,
    windSpeed: 4,
    rainIntensity: 2,
    minFreq: 10,
    maxFreq: 1000,
    numPoints: 100,
  }

  try {
    await analyseEnvironmentNoise(levels, false)
    await analyseEnvironmentNoise(
      { coordX: 0, coordY: 80, srcDepth: 50, dataSource: 'EnvReanalysis', time: '2025-01-02 12:00:00', ...levels },
      true
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map(({ Data }) => [Data.SN, Data.Units[0].Plugin]),
    [
      [16, 'AnalyseEnvironmentNoise'],
      [16, 'AnalyseIceEnvironmentNoise'],
    ]
  )
  assert.equal(requests[0].Data.Units[0].Request.coordX, undefined)
  assert.equal(requests[1].Data.Units[0].Request.coordX, 0)
  assert.equal(requests[1].Data.Units[0].Request.srcDepth, 50)
})
