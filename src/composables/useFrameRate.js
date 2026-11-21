import { onBeforeUnmount, ref } from 'vue'

/**
 * 采样浏览器动画帧率。重负载会拉长 requestAnimationFrame 间隔，因此该值能直接
 * 反映主线程与 Canvas/GPU 渲染压力，适合显示在底部状态栏。
 *
 * @param {number} [sampleMs=500] 采样窗口（毫秒）
 * @returns {{fps: import('vue').Ref<number>, frameMs: import('vue').Ref<number>}}
 */
export function useFrameRate(sampleMs = 500) {
  const fps = ref(0)
  const frameMs = ref(0)
  const request = globalThis.requestAnimationFrame
  const cancel = globalThis.cancelAnimationFrame
  let handle = 0
  let frames = 0
  let last = globalThis.performance?.now?.() ?? Date.now()

  const tick = (now) => {
    frames += 1
    const elapsed = now - last
    if (elapsed >= sampleMs) {
      fps.value = Math.max(0, Math.round((frames * 1000) / elapsed))
      frameMs.value = elapsed / frames
      frames = 0
      last = now
    }
    handle = request(tick)
  }

  if (typeof request === 'function') handle = request(tick)

  onBeforeUnmount(() => {
    if (handle && typeof cancel === 'function') cancel(handle)
    handle = 0
  })

  return { fps, frameMs }
}
