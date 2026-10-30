import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bandNoiseMetricsDb,
  clampFrameIndex, clampShippingActivity, coatesStojanovicShippingCurve, directionLabel,
  meanBandLevelDb, nearestFrequencyIndex, powerSumCurvesDb, shippingActivityCountCurve,
} from '../src/utils/weatherNoiseForecast.js'

test('48 小时时间滑杆索引始终限制在有效帧内', () => {
  assert.equal(clampFrameIndex(-3, 48), 0)
  assert.equal(clampFrameIndex(12.6, 48), 13)
  assert.equal(clampFrameIndex(99, 48), 47)
})

test('风向角和频率查找用于侧边栏与点选弹窗的共享显示', () => {
  assert.equal(directionLabel(0), '北风')
  assert.equal(directionLabel(90), '东风')
  assert.equal(directionLabel(225), '西南风')
  assert.equal(nearestFrequencyIndex([10, 100, 1000], 840), 2)
})

test('频段谱级用线性功率平均，不直接平均 dB', () => {
  const value = meanBandLevelDb([20, 50, 100, 1000, 2000], [1, 70, 80, 90, 1], 50, 1000)
  const integrated = (10 ** 7 + 10 ** 8) * 50 / 2 + (10 ** 8 + 10 ** 9) * 900 / 2
  const expected = 10 * Math.log10(integrated / 950)
  assert.ok(Math.abs(value - expected) < 1e-9)
})

test('频带噪声级等于平均功率谱密度加 10lg 带宽', () => {
  const metrics = bandNoiseMetricsDb([50, 100, 1000], [70, 80, 90], 50, 1000)
  const integrated = (10 ** 7 + 10 ** 8) * 50 / 2 + (10 ** 8 + 10 ** 9) * 900 / 2
  const mean = 10 * Math.log10(integrated / 950)
  assert.ok(Math.abs(metrics.meanPsdDb - mean) < 1e-9)
  assert.equal(metrics.bandwidthHz, 950)
  assert.ok(Math.abs(metrics.bandwidthCorrectionDb - 10 * Math.log10(950)) < 1e-9)
  assert.ok(Math.abs(metrics.bandLevelDb - mean - 10 * Math.log10(950)) < 1e-9)
})

test('远距离航运活动度按 Coates/Stojanovic 连续改变船舶与总噪声', () => {
  const low = coatesStojanovicShippingCurve([100], 0)[0]
  const middle = coatesStojanovicShippingCurve([100], 0.37)[0]
  const high = coatesStojanovicShippingCurve([100], 1)[0]
  assert.ok(Math.abs(high - low - 20) < 1e-9)
  assert.ok(Math.abs(middle - low - 7.4) < 1e-9)
  assert.equal(clampShippingActivity(-3), 0)
  assert.equal(clampShippingActivity(2), 1)
  assert.ok(powerSumCurvesDb([[low], [40]])[0] < powerSumCurvesDb([[high], [40]])[0])
})

test('船舶数量曲线按当前 AIS 平均权重通过观测点', () => {
  const curve = shippingActivityCountCurve({
    modeled_vessel_count: 156,
    effective_ais_activity: 0.03,
    activity_scale: 6,
  })
  assert.equal(curve.observedCount, 156)
  assert.equal(curve.maxCount, 312)
  assert.ok(Math.abs(curve.observedActivity - (1 - Math.exp(-0.03 / 6))) < 1e-12)
  assert.equal(curve.points[0].shippingActivity, 0)
  assert.ok(curve.points.at(-1).shippingActivity > curve.observedActivity)
})
