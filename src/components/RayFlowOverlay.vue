<template><canvas ref="canvas" class="ray-flow-overlay" aria-hidden="true"></canvas></template>

<script setup>
import { ref, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { sampleRayFlow } from '@/utils/rayFlow.js'
import { rayFlowClockElapsedMs } from '@/utils/rayFlowClock.js'
import { clipRayPathsByProfile } from '@/sdk/ncFieldModel.js'

const props = defineProps({
  flow: { type: Object, default: null },
  geometry: { type: Object, default: null },
  viewport: { type: Function, required: true },
  playing: { type: Boolean, default: true },
  visible: { type: Boolean, default: true },
  /** 是否在画布右上角显示当前传播时间 t ~ x.xx s */
  showTime: { type: Boolean, default: false },
})
const canvas = ref(null)
let raf = 0
let active = true
let observer

function paint() {
  const el = canvas.value
  if (!el) return
  const width = el.clientWidth
  const height = el.clientHeight
  if (!width || !height) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
    el.width = Math.round(width * ratio)
    el.height = Math.round(height * ratio)
  }
  const ctx = el.getContext('2d')
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (!props.visible || !props.flow) return
  const viewport = props.viewport()
  if (!viewport) return
  const elapsed = rayFlowClockElapsedMs()
  ctx.save()
  ctx.beginPath()
  ctx.rect(...viewport.rect)
  ctx.clip()
  ctx.lineCap = 'round'
  for (const trail of sampleRayFlow(props.flow, elapsed)) {
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1]
      const b = trail[i]
      const segments = props.geometry ? clipRayPathsByProfile([[a.point, b.point]], props.geometry) : [[a.point, b.point]]
      for (const segment of segments) {
        const from = viewport.project(segment[0])
        const to = viewport.project(segment.at(-1))
        const gradient = ctx.createLinearGradient(...from, ...to)
        gradient.addColorStop(0, `rgba(255,150,165,${a.alpha * 0.85})`)
        gradient.addColorStop(1, `rgba(255,60,85,${b.alpha * 0.95})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.moveTo(...from)
        ctx.lineTo(...to)
        ctx.stroke()
      }
    }
  }
  ctx.restore()

  if (props.showTime) {
    const duration = Math.max(1, Number(props.flow?.durationMs) || 1)
    const seconds = (((elapsed % duration) + duration) % duration) / 1000
    const text = `t ~ ${seconds.toFixed(2)} s`
    ctx.save()
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Consolas, monospace'
    const textWidth = ctx.measureText(text).width
    const x = width - textWidth - 18
    const y = 9
    ctx.fillStyle = 'rgba(2,6,23,0.78)'
    ctx.strokeStyle = 'rgba(167,139,250,0.7)'
    ctx.lineWidth = 1
    ctx.fillRect(x - 6, y, textWidth + 12, 17)
    ctx.strokeRect(x - 5.5, y + 0.5, textWidth + 11, 16)
    ctx.fillStyle = '#ddd6fe'
    ctx.fillText(text, x, y + 12)
    ctx.restore()
  }
}

function stop() { cancelAnimationFrame(raf); raf = 0 }
function start() {
  stop()
  if (!active) return
  paint()
  if (!props.flow || !props.visible || !props.playing || document.hidden) return
  const tick = () => {
    paint()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}
watch(() => props.flow, start, { flush: 'post' })
watch(() => [props.playing, props.visible, props.geometry], start, { flush: 'post' })
onMounted(() => {
  observer = new ResizeObserver(paint)
  observer.observe(canvas.value)
  document.addEventListener('visibilitychange', start)
  start()
})
onActivated(() => { active = true; start() })
onDeactivated(() => { active = false; stop() })
onBeforeUnmount(() => { active = false; stop(); observer?.disconnect(); document.removeEventListener('visibilitychange', start) })
defineExpose({ repaint: paint })
</script>

<style scoped>
.ray-flow-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
</style>
