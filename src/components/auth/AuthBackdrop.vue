<template>
  <div class="auth-backdrop" aria-hidden="true">
    <div class="bg-base"></div>

    <div class="sun-glow"></div>

    <div class="water-surface"></div>

    <div class="light-shafts">
      <span class="shaft shaft-1"></span>
      <span class="shaft shaft-2"></span>
      <span class="shaft shaft-3"></span>
      <span class="shaft shaft-4"></span>
      <span class="shaft shaft-5"></span>
    </div>

    <div class="bubbles">
      <span
        v-for="bubble in bubbles"
        :key="bubble.id"
        class="bubble"
        :style="bubble.style"
      ></span>
    </div>

    <svg class="digital-waves" viewBox="0 0 1440 560" preserveAspectRatio="none">
      <defs>
        <linearGradient id="wave-back" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#0a6f92" stop-opacity="0" />
          <stop offset="0.3" stop-color="#2bb9df" stop-opacity="0.5" />
          <stop offset="0.7" stop-color="#3fd6f4" stop-opacity="0.5" />
          <stop offset="1" stop-color="#0a6f92" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="wave-mid" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#19a9cf" stop-opacity="0" />
          <stop offset="0.25" stop-color="#54e6ff" stop-opacity="0.85" />
          <stop offset="0.75" stop-color="#67efff" stop-opacity="0.85" />
          <stop offset="1" stop-color="#19a9cf" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="wave-front" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#35d7ff" stop-opacity="0" />
          <stop offset="0.2" stop-color="#b6fbff" stop-opacity="0.95" />
          <stop offset="0.8" stop-color="#8ff3ff" stop-opacity="0.95" />
          <stop offset="1" stop-color="#35d7ff" stop-opacity="0" />
        </linearGradient>
        <filter id="wave-glow" x="-10%" y="-40%" width="120%" height="180%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g
        v-for="layer in waveLayers"
        :key="layer.id"
        class="wave-layer"
        :class="`layer-${layer.id}`"
        :filter="layer.glow ? 'url(#wave-glow)' : undefined"
      >
        <path
          v-for="(path, index) in layer.verticals"
          :key="`v-${index}`"
          :d="path"
          fill="none"
          :stroke="`url(#wave-${layer.id})`"
          stroke-width="0.95"
          stroke-linecap="round"
          stroke-dasharray="1 6"
          :stroke-opacity="layer.gridOpacity"
        />
        <path
          v-for="(path, index) in layer.paths"
          :key="index"
          :d="path"
          fill="none"
          :stroke="`url(#wave-${layer.id})`"
          :stroke-width="layer.strokeWidth"
          stroke-linecap="round"
          :stroke-dasharray="layer.dash"
          :stroke-opacity="layer.opacity"
        />
      </g>
    </svg>

    <div class="vignette"></div>
  </div>
</template>

<script setup>
function meshWaveY(layer, x, row) {
  const amplitude = layer.amplitude * (1 - row * 0.04)
  const wavelength = layer.wavelength - row * 26
  const phase = layer.phase + row * 0.35
  return (
    layer.baseY +
    row * layer.rowGap +
    Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude +
    Math.cos(((x - 800) / 1600) * Math.PI * 2) * layer.surge
  )
}

