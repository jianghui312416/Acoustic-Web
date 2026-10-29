import { shallowRef } from 'vue'

// 水声传播与水声通信各有一个独立的 GeoVis 地球实例。模块切换时把当前相机
// 状态写入这里，新模块激活后再恢复，避免数字地球重新回到默认视角。
export const sharedGlobeCamera = shallowRef(null)

// 通信模块内部有多个数字地球实例（静态信道、运动任务规划）。用注册表记录
// 当前可用的实例，模块整体激活/停用时统一同步相机。
const registeredViewers = new Map()

export function registerGlobeViewer(key, viewer) {
  if (!key || !viewer) return () => {}
  registeredViewers.set(key, viewer)
  return () => {
    if (registeredViewers.get(key) === viewer) registeredViewers.delete(key)
  }
}

export function captureGlobeCameraFor(key) {
  return captureGlobeCamera(registeredViewers.get(key))
}

export function applyGlobeCameraTo(key) {
  return applyGlobeCamera(registeredViewers.get(key))
}

function clonePosition(position) {
  if (!position) return null
  if (typeof position.clone === 'function') return position.clone()
  if (Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
    return { x: Number(position.x), y: Number(position.y), z: Number(position.z) }
  }
  return null
}

export function captureGlobeCamera(viewer) {
  const camera = viewer?.camera
  if (!camera) return false
  const position = clonePosition(camera.positionWC ?? camera.position)
  if (!position) return false
  sharedGlobeCamera.value = {
    position,
    heading: Number(camera.heading) || 0,
    pitch: Number(camera.pitch) || 0,
    roll: Number(camera.roll) || 0,
    capturedAt: Date.now(),
  }
  return true
}

export function applyGlobeCamera(viewer) {
  const saved = sharedGlobeCamera.value
  if (!saved?.position || !viewer?.camera?.setView) return false
  try {
    viewer.camera.setView({
      destination: saved.position,
      orientation: {
        heading: saved.heading,
        pitch: saved.pitch,
        roll: saved.roll,
      },
    })
    viewer.scene?.requestRender?.()
    return true
  } catch {
    return false
  }
}

export function clearGlobeCamera() {
  sharedGlobeCamera.value = null
}
