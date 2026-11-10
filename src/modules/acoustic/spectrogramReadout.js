import { reactive } from 'vue'

/**
 * 时频图光标读取状态，由侧边栏开关控制，声源/接收两个时频图共享同一组读数点。
 *  - enabled  光标读取开关
 *  - markers  在时频图上点击落下的读数点（可多点），每项 { id, timeS, frequencyHz }
 */
export const spectrogramReadout = reactive({
  enabled: false,
  markers: [],
})

let nextMarkerId = 1

export function clearSpectrogramReadout() {
  spectrogramReadout.markers = []
  nextMarkerId = 1
}

export function setSpectrogramReadoutEnabled(enabled) {
  spectrogramReadout.enabled = Boolean(enabled)
  if (!spectrogramReadout.enabled) clearSpectrogramReadout()
}

export function addSpectrogramReadoutMarker(timeS, frequencyHz) {
  const time = Number(timeS)
  const frequency = Number(frequencyHz)
  if (!Number.isFinite(time) || !Number.isFinite(frequency) || frequency <= 0) return
  if (spectrogramReadout.markers.some(marker => (
    Math.abs(marker.timeS - time) < 1e-3
    && Math.abs(marker.frequencyHz - frequency) < 1e-3
  ))) return
  spectrogramReadout.markers.push({
    id: nextMarkerId++,
    timeS: time,
    frequencyHz: frequency,
  })
}
