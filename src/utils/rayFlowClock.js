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
 */
let epoch = typeof performance !== 'undefined' ? performance.now() : 0

/** 返回自时钟起点以来的毫秒数（单调递增）。 */
export function rayFlowClockElapsedMs() {
  return performance.now() - epoch
}