function buildMeshRow(layer, row, step = 16) {
  const points = []
  for (let x = -100; x <= 1720; x += step) {
    const y = meshWaveY(layer, x, row)
    points.push(`${points.length ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return points.join(' ')
}

function buildMeshColumn(layer, x) {
  const points = []
  for (let row = 0; row < layer.rows; row += 1) {
    const y = meshWaveY(layer, x, row)
    points.push(`${points.length ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`)
  }
  return points.join(' ')
}

const bubbles = Array.from({ length: 16 }, (_, index) => {
  const size = 2 + ((index * 7) % 5)
  return {
    id: index,
    style: {
      left: `${6 + ((index * 37) % 88)}%`,
      width: `${size}px`,
      height: `${size}px`,
      animationDelay: `${(index * 0.9) % 12}s`,
      animationDuration: `${10 + ((index * 3) % 9)}s`,
      opacity: 0.15 + ((index % 4) * 0.08),
    },
  }
})

const layerConfigs = [
  {
    id: 'back',
    baseY: 150,
    amplitude: 18,
    wavelength: 540,
    phase: 0.4,
    surge: 30,
    rows: 6,
    rowGap: 16,
    verticalStep: 74,
    strokeWidth: 1.2,
    dash: '1.4 10',
    opacity: 0.5,
    gridOpacity: 0.24,
    glow: false,
  },
  {
    id: 'mid',
    baseY: 200,
    amplitude: 28,
    wavelength: 760,
    phase: 1.6,
    surge: 46,
    rows: 7,
    rowGap: 17,
    verticalStep: 66,
    strokeWidth: 1.5,
    dash: '1.6 8',
    opacity: 0.72,
    gridOpacity: 0.4,
    glow: true,
  },
  {
    id: 'front',
    baseY: 250,
    amplitude: 34,
    wavelength: 980,
    phase: 2.7,
    surge: 64,
    rows: 8,
    rowGap: 18,
    verticalStep: 58,
    strokeWidth: 1.8,
    dash: '1.8 7',
    opacity: 0.96,
    gridOpacity: 0.52,
    glow: true,
  },
]

const waveLayers = layerConfigs.map((layer) => ({
  ...layer,
  paths: Array.from({ length: layer.rows }, (_, row) => buildMeshRow(layer, row)),
  verticals: Array.from(
    { length: Math.ceil(1820 / layer.verticalStep) + 1 },
    (_, index) => buildMeshColumn(layer, -100 + index * layer.verticalStep)
  ),
}))
</script>

<style scoped>
.auth-backdrop {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.bg-base {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 100% 52% at 50% -8%, rgba(96, 238, 255, 0.42), transparent 62%),
    radial-gradient(ellipse 70% 50% at 12% 24%, rgba(12, 92, 133, 0.4), transparent 66%),
    radial-gradient(ellipse 76% 60% at 88% 40%, rgba(9, 70, 110, 0.38), transparent 70%),
    linear-gradient(180deg, #031826 0%, #052c44 30%, #03243a 56%, #010b15 100%);
}

.sun-glow {
  position: absolute;
  top: -20%;
  left: 50%;
  width: 58%;
  height: 48%;
  transform: translateX(-50%);
  background: radial-gradient(ellipse at 50% 50%, rgba(210, 255, 255, 0.55), rgba(90, 230, 255, 0.25) 30%, transparent 68%);
  filter: blur(18px);
  mix-blend-mode: screen;
  animation: sun-breathe 8s ease-in-out infinite;
}

.water-surface {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 36vh;
  min-height: 230px;
  background-image: url('/auth/underwater-caustics.png');
  background-repeat: no-repeat;
  background-position: top center;
  background-size: 100% 100%;
  mix-blend-mode: screen;
  opacity: 0.82;
  filter: saturate(1.12) blur(0.3px);
  -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 52%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0%, #000 52%, transparent 100%);
  animation: surface-drift 20s ease-in-out infinite;
  will-change: transform;
}

.light-shafts {
  position: absolute;
  top: -6%;
  left: 50%;
  width: 86%;
  height: 88%;
  transform: translateX(-50%);
  filter: blur(28px);
  mix-blend-mode: screen;
  opacity: 0.5;
}

.shaft {
  position: absolute;
  top: 0;
  height: 100%;
  transform-origin: top center;
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
  background: linear-gradient(180deg, rgba(200, 252, 255, 0.38) 0%, rgba(112, 230, 255, 0.14) 34%, rgba(40, 170, 210, 0.03) 68%, transparent 90%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 34%, #000 66%, transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0%, #000 34%, #000 66%, transparent 100%);
  animation: shaft-sway 9s ease-in-out infinite;
}

.shaft-1 { --shaft-rotate: 5deg; left: 26%; width: 7%; opacity: 0.4; }
.shaft-2 { --shaft-rotate: -2deg; left: 41%; width: 9%; opacity: 0.58; animation-delay: -2.2s; }
.shaft-3 { --shaft-rotate: 6deg; left: 52%; width: 10%; opacity: 0.7; animation-delay: -4.4s; }
.shaft-4 { --shaft-rotate: -6deg; left: 64%; width: 6%; opacity: 0.38; animation-delay: -1.3s; }
.shaft-5 { --shaft-rotate: 10deg; left: 35%; width: 4%; opacity: 0.32; animation-delay: -6.1s; }

.bubbles {
  position: absolute;
  inset: 0;
}

.bubble {
  position: absolute;
  bottom: 12%;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e2ffff, #43d6f7 60%, rgba(20, 130, 175, 0.15) 100%);
  box-shadow: 0 0 8px rgba(90, 226, 255, 0.45);
  animation-name: bubble-rise;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.digital-waves {
  position: absolute;
  right: -8%;
  bottom: -10%;
  left: -8%;
  width: 116%;
  height: 72%;
  overflow: visible;
  filter: drop-shadow(0 0 16px rgba(70, 220, 255, 0.22));
}

.wave-layer {
  transform-box: fill-box;
  transform-origin: center;
}

.layer-back { animation: wave-drift 26s ease-in-out infinite; opacity: 0.85; }
.layer-mid { animation: wave-drift 20s ease-in-out infinite reverse; }
.layer-front { animation: wave-drift 15s ease-in-out infinite; }

.vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 70% at 50% 46%, transparent 42%, rgba(1, 8, 16, 0.52) 100%),
    linear-gradient(180deg, rgba(1, 9, 17, 0.2), transparent 26%, transparent 72%, rgba(1, 8, 16, 0.66));
}

@keyframes sun-breathe {
  0%, 100% { opacity: 0.7; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.05); }
}

@keyframes shaft-sway {
  0%, 100% { opacity: 0.2; transform: translateX(-6px) scaleX(0.96) rotate(var(--shaft-rotate, 0deg)); }
  50% { opacity: 0.5; transform: translateX(8px) scaleX(1.08) rotate(var(--shaft-rotate, 0deg)); }
}

@keyframes surface-drift {
  0%, 100% { transform: translate3d(-1%, 0, 0) scale(1.03); }
  50% { transform: translate3d(1%, 1.2%, 0) scale(1.05); }
}

@keyframes bubble-rise {
  0% { transform: translate3d(0, 0, 0); opacity: 0; }
  12% { opacity: 1; }
  100% { transform: translate3d(18px, -72vh, 0); opacity: 0; }
}

@keyframes wave-drift {
  0%, 100% { transform: translateX(-18px); }
  50% { transform: translateX(18px); }
}

@media (prefers-reduced-motion: reduce) {
  .sun-glow,
  .shaft,
  .water-surface,
  .bubble,
  .wave-layer {
    animation: none;
  }
}
</style>
