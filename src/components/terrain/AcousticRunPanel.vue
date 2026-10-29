<template>
  <button v-if="minimized" class="run-pill" type="button" :style="dockPosition" title="恢复声场菜单" aria-label="恢复声场菜单" @click="$emit('restore')"><i :style="indicatorStyle"></i>{{ busy ? '计算中' : '声场' }} {{ time }} <span>▾</span></button>
  <section v-else class="run-panel" :class="{ 'slice-open': sliceOpen }" :style="panelPosition" aria-label="声场悬浮菜单">
    <header><i :class="{ busy }"></i><span>{{ busy ? '计算中…' : failed ? '计算失败' : '声场' }} {{ time }}</span><div class="header-actions"><button title="最小化声场菜单" aria-label="最小化声场菜单" @click="$emit('minimize')">−</button><button title="关闭二维和三维声场" aria-label="关闭二维和三维声场" @click="$emit('close')">×</button></div></header>
    <p>{{ Number(source?.lat || 0).toFixed(4) }}°　{{ Number(source?.lon || 0).toFixed(4) }}°</p>
    <small>{{ failed ? '请查看错误信息后重试' : busy ? '正在计算传播损失' : ready ? (layerVisible ? '● 三维声场' : '○ 三维声场已隐藏') : '等待计算结果' }}</small>
    <nav aria-label="声场操作">
      <button class="run-action" :disabled="busy" :data-tip="historical ? (layerVisible ? '隐藏三维声场' : '显示三维声场') : '模拟运行'" :title="historical ? (layerVisible ? '隐藏三维声场' : '显示三维声场') : '模拟运行'" :aria-label="historical ? (layerVisible ? '隐藏三维声场' : '显示三维声场') : '模拟运行'" @click="$emit('run')"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z" fill="currentColor"/></svg></button>
      <button :disabled="!ready || rayBusy" :class="{ selected: sliceOpen, busy: rayBusy }" :data-tip="historical ? '定位声场' : (rayBusy ? '声线计算中' : '二维传播损失')" :title="historical ? '定位声场' : (rayBusy ? '正在计算三维动态声线' : '二维传播损失')" :aria-label="historical ? '定位声场' : (rayBusy ? '正在计算三维动态声线' : '二维传播损失')" :aria-pressed="sliceOpen" @click="$emit('slice')"><svg viewBox="0 0 24 24"><path d="M4 4v16h17M7 15l4-7 4 5 5-7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg></button>
      <button data-tip="参数设置" title="参数设置" aria-label="参数设置" @click="$emit('settings')"><svg viewBox="0 0 24 24"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></button>
    </nav>
  </section>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({
  minimized: Boolean,
  busy: Boolean,
  rayBusy: Boolean,
  ready: Boolean,
  failed: Boolean,
  sliceOpen: Boolean,
  source: Object,
  anchor: Object,
  time: String,
  accent: String,
  historical: Boolean,
  layerVisible: { type: Boolean, default: true },
  dockIndex: { type: Number, default: 0 },
  dockCount: { type: Number, default: 1 },
})
defineEmits(['run','slice','settings','minimize','restore','close'])
const panelPosition = computed(() => ({
  left: `clamp(108px, ${props.anchor ? `${props.anchor.x}px` : '50%'}, var(--run-right-limit, calc(100% - 108px)))`,
  top: props.anchor ? `clamp(70px, ${props.anchor.y - 130}px, calc(100% - 165px))` : '24%',
  borderColor: props.accent || undefined,
}))
const dockPosition = computed(() => ({
  left: `calc(50% + ${(props.dockIndex - (Math.max(1, props.dockCount) - 1) / 2) * 198}px)`,
  borderColor: props.accent || undefined,
}))
const indicatorStyle = computed(() => ({ background: props.accent || undefined }))
</script>
<style scoped>
.run-panel { position: absolute; z-index: 14; transform: translateX(-50%); width: 186px; padding: 11px; border: 1px solid #00e6a5; border-radius: 9px; color: #b9d0e4; background: #0c1c2eF5; box-shadow: 0 8px 25px #001c3360,0 0 16px #00eba518; font: 10px 'Microsoft YaHei',sans-serif; }
.run-panel.slice-open { --run-right-limit: calc(100% - min(620px, 49%) - 138px); }
@media(max-width: 1050px) { .run-panel.slice-open { --run-right-limit: calc(100% - min(540px, 66%) - 124px); } }
header { display: flex; align-items: center; gap: 6px; }header span { flex: 1; }.header-actions { display: flex; align-items: center; gap: 2px; }i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #00efa5; }i.busy { animation: pulse 1s infinite alternate; }
header button { width: 22px; height: 22px; padding: 0; background: transparent; border: 0; color: #8194b7; cursor: pointer; font-size: 17px; line-height: 1; }header button:last-child { color: #dc7181; }
p { color: #8eb5d0; font: 10px monospace; margin: 9px 0 6px; }small { color: #00e9ad; font-size: 10px; }
nav { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 9px; }nav button { position: relative; width: 100%; height: 29px; border: 1px solid transparent; border-radius: 4px; color: #78c9ed; background: #1c3449; cursor: pointer; }nav button svg { width: 16px; height: 16px; vertical-align: middle; }nav .run-action { background: #10433d; color: #00e9aa; }nav .selected { border-color: #00b5d4; background: #104c61; }
nav button:disabled { opacity: .45; cursor: default; }nav button:hover::after,nav button:focus-visible::after { content: attr(data-tip); position: absolute; top: calc(100% + 7px); left: 50%; transform: translateX(-50%); white-space: nowrap; color: #cdeef7; padding: 6px 8px; border-radius: 4px; background: #071524; border: 1px solid #335a72; }
.run-pill { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 18; display: flex; gap: 7px; align-items: center; border: 1px solid #00e6a5; background: #0c1c2e; color: #bad3e7; border-radius: 20px; padding: 6px 12px; font-size: 10px; cursor: pointer; box-shadow: 0 5px 15px #001c3360; }
@keyframes pulse { to { opacity: .3; } }
</style>
