/**
 * rayFlowClock.js — 二维动态声场与三维动态声线切面共用的传播时钟。
 * ==========================================
 *
 * 两个画布（二维剖面窗的 `RayFlowOverlay` 与三维传播损失体上的剖面帘声线）
 * 都按同一 epoch + `performance.now()` 计算已流逝时间，从而保证同一 wall-clock
 * 时刻两者的声线相位完全一致，做到「时间与二维动态声场同步」。
 *
 * 该时钟自由运行、不随数据 / 方位切换而重置：切换时新旧声线都在同一连续相位上
 * 继续推进，避免两个动画因起始时刻不同而逐渐漂移。
 * 播放速度通过改变时钟推进倍率实现，暂停 / 重置只影响相位，不改变数据。
 */
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
let baseElapsedMs = 0
let speed = 1
let lastMarkMs = nowMs()

/** 返回自时钟起点以来按当前倍率累计的毫秒数（单调递增）。 */
export function rayFlowClockElapsedMs() {
  return baseElapsedMs + (nowMs() - lastMarkMs) * speed
}

/** 设置播放速度倍率（0.25× ~ 8.00×），切换点之前的相位保持不变。 */
export function setRayFlowSpeed(value) {
  const next = Number(value)
  const target = Number.isFinite(next) ? Math.min(8, Math.max(0.25, next)) : 1
  const now = nowMs()
  baseElapsedMs += (now - lastMarkMs) * speed
  lastMarkMs = now
  speed = target
}

/** 返回在给定循环时长内的时间位置（毫秒）。 */
export function rayFlowTimelinePositionMs(timelineMs = 8000) {
  const duration = Math.max(1, Number(timelineMs) || 8000)
  return ((rayFlowClockElapsedMs() % duration) + duration) % duration
}

/** 跳转到指定播放时间位置（毫秒），保持当前速度继续行进。 */
export function seekRayFlowClock(positionMs) {
  const target = Number(positionMs)
  baseElapsedMs = Number.isFinite(target) ? Math.max(0, target) : 0
  lastMarkMs = nowMs()
}