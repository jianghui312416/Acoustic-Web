import { sampleRayFlow } from '../utils/rayFlow.js'
import { rayFlowClockElapsedMs } from '../utils/rayFlowClock.js'
import { clipRayPathsByProfile } from './ncFieldModel.js'

/** Reuse a polyline pool so animation never removes/recreates hundreds of map features. */
export function createCurtainRayFlow({ viewer, flow, geometry, project, visible = true }) {
  const Cesium = window.GeoVis
  const collection = viewer.scene.primitives.add(new Cesium.PolylineCollection())
  const pool = []
  let raf = 0
  let lastTime = 0
  let suspended = false
  let destroyed = false
  collection.show = visible

  function draw() {
    let used = 0
    for (const trail of sampleRayFlow(flow, rayFlowClockElapsedMs())) {
      for (let i = 1; i < trail.length; i++) {
        const alpha = (trail[i - 1].alpha + trail[i].alpha) * 0.48
        if (alpha < 0.015) continue
        const segments = geometry
          ? clipRayPathsByProfile([[trail[i - 1].point, trail[i].point]], geometry)
          : [[trail[i - 1].point, trail[i].point]]
        for (const segment of segments) {
          let line = pool[used]
          if (!line) {
            line = collection.add({
              positions: [], width: 1.6,
              material: Cesium.Material.fromType(Cesium.Material.ColorType, { color: new Cesium.Color(0.92, 0.97, 1, alpha) }),
            })
            pool.push(line)
          }
          line.positions = segment.map(project)
          line.material.uniforms.color.alpha = alpha
          line.show = true
          used++
        }
      }
    }
    for (let i = used; i < pool.length; i++) pool[i].show = false
    viewer.scene.requestRender?.()
  }

  function resume() {
    cancelAnimationFrame(raf)
    raf = 0
    lastTime = 0
    if (destroyed || suspended || !collection.show || document.hidden || viewer.isDestroyed?.()) return
    const tick = now => {
      if (destroyed || viewer.isDestroyed?.()) return
      if (!lastTime || now - lastTime >= 32) {
        lastTime = now
        draw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }
  document.addEventListener('visibilitychange', resume)
  resume()
  return {
    setVisible(value) { collection.show = value; resume(); viewer.scene.requestRender?.() },
    setSuspended(value) { suspended = value; resume() },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', resume)
      if (!viewer.isDestroyed?.()) viewer.scene.primitives.remove(collection)
    },
  }
}
