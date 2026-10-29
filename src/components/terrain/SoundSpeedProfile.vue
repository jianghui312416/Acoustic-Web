<template>
  <div class="ssp-chart">
    <svg v-if="points.length" viewBox="0 0 300 350" role="img" aria-label="声速随深度变化剖面，横轴声速米每秒，纵轴深度米">
      <text x="155" y="15" text-anchor="middle">声速 (m/s)</text>
      <template v-for="i in 5" :key="i">
        <line :x1="44 + (i - 1) * 59" :x2="44 + (i - 1) * 59" y1="38" y2="318" />
        <text :x="44 + (i - 1) * 59" y="30" text-anchor="middle">{{ Math.round(minSpeed + (i - 1) * (maxSpeed - minSpeed) / 4) }}</text>
        <line x1="44" x2="280" :y1="38 + (i - 1) * 70" :y2="38 + (i - 1) * 70" />
        <text x="36" :y="42 + (i - 1) * 70" text-anchor="end">{{ Math.round((i - 1) * maxDepth / 4) }}</text>
      </template>
      <text transform="translate(11,190) rotate(-90)" text-anchor="middle">深度 (m)</text>
      <polyline :points="polyline" fill="none" stroke="#00e2cf" stroke-width="2" />
      <text x="280" y="341" text-anchor="end">当前计算环境 · {{ points.length }} 个采样点</text>
    </svg>
    <div v-else class="ssp-empty">当前结果未包含声速剖面数据</div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ profile: Object })
const points = computed(() => (props.profile?.depth || []).map((depth, i) => ({ depth, speed: props.profile.speed[i] }))
  .filter(p => Number.isFinite(p.depth) && Number.isFinite(p.speed) && p.speed > 0).sort((a,b) => a.depth - b.depth))
const minSpeed = computed(() => Math.floor(Math.min(...points.value.map(p => p.speed)) / 10) * 10)
const maxSpeed = computed(() => Math.max(minSpeed.value + 10, Math.ceil(Math.max(...points.value.map(p => p.speed)) / 10) * 10))
const maxDepth = computed(() => Math.max(1, ...points.value.map(p => p.depth)))
const polyline = computed(() => points.value.map(p => `${44 + (p.speed-minSpeed.value)/(maxSpeed.value-minSpeed.value)*236},${38+p.depth/maxDepth.value*280}`).join(' '))
</script>
<style scoped>
.ssp-chart { background: #041321; padding: 8px; }.ssp-chart svg { width: 100%; display: block; max-height: 46vh; }.ssp-chart text { fill: #9dc9dc; font: 9px monospace; }.ssp-chart line { stroke: #1b3445; stroke-width: 1; }.ssp-empty { min-height: 180px; display: grid; place-items: center; color: #85a6bb; font-size: 12px; }
</style>
