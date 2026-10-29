import test from 'node:test'
import assert from 'node:assert/strict'
import { stationSurfaceValue, windFromComponents, rainMeasurement } from '../src/utils/stationWeather.js'
import { pickTerrainPoint } from '../src/utils/terrainPicking.js'

test('站点缺测不转换为零，仅读取表层', () => {
  const wrap = y => ({ Data: { Units: [{ Response: { data: [{ x: 0, y }] } }] } })
  for (const y of [null, '', 9999, -9999, Infinity]) assert.equal(stationSurfaceValue(wrap(y)), null)
  assert.equal(stationSurfaceValue(wrap(0)), 0)
  assert.equal(stationSurfaceValue(wrap(-.790878)), -.790878)
})
test('合成风速和气象来向', () => {
  assert.equal(windFromComponents(3, 4).speed, 5)
  assert.equal(windFromComponents(0, 10).label, '南风')
  assert.equal(windFromComponents(-10, 0).label, '东风')
  assert.equal(windFromComponents(0, 0).label, '静风')
  assert.equal(windFromComponents(null, 1), null)
})
test('区分降雨累积量、雨强和错误单位', () => {
  assert.deepEqual(rainMeasurement(.002, 'm'), { value: 2, unit: '毫米' })
  assert.deepEqual(rainMeasurement(0, 'mm/h'), { value: 0, unit: '毫米/小时' })
  assert.equal(rainMeasurement(1, 'm/s'), null)
  assert.equal(rainMeasurement(-1, 'mm'), null)
})
test('地形内部插值拾取，边界外不吸附；优先可见表面', () => {
  const face = elevation => ({ p: [[0,0],[10,0],[10,10],[0,10]].map(([x,y]) => ({x,y,lon:x,lat:y,elevation})) })
  const scene = { faces: [face(-100),face(-50)] }
  assert.deepEqual(pickTerrainPoint(scene, 3, 4), {x:3,y:4,lon:3,lat:4,elevation:-50})
  assert.equal(pickTerrainPoint(scene, -1, 4), null)
  assert.equal(pickTerrainPoint(null, 1, 1), null)
})
