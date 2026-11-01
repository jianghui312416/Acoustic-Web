<template><canvas ref="canvas" class="ray-flow-overlay" aria-hidden="true"></canvas></template>

<script setup>
import { ref, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { sampleRayMotion } from '@/utils/rayFlow.js'
import { rayFlowClockElapsedMs } from '@/utils/rayFlowClock.js'
import { clipRayPathsByProfile } from '@/sdk/ncFieldModel.js'

const props = defineProps({
  flow: { type: Object, default: null },
  geometry: { type: Object, default: null },
  viewport: { type: Function, required: true },
  playing: { type: Boolean, default: true },
  visible: { type: Boolean, default: true },
  /** 静态模式：只绘制完整声线路径，不播放行进动画 */
  staticMode: { type: Boolean, default: false },
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
  const layers = [
    { width: 2, alpha: 0.12, frac: 1.0 },
    { width: 1, alpha: 0.42, frac: 0.55 },
    { width: 1.65, alpha: 0.96, frac: 0.23 },
  ]
  const drawClipped = (rawPath, painter) => {
    const clipped = props.geometry ? clipRayPathsByProfile([rawPath], props.geometry) : [rawPath]
    for (const segment of clipped) {
      if (!Array.isArray(segment) || segment.length < 2) continue
      const pts = segment.map(p => viewport.project(p)).filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      if (pts.length < 2) continue
      painter(pts)
    }
  }
  const stroke = (pts) => {
    ctx.beginPath()
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))
    ctx.stroke()
  }
  if (props.staticMode) {
    for (const track of props.flow.tracks ?? []) {
      drawClipped(track.points, pts => {
        ctx.strokeStyle = 'rgba(235,248,255,0.72)'
        ctx.lineWidth = 1.3
        stroke(pts)
      })
    }
    ctx.restore()
    return
  }
  for (const motion of sampleRayMotion(props.flow, elapsed)) {
    const path = motion.path || []
    const tail = motion.tail || []
    const head = motion.head
    // 1) 淡显完整已走路径（保留已走过的声线）。
    drawClipped(path, pts => {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1.2
      stroke(pts)
    })
    // 2) 头部多层拖尾（无发光，仅分层，与「拖尾发光 0%」一致）。
    const tailPoints = tail.map(n => n.point)
    for (const layer of layers) {
      const startIdx = Math.max(0, tailPoints.length - 1 - Math.round((tailPoints.length - 1) * layer.frac))
      const sub = tailPoints.slice(startIdx)
      if (sub.length < 2) continue
      drawClipped(sub, pts => {
        const tailP = pts[0]
        const headP = pts[pts.length - 1]
        const gradient = ctx.createLinearGradient(tailP[0], tailP[1], headP[0], headP[1])
        gradient.addColorStop(0, 'rgba(255,255,255,0)')
        gradient.addColorStop(1, `rgba(255,255,255,${layer.alpha.toFixed(3)})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = layer.width
        stroke(pts)
      })
    }
    // 3) 传播前沿头点。
    if (head) {
      const headPoint = viewport.project(head)
      if (headPoint && Number.isFinite(headPoint[0]) && Number.isFinite(headPoint[1])) {
        const radius = 3
        const radial = ctx.createRadialGradient(headPoint[0], headPoint[1], 0, headPoint[0], headPoint[1], radius * 5)
        radial.addColorStop(0, 'rgba(255,255,255,0.9)')
        radial.addColorStop(0.28, 'rgba(200,240,255,0.5)')
        radial.addColorStop(1, 'rgba(200,240,255,0)')
        ctx.fillStyle = radial
        ctx.beginPath()
        ctx.arc(headPoint[0], headPoint[1], radius * 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.96)'
        ctx.beginPath()
        ctx.arc(headPoint[0], headPoint[1], Math.max(1.3, radius * 0.4), 0, Math.PI * 2)
        ctx.fill()
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
  if (!props.flow || !props.visible || !props.playing || props.staticMode || document.hidden) return
  const tick = () => {
    paint()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}
watch(() => props.flow, start, { flush: 'post' })
watch(() => [props.playing, props.visible, props.geometry, props.staticMode], start, { flush: 'post' })
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
