// The bundled legacy workers omit TerrainMesh edge indices required by GeoVis's
// terrain-fill renderer. Route only terrain decoding to the compatible worker set.
// Keep geometry workers unchanged and preserve the original task/promise behavior.
const terrainWorkers = new Set([
  'createVerticesFromHeightmap',
  'createVerticesFromQuantizedTerrainMesh',
  'createVerticesFromGoogleEarthEnterpriseBuffer',
])
const installed = new WeakSet()
export function installTerrainWorkerCompatibility(GeoVis) {
  const prototype = GeoVis.TaskProcessor?.prototype
  if (!prototype) throw new Error('GeoVis TaskProcessor is unavailable')
  if (installed.has(prototype)) return
  const scheduleTask = prototype.scheduleTask
  prototype.scheduleTask = function (...args) {
    if (terrainWorkers.has(this._workerName)) {
      if (this._worker) throw new Error('Terrain compatibility must be installed before earth creation')
      this._workerName = `terrain/${this._workerName}`
    }
    return scheduleTask.apply(this, args)
  }
  installed.add(prototype)
}
