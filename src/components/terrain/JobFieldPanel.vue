<template>
  <article class="job-field-panel" :class="{ compact: !expanded, hidden: !visible }" :style="{ '--job-accent': accent }">
    <header @click="$emit('activate')">
      <span class="job-dot"></span>
      <b>声场 {{ jobId }}</b>
      <button v-if="expanded" type="button" title="收起" aria-label="收起工作声场" @click.stop="$emit('collapse')">−</button>
      <span v-else class="compact-mark">−</span>
      <button type="button" title="关闭" aria-label="关闭工作声场" @click.stop="$emit('close')">×</button>
    </header>
    <template v-if="expanded">
      <p>{{ coordinateText }}</p>
      <strong><i></i>{{ loading ? '正在加载工作声场' : visible ? '三维声场已显示' : '三维声场已隐藏' }}</strong>
      <footer>
        <button type="button" :disabled="loading" @click="$emit('toggle-visible')">{{ visible ? '隐藏' : '显示' }}</button>
        <button type="button" :disabled="loading" @click="$emit('focus')">定位</button>
      </footer>
    </template>
  </article>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  jobId: { type: String, required: true },
  source: { type: Object, default: null },
  expanded: Boolean,
  visible: { type: Boolean, default: true },
  loading: Boolean,
  accent: { type: String, default: '#bb62ff' },
})
defineEmits(['activate', 'collapse', 'close', 'toggle-visible', 'focus'])

const coordinateText = computed(() => {
  const lon = Number(props.source?.lon)
  const lat = Number(props.source?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return '坐标未知'
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
})
</script>

<style scoped>
.job-field-panel { width: 208px; overflow: hidden; color: #cce6f1; border: 1px solid color-mix(in srgb,var(--job-accent) 62%,#18364d); border-radius: 8px; background: rgba(7,25,40,.94); box-shadow: 0 7px 20px rgba(0,8,20,.36); font: 10px 'Microsoft YaHei',sans-serif; transition: opacity .18s ease,border-color .18s ease; }
.job-field-panel.hidden { opacity: .72; }
header { min-height: 30px; display: grid; grid-template-columns: 8px minmax(0,1fr) 22px 22px; align-items: center; gap: 4px; padding: 0 6px 0 9px; cursor: pointer; }
header b { overflow: hidden; color: #d8edf5; white-space: nowrap; text-overflow: ellipsis; font-size: 10px; }
.job-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--job-accent); box-shadow: 0 0 8px var(--job-accent); }
header button { height: 22px; padding: 0; color: #698ba2; border: 0; background: transparent; cursor: pointer; font-size: 15px; }
header button:last-child { color: #e66f7f; }
.compact-mark { color: #56758c; text-align: center; }
p { margin: 0 10px 5px; color: #789cac; font: 8px monospace; }
strong { display: flex; align-items: center; gap: 5px; margin: 0 10px 8px; color: #48e3c0; font-size: 9px; }
strong i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
footer { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 0 9px 9px; }
footer button { height: 25px; color: #c5ecf5; border: 1px solid #245577; border-radius: 4px; background: #133750; cursor: pointer; font-size: 9px; }
footer button:first-child { color: #3be2bb; border-color: #147c72; background: #0c4949; }
.compact header { min-height: 31px; }
</style>
