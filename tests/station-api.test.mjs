import test from 'node:test'
import assert from 'node:assert/strict'
import { getEnvDataStation } from '../src/api/soundFieldApi.js'
import { WEATHER_TYPES } from '../src/utils/stationWeather.js'

test('站点风雨查询使用注册的 SN、Plugin、数据类型和所选坐标', async () => {
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ Data: { Units: [{ ResultCode: 0, Response: { size: 1, data: [{ x: 0, y: 0 }] } }] } }) }
  }
  try {
    for (const dataType of WEATHER_TYPES) await getEnvDataStation({ coordX: -60, coordY: 70.8, dataType, time: '2025-01-02 12:00:00' })
  } finally { globalThis.fetch = original }
  assert.equal(requests.length, 3)
  requests.forEach((request, index) => {
    assert.equal(request.Data.SN, 22)
    assert.equal(request.Data.Units[0].Plugin, 'GetEnvDataStation')
    assert.equal(request.Data.Units[0].Request.dataType, WEATHER_TYPES[index])
    assert.equal(request.Data.Units[0].Request.coordX, -60)
    assert.equal(request.Data.Units[0].Request.coordY, 70.8)
  })
})
