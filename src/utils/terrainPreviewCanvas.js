/**
 * 将地形格网绘制成带透视效果的地形分布面。
 *
 * 这里刻意使用 Canvas 2D 的逐格四边形，而不是 WebGL：地形预览只需要在点击
 * “加载地形”时重绘一次，2D 方案更容易控制配色、标注和离线降级。
 */

const COLOR_STOPS = Object.freeze([
  [0.0, [5, 24, 60]],
  [0.08, [8, 45, 91]],
  [0.18, [10, 73, 126]],
  [0.3, [17, 112, 160]],
  [0.42, [35, 155, 181]],
  [0.5, [78, 190, 184]],
  [0.56, [103, 181, 122]],
  [0.64, [128, 174, 88]],
  [0.72, [177, 162, 83]],
  [0.82, [165, 116, 69]],
  [0.91, [206, 185, 160]],
  [1.0, [246, 247, 247]],
])

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function mixColor(from, to, t) {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ]
}

export function terrainColorAt(t) {
  const value = clamp(Number(t) || 0, 0, 1)
  for (let index = 0; index < COLOR_STOPS.length - 1; index += 1) {
    const [startAt, startColor] = COLOR_STOPS[index]
    const [endAt, endColor] = COLOR_STOPS[index + 1]
    if (value <= endAt) {
      const local = (value - startAt) / Math.max(1e-6, endAt - startAt)
      return mixColor(startColor, endColor, local)
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1]
}

function toCss(color, alpha = 1) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`
}

export function terrainGradientCss() {
  return `linear-gradient(90deg, ${COLOR_STOPS.map(
    ([stop, color]) => `${toCss(color)} ${(stop * 100).toFixed(1)}%`
  ).join(', ')})`
}

function resolveSize(canvas) {
  const rect = canvas.getBoundingClientRect?.()
  const host = canvas.parentElement?.getBoundingClientRect?.()
  const width = Math.max(1, Math.round(rect?.width || host?.width || canvas.clientWidth || 960))
  const height = Math.max(1, Math.round(rect?.height || host?.height || canvas.clientHeight || 620))
  return { width, height }
}

function drawBackdrop(ctx, width, height) {
  ctx.clearRect(0, 0, width, height)

  const glow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.52,
    height * 0.05,
    width * 0.5,
    height * 0.52,
    Math.max(width, height) * 0.62
  )
  glow.addColorStop(0, 'rgba(26, 103, 160, 0.34)')
  glow.addColorStop(0.45, 'rgba(10, 52, 91, 0.18)')
  glow.addColorStop(1, 'rgba(2, 10, 22, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.strokeStyle = 'rgba(80, 170, 215, 0.07)'
  ctx.lineWidth = 1
  const step = Math.max(42, Math.round(width / 24))
  for (let x = step; x < width; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawTerrainDistribution(canvas, grid, options = {}) {
  if (!canvas || !grid?.values?.length) return false

  const { width, height } = resolveSize(canvas)
  const dpr = clamp(Number(globalThis.devicePixelRatio) || 1, 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)

  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  drawBackdrop(ctx, width, height)

  const cols = grid.width
  const rows = grid.height
  const values = grid.values
  const min = Number.isFinite(grid.min) ? grid.min : 0
  const max = Number.isFinite(grid.max) ? grid.max : 0
  const range = Math.max(1e-6, max - min)
  const mid = (min + max) / 2

  const stageWidth = Math.min(width * 0.7, height * 1.32)
  const stageHeight = Math.min(height * 0.46, width * 0.36)
  const centerX = width * 0.5
  const topY = height * 0.5 - stageHeight * 0.46
  const relief = Math.min(stageHeight * 0.64, height * 0.2)

  const points = new Float32Array(cols * rows * 2)
  for (let row = 0; row < rows; row += 1) {
    const v = row / (rows - 1)
    const depth = v
    const scale = 0.58 + 0.42 * depth
    for (let col = 0; col < cols; col += 1) {
      const u = col / (cols - 1)
      const raw = Number(values[row * cols + col]) || 0
      const normalized = (raw - mid) / range
      const x = centerX + (u - 0.5) * stageWidth * scale
      const y =
        topY +
        v * stageHeight -
        normalized * relief * (0.32 + 0.68 * depth)
      const index = (row * cols + col) * 2
      points[index] = x
      points[index + 1] = y
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const topLeft = (row * cols + col) * 2
      const topRight = (row * cols + col + 1) * 2
      const bottomLeft = ((row + 1) * cols + col) * 2
      const bottomRight = ((row + 1) * cols + col + 1) * 2

      const value =
        (values[row * cols + col] +
          values[row * cols + col + 1] +
          values[(row + 1) * cols + col] +
          values[(row + 1) * cols + col + 1]) /
        4
      const slopeX =
        (values[row * cols + col + 1] - values[row * cols + col]) / range
      const slopeY =
        (values[(row + 1) * cols + col] - values[row * cols + col]) / range
      const shade = clamp(0.74 + (slopeX * 0.75 - slopeY * 1.15), 0.42, 1.18)
      const t = (value - min) / range
      const base = terrainColorAt(t)
      const color = base.map((channel) => clamp(Math.round(channel * shade), 0, 255))

      ctx.beginPath()
      ctx.moveTo(points[topLeft], points[topLeft + 1])
      ctx.lineTo(points[topRight], points[topRight + 1])
      ctx.lineTo(points[bottomRight], points[bottomRight + 1])
      ctx.lineTo(points[bottomLeft], points[bottomLeft + 1])
      ctx.closePath()
      ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
      ctx.fill()
    }
  }

  const gridStep = Math.max(1, Math.floor(cols / 14))
  ctx.save()
  ctx.strokeStyle = 'rgba(148, 225, 255, 0.13)'
  ctx.lineWidth = 1
  for (let row = 0; row < rows; row += gridStep) {
    ctx.beginPath()
    for (let col = 0; col < cols; col += 1) {
      const index = (row * cols + col) * 2
      if (col === 0) ctx.moveTo(points[index], points[index + 1])
      else ctx.lineTo(points[index], points[index + 1])
    }
    ctx.stroke()
  }
  for (let col = 0; col < cols; col += gridStep) {
    ctx.beginPath()
    for (let row = 0; row < rows; row += 1) {
      const index = (row * cols + col) * 2
      if (row === 0) ctx.moveTo(points[index], points[index + 1])
      else ctx.lineTo(points[index], points[index + 1])
    }
    ctx.stroke()
  }
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  for (let col = 0; col < cols; col += 1) {
    const index = col * 2
    if (col === 0) ctx.moveTo(points[index], points[index + 1])
    else ctx.lineTo(points[index], points[index + 1])
  }
  for (let row = 1; row < rows; row += 1) {
    const index = (row * cols + cols - 1) * 2
    ctx.lineTo(points[index], points[index + 1])
  }
  for (let col = cols - 2; col >= 0; col -= 1) {
    const index = ((rows - 1) * cols + col) * 2
    ctx.lineTo(points[index], points[index + 1])
  }
  for (let row = rows - 2; row >= 0; row -= 1) {
    const index = row * cols * 2
    ctx.lineTo(points[index], points[index + 1])
  }
  ctx.closePath()
  ctx.strokeStyle = 'rgba(116, 219, 255, 0.62)'
  ctx.lineWidth = 1.4
  ctx.shadowColor = 'rgba(56, 189, 248, 0.42)'
  ctx.shadowBlur = 10
  ctx.stroke()
  ctx.restore()

  const bottomLeft = ((rows - 1) * cols) * 2
  const bottomRight = ((rows - 1) * cols + cols - 1) * 2
  const labelColor = 'rgba(167, 219, 241, 0.66)'
  ctx.save()
  ctx.fillStyle = labelColor
  ctx.font = '600 11px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(options.westLabel || '西', points[bottomLeft] - 18, points[bottomLeft + 1] + 20)
  ctx.fillText(options.eastLabel || '东', points[bottomRight] + 18, points[bottomRight + 1] + 20)
  ctx.fillText(options.northLabel || '北', centerX, topY - 14)
  ctx.fillText(options.southLabel || '南', centerX, points[bottomLeft + 1] + 42)
  ctx.restore()

  return true
}
